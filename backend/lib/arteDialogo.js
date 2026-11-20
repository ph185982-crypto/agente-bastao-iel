// Tema "dialogo" (diálogo ilustrado): UMA cena repetida em todas as telas e só os balões mudam. O personagem A diz o
// pensamento padrão ("Só vim comprar leite."), o B mostra a estratégia escondida ("Por isso ele tá lá no fundo.").
//
// Quem faz o quê:
//  - a cena é uma imagem (ilustração da IA, imagem enviada ou, sem nenhuma das duas, a cena simples desenhada aqui);
//  - os balões, o texto, o rótulo de cada personagem e a assinatura são SEMPRE desenhados pelo código (o modelo de
//    imagem nunca escreve). O texto é medido com a fonte real: se não cabe no mínimo legível, a arte sai cabe:false e
//    a revisão bloqueia (nada é espremido nem cortado).
//
// Slide (no modelo de conteúdo): { layout: 'dialogo' | 'dialogo_fecho', tema_visual: 'dialogo', texto, dados }
//  - 'dialogo': texto = "fala do A\nfala do B" (a 1ª linha é do A, o resto é do B), editável como qualquer texto;
//  - 'dialogo_fecho': texto = "frase de fechamento\nchamada (opcional)"; dados.palavra_chave ganha destaque;
//  - dados: { personagens: {a, b}, ancoras: {a:{x,y}, b:{x,y}} (em % da tela), paleta } — tudo conferido aqui.
require('../fontSetup');
const sharp = require('sharp');
const A = require('./arte');
const { ACCOUNT } = require('./account');

const { W, H, esc, ARQ } = A;
const MARGEM = 72;
const COR = { branco: '#FFFFFF', grafite: '#18191D', azul: '#2448FF', laranja: '#FF7043', mudo: '#686A73', claro: '#F6F5F0' };
// Onde fica a cabeça de cada personagem (em % da largura/altura): A à esquerda, B à direita, no terço de baixo.
const ANCORA_PADRAO = Object.freeze({ a: Object.freeze({ x: 28, y: 68 }), b: Object.freeze({ x: 72, y: 68 }) });
const FALA = { max: 62, min: 40, ent: 1.18 }; // px em 1080 de largura (40 px ainda é confortável no celular)
const BALAO = { padX: 44, padY: 32, raio: 40, rotulo: 24, gapRotulo: 22, gap: 88, cauda: 76, larguraMax: Math.round((W - 2 * MARGEM) * 0.84), larguraMin: 380 };
const Y_TOPO = 104;
const CAP = { iNegrito: 0.727, iCorpo: 0.727, mDisplay: 0.73, mRotulo: 0.73 };
const cap = (k) => CAP[k] || 0.73;

// Paletas da cena feita por código (quando não há ilustração): fundo em degradê, chão e silhuetas grafite.
const PALETAS = [
  { topo: '#F6E7D2', base: '#EAD2B4', chao: '#CDB496', forma: '#E2C7A5', luz: '#FFF6E8' },
  { topo: '#DCE4FF', base: '#B9C7FF', chao: '#8C9EE6', forma: '#C9D3FF', luz: '#F3F6FF' },
  { topo: '#F9D9C2', base: '#F1B590', chao: '#C98466', forma: '#F4C6A8', luz: '#FFF1E6' },
];

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const limpa = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function ancorasDe(d) {
  const a = d?.ancoras || {};
  const p = (k) => ({ x: num(a[k]?.x, ANCORA_PADRAO[k].x, 4, 96), y: num(a[k]?.y, ANCORA_PADRAO[k].y, 30, 96) });
  return { a: p('a'), b: p('b') };
}
const px = (anc) => ({ x: Math.round((anc.x / 100) * W), y: Math.round((anc.y / 100) * H) });

