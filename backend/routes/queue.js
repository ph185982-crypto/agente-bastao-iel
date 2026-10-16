// ── Fila semanal de conteúdo (esteira) ────────────────────────────────────────
// Sugere pautas, produz um item por chamada e guarda a fila quando há cofre.
// Não reimplementa nada: carrossel, content-finder e trending são chamados
// pelas próprias rotas (invokeRoute). O corte TV é produzido pelo front em
// duas chamadas ao video-editor (/analyze e /render), cada uma dentro dos
// 60s da Vercel; aqui ele só ganha legenda, hashtags e crédito.
const express = require('express');
const store = require('../lib/queueStore');
const { invokeRoute } = require('../lib/invokeRoute');
const { createCompatClient, hasLlmKey, friendlyErrorMessage } = require('../lib/llm');
const { PEDRO_DNA, LINGUAGEM_LEIGO, PROFILE_HANDLE } = require('../lib/pedroDna');
const core = require('../../static/esteiraCore');
const PB = require('../../static/viralPlaybook');
const insightsLib = require('../lib/profileInsights');

const router = express.Router();
let _llm = null;
const llm = () => (_llm ??= createCompatClient());

// Rotas carregadas sob demanda: o require delas é pesado (sharp, ffmpeg…).
const routes = {
  carousels: () => require('./carousels'),
  contentFinder: () => require('./contentFinder'),
  trending: () => require('./trending'),
};

const CAROUSEL_ENDPOINTS = {
  padrao: '/generate',
  arquivo: '/generate-arquivo',
  boas_noticias: '/generate-boasnoticias',
  comecou: '/generate-comecou',
  trending: '/generate-trending',
};

// ── Config ───────────────────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  res.json({ config: await store.getConfig(), storage: store.enabled() ? 'upstash' : 'local' });
});

router.put('/config', async (req, res) => {
  if (!store.enabled()) return res.status(501).json({ error: 'Sem armazenamento no servidor', storage: 'local' });
  const body = req.body || {};
  const patch = {};
  if (Array.isArray(body.pillars)) patch.pillars = body.pillars.map(String).filter(Boolean).slice(0, 12);
  if (Number.isFinite(Number(body.weekly_goal))) patch.weekly_goal = Math.min(21, Math.max(1, Number(body.weekly_goal)));
  if (Array.isArray(body.posting_days)) patch.posting_days = body.posting_days.map(Number).filter((d) => d >= 0 && d <= 6);
  if (Array.isArray(body.hidden_modules)) patch.hidden_modules = body.hidden_modules.map(String);
  if (['viral', 'padrao'].includes(body.video_template)) patch.video_template = body.video_template;
  res.json({ config: await store.saveConfig(patch), storage: 'upstash' });
});

// ── Itens (só quando há cofre; sem ele o front guarda no aparelho) ───────────
function requireStore(req, res, next) {
  if (!store.enabled()) return res.status(501).json({ error: 'Sem armazenamento no servidor', storage: 'local' });
  next();
}

router.get('/week', requireStore, async (req, res) => {
  const start = core.weekStart(req.query.start || new Date());
  res.json({ week_start: start, items: await store.listWeek(start) });
});

router.post('/items', requireStore, async (req, res) => {
  const body = req.body || {};
  if (!body.title) return res.status(400).json({ error: 'Item sem título' });
  if (!core.FORMATS.includes(body.format)) return res.status(400).json({ error: 'Formato inválido' });
  res.json({ item: await store.createItem(body) });
});

router.patch('/items/:id', requireStore, async (req, res) => {
  const item = await store.updateItem(req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });
  res.json({ item });
});

router.delete('/items/:id', requireStore, async (req, res) => {
  res.json({ ok: await store.deleteItem(req.params.id) });
});

