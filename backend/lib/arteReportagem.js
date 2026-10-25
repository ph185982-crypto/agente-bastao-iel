// Tema "reportagem": a linguagem visual das peças de cobrança de dados (referência aprovada pelo Pedro):
// marinho, amarelo, vermelho e creme; letra condensada pesada (Anton) em títulos, números e faixas;
// rosto recortado em preto e branco sobre uma forma de apoio; comparação "antes → depois" com cor que significa algo.
//
// Regras que não mudam em relação ao resto da arte:
//  - TODO texto e número é desenhado por código, medido pela fonte real. A IA, se usada, só faz fundo/forma
//    (sem letra, sem rosto): ver imagemOpenAI.js. Nada de texto gerado por IA dentro de imagem.
//  - O rosto NUNCA é gerado nem alterado: entra o recorte que o Pedro enviou (PNG com fundo transparente),
//    só em preto e branco e com contraste. Sem recorte, a arte sai só com a forma e avisa ('sem_recorte').
//  - Texto que não cabe no tamanho mínimo bloqueia (cabe:false), como nas outras artes.
//  - Cor com significado é escolha editorial EXPLÍCITA (dados.tom): 'alerta' pinta o lado novo de vermelho;
//    'neutro' (padrão) usa marinho e amarelo. O código não decide sozinho o que é "pior".
//
// Layouts: rep_capa, rep_comparacao, rep_numero, rep_manchete. Com `slide.tema_visual === 'reportagem'`
// os layouts da identidade (capa_tipografica, comparacao, prova...) são mapeados para estes.
require('../fontSetup');
const sharp = require('sharp');
const A = require('./arte');
const { ACCOUNT } = require('./account');

const { W, H, MARGEM, esc, ARQ } = A;
const LARG = W - 2 * MARGEM;
const COR = { marinho: '#0B1D3A', creme: '#F5F2EA', amarelo: '#F2B01A', vermelho: '#D71920', cinza: '#55565B', texto: '#14161C', branco: '#FFFFFF', fosco: '#B8B6AE' };
const TEMA = {
  marinho: { fundo: COR.marinho, texto: COR.creme, destaque: COR.amarelo, colchete: COR.amarelo },
  creme: { fundo: COR.creme, texto: COR.marinho, destaque: COR.vermelho, colchete: COR.vermelho },
};
const aj = (o) => A.ajustar({ colchetes: false, ...o });
const up = (t) => String(t ?? '').toLocaleUpperCase('pt-BR');
const txt = (b, o) => A.textoSvg(b, o);

