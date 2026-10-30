const OpenAI = require('openai');

// ── Provedores de IA ──────────────────────────────────────────────────────────
// A ordem abaixo é a ordem de tentativa. Só entra na fila o provedor que tiver
// chave configurada — então dá pra rodar só com o Groq e ir somando reforços.
// Todos os provedores acima da OpenAI têm free tier; a OpenAI (única paga) fica
// por último e só é usada se nenhum gratuito responder.
const PROVIDERS = [
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    // Do maior contexto para o menor — 413 faz cair pro próximo.
    large: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    small: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    // Keep Portuguese editorial work on the general-purpose text models.
    // A specialized reserve must not turn a temporary quota into poor copy.
    discoverFilter: id => !/^allam-/i.test(id),
  },
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    large: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'],
    small: ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'],
  },
  {
    name: 'cerebras',
    envKey: 'CEREBRAS_API_KEY',
    baseURL: 'https://api.cerebras.ai/v1',
    large: ['llama-3.3-70b', 'qwen-3-32b'],
    small: ['llama3.1-8b', 'llama-3.3-70b'],
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    large: ['deepseek/deepseek-chat-v3-0324:free', 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free'],
    small: ['meta-llama/llama-3.3-8b-instruct:free', 'google/gemma-3-12b-it:free'],
    // No OpenRouter só descobrimos modelos com sufixo :free — os outros são pagos.
    discoverFilter: (id) => id.endsWith(':free'),
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    baseURL: undefined, // default da SDK
    large: ['gpt-5.4-mini', 'gpt-4o-mini'],
    small: ['gpt-5.4-mini', 'gpt-4o-mini'],
    paid: true,
    discover: false,
  },
];

const _clients = new Map();   // name → OpenAI client
const _discovered = new Map(); // name → string[] (modelos vindos do /models)
// { large: {provider, model}, small: {...} } que funcionou por último, POR NÍVEL: um pedido de texto grande
// nunca herda o modelo pequeno usado numa etapa simples (isso fazia a copy do carrossel cair no modelo fraco).
const _lastGood = {};
const nivel = (requestedModel) => (requestedModel === 'gpt-4o-mini' ? 'small' : 'large');

function clientFor(provider) {
  if (_clients.has(provider.name)) return _clients.get(provider.name);
  const client = new OpenAI({
    apiKey: process.env[provider.envKey],
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
  });
  _clients.set(provider.name, client);
  return client;
}

function availableProviders() {
  return PROVIDERS.filter(p => !!process.env[p.envKey]);
}

// Usado pelas rotas para checar se dá pra chamar a IA, sem amarrar em um
// provedor específico — qualquer chave da cascata serve.
function hasLlmKey() {
  return availableProviders().length > 0;
}

const NO_LLM_KEY_MESSAGE = `Nenhuma chave de IA configurada no servidor (${PROVIDERS.map(p => p.envKey).join(', ')})`;

// ── Classificação de erro ─────────────────────────────────────────────────────
// modelo  → só esse modelo está ruim, tenta o próximo do mesmo provedor
// provedor→ o provedor inteiro está fora, pula pro próximo provedor
function errorScope(err, provider) {
  const status = err?.status;
  const code = err?.error?.code || err?.code || '';
  const msg = err?.message || '';

  if (status === 404) return 'model';
  if (status === 413) return 'model'; // prompt maior que o contexto do modelo
  if (status === 400) {
    if (/model_decommissioned|model_not_found|json_validate_failed|does not exist/i.test(`${code} ${msg}`)) return 'model';
    if (/decommissioned|deprecated|not.*support|context length|too large|reduce the length of (?:the )?messages|maximum context|token limit.*exceed/i.test(msg)) return 'model';
    // visão/multimodal não suportado por este modelo → tenta o próximo
    if (/image_url|image.*content|vision|multimodal/i.test(`${code} ${msg}`)) return 'model';
    return 'fatal'; // 400 de verdade (payload malformado) — não adianta insistir
  }
  if (status === 401 || status === 403) return 'provider'; // chave inválida/sem acesso
  // Groq reports quotas per model. A full quota on 120B does not mean the
  // configured 20B model is unavailable. Account/billing/global limits still
  // stop the provider, and exhausting all models preserves the 429 for backoff.
  if (status === 429) return provider?.name === 'groq' && /rate limit reached for model\b/i.test(msg) ? 'model' : 'provider';
  if (status >= 500) return 'provider';
  if (/ETIMEDOUT|ECONNABORTED|ECONNRESET|ENOTFOUND|fetch failed/i.test(`${code} ${msg}`)) return 'provider';
  return 'fatal';
}