// ── Pautas ───────────────────────────────────────────────────────────────────
function themesForPillars(pillars) {
  const out = [];
  for (const p of pillars.map((x) => x.toLowerCase())) {
    if (/neg[oó]c|vend/.test(p)) out.push('negocios', 'vendas');
    if (/marketing|tr[aá]fego/.test(p)) out.push('marketing');
    if (/e-?commerce|marketplace|loja/.test(p)) out.push('empreendedorismo');
    if (/financ|dinheiro|econom/.test(p)) out.push('financeiro');
  }
  const uniq = [...new Set(out)];
  // Duas por busca (cabe no tempo); gira conforme o dia pra variar.
  const day = Math.floor(Date.now() / 86400000);
  return uniq.length <= 2 ? uniq : [uniq[day % uniq.length], uniq[(day + 1) % uniq.length]];
}

const firstLine = (s, max = 110) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, max) || '';

async function trendingCandidates() {
  try {
    const data = await invokeRoute(routes.trending(), 'GET', '/feed', {}, { timeoutMs: 8000 });
    return (data.topics || []).slice(0, 10).map((t) => ({
      kind: 'tema',
      title: t.title,
      summary: t.description || t.carouselAngle || '',
      angle: t.carouselAngle || '',
      source_name: 'Tendências',
      source_url: '',
      potential: Math.min(100, (Number(t.engagementPotential) || 6) * 10),
    }));
  } catch (e) {
    console.warn('[queue/suggest] trending indisponível:', e.message);
    return [];
  }
}

async function videoCandidates(themes) {
  if (!themes.length || !process.env.RAPIDAPI_KEY) return [];
  try {
    const data = await invokeRoute(
      routes.contentFinder(), 'POST', '/search',
      { themes, minViews: 50000, lang: 'pt' },
      { timeoutMs: 32000 },
    );
    const max = Math.max(1, ...(data.results || []).map((r) => Number(r.viral_score) || 0));
    return (data.results || []).slice(0, 12).map((r) => ({
      kind: 'video',
      title: firstLine(r.originalCaption) || `Vídeo de @${r.sourceUsername}`,
      summary: String(r.originalCaption || '').replace(/\s+/g, ' ').slice(0, 220),
      source_name: r.sourceUsername ? `@${r.sourceUsername}` : 'Instagram',
      source_url: r.url,
      video_url: r.url,
      views: r.views || null,
      potential: Math.round(((Number(r.viral_score) || 0) / max) * 100),
    }));
  } catch (e) {
    console.warn('[queue/suggest] content-finder indisponível:', e.message);
    return [];
  }
}

function pillarFor(text, pillars) {
  const t = text.toLowerCase();
  const rules = [
    [/vend|neg[oó]c|empres|cliente|lucro/, /neg[oó]c|vend/],
    [/marketing|an[uú]ncio|tr[aá]fego|marca|instagram/, /marketing|tr[aá]fego/],
    [/loja|shopee|mercado livre|e-?commerce|amazon|marketplace/, /e-?commerce|marketplace/],
    [/recorde|conquista|brasil|aprovad|cresce/, /boas not/],
  ];
  for (const [re, pRe] of rules) {
    if (re.test(t)) {
      const p = pillars.find((x) => pRe.test(x.toLowerCase()));
      if (p) return p;
    }
  }
  return pillars.find((x) => /curios/.test(x.toLowerCase())) || pillars[0] || '';
}

