// ── Carrosséis virais ─────────────────────────────────────────────────────────
// Busca carrosséis que viralizaram no Instagram (inspiração) e GERA carrosséis
// originais prontos para postar: a IA escreve o conteúdo de cada tela no estilo
// viral/conexão em PT-BR e o backend renderiza cada slide como imagem 1080x1350.
require('../fontSetup');
const express = require('express');
const axios   = require('axios');
const sharp   = require('sharp');
const fs      = require('fs');
const path    = require('path');
const { createCompatClient } = require('../lib/llm');

const router = express.Router();
let _llm = null;
const getOpenAI = () => (_llm ??= createCompatClient());

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

// Cria imagem circular com canal alpha (para overlay "moeda")
async function makeCircularImage(buf, diameter) {
  const d = Math.round(diameter);
  const r = Math.round(d / 2);
  const mask = Buffer.from(
    `<svg width="${d}" height="${d}"><circle cx="${r}" cy="${r}" r="${r - 1}" fill="white"/></svg>`
  );
  return sharp(buf)
    .resize(d, d, { fit: 'cover', position: 'center' })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ── Renderizadores de slide ───────────────────────────────────────────────────

// ── Cover viral: foto de fundo + overlay circular + gradiente + texto ─────────
async function renderViralCover({ slide, handle, bgBuf, circBuf }) {
  const HPAD  = 82;
  const textW = CW - HPAD * 2;
  const title = String(slide.title || 'VOCÊ PRECISA VER ISSO').toUpperCase();

  const fit = fitText(title, {
    maxFont: 100, minFont: 56, boxW: textW, boxH: 480,
    charRatio: 0.54, lineRatio: 1.22,
  });
  const blockH = fit.lines.length * fit.lineH;

  // CTA pill at bottom
  const pillH = 66;
  const pillW = Math.min(CW - 2 * HPAD, 630);
  const pillY = CH - 52 - pillH;

  // Headline block just above the pill
  const textStartY = pillY - 32 - blockH + fit.fontSize * 0.82;

  // Subtitle (optional, above headline)
  const sub = String(slide.subtitle || '').trim().toUpperCase();
  const subLines = sub ? wrapText(sub, 52) : [];
  const subEl = subLines.map((ln, i) =>
    `<text x="${CW / 2}" y="${textStartY - (subLines.length - i) * 40 - 18}" font-family="${FONT_FAMILY}" font-size="33" font-weight="normal" fill="rgba(255,255,255,0.76)" text-anchor="middle" letter-spacing="0.5">${escXml(ln)}</text>`
  ).join('');

  const textEls = fit.lines.map((ln, i) =>
    `<text x="${CW / 2}" y="${textStartY + i * fit.lineH}" font-family="${FONT_FAMILY}" font-size="${fit.fontSize}" font-weight="bold" fill="white" text-anchor="middle" stroke="black" stroke-width="8" paint-order="stroke" letter-spacing="1">${escXml(ln)}</text>`
  ).join('');

  const handleEl = handle
    ? `<text x="${HPAD}" y="80" font-family="${FONT_FAMILY}" font-size="34" font-weight="bold" fill="white" opacity="0.90">${escXml(handle)}</text>`
    : '';

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    <defs>
      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="black" stop-opacity="0.10"/>
        <stop offset="30%"  stop-color="black" stop-opacity="0"/>
        <stop offset="52%"  stop-color="black" stop-opacity="0.05"/>
        <stop offset="63%"  stop-color="black" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.97"/>
      </linearGradient>
    </defs>
    <rect width="${CW}" height="${CH}" fill="url(#grad)"/>
    ${handleEl}
    ${subEl}
    ${textEls}
    <rect x="${(CW - pillW) / 2}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>
    <text x="${CW / 2}" y="${pillY + pillH / 2 + 12}" font-family="${FONT_FAMILY}" font-size="28" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">APENAS ARRASTE PRO LADO  →</text>
  </svg>`;

  // Background
  let base;
  if (bgBuf) {
    base = await sharp(bgBuf)
      .resize(CW, CH, { fit: 'cover', position: 'center' })
      .toBuffer()
      .catch(() => sharp(Buffer.from(buildFallbackBg('default'))).png().toBuffer());
  } else {
    base = await sharp(Buffer.from(buildFallbackBg('default'))).png().toBuffer();
  }

  // Composites: circular photo overlay + gradient+text overlay
  const composites = [];

  if (circBuf) {
    try {
      const CIRC_D = 270;
      const BORDER = 10;
      const TOT    = CIRC_D + BORDER * 2;
      const circImg = await makeCircularImage(circBuf, CIRC_D);
      const borderSvg = Buffer.from(
        `<svg width="${TOT}" height="${TOT}"><circle cx="${TOT / 2}" cy="${TOT / 2}" r="${TOT / 2 - 3}" fill="none" stroke="white" stroke-width="${BORDER}"/></svg>`
      );
      const cLeft = CW - HPAD - CIRC_D - BORDER;
      const cTop  = 80;
      composites.push({ input: circImg,             top: cTop + BORDER, left: cLeft + BORDER });
      composites.push({ input: borderSvg,           top: cTop,          left: cLeft });
    } catch (e) {
      console.warn('[cover] circular img failed:', e.message);
    }
  }

  composites.push({ input: Buffer.from(overlaySvg), top: 0, left: 0 });

  return sharp(base).composite(composites).png().toBuffer();
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

async function renderSlide(slide, idx, total, handle, coverPhotos) {
  if (slide.kind === 'cover') {
    return renderViralCover({
      slide, handle,
      bgBuf:   (coverPhotos && coverPhotos[0]) || null,
      circBuf: (coverPhotos && coverPhotos[1]) || null,
    });
  }
  if (slide.kind === 'cta') return renderCta(slide, handle);
  return renderContent(slide, idx, total, handle);
}

// ── Pexels — fotos reais para slides ─────────────────────────────────────────
async function fetchPexelsPhoto(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const { data } = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 8, orientation: 'portrait', size: 'large' },
      headers: { Authorization: key },
      timeout: 10000,
    });
    const photos = data.photos || [];
    if (!photos.length) return null;
    const pick = photos[Math.floor(Math.random() * photos.length)];
    return pick.src.large2x || pick.src.large || pick.src.medium;
  } catch (e) {
    console.warn('[pexels]', e.message);
    return null;
  }
}

async function downloadPhotoBuffer(url, referer) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 12000,
    maxContentLength: 25 * 1024 * 1024,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
      ...(referer ? { Referer: referer } : {}),
    },
  });
  return Buffer.from(data);
}

// ── Serper.dev — Google Imagens sem billing ───────────────────────────────────
// Busca FOTOS REAIS do acontecimento. Requer SERPER_API_KEY (grátis em serper.dev).
async function fetchSerperImageUrls(query, want = 6) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const { data } = await axios.post('https://google.serper.dev/images',
      { q: query, num: Math.min(10, want), safe: 'active' },
      { headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    return (data.images || []).map(it => it.imageUrl).filter(Boolean);
  } catch (e) {
    console.warn('[serper-img]', e.response?.data?.message || e.message);
    return [];
  }
}

// ── Google Imagens (Programmable Search — requer billing no GCP) ─────────────
async function fetchGoogleImageUrls(query, want = 6) {
  const key = process.env.GOOGLE_API_KEY;
  const cx  = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return [];
  try {
    const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: { key, cx, q: query, searchType: 'image', num: Math.min(10, want), imgSize: 'huge', safe: 'active' },
      timeout: 10000,
    });
    return (data.items || []).map(it => it.link).filter(Boolean);
  } catch (e) {
    console.warn('[google-img]', e.response?.data?.error?.message || e.message);
    return [];
  }
}

// Valida uma URL: baixa e confirma que o sharp consegue decodificar a imagem.
async function tryLoadImage(url) {
  try {
    const raw = await downloadPhotoBuffer(url);
    const meta = await sharp(raw).metadata();
    if (!meta.width || meta.width < 400) return null; // descarta thumbs minúsculas
    return raw;
  } catch {
    return null;
  }
}

// Retorna até `n` buffers de imagem válidos a partir de uma lista de candidatas.
async function collectPhotoBuffers(candidateUrls, n) {
  const out = [];
  for (const u of candidateUrls) {
    if (out.length >= n) break;
    const buf = await tryLoadImage(u);
    if (buf) out.push(buf);
  }
  return out;
}

// Pega N fotos reais: tenta Serper → Google → Pexels → gradiente.
async function getStoryPhotos(query, pexelsFallback, n = 2) {
  // 1. Serper (Google Imagens, grátis sem billing)
  const serperUrls = await fetchSerperImageUrls(query, 8);
  let buffers = await collectPhotoBuffers(serperUrls, n);

  // 2. Google CSE (se configurado)
  if (buffers.length < n) {
    const googleUrls = await fetchGoogleImageUrls(query, 8);
    const more = await collectPhotoBuffers(googleUrls, n - buffers.length);
    buffers = buffers.concat(more);
  }

  // 3. Pexels (banco de imagens genérico)
  if (buffers.length < n) {
    const px = await fetchPexelsPhoto(pexelsFallback || query);
    if (px) {
      const more = await collectPhotoBuffers([px], n - buffers.length);
      buffers = buffers.concat(more);
    }
  }

  return buffers;
}

// Gradiente fallback por categoria (quando não há Pexels)
const CAT_COLORS = {
  medicina:   ['#0c2461', '#0e40af'],
  ciencia:    ['#1e1b4b', '#4338ca'],
  tecnologia: ['#0c4a6e', '#0284c7'],
  natureza:   ['#052e16', '#15803d'],
  humanidade: ['#4a1942', '#7c3aed'],
  espaco:     ['#1e0a3c', '#4c1d95'],
  default:    ['#0b1020', '#1b2138'],
};

function buildFallbackBg(category) {
  const [c1, c2] = CAT_COLORS[category || 'default'] || CAT_COLORS.default;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    <defs>
      <linearGradient id="fbg" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="${c1}"/>
        <stop offset="1" stop-color="${c2}"/>
      </linearGradient>
      <radialGradient id="fgw" cx="0.5" cy="0.35" r="0.6">
        <stop offset="0" stop-color="white" stop-opacity="0.06"/>
        <stop offset="1" stop-color="white" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${CW}" height="${CH}" fill="url(#fbg)"/>
    <rect width="${CW}" height="${CH}" fill="url(#fgw)"/>
  </svg>`;
}

async function buildPhotoBase(photoUrl, category) {
  if (photoUrl) {
    try {
      const raw = await downloadPhotoBuffer(photoUrl);
      return sharp(raw).resize(CW, CH, { fit: 'cover', position: 'center' }).toBuffer();
    } catch (e) {
      console.warn('[carousel] photo fail:', e.message);
    }
  }
  return sharp(Buffer.from(buildFallbackBg(category))).png().toBuffer();
}

// SVG overlay: gradiente escuro + texto em CAIXA ALTA (estilo @intrafocun)
function buildNewsOverlay({ headline, kind, counter, handle }) {
  const isCover = kind === 'cover';
  const isCta   = kind === 'cta';
  const HPAD    = isCover ? 108 : 80;   // mais margem na capa para não vazar
  const textW   = CW - HPAD * 2;

  const { fontSize, lines, lineH } = fitText(headline, {
    maxFont:   isCover ? 72 : 72,        // era 88 — letras maiúsculas com acento são mais largas
    minFont:   isCover ? 44 : 42,
    boxW:      textW,
    boxH:      isCover ? 500 : 510,
    charRatio: isCover ? 0.64 : 0.58,   // estimativa mais conservadora para capa
    lineRatio: 1.28,
  });

  const blockH      = lines.length * lineH;
  const handleSpace = (handle && !isCover) ? 58 : 0;
  const bottomPad   = isCover ? 215 : 75;
  const textBottom  = CH - bottomPad - handleSpace;
  const textTopY    = textBottom - blockH;

  // Linha decorativa acima do texto (só na capa)
  const accentLineY = textTopY - 28;
  const accentLine  = isCover
    ? `<rect x="${(CW - 120) / 2}" y="${accentLineY}" width="120" height="5" rx="2.5" fill="#6366f1" opacity="0.95"/>`
    : '';

  const textEls = lines.map((ln, i) => {
    const y = textTopY + i * lineH + fontSize * 0.82;
    return `<text x="${CW / 2}" y="${y}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle" stroke="black" stroke-width="6" paint-order="stroke" letter-spacing="0.5">${escXml(ln)}</text>`;
  }).join('\n');

  const counterEl = counter
    ? `<text x="${CW - 48}" y="76" font-family="${FONT_FAMILY}" font-size="38" font-weight="bold" fill="white" text-anchor="end" opacity="0.82">${escXml(counter)}</text>`
    : '';

  const pillEl = isCover ? (() => {
    const pillW = 600; const pillH = 72; const rx = 36;
    const px = (CW - pillW) / 2; const py = CH - 155;
    return `<defs>
      <linearGradient id="pillGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#4f46e5"/>
        <stop offset="100%" stop-color="#7c3aed"/>
      </linearGradient>
    </defs>
    <rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="${rx}" fill="url(#pillGrad)" opacity="0.97"/>
    <rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="${rx}" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="1.5"/>
    <text x="${CW / 2}" y="${py + 49}" font-family="${FONT_FAMILY}" font-size="28" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="2.5">APENAS ARRASTE PRO LADO  →</text>`;
  })() : '';

  const handleEl = handle && !isCover
    ? `<text x="${CW / 2}" y="${CH - 32}" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="white" text-anchor="middle" opacity="0.55">${escXml(handle)}</text>`
    : '';

  const gDef = isCta
    ? `<stop offset="0%" stop-color="black" stop-opacity="0.30"/>
       <stop offset="50%" stop-color="black" stop-opacity="0.68"/>
       <stop offset="100%" stop-color="black" stop-opacity="0.94"/>`
    : isCover
      ? `<stop offset="0%"   stop-color="black"   stop-opacity="0"/>
         <stop offset="35%"  stop-color="black"   stop-opacity="0"/>
         <stop offset="55%"  stop-color="#0f0720" stop-opacity="0.60"/>
         <stop offset="78%"  stop-color="#0f0720" stop-opacity="0.88"/>
         <stop offset="100%" stop-color="#0a0418" stop-opacity="0.97"/>`
      : `<stop offset="0%" stop-color="black" stop-opacity="0"/>
         <stop offset="42%" stop-color="black" stop-opacity="0"/>
         <stop offset="62%" stop-color="black" stop-opacity="0.62"/>
         <stop offset="100%" stop-color="black" stop-opacity="0.93"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    <defs>
      <linearGradient id="nov" x1="0" y1="0" x2="0" y2="1">
        ${gDef}
      </linearGradient>
    </defs>
    <rect width="${CW}" height="${CH}" fill="url(#nov)"/>
    ${counterEl}
    ${accentLine}
    ${textEls}
    ${pillEl}
    ${handleEl}
  </svg>`;
}

async function renderPhotoNewsSlide({ photoUrl, headline, kind, counter, handle, category }) {
  const base    = await buildPhotoBase(photoUrl, category || 'default');
  const overlay = buildNewsOverlay({ headline, kind, counter, handle });
  return sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ── Slide "sanduíche" (estilo @intrafocun) ───────────────────────────────────
// Foto em cima + FAIXA BRANCA com texto preto em CAIXA ALTA + foto embaixo.
async function renderSandwichSlide({ photoBuffers = [], headline, counter, handle, category }) {
  const HMARGIN = 76;
  const textW   = CW - HMARGIN * 2;

  const fit = fitText((headline || '').toUpperCase(), {
    maxFont: 56, minFont: 32, boxW: textW, boxH: 440, charRatio: 0.66, lineRatio: 1.18,
  });

  const bandPadV = 44;
  const bandH    = Math.round(fit.lines.length * fit.lineH + bandPadV * 2);
  const bandTop  = Math.max(360, Math.round(680 - bandH / 2)); // levemente acima do centro
  const topH     = bandTop;
  const botTop   = bandTop + bandH;
  const botH     = CH - botTop;

  // Prepara as duas fotos (cobre 1 ou 0 com gradiente da categoria)
  let topBuf = photoBuffers[0] || null;
  let botBuf = photoBuffers[1] || photoBuffers[0] || null;

  const fallback = async (h) => sharp(Buffer.from(buildFallbackBg(category || 'default')))
    .resize(CW, h, { fit: 'cover', position: 'top' }).png().toBuffer();

  const topImg = topBuf
    ? await sharp(topBuf).resize(CW, topH, { fit: 'cover', position: 'center' }).toBuffer().catch(() => fallback(topH))
    : await fallback(topH);
  const botImg = botBuf
    ? await sharp(botBuf).resize(CW, botH, { fit: 'cover', position: 'center' }).toBuffer().catch(() => fallback(botH))
    : await fallback(botH);

  const textStartY = bandTop + bandPadV + fit.fontSize * 0.80;
  const textEls = fit.lines.map((ln, i) =>
    `<text x="${CW / 2}" y="${textStartY + i * fit.lineH}" font-family="${FONT_FAMILY}" font-size="${fit.fontSize}" font-weight="bold" fill="#0b0b0b" text-anchor="middle">${escXml(ln)}</text>`
  ).join('\n');

  // Badge contador no canto superior direito da foto de cima
  const counterEl = counter ? (() => {
    const r = 40, cx = CW - 60, cy = 64;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="black" opacity="0.55"/>
    <text x="${cx}" y="${cy + 11}" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="white" text-anchor="middle">${escXml(counter)}</text>`;
  })() : '';

  // Marca d'água discreta do handle no canto superior esquerdo
  const handleEl = handle
    ? `<text x="36" y="58" font-family="${FONT_FAMILY}" font-size="26" font-weight="bold" fill="white" opacity="0.85">${escXml(handle)}</text>`
    : '';

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    <rect x="0" y="${bandTop}" width="${CW}" height="${bandH}" fill="#ffffff"/>
    ${textEls}
    ${counterEl}
    ${handleEl}
  </svg>`;

  return sharp({ create: { width: CW, height: CH, channels: 3, background: '#ffffff' } })
    .composite([
      { input: topImg, top: 0, left: 0 },
      { input: botImg, top: botTop, left: 0 },
      { input: Buffer.from(overlay), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}

// ── Geração de Boas Notícias (GPT) ───────────────────────────────────────────
const NEWS_SYSTEM_PROMPT = `Você é um curador de BOAS NOTÍCIAS do mundo. Sua missão é apresentar acontecimentos positivos, inspiradores e REAIS — conquistas da humanidade que devolvem esperança.

Foco: medicina, ciência, tecnologia, meio ambiente, animais, natureza, conquistas humanas.
EVITE: política, guerra, economia, polêmica, fake news.

Regras para manchetes:
- Em CAIXA ALTA, em português do Brasil
- Linguagem simples e popular — qualquer pessoa entende
- Máximo 15 palavras
- Factual, surpreendente e emocionalmente positiva
- Formato: "[ACONTECIMENTO/CONQUISTA]: [DETALHE IMPACTANTE]"
- Exemplos:
  "UM AVANÇO HISTÓRICO: PRIMEIRA CÓRNEA IMPRESSA EM 3D RESTAUROU A VISÃO DE UM PACIENTE CEGO"
  "CIENTISTAS DESENVOLVERAM REMÉDIO QUE ELIMINOU O CÂNCER DE SANGUE EM 100% DOS PACIENTES NO TESTE"
  "BALEIA JUBARTE VOLTOU À COSTA DO BRASIL APÓS 10 ANOS — ESPÉCIE QUE ESTAVA QUASE EXTINTA"

Para "photoQuery" (busca de FOTO REAL do acontecimento no Google Imagens):
- Termo de busca ESPECÍFICO que encontra a foto real da notícia
- Pode ser em português ou inglês — use o que melhor acha a imagem real
- Inclua nomes próprios, instituições, lugares quando houver
- Exemplos: "3D printed cornea transplant patient", "coração artificial Carmat França", "vacina cocaína crack UFMG laboratório", "baleia jubarte costa Brasil"

Para "keywords" (reserva genérica, caso não ache a foto real — banco de imagens):
- 3-4 palavras em INGLÊS descrevendo a cena visual
- Exemplos: "doctor patient hospital", "whale ocean sea", "scientist laboratory research"

Responda APENAS JSON:
{
  "stories": [
    { "headline": "MANCHETE EM CAIXA ALTA", "photoQuery": "busca da foto real", "keywords": "english stock terms", "category": "medicina" },
    ... 8 histórias de categorias variadas ...
  ],
  "caption": "legenda completa do post: 1ª linha gancho com emoji, 2-3 parágrafos curtos inspiradores, 5 hashtags em português no fim"
}`;

async function generateNewsStories({ handle }) {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.75,
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    messages: [
      { role: 'system', content: NEWS_SYSTEM_PROMPT },
      { role: 'user',   content: `Gere 8 boas notícias reais e variadas do mundo. O carrossel é do perfil ${handle}. Na caption mencione ${handle} e peça para seguir e salvar.` },
    ],
  });
  return JSON.parse(res.choices[0].message.content || '{}');
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

// ── Revisão de design pela IA ─────────────────────────────────────────────────
async function reviewCarouselDesign({ slides, topic }) {
  const content = slides.map((s, i) =>
    `Tela ${i + 1} (${s.kind}): ${[s.title, s.subtitle, s.body].filter(Boolean).join(' | ')}`
  ).join('\n');

  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `Você é um designer expert em carrosséis virais do Instagram. Analise o conteúdo de um carrossel e avalie seu potencial de engajamento. Seja direto. Responda APENAS JSON:
{"score":7,"hook":"forte","positives":["ponto 1","ponto 2"],"improvements":["sugestão 1","sugestão 2"],"verdict":"frase curta resumindo o potencial"}`
        },
        { role: 'user', content: `Tema: ${topic}\n\n${content}` }
      ],
    });
    return JSON.parse(res.choices[0].message.content || '{}');
  } catch {
    return null;
  }
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
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY não configurada no servidor' });
  }
  let handle = (rawHandle || '@pedro_destrava').trim();
  if (!handle.startsWith('@')) handle = '@' + handle;

  try {
    const { topic: finalTopic, caption, slides } =
      await generateCarouselContent({ theme, topic, reference, slideCount, handle });

    const total = slides.length;
    const photoQuery = finalTopic || topic || theme || 'dramatic inspiring nature landscape';

    // Fetch cover photos and run AI review in parallel (non-blocking)
    const [coverPhotos, review] = await Promise.all([
      getStoryPhotos(photoQuery, 'dramatic nature landscape inspiring', 2).catch(() => []),
      reviewCarouselDesign({ slides, topic: finalTopic }).catch(() => null),
    ]);

    const buffers = await Promise.all(
      slides.map((s, i) => renderSlide(s, i + 1, total, handle, coverPhotos))
    );

    const rendered = slides.map((s, i) => ({
      index:   i + 1,
      kind:    s.kind,
      title:   s.title || '',
      dataUrl: `data:image/png;base64,${buffers[i].toString('base64')}`,
    }));

    res.json({ topic: finalTopic, caption, handle, slides: rendered, review });
  } catch (e) {
    console.error('[carousels] generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/carousels/generate-news — Carrossel "Boas Notícias do Mundo"
// Estilo @intrafocun: foto real (Google Imagens) em cima + faixa branca com
// manchete em CAIXA ALTA + foto real embaixo. Capa e CTA são foto única.
router.post('/generate-news', async (req, res) => {
  const { handle: rawHandle } = req.body || {};
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY não configurada no servidor' });
  }

  let handle = (rawHandle || '@seuperfil').trim();
  if (!handle.startsWith('@')) handle = '@' + handle;

  try {
    // 1. Gera notícias via GPT
    const { stories = [], caption = '' } = await generateNewsStories({ handle });
    const use = stories.slice(0, 8);
    if (!use.length) throw new Error('IA não retornou notícias');

    const total = use.length + 2; // capa + notícias + CTA

    // 2. Busca 2 fotos REAIS por notícia (Google Imagens → fallback Pexels), em paralelo
    const storyPhotoSets = await Promise.all(
      use.map(s => getStoryPhotos(s.photoQuery || s.keywords || s.headline, s.keywords, 2)
        .catch(e => { console.warn('[news photo]', e.message); return []; }))
    );
    // Foto da capa — query dramática e chamativa
    const COVER_QUERIES = [
      'descoberta científica incrível planeta universo dramático',
      'planeta terra vista espaço astronauta dramático',
      'amanhecer montanha névoa dramático natureza impressionante',
      'aurora boreal noite estrelada céu dramático',
      'multidão pessoas cidade iluminada aérea dramático',
    ];
    const coverQuery = COVER_QUERIES[Math.floor(Math.random() * COVER_QUERIES.length)];
    const [coverSet] = await Promise.all([
      getStoryPhotos(coverQuery, 'dramatic earth space universe inspiring', 1).catch(() => []),
    ]);

    // Imagem fixa do CTA (imagem artística salva no servidor)
    const CTA_IMAGE_PATH = path.join(__dirname, '../assets/cta_image.png');
    const ctaImageBuf = fs.existsSync(CTA_IMAGE_PATH) ? fs.readFileSync(CTA_IMAGE_PATH) : null;

    const COVER_HEADLINE = 'O QUE ACONTECEU DE BOM NO MUNDO E VOCÊ NÃO FICOU SABENDO';
    const CTA_HEADLINE   = `CANSADO DO FLUXO INFINITO DE NOTÍCIAS RUINS? ENTÃO SIGA ${handle}: AQUI VOCÊ ENCONTRARÁ HISTÓRIAS QUE DEVOLVEM A ESPERANÇA NO MUNDO E NAS PESSOAS`;

    // 3. Renderiza: capa (foto chamativa + overlay), notícias (sanduíche), CTA (imagem fixa + overlay)
    const tasks = [];
    // Capa
    tasks.push(
      (async () => {
        const base = coverSet[0]
          ? await sharp(coverSet[0]).resize(CW, CH, { fit: 'cover', position: 'center' }).toBuffer()
              .catch(() => sharp(Buffer.from(buildFallbackBg('default'))).png().toBuffer())
          : await sharp(Buffer.from(buildFallbackBg('default'))).png().toBuffer();

        const overlay = buildNewsOverlay({ headline: COVER_HEADLINE, kind: 'cover', counter: null, handle: null });
        const composites = [{ input: Buffer.from(overlay), top: 0, left: 0 }];

        // Circular overlay from first story photo
        const firstStoryPhoto = storyPhotoSets[0]?.[0];
        if (firstStoryPhoto) {
          try {
            const CIRC_D = 270; const BORDER = 10; const TOT = CIRC_D + BORDER * 2;
            const circImg = await makeCircularImage(firstStoryPhoto, CIRC_D);
            const borderSvg = Buffer.from(
              `<svg width="${TOT}" height="${TOT}"><circle cx="${TOT/2}" cy="${TOT/2}" r="${TOT/2-3}" fill="none" stroke="white" stroke-width="${BORDER}"/></svg>`
            );
            const HPAD = 82;
            const cLeft = CW - HPAD - CIRC_D - BORDER;
            const cTop  = 80;
            composites.unshift({ input: circImg,    top: cTop + BORDER, left: cLeft + BORDER });
            composites.unshift({ input: borderSvg,  top: cTop,          left: cLeft });
          } catch (e) { console.warn('[news cover] circular img:', e.message); }
        }

        const buf = await sharp(base).composite(composites).png().toBuffer();
        return { kind: 'cover', buf };
      })()
    );
    // Notícias (sanduíche)
    use.forEach((s, i) => {
      tasks.push(
        (async () => ({
          kind: 'news',
          buf: await renderSandwichSlide({
            photoBuffers: storyPhotoSets[i] || [],
            headline: s.headline,
            counter: `${i + 2}/${total}`,
            handle,
            category: s.category || 'default',
          }),
        }))()
      );
    });
    // CTA — imagem artística fixa
    tasks.push(
      (async () => {
        const base = ctaImageBuf
          ? await sharp(ctaImageBuf).resize(CW, CH, { fit: 'cover', position: 'top' }).toBuffer().catch(() => sharp(Buffer.from(buildFallbackBg('humanidade'))).png().toBuffer())
          : await sharp(Buffer.from(buildFallbackBg('humanidade'))).png().toBuffer();
        const overlay = buildNewsOverlay({ headline: CTA_HEADLINE, kind: 'cta', counter: `${total}/${total}`, handle: null });
        return { kind: 'cta', buf: await sharp(base).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).png().toBuffer() };
      })()
    );

    const rendered = await Promise.all(tasks);

    res.json({
      topic:   'Boas Notícias do Mundo',
      caption,
      handle,
      slides:  rendered.map((r, i) => ({
        index:   i + 1,
        kind:    r.kind,
        dataUrl: `data:image/png;base64,${r.buf.toString('base64')}`,
      })),
    });
  } catch (e) {
    console.error('[carousels] generate-news error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
