// Arte da série "Ideias que dão dinheiro": 8 telas 1080 × 1350 (4:5), fundo marfim, azul royal, laranja e preto, fotografia
// real ocupando ~35% da tela, muito espaço em branco, tipografia grande e marcas feitas à mão (sublinhados, setas, círculos).
// Mesmas regras do resto da ferramenta: todo texto é desenhado por código e MEDIDO pela fonte real; se não cabe no
// tamanho mínimo legível, a tela sai marcada cabe:false e o carrossel é recusado (nada é espremido).
// O que NÃO existe aqui: selo azul (a conta não é verificada), logotipo desenhado, imagem de IA, rosto alterado.
// O rosto do Pedro só aparece na tela 8; fotos do negócio entram sem filtro.
require('../../fontSetup');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const A = require('../arte');
const { ACCOUNT } = require('../account');
const C = require('./config');
const U = require('./util');

const { W, H, ARQ, esc } = A;
const M = 80;
const LARG = W - 2 * M;
const COR = C.COR;
const FOTO_H = 555;                                   // 920 × 555 = 35% da área da tela
const Y_RODAPE = 1286;
const Y_REGUA = 1246;
const up = (t) => String(t ?? '').toLocaleUpperCase('pt-BR');
const FAM = { anton: ARQ.aDisplay, serif: ARQ.corpoNegrito, serifN: ARQ.corpo, inter: ARQ.iCorpo, interB: ARQ.iNegrito, interS: ARQ.iSemi, manrope: ARQ.mDisplay, manropeB: ARQ.mRotulo };
const ajustar = (o) => A.ajustar({ colchetes: false, ...o });

// Pseudo-aleatório determinístico: a mesma tela sai igual sempre (as marcas "à mão" não mudam entre exportações).
const rnd = (semente) => { let s = semente * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };

// ── Marcas à mão ────────────────────────────────────────────────────────────
function sublinhado(x0, x1, y, { cor = COR.laranja, grossura = 9, semente = 1 } = {}) {
  const r = rnd(semente); const n = Math.max(2, Math.round((x1 - x0) / 90));
  let d = `M${x0.toFixed(1)} ${(y + (r() - 0.5) * 4).toFixed(1)}`;
  for (let i = 1; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; const cx = x - (x1 - x0) / n / 2; d += ` Q${cx.toFixed(1)} ${(y + (r() - 0.5) * 9).toFixed(1)} ${x.toFixed(1)} ${(y + (r() - 0.5) * 5).toFixed(1)}`; }
  return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="${grossura}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function setaCurva(x, y, w, h, { cor = COR.azul, grossura = 8, semente = 3, volta = false } = {}) {
  const r = rnd(semente); const j = () => (r() - 0.5) * 8;
  const x2 = x + w; const y2 = y + h;
  const d = `M${x} ${y + j()} C${x + w * 0.1} ${y2 + j()}, ${x + w * 0.7} ${y2 + 30 + j()}, ${x2} ${y2 + j()}`;
  const a = 22; const ponta = `M${x2 - a} ${y2 - a * 0.9} L${x2} ${y2} L${x2 - a * 1.1} ${y2 + a * 0.7}`;
  const t = volta ? ` transform="translate(${W} 0) scale(-1 1)"` : '';
  return `<g${t} fill="none" stroke="${cor}" stroke-width="${grossura}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/><path d="${ponta}"/></g>`;
}
function circuloMao(cx, cy, rx, ry, { cor = COR.laranja, grossura = 7, semente = 5 } = {}) {
  const r = rnd(semente); const pts = [];
  for (let i = 0; i <= 28; i++) { const a = (i / 24) * Math.PI * 2 + 0.3; const k = 1 + (r() - 0.5) * 0.06 + (i > 24 ? 0.06 : 0); pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
  return `<path d="M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}" fill="none" stroke="${cor}" stroke-width="${grossura}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
const faiscas = (x, y, cor = COR.laranja, s = 1) => `<g stroke="${cor}" stroke-width="${6 * s}" stroke-linecap="round"><path d="M${x} ${y - 30 * s} V${y - 8 * s}"/><path d="M${x + 24 * s} ${y - 20 * s} L${x + 10 * s} ${y - 6 * s}"/><path d="M${x - 24 * s} ${y - 20 * s} L${x - 10 * s} ${y - 6 * s}"/></g>`;

// ── Texto: linhas medidas, destaque em azul com sublinhado laranja ──────────
function texto(bloco, { x, y, fam, cor = COR.preto, cd = COR.azul, sublinha = true, semente = 1, alinhar = 'esquerda', largura = LARG }) {
  const f = FAM[fam]; const linhaH = bloco.tam * bloco.entrelinha; let out = '';
  bloco.linhas.forEach((ln, i) => {
    const base = y + i * linhaH + bloco.tam * 0.9;
    const larguraLinha = ln.reduce((m, w) => Math.max(m, w.x + w.larg), 0);
    const desloc = alinhar === 'centro' ? (largura - larguraLinha) / 2 : 0;
    let ini = null;
    ln.forEach((w, j) => {
      if (sublinha && w.hi && ini === null) ini = j;
      if (sublinha && ini !== null && (!w.hi || j === ln.length - 1)) {
        const fim = w.hi ? j : j - 1;
        out += sublinhado(x + desloc + ln[ini].x - 4, x + desloc + ln[fim].x + ln[fim].larg + 4, base + bloco.tam * 0.07, { semente: semente + i * 7 + ini, grossura: Math.max(6, bloco.tam * 0.1) });
        ini = null;
      }
      out += `<text x="${(x + desloc + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${f.familia}" font-weight="${f.peso}" font-size="${bloco.tam}" fill="${w.hi ? cd : cor}">${esc(w.t)}</text>`;
    });
  });
  return out;
}
const linhaSimples = (t, { x, y, fam, tam, cor = COR.preto, espaco = 0, ancora = 'start', op = 1 }) => `<text x="${x}" y="${y}" font-family="${FAM[fam].familia}" font-weight="${FAM[fam].peso}" font-size="${tam}" letter-spacing="${espaco}" fill="${cor}" text-anchor="${ancora}" opacity="${op}">${esc(t)}</text>`;
const etiqueta = (t, { x, y, fundo = COR.laranja, cor = COR.preto, tam = 24 }) => {
  const larg = A.largura('iNegrito', up(t), tam, 2) + 40;
  return { svg: `<rect x="${x}" y="${y}" width="${larg.toFixed(0)}" height="${tam + 24}" rx="6" fill="${fundo}"/>${linhaSimples(up(t), { x: x + 20, y: y + tam + 6, fam: 'interB', tam, cor, espaco: 2 })}`, larg, altura: tam + 24 };
};

// ── Estrutura fixa de toda tela (mesmas margens, mesmo rodapé) ──────────────
function estrutura({ n, total = C.TOTAL_SLIDES, ultima = false }) {
  let s = `<rect width="${W}" height="${H}" fill="${COR.marfim}"/>`;
  s += `<rect x="${M}" y="70" width="16" height="16" fill="${COR.laranja}"/>`;
  s += linhaSimples(C.SERIE, { x: M + 30, y: 86, fam: 'interB', tam: 22, espaco: 3 });
  s += linhaSimples(String(n).padStart(2, '0'), { x: W - M - 52, y: 86, fam: 'interS', tam: 24, cor: COR.mudo, ancora: 'end' }) + linhaSimples(`/${String(total).padStart(2, '0')}`, { x: W - M, y: 86, fam: 'inter', tam: 24, cor: COR.mudo, ancora: 'end', op: 0.8 });
  s += `<rect x="${M}" y="${Y_REGUA}" width="${LARG}" height="2" fill="${COR.linha}"/>`;
  s += linhaSimples(ACCOUNT.handle, { x: M, y: Y_RODAPE + 22, fam: 'manropeB', tam: 28 });
  if (!ultima) s += `<g stroke="${COR.azul}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M${W - M - 62} ${Y_RODAPE + 10} H${W - M - 6}"/><path d="M${W - M - 24} ${Y_RODAPE - 6} L${W - M - 6} ${Y_RODAPE + 10} L${W - M - 24} ${Y_RODAPE + 26}"/></g>`;
  return s;
}

// ── Foto: recorte sem filtro, moldura preta e bloco laranja deslocado ───────
async function foto(buf, { x, y, w = LARG, h = FOTO_H, credito = null, etiquetas = [] }) {
  const img = await sharp(buf).rotate().resize(w, h, { fit: 'cover', position: 'attention' }).jpeg({ quality: 92 }).toBuffer();
  const url = `data:image/jpeg;base64,${img.toString('base64')}`;
  let s = `<rect x="${x + 16}" y="${y + 16}" width="${w}" height="${h}" fill="${COR.laranja}"/>`;
  s += `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${url}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${COR.preto}" stroke-width="4"/>`;
  if (credito) { const t = U.limita(credito, 44); const lw = A.largura('iSemi', t, 20, 0) + 24; s += `<rect x="${x + w - lw}" y="${y + h - 38}" width="${lw.toFixed(0)}" height="38" fill="${COR.preto}" opacity="0.88"/>${linhaSimples(t, { x: x + w - lw + 12, y: y + h - 13, fam: 'interS', tam: 20, cor: COR.marfim })}`; }
  let ex = x; etiquetas.forEach((t) => { const e = etiqueta(t, { x: ex, y: y - 6, fundo: COR.preto, cor: COR.marfim, tam: 22 }); s += e.svg; ex += e.larg + 10; });
  return s;
}
function semFoto(x, y, nome, { w = LARG, h = FOTO_H, aviso = 'Sem foto oficial confirmada' } = {}) {
  const b = ajustar({ texto: up(nome), k: 'aDisplay', larg: w - 100, alt: h - 220, max: 150, min: 60, entrelinha: 1.0 });
  let s = `<rect x="${x + 16}" y="${y + 16}" width="${w}" height="${h}" fill="${COR.laranja}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COR.azul}" stroke="${COR.preto}" stroke-width="4"/>`;
  s += texto(b, { x: x + 50, y: y + 60, fam: 'anton', cor: COR.marfim, cd: COR.marfim, sublinha: false });
  s += linhaSimples(aviso, { x: x + 50, y: y + h - 36, fam: 'interS', tam: 22, cor: COR.marfim, op: 0.85 });
  return { svg: s, blocos: [{ nome: 'nome_sem_foto', ...A.resumo(b) }] };
}

const blocoResumo = (nome, b, alt) => ({ nome, ...A.resumo(b, alt) });
const montar = async (inner) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${inner}</svg>`)).png().toBuffer();

// ── Layouts ─────────────────────────────────────────────────────────────────
async function lCapa(s, ctx) {
  const blocos = []; let inner = estrutura({ n: 1 });
  const rotulo = [ctx.pais && ctx.pais !== 'não informado' ? ctx.pais : null, C.CATEGORIAS[ctx.categoria]].filter(Boolean).map(up);
  if (ctx.foto) inner += await foto(ctx.foto.buf, { x: M, y: 150, credito: ctx.foto.credito, etiquetas: rotulo });
  else { const f = semFoto(M, 150, ctx.nome); inner += f.svg; blocos.push(...f.blocos); }
  const t = ajustar({ texto: up(s.texto), k: 'aDisplay', larg: LARG, alt: 1215 - 770, max: 104, min: 62, entrelinha: 1.1 });
  inner += texto(t, { x: M, y: 770, fam: 'anton', semente: 11 });
  blocos.push(blocoResumo('titulo', t, 445));
  return { inner, blocos, elementos: [ctx.foto ? `foto_${ctx.foto.tipo}` : 'sem_foto'] };
}

async function lProblema(s) {
  let inner = estrutura({ n: 2 }); const blocos = [];
  inner += `<text x="${M - 10}" y="460" font-family="${FAM.serif.familia}" font-weight="700" font-size="420" fill="${COR.azul}" opacity="0.13">“</text>`;
  const r = etiqueta(s.rotulo, { x: M, y: 170 }); inner += r.svg;
  inner += linhaSimples(s.intro, { x: M, y: 290, fam: 'interS', tam: 34, cor: COR.mudo });
  const t = ajustar({ texto: s.corpo, k: 'corpoNegrito', larg: LARG, alt: 780, max: 84, min: 52, entrelinha: 1.16 });
  inner += texto(t, { x: M, y: 350, fam: 'serif', semente: 21 }); blocos.push(blocoResumo('problema', t, 780));
  const fim = 350 + t.altura;
  inner += circuloMao(W - M - 90, Math.min(fim + 130, 1130), 70, 70, { semente: 8 }) + linhaSimples('?', { x: W - M - 90, y: Math.min(fim + 130, 1130) + 30, fam: 'anton', tam: 96, cor: COR.laranja, ancora: 'middle' });
  return { inner, blocos, elementos: ['tipografico'] };
}

async function lSolucao(s, ctx) {
  let inner = estrutura({ n: 3 }); const blocos = [];
  const r = etiqueta(s.rotulo, { x: M, y: 150 }); inner += r.svg;
  const t = ajustar({ texto: s.texto, k: 'corpoNegrito', larg: LARG, alt: 400, max: 66, min: 44, entrelinha: 1.18 });
  inner += texto(t, { x: M, y: 232, fam: 'serif', semente: 31 }); blocos.push(blocoResumo('solucao', t, 400));
  const yFoto = 1230 - FOTO_H - 6;
  if (ctx.foto2) inner += await foto(ctx.foto2.buf, { x: M, y: yFoto - 16, credito: ctx.foto2.credito });
  else { const f = semFoto(M, yFoto - 16, ctx.nome, { aviso: 'Demonstração visual indisponível' }); inner += f.svg; blocos.push(...f.blocos); }
  inner += setaCurva(W - M - 330, 640, 260, 80, { semente: 4 });
  return { inner, blocos, elementos: [ctx.foto2 ? `foto_${ctx.foto2.tipo}` : 'sem_foto'] };
}

const ICONE = { cliente: (x, y) => `<circle cx="${x + 45}" cy="${y + 34}" r="22" fill="none" stroke="${COR.preto}" stroke-width="6"/><path d="M${x + 6} ${y + 100} Q${x + 45} ${y + 50} ${x + 84} ${y + 100}" fill="none" stroke="${COR.preto}" stroke-width="6" stroke-linecap="round"/>`, empresa: (x, y) => `<path d="M${x + 6} ${y + 100} V${y + 20} H${x + 56} V${y + 100} M${x + 56} ${y + 50} H${x + 86} V${y + 100} M${x} ${y + 100} H${x + 92}" fill="none" stroke="${COR.preto}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>` };
async function lDinheiro(s) {
  let inner = estrutura({ n: 4 }); const blocos = [];
  const r = etiqueta(s.rotulo, { x: M, y: 150 }); inner += r.svg;
  inner += linhaSimples(s.intro, { x: M, y: 290, fam: 'interS', tam: 34, cor: COR.mudo });
  const t = ajustar({ texto: s.corpo, k: 'corpoNegrito', larg: LARG, alt: 400, max: 62, min: 42, entrelinha: 1.18 });
  inner += texto(t, { x: M, y: 345, fam: 'serif', semente: 41 }); blocos.push(blocoResumo('modelo', t, 400));
  // fluxo: cliente → [modelo] → empresa
  const y0 = 760;
  inner += ICONE.cliente(M + 10, y0 + 40) + linhaSimples('CLIENTE', { x: M + 55, y: y0 + 176, fam: 'interB', tam: 26, ancora: 'middle', espaco: 2 });
  inner += ICONE.empresa(W - M - 102, y0 + 40) + linhaSimples('EMPRESA', { x: W - M - 56, y: y0 + 176, fam: 'interB', tam: 26, ancora: 'middle', espaco: 2 });
  const nomeModelo = up(C.MODELOS_RECEITA[s.modelo] || '');
  const tm = ajustar({ texto: nomeModelo, k: 'aDisplay', larg: 560, alt: 130, max: 96, min: 52, entrelinha: 1.0 });
  const larg = Math.min(640, Math.max(340, Math.max(...tm.linhas.map((l) => l.reduce((m, w) => Math.max(m, w.x + w.larg), 0))) + 80));
  const cx = W / 2; const bx = cx - larg / 2;
  inner += `<rect x="${bx + 12}" y="${y0 + 28}" width="${larg}" height="132" fill="${COR.laranja}"/><rect x="${bx}" y="${y0 + 16}" width="${larg}" height="132" fill="${COR.azul}" stroke="${COR.preto}" stroke-width="4"/>`;
  inner += texto(tm, { x: bx, y: y0 + 16 + (132 - tm.altura) / 2 - 2, fam: 'anton', cor: COR.marfim, cd: COR.marfim, sublinha: false, alinhar: 'centro', largura: larg });
  blocos.push(blocoResumo('tipo_receita', tm, 130));
  inner += `<g fill="none" stroke="${COR.preto}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M${M + 130} ${y0 + 82} H${bx - 20}"/><path d="M${bx + larg + 20} ${y0 + 82} H${W - M - 140}"/><path d="M${W - M - 160} ${y0 + 62} L${W - M - 140} ${y0 + 82} L${W - M - 160} ${y0 + 102}"/></g>`;
  inner += `<circle cx="${M + 175}" cy="${y0 + 82 - 38}" r="22" fill="${COR.laranja}" stroke="${COR.preto}" stroke-width="4"/>${linhaSimples('$', { x: M + 175, y: y0 + 82 - 28, fam: 'interB', tam: 28, ancora: 'middle' })}`;
  return { inner, blocos, elementos: ['fluxo_dinheiro'] };
}

async function lProva(s) {
  let inner = estrutura({ n: 5 }); const blocos = [];
  const r = etiqueta(s.rotulo, { x: M, y: 150 }); inner += r.svg;
  const tt = ajustar({ texto: s.titulo, k: 'corpoNegrito', larg: LARG, alt: 130, max: 56, min: 38, entrelinha: 1.12 });
  inner += texto(tt, { x: M, y: 232, fam: 'serif', semente: 51, sublinha: false }); blocos.push(blocoResumo('titulo', tt, 130));
  const n = s.prova.length; const topo = 232 + tt.altura + 40; const base = 1190; const faixa = (base - topo) / n;
  s.prova.forEach((p, i) => {
    const y = topo + i * faixa;
    const tamMax = n === 1 ? 230 : n === 2 ? 170 : 130;
    const v = ajustar({ texto: up(p.valor), k: 'aDisplay', larg: LARG, alt: faixa * 0.62, max: tamMax, min: 72, entrelinha: 1.0 });
    inner += texto(v, { x: M, y, fam: 'anton', cor: COR.azul, cd: COR.azul, sublinha: false }); blocos.push(blocoResumo(`valor_${i + 1}`, v, faixa * 0.62));
    const rt = ajustar({ texto: up(p.rotulo), k: 'iNegrito', larg: LARG, alt: 60, max: 36, min: 26, entrelinha: 1.1 });
    inner += texto(rt, { x: M, y: y + v.altura + 6, fam: 'interB', sublinha: false }); blocos.push(blocoResumo(`rotulo_${i + 1}`, rt, 60));
    if (p.atribuicao) inner += `<rect x="${M}" y="${y + v.altura + rt.altura + 20}" width="${(A.largura('iNegrito', up(p.atribuicao), 22, 2) + 28).toFixed(0)}" height="36" fill="${COR.laranja}"/>${linhaSimples(up(p.atribuicao), { x: M + 14, y: y + v.altura + rt.altura + 45, fam: 'interB', tam: 22, espaco: 2 })}`;
    if (i < n - 1) inner += `<rect x="${M}" y="${y + faixa - 22}" width="${LARG}" height="2" fill="${COR.linha}"/>`;
  });
  inner += circuloMao(W - M - 70, 190, 52, 40, { semente: 6 }) + linhaSimples('✓', { x: W - M - 70, y: 208, fam: 'interB', tam: 46, cor: COR.laranja, ancora: 'middle' });
  const f = ajustar({ texto: s.fonte_linha, k: 'iCorpo', larg: LARG, alt: 44, max: 20, min: 17, entrelinha: 1.25 });
  inner += texto(f, { x: M, y: Y_REGUA - 8 - f.altura, fam: 'inter', cor: COR.mudo, sublinha: false }); blocos.push(blocoResumo('fonte', f, 44));
  return { inner, blocos, elementos: ['numeros_verificados'] };
}

async function lFunciona(s) {
  let inner = estrutura({ n: 6 }); const blocos = [];
  const r = etiqueta(s.rotulo, { x: M, y: 150 }); inner += r.svg;
  inner += linhaSimples(s.intro, { x: M, y: 290, fam: 'interS', tam: 36, cor: COR.mudo });
  s.itens.forEach((t, i) => {
    const y = 360 + i * 280;
    inner += `<circle cx="${M + 62}" cy="${y + 94}" r="62" fill="${i === 1 ? COR.azul : COR.laranja}" stroke="${COR.preto}" stroke-width="4"/>${linhaSimples(String(i + 1), { x: M + 62, y: y + 124, fam: 'anton', tam: 84, cor: i === 1 ? COR.marfim : COR.preto, ancora: 'middle' })}`;
    const b = ajustar({ texto: t, k: 'corpoNegrito', larg: LARG - 170, alt: 200, max: 66, min: 42, entrelinha: 1.12 });
    inner += texto(b, { x: M + 170, y: y + 94 - b.altura / 2, fam: 'serif', sublinha: false }); blocos.push(blocoResumo(`item_${i + 1}`, b, 200));
    if (i < 2) inner += `<rect x="${M + 170}" y="${y + 226}" width="${LARG - 170}" height="2" fill="${COR.linha}"/>`;
  });
  inner += `<text x="${W - M - 40}" y="320" font-family="${FAM.anton.familia}" font-size="46" fill="${COR.laranja}" text-anchor="end">+</text>`;
  return { inner, blocos, elementos: ['tres_itens'] };
}

async function lBrasil(s) {
  let inner = estrutura({ n: 7 }); const blocos = [];
  const r = etiqueta(s.rotulo, { x: M, y: 150 }); inner += r.svg;
  inner += linhaSimples(s.intro, { x: M, y: 290, fam: 'interS', tam: 34, cor: COR.mudo });
  const y0 = 340; const alt = (Y_REGUA - 30 - y0) / 5;
  s.itens.forEach((it, i) => {
    const y = y0 + i * alt;
    inner += `<rect x="${M}" y="${y}" width="${LARG}" height="2" fill="${COR.preto}"/>`;
    inner += linhaSimples(up(it.rotulo), { x: M, y: y + alt / 2 + 9, fam: 'interB', tam: 26, cor: COR.azul, espaco: 2 });
    const b = ajustar({ texto: it.valor, k: 'corpoNegrito', larg: LARG - 270, alt: alt - 24, max: 50, min: 34, entrelinha: 1.1 });
    inner += texto(b, { x: M + 270, y: y + (alt - b.altura) / 2, fam: 'serif', sublinha: false }); blocos.push(blocoResumo(`item_${i + 1}`, b, alt - 24));
  });
  inner += `<rect x="${M}" y="${y0 + 5 * alt}" width="${LARG}" height="2" fill="${COR.preto}"/>`;
  return { inner, blocos, elementos: ['hipotese_brasil'] };
}

let _avatar;
async function avatar(d) {
  if (!_avatar) _avatar = await sharp(path.join(__dirname, '..', '..', 'assets', 'pedro-perfil.png')).resize(320, 320).png().toBuffer();
  const mascara = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}"/></svg>`);
  const png = await sharp(_avatar).resize(d, d).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
async function lCta(s) {
  let inner = estrutura({ n: 8, ultima: true }); const blocos = [];
  // Cabeçalho do perfil (referência: print do perfil): foto redonda, nome e @. Sem selo: a conta não é verificada.
  inner += `<image x="${M}" y="140" width="150" height="150" href="${await avatar(150)}"/><circle cx="${M + 75}" cy="215" r="76" fill="none" stroke="${COR.preto}" stroke-width="4"/>`;
  inner += linhaSimples(ACCOUNT.nome, { x: M + 180, y: 205, fam: 'manrope', tam: 56 });
  inner += linhaSimples(ACCOUNT.handle, { x: M + 182, y: 255, fam: 'inter', tam: 34, cor: COR.mudo });
  const t1 = ajustar({ texto: s.principal, k: 'aDisplay', larg: LARG, alt: 430, max: 112, min: 70, entrelinha: 1.04 });
  inner += texto(t1, { x: M, y: 345, fam: 'anton', cor: COR.azul, cd: COR.azul, sublinha: false }); blocos.push(blocoResumo('principal', t1, 430));
  const y2 = 345 + t1.altura + 36;
  const t2 = ajustar({ texto: s.secundario, k: 'iNegrito', larg: LARG, alt: 190, max: 42, min: 30, entrelinha: 1.2 });
  inner += texto(t2, { x: M, y: y2, fam: 'interB', sublinha: false }); blocos.push(blocoResumo('secundario', t2, 190));
  const yc = Math.max(y2 + t2.altura + 36, 960); const altC = Y_REGUA - 30 - yc;
  const t3 = ajustar({ texto: s.cta, k: 'aDisplay', larg: LARG - 90, alt: altC - 60, max: 66, min: 40, entrelinha: 1.06 });
  inner += `<rect x="${M + 12}" y="${yc + 12}" width="${LARG}" height="${altC}" fill="${COR.preto}"/><rect x="${M}" y="${yc}" width="${LARG}" height="${altC}" fill="${COR.laranja}" stroke="${COR.preto}" stroke-width="4"/>`;
  inner += texto(t3, { x: M + 45, y: yc + (altC - t3.altura) / 2, fam: 'anton', sublinha: false }); blocos.push(blocoResumo('cta', t3, altC - 60));
  return { inner, blocos, elementos: ['foto_do_pedro_so_aqui', 'sem_selo'] };
}

const LAYOUTS = { capa: lCapa, problema: lProblema, solucao: lSolucao, dinheiro: lDinheiro, prova: lProva, funciona: lFunciona, brasil: lBrasil, cta: lCta };

// slide: tela montada por copy.montarTelas. ctx: { nome, pais, categoria, foto: {buf,tipo,credito}|null, foto2 }
async function renderizarTela(slide, ctx = {}) {
  const r = await LAYOUTS[slide.layout](slide, ctx);
  const png = await montar(r.inner);
  const problemas = r.blocos.filter((b) => b.cabe === false).map((b) => `${b.nome}: ${b.motivo}`);
  return { png, metrics: { layout: slide.layout, cabe: problemas.length === 0, fonte_px: Math.min(...r.blocos.filter((b) => b.tam).map((b) => b.tam)), blocos: r.blocos, elementos: r.elementos, problemas, largura: W, altura: H } };
}

// Renderiza as 8 telas. `fotos`: { negocio: {buf,tipo,credito}|null, ilustracao: ...|null }.
async function renderizarCarrossel(slides, { nome, pais, categoria, fotos = {} }) {
  const out = [];
  for (const s of slides) {
    const f1 = fotos.negocio || null; const f2 = fotos.produto || fotos.negocio || null;
    out.push(await renderizarTela(s, { nome, pais, categoria, foto: f1, foto2: s.layout === 'solucao' ? f2 : null }));
  }
  return out;
}

module.exports = { renderizarTela, renderizarCarrossel, estrutura, W, H, M, FOTO_H };