// Never log provider response text: it may contain an organization identifier,
// a credential fragment or echoed user content. Keep only operational fields.
function errorInfo(err, scope) {
  const msg = String(err?.message || '');
  const header = typeof err?.headers?.get === 'function' ? err.headers.get('retry-after') : err?.headers?.['retry-after'];
  const metric = msg.match(/\b(?:input |output )?(?:tokens|requests) per (?:minute|day)\b/i)?.[0]?.toLowerCase() || null;
  const number = label => { const v = msg.match(new RegExp(`\\b${label}\\s*:?\\s*([\\d.]+)`, 'i'))?.[1]; return v && Number.isFinite(Number(v)) ? Number(v) : null; };
  return { status: Number(err?.status) || null, scope, metric, code: err?.error?.code || err?.code || null, limit: number('Limit'), used: number('Used'), requested: number('Requested'), retry_after_seconds: header && Number.isFinite(Number(header)) ? Number(header) : null };
}
// Último erro por provedor (para o pipeline explicar por que a IA premium não respondeu: sem créditos, limite…).
const _ultimoErro = {};
const ultimoErro = (nome) => _ultimoErro[nome] || null;

// ── Descoberta de modelos ─────────────────────────────────────────────────────
// Quando a lista fixa acaba, perguntamos ao provedor quais modelos ele tem hoje.
// É o que impede o app de parar quando um modelo é desativado sem aviso.
const NOT_CHAT = /whisper|tts|orpheus|canopylabs|embed|guard|moderation|safety|rerank|vision-only|image|audio|video|distil/i;

async function discoverModels(provider) {
  if (provider.discover === false) return [];
  if (_discovered.has(provider.name)) return _discovered.get(provider.name);
  let ids = [];
  try {
    const list = await clientFor(provider).models.list();
    ids = (list?.data || [])
      .map(m => m.id)
      .filter(id => id && !NOT_CHAT.test(id))
      .filter(provider.discoverFilter || (() => true));
    console.warn(`[llm] ${provider.name}: ${ids.length} modelos descobertos`);
  } catch (e) {
    console.warn(`[llm] ${provider.name}: falha ao listar modelos —`, e.message?.slice(0, 120));
  }
  _discovered.set(provider.name, ids);
  return ids;
}

