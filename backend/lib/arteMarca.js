// Tema "marca" ("Por trás da marca"): o mecanismo dos posts de negócios de revista (foto da loja/do fundador de ponta a
// ponta, degradê escuro embaixo, manchete branca grande, etiqueta pequena), com a identidade do Pedro: etiqueta laranja
// "POR TRÁS DA MARCA", Manrope ExtraBold, Inter no texto e a assinatura @pedro_destrava. Nada da arte de outro veículo.
//
// Slides (no modelo de conteúdo):
//  - 'marca_capa':  foto sangrada + degradê + etiqueta + nome da marca + manchete + "deslize →";
//  - 'marca_tela':  foto em cima (~55%) e bloco de texto embaixo, em fundo escuro (rótulo laranja, título, texto);
//  - 'marca_final': retrato do Pedro (a foto dele, sem nenhuma alteração do rosto: só recorte e degradê na borda) +
//                   frase de posicionamento + chamada grande para seguir.
//  dados: { marca, cor (hex da marca, para o fundo feito por código), rotulo, kicker }
// Sem foto, o fundo é um degradê na cor da marca feito pelo código. Sem a foto do Pedro, um retrato provisório (silhueta).
// Todo texto é medido com a fonte real: se não couber no mínimo legível, a arte sai cabe:false e a revisão bloqueia.
require('../fontSetup');
const sharp = require('sharp');
const A = require('./arte');
const D = require('./arteDialogo');
const { ACCOUNT } = require('./account');

const { W, H, esc, ARQ } = A;
const MARGEM = 72;
const COR = { branco: '#FFFFFF', laranja: '#FF7043', grafite: '#18191D', fundo: '#0F1013', apoio: '#D7D9DF' };
const COR_PADRAO = '#1F2A44';
const FOTO_TELA = Math.round(H * 0.55); // 742 px de foto nas telas de conteúdo
const KICKER = 'POR TRÁS DA MARCA';
const LIMITES = {
  capa: { max: 104, min: 64, ent: 1.03, alt: 600 },
  titulo: { max: 64, min: 44, ent: 1.06 },
  corpo: { max: 40, min: 32, ent: 1.3 },
  final_titulo: { max: 62, min: 44, ent: 1.08 },
  final_cta: { max: 76, min: 52, ent: 1.06 },
};

