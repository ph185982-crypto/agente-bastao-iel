// Tema "revelacao" (formato "Quem é ele?", inspirado no carrossel de apostas de famosos): as primeiras telas mostram só as
// decisões de dinheiro de alguém (logo da empresa sobre a cor da marca, "Ele botou US$ 1 milhão no Skype." e, embaixo, a foto
// com "Virou US$ 4 milhões."), sem dizer quem é; depois a tela que revela a pessoa e as telas que explicam a lição.
// Layouts:
//  - 'rev_aposta':  painel de cima na cor da marca com o logo (silhueta branca ou preta) e a frase da decisão; faixa amarela;
//                   foto embaixo com o resultado. dados: { cor, logo_id (imagem em ctx.logo), decisao, resultado }
//  - 'rev_foto_texto': foto em cima (45%), texto embaixo em fundo escuro (título sublinhado + parágrafos).
//  - 'rev_texto_foto': texto à esquerda (55%) em fundo escuro e foto à direita.
//  - 'rev_escuro':  foto escurecida ao fundo e texto + chamada sublinhada.
// O texto aceita **destaque** (sublinhado). Cabeçalho pequeno com o Pedro em todas as telas.
require('../fontSetup');
const sharp = require('sharp');
const A = require('./arte');
const D = require('./arteDialogo');
const { ACCOUNT } = require('./account');

const { W, H, esc, ARQ } = A;
const M = 64;
const AMARELO = '#FFD60A';
const ESCURO = '#0B0B0C';
const lum = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const textoSobre = (hex) => (lum(hex) > 0.45 ? '#0B0B0C' : '#FFFFFF');
const HEX = /^#[0-9A-F]{6}$/i;

function cabecalho(cor = '#FFFFFF', op = 0.85) {
  return `<text x="${M}" y="58" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="22" letter-spacing="1.5" fill="${cor}" fill-opacity="${op}">PEDRO DESTRAVA</text>`
    + `<text x="${M}" y="86" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="20" letter-spacing="1" fill="${cor}" fill-opacity="${op * 0.8}">${esc((ACCOUNT.handle || '@pedro_destrava').toUpperCase())}</text>`
    + `<text x="${W - M}" y="58" text-anchor="end" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="22" letter-spacing="1.5" fill="${cor}" fill-opacity="${op}">— A ESTRATÉGIA</text>`
    + `<text x="${W - M}" y="86" text-anchor="end" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="20" letter-spacing="1" fill="${cor}" fill-opacity="${op * 0.8}">POR TRÁS</text>`;
}

// Bloco de texto: título (sublinhado) + corpo, alinhado à esquerda. Devolve svg e métricas.
function blocoTexto({ titulo, texto, x, ytop, larg, alt, cor = '#FFFFFF', tituloMax = 60 }) {
  let svg = ''; const metr = []; let y = ytop;
  if (titulo) {
    const t = D.caber({ texto: titulo, k: 'mDisplay', larg, alt: Math.min(alt * 0.5, 320), max: tituloMax, min: 36, ent: 1.14 });
    const linhaH = t.tam * t.entrelinha;
    t.linhas.forEach((ln, i) => {
      const base = y + i * linhaH + t.tam * 0.92;
      ln.forEach((w) => { svg += `<text x="${(x + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="${t.tam}" fill="${cor}">${esc(w.t)}</text>`; });
      const lw = ln.reduce((m, w) => Math.max(m, w.x + w.larg), 0);
      svg += `<rect x="${x}" y="${(base + t.tam * 0.14).toFixed(1)}" width="${lw.toFixed(1)}" height="${Math.max(3, Math.round(t.tam * 0.06))}" fill="${cor}"/>`;
    });
    y += t.linhas.length * linhaH + 26; metr.push({ nome: 'titulo', tam: t.tam, minimo: t.minimo, cabe: t.cabe, linhas: t.linhas.length });
  }
  if (texto) {
    const paras = String(texto).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const disp = ytop + alt - y; const tamMax = 38; let tam = tamMax; let ok = false; let medidos = [];
    for (; tam >= 28; tam -= 2) {
      medidos = paras.map((p) => D.caber({ texto: p, k: 'iSemi', larg, alt: 2000, max: tam, min: tam, ent: 1.32 }));
      const h = medidos.reduce((s, b) => s + b.altura, 0) + (paras.length - 1) * tam * 0.9;
      if (h <= disp) { ok = true; break; }
    }
    if (!ok) tam = 28;
    let yy = y;
    for (const b of medidos) {
      const linhaH = b.tam * b.entrelinha;
      b.linhas.forEach((ln, i) => {
        const base = yy + i * linhaH + b.tam * 0.92;
        let ini = null;
        ln.forEach((w, j) => {
          const fam = ARQ.iSemi;
          svg += `<text x="${(x + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${fam.familia}" font-weight="${fam.peso}" font-size="${b.tam}" fill="${cor}">${esc(w.t)}</text>`;
          if (w.hi && ini === null) ini = w.x;
          if (w.hi && (j === ln.length - 1 || !ln[j + 1].hi)) { svg += `<rect x="${(x + ini).toFixed(1)}" y="${(base + 7).toFixed(1)}" width="${(w.x + w.larg - ini).toFixed(1)}" height="3" fill="${cor}"/>`; ini = null; }
        });
      });
      yy += b.altura + b.tam * 0.9;
    }
    metr.push({ nome: 'texto', tam, minimo: 28, cabe: ok, linhas: medidos.reduce((s, b) => s + b.linhas.length, 0), ...(ok ? {} : { motivo: 'O texto não cabe nem em 28 px' }) });
  }
  return { svg, metr };
}

