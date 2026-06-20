// ── Carrosséis virais ─────────────────────────────────────────────────────────
// Busca carrosséis que viralizaram no Instagram (inspiração) e GERA carrosséis
// originais prontos para postar: a IA escreve o conteúdo de cada tela no estilo
// viral/conexão em PT-BR e o backend renderiza cada slide como imagem 1080x1350.
require('../fontSetup');
const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
const { OpenAI } = require('openai');

const router = express.Router();
let _openai = null;
const getOpenAI = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// ── Layout ────────────────────────────────────────────────────────────────────
const CW = 1080;            // largura do slide
const CH = 1350;            // altura (proporção 4:5 — ideal para carrossel IG)
const PAD = 90;
const FONT_FAMILY = "'DejaVu Sans', sans-serif"; // registrada via backend/fontSetup.js

// Paleta on-brand (escuro, igual ao app)
const C = {
  bgTop:  '#0b1020',
  bgBot:  '#1b2138',
  accent: '#6366f1',
  accLt:  '#818cf8',
  white:  '#ffffff',
  muted:  '#aab2c5',
};

// ── Helpers de texto ──────────────────────────────────────────────────────────
function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Ajusta o tamanho da fonte até o texto caber na caixa (largura x altura)
function fitText(text, { maxFont, minFont, boxW, boxH, charRatio = 0.56, lineRatio = 1.22 }) {
  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 2) {
    const maxChars = Math.max(6, Math.floor(boxW / (fontSize * charRatio)));
    const lines = wrapText(text, maxChars);
    const lineH = fontSize * lineRatio;
    if (lines.length * lineH <= boxH) return { fontSize, lines, lineH };
  }
  const maxChars = Math.max(6, Math.floor(boxW / (minFont * charRatio)));
  return { fontSize: minFont, lines: wrapText(text, maxChars), lineH: minFont * lineRatio };
}

function textBlock(lines, { x, startY, lineH, fontSize, fill, weight = 'bold', anchor = 'start', spacing = 0 }) {
  return lines.map((ln, i) =>
    `<text x="${x}" y="${startY + i * lineH}" font-family="${FONT_FAMILY}" font-size="${fontSize}" ` +
    `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"` +
    `${spacing ? ` letter-spacing="${spacing}"` : ''}>${escXml(ln)}</text>`
  ).join('');
}

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgTop}"/>
      <stop offset="1" stop-color="${C.bgBot}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.65">
      <stop offset="0" stop-color="${C.accent}" stop-opacity="0.40"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cta" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>`;