// Sem IA: candidatos ranqueados + uma pauta de roteiro por pilar que ficou
// de fora, pra semana não sair só com um pilar e só um formato.
function heuristicPautas(candidates, pillars) {
  const ranked = candidates
    .map((c) => {
      const pillar = pillarFor(`${c.title} ${c.summary}`, pillars);
      const f = core.suggestFormat({ ...c, pillar });
      return { ...c, pillar, score: c.potential || 50, ...f };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);
  const covered = new Set(ranked.map((p) => p.pillar));
  const extras = pillars
    .filter((p) => !covered.has(p))
    .map((p) => {
      const base = { pillar: p, score: 55, source_name: 'Sugestão da IA', source_url: '', video_url: '' };
      if (/boas not/i.test(p)) {
        return { ...base, title: 'As boas notícias do Brasil desta semana', summary: 'Carrossel com conquistas e avanços recentes do país.', format: 'carrossel', carousel_type: 'boas_noticias' };
      }
      if (/curios/i.test(p)) {
        return { ...base, title: 'Segredos que quase ninguém sabe sobre marcas famosas', summary: 'Carrossel de fatos surpreendentes com lição de negócio.', format: 'carrossel', carousel_type: 'arquivo' };
      }
      return {
        ...base,
        title: `A estratégia que ninguém percebe em ${p.split(' e ')[0]}`,
        summary: `Explicar, falando pra câmera, um caso real de ${p} e a lição prática.`,
        format: 'roteiro', carousel_type: null,
      };
    });
  return [...ranked, ...extras].slice(0, 10);
}

// IA tende a devolver sempre "padrao"; a regra fixa corrige quando o tema
// pede um tipo específico (boas notícias, segredo, lançamento).
const tipoValido = (t) => !!(CAROUSEL_ENDPOINTS[t] || PB.TEMPLATES[t]);
function escolherTipoCarrossel(p) {
  const pedido = tipoValido(p.carousel_type) ? p.carousel_type : 'padrao';
  if (pedido !== 'padrao') return pedido;
  return core.suggestFormat({ title: p.title, summary: p.summary, pillar: p.pillar }).carousel_type || 'padrao';
}

async function llmPautas(candidates, pillars, performance, insights) {
  const lista = candidates.map((c, i) => `${i}. [${c.kind}] ${c.title} — ${c.summary.slice(0, 160)} (fonte: ${c.source_name}${c.views ? `, ${c.views} views` : ''})`).join('\n');
  const perf = performance
    ? `\nDESEMPENHO RECENTE (use pra priorizar): melhores formatos ${performance.formatos?.map((f) => f.chave).join(', ')}; melhores pilares ${performance.pilares?.map((p) => p.chave).join(', ')}.`
    : '';
  const ai = await llm().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.6,
    response_format: { type: 'json_object' },
    max_tokens: 2200,
    messages: [{
      role: 'user',
      content: `${PEDRO_DNA}\n\n${PB.resumoParaPrompt()}\n\n${insightsLib.insightsParaPrompt(insights)}\n\nPILARES DE CONTEÚDO: ${pillars.join('; ')}.${perf}

CANDIDATOS (temas em alta e vídeos virais de terceiros):
${lista || '(nenhum — crie pautas próprias a partir dos pilares)'}

Monte 10 pautas para a semana do @pedro_destrava, pensando como arquiteto de conteúdo viral: cada pauta precisa de um MECANISMO de viralização claro (número que choca, contradição, história humana, lista de casos reais). Cubra pelo menos 3 pilares. Pode adaptar um candidato ao pilar ou criar pauta nova.
Na semana, busque esta mistura: ${PB.MIX_SEMANAL.join(', ')}.
Formato:
- "carrossel" (post estático). carousel_type PREFERIDO entre os modelos virais: antes_agora (comparação com número), print (frase que contraria o senso comum), noticia (história humana real), lista (casos reais numerados). Use padrao/arquivo/boas_noticias/comecou/trending só se nenhum viral servir.
- "corte_tv": SÓ quando a pauta vem de um candidato [video] (use source_ref).
- "roteiro": pautas que pedem a cara do Pedro falando (opinião, explicação de estratégia).
Título = o gancho do post (curto, com número ou contradição, sem clichê). Resumo de 1 linha com o ângulo. "mecanismo": em 6 palavras, por que vai ser enviado/salvo. score 0-100 = potencial de alcance, seja exigente.

Responda APENAS JSON: {"pautas":[{"title":"","summary":"","pillar":"","score":0,"format":"carrossel","carousel_type":"antes_agora","mecanismo":"","source_ref":null}]}`,
    }],
  });
  const data = JSON.parse(ai.choices[0].message.content || '{}');
  return (data.pautas || []).slice(0, 10).map((p) => {
    const ref = Number.isInteger(p.source_ref) ? candidates[p.source_ref] : null;
    let format = core.FORMATS.includes(p.format) ? p.format : 'carrossel';
    if (format === 'corte_tv' && !ref?.video_url) format = 'carrossel';
    return {
      title: String(p.title || ref?.title || '').slice(0, 140),
      summary: String(p.summary || ref?.summary || '').slice(0, 240),
      pillar: p.pillar || pillarFor(p.title || '', pillars),
      score: Math.max(0, Math.min(100, Number(p.score) || 50)),
      format,
      carousel_type: format === 'carrossel' ? escolherTipoCarrossel(p) : null,
      mecanismo: String(p.mecanismo || '').slice(0, 80),
      source_name: ref?.source_name || 'Sugestão da IA',
      source_url: ref?.source_url || '',
      video_url: format === 'corte_tv' ? ref.video_url : '',
    };
  }).filter((p) => p.title);
}