// ── Formas de apoio (por código, bordas "pintadas" por deslocamento de ruído) ──────────────
let _n = 0;
const roughen = (escala, freq = '0.03 0.11', semente = 3) => {
  const id = `rf${++_n}`;
  return { id, def: `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${semente}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${escala}" xChannelSelector="R" yChannelSelector="G"/></filter>` };
};
function pincelada({ x, y, w, h, cor, giro = -4, semente = 5, escala = 34 }) {
  const f = roughen(escala, '0.025 0.14', semente);
  return `<defs>${f.def}</defs><g filter="url(#${f.id})" transform="rotate(${giro} ${x + w / 2} ${y + h / 2})"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${cor}"/></g>`;
}
function seta({ x, y, w, h, cor, subindo = true, semente = 9 }) {
  const f = roughen(14, '0.05', semente);
  const g = h * 0.17; // espessura do traço
  // zigue-zague de tendência + ponta; "descendo" espelha na vertical.
  const P = [[0, 0.78], [0.22, 0.52], [0.40, 0.66], [0.78, 0.2]].map(([a, b]) => [x + a * w, y + b * h]);
  const linha = P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const ponta = `M${(x + w).toFixed(1)} ${y.toFixed(1)} L${(x + w * 0.74).toFixed(1)} ${(y + h * 0.04).toFixed(1)} L${(x + w * 0.96).toFixed(1)} ${(y + h * 0.3).toFixed(1)} Z`;
  const espelho = subindo ? '' : ` transform="translate(0 ${(2 * y + h).toFixed(1)}) scale(1 -1)"`;
  return `<defs>${f.def}</defs><g filter="url(#${f.id})"${espelho}><path d="${linha}" fill="none" stroke="${cor}" stroke-width="${g.toFixed(1)}" stroke-linejoin="miter" stroke-linecap="butt"/><path d="${ponta}" fill="${cor}"/></g>`;
}
function circulo({ cx, cy, r, cor, semente = 4 }) {
  const f = roughen(22, '0.04', semente);
  return `<defs>${f.def}</defs><g filter="url(#${f.id})"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${cor}"/></g>`;
}
function degrau({ x, y, w, h, cor, semente = 6 }) {
  const f = roughen(16, '0.05', semente);
  const pts = [[0, 0.35], [0.28, 0.35], [0.28, 0.12], [0.58, 0.12], [0.58, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => `${(x + a * w).toFixed(1)},${(y + b * h).toFixed(1)}`).join(' ');
  return `<defs>${f.def}</defs><g filter="url(#${f.id})"><polygon points="${pts}" fill="${cor}"/></g>`;
}
const FORMAS = { pincelada, seta, circulo, degrau };
function forma(f, caixa, cor) {
  if (!f || !FORMAS[f.tipo]) return '';
  const c = f.cor === 'amarelo' ? COR.amarelo : f.cor === 'vermelho' ? COR.vermelho : f.cor === 'marinho' ? COR.marinho : cor;
  if (f.tipo === 'circulo') return circulo({ cx: caixa.x + caixa.w / 2, cy: caixa.y + caixa.h / 2, r: Math.min(caixa.w, caixa.h) * 0.46, cor: c });
  return FORMAS[f.tipo]({ ...caixa, cor: c, ...(f.tipo === 'seta' ? { subindo: f.sentido !== 'descendo' } : {}) });
}
const grao = (op = 0.07) => `<defs><filter id="gr${++_n}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="${W}" height="${H}" filter="url(#gr${_n})" opacity="${op}"/>`;

// ── Recorte: sempre preto e branco, com contraste; o rosto não é refeito ───────────────────
async function prepararRecorte(buf, caixa, ancora = 'centro') {
  if (!buf) return null;
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return { erro: 'recorte_sem_transparencia' };
  const esc_ = Math.min(caixa.w / meta.width, caixa.h / meta.height);
  const w = Math.round(meta.width * esc_); const h = Math.round(meta.height * esc_);
  const png = await sharp(buf).ensureAlpha().resize(w, h, { fit: 'fill' }).greyscale().linear(1.12, -10).png().toBuffer();
  const left = Math.round(ancora === 'direita' ? caixa.x + caixa.w - w : ancora === 'esquerda' ? caixa.x : caixa.x + (caixa.w - w) / 2);
  const top = Math.round(caixa.y + caixa.h - h); // sempre apoiado na base da caixa
  return { input: png, left: Math.max(0, left), top: Math.max(0, top), w, h };
}

// ── Peças comuns ───────────────────────────────────────────────────────────────────────────
function topo({ indice, total, tema, handleTopo = false }) {
  let s = '';
  if (total > 1) {
    const cor = tema.texto;
    const n = `${String(indice).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
    s += `<text x="${W - 56}" y="76" text-anchor="end" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="28" fill="${cor}">${esc(n)}</text>`;
    s += `<rect x="${W - 56 - 70}" y="92" width="70" height="7" fill="${COR.amarelo}"/>`;
  }
  if (handleTopo) s += `<text x="${MARGEM}" y="76" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="28" fill="${tema.texto}">${esc(ACCOUNT.handle)}</text>`;
  return s;
}
function rodape({ tema, fonte, alinharHandle = 'fim', y = H - 56 }) {
  let s = '';
  const mudo = tema.fundo === COR.marinho ? '#9DA7B8' : COR.cinza;
  if (alinharHandle === 'centro') s += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${ARQ.iSemi.familia}" font-weight="600" font-size="26" letter-spacing="6" fill="${mudo}">${esc(String(ACCOUNT.handle).toUpperCase())}</text>`;
  else s += `<text x="${W - MARGEM + 20}" y="${y}" text-anchor="end" font-family="${ARQ.iNegrito.familia}" font-weight="700" font-size="28" fill="${tema.texto}">${esc(ACCOUNT.handle)}</text>`;
  if (fonte) s += `<text x="${MARGEM - 20}" y="${y}" font-family="${ARQ.iCorpo.familia}" font-weight="400" font-size="26" fill="${mudo}">${esc(fonte)}</text>`;
  return s;
}
const chip = ({ x, y, texto, fundo, cor, tam = 52 }) => {
  const t = up(texto); const w = Math.ceil(A.largura('aDisplay', t, tam)) + 48;
  return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="${tam * 1.45}" fill="${fundo}"/><text x="${x + 24}" y="${y + tam * 1.12}" font-family="${ARQ.aDisplay.familia}" font-size="${tam}" fill="${cor}">${esc(t)}</text>` };
};
const base = (fundo, defs, camadas) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${fundo}"/>${camadas}${defs || ''}</svg>`;
const sobre = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${inner}</svg>`;

// ── Medição vertical pela altura VISUAL da letra (altura de maiúscula), não pela caixa da linha ──────
const opentype = require('opentype.js');
const path = require('path');
const capDe = (arq) => { const f = opentype.loadSync(path.join(__dirname, '..', 'assets', arq)); return (f.tables.os2 && f.tables.os2.sCapHeight ? f.tables.os2.sCapHeight : 0.72 * f.unitsPerEm) / f.unitsPerEm; };
// Altura de maiúscula / corpo, lida das fontes reais (a Anton é bem mais alta que a Inter).
const CAPS = { aDisplay: capDe('Anton-Regular.ttf'), iSemi: capDe('Inter-SemiBold.ttf'), iCorpo: capDe('Inter-Regular.ttf'), iNegrito: capDe('Inter-Bold.ttf') };
const capK = (k) => CAPS[k] || 0.73;
function fit({ texto, k, larg, altVis, max, min, ent = 1.0, papel, passo = 2 }) {
  const minimo = Math.max(min, A.MINIMO[papel] || 0);
  const cap = capK(k);
  const vis = (q, tam) => (q.linhas.length - 1) * tam * ent + cap * tam;
  for (let tam = max; tam >= minimo; tam -= passo) {
    const q = A.quebrar(texto, k, tam, larg, { colchetes: false });
    if (!q.largaDemais && vis(q, tam) <= altVis) return { tam, linhas: q.linhas, entrelinha: ent, altura: vis(q, tam), cabe: true, minimo, papel, k };
  }
  const q = A.quebrar(texto, k, minimo, larg, { colchetes: false });
  const h = vis(q, minimo);
  return { tam: minimo, linhas: q.linhas, entrelinha: ent, altura: h, cabe: false, sobra: Math.max(0, Math.round(h - altVis)), minimo, papel, k };
}
// Desenha o bloco com o TOPO VISUAL em `ytop`.
const colocar = (b, o) => txt(b, { ...o, y: o.ytop - (0.92 - capK(b.k || o.k)) * b.tam }); // textoSvg põe a linha-base em y + 0.92·tam
const larguraLinha = (ln) => ln.reduce((m, w) => Math.max(m, w.x + w.larg), 0);

// Cada layout devolve { tema, fundoSvg, recorte:{caixa,ancora,degrade?}, textoSvg, blocos, semFonte? }.
function lCapa(s, ctx) {
  const T = TEMA.marinho;
  const yRodape = H - 56; const fimSub = yRodape - 66;
  const sub = (s.subtitulo || s.rotulo) ? fit({ texto: s.subtitulo || s.rotulo, k: 'iSemi', larg: LARG, altVis: 120, max: 46, min: 34, ent: 1.25, papel: 'r_corpo' }) : null;
  const topoSub = sub ? fimSub - sub.altura : fimSub;
  const fimTitulo = sub ? topoSub - 74 : fimSub - 10;
  const titulo = fit({ texto: up(s.texto), k: 'aDisplay', larg: LARG, altVis: 440, max: 170, min: 96, ent: 1.0, papel: 'r_titulo' });
  const topoTitulo = fimTitulo - titulo.altura;
  const caixa = { x: 90, y: 40, w: 900, h: Math.max(300, topoTitulo + 40 - 40) };
  const fundo = grao(0.05) + forma(s.forma || { tipo: 'circulo', cor: 'marinho' }, { x: 160, y: 110, w: 760, h: caixa.h - 90 }, '#13294F');
  let tx = topo({ ...ctx, tema: T });
  tx += colocar(titulo, { x: MARGEM, ytop: topoTitulo, k: 'aDisplay', tema: T });
  if (sub) { tx += `<rect x="${MARGEM}" y="${fimTitulo + 26}" width="110" height="7" fill="${COR.amarelo}"/>`; tx += colocar(sub, { x: MARGEM, ytop: topoSub, k: 'iSemi', tema: T }); }
  tx += rodape({ tema: T, alinharHandle: 'centro', y: yRodape });
  return { tema: T, fundoSvg: base(T.fundo, '', fundo), recorte: { caixa, ancora: 'centro', degrade: { de: topoTitulo - 200, ate: topoTitulo + 40 } }, textoSvg: sobre(tx), blocos: [{ nome: 'titulo', ...A.resumo(titulo) }, ...(sub ? [{ nome: 'subtitulo', ...A.resumo(sub) }] : [])] };
}

function lComparacao(s, ctx) {
  const T = TEMA.creme;
  const d = s.dados || {}; const e = d.esquerda || {}; const dr = d.direita || {};
  const alerta = d.tom === 'alerta';
  const corNovo = alerta ? COR.vermelho : COR.marinho;
  const chipAnt = { fundo: alerta ? COR.marinho : COR.amarelo, cor: alerta ? COR.creme : COR.marinho };
  const chipNovo = { fundo: alerta ? COR.vermelho : COR.marinho, cor: COR.creme };
  const fl = s.fonte_linha ? String(s.fonte_linha).replace(/^Fonte:\s*/i, '') : '';
  const LIMITE = H - 118; // início da faixa do rodapé
  const montar = (sc, extra) => {
    const blocos = []; let fundo = ''; let tx = '';
    const yTit = Math.round(420 - (1 - sc) * 160 + extra);
    const t = fit({ texto: up(s.titulo || s.texto), k: 'aDisplay', larg: LARG, altVis: 200, max: Math.round(150 * sc), min: 84, ent: 1.02, papel: 'r_titulo' });
    blocos.push({ nome: 'titulo', ...A.resumo(t) });
    tx += colocar(t, { x: MARGEM, ytop: yTit, k: 'aDisplay', tema: T, alinhar: 'centro', larguraBox: LARG });
    let y = yTit + t.altura + 40;
    tx += `<rect x="${W / 2 - 220}" y="${y - 8}" width="440" height="8" fill="${COR.amarelo}"/>`;
    y += 28;
    if (s.subtitulo) {
      const st = fit({ texto: s.subtitulo, k: 'iSemi', larg: LARG - 40, altVis: 100, max: Math.round(40 * sc), min: 30, ent: 1.22, papel: 'r_corpo' });
      tx += colocar(st, { x: MARGEM + 20, ytop: y, k: 'iSemi', tema: { ...T, texto: COR.cinza }, alinhar: 'centro', larguraBox: LARG - 40 });
      blocos.push({ nome: 'subtitulo', ...A.resumo(st) });
      y += st.altura + 30;
    }
    const colW = (LARG - 110) / 2; const xL = MARGEM; const xR = W - MARGEM - colW;
    const tamChip = Math.round(44 * sc); const hChip = tamChip * 1.45;
    // os dois valores usam o MESMO tamanho (o menor que cabe nos dois): a comparação lê de relance
    const tamDe = (d) => fit({ texto: up(d.valor || ''), k: 'aDisplay', larg: colW, altVis: Math.round(capK('aDisplay') * 170 * sc * 1.05), max: Math.round(170 * sc), min: 72, ent: 1.0, papel: 'r_valor' }).tam;
    const tamValor = Math.min(tamDe(e), tamDe(dr));
    const col = (dado, x, chipEst, corValor, lado) => {
      let g = chip({ x, y, texto: dado.rotulo || '', fundo: chipEst.fundo, cor: chipEst.cor, tam: tamChip }).svg;
      const v = fit({ texto: up(dado.valor || ''), k: 'aDisplay', larg: colW, altVis: Math.round(capK('aDisplay') * 170 * sc * 1.05), max: tamValor, min: 72, ent: 1.0, papel: 'r_valor' }); // uma linha: prefere encolher a quebrar o valor
      const yv = y + hChip + 16;
      g += colocar(v, { x, ytop: yv, k: 'aDisplay', tema: { ...T, texto: corValor } });
      blocos.push({ nome: `valor_${lado}`, ...A.resumo(v, 190) });
      let fim = yv + v.altura;
      if (dado.unidade) {
        const u = fit({ texto: dado.unidade, k: 'iSemi', larg: colW, altVis: 70, max: Math.round(40 * sc), min: 30, ent: 1.15, papel: 'r_corpo' });
        g += colocar(u, { x, ytop: fim + 16, k: 'iSemi', tema: { ...T, texto: COR.cinza } });
        fim += 16 + u.altura;
      }
      return { g, fim, yv, vh: v.altura };
    };
    const cA = col(e, xL, chipAnt, COR.marinho, 'esquerda'); const cB = col(dr, xR, chipNovo, corNovo, 'direita');
    tx += cA.g + cB.g;
    const yS = cA.yv + cA.vh / 2;
    tx += `<path d="M${W / 2 - 30} ${yS} h56 m-20 -20 l20 20 l-20 20" fill="none" stroke="#8A8C93" stroke-width="9" stroke-linecap="square"/>`;
    y = Math.max(cA.fim, cB.fim) + 30;
    const faixa = d.faixa || null;
    if (faixa) {
      const corF = alerta ? COR.vermelho : COR.amarelo; const corT = alerta ? COR.creme : COR.marinho;
      const fv = fit({ texto: up(faixa.valor || ''), k: 'aDisplay', larg: faixa.texto ? 520 : LARG - 40, altVis: 220, max: Math.round(130 * sc), min: 84, ent: 1.0, papel: 'r_faixa' });
      const wv = Math.max(...fv.linhas.map(larguraLinha));
      const xT = MARGEM + wv + 36;
      const ft = faixa.texto ? fit({ texto: up(faixa.texto), k: 'aDisplay', larg: W - MARGEM - 10 - xT, altVis: 220, max: 80, min: 48, ent: 1.04, papel: 'r_faixa' }) : null;
      const hF = Math.round(Math.max(fv.altura, ft ? ft.altura : 0) + 64);
      fundo += `<rect x="${MARGEM - 30}" y="${y}" width="${W - 2 * (MARGEM - 30)}" height="${hF}" fill="${corF}"/>`;
      const xv = faixa.texto ? MARGEM : MARGEM + 20;
      tx += colocar(fv, { x: xv, ytop: y + (hF - fv.altura) / 2, k: 'aDisplay', tema: { ...T, texto: corT }, ...(faixa.texto ? {} : { alinhar: 'centro', larguraBox: LARG - 40 }) });
      blocos.push({ nome: 'faixa_valor', ...A.resumo(fv, 220) });
      if (ft) { tx += colocar(ft, { x: xT, ytop: y + (hF - ft.altura) / 2, k: 'aDisplay', tema: { ...T, texto: corT } }); blocos.push({ nome: 'faixa_texto', ...A.resumo(ft, 220) }); }
      y += hF + 26;
    }
    if (s.texto && s.titulo) {
      const nt = fit({ texto: s.texto, k: 'iCorpo', larg: LARG - 60, altVis: Math.max(40, LIMITE - y), max: 32, min: 30, ent: 1.28, papel: 'r_corpo' });
      tx += colocar(nt, { x: MARGEM + 30, ytop: y, k: 'iCorpo', tema: { ...T, texto: COR.texto }, alinhar: 'centro', larguraBox: LARG - 60 });
      blocos.push({ nome: 'nota', ...A.resumo(nt, LIMITE - y) });
      y += nt.altura;
    }
    tx += rodape({ tema: T, fonte: fl, y: H - 56 });
    if (!fl) blocos.push({ nome: 'fonte', tam: 0, cabe: false, motivo: 'Comparação sem linha de fonte' });
    const r = { tema: T, fundoSvg: base(T.fundo, '', grao(0.05) + forma(s.forma || { tipo: 'pincelada', cor: 'amarelo' }, { x: 170, y: 100, w: 640, h: Math.max(200, yTit - 130) }, COR.amarelo) + fundo), recorte: { caixa: { x: 230, y: 30, w: 620, h: yTit - 30 - Math.round(0.2 * 150 * sc) }, ancora: 'centro' }, textoSvg: sobre(tx), blocos, semFonte: !fl };
    return { r, y, ok: y <= LIMITE && blocos.every((b) => b.cabe !== false || b.nome === 'fonte') };
  };
  let melhor = null;
  for (const sc of [1.1, 1, 0.92, 0.84, 0.76]) {
    const t = montar(sc, 0);
    melhor = t;
    if (t.ok) {
      // sobra de altura vira foto maior (a imagem é a protagonista), sem passar do limite
      const extra = Math.min(240, Math.max(0, LIMITE - t.y - 24));
      if (extra > 30) { const t2 = montar(sc, extra); if (t2.ok) melhor = t2; }
      break;
    }
  }
  return melhor.r;
}

function lNumero(s, ctx) {
  const T = TEMA.marinho;
  const n = (s.dados && s.dados.numero) || {};
  const LIMITE = H - 150;
  let melhor = null;
  for (const numMax of [540, 480, 420, 360, 300]) {
    for (const tMax of [84, 72, 64, 56]) {
      const blocos = []; let tx = topo({ ...ctx, tema: T });
      const c = chip({ x: MARGEM - 20, y: 120, texto: n.rotulo || s.titulo || '', fundo: COR.amarelo, cor: COR.marinho, tam: 96 });
      tx += c.svg;
      const num = fit({ texto: up(n.valor || ''), k: 'aDisplay', larg: 640, altVis: capK('aDisplay') * numMax + 4, max: numMax, min: 240, ent: 1.0, papel: 'r_numero', passo: 10 });
      const yNum = 120 + 96 * 1.45 + 34;
      tx += colocar(num, { x: MARGEM - 20, ytop: yNum, k: 'aDisplay', tema: { ...T, texto: COR.vermelho } });
      blocos.push({ nome: 'numero', ...A.resumo(num, capK('aDisplay') * numMax) });
      let y = yNum + num.altura + 34;
      const t = fit({ texto: up(s.texto), k: 'aDisplay', larg: 720, altVis: 340, max: tMax, min: 52, ent: 1.06, papel: 'r_titulo' });
      tx += colocar(t, { x: MARGEM - 20, ytop: y, k: 'aDisplay', tema: T });
      blocos.push({ nome: 'texto', ...A.resumo(t) });
      y += t.altura + 34;
      if (s.apoio) {
        tx += `<rect x="${MARGEM - 20}" y="${y}" width="130" height="7" fill="${COR.amarelo}"/>`;
        const ap = fit({ texto: s.apoio, k: 'iCorpo', larg: 560, altVis: Math.max(60, LIMITE - y - 30), max: 38, min: 32, ent: 1.34, papel: 'r_corpo' });
        tx += colocar(ap, { x: MARGEM - 20, ytop: y + 32, k: 'iCorpo', tema: T });
        blocos.push({ nome: 'apoio', ...A.resumo(ap) });
        y += 32 + ap.altura;
      }
      const fl = s.fonte_linha ? String(s.fonte_linha) : '';
      if (fl) tx += `<text x="${MARGEM - 20}" y="${H - 120}" font-family="${ARQ.iSemi.familia}" font-weight="600" font-size="26" fill="#B9C0CD">${esc(fl)}</text>`;
      else blocos.push({ nome: 'fonte', tam: 0, cabe: false, motivo: 'Número sem linha de fonte' });
      tx += rodape({ tema: T, alinharHandle: 'centro', y: H - 56 });
      const fundo = grao(0.05) + forma(s.forma || { tipo: 'seta', cor: 'vermelho' }, { x: 560, y: 70, w: 480, h: 600 }, COR.vermelho);
      melhor = { tema: T, fundoSvg: base(T.fundo, '', fundo), recorte: { caixa: { x: 520, y: 240, w: 560, h: 900 }, ancora: 'direita' }, textoSvg: sobre(tx), blocos, semFonte: !fl };
      if (y <= LIMITE && blocos.every((b) => b.cabe !== false || b.nome === 'fonte')) return melhor;
    }
  }
  return melhor;
}

function lManchete(s, ctx) {
  const escuro = s.fundo === 'marinho';
  const T = escuro ? TEMA.marinho : TEMA.creme;
  const temBanda = !!s.cta;
  const yBanda = temBanda ? H - 210 : H - 110;
  const corTexto = escuro ? COR.creme : COR.marinho;
  let melhor = null;
  for (const tMax of [128, 112, 96, 84]) {
    const blocos = []; let tx = topo({ ...ctx, tema: T }); let fundo = grao(0.05);
    const t = fit({ texto: up(s.titulo || s.texto), k: 'aDisplay', larg: 640, altVis: 420, max: tMax, min: 80, ent: 1.0, papel: 'r_titulo' });
    let y = 180;
    tx += colocar(t, { x: MARGEM - 10, ytop: y, k: 'aDisplay', tema: T });
    blocos.push({ nome: 'titulo', ...A.resumo(t) });
    y += t.altura + 22;
    const f = roughen(8, '0.04 0.2', 12);
    fundo += `<defs>${f.def}</defs><g filter="url(#${f.id})"><rect x="${MARGEM - 10}" y="${y}" width="560" height="12" fill="${escuro ? COR.amarelo : COR.vermelho}"/></g>`;
    y += 56;
    if (s.titulo && s.texto) {
      const c = fit({ texto: s.texto, k: 'iNegrito', larg: 560, altVis: 220, max: 42, min: 34, ent: 1.3, papel: 'r_corpo' });
      tx += colocar(c, { x: MARGEM - 10, ytop: y, k: 'iNegrito', tema: { ...T, texto: corTexto } });
      blocos.push({ nome: 'corpo', ...A.resumo(c) });
      y += c.altura + 46;
    }
    if (s.destaque) {
      const d = fit({ texto: up(s.destaque), k: 'aDisplay', larg: 560, altVis: 300, max: 84, min: 52, ent: 1.2, papel: 'r_titulo' });
      d.linhas.forEach((ln, i) => {
        const yl = y + i * d.tam * d.entrelinha;
        fundo += `<rect x="${MARGEM - 26}" y="${yl - 12}" width="${larguraLinha(ln) + 32}" height="${capK('aDisplay') * d.tam + 26}" fill="${COR.amarelo}"/>`;
      });
      tx += colocar(d, { x: MARGEM - 10, ytop: y, k: 'aDisplay', tema: { ...T, texto: COR.marinho } });
      blocos.push({ nome: 'destaque', ...A.resumo(d) });
      y += d.altura + 24;
    }
    const fl = s.fonte_linha ? String(s.fonte_linha) : '';
    if (temBanda) {
      const cta = fit({ texto: up(s.cta), k: 'aDisplay', larg: LARG, altVis: 90, max: 74, min: 50, ent: 1.0, papel: 'r_cta' });
      fundo += `<rect x="0" y="${yBanda}" width="${W}" height="${H - yBanda}" fill="${COR.marinho}"/>`;
      tx += colocar(cta, { x: MARGEM - 10, ytop: yBanda + 36, k: 'aDisplay', tema: TEMA.marinho });
      blocos.push({ nome: 'cta', ...A.resumo(cta) });
      if (s.cta_apoio) {
        const ca = fit({ texto: up(s.cta_apoio), k: 'aDisplay', larg: LARG, altVis: 60, max: 52, min: 36, ent: 1.0, papel: 'r_cta' });
        tx += colocar(ca, { x: MARGEM - 10, ytop: yBanda + 36 + cta.altura + 22, k: 'aDisplay', tema: { ...TEMA.marinho, texto: COR.creme } });
        blocos.push({ nome: 'cta_apoio', ...A.resumo(ca) });
      }
    } else tx += rodape({ tema: T, fonte: fl, y: H - 56 });
    fundo += forma(s.forma || { tipo: 'pincelada', cor: 'vermelho' }, { x: 640, y: 300, w: 440, h: Math.max(240, Math.min(560, yBanda - 460)) }, COR.vermelho);
    melhor = { tema: T, fundoSvg: base(T.fundo, '', fundo), recorte: { caixa: { x: 560, y: 250, w: 520, h: yBanda - 250 }, ancora: 'direita' }, textoSvg: sobre(tx), blocos };
    if (y <= yBanda - 24 && blocos.every((b) => b.cabe !== false)) break;
  }
  return melhor;
}

// ── Mapeamento de layouts da identidade para o tema ───────────────────────────────────────
function escolher(slide) {
  const l = slide.layout;
  if (['rep_capa', 'rep_comparacao', 'rep_numero', 'rep_manchete'].includes(l)) return l;
  if (slide.dados && slide.dados.numero) return 'rep_numero';
  if (l === 'capa_tipografica' || l === 'capa_foto' || slide.funcao === 'capa') return 'rep_capa';
  if (l === 'comparacao' && slide.dados && slide.dados.esquerda && slide.dados.direita) return 'rep_comparacao';
  return 'rep_manchete';
}
const LAYOUTS = { rep_capa: lCapa, rep_comparacao: lComparacao, rep_numero: lNumero, rep_manchete: lManchete };

async function renderizar(slide, ctx, imagem, arquivoEncerramento, fundo) {
  const nome = escolher(slide);
  const s = nome === 'rep_manchete' && slide.layout === 'encerramento' ? { ...slide, cta: slide.texto, titulo: 'Fica a pergunta', texto: null, fundo: slide.fundo || 'creme' } : slide;
  const r = LAYOUTS[nome](s, ctx);
  const camadas = [];
  const elementos = [`tema_reportagem`, nome];
  let recorte = null;
  if (imagem) {
    recorte = await prepararRecorte(imagem, r.recorte.caixa, r.recorte.ancora);
    if (recorte && recorte.erro) { elementos.push(recorte.erro); recorte = null; }
  }
  if (!recorte) elementos.push('sem_recorte');
  let png = await sharp(Buffer.from(r.fundoSvg)).png().toBuffer();
  if (fundo) {
    // Textura do fundo por IA: só mistura de luz, bem sutil, com um recorte diferente a cada slide. Texto e rosto ficam por cima.
    try {
      const k = 1.5; const i = ((ctx.indice || 1) - 1) % 4;
      const grande = await sharp(fundo).resize(Math.round(W * k), Math.round(H * k), { fit: 'cover' }).greyscale().png().toBuffer();
      const textura = await sharp(grande).extract({ left: Math.round((i % 2) * W * (k - 1)), top: Math.round((i >> 1) * H * (k - 1)), width: W, height: H }).ensureAlpha(0.5).png().toBuffer();
      png = await sharp(png).composite([{ input: textura, blend: 'soft-light' }]).png().toBuffer();
      elementos.push('fundo_ia');
    } catch { elementos.push('fundo_ia_invalido'); }
  }
  if (recorte) {
    let entrada = recorte.input;
    if (r.recorte.degrade) {
      // desvanece a base do recorte no fundo (como na capa): máscara vertical de opacidade.
      const d = r.recorte.degrade; const localDe = Math.max(0, d.de - recorte.top); const localAte = Math.min(recorte.h, d.ate - recorte.top);
      const mascara = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${recorte.w}" height="${recorte.h}"><defs><linearGradient id="m" x1="0" y1="${localDe}" x2="0" y2="${localAte}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${recorte.w}" height="${recorte.h}" fill="url(#m)"/></svg>`);
      entrada = await sharp(recorte.input).composite([{ input: await sharp(mascara).png().toBuffer(), blend: 'dest-in' }]).png().toBuffer();
    }
    camadas.push({ input: entrada, left: recorte.left, top: recorte.top });
  }
  camadas.push({ input: Buffer.from(r.textoSvg), top: 0, left: 0 });
  png = await sharp(png).composite(camadas).png().toBuffer();
  const m = A.resumirMetricas(r.blocos, nome, elementos);
  m.tema = 'reportagem';
  if (r.semFonte) m.cabe = false;
  return { png, metrics: m };
}

module.exports = { renderizar, escolher, COR, TEMA, prepararRecorte };