const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : COR_PADRAO);
const limpa = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Escurece/clareia um hex (fator < 1 escurece).
function tom(h, f) {
  const n = parseInt(hex(h).slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.max(0, Math.min(255, Math.round(f < 1 ? x * f : x + (255 - x) * (f - 1)))));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// Fundo feito por código na cor da marca (sem foto): degradê escuro, brilho e formas suaves. Sem texto, sem logotipo.
function fundoCorSvg(cor, alt = H, { nome = '' } = {}) {
  const c1 = tom(cor, 0.85); const c2 = tom(cor, 0.32);
  let s = `<defs><clipPath id="cm"><rect width="${W}" height="${alt}"/></clipPath><linearGradient id="gm" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`
    + `<radialGradient id="bm" cx="0.8" cy="0.15" r="0.75"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${W}" height="${alt}" fill="url(#gm)"/><rect width="${W}" height="${alt}" fill="url(#bm)"/><g clip-path="url(#cm)">`
    + `<circle cx="${W * 0.12}" cy="${alt * 0.82}" r="${Math.round(alt * 0.34)}" fill="#FFFFFF" fill-opacity="0.05"/>`
    + `<circle cx="${W * 0.92}" cy="${alt * 0.5}" r="${Math.round(alt * 0.22)}" fill="#FFFFFF" fill-opacity="0.04"/>`;
  // nome da marca em letra enorme e quase transparente (textura, não logotipo), medido para caber na largura
  if (nome) {
    const n = limpa(nome, 18).toUpperCase(); const larg = W - 2 * MARGEM;
    const tam = Math.max(60, Math.min(220, Math.floor((larg / Math.max(1, A.largura('mDisplay', n, 100))) * 100)));
    s += `<text x="${MARGEM}" y="${Math.round(alt * 0.3 + tam * 0.36)}" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="${tam}" fill="#FFFFFF" fill-opacity="0.07">${esc(n)}</text>`;
  }
  return `${s}</g>`;
}

async function camadaFoto(imagem, largura, altura, posicao = 'attention') {
  if (!imagem) return null;
  try { return await sharp(imagem).rotate().resize(largura, altura, { fit: 'cover', position: posicao }).png().toBuffer(); } catch { return null; }
}

// Etiqueta em pílula. `cheia`: fundo laranja e texto grafite; senão vidro escuro com borda clara e texto branco.
function etiqueta(texto, { x, y, cheia = true, tam = 24 }) {
  const t = limpa(texto, 28).toUpperCase(); if (!t) return { svg: '', largura: 0 };
  const larg = Math.round(A.largura('mRotulo', t, tam, 2)) + 40; const alt = Math.round(tam * 1.9);
  const svg = cheia
    ? `<rect x="${x}" y="${y}" width="${larg}" height="${alt}" rx="${alt / 2}" fill="${COR.laranja}"/><text x="${x + 20}" y="${Math.round(y + alt * 0.66)}" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="${tam}" letter-spacing="2" fill="${COR.grafite}">${esc(t)}</text>`
    : `<rect x="${x}" y="${y}" width="${larg}" height="${alt}" rx="${alt / 2}" fill="#000000" fill-opacity="0.35" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="2"/><text x="${x + 20}" y="${Math.round(y + alt * 0.66)}" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="${tam}" letter-spacing="2" fill="#FFFFFF">${esc(t)}</text>`;
  return { svg, largura: larg };
}

const bloco = (nome, b, alt, rotulo) => ({ nome, tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `${rotulo} não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), altura_disponivel: Math.round(alt) });
const vazio = () => ({ tam: null, linhas: [], altura: 0, cabe: true });

async function compor(base, svg, layout, blocos, elementos) {
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(base).composite([{ input: camada }]).png().toBuffer();
  const m = A.resumirMetricas(blocos, layout, elementos);
  m.tema = 'marca';
  return { png, metrics: m };
}

// Logo da marca na capa: num cartão branco arredondado (cores originais; logo quase todo branco vira silhueta escura).
// Quem ainda não conhece a marca pela foto a reconhece pelo logo.
async function placaLogo(buf, maxW = 520, maxH = 130) {
  let img = sharp(buf).trim().resize(maxW, maxH, { fit: 'inside' });
  const meta = await sharp(buf).metadata();
  const { data, info } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let soma = 0, n = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { soma += (data[i] + data[i + 1] + data[i + 2]) / 3; n++; }
  let png;
  if (meta.hasAlpha && n && soma / n > 215) { for (let i = 0; i < data.length; i += 4) { data[i] = 11; data[i + 1] = 27; data[i + 2] = 51; } png = await sharp(data, { raw: info }).png().toBuffer(); }
  else png = await img.flatten({ background: '#FFFFFF' }).png().toBuffer();
  const m = await sharp(png).metadata(); const pad = 26;
  const w = m.width + 2 * pad, h = m.height + 2 * pad;
  const fundo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="26" fill="#FFFFFF"/></svg>`);
  const placa = await sharp(fundo).composite([{ input: png, left: pad, top: pad }]).png().toBuffer();
  return { png: placa, w, h };
}

// ── Capa ────────────────────────────────────────────────────────────────────────
async function renderizarCapa(slide, ctx, imagem) {
  const d = slide.dados || {}; const cor = hex(d.cor);
  const foto = await camadaFoto(imagem, W, H);
  const base = foto || await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${fundoCorSvg(cor, H, { nome: d.marca })}</svg>`)).png().toBuffer();
  const elementos = ['tema_marca', 'capa_marca', foto ? 'foto_sangrada' : 'fundo_cor_marca'];
  const larg = W - 2 * MARGEM; const L = LIMITES.capa;
  const texto = String(slide.texto || '').trim();
  const b = D.caber({ texto, k: 'mDisplay', larg, alt: L.alt, max: L.max, min: L.min, ent: L.ent });
  const ybase = H - 150; const ytop = Math.round(ybase - b.altura);
  // degradê escuro embaixo (onde fica a manchete) e véu leve em cima (onde ficam as etiquetas)
  let svg = `<defs><linearGradient id="vb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.38"/><stop offset="0.16" stop-color="#000" stop-opacity="0"/><stop offset="0.38" stop-color="#000" stop-opacity="0"/><stop offset="0.66" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0.94"/></linearGradient>`
    + `<filter id="sm" x="-5%" y="-10%" width="110%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000" flood-opacity="0.5"/></filter></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#vb)"/>`;
  const k = etiqueta(d.kicker || KICKER, { x: MARGEM, y: MARGEM });
  svg += k.svg;
  if (d.marca) svg += etiqueta(d.marca, { x: MARGEM + k.largura + 14, y: MARGEM, cheia: false }).svg;
  let placa = null;
  if (d.logo_id) {
    try { const x = (await require('./armazem').armazem().arquivos.obter(ACCOUNT.ig_id, `img:${d.logo_id}`))?.dados; if (x) placa = await placaLogo(Buffer.from(x)); } catch { placa = null; }
  }
  svg += `<rect x="${MARGEM}" y="${ytop - 40}" width="88" height="9" rx="4.5" fill="${COR.laranja}"/>`;
  svg += `<g filter="url(#sm)">${D.colocar(b, { x: MARGEM, ytop, cor: COR.branco, destaque: COR.laranja })}</g>`;
  svg += D.assinatura({ dica: (ctx?.total || 1) > 1 ? 'deslize →' : '' });
  const r = await compor(base, svg, 'marca_capa', [bloco('manchete', b, L.alt, 'A manchete')], placa ? [...elementos, 'logo_marca'] : elementos);
  if (!placa) return r;
  // o logo entra por cima de tudo, logo abaixo das etiquetas
  r.png = await sharp(r.png).composite([{ input: placa.png, left: MARGEM, top: MARGEM + 84 }]).png().toBuffer();
  return r;
}

// ── Telas de conteúdo ───────────────────────────────────────────────────────────
async function renderizarTela(slide, ctx, imagem) {
  const d = slide.dados || {}; const cor = hex(d.cor);
  const foto = await camadaFoto(imagem, W, FOTO_TELA);
  const elementos = ['tema_marca', 'tela_marca', foto ? 'foto_topo' : 'fundo_cor_marca'];
  const fundo = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>${foto ? '' : fundoCorSvg(cor, FOTO_TELA, { nome: d.marca })}`;
  let base = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${fundo}</svg>`)).png().toBuffer();
  if (foto) base = await sharp(base).composite([{ input: foto, top: 0, left: 0 }]).png().toBuffer();
  const larg = W - 2 * MARGEM;
  // a foto se dissolve no fundo escuro: a emenda nunca fica dura
  let svg = `<defs><linearGradient id="fd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COR.fundo}" stop-opacity="0"/><stop offset="1" stop-color="${COR.fundo}" stop-opacity="1"/></linearGradient></defs>`
    + `<rect x="0" y="${FOTO_TELA - 170}" width="${W}" height="172" fill="url(#fd)"/>`;
  if (d.marca) svg += etiqueta(d.marca, { x: MARGEM, y: MARGEM, cheia: false, tam: 22 }).svg;
  const yRot = FOTO_TELA + 18;
  const rotulo = limpa(d.rotulo || '', 40);
  if (rotulo) svg += A.rotuloSvg(rotulo, { x: MARGEM, y: yRot + 22, tam: 26, cor: COR.laranja, espaco: 3, fam: 'mRotulo' });
  const yIni = yRot + (rotulo ? 58 : 10); const yFim = H - 118; const disp = yFim - yIni;
  const titulo = String(slide.titulo || '').trim(); const texto = String(slide.texto || '').trim();
  const T = LIMITES.titulo; const C = LIMITES.corpo; const gap = 50;
  let bt = titulo ? D.caber({ texto: titulo, k: 'mDisplay', larg, alt: Math.min(disp * 0.5, 3 * T.max * T.ent), max: T.max, min: T.min, ent: T.ent }) : vazio();
  let altCorpo = disp - (titulo ? bt.altura + gap : 0);
  let bc = texto ? D.caber({ texto, k: 'iCorpo', larg, alt: altCorpo, max: C.max, min: C.min, ent: C.ent }) : vazio();
  // corpo apertado: o título desce de tamanho antes do corpo ficar no mínimo
  if (titulo && texto && !bc.cabe) {
    bt = D.caber({ texto: titulo, k: 'mDisplay', larg, alt: Math.min(disp * 0.5, 3 * T.max * T.ent), max: T.min + 8, min: T.min, ent: T.ent });
    altCorpo = disp - (bt.altura + gap);
    bc = D.caber({ texto, k: 'iCorpo', larg, alt: altCorpo, max: C.max, min: C.min, ent: C.ent });
  }
  let y = yIni;
  if (titulo) { svg += D.colocar(bt, { x: MARGEM, ytop: y, cor: COR.branco, destaque: COR.laranja }); y += bt.altura + gap; }
  if (texto) svg += D.colocar(bc, { x: MARGEM, ytop: y, cor: COR.apoio, destaque: COR.branco });
  svg += D.assinatura({ dica: (ctx?.indice || 1) < (ctx?.total || 1) ? '→' : '' });
  const blocos = [...(titulo ? [bloco('titulo', bt, disp * 0.5, 'O título')] : []), ...(texto ? [bloco('texto', bc, altCorpo, 'O texto')] : [])];
  return compor(base, svg, 'marca_tela', blocos, elementos);
}

