// Template "Minimalista — Estratégia por trás": 1080 × 1350 (4:5), fundo #FFFFFF, títulos #111111 em negrito, corpo #444444.
// Sem blocos coloridos, ícones, texturas, setas ou decoração. O minimalismo está no layout; as fotos mantêm a cor original.
// A composição NÃO muda o argumento: o texto vem do método de copy (metodo.js); aqui só se desenha e se mede.
// Regras iguais às do editorial: texto medido com a fonte real, nunca encolhido em silêncio, margem segura de 80 px,
// sem nome/@/avatar nas seis primeiras telas (só o encerramento leva a foto e o @ do Pedro).
require('../../fontSetup');
const path = require('path');
const sharp = require('sharp');
const A = require('../arte');
const E = require('./arte2');
const { ACCOUNT } = require('../account');

const { W, H } = E;
const M = 80;                    // margem lateral generosa
const LARG = W - 2 * M;          // 920
const Y_NUM = 1262;              // numeração discreta, na base
const COR = Object.freeze({ fundo: '#FFFFFF', titulo: '#111111', corpo: '#444444' });
const MIN = { titulo: 52, corpo: 34, legenda: 20, numero: 22 };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const TXT = (texto) => String(texto ?? '').replace(/\*\*/g, '').trim();

// Fonte de títulos: Inter Bold (negrito simples). Corpo: Inter Regular. Ambas já no repositório (SIL OFL).
const K_T = 'iNegrito'; const K_C = 'iCorpo';
const linhaTxt = (t, { x, y, k, tam, cor, ancora = 'start' }) => `<text x="${x}" y="${y}" font-family="${A.ARQ[k].familia}" font-weight="${A.ARQ[k].peso}" font-size="${tam}" fill="${cor}" text-anchor="${ancora}">${esc(t)}</text>`;

// Desenha um bloco medido (sem destaque, sem marcas): só a cor do texto muda entre título e corpo.
function bloco(b, { x, y, cor, k }) {
  const f = A.ARQ[k]; const lh = b.tam * b.entrelinha; let svg = '';
  b.linhas.forEach((ln, i) => {
    const base = y + i * lh + b.tam * 0.8;
    ln.forEach((w) => { svg += `<text x="${(x + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${f.familia}" font-weight="${f.peso}" font-size="${b.tam}" fill="${cor}">${esc(w.t)}</text>`; });
  });
  return svg;
}

// Foto sem moldura, sem sombra e sem cantos arredondados; recorte "cover" e cor original preservada.
// Print de aplicativo ou documento aparece INTEIRO (contain, fundo branco): recortar uma captura corta o que ela diz.
async function fotoPlana(buf, { x, y, w, h, enq = 'auto', inteira = false }) {
  const pos = { centro: 'centre', topo: 'top', baixo: 'bottom', esquerda: 'left', direita: 'right' }[enq] || sharp.strategy.attention;
  const ajuste = inteira ? { fit: 'contain', background: '#FFFFFF' } : { fit: 'cover', position: pos };
  const jpg = await sharp(buf, { limitInputPixels: 60e6 }).rotate().resize(Math.round(w), Math.round(h), ajuste).jpeg({ quality: 92 }).toBuffer();
  return `<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/jpeg;base64,${jpg.toString('base64')}"/>`;
}

const numero = (n, total) => linhaTxt(`${n}/${total}`, { x: W - M, y: Y_NUM, k: K_C, tam: MIN.numero, cor: COR.corpo, ancora: 'end' });

// Mede título e corpo juntos, dentro de uma altura. O título nunca fica menor que o mínimo; o corpo encolhe só até o mínimo legível.
function medir({ titulo, corpo, alt, tamTitulo = [96, MIN.titulo], tamCorpo = [40, MIN.corpo], gap = 36 }) {
  for (let tt = tamTitulo[0]; tt >= tamTitulo[1]; tt -= 2) {
    const bt = E.ajustar({ texto: titulo, k: K_T, larg: LARG, alt: 9999, max: tt, min: tt, entrelinha: 1.08 });
    if (!bt.cabe) continue;
    if (!corpo) { if (bt.altura <= alt) return { t: bt, c: null }; continue; }
    for (let tc = tamCorpo[0]; tc >= tamCorpo[1]; tc -= 2) {
      const bc = E.ajustar({ texto: corpo, k: K_C, larg: LARG, alt: 9999, max: tc, min: tc, entrelinha: 1.42 });
      if (!bc.cabe) continue;
      if (bt.altura + gap + bc.altura <= alt) return { t: bt, c: bc, gap };
    }
  }
  const bt = E.ajustar({ texto: titulo, k: K_T, larg: LARG, alt: 9999, max: tamTitulo[1], min: tamTitulo[1], entrelinha: 1.08 });
  const bc = corpo ? E.ajustar({ texto: corpo, k: K_C, larg: LARG, alt: 9999, max: tamCorpo[1], min: tamCorpo[1], entrelinha: 1.42 }) : null;
  const falta = Math.round(bt.altura + (bc ? gap + bc.altura : 0) - alt);
  return { t: { ...bt, cabe: false, motivo: `título e texto passam ${falta} px do espaço` }, c: bc ? { ...bc, cabe: false, motivo: 'sem espaço' } : null, gap, falhou: true };
}

