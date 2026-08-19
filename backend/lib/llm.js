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
    large: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'groq/compound'],
    small: ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'groq/compound-mini', 'groq/compound'],
  },
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    large: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'],
    small: ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'],
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
    large: ['gpt-4o-mini'],
    small: ['gpt-4o-mini'],
    paid: true,
    discover: false,
  },
];

const _clients = new Map();   // name → OpenAI client
const _discovered = new Map(); // name → string[] (modelos vindos do /models)
let _lastGood = null;          // { provider, model } que funcionou por último

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
function errorScope(err) {
  const status = err?.status;
  const code = err?.error?.code || err?.code || '';
  const msg = err?.message || '';

  if (status === 404) return 'model';
  if (status === 413) return 'model'; // prompt maior que o contexto do modelo
  if (status === 400) {
    if (/model_decommissioned|model_not_found|json_validate_failed|does not exist/i.test(`${code} ${msg}`)) return 'model';
    if (/decommissioned|deprecated|not.*support|context length|too large/i.test(msg)) return 'model';
    // visão/multimodal não suportado por este modelo → tenta o próximo
    if (/image_url|image.*content|vision|multimodal/i.test(`${code} ${msg}`)) return 'model';
    return 'fatal'; // 400 de verdade (payload malformado) — não adianta insistir
  }
  if (status === 401 || status === 403) return 'provider'; // chave inválida/sem acesso
  if (status === 429) return 'provider';                   // cota/rate-limit estourado
  if (status >= 500) return 'provider';
  if (/ETIMEDOUT|ECONNABORTED|ECONNRESET|ENOTFOUND|fetch failed/i.test(`${code} ${msg}`)) return 'provider';
  return 'fatal';
}

// ── Descoberta de modelos ─────────────────────────────────────────────────────
// Quando a lista fixa acaba, perguntamos ao provedor quais modelos ele tem hoje.
// É o que impede o app de parar quando um modelo é desativado sem aviso.
const NOT_CHAT = /whisper|tts|embed|guard|moderation|safety|rerank|vision-only|image|audio|video|distil/i;

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

async function tryModel(provider, model, opts, requestOptions) {
  const client = clientFor(provider);
  const res = await client.chat.completions.create({ ...opts, model }, requestOptions);
  _lastGood = { provider: provider.name, model };
  return opts?.response_format?.type === 'json_object' ? withSanitizedJson(res) : res;
}

// Percorre provedores × modelos até um responder.
async function cascade(opts, requestOptions) {
  const providers = availableProviders();
  if (!providers.length) throw new Error('Nenhuma chave de IA configurada (GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY)');

  let lastErr;

  // Atalho: tenta primeiro a combinação que funcionou na chamada anterior.
  if (_lastGood) {
    const p = providers.find(x => x.name === _lastGood.provider);
    if (p) {
      try {
        return await tryModel(p, _lastGood.model, opts, requestOptions);
      } catch (err) {
        if (errorScope(err) === 'fatal') throw err;
        lastErr = err;
        _lastGood = null;
      }
    }
  }

  for (const provider of providers) {
    if (provider.paid) console.warn(`[llm] caindo no provedor pago ${provider.name} — os gratuitos falharam`);

    const fixed = modelsFor(provider, opts.model) || [];
    let providerDown = false;
    for (const model of fixed) {
      try {
        return await tryModel(provider, model, opts, requestOptions);
      } catch (err) {
        const scope = errorScope(err);
        lastErr = err;
        if (scope === 'fatal') throw err;
        console.warn(`[llm] ${provider.name}/${model} falhou (${scope}):`, err.message?.slice(0, 100));
        if (scope === 'provider') { providerDown = true; break; }
      }
    }
    if (providerDown) continue;

    // Lista fixa esgotada — pergunta ao provedor o que ele tem hoje.
    const discovered = (await discoverModels(provider)).filter(id => !fixed.includes(id));
    for (const model of discovered.slice(0, 6)) {
      try {
        return await tryModel(provider, model, opts, requestOptions);
      } catch (err) {
        const scope = errorScope(err);
        lastErr = err;
        if (scope === 'fatal') throw err;
        if (scope === 'provider') break;
      }
    }
  }

  throw lastErr || new Error('Todos os provedores de IA falharam');
}

function createCompatClient() {
  return {
    chat: {
      completions: {
        create: async (opts, requestOptions) => {
          try {
            return await cascade(opts, requestOptions);
          } catch (err) {
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

module.exports = { createCompatClient, friendlyErrorMessage, hasLlmKey, NO_LLM_KEY_MESSAGE };
