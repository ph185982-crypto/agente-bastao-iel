// Tema "papel_de_parede": capa + uma frase curta por tela sobre uma foto bonita, feito para salvar e usar como papel de
// parede do celular. A frase fica abaixo da faixa do relógio da tela de bloqueio (terço de cima livre), em letra grande,
// com a assinatura pequena embaixo. Sem foto (sem PEXELS_API_KEY ou busca falhou), o fundo é um degradê feito aqui.
//
// Slide: { layout: 'papel_capa' | 'papel_frase', tema_visual: 'papel_de_parede', texto, dados: { paleta } }
// A imagem (foto do Pexels, URL enviada ou foto do Pedro na capa) chega em `imagem`, como nos outros temas.
require('../fontSetup');
const sharp = require('sharp');
const A = require('./arte');
const D = require('./arteDialogo');

const { W, H } = A;
const MARGEM = 88;
const COR = { branco: '#FFFFFF', laranja: '#FF7043', grafite: '#18191D' };
// Degradês do fundo feito por código (texto branco em cima: todos escuros o bastante).
const DEGRADES = [
  ['#0B1B33', '#2448FF'], ['#18191D', '#5A3A2E'], ['#10261C', '#2F5D46'], ['#2A1638', '#0E0B1C'], ['#3A1E12', '#14100E'], ['#0E2A3A', '#081016'],
];
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.abs(Math.round(n)) : d; };

function degradeSvg(paleta) {
  const [c1, c2] = DEGRADES[num(paleta, 0) % DEGRADES.length];
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`
    + `<radialGradient id="brilho" cx="0.78" cy="0.18" r="0.7"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#brilho)"/>`
    + `<circle cx="${W * 0.15}" cy="${H * 0.88}" r="360" fill="#FFFFFF" fill-opacity="0.04"/>`;
}

async function fundo(imagem, paleta) {
  if (imagem) {
    try { return { buf: await sharp(imagem).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).png().toBuffer(), foto: true }; } catch { /* inválida: degradê */ }
  }
  return { buf: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${degradeSvg(paleta)}</svg>`)).png().toBuffer(), foto: false };
}

// Véu escuro: mais forte no meio-baixo (onde fica a frase), para o branco ler bem em qualquer foto.
const veu = (forca = 0.34) => `<defs><linearGradient id="veu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="${forca * 0.55}"/><stop offset="0.45" stop-color="#000" stop-opacity="${forca + 0.1}"/><stop offset="1" stop-color="#000" stop-opacity="${forca + 0.22}"/></linearGradient>`
  + `<filter id="sombra" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000" flood-opacity="0.45"/></filter></defs><rect width="${W}" height="${H}" fill="url(#veu)"/>`;

async function renderizarFrase(slide, ctx, imagem) {
  const d = slide.dados || {};
  const f = await fundo(imagem, d.paleta ?? ((ctx?.indice || 1) - 1));
  const elementos = ['tema_papel_de_parede', f.foto ? 'foto_de_fundo' : 'degrade_codigo'];
  const larg = W - 2 * MARGEM;
  // Faixa da frase: de 34% a 84% da altura (o relógio da tela de bloqueio fica em cima; a barra do celular, embaixo).
  const yIni = Math.round(H * 0.34); const yFim = Math.round(H * 0.84); const alt = yFim - yIni;
  const b = D.caber({ texto: String(slide.texto || '').trim(), k: 'mDisplay', larg, alt, max: 88, min: 54, ent: 1.12 });
  const ytop = Math.round(yIni + Math.max(0, (alt - b.altura) * 0.45));
  let svg = f.foto ? veu() : `<defs><filter id="sombra" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/></filter></defs>`;
  svg += `<rect x="${Math.round((W - 80) / 2)}" y="${ytop - 56}" width="80" height="8" rx="4" fill="${COR.laranja}"/>`;
  svg += `<g filter="url(#sombra)">${D.colocar(b, { x: MARGEM, ytop, cor: COR.branco, alinhar: 'centro', larguraBox: larg })}</g>`;
  svg += D.assinatura({ lado: 'centro', y: H - 64 });
  const blocos = [{ nome: 'frase', tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `A frase não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), altura_disponivel: alt }];
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(f.buf).composite([{ input: camada }]).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'papel_frase', elementos);
  m.tema = 'papel_de_parede';
  return { png, metrics: m };
}

// Capa: com foto (do Pedro, de preferência) a foto ocupa a tela e o título fica embaixo; sem foto, capa tipográfica forte.
async function renderizarCapa(slide, ctx, imagem) {
  const d = slide.dados || {};
  const f = await fundo(imagem, d.paleta ?? 0);
  const elementos = ['tema_papel_de_parede', 'capa_papel', f.foto ? 'foto_de_fundo' : 'capa_tipografica'];
  const larg = W - 2 * MARGEM;
  const texto = String(slide.texto || '').trim();
  let svg; let b; let alt;
  if (f.foto) {
    alt = 520;
    b = D.caber({ texto, k: 'mDisplay', larg, alt, max: 104, min: 72, ent: 1.06 });
    const ytop = Math.round(H - 150 - b.altura);
    svg = `<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/>`;
    svg += `<rect x="${MARGEM}" y="${ytop - 52}" width="96" height="10" rx="5" fill="${COR.laranja}"/>`;
    svg += D.colocar(b, { x: MARGEM, ytop, cor: COR.branco });
  } else {
    alt = 700;
    b = D.caber({ texto, k: 'mDisplay', larg, alt, max: 124, min: 80, ent: 1.04 });
    const ytop = Math.round(Math.max(200, (H - b.altura) / 2 - 40));
    svg = `<rect x="${MARGEM}" y="${ytop - 64}" width="120" height="12" rx="6" fill="${COR.laranja}"/>`;
    svg += D.colocar(b, { x: MARGEM, ytop, cor: COR.branco });
  }
  svg += D.assinatura({ dica: (ctx?.total || 1) > 1 ? 'deslize →' : '' });
  const blocos = [{ nome: 'capa', tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `A capa não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), altura_disponivel: alt }];
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(f.buf).composite([{ input: camada }]).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'papel_capa', elementos);
  m.tema = 'papel_de_parede';
  return { png, metrics: m };
}

async function renderizar(slide, ctx, imagem) {
  if (slide.layout === 'papel_capa' || (slide.funcao === 'capa' && slide.layout !== 'papel_frase')) return renderizarCapa(slide, ctx, imagem);
  return renderizarFrase(slide, ctx, imagem);
}

module.exports = { renderizar, renderizarCapa, renderizarFrase, DEGRADES };