async function foto(imagem, w, h) {
  if (!imagem) return sharp({ create: { width: w, height: h, channels: 3, background: '#1B1C20' } }).png().toBuffer();
  // retrato (mais alto que largo): o rosto fica no terço de cima, então o corte prioriza o topo
  const m = await sharp(imagem).rotate().metadata().catch(() => ({}));
  const iw = m.width || 1; const ih = m.height || 1;
  // a foto é mais alta que a janela (proporcionalmente): corta na altura com o centro a 36% do topo (onde costuma estar o
  // rosto); mais larga: deixa o recorte por atenção decidir na horizontal.
  if (ih / iw > h / w) {
    const sh = Math.round((ih * w) / iw);
    const topo = Math.max(0, Math.min(sh - h, Math.round(sh * 0.36 - h / 2)));
    return sharp(imagem).rotate().resize({ width: w }).extract({ left: 0, top: topo, width: w, height: h }).png().toBuffer();
  }
  return sharp(imagem).rotate().resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
}

// Logo: com transparência vira silhueta na cor do texto sobre o painel; sem transparência vai num cartão branco.
async function logoPng(buf, corTexto, maxW, maxH) {
  const img = sharp(buf).trim().resize(maxW, maxH, { fit: 'inside' });
  const meta = await sharp(buf).metadata();
  if (meta.hasAlpha) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = corTexto === '#FFFFFF' ? [255, 255, 255] : [11, 11, 12];
    for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
    return { png: await sharp(data, { raw: info }).png().toBuffer(), w: info.width, h: info.height, silhueta: true };
  }
  const p = await img.png().toBuffer(); const m = await sharp(p).metadata();
  const pad = 28; const card = await sharp({ create: { width: m.width + 2 * pad, height: m.height + 2 * pad, channels: 4, background: '#FFFFFF' } }).composite([{ input: p, left: pad, top: pad }]).png().toBuffer();
  return { png: card, w: m.width + 2 * pad, h: m.height + 2 * pad, silhueta: false };
}

