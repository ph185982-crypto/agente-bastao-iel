// Renderiza os modelos de post estático que viralizam (ver static/viralPlaybook.js):
// Antes × Agora, Print do Pedro, Notícia humana e Lista editorial.
// Tudo em 1080x1350 (4:5, ocupa mais tela no feed). Texto em SVG via sharp.
// Destaque dentro do texto: **trecho** sai na cor de destaque.
require('../fontSetup');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

const W = 1080;
const H = 1350;
const { ACCOUNT } = require('./account');
const HANDLE = ACCOUNT.handle;
const NOME = ACCOUNT.nome;
const AVATAR = path.join(__dirname, '..', 'assets', 'avatar.jpg');

const F = {
  black: "'Poppins ExtraBold', 'Poppins', sans-serif",
  bold: "'Poppins', sans-serif",
  semi: "'Poppins SemiBold', 'Poppins', sans-serif",
  serif: "'PT Serif', serif",
};
const COR = { navy: '#0A1B33', azul: '#0052FF', ceu: '#38B1FF', vermelho: '#FF3B3B', papel: '#F6F2EA', tinta: '#1B1B1B' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// "Hoje vale **R$ 11,19**" → [{t:'Hoje', hi:false}, …, {t:'R$', hi:true}, {t:'11,19', hi:true}]
function tokens(texto) {
  const out = [];
  let prevSpace = true;
  String(texto || '').split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (!part) return;
    const hi = /^\*\*[^*]+\*\*$/.test(part);
    const clean = hi ? part.slice(2, -2) : part;
    // Pontuação colada no destaque ("**R$ 6**.") não ganha espaço antes.
    const gluedStart = out.length > 0 && !prevSpace && !/^\s/.test(clean);
    prevSpace = /\s$/.test(clean);
    clean.split(/\s+/).filter(Boolean).forEach((t, i) => out.push({ t, hi, glue: i === 0 && gluedStart }));
  });
  // "R$" e "US$" nunca ficam no fim da linha separados do valor.
  for (let i = out.length - 2; i >= 0; i--) {
    if (/^(R|US|U\$)?\$$/.test(out[i].t) || /^(R\$|US\$)$/.test(out[i].t)) {
      out.splice(i, 2, { ...out[i], t: `${out[i].t}\u00A0${out[i + 1].t}`, hi: out[i].hi || out[i + 1].hi });
    }
  }
  return out;
}

// Quebra em linhas estimando a largura pela média de caracteres da fonte.
function wrap(texto, fontSize, maxW, ratio) {
  const maxChars = Math.max(6, Math.floor(maxW / (fontSize * ratio)));
  const lines = [];
  let cur = [];
  let len = 0;
  for (const tk of tokens(texto)) {
    const sp = cur.length && !tk.glue ? 1 : 0;
    if (len + sp + tk.t.length > maxChars && cur.length && !tk.glue) { lines.push(cur); cur = []; len = 0; }
    len += (cur.length && !tk.glue ? 1 : 0) + tk.t.length;
    cur.push(tk);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Maior fonte (entre max e min) em que o texto cabe na caixa.
function fit(texto, { maxW, maxH, max, min, ratio = 0.58, lh = 1.18 }) {
  for (let fs = max; fs >= min; fs -= 2) {
    const lines = wrap(texto, fs, maxW, ratio);
    if (lines.length * fs * lh <= maxH) return { fs, lines, lineH: fs * lh };
  }
  const lines = wrap(texto, min, maxW, ratio);
  return { fs: min, lines, lineH: min * lh };
}

function textBlock(lines, { x, y, fs, lineH, family, weight = 700, color = '#fff', hiColor = COR.vermelho, anchor = 'start' }) {
  return lines.map((ln, i) => {
    const spans = ln.map((tk, j) => `<tspan fill="${tk.hi ? hiColor : color}">${j && !tk.glue ? ' ' : ''}${esc(tk.t)}</tspan>`).join('');
    return `<text xml:space="preserve" x="${x}" y="${Math.round(y + i * lineH)}" font-family="${family}" font-weight="${weight}" font-size="${fs}" text-anchor="${anchor}">${spans}</text>`;
  }).join('');
}

// ── Fotos (Pexels) ───────────────────────────────────────────────────────────
// Busca a foto; se a busca exata não achar nada, tenta com menos palavras.
async function pexels(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const palavras = q.split(/\s+/);
  for (const tentativa of [q, palavras.slice(-2).join(' '), palavras[0]]) {
    const buf = await pexelsUma(tentativa);
    if (buf) return buf;
  }
  return null;
}

async function pexelsUma(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query) return null;
  try {
    const { data } = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 6, orientation: 'portrait' },
      headers: { Authorization: key }, timeout: 8000,
    });
    const p = (data.photos || [])[0];
    if (!p) return null;
    const img = await axios.get(p.src.large2x || p.src.large, { responseType: 'arraybuffer', timeout: 12000 });
    return Buffer.from(img.data);
  } catch (e) {
    console.warn('[viralRender] foto falhou:', query, e.message);
    return null;
  }
}

