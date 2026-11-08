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

// CAPA (1º slide): é o que para o dedo. Título GRANDE em negrito com a expressão-chave em marca-texto amarelo, e a foto ocupando toda a
// parte de baixo, de ponta a ponta (sem faixa branca vazia), com a seta num círculo branco por cima da foto.
// A IA às vezes marca o destaque com um asterisco só ("*Impõe*"): vira destaque de verdade, sem asterisco aparecendo.
const destaque = (t) => String(t || '').replace(/(?<!\*)\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?!\*)/g, '**$1**');
async function renderizarCapa(slide, ctx, imagem) {
  const { total = 1 } = ctx || {};
  const blocos = []; const elementos = ['tema_tweet', 'capa_tweet'];
  const yTexto = Y_TOPO + D_AVATAR + 52;
  let svg = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>` + cabecalho();
  if (total > 1) svg += `<text x="${W - MARGEM}" y="${Y_TOPO + 44}" text-anchor="end" font-family="${ARQ.iCorpo.familia}" font-size="26" fill="${COR.mudo}">1/${total}</text>`;
  const camadas = [{ input: await avatar(), left: MARGEM, top: Y_TOPO }];
  const texto = destaque(slide.texto).trim();
  let foto = null;
  if (imagem) { try { foto = { meta: await sharp(imagem).metadata() }; } catch { elementos.push('foto_invalida'); } }
  if (foto) {
    // título até ~40% da altura; a foto pega todo o resto, até a borda de baixo
    const b = fit({ texto, k: 'iNegrito', larg: LARG, alt: 500, max: 92, min: 54, ent: 1.08, papel: 't_capa' });
    svg += A.textoSvg(b, { x: MARGEM, y: yTexto - (0.92 - cap('iNegrito')) * b.tam, k: 'iNegrito', cor: COR.texto, marcador: true });
    blocos.push({ nome: 'titulo', ...A.resumo(b, 500) });
    const yFoto = Math.round(yTexto + b.altura + 48); const hFoto = H - yFoto;
    // Recorte que preserva o rosto: foto vertical é cortada a partir de ~12% do topo (rostos ficam no terço de cima);
    // foto mais larga que a área usa o recorte por atenção.
    const larga = await sharp(imagem).rotate().resize({ width: W }).toBuffer({ resolveWithObject: true });
    const corpo = larga.info.height >= hFoto
      ? await sharp(larga.data).extract({ left: 0, top: Math.round(0.12 * (larga.info.height - hFoto)), width: W, height: hFoto }).png().toBuffer()
      : await sharp(imagem).rotate().resize(W, hFoto, { fit: 'cover', position: 'attention' }).png().toBuffer();
    camadas.push({ input: corpo, left: 0, top: yFoto });
    elementos.push('foto_colorida', 'foto_sangrada'); if ((foto.meta.width || 0) < 700) elementos.push('foto_baixa_resolucao');
    if (hFoto < 520) elementos.push('foto_pequena');
    foto = { w: W, h: hFoto };
  } else {
    const alt = H - 150 - yTexto;
    const b = fit({ texto, k: 'iNegrito', larg: LARG, alt, max: 112, min: 60, ent: 1.06, papel: 't_capa' });
    svg += A.textoSvg(b, { x: MARGEM, y: yTexto + Math.max(0, (alt - b.altura) / 2) - (0.92 - cap('iNegrito')) * b.tam, k: 'iNegrito', cor: COR.texto, marcador: true });
    blocos.push({ nome: 'titulo', ...A.resumo(b, alt) });
  }
  // seta num círculo branco com sombra, por cima da foto (ou do fundo); post único (1 imagem) não tem para onde deslizar
  if (total > 1) {
    const seta = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.35"/></filter></defs><circle cx="75" cy="75" r="54" fill="#fff" filter="url(#s)"/><text x="75" y="96" text-anchor="middle" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="60" fill="${COR.texto}">→</text></svg>`;
    camadas.push({ input: Buffer.from(seta), left: W - MARGEM - 120, top: H - 168 });
  } else elementos.push('post_unico');
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`;
  const png = await sharp(Buffer.from(base)).png().composite(camadas).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'tweet', elementos);
  m.tema = 'tweet';
  if (foto) m.foto = { largura: foto.w, altura: foto.h, ampliacao: 1 };
  return { png, metrics: m };
}

// ── Variante "ensaio": texto corrido em fundo escuro, sem foto ─────────────────────────────────────────────────────────
// Mesmo cabeçalho do tweet (avatar, nome, @), Inter branca 54–64 px, 2–3 parágrafos por slide. O 1º slide abre com o 1º
// parágrafo maior (slide.titulo); o último traz a frase de ouro em amarelo e o pedido de envio.
const COR_E = { fundo: '#0B0B0C', texto: '#FFFFFF', mudo: '#A1A1AA', ouro: '#FDE047', linha: '#2A2B30' };
const paragrafosDe = (txt) => String(txt || '').split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);

// Maior tamanho em que TODOS os parágrafos cabem juntos (mesmo corpo de letra; `gap` em múltiplos do tamanho).
function fitParagrafos({ paragrafos, k, larg, alt, max, min, ent = 1.3, gap = 0.75, papel }) {
  const minimo = Math.max(min, A.MINIMO[papel] || 0);
  const mede = (tam) => {
    const qs = paragrafos.map((p) => A.quebrar(p, k, tam, larg, { colchetes: false }));
    const alturas = qs.map((q) => (q.linhas.length - 1) * tam * ent + cap(k) * tam);
    const altura = alturas.reduce((a, b) => a + b, 0) + Math.max(0, qs.length - 1) * gap * tam;
    return { qs, alturas, altura, largaDemais: qs.some((q) => q.largaDemais) };
  };
  for (let tam = max; tam >= minimo; tam -= 2) {
    const r = mede(tam);
    if (!r.largaDemais && r.altura <= alt) return { tam, entrelinha: ent, gap, cabe: true, minimo, papel, k, ...r, linhas: r.qs.flatMap((q) => q.linhas) };
  }
  const r = mede(minimo);
  return { tam: minimo, entrelinha: ent, gap, cabe: false, sobra: Math.max(0, Math.round(r.altura - alt)), minimo, papel, k, ...r, linhas: r.qs.flatMap((q) => q.linhas) };
}
// Desenha os parágrafos medidos, um abaixo do outro; palavras entre ** saem em negrito e na cor de destaque.
function colocarParagrafos(b, { x, ytop, cor, corDestaque }) {
  let y = ytop; let out = '';
  b.qs.forEach((q, i) => {
    const bloco = { tam: b.tam, entrelinha: b.entrelinha, linhas: q.linhas };
    out += A.textoSvg(bloco, { x, y: y - (0.92 - cap(b.k)) * b.tam, k: b.k, tema: { texto: cor, destaque: corDestaque || cor, colchete: 'none' } });
    y += b.alturas[i] + b.gap * b.tam;
  });
  return out;
}

function cabecalhoEscuro() {
  const xT = MARGEM + D_AVATAR + 24;
  return `<text x="${xT}" y="${Y_TOPO + 44}" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="36" fill="${COR_E.texto}">${esc(NOME)}</text>` +
    `<text x="${xT}" y="${Y_TOPO + 88}" font-family="${ARQ.iCorpo.familia}" font-weight="400" font-size="30" fill="${COR_E.mudo}">${esc(ACCOUNT.handle)}</text>`;
}

async function renderizarEnsaio(slide, ctx) {
  const { indice = 1, total = 1 } = ctx || {};
  const capa = slide.funcao === 'capa' || (indice === 1 && total > 1 && slide.funcao !== 'encerramento');
  const ultimo = slide.funcao === 'encerramento' || (indice === total && total > 1);
  const blocos = []; const elementos = ['tema_tweet', 'ensaio', 'fundo_escuro', ...(capa ? ['capa_ensaio'] : []), ...(ultimo ? ['fechamento_ensaio'] : [])];
  let svg = `<rect width="${W}" height="${H}" fill="${COR_E.fundo}"/>` + cabecalhoEscuro();
  if (total > 1) svg += `<text x="${W - MARGEM}" y="${Y_TOPO + 44}" text-anchor="end" font-family="${ARQ.iCorpo.familia}" font-size="26" fill="${COR_E.mudo}">${indice}/${total}</text>`;
  const camadas = [{ input: await avatar(), left: MARGEM, top: Y_TOPO }];
  const yTexto = Y_TOPO + D_AVATAR + 72;
  let y = yTexto;
  const paragrafos = paragrafosDe(destaque(slide.texto));
  // Fechamento: a chamada ocupa o rodapé; o texto fica acima dela. Demais: a seta fica no canto de baixo.
  const manda = ultimo ? String(slide.cta || `Segue o ${ACCOUNT.handle}`).replace(/\.+$/, '.') : '';
  const segue = ultimo && slide.cta_apoio ? String(slide.cta_apoio).replace(/\.+$/, '.') : '';
  const cm = ultimo ? fit({ texto: manda, k: 'iNegrito', larg: LARG, alt: 130, max: 52, min: 36, ent: 1.15, papel: 't_cta' }) : null;
  const cs = segue ? fit({ texto: segue, k: 'iCorpo', larg: LARG, alt: 110, max: 32, min: 28, ent: 1.25, papel: 't_cta' }) : null;
  const hChamada = ultimo ? 34 + cm.altura + (cs ? 22 + cs.altura : 0) + 64 : 0;
  const yFim = ultimo ? H - 96 - hChamada : H - 170;
  // Abertura (capa) ou frase de ouro (fechamento): o título em negrito, maior; no fechamento em amarelo.
  if (slide.titulo) {
    const t = destaque(slide.titulo).trim();
    const alt = Math.max(200, Math.round((yFim - yTexto) * (paragrafos.length ? 0.5 : 0.8)));
    const b = fit({ texto: t, k: 'iNegrito', larg: LARG, alt, max: ultimo ? 84 : 92, min: 60, ent: 1.12, papel: 't_capa' });
    svg += colocar(b, { x: MARGEM, ytop: y, k: 'iNegrito', cor: ultimo ? COR_E.ouro : COR_E.texto });
    // marcador de parágrafo: filete curto amarelo abaixo do título (separa a abertura do corpo)
    blocos.push({ nome: ultimo ? 'frase_de_ouro' : 'abertura', ...A.resumo(b, alt) });
    y += b.altura + 36;
    svg += `<rect x="${MARGEM}" y="${Math.round(y)}" width="96" height="6" fill="${COR_E.ouro}"/>`;
    y += 6 + 40;
  }
  if (paragrafos.length) {
    const alt = yFim - y;
    const b = fitParagrafos({ paragrafos, k: 'iCorpo', larg: LARG, alt, max: 64, min: 54, ent: 1.3, gap: 0.8, papel: 'e_corpo' });
    // Slide do meio (sem abertura nem fechamento): o bloco sobe um pouco do centro da área livre, em vez de colar no topo.
    if (!slide.titulo && !ultimo && b.cabe) y += Math.max(0, (alt - b.altura) * 0.4);
    svg += colocarParagrafos(b, { x: MARGEM, ytop: y, cor: COR_E.texto, corDestaque: COR_E.ouro });
    blocos.push({ nome: 'paragrafos', tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, paragrafos: paragrafos.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `Não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), altura_disponivel: Math.round(alt) });
    y += b.altura;
  }
  if (ultimo) {
    const yc = H - 96 - cm.altura - (cs ? 22 + cs.altura : 0);
    svg += `<rect x="${MARGEM}" y="${yc - 34}" width="120" height="6" fill="${COR_E.ouro}"/>`;
    svg += colocar(cm, { x: MARGEM, ytop: yc, k: 'iNegrito', cor: COR_E.texto });
    blocos.push({ nome: 'cta_manda', ...A.resumo(cm, 130) });
    if (cs) { svg += colocar(cs, { x: MARGEM, ytop: yc + cm.altura + 22, k: 'iCorpo', cor: COR_E.mudo }); blocos.push({ nome: 'cta_segue', ...A.resumo(cs, 110) }); }
    if (y > yc - 40) blocos[blocos.length - 1].cabe = false; // texto invadiu a chamada
  } else if (total > 1) {
    svg += `<text x="${W - MARGEM}" y="${H - 72}" text-anchor="end" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="64" fill="${COR_E.texto}">→</text>`;
  }
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`;
  const png = await sharp(Buffer.from(base)).png().composite(camadas).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'ensaio', elementos);
  m.tema = 'ensaio';
  return { png, metrics: m };
}

async function renderizar(slide, ctx, imagem) {
  const { indice = 1, total = 1 } = ctx || {};
  if (slide.tema_visual === 'ensaio' || slide.layout === 'ensaio') return renderizarEnsaio(slide, ctx);
  // Capa: o 1º slide de um carrossel ou o slide único de um post estático (funcao 'capa').
  if ((indice === 1 && total > 1 && slide.funcao !== 'encerramento') || (slide.funcao === 'capa' && indice === 1)) return renderizarCapa(slide, ctx, imagem);
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
  const texto = destaque(slide.titulo && ultimo ? `**${slide.titulo}** ${slide.texto || ''}` : slide.texto || '').trim();
  const b = fit({ texto, k: 'iCorpo', larg: LARG, alt: altTexto, max: temFoto ? 60 : 76, min: 40, papel: 't_corpo' });
  // Sem foto, o texto fica centralizado na área livre (em cima do rodapé); com foto, logo abaixo do cabeçalho, como num tweet.
  const altLivre = ultimo ? altTexto - 250 : altTexto; // no último, o espaço da chamada fica reservado embaixo
  const ytop = temFoto ? yTexto : yTexto + Math.max(0, (altLivre - b.altura) / 2);
  svg += colocar(b, { x: MARGEM, ytop, k: 'iCorpo', cor: COR.texto });
  blocos.push({ nome: 'texto', ...A.resumo(b, altTexto) });
  let y = ytop + b.altura;
  if (temFoto) { camadas.push({ input: foto.input, left: MARGEM, top: Math.round(y + 40) }); y += 40 + foto.h; }

  if (ultimo) {
    // Fechamento: 1º o pedido de ENVIO ("Manda pra seu sócio."), em destaque; depois seguir o perfil, em azul e menor.
    const manda = String(slide.cta || `Segue o ${ACCOUNT.handle}`).replace(/\.+$/, '.');
    const segue = slide.cta_apoio ? String(slide.cta_apoio).replace(/\.+$/, '.') : '';
    const cm = fit({ texto: manda, k: 'iNegrito', larg: LARG, alt: 120, max: 54, min: 36, ent: 1.15, papel: 't_cta' });
    const cs = segue ? fit({ texto: segue, k: 'iCorpo', larg: LARG, alt: 110, max: 34, min: 28, ent: 1.25, papel: 't_cta' }) : null;
    const hBloco = cm.altura + (cs ? 22 + cs.altura : 0);
    const yc = Math.max(y + 64, H - 96 - hBloco);
    svg += `<rect x="${MARGEM}" y="${yc - 34}" width="120" height="6" fill="${COR.marca}"/>`;
    svg += colocar(cm, { x: MARGEM, ytop: yc, k: 'iNegrito', cor: COR.marca });
    blocos.push({ nome: 'cta_manda', ...A.resumo(cm, 120) });
    if (cs) { svg += colocar(cs, { x: MARGEM, ytop: yc + cm.altura + 22, k: 'iCorpo', cor: COR.mudo }); blocos.push({ nome: 'cta_segue', ...A.resumo(cs, 110) }); }
    if (yc + hBloco > H - 56) blocos[blocos.length - 1].cabe = false;
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

module.exports = { renderizar, renderizarEnsaio, COR, COR_E, destaque };