router.post('/suggest', async (req, res) => {
  try {
    const cfg = await store.getConfig();
    const pillars = Array.isArray(req.body?.pillars) && req.body.pillars.length ? req.body.pillars : cfg.pillars;
    const exclude = new Set((req.body?.exclude_titles || []).map((t) => String(t).toLowerCase()));
    const [temas, videos] = await Promise.all([trendingCandidates(), videoCandidates(themesForPillars(pillars))]);
    const candidates = [...videos, ...temas].filter((c) => !exclude.has(String(c.title).toLowerCase()));

    let pautas;
    let fonte = 'ia';
    if (hasLlmKey()) {
      try {
        pautas = await llmPautas(candidates, pillars, req.body?.performance || null, req.body?.insights || insightsLib.lastInsights());
      } catch (e) {
        console.warn('[queue/suggest] IA falhou, usando regra fixa:', e.message?.slice(0, 120));
      }
    }
    if (!pautas?.length) {
      pautas = heuristicPautas(candidates, pillars);
      fonte = 'regra';
    }
    pautas = pautas
      .filter((p) => !exclude.has(p.title.toLowerCase()))
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ id: `pauta-${Date.now()}-${i}`, ...p }));

    res.json({ pautas, fonte, fontes: { temas: temas.length, videos: videos.length } });
  } catch (e) {
    console.error('[queue/suggest]', e.message);
    res.status(500).json({ error: friendlyErrorMessage(e) });
  }
});

// ── Leitura do perfil ───────────────────────────────────────────────────────
// Gasta 2 chamadas da cota grátis (150/mês); o front só pede de 3 em 3 dias
// ou quando o Pedro toca em "Ler meu perfil agora".
router.get('/insights', async (req, res) => {
  try {
    res.json(await insightsLib.getInsights({ force: req.query.force === '1' }));
  } catch (e) {
    console.error('[queue/insights]', e.message);
    res.status(502).json({ error: `Não consegui ler o perfil agora: ${e.message}` });
  }
});

// ── Legenda, hashtags e crédito ──────────────────────────────────────────────
const PILLAR_TAGS = [
  [/neg[oó]c|vend/, ['#negocios', '#vendas', '#empreendedorismo']],
  [/marketing|tr[aá]fego/, ['#marketingdigital', '#trafegopago', '#marketing']],
  [/e-?commerce|marketplace/, ['#ecommerce', '#marketplace', '#vendasonline']],
  [/curios/, ['#curiosidades', '#voceSabia', '#fatos']],
  [/boas not/, ['#boasnoticias', '#brasil', '#noticias']],
];