// Maior tamanho em que o texto cabe na caixa (largura e altura). Devolve as linhas medidas e a linha mais larga.
function caber({ texto, k, larg, alt, max, min, ent = 1.18 }) {
  const mede = (tam) => {
    const q = A.quebrar(texto, k, tam, larg, { colchetes: false });
    const altura = (q.linhas.length - 1) * tam * ent + cap(k) * tam;
    const largura = Math.max(0, ...q.linhas.map((ln) => ln.reduce((m, w) => Math.max(m, w.x + w.larg), 0)));
    return { q, altura, largura };
  };
  for (let tam = max; tam >= min; tam -= 2) {
    const r = mede(tam);
    if (!r.q.largaDemais && r.altura <= alt) return { tam, linhas: r.q.linhas, entrelinha: ent, altura: r.altura, largura: r.largura, cabe: true, minimo: min, k };
  }
  const r = mede(min);
  return { tam: min, linhas: r.q.linhas, entrelinha: ent, altura: r.altura, largura: r.largura, cabe: false, sobra: Math.max(0, Math.round(r.altura - alt)), larga_demais: r.q.largaDemais, minimo: min, k };
}
// Coloca o bloco com o TOPO visível das letras em `ytop`.
const colocar = (b, { x, ytop, cor, destaque, alinhar, larguraBox }) => A.textoSvg(b, { x, y: ytop - (0.92 - cap(b.k)) * b.tam, k: b.k, tema: { texto: cor, destaque: destaque || cor, colchete: 'none' }, alinhar, larguraBox });
const resumo = (nome, b, alt) => ({ nome, tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `${nome === 'fala_a' ? 'A fala do personagem A' : nome === 'fala_b' ? 'A fala do personagem B' : 'O texto'} não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), altura_disponivel: Math.round(alt) });

// Assinatura pequena (@ do perfil) num selo escuro translúcido: legível em cima de qualquer imagem.
function assinatura({ lado = 'esq', y = H - 58, dica = '' } = {}) {
  const tam = 26; const larg = Math.round(A.largura('mRotulo', ACCOUNT.handle, tam)) + 40;
  const x = lado === 'esq' ? MARGEM - 14 : lado === 'centro' ? Math.round((W - larg) / 2) : W - MARGEM - larg + 14;
  let s = `<rect x="${x}" y="${y - 36}" width="${larg}" height="50" rx="25" fill="#000000" fill-opacity="0.38"/>`;
  s += `<text x="${x + 20}" y="${y - 2}" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="${tam}" fill="#FFFFFF">${esc(ACCOUNT.handle)}</text>`;
  if (dica) {
    const ld = Math.round(A.largura('mRotulo', dica, 24)) + 40; const xd = W - MARGEM - ld + 14;
    s += `<rect x="${xd}" y="${y - 36}" width="${ld}" height="50" rx="25" fill="#000000" fill-opacity="0.38"/>`;
    s += `<text x="${xd + 20}" y="${y - 3}" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="24" fill="#FFFFFF">${esc(dica)}</text>`;
  }
  return s;
}

// Cena simples feita por código: degradê, formas de fundo (prateleiras/janelas genéricas), chão e duas silhuetas de costas
// nas âncoras. Sem texto, sem marca. É a garantia de que o carrossel sai mesmo sem ilustração.
function cenaCodigoSvg({ ancoras, paleta = 0 }) {
  const P = PALETAS[Math.abs(Math.round(num(paleta, 0, 0, 999))) % PALETAS.length];
  const a = px(ancoras.a); const b = px(ancoras.b);
  const yChao = Math.round(Math.max(a.y, b.y) + 150);
  let s = `<defs><linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.topo}"/><stop offset="1" stop-color="${P.base}"/></linearGradient>`;
  s += `<radialGradient id="luz" cx="0.5" cy="0.35" r="0.6"><stop offset="0" stop-color="${P.luz}" stop-opacity="0.9"/><stop offset="1" stop-color="${P.luz}" stop-opacity="0"/></radialGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#ceu)"/><rect width="${W}" height="${H}" fill="url(#luz)"/>`;
  // formas verticais de fundo (corredor/prédios genéricos), em perspectiva leve
  for (let i = 0; i < 6; i++) {
    const x = 40 + i * 180; const h = 360 + ((i * 97) % 200);
    s += `<rect x="${x}" y="${yChao - h}" width="120" height="${h}" rx="10" fill="${P.forma}" fill-opacity="${0.55 + (i % 2) * 0.2}"/>`;
    for (let j = 1; j < 4; j++) s += `<rect x="${x + 10}" y="${yChao - h + j * (h / 4)}" width="100" height="8" rx="4" fill="${P.chao}" fill-opacity="0.35"/>`;
  }
  s += `<rect x="0" y="${yChao}" width="${W}" height="${H - yChao}" fill="${P.chao}"/>`;
  s += `<rect x="0" y="${yChao}" width="${W}" height="10" fill="#000000" fill-opacity="0.08"/>`;
  // silhuetas de costas: cabeça na âncora, ombros e tronco descendo até o chão/borda
  const silhueta = (p, escala) => {
    const r = Math.round(46 * escala); const om = Math.round(112 * escala); const base = H + 40; const y0 = p.y + r * 1.2;
    return `<g fill="${COR.grafite}"><circle cx="${p.x}" cy="${p.y}" r="${r}"/>`
      + `<rect x="${(p.x - r * 0.4).toFixed(1)}" y="${(p.y + r * 0.6).toFixed(1)}" width="${(r * 0.8).toFixed(1)}" height="${(r * 0.8).toFixed(1)}" rx="${(r * 0.2).toFixed(1)}"/>`
      + `<path d="M${p.x - om * 0.86} ${base} L${p.x - om} ${y0 + r * 2.2} C${p.x - om} ${y0 + r * 0.5} ${p.x - r * 0.9} ${y0} ${p.x} ${y0} C${p.x + r * 0.9} ${y0} ${p.x + om} ${y0 + r * 0.5} ${p.x + om} ${y0 + r * 2.2} L${p.x + om * 0.86} ${base} Z"/></g>`;
  };
  s += silhueta(a, 1) + silhueta(b, 1.08);
  return s;
}