// ── Saneamento de JSON ────────────────────────────────────────────────────────
// Alguns modelos devolvem o JSON dentro de ```json ... ``` ou com texto em volta.
// Os callers fazem JSON.parse direto, então limpamos aqui.
function sanitizeJsonContent(content) {
  if (typeof content !== 'string') return content;
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{') || s.startsWith('[')) return s;
  const start = s.search(/[{[]/);
  if (start === -1) return s;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  return end > start ? s.slice(start, end + 1) : s;
}

function withSanitizedJson(res) {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return res;
  const cleaned = sanitizeJsonContent(content);
  if (cleaned === content) return res;
  const choices = res.choices.map((c, i) =>
    i === 0 ? { ...c, message: { ...c.message, content: cleaned } } : c
  );
  return { ...res, choices };
}

// ── Cascata ───────────────────────────────────────────────────────────────────
function modelsFor(provider, requestedModel) {
  return requestedModel === 'gpt-4o-mini' ? provider.small : provider.large;
}

async function tryModel(provider, model, opts, requestOptions, cont) {
  if (cont) cont.n += 1;
  const client = clientFor(provider);
  // Modelos gpt-oss "pensam" antes de responder e isso pode passar de 30 s:
  // pedimos raciocínio curto (reasoning_effort, documentado pela Groq) e sem o
  // texto do raciocínio na resposta. Se o provedor recusar o parâmetro, repete sem.
  const { esforco, preferirMelhor, ...base0 } = opts || {};
  let base = base0;
  const extra = /gpt-oss/i.test(model) ? { reasoning_effort: esforco || 'low', include_reasoning: false } : {};
  // Modelos de raciocínio da OpenAI (gpt-5.x, o*): sem temperature e com max_completion_tokens (o raciocínio também
  // consome tokens de saída, por isso a folga).
  if (provider.name === 'openai' && /^(gpt-5|o\d)/i.test(model)) {
    const { max_tokens, temperature, ...r } = base0; void temperature;
    base = { ...r, max_completion_tokens: (max_tokens || 2000) + 2500 };
    extra.reasoning_effort = esforco === 'alto' ? 'medium' : 'low';
  }
  let res;
  try {
    res = await client.chat.completions.create({ ...base, ...extra, model }, requestOptions);
  } catch (err) {
    if (Object.keys(extra).length && err?.status === 400 && /reasoning/i.test(err?.message || '')) res = await client.chat.completions.create({ ...base, model }, requestOptions);
    else throw err;
  }
  _lastGood[nivel(opts?.model)] = { provider: provider.name, model };
  const out = opts?.response_format?.type === 'json_object' ? withSanitizedJson(res) : res;
  // Quem usou a resposta pode registrar qual provedor/modelo a produziu.
  const u = res?.usage;
  const tokens = u ? { entrada: u.prompt_tokens ?? null, saida: u.completion_tokens ?? null, total: u.total_tokens ?? null } : null;
  try { Object.defineProperty(out, '__llm', { value: { provider: provider.name, model: res?.model || model, pago: !!provider.paid, tokens, tentativas_provedor: cont ? cont.n : 1 }, enumerable: false }); } catch { /* resposta congelada */ }
  return out;
}

// Percorre provedores × modelos até um responder.
async function cascade(opts, requestOptions) {
  const providers = availableProviders();
  const cont = { n: 0 };
  if (!providers.length) throw new Error('Nenhuma chave de IA configurada (GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY)');

  let lastErr, rateErr;
  const attempted = new Set(), down = new Set();
  const attempt = (provider, model) => { attempted.add(`${provider.name}/${model}`); return tryModel(provider, model, opts, requestOptions, cont); };
  const remember = (provider, model, err) => {
    const scope = errorScope(err, provider);
    lastErr = err;
    if (err?.status === 429) rateErr = err;
    if (scope === 'provider') down.add(provider.name);
    const info = errorInfo(err, scope); _ultimoErro[provider.name] = { ...info, em: Date.now(), mensagem: String(err?.message || '').slice(0, 160) };
    console.warn(`[llm] ${provider.name}/${model} falhou:`, JSON.stringify(info));
    return scope;
  };

  // Etapas criativas (preferirMelhor: ângulo, roteiro, júri) vão primeiro ao modelo premium da OpenAI quando ela está
  // ligada (OPENAI_API_KEY e IA_PREMIUM diferente de "0"). Se falhar, segue a cascata normal (gratuitos primeiro).
  const premium = opts.preferirMelhor && process.env.IA_PREMIUM !== '0' ? providers.find((p) => p.name === 'openai') : null;
  if (premium) {
    const modelo = process.env.IA_PREMIUM_MODELO || 'gpt-5.4';
    try { return await attempt(premium, modelo); } catch (err) { remember(premium, modelo, err); } // nunca derruba: cai na cascata
  }

  // Atalho: tenta primeiro a combinação que funcionou na chamada anterior.
  // Só pula direto para ele se for o MELHOR modelo daquele provedor no nível; senão a ordem normal tenta o melhor de novo.
  const previous = _lastGood[nivel(opts.model)];
  if (previous) {
    const p = providers.find(x => x.name === previous.provider);
    if (p && (modelsFor(p, opts.model) || [])[0] === previous.model) {
      try {
        return await attempt(p, previous.model);
      } catch (err) {
        if (remember(p, previous.model, err) === 'fatal') throw err;
        if (_lastGood[nivel(opts.model)] === previous) delete _lastGood[nivel(opts.model)];
      }
    }
  }

  for (const provider of providers) {
    if (down.has(provider.name)) continue;
    if (provider.paid) console.warn(`[llm] caindo no provedor pago ${provider.name} — os gratuitos falharam`);

    const fixed = modelsFor(provider, opts.model) || [];
    let providerDown = false;
    for (const model of fixed) {
      if (attempted.has(`${provider.name}/${model}`)) continue;
      if (opts.preferirMelhor && process.env.IA_PREMIUM !== '0' && !modeloForte(model)) continue; // texto do Pedro só com modelo forte
      try {
        return await attempt(provider, model);
      } catch (err) {
        const scope = remember(provider, model, err);
        if (scope === 'fatal') throw err;
        if (scope === 'provider') { providerDown = true; break; }
        // Limite POR MINUTO no melhor modelo de texto grande: esperar alguns segundos sai melhor do que cair num modelo
        // mais fraco (era isso que deixava a copy do carrossel rasa). Limite por dia não espera: segue a fila.
        const info = errorInfo(err, scope); const espera = info.retry_after_seconds;
        const folga = requestOptions?.timeout ? requestOptions.timeout - 4000 : 60000;
        if (opts.preferirMelhor && err?.status === 429 && /minute/.test(info.metric || '') && model === fixed[0] && nivel(opts.model) === 'large' && espera && espera <= 20 && espera * 1000 < folga) {
          await new Promise((r) => setTimeout(r, espera * 1000 + 500));
          try { return await tryModel(provider, model, opts, requestOptions, cont); } catch (e2) { if (remember(provider, model, e2) === 'fatal') throw e2; }
        }
      }
    }
    if (providerDown) continue;

    // Lista fixa esgotada — pergunta ao provedor o que ele tem hoje.
    const discovered = (await discoverModels(provider)).filter(id => !attempted.has(`${provider.name}/${id}`) && !(opts.preferirMelhor && process.env.IA_PREMIUM !== '0' && !modeloForte(id)));
    for (const model of discovered.slice(0, 6)) {
      try {
        return await attempt(provider, model);
      } catch (err) {
        const scope = remember(provider, model, err);
        if (scope === 'fatal') throw err;
        if (scope === 'provider') break;
      }
    }
  }

  throw rateErr || lastErr || new Error('Todos os provedores de IA falharam');
}

function createCompatClient() {
  return {
    chat: {
      completions: {
        create: async (opts, requestOptions) => {
          try {
            return await cascade(opts, requestOptions);
          } catch (err) {
            if(err?.status===429||err?.status===401||err?.status===403||/abort|timeout/i.test(`${err?.name||''} ${err?.message||''}`))throw err;
            // Última cartada: se pedimos JSON estruturado e ninguém aceitou,
            // repete sem response_format e pede o JSON no próprio prompt.
            if (opts?.response_format?.type !== 'json_object') throw err;
            console.warn('[llm] repetindo sem response_format como último recurso');
            const { response_format, messages = [], ...rest } = opts;
            void response_format;
            const relaxed = {
              ...rest,
              messages: [
                ...messages,
                { role: 'system', content: 'Responda APENAS com o objeto JSON pedido, sem markdown, sem crases, sem texto antes ou depois.' },
              ],
            };
            const res = await cascade(relaxed, requestOptions);
            return withSanitizedJson(res);
          }
        },
      },
    },
  };
}

// Traduz erros de LLM em mensagens amigáveis pro usuário final.
function friendlyErrorMessage(err) {
  const status = err?.status;
  if (status === 401) return 'Chave de API inválida. Verifique a configuração no servidor.';
  if (status === 403) return 'Acesso negado pela API de IA. Verifique a configuração de billing/acesso.';
  if (status === 404) return 'O modelo de IA não está disponível no momento. Tente novamente em instantes.';
  if (status === 429) return 'Os modelos de IA estão sobrecarregados no momento. Tente novamente em alguns instantes.';
  if (status >= 500) return 'O serviço de IA está instável no momento. Tente novamente em alguns instantes.';
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return 'A geração demorou demais e foi cancelada. Tente novamente.';
  }
  if (/JSON|Unexpected token/i.test(err?.message || '')) {
    return 'A IA retornou uma resposta inválida. Tente novamente.';
  }
  return 'Não foi possível gerar o conteúdo agora. Tente novamente em instantes.';
}

// Modelos FORTES o bastante para escrever o carrossel (ângulo, roteiro, júri). Os demais (qwen 27B, llama 8B, gemma 12B…)
// servem para tarefas simples; para texto do Pedro, melhor esperar a cota voltar do que publicar texto raso.
const FORTES = [/^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/, /^o\d/, /gemini-2\.5-(pro|flash)$/, /gemini-3/, /gpt-oss-120b/, /llama-3\.3-70b/, /llama-4-(maverick|scout)/, /deepseek-(chat|r1)/, /qwen3-235b/, /kimi-k2/];
const modeloForte = (model) => FORTES.some((r) => r.test(String(model || '')));
// "Premium ligada" = existe algum provedor com modelo forte configurado (OpenAI com crédito, Gemini, Groq, Cerebras…).
// IA_PREMIUM=0 desliga a exigência e aceita qualquer modelo.
const premiumLigado = () => process.env.IA_PREMIUM !== '0' && availableProviders().some((p) => [...(p.large || [])].some(modeloForte));
module.exports = { createCompatClient, friendlyErrorMessage, hasLlmKey, NO_LLM_KEY_MESSAGE, ultimoErro, premiumLigado, modeloForte, FORTES };