// Retrato provisório (sem a foto do Pedro): silhueta neutra sobre o laranja. Não é o rosto de ninguém.
function retratoProvisorioSvg(alt) {
  const cx = W / 2; const cab = Math.round(alt * 0.17);
  return `<defs><linearGradient id="rp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A5C"/><stop offset="1" stop-color="#E2562A"/></linearGradient></defs>`
    + `<rect width="${W}" height="${alt}" fill="url(#rp)"/>`
    + `<circle cx="${cx}" cy="${Math.round(alt * 0.42)}" r="${cab}" fill="#3B2A22" fill-opacity="0.9"/>`
    + `<path d="M ${cx - cab * 2.4} ${alt} C ${cx - cab * 2.3} ${alt * 0.72}, ${cx - cab * 1.2} ${alt * 0.64}, ${cx} ${alt * 0.64} C ${cx + cab * 1.2} ${alt * 0.64}, ${cx + cab * 2.3} ${alt * 0.72}, ${cx + cab * 2.4} ${alt} Z" fill="#3B2A22" fill-opacity="0.9"/>`;
}

// ── Último slide: o Pedro e a chamada para seguir ───────────────────────────────
const RETRATO = 880;
async function renderizarFinal(slide, ctx, imagem) {
  // retrato grande: a foto inteira dele, só recortada (posição pelo rosto/atenção), sem filtro no rosto
  const foto = await camadaFoto(imagem, W, RETRATO, 'attention');
  const elementos = ['tema_marca', 'final_marca', 'chamada_seguir', foto ? 'foto_do_pedro' : 'retrato_provisorio'];
  let base = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${COR.fundo}"/>${foto ? '' : retratoProvisorioSvg(RETRATO)}</svg>`)).png().toBuffer();
  if (foto) base = await sharp(base).composite([{ input: foto, top: 0, left: 0 }]).png().toBuffer();
  const larg = W - 2 * MARGEM;
  let svg = `<defs><linearGradient id="ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COR.fundo}" stop-opacity="0"/><stop offset="1" stop-color="${COR.fundo}" stop-opacity="1"/></linearGradient></defs>`
    + `<rect x="0" y="${RETRATO - 240}" width="${W}" height="242" fill="url(#ff)"/>`;
  const titulo = String(slide.titulo || '').trim();
  // a chamada: o @ sai em laranja (destaque) mesmo que o texto venha sem asteriscos
  let cta = String(slide.texto || slide.cta || '').trim();
  if (cta && !/\*\*/.test(cta)) cta = cta.replace(/@?pedro_destrava/i, (m) => `**${m.startsWith('@') ? m : `@${m}`}**`);
  const yIni = RETRATO - 150; const yFim = H - 124; const disp = yFim - yIni; const gap = 66;
  const TT = LIMITES.final_titulo; const CC = LIMITES.final_cta;
  const altT = Math.round(disp * 0.5);
  const bt = titulo ? D.caber({ texto: titulo, k: 'mDisplay', larg, alt: altT, max: TT.max, min: TT.min, ent: TT.ent }) : vazio();
  const altC = disp - (titulo ? bt.altura + gap : 0);
  const bc = cta ? D.caber({ texto: cta, k: 'mDisplay', larg, alt: altC, max: CC.max, min: CC.min, ent: CC.ent }) : vazio();
  // o bloco encosta embaixo (perto da assinatura): o retrato fica com o máximo de espaço
  const total = (titulo ? bt.altura : 0) + (titulo && cta ? gap : 0) + (cta ? bc.altura : 0);
  let y = Math.round(Math.max(yIni, yFim - total));
  if (titulo) { svg += D.colocar(bt, { x: MARGEM, ytop: y, cor: COR.apoio, destaque: COR.branco }); y += bt.altura + gap; }
  if (cta) { svg += `<rect x="${MARGEM}" y="${y - 36}" width="72" height="8" rx="4" fill="${COR.laranja}"/>`; svg += D.colocar(bc, { x: MARGEM, ytop: y, cor: COR.branco, destaque: COR.laranja }); }
  // sem a assinatura pequena: o @ já está grande na chamada
  const blocos = [...(titulo ? [bloco('posicionamento', bt, altT, 'A frase final')] : []), ...(cta ? [bloco('cta_seguir', bc, altC, 'A chamada para seguir')] : [])];
  const r = await compor(base, svg, 'marca_final', blocos, elementos);
  if (!cta || !new RegExp(ACCOUNT.handle.slice(1), 'i').test(cta)) { r.metrics.cabe = false; r.metrics.problemas.push(`O último slide precisa da chamada para seguir ${ACCOUNT.handle}.`); }
  return r;
}

async function renderizar(slide, ctx, imagem) {
  if (slide.layout === 'marca_final' || slide.funcao === 'encerramento') return renderizarFinal(slide, ctx, imagem);
  if (slide.layout === 'marca_capa' || slide.funcao === 'capa') return renderizarCapa(slide, ctx, imagem);
  return renderizarTela(slide, ctx, imagem);
}

module.exports = { renderizar, renderizarCapa, renderizarTela, renderizarFinal, fundoCorSvg, KICKER, COR_PADRAO, FOTO_TELA, LIMITES, hex };