// Balão: retângulo arredondado + cauda apontando para o personagem (curta: aponta, não precisa encostar).
function balaoSvg({ x, y, w, h, cor, alvo, id }) {
  const bx = x + w / 2;
  let cauda = '';
  if (alvo) {
    const embaixo = alvo.y >= y + h; const emcima = alvo.y <= y;
    if (embaixo || emcima) {
      const yb = embaixo ? y + h - 2 : y + 2;
      const xb = Math.min(x + w - BALAO.raio - 34, Math.max(x + BALAO.raio + 34, alvo.x));
      const dx = alvo.x - xb; const dy = alvo.y - yb; const d = Math.hypot(dx, dy) || 1;
      const L = Math.min(BALAO.cauda, Math.max(30, d - 40));
      const tx = xb + (dx / d) * L; const ty = yb + (dy / d) * L;
      cauda = `<path d="M${(xb - 30).toFixed(1)} ${yb.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${(xb + 30).toFixed(1)} ${yb.toFixed(1)} Z" fill="${cor}"/>`;
    } else {
      const xl = alvo.x < bx ? x + 2 : x + w - 2; const yb = Math.min(y + h - BALAO.raio - 30, Math.max(y + BALAO.raio + 30, alvo.y));
      const tx = xl + (alvo.x < bx ? -1 : 1) * BALAO.cauda * 0.8;
      cauda = `<path d="M${xl.toFixed(1)} ${(yb - 28).toFixed(1)} L${tx.toFixed(1)} ${(yb + 10).toFixed(1)} L${xl.toFixed(1)} ${(yb + 28).toFixed(1)} Z" fill="${cor}"/>`;
    }
  }
  return `<g filter="url(#${id})"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${BALAO.raio}" fill="${cor}"/>${cauda}</g>`;
}

const SOMBRA = (id) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#000000" flood-opacity="0.28"/></filter>`;