// Quebra parágrafos longos em linhas curtas — legenda é lida no celular.
function formatForMobile(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((par) => {
      const p = par.replace(/\s*\n\s*/g, ' ').trim();
      if (p.length <= 180) return p;
      return p.split(/(?<=[.!?])\s+/).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

const isThirdParty = (item) => {
  const src = String(item.source_name || '').toLowerCase();
  if (!src || src === 'sugestão da ia' || src === 'tendências') return false;
  return !src.includes(String(PROFILE_HANDLE).replace('@', '').toLowerCase());
};

function buildCaptionPack(item, rawCaption) {
  const raw = String(rawCaption || '');
  const found = raw.match(/#[\p{L}\p{N}_]+/gu) || [];
  const body = formatForMobile(raw.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+\n/g, '\n'));
  const pillarTags = (PILLAR_TAGS.find(([re]) => re.test(String(item.pillar || '').toLowerCase())) || [null, []])[1];
  // #negócios e #negocios contam como a mesma; fica a primeira que apareceu.
  const semAcento = (h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const vistos = new Set();
  const hashtags = [...found, ...pillarTags]
    .map((h) => h.toLowerCase())
    .filter((h) => !vistos.has(semAcento(h)) && vistos.add(semAcento(h)))
    .slice(0, 3); // líderes usam 0 a 3; hashtag quase não distribui mais
  const thirdParty = isThirdParty(item);
  const source_credit = thirdParty ? `Fonte: ${item.source_name}` : '';
  // Sem pedido de ação, o post perde o sinal mais forte (envio por DM).
  const temCta = /\b(manda|envia|compartilha|marca|comenta|salva)\b/i.test(body);
  const corpo = temCta ? body : [body || item.title, PB.CTAS.envio].join('\n\n');
  const caption = [corpo, source_credit, hashtags.join(' ')].filter(Boolean).join('\n\n');
  return { caption, hashtags, source_credit, third_party: thirdParty && item.format === 'corte_tv' };
}

router.post('/caption', (req, res) => {
  const { item, caption } = req.body || {};
  if (!item) return res.status(400).json({ error: 'Item ausente' });
  res.json(buildCaptionPack(item, caption || item.summary || item.title));
});

// ── Roteiro para gravar ──────────────────────────────────────────────────────
function roteiroRobo(item) {
  const tema = item.title;
  return {
    hook: `Quase ninguém percebe isso: ${tema}.`,
    blocos: [
      item.summary || 'Hoje eu vou te mostrar o que está por trás disso.',
      'Olha o que acontece na prática.',
      'E o que isso ensina pra quem tem um negócio:',
      'presta atenção no detalhe que todo mundo ignora.',
    ],
    cta: 'Segue o @pedro_destrava pra ver a estratégia por trás das coisas.',
    caption: `${tema}\n\n${item.summary || ''}\n\nSalva pra lembrar depois.`,
  };
}

async function gerarRoteiro(item) {
  if (!hasLlmKey()) return { ...roteiroRobo(item), fonte: 'robo' };
  try {
    const ai = await llm().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `${PEDRO_DNA}\n\n${LINGUAGEM_LEIGO}\n\nEscreva um roteiro curto (30 a 45 segundos) para o Pedro gravar falando para a câmera, lido em teleprompter.
Tema: ${item.title}
Contexto: ${item.summary || ''}
Pilar: ${item.pillar || ''}

Regras: hook que prende nos 3 primeiros segundos; desenvolvimento em blocos de UMA frase curta cada (máx. 7 blocos); CTA final. Fatos verificáveis, sem inventar número. Sem emoji.
Também escreva a legenda do post (2 parágrafos curtos, até 4 hashtags no fim).

Responda APENAS JSON: {"hook":"","blocos":[""],"cta":"","caption":""}`,
      }],
    });
    const raw = ai.choices[0].message.content || '{}';
    const d = JSON.parse(raw);
    // Modelos variam: blocos às vezes vem como texto corrido ou em outra chave.
    let blocos = d.blocos || d.desenvolvimento || d.blocks;
    if (typeof blocos === 'string') blocos = blocos.split(/\n+/);
    blocos = Array.isArray(blocos) ? blocos.map((b) => String(b).trim()).filter(Boolean) : [];
    d.hook = d.hook || d.gancho;
    d.blocos = blocos;
    if (!d.hook || !blocos.length) throw new Error(`roteiro incompleto: ${raw.slice(0, 160)}`);
    return { hook: d.hook, blocos: d.blocos.slice(0, 7), cta: d.cta || roteiroRobo(item).cta, caption: d.caption || '', fonte: 'ia' };
  } catch (e) {
    console.warn('[queue/roteiro] IA falhou, usando robô:', e.message?.slice(0, 120));
    return { ...roteiroRobo(item), fonte: 'robo-reserva' };
  }
}