// ── Renderizadores de slide ───────────────────────────────────────────────────
async function renderCover(slide, total, handle) {
  const hook = fitText(slide.title || 'Você precisa ver isso', {
    maxFont: 104, minFont: 54, boxW: CW - 2 * PAD, boxH: 640,
  });
  const blockH = hook.lines.length * hook.lineH;
  const startY = (CH - blockH) / 2 - 20 + hook.fontSize * 0.8;

  const sub = (slide.subtitle || '').trim();
  const subEls = sub
    ? textBlock(wrapText(sub, 40), {
        x: CW / 2, startY: startY + blockH + 24, lineH: 46, fontSize: 38,
        fill: C.muted, weight: 'normal', anchor: 'middle',
      })
    : '';

  const pillText = 'ARRASTA PARA O LADO  →';
  const pillW = pillText.length * 19 + 70;
  const pillX = (CW - pillW) / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    ${DEFS}
    <rect width="${CW}" height="${CH}" fill="url(#bg)"/>
    <rect width="${CW}" height="${CH}" fill="url(#glow)"/>
    <text x="${PAD}" y="110" font-family="${FONT_FAMILY}" font-size="36" font-weight="bold" fill="${C.accLt}">${escXml(handle)}</text>
    <rect x="${PAD}" y="134" width="130" height="9" rx="4" fill="${C.accent}"/>
    ${textBlock(hook.lines, { x: CW / 2, startY, lineH: hook.lineH, fontSize: hook.fontSize, fill: C.white, anchor: 'middle' })}
    ${subEls}
    <rect x="${pillX}" y="1208" width="${pillW}" height="68" rx="34" fill="${C.accent}"/>
    <text x="${CW / 2}" y="1252" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="${C.white}" text-anchor="middle" letter-spacing="1">${escXml(pillText)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderContent(slide, idx, total, handle) {
  const num = String(slide.number || idx).padStart(2, '0');
  const title = fitText(slide.title || '', {
    maxFont: 64, minFont: 40, boxW: CW - 2 * PAD, boxH: 230,
  });
  const titleStartY = 360 + title.fontSize;
  const titleBlockH = title.lines.length * title.lineH;

  const body = fitText(slide.body || '', {
    maxFont: 46, minFont: 30, boxW: CW - 2 * PAD, boxH: 560, lineRatio: 1.35,
  });
  const bodyStartY = titleStartY + titleBlockH + 40 + body.fontSize;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    ${DEFS}
    <rect width="${CW}" height="${CH}" fill="url(#bg)"/>
    <rect x="${PAD}" y="150" width="${CW - 2 * PAD}" height="6" rx="3" fill="${C.accent}" opacity="0.5"/>
    <text x="${PAD}" y="290" font-family="${FONT_FAMILY}" font-size="150" font-weight="bold" fill="${C.accent}" opacity="0.30">${num}</text>
    ${textBlock(title.lines, { x: PAD, startY: titleStartY, lineH: title.lineH, fontSize: title.fontSize, fill: C.white })}
    ${textBlock(body.lines, { x: PAD, startY: bodyStartY, lineH: body.lineH, fontSize: body.fontSize, fill: C.muted, weight: 'normal' })}
    <text x="${PAD}" y="1290" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="${C.accLt}">${escXml(handle)}</text>
    <text x="${CW - PAD}" y="1290" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="${C.muted}" text-anchor="end">${idx}/${total}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderCta(slide, handle) {
  const title = fitText(slide.title || 'Gostou disso?', {
    maxFont: 92, minFont: 52, boxW: CW - 2 * PAD, boxH: 320,
  });
  const titleStartY = 430 + title.fontSize * 0.8;
  const titleBlockH = title.lines.length * title.lineH;

  const body = (slide.body || 'Toca em seguir, salva esse carrossel e compartilha com alguém.').trim();
  const bodyFit = fitText(body, { maxFont: 46, minFont: 32, boxW: CW - 2 * PAD, boxH: 260, lineRatio: 1.35 });
  const bodyStartY = titleStartY + titleBlockH + 50 + bodyFit.fontSize;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    ${DEFS}
    <rect width="${CW}" height="${CH}" fill="url(#cta)"/>
    ${textBlock(title.lines, { x: CW / 2, startY: titleStartY, lineH: title.lineH, fontSize: title.fontSize, fill: C.white, anchor: 'middle' })}
    ${textBlock(bodyFit.lines, { x: CW / 2, startY: bodyStartY, lineH: bodyFit.lineH, fontSize: bodyFit.fontSize, fill: '#e6e8ff', weight: 'normal', anchor: 'middle' })}
    <rect x="${CW / 2 - 320}" y="1120" width="640" height="84" rx="42" fill="#ffffff"/>
    <text x="${CW / 2}" y="1174" font-family="${FONT_FAMILY}" font-size="40" font-weight="bold" fill="#4f46e5" text-anchor="middle">${escXml(handle)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderSlide(slide, idx, total, handle) {
  if (slide.kind === 'cover') return renderCover(slide, total, handle);
  if (slide.kind === 'cta')   return renderCta(slide, handle);
  return renderContent(slide, idx, total, handle);
}

// ── IG API (instagram120) ─────────────────────────────────────────────────────
const IG120_HOST = 'instagram120.p.rapidapi.com';
const IG120_KEY  = process.env.RAPIDAPI_KEY_IG120 || process.env.RAPIDAPI_KEY;
const ig120Headers = () => ({
  'Content-Type': 'application/json',
  'x-rapidapi-host': IG120_HOST,
  'x-rapidapi-key': IG120_KEY,
});

// Contas conhecidas por carrosséis educativos/curiosos que viralizam
const CAROUSEL_SEEDS = {
  ciencia:      ['natgeo', 'sciencefacts', 'newscientist', 'smithsonian'],
  tecnologia:   ['interestingengineering', 'futurism', 'techinsider', 'wired'],
  historia:     ['history', 'smithsonian', 'historyinpics', 'natgeo'],
  espaco:       ['nasa', 'astronomyfeed', 'universetoday', 'hubbletelescope'],
  china:        ['interestingengineering', 'cgtn', 'futurism'],
  engenharia:   ['interestingengineering', 'engineeringexplained', 'futurism'],
  curiosidades: ['factsdaily', 'didyouknowpage', 'natgeo', 'bbcearth'],
  invencoes:    ['interestingengineering', 'futurism', 'techinsider'],
};

const CAROUSEL_HASHTABS = {
  ciencia:      ['sciencefacts', 'didyouknow'],
  tecnologia:   ['technology', 'futuretech'],
  historia:     ['historyfacts', 'historylovers'],
  espaco:       ['spacefacts', 'astronomy'],
  china:        ['chinatechnology', 'megaproject'],
  engenharia:   ['engineering', 'amazingengineering'],
  curiosidades: ['amazingfacts', 'factsdaily'],
  invencoes:    ['invention', 'cooltech'],
};

// Extrai dados de um node de post se ele for carrossel (sidecar / múltiplas mídias)
function parseCarouselNode(n, fallbackUser) {
  if (!n) return null;
  const children =
    n.carousel_media ||
    n.edge_sidecar_to_children?.edges ||
    null;
  const slideCount =
    (Array.isArray(n.carousel_media) ? n.carousel_media.length : 0) ||
    n.carousel_media_count ||
    n.edge_sidecar_to_children?.edges?.length ||
    0;

  const isCarousel = n.media_type === 8 || n.__typename === 'GraphSidecar' ||
    !!children || slideCount > 1;
  if (!isCarousel) return null;

  const cap = n.caption || n.edge_media_to_caption?.edges?.[0]?.node || {};
  const caption = typeof cap === 'object' ? (cap.text || '') : String(cap || '');

  const cover =
    n.image_versions2?.candidates?.[0]?.url ||
    n.display_url ||
    n.thumbnail_src ||
    (Array.isArray(n.carousel_media) ? n.carousel_media[0]?.image_versions2?.candidates?.[0]?.url : '') ||
    '';

  const likes =
    n.like_count ?? n.edge_media_preview_like?.count ?? n.edge_liked_by?.count ?? 0;
  const comments =
    n.comment_count ?? n.edge_media_to_comment?.count ?? 0;

  return {
    code:           n.code || n.shortcode || '',
    caption,
    cover,
    slideCount:     slideCount || 2,
    likes,
    comments,
    takenAt:        n.taken_at || n.taken_at_timestamp || 0,
    sourceUsername: n.user?.username || n.owner?.username || fallbackUser || '',
  };
}

async function fetchAccountCarousels(username) {
  const { data } = await axios.post(
    `https://${IG120_HOST}/api/instagram/posts`,
    { username, maxId: '' },
    { headers: ig120Headers(), timeout: 20000 }
  );
  const edges = data?.result?.edges || data?.edges || [];
  const out = [];
  for (const e of edges) {
    const parsed = parseCarouselNode(e.node || e, username);
    if (parsed && parsed.code) out.push(parsed);
  }
  return out;
}

async function fetchHashtagCarousels(hashtag) {
  const { data } = await axios.get(
    `https://${IG120_HOST}/api/instagram/explore_tag`,
    { params: { hashtag, maxId: '' }, headers: ig120Headers(), timeout: 20000 }
  );
  const sections = data?.result?.sections || data?.sections || [];
  const out = [];
  for (const sec of sections) {
    const medias = sec?.layout_content?.medias || sec?.medias || [];
    for (const m of medias) {
      const parsed = parseCarouselNode(m?.media || m, '');
      if (parsed && parsed.code) out.push(parsed);
    }
  }
  return out;
}

// ── Geração de conteúdo (GPT) ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é especialista em CARROSSÉIS virais do Instagram para o perfil @pedro_destrava (nicho ciência, tecnologia, história, espaço e curiosidades — público amplo brasileiro).

Crie um carrossel completo e ORIGINAL pronto para postar. Regras:
- TUDO em português do Brasil.
- Linguagem SIMPLES e popular: qualquer pessoa entende. Frases curtas. Sem jargão técnico ou acadêmico.
- UMA ideia por tela. Texto escaneável (a pessoa lê em 2 segundos).
- A primeira tela (capa) é um GANCHO forte de curiosidade/choque que faz a pessoa parar e arrastar. Sem clickbait mentiroso.
- Telas de conteúdo: título curto e impactante + 1-2 frases de explicação. Fatos surpreendentes e verdadeiros.
- A última tela é CTA: pede pra seguir, salvar e compartilhar.
- NÃO use emojis dentro dos slides (title/body/subtitle) — eles não renderizam. Emojis SÓ na caption.

Responda APENAS um JSON neste formato exato:
{
  "topic": "tema do carrossel em 1 frase",
  "slides": [
    { "kind": "cover", "title": "gancho forte (máx 9 palavras)", "subtitle": "linha curta de apoio (opcional)" },
    { "kind": "content", "number": "01", "title": "título da tela", "body": "1-2 frases simples" },
    { "kind": "content", "number": "02", "title": "...", "body": "..." },
    { "kind": "cta", "title": "Gostou disso?", "body": "Segue @pedro_destrava, salva e compartilha" }
  ],
  "caption": "legenda completa pra postar: 1ª linha com gancho + emoji, 2-3 parágrafos curtos, e 3 a 5 hashtags em português no fim"
}`;

async function generateCarouselContent({ theme, topic, reference, slideCount = 7, handle }) {
  const n = Math.max(5, Math.min(10, Number(slideCount) || 7));
  const contentSlides = n - 2; // capa + cta fixos

  let brief = '';
  if (topic && topic.trim()) {
    brief = `Tema pedido pelo usuário: "${topic.trim()}".`;
  } else if (reference && reference.trim()) {
    brief = `Inspire-se NO TEMA deste carrossel que viralizou (NÃO copie o texto, crie original sobre o mesmo assunto):\n"${reference.slice(0, 500)}"`;
  } else if (theme) {
    brief = `Tema/categoria: ${theme}. Escolha um assunto específico e surpreendente dentro dessa categoria.`;
  } else {
    brief = 'Escolha um assunto surpreendente de ciência, tecnologia ou curiosidades.';
  }

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    max_tokens: 1600,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT.replace(/@pedro_destrava/g, handle) },
      { role: 'user', content: `${brief}\n\nGere EXATAMENTE ${n} telas no total: 1 capa + ${contentSlides} telas de conteúdo + 1 CTA. Numere as telas de conteúdo a partir de "01".` },
    ],
  });

  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  let slides = Array.isArray(parsed.slides) ? parsed.slides : [];

  // Saneamento: garante capa na 1ª, cta na última, números nas de conteúdo
  if (!slides.length) throw new Error('IA não retornou telas');
  if (slides[0].kind !== 'cover') slides[0] = { ...slides[0], kind: 'cover' };
  if (slides[slides.length - 1].kind !== 'cta') {
    slides.push({ kind: 'cta', title: 'Gostou disso?', body: `Segue ${handle}, salva e compartilha` });
  }
  let cn = 0;
  slides = slides.map(s => {
    if (s.kind === 'content') { cn += 1; return { ...s, number: String(cn).padStart(2, '0') }; }
    return s;
  });

  return { topic: parsed.topic || topic || theme || '', caption: parsed.caption || '', slides };
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

// POST /api/carousels/search — encontra carrosséis virais (inspiração)
router.post('/search', async (req, res) => {
  const { themes, minLikes } = req.body || {};
  if (!Array.isArray(themes) || themes.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos um tema' });
  }
  if (!IG120_KEY) return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });

  const minL = Number(minLikes) || 20000;
  try {
    const accounts = [...new Set(themes.flatMap(t => CAROUSEL_SEEDS[t] || []))]
      .sort(() => Math.random() - 0.5).slice(0, 5);
    const hashtags = [...new Set(themes.flatMap(t => CAROUSEL_HASHTABS[t] || []))]
      .sort(() => Math.random() - 0.5).slice(0, 3);

    const tasks = [
      ...accounts.map(u => fetchAccountCarousels(u).catch(e => { console.warn(`[carousel] @${u}: ${e.message}`); return []; })),
      ...hashtags.map(h => fetchHashtagCarousels(h).catch(e => { console.warn(`[carousel] #${h}: ${e.message}`); return []; })),
    ];
    const settled = await Promise.all(tasks);
    const all = settled.flat();

    const seen = new Set();
    const results = all
      .filter(c => c.code && !seen.has(c.code) && seen.add(c.code))
      .filter(c => c.likes >= minL)
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 12)
      .map(c => ({
        url:            `https://www.instagram.com/p/${c.code}/`,
        cover:          c.cover ? `/api/carousels/cover?url=${encodeURIComponent(c.cover)}` : null,
        caption:        c.caption.slice(0, 280),
        slideCount:     c.slideCount,
        likes:          c.likes,
        comments:       c.comments,
        sourceUsername: c.sourceUsername,
      }));

    res.json({ results });
  } catch (e) {
    console.error('[carousels] search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/carousels/cover?url=... — proxy da imagem de capa (IG bloqueia hotlink)
router.get('/cover', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' },
    });
    res.setHeader('Content-Type', resp.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(resp.data));
  } catch (e) {
    res.status(404).end();
  }
});

// POST /api/carousels/generate — gera um carrossel pronto para postar
router.post('/generate', async (req, res) => {
  const { theme, topic, reference, slideCount, handle: rawHandle } = req.body || {};
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor' });
  }
  let handle = (rawHandle || '@pedro_destrava').trim();
  if (!handle.startsWith('@')) handle = '@' + handle;

  try {
    const { topic: finalTopic, caption, slides } =
      await generateCarouselContent({ theme, topic, reference, slideCount, handle });

    const total = slides.length;
    // Renderiza todas as telas em paralelo
    const buffers = await Promise.all(
      slides.map((s, i) => renderSlide(s, i + 1, total, handle))
    );

    const rendered = slides.map((s, i) => ({
      index: i + 1,
      kind:  s.kind,
      title: s.title || '',
      dataUrl: `data:image/png;base64,${buffers[i].toString('base64')}`,
    }));

    res.json({ topic: finalTopic, caption, handle, slides: rendered });
  } catch (e) {
    console.error('[carousels] generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