// Separa a fala do A (1ª linha) da fala do B (o resto).
function falasDe(texto) {
  const linhas = String(texto || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return { a: linhas[0] || '', b: linhas.slice(1).join(' ') };
}

async function fundoDaCena(imagem, dados, ancoras) {
  if (imagem) {
    try { return { buf: await sharp(imagem).rotate().resize(W, H, { fit: 'cover', position: 'centre' }).png().toBuffer(), elemento: 'cena_imagem' }; } catch { /* imagem inválida: cai para a cena feita por código */ }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${cenaCodigoSvg({ ancoras, paleta: dados?.paleta })}</svg>`;
  return { buf: await sharp(Buffer.from(svg)).png().toBuffer(), elemento: imagem ? 'cena_imagem_invalida_usou_codigo' : 'cena_codigo' };
}

// Um balão completo (medido): devolve a geometria e o SVG.
function medirBalao({ texto, rotulo, alt }) {
  const larg = BALAO.larguraMax - 2 * BALAO.padX;
  const b = caber({ texto, k: 'iNegrito', larg, alt, max: FALA.max, min: FALA.min, ent: FALA.ent });
  const lr = rotulo ? A.largura('mRotulo', rotulo.toUpperCase(), BALAO.rotulo, 2) : 0;
  const w = Math.round(Math.min(BALAO.larguraMax, Math.max(BALAO.larguraMin, b.largura + 2 * BALAO.padX, lr + 2 * BALAO.padX)));
  const hRot = rotulo ? Math.round(BALAO.rotulo * 0.73) + BALAO.gapRotulo : 0;
  const h = Math.round(2 * BALAO.padY + hRot + b.altura);
  return { b, w, h, hRot };
}

async function renderizarFala(slide, ctx, imagem) {
  const { indice = 1 } = ctx || {};
  const d = slide.dados || {};
  const ancoras = ancorasDe(d);
  const pers = { a: limpa(d.personagens?.a, 28), b: limpa(d.personagens?.b, 28) };
  const falas = falasDe(slide.texto);
  const pA = px(ancoras.a); const pB = px(ancoras.b);
  const fundo = await fundoDaCena(imagem, d, ancoras);
  const elementos = ['tema_dialogo', fundo.elemento];
  const blocos = [];

  // Zona dos balões: do topo até um pouco acima da cabeça mais alta (a cauda precisa de espaço para apontar).
  const limite = Math.min(pA.y, pB.y) - 70;
  const zona = Math.max(360, limite - Y_TOPO);
  // Altura do texto: o que sobra da zona, dividido na proporção do que cada fala precisa no tamanho mínimo
  // (fala curta não rouba espaço da longa).
  const hRot = Math.round(BALAO.rotulo * 0.73) + BALAO.gapRotulo;
  const total = Math.max(240, zona - BALAO.gap - 2 * (2 * BALAO.padY + hRot));
  const larg = BALAO.larguraMax - 2 * BALAO.padX;
  const precisa = (t) => Math.max(FALA.min, caber({ texto: t, k: 'iNegrito', larg, alt: 1e6, max: FALA.min, min: FALA.min, ent: FALA.ent }).altura);
  const nA = precisa(falas.a); const nB = precisa(falas.b);
  const folga = Math.max(0, total - nA - nB);
  const altA = Math.floor(nA + folga * (nA / (nA + nB))); const altB = Math.floor(total - altA);
  const mA = medirBalao({ texto: falas.a, rotulo: pers.a, alt: altA });
  const mB = medirBalao({ texto: falas.b, rotulo: pers.b, alt: altB });
  // Cada balão fica do lado do seu personagem.
  const xDe = (m, p) => (p.x <= W / 2 ? MARGEM : W - MARGEM - m.w);
  const yA = Y_TOPO; const yB = yA + mA.h + BALAO.gap;
  const xA = xDe(mA, pA); const xB = xDe(mB, pB);
  if (!falas.a || !falas.b) blocos.push({ nome: 'falas', cabe: false, motivo: 'Cada tela do diálogo precisa de duas falas (1ª linha: personagem A; 2ª: personagem B)' });
  blocos.push(resumo('fala_a', mA.b, altA), resumo('fala_b', mB.b, altB));
  if (yB + mB.h > H - 120) blocos.push({ nome: 'baloes', cabe: false, motivo: 'Os balões passam da área segura da tela' });
  if (yB + mB.h > limite + 40) elementos.push('balao_perto_do_personagem');

  let svg = `<defs>${SOMBRA('sa')}${SOMBRA('sb')}</defs>`;
  svg += balaoSvg({ x: xA, y: yA, w: mA.w, h: mA.h, cor: COR.branco, alvo: pA, id: 'sa' });
  svg += balaoSvg({ x: xB, y: yB, w: mB.w, h: mB.h, cor: COR.azul, alvo: pB, id: 'sb' });
  const rot = (t, x, y, cor, op) => `<text x="${x}" y="${y}" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="${BALAO.rotulo}" letter-spacing="2" fill="${cor}" fill-opacity="${op}">${esc(t.toUpperCase())}</text>`;
  if (pers.a) svg += rot(pers.a, xA + BALAO.padX, yA + BALAO.padY + Math.round(BALAO.rotulo * 0.73), COR.grafite, 0.62);
  if (pers.b) svg += rot(pers.b, xB + BALAO.padX, yB + BALAO.padY + Math.round(BALAO.rotulo * 0.73), COR.branco, 0.78);
  svg += colocar(mA.b, { x: xA + BALAO.padX, ytop: yA + BALAO.padY + mA.hRot, cor: COR.grafite, destaque: COR.azul });
  svg += colocar(mB.b, { x: xB + BALAO.padX, ytop: yB + BALAO.padY + mB.hRot, cor: COR.branco });
  svg += assinatura({ dica: indice === 1 && (ctx?.total || 1) > 1 ? 'deslize →' : '' });

  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(fundo.buf).composite([{ input: camada }]).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'dialogo', elementos);
  m.tema = 'dialogo';
  m.baloes = [{ x: xA, y: yA, w: mA.w, h: mA.h, tam: mA.b.tam }, { x: xB, y: yB, w: mB.w, h: mB.h, tam: mB.b.tam }];
  return { png, metrics: m };
}

// Fechamento: a mesma cena, escurecida, com um cartão claro: frase de fechamento grande e a chamada embaixo
// (palavra-chave em destaque). Uma ação só.
async function renderizarFecho(slide, ctx, imagem) {
  const d = slide.dados || {};
  const ancoras = ancorasDe(d);
  const fundo = await fundoDaCena(imagem, d, ancoras);
  const elementos = ['tema_dialogo', 'fechamento_dialogo', fundo.elemento];
  const blocos = [];
  const linhas = String(slide.texto || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const palavra = String(d.palavra_chave || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const marca = (t) => (palavra.length >= 3 ? t.replace(new RegExp(`(?<![\\p{L}\\p{N}*])(${palavra})(?![\\p{L}\\p{N}*])`, 'giu'), '**$1**') : t);
  const frase = linhas[0] || '';
  const chamada = linhas.slice(1).join(' ');
  const larg = W - 2 * MARGEM - 2 * 56;
  const f = caber({ texto: marca(frase), k: 'mDisplay', larg, alt: chamada ? 430 : 620, max: 84, min: 52, ent: 1.1 });
  const c = chamada ? caber({ texto: marca(chamada), k: 'iCorpo', larg, alt: 260, max: 46, min: 36, ent: 1.25 }) : null;
  blocos.push(resumo('fechamento', f, chamada ? 430 : 620));
  if (c) blocos.push(resumo('chamada', c, 260));
  const hCard = Math.round(64 + f.altura + (c ? 44 + 8 + 40 + c.altura : 0) + 64);
  const yCard = Math.round(Math.max(110, (H - 150 - hCard) * 0.42));
  let svg = `<defs>${SOMBRA('sc')}</defs><rect width="${W}" height="${H}" fill="#0B0B0C" fill-opacity="0.42"/>`;
  svg += `<g filter="url(#sc)"><rect x="${MARGEM}" y="${yCard}" width="${W - 2 * MARGEM}" height="${hCard}" rx="40" fill="${COR.claro}"/></g>`;
  let y = yCard + 64;
  svg += colocar(f, { x: MARGEM + 56, ytop: y, cor: COR.grafite, destaque: COR.azul });
  y += f.altura;
  if (c) {
    y += 44; svg += `<rect x="${MARGEM + 56}" y="${y}" width="96" height="8" rx="4" fill="${COR.laranja}"/>`; y += 8 + 40;
    svg += colocar(c, { x: MARGEM + 56, ytop: y, cor: COR.grafite, destaque: COR.azul });
  }
  if (yCard + hCard > H - 110) blocos.push({ nome: 'cartao', cabe: false, motivo: 'O fechamento passa da área segura da tela' });
  if (palavra.length >= 3 && new RegExp(palavra, 'i').test(slide.texto || '')) elementos.push('palavra_chave');
  svg += assinatura({});
  const camada = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  const png = await sharp(fundo.buf).composite([{ input: camada }]).png().toBuffer();
  const m = A.resumirMetricas(blocos, 'dialogo_fecho', elementos);
  m.tema = 'dialogo';
  return { png, metrics: m };
}

async function renderizar(slide, ctx, imagem) {
  if (slide.layout === 'dialogo_fecho' || slide.funcao === 'encerramento') return renderizarFecho(slide, ctx, imagem);
  return renderizarFala(slide, ctx, imagem);
}

module.exports = { renderizar, renderizarFala, renderizarFecho, cenaCodigoSvg, falasDe, ancorasDe, caber, colocar, assinatura, ANCORA_PADRAO, PALETAS, FALA, BALAO, MARGEM, COR };