// Telas: min_texto (só texto) · min_foto (foto + texto) · min_encerramento (foto do Pedro + convite).
async function lTexto(t, ctx, r) {
  let svg = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>`;
  const titulo = TXT(t.textos?.titulo); const corpo = TXT(t.textos?.corpo);
  const m = medir({ titulo, corpo, alt: 1000, tamTitulo: [92, MIN.titulo], tamCorpo: [40, MIN.corpo] });
  const y0 = 230;
  svg += bloco(m.t, { x: M, y: y0, cor: COR.titulo, k: K_T });
  if (m.c) svg += bloco(m.c, { x: M, y: y0 + m.t.altura + m.gap, cor: COR.corpo, k: K_C });
  r.blocos.push({ nome: 'título', tam: m.t.tam, cabe: m.t.cabe }, ...(m.c ? [{ nome: 'corpo', tam: m.c.tam, cabe: m.c.cabe }] : []));
  if (m.falhou) r.problemas.push(`${m.t.motivo}. Encurte o texto ou troque a composição`);
  return svg + numero(ctx.n, ctx.total);
}

async function lFoto(t, ctx, r) {
  let svg = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>`;
  const im = ctx.imagens?.[t.foto?.imagem_id]; const titulo = TXT(t.textos?.titulo); const corpo = TXT(t.textos?.corpo);
  const yFoto = 110; const hFoto = im ? 560 : 0;
  if (im) {
    svg += await fotoPlana(im.buf, { x: M, y: yFoto, w: LARG, h: hFoto, enq: t.foto?.enq, inteira: ['print', 'documento'].includes(im.papel) });
    if (im.credito) svg += linhaTxt(TXT(im.credito).slice(0, 70), { x: M, y: yFoto + hFoto + 30, k: K_C, tam: MIN.legenda, cor: COR.corpo });
  } else r.sem_imagem = true;
  const yTexto = im ? yFoto + hFoto + 84 : 230;
  const m = medir({ titulo, corpo, alt: Y_NUM - 40 - yTexto, tamTitulo: [72, MIN.titulo], tamCorpo: [34, MIN.corpo], gap: 26 });
  svg += bloco(m.t, { x: M, y: yTexto, cor: COR.titulo, k: K_T });
  if (m.c) svg += bloco(m.c, { x: M, y: yTexto + m.t.altura + m.gap, cor: COR.corpo, k: K_C });
  r.blocos.push({ nome: 'título', tam: m.t.tam, cabe: m.t.cabe });
  if (m.falhou) r.problemas.push(`${m.t.motivo}. Encurte o texto ou troque a composição`);
  return svg + numero(ctx.n, ctx.total);
}

let _pedro;
async function lEncerramento(t, ctx, r) {
  let svg = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>`;
  _pedro ||= await sharp(path.join(__dirname, '..', '..', 'assets', 'pedro-perfil.png')).png().toBuffer();
  const d = 380;
  // a foto aprovada entra sem alteração no rosto: só redimensiona, sem filtro nem moldura
  svg += `<image x="${M}" y="120" width="${d}" height="${d}" href="data:image/png;base64,${(await sharp(_pedro).resize(d, d, { fit: 'cover' }).png().toBuffer()).toString('base64')}"/>`;
  const titulo = TXT(t.textos?.titulo) || 'Segue para descobrir o próximo.';
  const apoio = TXT(t.textos?.apoio) || `Segue ${ACCOUNT.handle} para descobrir negócios que já funcionam no mundo.`;
  const m = medir({ titulo, corpo: apoio, alt: Y_NUM - 60 - (120 + d + 70), tamTitulo: [80, MIN.titulo], tamCorpo: [36, MIN.corpo], gap: 30 });
  const y0 = 120 + d + 70;
  svg += bloco(m.t, { x: M, y: y0, cor: COR.titulo, k: K_T });
  if (m.c) svg += bloco(m.c, { x: M, y: y0 + m.t.altura + m.gap, cor: COR.corpo, k: K_C });
  r.blocos.push({ nome: 'título', tam: m.t.tam, cabe: m.t.cabe });
  if (m.falhou) r.problemas.push(`${m.t.motivo}. Encurte o convite`);
  r.elementos.push('foto_do_pedro');
  return svg + numero(ctx.n, ctx.total);
}

const LAYOUTS = { min_texto: lTexto, min_foto: lFoto, min_encerramento: lEncerramento };

// tela: { layout, textos: {titulo, corpo, apoio}, foto: {imagem_id, enq} }. ctx: { n, total, imagens: { id: { buf, credito } } }
async function renderizarTela(tela, ctx = {}) {
  const fn = LAYOUTS[tela.layout]; if (!fn) throw Object.assign(new Error(`Composição minimalista desconhecida: ${tela.layout}`), { code: 'LAYOUT', status: 400 });
  const r = { blocos: [], problemas: [], elementos: [], sem_imagem: false };
  const svg = await fn(tela, ctx, r);
  const problemas = [...new Set(r.problemas)];
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`)).png().toBuffer();
  return { png, metrics: { layout: tela.layout, template: 'minimalista', cabe: problemas.length === 0, problemas, blocos: r.blocos, fonte_px: r.blocos.length ? Math.min(...r.blocos.map((b) => b.tam)) : null, caixas: [], sem_imagem: r.sem_imagem, elementos: r.elementos, largura: W, altura: H } };
}

module.exports = { renderizarTela, COR, M, MIN, LAYOUTS: Object.keys(LAYOUTS) };
