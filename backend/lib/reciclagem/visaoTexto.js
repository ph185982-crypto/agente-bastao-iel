// Leitura da imagem por IA que ENXERGA (Gemini, gratuita): confere o texto que a OCR leu (número e letra à mão saem
// errados no Tesseract: "1 shot" virou "4 shot"), traduz e marca o que é assinatura do autor (@, nome, logo, rosto,
// marca d'água) para apagar. A OCR continua dando as caixas justas; a IA dá o texto certo e o que fazer com cada trecho.
// Sem leitura confiável, a cópia NÃO sai: melhor esperar a cota voltar do que publicar texto errado.
const sharp = require('sharp');

// Provedores gratuitos com visão. Os nomes de modelo mudam: além da lista fixa, cada um descobre na hora os modelos que
// aceitam imagem (Gemini: todo "flash"; Groq: llama-4/vision/scout/maverick; OpenRouter: entrada de imagem e preço zero).
const MODELOS = [
  { provedor: 'groq', env: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', modelos: [], descobrir: (m) => /llama-4|vision|scout|maverick|-vl/i.test(m.id) },
  { provedor: 'openrouter', env: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', modelos: [], descobrir: (m) => (m.architecture?.input_modalities || []).includes('image') && /:free$/.test(m.id) },
  { provedor: 'gemini', env: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', modelos: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'], descobrir: (m) => /flash/i.test(m.id) && !/image|tts|audio|live|embed/i.test(m.id) },
  // Último recurso, PAGO (autorizado com teto mensal em gastoIa): só quando nenhum gratuito com visão responde.
  // Uma imagem custa frações de centavo; o gasto entra no registro e respeita o teto do mês.
  { provedor: 'openai', env: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', modelos: ['gpt-5.4-mini'], pago: true, descobrir: () => false },
];
const _descobertos = new Map();
async function modelosDe(m, f) {
  if (_descobertos.has(m.provedor)) return _descobertos.get(m.provedor);
  let ids = [];
  try {
    const r = await f(`${m.base}/models`, { headers: { Authorization: `Bearer ${process.env[m.env]}` }, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); ids = (j.data || j.models || []).filter(m.descobrir).map((x) => String(x.id).replace(/^models\//, ''));
  } catch { /* lista fixa basta */ }
  const todos = [...new Set([...m.modelos, ...ids.sort((a, b) => (/flash-lite|mini|8b|11b/.test(a) ? 1 : 0) - (/flash-lite|mini|8b|11b/.test(b) ? 1 : 0)).slice(0, 4)])];
  _descobertos.set(m.provedor, todos);
  return todos;
}
const disponivel = () => MODELOS.some((m) => process.env[m.env]);

const SISTEMA = (handle) => `Você olha UMA imagem de um post de Instagram e devolve o texto que aparece nela, para a imagem ser traduzida para o português do Brasil mantendo o desenho original. Você NÃO precisa dizer onde fica cada texto (o sistema já sabe): só o texto certo e a tradução.
"textos": cada trecho de texto separado da imagem (título, rótulo, parágrafo, balão), em ordem de leitura:
- "original": EXATAMENTE como aparece. Confira número escrito à mão com atenção (1 e 4, 7 e 1, 0 e 6).
- "traducao": tradução natural para o português do Brasil, do MESMO tamanho ou mais curta (é texto de imagem). Números e valores iguais (só a pontuação muda: 1,000 → 1.000). Onomatopeia (swish, boom) e nome próprio ficam iguais.
Não inclua nos "textos" a assinatura do autor.
"assinaturas": tudo que identifica o autor ou outra marca e precisa SAIR da imagem: @${handle || 'autor'}, nome do autor, logo, foto/rosto usado como selo, marca d'água, site, "follow/siga", contador de slide, "swipe/arraste". Para cada uma: "texto" (o que está escrito, ou "logo"/"rosto") e "posicao": uma de topo-esquerda, topo-centro, topo-direita, meio-esquerda, meio-centro, meio-direita, base-esquerda, base-centro, base-direita.
"legenda": a tradução da LEGENDA ORIGINAL que vier na mensagem (ou ""), sem @ do autor, sem pedido para seguir o autor, sem link dele.
Responda APENAS JSON: {"textos":[{"original":"","traducao":""}],"assinaturas":[{"texto":"","posicao":"base-centro"}],"legenda":""}`;

async function chamar({ imagem, handle, legenda, fetch: f = globalThis.fetch, prazoMs = 30000 }) {
  const jpg = await sharp(imagem).rotate().resize({ width: 1024, height: 1280, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  const url = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  const msgs = [{ role: 'system', content: SISTEMA(handle) }, { role: 'user', content: [{ type: 'text', text: legenda ? `LEGENDA ORIGINAL:\n${String(legenda).slice(0, 2000)}` : 'Sem legenda (devolva "legenda": "").' }, { type: 'image_url', image_url: { url } }] }];
  const erros = []; let cota = false; const t0 = Date.now();
  const pagoOk = async () => { if (process.env.IA_OPENAI !== '1') return false; try { return await require('../gastoIa').podeGastar(); } catch { return false; } };
  for (const m of MODELOS.filter((x) => process.env[x.env])) {
    if (m.pago && !(await pagoOk())) continue;
    for (const modelo of await modelosDe(m, f)) {
      if (Date.now() - t0 > prazoMs * 1.5) break;
      try {
        const r = await f(`${m.base}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(prazoMs), headers: { Authorization: `Bearer ${process.env[m.env]}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(m.provedor === 'openai'
            ? { model: modelo, messages: msgs, max_completion_tokens: 6000, reasoning_effort: 'low', response_format: { type: 'json_object' } }
            : { model: modelo, messages: msgs, temperature: 0.1, max_tokens: 2500, response_format: { type: 'json_object' }, ...(/^gemini-3/.test(modelo) ? { reasoning_effort: 'low' } : {}) }) });
        const corpo = await r.text();
        if (!r.ok && [401, 403].includes(r.status)) { erros.push(`${m.provedor} ${r.status}: ${corpo.replace(/\s+/g, ' ').slice(0, 120)}`); break; } // provedor fechado: pula os outros modelos dele
        if (!r.ok) { if (r.status === 429) cota = true; erros.push(`${m.provedor}/${modelo} ${r.status}: ${corpo.replace(/\s+/g, ' ').slice(0, 120)}`); continue; }
        const json = JSON.parse(corpo);
        if (m.pago && json.usage) { try { await require('../gastoIa').registrar(json.model || modelo, json.usage, { etapa: 'clone_visao' }); } catch { /* registro é cortesia */ } }
        const txt = json?.choices?.[0]?.message?.content || '';
        const ini = txt.indexOf('{'); const fim = txt.lastIndexOf('}');
        const dados = JSON.parse(txt.slice(ini, fim + 1));
        if (!Array.isArray(dados?.textos) && !Array.isArray(dados?.elementos)) throw new Error('resposta sem "textos"');
        return { dados, provedor: m.provedor, modelo };
      } catch (e) { erros.push(`${m.provedor}/${modelo}: ${String(e.message).slice(0, 120)}`); }
    }
  }
  if (!erros.length) throw Object.assign(new Error('Nenhuma IA com visão configurada (GEMINI_API_KEY).'), { code: 'SEM_VISAO' });
  // Todos sem cota: o clone espera (status 429) em vez de virar erro.
  throw Object.assign(new Error(`Leitura da imagem por IA indisponível agora: ${erros.join(' | ').slice(0, 900)}`), { status: cota ? 429 : 503, code: cota ? 'COTA_IA' : 'VISAO' });
}

const limpa = (s, n = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
function semelhanca(a, b) {
  a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b) return 1;
  const m = a.length; const n = b.length; let ant = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); ant = cur; }
  return 1 - ant[n] / Math.max(m, n);
}
const POSICOES = ['topo-esquerda', 'topo-centro', 'topo-direita', 'meio-esquerda', 'meio-centro', 'meio-direita', 'base-esquerda', 'base-centro', 'base-direita'];

// Junta a resposta da IA com as caixas da OCR (pixels da imagem original). A posição vem SEMPRE da OCR: a IA só corrige o
// texto e traduz. Cada trecho da OCR é casado com o texto da IA mais parecido ("4 shot" ↔ "1 shot").
// Devolve { blocos, faltando }: blocos para trocaTexto ({x0,y0,x1,y1,altura_linha,texto,novo} ou {apagar, posicao}).
function blocosDaVisao(dados, { trechos = [] } = {}) {
  const textos = (Array.isArray(dados?.textos) ? dados.textos : []).slice(0, 40).map((t) => ({ original: limpa(t?.original), traducao: limpa(t?.traducao) })).filter((t) => t.original);
  const porTexto = new Map();
  for (const tr of trechos) {
    let melhor = null; let nota = 0;
    for (const [k, t] of textos.entries()) {
      // trecho da OCR pode ser só um pedaço do texto (parágrafo partido): compara com o texto inteiro e com o pedaço do mesmo tamanho.
      const n1 = semelhanca(tr.texto, t.original);
      const n2 = norm(t.original).includes(norm(tr.texto)) && norm(tr.texto).length >= 4 ? 0.9 : 0;
      const n = Math.max(n1, n2); if (n > nota) { nota = n; melhor = k; }
    }
    if (melhor != null && nota >= 0.55) { if (!porTexto.has(melhor)) porTexto.set(melhor, []); porTexto.get(melhor).push(tr); }
  }
  const blocos = []; const faltando = [];
  for (const [k, t] of textos.entries()) {
    const ocr = porTexto.get(k);
    const mudou = t.traducao && norm(t.traducao) !== norm(t.original);
    if (!ocr) { if (mudou) faltando.push(t.original); continue; }
    if (!mudou) continue;
    const caixa = { x0: Math.min(...ocr.map((o) => o.x0)), x1: Math.max(...ocr.map((o) => o.x1)), y0: Math.min(...ocr.map((o) => o.y0)), y1: Math.max(...ocr.map((o) => o.y1)) };
    const altura_linha = Math.round(ocr.reduce((a, o) => a + (o.altura_linha || o.y1 - o.y0), 0) / ocr.length);
    blocos.push({ ...caixa, altura_linha, n_linhas: ocr.reduce((a, o) => a + (o.n_linhas || 1), 0), texto: t.original, novo: t.traducao, confianca: 100, visao: true });
  }
  for (const a of (Array.isArray(dados?.assinaturas) ? dados.assinaturas : []).slice(0, 6)) {
    const posicao = POSICOES.includes(a?.posicao) ? a.posicao : null; if (!posicao) continue;
    if (!blocos.some((b) => b.apagar && b.posicao === posicao)) blocos.push({ apagar: true, posicao, texto: limpa(a?.texto, 80) || '(assinatura)' });
  }
  return { blocos, faltando };
}

module.exports = { disponivel, chamar, blocosDaVisao, semelhanca, POSICOES, SISTEMA, MODELOS };