async function base(photoBuf, fallbackA = '#132845', fallbackB = '#050B16') {
  if (photoBuf) {
    try { return await sharp(photoBuf).resize(W, H, { fit: 'cover', position: 'attention' }).modulate({ brightness: 0.92 }).toBuffer(); } catch { /* cai no gradiente */ }
  }
  const g = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${fallbackA}"/><stop offset="1" stop-color="${fallbackB}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(g)).png().toBuffer();
}

const png = (bg, svg) => sharp(bg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
const svgWrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${inner}</svg>`;

function marca(x = 64, y = 86) {
  return `<text x="${x}" y="${y}" font-family="${F.black}" font-weight="800" font-size="30" fill="#fff" letter-spacing="1">PEDRO</text>
    <text x="${x}" y="${y + 32}" font-family="${F.black}" font-weight="800" font-size="30" fill="#fff" letter-spacing="1">DESTRAVA</text>`;
}
function contador(i, total) {
  return `<rect x="${W - 150}" y="58" width="88" height="46" rx="23" fill="rgba(0,0,0,0.45)"/>
    <text x="${W - 106}" y="90" text-anchor="middle" font-family="${F.bold}" font-weight="700" font-size="24" fill="#fff">${i}/${total}</text>`;
}
function rodape(arrastar, cor = 'rgba(255,255,255,0.75)') {
  return `${arrastar ? `<text x="64" y="${H - 58}" font-family="${F.bold}" font-weight="700" font-size="26" fill="${cor}" letter-spacing="1.5">ARRASTE PRO LADO →</text>` : ''}
    <text x="${W - 64}" y="${H - 58}" text-anchor="end" font-family="${F.semi}" font-weight="600" font-size="26" fill="${cor}">${esc(HANDLE)}</text>`;
}
const sombraBaixo = (from = 0.38) => `<defs><linearGradient id="sb" x1="0" y1="0" x2="0" y2="1">
  <stop offset="${from}" stop-color="#000" stop-opacity="0"/><stop offset="${from + 0.22}" stop-color="#000" stop-opacity="0.78"/><stop offset="1" stop-color="#000" stop-opacity="0.94"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sb)"/>`;

// ── Antes × Agora ────────────────────────────────────────────────────────────
// conteudo: { slides: [{ texto, foto }], licao, cta }
async function renderAntesAgora(c) {
  const slides = (c.slides || []).slice(0, 6);
  const total = slides.length + 1;
  const fotos = await Promise.all(slides.map((s) => pexels(s.foto)));
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    const t = fit(slides[i].texto, { maxW: W - 128, maxH: 470, max: i === 0 ? 74 : 64, min: 40, ratio: 0.6 });
    const y0 = H - 150 - t.lines.length * t.lineH + t.fs;
    const svg = svgWrap(`${sombraBaixo()}${marca()}${contador(i + 1, total)}
      ${textBlock(t.lines, { x: 64, y: y0, fs: t.fs, lineH: t.lineH, family: F.black, weight: 800, hiColor: COR.vermelho })}
      ${rodape(true)}`);
    out.push(await png(await base(fotos[i]), svg));
  }
  out.push(await renderFechamento({ licao: c.licao, cta: c.cta, total }));
  return out;
}

