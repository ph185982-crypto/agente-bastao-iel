// Tema "tweet": o carrossel que mais engaja no nicho (referência: posts do @thiago.nigro com 150–380 mil curtidas).
// Fundo branco, cabeçalho de rede social (avatar redondo do Pedro, nome e @), UMA frase por slide em Inter grande, foto
// colorida de canto arredondado embaixo quando houver, seta "→" puxando o próximo slide. Parece conversa, não anúncio.
// O último slide fecha com a posição do Pedro e a chamada para seguir. Nenhum selo de verificação: a conta não tem.
require('../fontSetup');
const sharp = require('sharp');
const path = require('path');
const A = require('./arte');
const { ACCOUNT } = require('./account');

const { W, H, esc, ARQ } = A;
const MARGEM = 72; const LARG = W - 2 * MARGEM;
const COR = { fundo: '#FFFFFF', texto: '#0F1419', mudo: '#536471', linha: '#E6E8EB', marca: '#2448FF' };
const AVATAR = path.join(__dirname, '..', 'assets', 'pedro-perfil.png');
const NOME = ACCOUNT.nome || 'Pedro Martins';
const D_AVATAR = 108; const Y_TOPO = 84;

let _avatar;
async function avatar() {
  if (_avatar) return _avatar;
  const foto = await sharp(AVATAR).resize(D_AVATAR, D_AVATAR, { fit: 'cover' }).png().toBuffer();
  const mascara = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${D_AVATAR}" height="${D_AVATAR}"><circle cx="${D_AVATAR / 2}" cy="${D_AVATAR / 2}" r="${D_AVATAR / 2}" fill="#fff"/></svg>`);
  _avatar = await sharp(foto).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer();
  return _avatar;
}

const cap = (k) => (k === 'iCorpo' ? 0.727 : k === 'iNegrito' ? 0.727 : 0.73);
// Maior tamanho em que o texto cabe (altura medida pela altura visual das linhas).
function fit({ texto, k, larg, alt, max, min, ent = 1.18, papel }) {
  const minimo = Math.max(min, A.MINIMO[papel] || 0);
  const vis = (q, tam) => (q.linhas.length - 1) * tam * ent + cap(k) * tam;
  for (let tam = max; tam >= minimo; tam -= 2) {
    const q = A.quebrar(texto, k, tam, larg, { colchetes: false });
    if (!q.largaDemais && vis(q, tam) <= alt) return { tam, linhas: q.linhas, entrelinha: ent, altura: vis(q, tam), cabe: true, minimo, papel, k };
  }
  const q = A.quebrar(texto, k, minimo, larg, { colchetes: false });
  const h = vis(q, minimo);
  return { tam: minimo, linhas: q.linhas, entrelinha: ent, altura: h, cabe: false, sobra: Math.max(0, Math.round(h - alt)), minimo, papel, k };
}
const colocar = (b, { x, ytop, k, cor }) => A.textoSvg(b, { x, y: ytop - (0.92 - cap(k)) * b.tam, k, tema: { texto: cor, destaque: cor, colchete: 'none' } });

function cabecalho() {
  const xT = MARGEM + D_AVATAR + 24;
  return `<text x="${xT}" y="${Y_TOPO + 44}" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="36" fill="${COR.texto}">${esc(NOME)}</text>` +
    `<text x="${xT}" y="${Y_TOPO + 88}" font-family="${ARQ.iCorpo.familia}" font-weight="400" font-size="30" fill="${COR.mudo}">${esc(ACCOUNT.handle)}</text>`;
}

async function renderizar(slide, ctx, imagem) {
  const { indice = 1, total = 1 } = ctx || {};
  const ultimo = slide.funcao === 'encerramento' || indice === total;
  const blocos = []; const elementos = ['tema_tweet'];
  const yTexto = Y_TOPO + D_AVATAR + 56;
  const yFim = H - 150; // acima da seta/rodapé
  let svg = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>` + cabecalho();
  if (total > 1) svg += `<text x="${W - MARGEM}" y="${Y_TOPO + 44}" text-anchor="end" font-family="${ARQ.iCorpo.familia}" font-size="26" fill="${COR.mudo}">${indice}/${total}</text>`;

  const camadas = [{ input: await avatar(), left: MARGEM, top: Y_TOPO }];
  let temFoto = false; let foto = null;
  if (imagem && !ultimo) {
    try {
      const meta = await sharp(imagem).metadata();
      const w = LARG; const h = Math.min(560, Math.round(w * 0.62));
      const mascara = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="28" ry="28" fill="#fff"/></svg>`);
      const corpo = await sharp(imagem).rotate().resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
      const input = await sharp(corpo).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer();
      foto = { input, w, h, baixa: (meta.width || 0) < 700 }; temFoto = true;
      elementos.push('foto_colorida'); if (foto.baixa) elementos.push('foto_baixa_resolucao');
    } catch { elementos.push('foto_invalida'); }
  }

  // Texto: ocupa o alto; com foto, a foto fica logo abaixo do texto (como num tweet com imagem).
  const altTexto = temFoto ? yFim - yTexto - foto.h - 40 : yFim - yTexto;
  const texto = String(slide.titulo && ultimo ? `**${slide.titulo}** ${slide.texto || ''}` : slide.texto || '').trim();
  const b = fit({ texto, k: 'iCorpo', larg: LARG, alt: altTexto, max: temFoto ? 60 : 72, min: 40, papel: 't_corpo' });
  svg += colocar(b, { x: MARGEM, ytop: yTexto, k: 'iCorpo', cor: COR.texto });
  blocos.push({ nome: 'texto', ...A.resumo(b, altTexto) });
  let y = yTexto + b.altura;
  if (temFoto) { camadas.push({ input: foto.input, left: MARGEM, top: Math.round(y + 40) }); y += 40 + foto.h; }

  if (ultimo) {
    // Fechamento: posição do Pedro + chamada para seguir, em linha discreta, como assinatura.
    const cta = String(slide.cta_apoio ? `${slide.cta || `Segue o ${ACCOUNT.handle}`} ${slide.cta_apoio}.` : slide.cta || `Segue o ${ACCOUNT.handle}`).replace(/\.\.$/, '.');
    const c = fit({ texto: cta, k: 'iNegrito', larg: LARG, alt: 160, max: 40, min: 30, ent: 1.2, papel: 't_cta' });
    const yc = Math.max(y + 56, H - 120 - c.altura);
    svg += `<rect x="${MARGEM}" y="${yc - 36}" width="120" height="6" fill="${COR.marca}"/>`;
    svg += colocar(c, { x: MARGEM, ytop: yc, k: 'iNegrito', cor: COR.marca });
    blocos.push({ nome: 'cta', ...A.resumo(c, 160) });
    if (yc + c.altura > H - 60) blocos[blocos.length - 1].cabe = false;
  } else {
    svg += `<text x="${W - MARGEM}" y="${H - 72}" text-anchor="end" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="64" fill="${COR.texto}">→</text>`;
  }

  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`;
  const png = await sharp(Buffer.from(base)).png().composite(camadas).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'tweet', elementos);
  m.tema = 'tweet';
  if (foto) m.foto = { largura: foto.w, altura: foto.h, ampliacao: 1 };
  return { png, metrics: m };
}

module.exports = { renderizar, COR };