async function aposta(slide, ctx, imagem) {
  const d = slide.dados || {};
  const cor = HEX.test(d.cor || '') ? d.cor : '#1B1C20'; const ct = textoSobre(cor);
  const hTopo = Math.round(H * 0.46); const faixa = 10; const hBaixo = H - hTopo - faixa;
  const comp = [];
  const fundo = await foto(imagem, W, hBaixo);
  comp.push({ input: fundo, left: 0, top: hTopo + faixa });
  let logo = null;
  if (ctx?.logo) { try { logo = await logoPng(ctx.logo, ct, 640, 200); comp.push({ input: logo.png, left: Math.round((W - logo.w) / 2), top: Math.round(130 + (230 - logo.h) / 2) }); } catch { logo = null; } }
  let svg = `<rect width="${W}" height="${hTopo}" fill="${cor}"/><rect y="${hTopo}" width="${W}" height="${faixa}" fill="${AMARELO}"/>`;
  svg += `<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient></defs><rect y="${hTopo + faixa}" width="${W}" height="${hBaixo}" fill="url(#v)"/>`;
  if (!logo) svg += `<text x="${W / 2}" y="290" text-anchor="middle" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="110" fill="${ct}">${esc(d.empresa || '')}</text>`;
  const dec = D.caber({ texto: d.decisao || '', k: 'mDisplay', larg: W - 2 * M - 80, alt: 150, max: 52, min: 36, ent: 1.12 });
  svg += D.colocar(dec, { x: M + 40, ytop: hTopo - 30 - dec.altura, cor: ct, alinhar: 'centro', larguraBox: W - 2 * M - 80 });
  const res = D.caber({ texto: d.resultado || '', k: 'mDisplay', larg: W - 2 * M, alt: 140, max: 64, min: 44, ent: 1.1 });
  svg += `<g>${D.colocar(res, { x: M, ytop: H - 70 - res.altura, cor: '#FFFFFF', alinhar: 'centro', larguraBox: W - 2 * M })}</g>`;
  svg += cabecalho(ct, 0.8);
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: cor } }).png().toBuffer();
  const png = await sharp(base).composite([...comp.slice(0, 1), { input: camada }, ...comp.slice(1)]).png().toBuffer();
  const metr = [{ nome: 'decisao', tam: dec.tam, minimo: dec.minimo, cabe: dec.cabe, linhas: dec.linhas.length }, { nome: 'resultado', tam: res.tam, minimo: res.minimo, cabe: res.cabe, linhas: res.linhas.length }];
  return { png, metr, elementos: ['rev_aposta', logo ? (logo.silhueta ? 'logo_silhueta' : 'logo_cartao') : 'logo_texto', imagem ? 'foto' : 'sem_foto'] };
}

async function fotoTexto(slide, ctx, imagem) {
  const hF = Math.round(H * 0.47);
  const f = await foto(imagem, W, hF);
  let svg = `<rect y="${hF}" width="${W}" height="${H - hF}" fill="${ESCURO}"/>`;
  svg += `<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${hF}" fill="url(#t)"/>`;
  const b = blocoTexto({ titulo: slide.titulo, texto: slide.texto, x: M, ytop: hF + 56, larg: W - 2 * M, alt: H - hF - 56 - 70 });
  svg += b.svg + cabecalho('#FFFFFF', 0.85);
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: ESCURO } }).composite([{ input: f, left: 0, top: 0 }, { input: camada }]).png().toBuffer();
  return { png, metr: b.metr, elementos: ['rev_foto_texto', imagem ? 'foto' : 'sem_foto'] };
}

async function textoFoto(slide, ctx, imagem) {
  const wT = Math.round(W * 0.56); const wF = W - wT;
  const f = await foto(imagem, wF, H);
  const b = blocoTexto({ titulo: slide.titulo, texto: slide.texto, x: M, ytop: 200, larg: wT - M - 40, alt: H - 200 - 80, tituloMax: 48 });
  const svg = `<rect width="${wT}" height="${H}" fill="${ESCURO}"/>${b.svg}${cabecalho('#FFFFFF', 0.85)}`;
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: ESCURO } }).composite([{ input: f, left: wT, top: 0 }, { input: camada }]).png().toBuffer();
  return { png, metr: b.metr, elementos: ['rev_texto_foto', imagem ? 'foto' : 'sem_foto'] };
}

async function escuro(slide, ctx, imagem) {
  const f = await foto(imagem, W, H);
  const b = blocoTexto({ titulo: null, texto: [slide.texto, slide.cta ? `**${slide.cta}**` : ''].filter(Boolean).join('\n\n'), x: M, ytop: Math.round(H * 0.58), larg: W - 2 * M, alt: Math.round(H * 0.42) - 90 });
  const svg = `<rect width="${W}" height="${H}" fill="#000" fill-opacity="0.68"/>${b.svg}${cabecalho('#FFFFFF', 0.85)}`;
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(f).composite([{ input: camada }]).png().toBuffer();
  return { png, metr: b.metr, elementos: ['rev_escuro', imagem ? 'foto' : 'sem_foto'] };
}

async function renderizar(slide, ctx = {}, imagem = null) {
  const fn = { rev_aposta: aposta, rev_foto_texto: fotoTexto, rev_texto_foto: textoFoto, rev_escuro: escuro }[slide.layout] || fotoTexto;
  const r = await fn(slide, ctx, imagem);
  const m = A.resumirMetricas(r.metr, slide.layout, ['tema_revelacao', ...r.elementos]);
  m.tema = 'revelacao';
  return { png: r.png, metrics: m };
}

module.exports = { renderizar, textoSobre, AMARELO };
