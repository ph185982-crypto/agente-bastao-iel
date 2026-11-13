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

const SISTEMA = (handle) => `Você olha UMA imagem de um post de Instagram (slide de carrossel ou post único) e devolve cada texto visível, para a imagem ser traduzida para o português do Brasil mantendo o desenho original.
Para cada elemento:
- "box": [ymin, xmin, ymax, xmax] na escala 0 a 1000 da imagem, justo em volta do texto (ou do logo/rosto, no caso de assinatura).
- "original": o texto EXATAMENTE como aparece (confira números escritos à mão com atenção: 1 e 4, 7 e 1, 0 e 6).
- "tipo": "texto" (conteúdo do post) ou "assinatura" (o @${handle || 'autor'}, nome do autor, logo, foto/rosto do autor usado como selo, marca d'água, site, "follow", contador de slide, "arraste/swipe"). Assinatura com logo/rosto: UM elemento cuja box cobre o logo E o texto juntos.
- "traducao": a tradução natural para o português do Brasil, do MESMO tamanho ou mais curta (é texto de imagem). Números e valores iguais ao original (só troca a pontuação: 1,000 → 1.000). Onomatopeia (swish, boom) e nome próprio ficam como estão. Em assinatura, deixe "".
Não invente texto que não está na imagem. Não junte textos distantes num elemento só.
Responda APENAS JSON: {"elementos":[{"box":[0,0,0,0],"original":"","tipo":"texto","traducao":""}],"legenda":""}
"legenda": a tradução da LEGENDA ORIGINAL que vier na mensagem (ou "" se não vier), sem @ do autor, sem pedido para seguir o autor, sem link dele.`;

async function chamar({ imagem, handle, legenda, fetch: f = globalThis.fetch, prazoMs = 30000 }) {
  const jpg = await sharp(imagem).rotate().resize({ width: 1024, height: 1280, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  const url = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  const msgs = [{ role: 'system', content: SISTEMA(handle) }, { role: 'user', content: [{ type: 'text', text: legenda ? `LEGENDA ORIGINAL:\n${String(legenda).slice(0, 2000)}` : 'Sem legenda (devolva "legenda": "").' }, { type: 'image_url', image_url: { url } }] }];
  const erros = []; let cota = false; const t0 = Date.now();
  for (const m of MODELOS.filter((x) => process.env[x.env])) {
    for (const modelo of await modelosDe(m, f)) {
      if (Date.now() - t0 > prazoMs * 1.5) break;
      try {
        const r = await f(`${m.base}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(prazoMs), headers: { Authorization: `Bearer ${process.env[m.env]}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelo, messages: msgs, temperature: 0.1, max_tokens: 2500, response_format: { type: 'json_object' }, ...(/^gemini-3/.test(modelo) ? { reasoning_effort: 'low' } : {}) }) });
        const corpo = await r.text();
        if (!r.ok && [401, 403].includes(r.status)) { erros.push(`${m.provedor} ${r.status}: ${corpo.replace(/\s+/g, ' ').slice(0, 120)}`); break; } // provedor fechado: pula os outros modelos dele
        if (!r.ok) { if (r.status === 429) cota = true; erros.push(`${m.provedor}/${modelo} ${r.status}: ${corpo.replace(/\s+/g, ' ').slice(0, 120)}`); continue; }
        const txt = JSON.parse(corpo)?.choices?.[0]?.message?.content || '';
        const ini = txt.indexOf('{'); const fim = txt.lastIndexOf('}');
        const dados = JSON.parse(txt.slice(ini, fim + 1));
        if (!Array.isArray(dados?.elementos)) throw new Error('resposta sem "elementos"');
        return { dados, provedor: m.provedor, modelo };
      } catch (e) { erros.push(`${m.provedor}/${modelo}: ${String(e.message).slice(0, 120)}`); }
    }
  }
  if (!erros.length) throw Object.assign(new Error('Nenhuma IA com visão configurada (GEMINI_API_KEY).'), { code: 'SEM_VISAO' });
  // Todos sem cota: o clone espera (status 429) em vez de virar erro.
  throw Object.assign(new Error(`Leitura da imagem por IA indisponível agora: ${erros.join(' | ').slice(0, 900)}`), { status: cota ? 429 : 503, code: cota ? 'COTA_IA' : 'VISAO' });
}

const limpa = (s, n = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const centro = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const dentro = (p, b, folga = 0) => p[0] >= b.x0 - folga && p[0] <= b.x1 + folga && p[1] >= b.y0 - folga && p[1] <= b.y1 + folga;

// Junta a resposta da IA com as caixas da OCR (pixels da imagem original).
// Devolve blocos para trocaTexto: { x0,y0,x1,y1, altura_linha, texto, novo } ou { ..., apagar: true }.
function blocosDaVisao(dados, { largura, altura, trechos = [] }) {
  const out = [];
  for (const e of (dados?.elementos || []).slice(0, 40)) {
    const bx = Array.isArray(e?.box) ? e.box.map(Number) : null;
    if (!bx || bx.length !== 4 || bx.some((v) => !Number.isFinite(v))) continue;
    const [ymin, xmin, ymax, xmax] = bx.map((v) => Math.max(0, Math.min(1000, v)));
    if (ymax <= ymin || xmax <= xmin) continue;
    const vb = { x0: Math.round((xmin / 1000) * largura), x1: Math.round((xmax / 1000) * largura), y0: Math.round((ymin / 1000) * altura), y1: Math.round((ymax / 1000) * altura) };
    const tipo = e.tipo === 'assinatura' ? 'assinatura' : 'texto';
    const folga = Math.round(Math.max(vb.y1 - vb.y0, 10) * 0.4);
    // Caixa justa: os trechos da OCR cujo centro cai dentro da caixa da IA.
    const ocr = trechos.filter((t) => dentro(centro(t), vb, folga));
    const caixa = ocr.length && tipo === 'texto' ? { x0: Math.min(...ocr.map((t) => t.x0)), x1: Math.max(...ocr.map((t) => t.x1)), y0: Math.min(...ocr.map((t) => t.y0)), y1: Math.max(...ocr.map((t) => t.y1)) } : vb;
    const altura_linha = ocr.length ? Math.round(ocr.reduce((a, t) => a + (t.altura_linha || t.y1 - t.y0), 0) / ocr.length) : Math.max(12, Math.round((vb.y1 - vb.y0) / Math.max(1, Math.round((vb.y1 - vb.y0) / 60))));
    const original = limpa(e.original); const traducao = limpa(e.traducao);
    if (tipo === 'assinatura') {
      const pad = Math.round(Math.max(vb.y1 - vb.y0, vb.x1 - vb.x0) * 0.06) + 4; // folga para a caixa da IA; trocaTexto encolhe até a tinta
      out.push({ ...vb, x0: vb.x0 - pad, x1: vb.x1 + pad, y0: vb.y0 - pad, y1: vb.y1 + pad, altura_linha, texto: original || '(assinatura)', apagar: true, confianca: 100 });
      continue;
    }
    if (!original || !traducao || traducao.toLowerCase() === original.toLowerCase()) continue;
    out.push({ ...caixa, altura_linha, n_linhas: Math.max(1, ocr.length), texto: original, novo: traducao, confianca: 100, visao: true });
  }
  return out;
}

module.exports = { disponivel, chamar, blocosDaVisao, SISTEMA, MODELOS };
