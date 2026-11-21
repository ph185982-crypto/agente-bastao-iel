// Tema "frase" (frase famosa, pedido do Pedro em 21/11): fundo preto ou branco, letra grande da marca (Manrope ExtraBold),
// texto alinhado à esquerda em formato de F (começa no alto, linhas curtas, leitura de cima para baixo pela esquerda),
// a palavra-chave em destaque e o Pedro Destrava embaixo (foto redonda, nome e @).
//  - fundo branco: palavra-chave em laranja (tom escuro o bastante para ler no branco em letra grande);
//  - fundo preto: palavra-chave em branco dentro de um retângulo laranja.
// Slide: { layout: 'frase_classica', tema_visual: 'frase', texto: 'frase com **palavra-chave**', dados: { fundo: 'preto'|'branco', autor } }
require('../fontSetup');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const A = require('./arte');
const D = require('./arteDialogo');
const { ACCOUNT } = require('./account');

const { W, H, esc, ARQ } = A;
const MARGEM = 96;
const COR = {
  preto: { fundo: '#0B0B0C', texto: '#FFFFFF', autor: '#A9ABB3', caixa: '#FF5A1F', caixaTexto: '#FFFFFF', nome: '#FFFFFF', handle: '#A9ABB3' },
  // #D9480F no branco: contraste 4,1:1 (texto grande pede 3:1). O laranja claro da marca (#FF7043) dá 2,9:1 e some.
  branco: { fundo: '#FFFFFF', texto: '#111114', autor: '#5B5E66', destaque: '#D9480F', nome: '#111114', handle: '#5B5E66' },
};
const FONTE = { max: 116, min: 64, ent: 1.1 };
let avatar = null;
const fotoPedro = () => (avatar ||= fs.readFileSync(path.join(__dirname, '..', 'assets', 'pedro-perfil.png')));

async function renderizar(slide) {
  const d = slide.dados || {};
  const tema = d.fundo === 'branco' ? 'branco' : 'preto'; const c = COR[tema];
  const larg = W - 2 * MARGEM;
  // A frase ocupa do topo (y 190) até acima do autor e da assinatura.
  // reserva embaixo: autor (~110 px) + assinatura (~300 px)
  const yIni = 190; const yFim = H - 300 - (String(d.autor || '').trim() ? 120 : 20);
  const b = D.caber({ texto: String(slide.texto || '').trim(), k: 'mDisplay', larg, alt: yFim - (yIni + 40), max: FONTE.max, min: FONTE.min, ent: FONTE.ent });
  let svg = `<rect width="${W}" height="${H}" fill="${c.fundo}"/>`;
  // aspas grandes no alto, discretas
  svg += `<text x="${MARGEM - 6}" y="${yIni - 40}" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="150" fill="${tema === 'branco' ? COR.branco.destaque : COR.preto.caixa}">“</text>`;
  const linhaH = b.tam * b.entrelinha; const y0 = yIni + 40;
  b.linhas.forEach((ln, i) => {
    const base = y0 + i * linhaH + b.tam * 0.92;
    // retângulo laranja atrás de palavras seguidas em destaque (fundo preto)
    if (tema === 'preto') {
      let ini = null;
      ln.forEach((w, j) => {
        if (w.hi && ini === null) ini = j;
        const fim = w.hi && (j === ln.length - 1 || !ln[j + 1].hi);
        if (fim) {
          const x1 = MARGEM + ln[ini].x - 14; const x2 = MARGEM + w.x + w.larg + 14;
          svg += `<rect x="${x1.toFixed(1)}" y="${(base - b.tam * 0.86).toFixed(1)}" width="${(x2 - x1).toFixed(1)}" height="${(b.tam * 1.1).toFixed(1)}" rx="10" fill="${c.caixa}"/>`;
          ini = null;
        }
      });
    }
    ln.forEach((w) => {
      const cor = w.hi ? (tema === 'branco' ? c.destaque : c.caixaTexto) : c.texto;
      svg += `<text x="${(MARGEM + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="${b.tam}" fill="${cor}">${esc(w.t)}</text>`;
    });
  });
  const yTextoFim = y0 + (b.linhas.length - 1) * linhaH + b.tam * 1.1;
  const autor = String(d.autor || '').trim();
  if (autor) svg += `<text x="${MARGEM}" y="${Math.round(yTextoFim + 70)}" font-family="${ARQ.iSemi.familia}" font-weight="600" font-size="42" fill="${c.autor}">— ${esc(autor)}</text>`;
  // Pedro Destrava embaixo, à esquerda (fecha o F)
  const yA = H - 190; const r = 54;
  svg += `<text x="${MARGEM + 2 * r + 28}" y="${yA + 8}" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="44" fill="${c.nome}">Pedro Destrava</text>`;
  svg += `<text x="${MARGEM + 2 * r + 28}" y="${yA + 58}" font-family="${ARQ.iSemi.familia}" font-weight="600" font-size="34" fill="${c.handle}">${esc(ACCOUNT.handle || '@pedro_destrava')}</text>`;
  const circ = Buffer.from(`<svg width="${2 * r}" height="${2 * r}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
  const foto = await sharp(fotoPedro()).resize(2 * r, 2 * r, { fit: 'cover', position: 'attention' }).composite([{ input: circ, blend: 'dest-in' }]).png().toBuffer();
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(camada).composite([{ input: foto, left: MARGEM, top: yA - r - 4 }]).png().toBuffer();
  const blocos = [{ nome: 'frase', tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `A frase não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), altura_disponivel: yFim - yIni }];
  const m = A.resumirMetricas(blocos, 'frase_classica', ['tema_frase', `fundo_${tema}`, ...(b.linhas.some((l) => l.some((w) => w.hi)) ? ['palavra_chave'] : []), ...(autor ? ['autor'] : []), 'assinatura_pedro']);
  m.tema = 'frase';
  return { png, metrics: m };
}

module.exports = { renderizar, COR };