const roteiroTexto = (r) => [`GANCHO (0-3s)\n${r.hook}`, `DESENVOLVIMENTO\n${r.blocos.join('\n')}`, `CTA\n${r.cta}`].join('\n\n');

// ── Produção de UM item por chamada ──────────────────────────────────────────
async function produceViral(item, insights) {
  const { escrever } = require('../lib/viralWriter');
  const { render } = require('../lib/viralRender');
  const r = await escrever(item, item.carousel_type, { insights, prazoMs: 32000 });
  const bufs = await render(r.template, r.conteudo);
  const assets = bufs.map((b, i) => ({ type: 'image', url: `data:image/png;base64,${b.toString('base64')}`, name: `${r.template}-${String(i + 1).padStart(2, '0')}.png` }));
  const pack = buildCaptionPack(item, r.conteudo.caption);
  const viral = r.nota ? { ...r.nota, checks: r.nota.checks } : null;
  if (viral) {
    // A nota final considera a legenda já ajustada (CTA e hashtags).
    const recalc = require('../lib/viralWriter').nota(r.template, { ...r.conteudo, caption: pack.caption });
    Object.assign(viral, recalc);
  }
  return {
    assets, ...pack, viral, template: r.template, fonte: r.fonte,
    fontes: r.conteudo.fontes || [], gancho: r.conteudo.gancho || '', ganchos: r.conteudo.ganchos || [],
  };
}

async function produce(item, insights) {
  if (item.format === 'carrossel' && PB.TEMPLATES[item.carousel_type]) return produceViral(item, insights);
  if (item.format === 'carrossel') {
    const path = CAROUSEL_ENDPOINTS[item.carousel_type] || CAROUSEL_ENDPOINTS.padrao;
    const data = await invokeRoute(routes.carousels(), 'POST', path, { topic: item.title, handle: PROFILE_HANDLE }, { timeoutMs: 55000 });
    const assets = (data.slides || []).map((s, i) => ({ type: 'image', url: s.dataUrl, name: `slide-${String(s.index || i + 1).padStart(2, '0')}.png` }));
    if (!assets.length) throw new Error('O carrossel voltou sem slides.');
    return { assets, ...buildCaptionPack(item, data.caption) };
  }
  if (item.format === 'roteiro') {
    const r = await gerarRoteiro(item);
    const pack = buildCaptionPack(item, r.caption || item.summary);
    return {
      assets: [{ type: 'text', name: 'roteiro.txt', text: roteiroTexto(r) }],
      roteiro: { hook: r.hook, blocos: r.blocos, cta: r.cta },
      ...pack,
      viral: PB.viralScore({ template: 'roteiro', hook: r.hook, slides: [...r.blocos, r.cta].map((t) => ({ texto: t })), caption: pack.caption }),
    };
  }
  if (item.format === 'corte_tv') {
    const e = new Error('Corte TV é produzido pelo app em duas etapas (video-editor).');
    e.status = 400;
    throw e;
  }
  const e = new Error('Formato inválido');
  e.status = 400;
  throw e;
}

async function handleProduce(req, res) {
  const item = req.body?.item;
  if (!item?.title || !item?.format) return res.status(400).json({ error: 'Item incompleto (título e formato)' });
  try {
    const result = await produce(item, req.body?.insights || null);
    if (store.enabled() && req.params.id) {
      await store.updateItem(req.params.id, {
        status: 'pronto', caption: result.caption, hashtags: result.hashtags,
        source_credit: result.source_credit, third_party: result.third_party,
      }).catch(() => null);
    }
    res.json(result);
  } catch (e) {
    console.error('[queue/produce]', item.format, e.message);
    res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.body?.error || (e.status === 400 || e.status === 504 ? e.message : friendlyErrorMessage(e)) });
  }
}

router.post('/produce', handleProduce);
router.post('/items/:id/produce', handleProduce);

module.exports = router;
module.exports._internals = { buildCaptionPack, formatForMobile, themesForPillars, heuristicPautas, pillarFor, roteiroRobo, roteiroTexto };