async function renderFechamento({ licao, cta, total }) {
  const t = fit(licao || 'O que isso ensina sobre dinheiro e negócio.', { maxW: W - 128, maxH: 520, max: 66, min: 40, ratio: 0.6 });
  const c = fit(cta || 'Manda pra alguém que precisa ver isso.', { maxW: W - 200, maxH: 120, max: 36, min: 26, ratio: 0.56 });
  const yL = 360;
  const yC = Math.max(yL + t.lines.length * t.lineH + 90, 900);
  const svg = svgWrap(`<rect width="${W}" height="${H}" fill="${COR.navy}"/>${marca()}${total ? contador(total, total) : ''}
    <text x="64" y="${yL - 70}" font-family="${F.bold}" font-weight="700" font-size="30" fill="${COR.ceu}" letter-spacing="3">A LIÇÃO</text>
    ${textBlock(t.lines, { x: 64, y: yL, fs: t.fs, lineH: t.lineH, family: F.black, weight: 800, hiColor: COR.ceu })}
    <rect x="64" y="${yC - c.fs - 26}" width="${W - 128}" height="${c.lines.length * c.lineH + 52}" rx="22" fill="${COR.azul}"/>
    ${textBlock(c.lines, { x: 100, y: yC, fs: c.fs, lineH: c.lineH, family: F.bold, weight: 700 })}
    ${rodape(false)}`);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Print do Pedro ───────────────────────────────────────────────────────────
// conteudo: { frases: ['...'], tema: 'claro' | 'escuro' }
async function avatarCircle(size) {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(AVATAR).resize(size, size).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function renderPrint(c) {
  const escuro = c.tema === 'escuro';
  const bg = escuro ? '#000000' : '#FFFFFF';
  const fg = escuro ? '#E7E9EA' : '#0F1419';
  const sub = escuro ? '#71767B' : '#536471';
  const av = await avatarCircle(124);
  const out = [];
  const frases = (c.frases || []).slice(0, 6);
  for (const frase of frases) {
    const t = fit(frase, { maxW: W - 192, maxH: 760, max: 74, min: 44, ratio: 0.6, lh: 1.24 });
    const blocoH = 124 + 56 + t.lines.length * t.lineH;
    const top = Math.round((H - blocoH) / 2);
    const yNome = top + 52;
    const svg = svgWrap(`<rect width="${W}" height="${H}" fill="${bg}"/>
      <text x="252" y="${yNome}" font-family="${F.bold}" font-weight="700" font-size="44" fill="${fg}">${esc(NOME)}</text>
      <text x="252" y="${yNome + 50}" font-family="${F.semi}" font-weight="600" font-size="34" fill="${sub}">${esc(HANDLE)}</text>
      ${textBlock(t.lines, { x: 96, y: top + 124 + 56 + t.fs, fs: t.fs, lineH: t.lineH, family: F.semi, weight: 600, color: fg, hiColor: COR.azul })}`);
    out.push(await sharp(Buffer.from(svg)).composite([{ input: av, top, left: 96 }]).png().toBuffer());
  }
  return out;
}

// ── Notícia humana ───────────────────────────────────────────────────────────
// conteudo: { manchete, foto, rotulo }
async function renderNoticia(c) {
  const foto = await pexels(c.foto);
  const t = fit(c.manchete, { maxW: W - 128, maxH: 430, max: 68, min: 42, ratio: 0.6 });
  const rot = String(c.rotulo || 'BOAS NOTÍCIAS').toUpperCase().slice(0, 28);
  const rotW = Math.round(rot.length * 24 * 0.68 + 48);
  const y0 = H - 140 - t.lines.length * t.lineH + t.fs;
  const svg = svgWrap(`${sombraBaixo(0.32)}
    <rect x="64" y="${y0 - t.fs - 74}" width="${rotW}" height="48" rx="10" fill="${COR.azul}"/>
    <text x="88" y="${y0 - t.fs - 41}" font-family="${F.bold}" font-weight="700" font-size="24" fill="#fff" letter-spacing="1.5">${esc(rot)}</text>
    ${textBlock(t.lines, { x: 64, y: y0, fs: t.fs, lineH: t.lineH, family: F.black, weight: 800, hiColor: COR.ceu })}
    <text x="${W - 64}" y="${H - 58}" text-anchor="end" font-family="${F.semi}" font-weight="600" font-size="26" fill="rgba(255,255,255,0.8)">${esc(HANDLE)}</text>`);
  return [await png(await base(foto, '#2a3d55', '#0b1320'), svg)];
}

// ── Lista editorial ──────────────────────────────────────────────────────────
// conteudo: { titulo, subtitulo, itens: [{ titulo, texto }], licao, cta }
async function renderLista(c) {
  const itens = (c.itens || []).slice(0, 9);
  // Até 3 itens por tela, divididos por igual (4 itens = 2 + 2, não 3 + 1).
  const nTelas = Math.max(1, Math.ceil(itens.length / 3));
  const porTela = Math.ceil(itens.length / nTelas);
  const grupos = [];
  for (let i = 0; i < itens.length; i += porTela) grupos.push(itens.slice(i, i + porTela));
  const total = grupos.length + 2;
  const out = [];
  const cab = (i) => `<rect width="${W}" height="${H}" fill="${COR.papel}"/>
    <text x="72" y="96" font-family="${F.semi}" font-weight="600" font-size="26" fill="#6B655B">${esc(HANDLE)} · estratégia na prática</text>
    <text x="${W - 72}" y="96" text-anchor="end" font-family="${F.semi}" font-weight="600" font-size="26" fill="#6B655B">${i}/${total}</text>
    <line x1="72" y1="126" x2="${W - 72}" y2="126" stroke="#1B1B1B" stroke-width="2"/>`;

  const tt = fit(c.titulo, { maxW: W - 144, maxH: 560, max: 104, min: 60, ratio: 0.5, lh: 1.08 });
  const st = fit(c.subtitulo || '', { maxW: W - 144, maxH: 180, max: 38, min: 28, ratio: 0.52, lh: 1.3 });
  const yT = 300 + tt.fs;
  out.push(await sharp(Buffer.from(svgWrap(`${cab(1)}
    ${textBlock(tt.lines, { x: 72, y: yT, fs: tt.fs, lineH: tt.lineH, family: F.serif, weight: 700, color: COR.tinta, hiColor: '#B3261E' })}
    ${textBlock(st.lines, { x: 72, y: yT + tt.lines.length * tt.lineH + 40, fs: st.fs, lineH: st.lineH, family: F.semi, weight: 600, color: '#4A453D' })}
    <text x="72" y="${H - 72}" font-family="${F.bold}" font-weight="700" font-size="28" fill="${COR.tinta}" letter-spacing="1.5">ARRASTE →</text>`))).png().toBuffer());

  let n = 0;
  for (let g = 0; g < grupos.length; g++) {
    let y = 210;
    let inner = cab(g + 2);
    for (const it of grupos[g]) {
      n += 1;
      const ti = fit(it.titulo, { maxW: W - 260, maxH: 130, max: 54, min: 38, ratio: 0.52, lh: 1.15 });
      const tx = fit(it.texto, { maxW: W - 260, maxH: 200, max: 40, min: 30, ratio: 0.5, lh: 1.35 });
      inner += `<circle cx="112" cy="${y + 18}" r="34" fill="none" stroke="${COR.tinta}" stroke-width="2.5"/>
        <text x="112" y="${y + 32}" text-anchor="middle" font-family="${F.serif}" font-weight="700" font-size="38" fill="${COR.tinta}">${n}</text>
        ${textBlock(ti.lines, { x: 180, y: y + ti.fs - 4, fs: ti.fs, lineH: ti.lineH, family: F.serif, weight: 700, color: COR.tinta, hiColor: '#B3261E' })}
        ${textBlock(tx.lines, { x: 180, y: y + ti.lines.length * ti.lineH + tx.fs + 6, fs: tx.fs, lineH: tx.lineH, family: F.serif, weight: 400, color: '#3C3830', hiColor: '#B3261E' })}`;
      const h = ti.lines.length * ti.lineH + tx.lines.length * tx.lineH + 70;
      y += Math.max(330, h);
      inner += `<line x1="180" y1="${y - 40}" x2="${W - 72}" y2="${y - 40}" stroke="#D8D0C2" stroke-width="2"/>`;
    }
    out.push(await sharp(Buffer.from(svgWrap(inner))).png().toBuffer());
  }

  const lc = fit(c.licao || 'Qual desses você já viu acontecer?', { maxW: W - 144, maxH: 480, max: 76, min: 44, ratio: 0.5, lh: 1.15 });
  const cc = fit(c.cta || 'Manda pra alguém que precisa ler isso.', { maxW: W - 144, maxH: 140, max: 38, min: 28, ratio: 0.52 });
  const yL = 360 + lc.fs;
  out.push(await sharp(Buffer.from(svgWrap(`${cab(total)}
    ${textBlock(lc.lines, { x: 72, y: yL, fs: lc.fs, lineH: lc.lineH, family: F.serif, weight: 700, color: COR.tinta, hiColor: '#B3261E' })}
    ${textBlock(cc.lines, { x: 72, y: Math.max(yL + lc.lines.length * lc.lineH + 80, 980), fs: cc.fs, lineH: cc.lineH, family: F.bold, weight: 700, color: COR.azul })}`))).png().toBuffer());
  return out;
}

async function render(template, conteudo) {
  if (template === 'antes_agora') return renderAntesAgora(conteudo);
  if (template === 'print') return renderPrint(conteudo);
  if (template === 'noticia') return renderNoticia(conteudo);
  if (template === 'lista') return renderLista(conteudo);
  throw new Error(`Modelo desconhecido: ${template}`);
}

module.exports = { render, tokens, wrap, fit, W, H };
