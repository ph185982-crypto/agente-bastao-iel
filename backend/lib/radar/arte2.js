// Arte da série "Negócios que você não viu": 1080 × 1350 (4:5), fundo marfim, azul royal, laranja, fotografia colorida real e
// manchetes pesadas. Em vez de oito telas iguais há uma FAMÍLIA de composições, escolhida pela função da tela:
//   manchete_produto  (A) manchete + produto em destaque (variantes: meia_lua, canto)
//   foto_documental   (B) foto grande do negócio funcionando + explicação curta
//   contraste         (C) duas situações lado a lado, com uma palavra gigante de fundo
//   evidencia         (D) dado verificado em tamanho grande, com atribuição, fonte e foto/print
//   quebra_azul       (E) tela azul, quebra de ritmo para a virada da história
//   encerramento_pedro(F) foto aprovada do Pedro + convite para seguir
// Regras herdadas do resto da ferramenta: todo texto é desenhado por código e MEDIDO com a fonte real; se não cabe no tamanho
// mínimo legível a tela sai marcada cabe:false (a fonte nunca é reduzida em silêncio); nada passa da margem segura de 64 px;
// o rosto do Pedro só aparece na última tela e sem alteração; não há selo de verificação (a conta não é verificada).
require('../../fontSetup');
const path = require('path');
const sharp = require('sharp');
const A = require('../arte');
const { ACCOUNT } = require('../account');
const C = require('./config');

const { W, H, esc } = A;
const MARGEM = 64;            // margem segura mínima (px)
const PAD = 72;               // alinhamento do texto à esquerda
const LARG = W - 2 * PAD;     // 936
const Y_RODAPE = 1282;        // linha de base do rodapé: a base do texto fica em 1288 (≥ 64 px da borda)
const Y_FOTO_FIM = 1236;      // fotos que terminam antes do rodapé
const COR = Object.freeze({ marfim: '#F8F5EF', preto: '#171717', azul: '#1457D9', laranja: '#F47A1F', mudo: '#6B6860', linha: '#D9D3C4', branco: '#FFFFFF' });

// Fontes: Inter Tight (Black/ExtraBold) nos títulos, Inter no apoio. SIL OFL, ver backend/assets/FONTES-LICENCAS.md.
A.ARQ.tBlack = A.ARQ.tBlack || { arquivo: 'InterTight-Black.ttf', familia: "'Inter Tight Black', 'Inter Tight', sans-serif", peso: 400 };
A.ARQ.tExtra = A.ARQ.tExtra || { arquivo: 'InterTight-ExtraBold.ttf', familia: "'Inter Tight ExtraBold', 'Inter Tight', sans-serif", peso: 400 };
const FAM = A.ARQ;
const up = (t) => String(t ?? '').toLocaleUpperCase('pt-BR');

// ── Tamanhos mínimos legíveis no celular (px em 1080). Abaixo disso a tela é bloqueada, não encolhida. ─────────────────────────
const MIN = { titulo: 64, apoio: 34, nota: 28, rotulo: 22, valor: 190, legenda: 52, credito: 20, fonte: 20, palavra: 120 };

// ── Texto medido ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const espDe = (k, tam) => (k === 'tBlack' || k === 'tExtra' ? -Math.round(tam * 0.022 * 10) / 10 : 0);

function quebrarLinhas(texto, k, tam, larg) {
  const esp = espDe(k, tam); const larguraEsp = A.largura(k, ' ', tam, 0) + esp;
  const linhas = []; let largaDemais = false;
  for (const par of String(texto ?? '').split(/\n/)) {
    const ws = A.palavras(par, { unico: false }); let atual = []; let x = 0;
    for (const w of ws) {
      const wl = A.largura(k, w.t, tam, esp);
      if (wl > larg + 0.5) largaDemais = true;
      const sp = atual.length && !w.colada ? larguraEsp : 0;
      if (atual.length && x + sp + wl > larg) { linhas.push(atual); atual = []; x = 0; }
      const sp2 = atual.length && !w.colada ? larguraEsp : 0;
      atual.push({ ...w, x: x + sp2, larg: wl }); x += sp2 + wl;
    }
    if (atual.length) linhas.push(atual);
  }
  return { linhas, largaDemais, esp };
}
// Maior tamanho (de max até min, passo 2) em que o texto cabe na caixa; se não couber, devolve cabe:false no tamanho mínimo.
function ajustar({ texto, k, larg, alt, max, min, entrelinha = 1, maxLinhas = 99 }) {
  const lim = (tam) => { const q = quebrarLinhas(texto, k, tam, larg); const h = q.linhas.length * tam * entrelinha; return { q, h, ok: !q.largaDemais && h <= alt && q.linhas.length <= maxLinhas }; };
  for (let tam = max; tam >= min; tam -= 2) { const r = lim(tam); if (r.ok) return montar(r.q, tam, entrelinha, k, true); }
  const r = lim(min); const b = montar(r.q, min, entrelinha, k, false);
  b.motivo = r.q.largaDemais ? 'uma palavra é mais larga que a tela' : r.q.linhas.length > maxLinhas ? `passa de ${maxLinhas} linhas` : `sobram ${Math.round(r.h - alt)} px de altura`;
  return b;
}
// Título e apoio dividem uma altura: o título mantém o tamanho e o apoio encolhe até o mínimo legível; só depois o título encolhe.
// Se nem assim cabem, devolve cabe:false nos dois (a tela é bloqueada, nunca espremida).
function ajustarPar(t, a, { alt, gap = 24 }) {
  const maxT = t.max; const minT = t.min; const minA = a.min;
  for (let tamT = maxT; tamT >= minT; tamT -= 2) {
    const bt = ajustar({ ...t, max: tamT, min: tamT, alt: 9999 }); if (!bt.cabe) continue;
    if (!a.texto || !String(a.texto).trim()) { if (bt.altura <= alt) return { t: ajustar({ ...t, max: tamT, min: tamT, alt }), a: null }; continue; }
    for (let tamA = a.max; tamA >= minA; tamA -= 2) {
      const ba = ajustar({ ...a, max: tamA, min: tamA, alt: 9999 }); if (!ba.cabe) continue;
      if (bt.altura + gap + ba.altura <= alt) return { t: bt, a: ba };
    }
  }
  const bt = ajustar({ ...t, max: minT, min: minT, alt: 9999 }); const ba = a.texto && String(a.texto).trim() ? ajustar({ ...a, max: minA, min: minA, alt: 9999 }) : null;
  const falta = Math.round(bt.altura + (ba ? gap + ba.altura : 0) - alt);
  bt.cabe = false; bt.motivo = `título e apoio passam ${falta} px do espaço disponível${alt < 700 ? ' (a foto precisa de espaço)' : ''}`; if (ba) { ba.cabe = false; ba.motivo = bt.motivo; }
  return { t: bt, a: ba };
}
function montar(q, tam, entrelinha, k, cabe) {
  const w = q.linhas.reduce((m, ln) => Math.max(m, ln.reduce((a, p) => Math.max(a, p.x + p.larg), 0)), 0);
  return { tam, linhas: q.linhas, entrelinha, altura: q.linhas.length * tam * entrelinha, largura: w, k, esp: q.esp, cabe };
}

// ── Marcas feitas à mão (pseudo-aleatório determinístico: a mesma tela sai igual sempre) ─────────────────────────────────────────
const rnd = (semente) => { let s = semente * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };
function sublinhado(x0, x1, y, { cor = COR.laranja, grossura = 9, semente = 1 } = {}) {
  const r = rnd(semente); const n = Math.max(2, Math.round((x1 - x0) / 90));
  let d = `M${x0.toFixed(1)} ${(y + (r() - 0.5) * 4).toFixed(1)}`;
  for (let i = 1; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; const cx = x - (x1 - x0) / n / 2; d += ` Q${cx.toFixed(1)} ${(y + (r() - 0.5) * 9).toFixed(1)} ${x.toFixed(1)} ${(y + (r() - 0.5) * 5).toFixed(1)}`; }
  return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="${grossura}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function elipse(cx, cy, rx, ry, { cor = COR.laranja, grossura = 8, semente = 5 } = {}) {
  const r = rnd(semente); const pts = [];
  for (let i = 0; i <= 30; i++) { const a = (i / 26) * Math.PI * 2 + 0.25; const k = 1 + (r() - 0.5) * 0.05 + (i > 26 ? 0.07 : 0); pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
  return `<path d="M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}" fill="none" stroke="${cor}" stroke-width="${grossura}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// Seta curva de (x0,y0) até (x1,y1), com a ponta no fim.
function seta(x0, y0, x1, y1, { cor = COR.laranja, grossura = 8, semente = 3, curva = 0.5 } = {}) {
  const r = rnd(semente); const j = () => (r() - 0.5) * 6;
  const cx = x0 + (x1 - x0) * curva - (y1 - y0) * 0.25; const cy = y0 + (y1 - y0) * (1 - curva) + (x1 - x0) * 0.1;
  const ang = Math.atan2(y1 - cy, x1 - cx); const a = 26;
  const p1 = [x1 - a * Math.cos(ang - 0.5), y1 - a * Math.sin(ang - 0.5)]; const p2 = [x1 - a * Math.cos(ang + 0.5), y1 - a * Math.sin(ang + 0.5)];
  return `<g fill="none" stroke="${cor}" stroke-width="${grossura}" stroke-linecap="round" stroke-linejoin="round"><path d="M${x0 + j()} ${y0 + j()} Q${cx} ${cy} ${x1} ${y1}"/><path d="M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${x1} ${y1} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}"/></g>`;
}
function asterisco(cx, cy, tam, cor = COR.laranja) {
  let s = `<g stroke="${cor}" stroke-width="${tam * 0.2}" stroke-linecap="round">`;
  for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3 + Math.PI / 2; s += `<path d="M${(cx - Math.cos(a) * tam / 2).toFixed(1)} ${(cy - Math.sin(a) * tam / 2).toFixed(1)} L${(cx + Math.cos(a) * tam / 2).toFixed(1)} ${(cy + Math.sin(a) * tam / 2).toFixed(1)}"/>`; }
  return `${s}</g>`;
}
function pincelada(x, y, w, h, { cor = COR.laranja, semente = 2, inclina = -12 } = {}) {
  const r = rnd(semente); const n = 26; const topo = []; const base = [];
  for (let i = 0; i <= n; i++) { const u = i / n; topo.push([x + w * u, y + (r() - 0.5) * h * 0.22 - Math.sin(u * Math.PI) * h * 0.05]); base.push([x + w * u + (r() - 0.5) * 14, y + h + (r() - 0.5) * h * 0.22]); }
  const pts = [...topo, ...base.reverse()].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return `<g transform="rotate(${inclina} ${x + w / 2} ${y + h / 2})"><polygon points="${pts}" fill="${cor}"/></g>`;
}

// ── Desenho de blocos de texto ──────────────────────────────────────────────────────────────────────────────────────────────────
// opcoes: cor, corHi, marca ('sublinhado' | 'circulo' | 'nenhuma'), alinhar ('esq' | 'centro'), largura (para centralizar).
function desenhar(b, { x, y, cor = COR.preto, corHi = COR.azul, marca = 'nenhuma', semente = 1, opacidade = 1 }) {
  const f = FAM[b.k]; const lh = b.tam * b.entrelinha; let svg = ''; const marcas = [];
  b.linhas.forEach((ln, i) => {
    const base = y + i * lh + b.tam * 0.8;
    let ini = null;
    ln.forEach((w, j) => {
      svg += `<text x="${(x + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${f.familia}" font-weight="${f.peso}" font-size="${b.tam}" letter-spacing="${b.esp}" fill="${w.hi ? corHi : cor}"${opacidade < 1 ? ` opacity="${opacidade}"` : ''}>${esc(w.t)}</text>`;
      if (w.hi && ini === null) ini = j;
      if (ini !== null && (!w.hi || j === ln.length - 1)) { const fim = w.hi ? j : j - 1; marcas.push({ x0: x + ln[ini].x, x1: x + ln[fim].x + ln[fim].larg, base, i }); ini = null; }
    });
  });
  if (marca === 'sublinhado') marcas.forEach((m, k) => { svg += sublinhado(m.x0 - 4, m.x1 + 4, m.base + b.tam * 0.1, { semente: semente + k * 3, grossura: Math.max(6, b.tam * 0.085) }); });
  if (marca === 'circulo' && marcas.length) {
    const m = marcas[0]; const linha = m.i;
    // círculo só quando o destaque está em uma linha; o laço fica fora do texto vizinho
    svg += elipse((m.x0 + m.x1) / 2, y + linha * lh + b.tam * 0.5, (m.x1 - m.x0) / 2 + b.tam * 0.28, b.tam * 0.62, { semente, grossura: Math.max(6, b.tam * 0.07) });
  }
  return { svg, caixa: { x, y, w: b.largura, h: b.altura }, marcas };
}
const linha = (t, { x, y, k = 'iSemi', tam, cor = COR.preto, esp = 0, ancora = 'start', op = 1 }) => `<text x="${x}" y="${y}" font-family="${FAM[k].familia}" font-weight="${FAM[k].peso}" font-size="${tam}" letter-spacing="${esp}" fill="${cor}" text-anchor="${ancora}"${op < 1 ? ` opacity="${op}"` : ''}>${esc(t)}</text>`;

// ── Fotografia ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const POS = { centro: 'centre', topo: 'top', baixo: 'bottom', esquerda: 'left', direita: 'right' };
async function recorte(buf, w, h, enq) {
  return sharp(buf, { limitInputPixels: 60e6 }).rotate().resize(Math.round(w), Math.round(h), { fit: 'cover', position: POS[enq] || sharp.strategy.attention }).jpeg({ quality: 90 }).toBuffer();
}
let _clip = 0;
// forma: 'retangulo' | 'arco' | 'circulo' | 'inclinado'. Devolve { svg, caixa } (a caixa é o espaço que a foto ocupa).
async function foto(img, { x, y, w, h, forma = 'retangulo', enq = 'auto', credito = true, creditoX = null, sombra = false, raio = 0 }) {
  // Print de aplicativo ou documento: aparece INTEIRO (sem cortar), centralizado e com moldura, nunca esticado.
  if (img.papel === 'print' || img.papel === 'documento') {
    const meta = await sharp(img.buf).metadata(); const k = Math.min(w / meta.width, h / meta.height); const w2 = Math.round(meta.width * k); const h2 = Math.round(meta.height * k);
    x += Math.round((w - w2) / 2); y += Math.round((h - h2) / 2); w = w2; h = h2; forma = 'inclinado'; sombra = true; raio = 18; creditoX = x + 10;
  }
  const jpg = await recorte(img.buf, w, h, enq); const url = `data:image/jpeg;base64,${jpg.toString('base64')}`; const id = `cp${++_clip}`;
  let clip; let borda = '';
  if (forma === 'arco') clip = `<path d="M${x} ${y + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} V${y + h} H${x} Z"/>`;
  else if (forma === 'circulo') clip = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
  else clip = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}"/>`;
  let svg = `<defs><clipPath id="${id}">${clip}</clipPath></defs>`;
  if (forma === 'inclinado') {
    const r = -3; const cxm = x + w / 2; const cym = y + h / 2;
    svg += `<g transform="rotate(${r} ${cxm} ${cym})"><rect x="${x - 12}" y="${y - 12}" width="${w + 24}" height="${h + 24}" rx="${raio + 6}" fill="${COR.branco}"${sombra ? ' filter="url(#sombra)"' : ''}/><g clip-path="url(#${id})"><image x="${x}" y="${y}" width="${w}" height="${h}" href="${url}"/></g></g>`;
  } else {
    svg += `<g clip-path="url(#${id})"><image x="${x}" y="${y}" width="${w}" height="${h}" href="${url}"/></g>${borda}`;
  }
  // crédito: obrigatório sempre que a origem exige (foto de terceiros)
  let cr = null;
  if (credito && img.credito) {
    const t = String(img.credito).slice(0, 60); const lw = A.largura('iSemi', t, 20, 0) + 24;
    const cx = creditoX ?? (x + 20); const cy = y + h - 20 - 34;
    svg += `<rect x="${cx}" y="${cy}" width="${lw.toFixed(0)}" height="34" fill="${COR.preto}" opacity="0.78"/>${linha(t, { x: cx + 12, y: cy + 24, k: 'iSemi', tam: 20, cor: COR.marfim })}`;
    cr = { x: cx, y: cy, w: lw, h: 34 };
  }
  return { svg, caixa: { x, y, w, h }, credito: cr };
}

// ── Estrutura de toda tela: fundo, textura de papel muito sutil, rodapé e numeração ─────────────────────────────────────────────
const DEFS = `<defs><filter id="papel" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0.09 0 0 0 0 0.09 0 0 0 0 0.09 0 0 0 0.035 0"/></filter><filter id="sombra" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#171717" flood-opacity="0.22"/></filter></defs>`;
function fundo(cor = COR.marfim) { return `${DEFS}<rect width="${W}" height="${H}" fill="${cor}"/><rect width="${W}" height="${H}" filter="url(#papel)"/>`; }
function rodape({ n, total, esq = ACCOUNT.handle, claro = false, esqK = 'mRotulo' }) {
  const cor = claro ? COR.marfim : COR.preto;
  return linha(esq, { x: PAD, y: Y_RODAPE, k: esqK, tam: 26, cor }) + linha(`${n}/${total}`, { x: W - PAD, y: Y_RODAPE, k: 'iSemi', tam: 26, cor, ancora: 'end' });
}
function rotuloTopo(texto, { cor = COR.preto, corHi = COR.azul, y = 104, espaco = 6, tam = 24 } = {}) {
  // rótulo em caixa alta com espaçamento largo; **destaque** vira outra cor
  const partes = String(texto || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean); let x = PAD; let svg = ''; let larg = 0;
  partes.forEach((p) => {
    const hi = /^\*\*[^*]+\*\*$/.test(p); const t = up(hi ? p.slice(2, -2) : p);
    const w = A.largura('iNegrito', t, tam, espaco);
    svg += linha(t, { x, y, k: 'iNegrito', tam, cor: hi ? corHi : cor, esp: espaco }); x += w + espaco; larg += w + espaco;
  });
  return { svg, caixa: { x: PAD, y: y - tam, w: Math.min(larg, LARG), h: tam + 6 }, larguraTotal: larg, ok: PAD + larg - espaco <= W - PAD };
}

// ── Relatório de medidas (usado pela validação) ─────────────────────────────────────────────────────────────────────────────────
class Relato {
  constructor() { this.blocos = []; this.problemas = []; this.caixas = []; this.sem_imagem = false; this.elementos = []; }
  texto(nome, b, papel) { this.blocos.push({ nome, tam: b.tam, linhas: b.linhas.length, cabe: b.cabe, minimo: MIN[papel] }); if (!b.cabe) this.problemas.push(`${nome}: não cabe no tamanho mínimo legível (${MIN[papel]}px) — ${b.motivo}. Encurte o texto ou troque a composição`); if (b.tam < MIN[papel]) this.problemas.push(`${nome}: fonte abaixo de ${MIN[papel]}px`); }
  caixa(nome, c, { decorativo = false } = {}) { this.caixas.push({ nome, ...c, decorativo }); }
}
const dentroDaMargem = (c) => c.x >= MARGEM - 0.5 && c.x + c.w <= W - MARGEM + 0.5;
function conferirGeometria(r) {
  const txt = r.caixas.filter((c) => c.tipo === 'texto' && !c.decorativo);
  for (const c of txt) { if (!dentroDaMargem(c)) r.problemas.push(`${c.nome}: passa da margem segura de ${MARGEM}px`); if (c.y + c.h > H - MARGEM + 6) r.problemas.push(`${c.nome}: passa da margem inferior`); }
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < txt.length; i++) for (let j = i + 1; j < txt.length; j++) if (inter(txt[i], txt[j]) > 36) r.problemas.push(`${txt[i].nome} e ${txt[j].nome} se sobrepõem`);
  for (const f of r.caixas.filter((c) => c.tipo === 'foto')) for (const t of txt) { if (t.sobre_foto) continue; if (inter(f, t) > 36) r.problemas.push(`a foto cobre ${t.nome}`); }
}

// ── Composições ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const T = (t, c) => (t.textos?.[c] ?? '').trim();
const imgDe = (t, ctx) => (t.foto?.imagem_id && ctx.imagens?.[t.foto.imagem_id]) || null;
const tit = (r, nome, b, d, extra = {}) => { r.caixa(nome, { ...d.caixa, tipo: 'texto', ...extra }); };

async function lManchete(t, ctx, r) {
  const variante = t.variante || 'meia_lua'; const img = imgDe(t, ctx); let svg = fundo();
  const rot = rotuloTopo(T(t, 'rotulo') || C.SERIE_NOVA?.toUpperCase?.() || '', { cor: variante === 'canto' ? COR.laranja : COR.preto }); svg += rot.svg; r.caixa('rótulo', { ...rot.caixa, tipo: 'texto' });
  if (!rot.ok) r.problemas.push('rótulo: passa da largura da tela');
  if (variante === 'canto') {
    const b = ajustar({ texto: T(t, 'titulo'), k: 'tBlack', larg: LARG, alt: 600, max: 112, min: MIN.titulo + 12, entrelinha: 0.98 });
    r.texto('título', b, 'titulo'); const d = desenhar(b, { x: PAD, y: 150, marca: 'sublinhado', semente: 11 }); svg += d.svg; tit(r, 'título', b, d);
    let y = 150 + b.altura + 56;
    const ap = ajustar({ texto: T(t, 'apoio'), k: 'tExtra', larg: 540, alt: 330, max: 50, min: MIN.apoio + 6, entrelinha: 1.08 });
    if (T(t, 'apoio')) { r.texto('apoio', ap, 'apoio'); const da = desenhar(ap, { x: PAD, y, semente: 3 }); svg += da.svg; tit(r, 'apoio', ap, da); y += ap.altura + 26; }
    const nt = ajustar({ texto: T(t, 'nota'), k: 'iCorpo', larg: 540, alt: 150, max: 32, min: MIN.nota, entrelinha: 1.22 });
    if (T(t, 'nota')) { r.texto('nota', nt, 'nota'); const dn = desenhar(nt, { x: PAD, y, cor: COR.mudo }); svg += dn.svg; tit(r, 'nota', nt, dn); }
    const palavra = up(T(t, 'palavra'));
    if (palavra) {
      const pw = ajustar({ texto: palavra, k: 'tBlack', larg: 520, alt: 330, max: 300, min: MIN.palavra, entrelinha: 0.9, maxLinhas: 1 });
      const dp = desenhar(pw, { x: PAD, y: Y_FOTO_FIM - 6 - pw.altura * 0.74, cor: COR.azul }); svg += dp.svg; r.caixa('palavra de fundo', { ...dp.caixa, tipo: 'texto', decorativo: true });
    }
    if (img) {
      const fy = Math.max(150 + b.altura + 40, 640); const fx = 640; const h = Y_FOTO_FIM - fy;
      if (h < 320) { r.problemas.push('sem espaço para a foto: encurte o título'); r.sem_imagem = true; }
      else { svg = svg.replace('</defs>', '</defs>'); const f = await foto(img, { x: fx, y: fy, w: W - MARGEM - fx, h, forma: t.foto.forma || 'inclinado', enq: t.foto.enq, sombra: true, raio: 18, creditoX: fx + 14 }); svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' }); }
    } else r.sem_imagem = true;
    svg += rodape({ n: ctx.n, total: ctx.total }); return svg;
  }
  // meia_lua: manchete grande + produto dentro de um arco, sobre um sol laranja
  const b = ajustar({ texto: T(t, 'titulo'), k: 'tBlack', larg: LARG, alt: img ? Math.min(620, Y_FOTO_FIM - 140 - 44 - 360) : 620, max: 136, min: MIN.titulo + 20, entrelinha: 0.97 });
  r.texto('título', b, 'titulo'); const d = desenhar(b, { x: PAD, y: 140, marca: 'sublinhado', semente: 5 }); tit(r, 'título', b, d);
  const ap = ajustar({ texto: T(t, 'apoio'), k: 'tExtra', larg: 430, alt: 260, max: 60, min: MIN.apoio + 6, entrelinha: 1.04 });
  const yAp = 140 + b.altura + 34; const apFoto = T(t, 'apoio');
  const xFoto = Math.max(PAD + (apFoto ? ap.largura : 0) + 44, 500); const yFoto = 140 + b.altura + 44; const hFoto = Y_FOTO_FIM - yFoto; const wFoto = W - MARGEM - xFoto;
  // sol laranja atrás do produto (decorativo, pode sair da tela)
  svg += `<defs><clipPath id="solclip"><rect x="0" y="${yFoto - 24}" width="${W}" height="${H - yFoto + 24}"/></clipPath></defs><g clip-path="url(#solclip)"><circle cx="${xFoto + wFoto * 0.55}" cy="${Y_FOTO_FIM - hFoto * 0.35}" r="${Math.max(wFoto, hFoto) * 0.62}" fill="${COR.laranja}"/></g>`;
  svg += d.svg;
  if (apFoto) { r.texto('apoio', ap, 'apoio'); const da = desenhar(ap, { x: PAD, y: yAp, semente: 9 }); svg += da.svg; tit(r, 'apoio', ap, da); }
  if (img && hFoto >= 340 && wFoto >= 330) { const f = await foto(img, { x: xFoto, y: yFoto, w: wFoto, h: hFoto, forma: t.foto.forma || 'arco', enq: t.foto.enq, raio: 0, creditoX: xFoto + 16 }); svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' }); }
  else { r.sem_imagem = true; if (img) r.problemas.push('sem espaço para a foto: encurte o título ou o apoio'); }
  svg += rodape({ n: ctx.n, total: ctx.total }); return svg;
}

async function lDocumental(t, ctx, r) {
  const img = imgDe(t, ctx); let svg = fundo(); const e = t.estilo || {};
  const corTit = e.cor === 'azul' ? COR.azul : COR.preto; const corHi = e.destaque === 'azul' ? COR.azul : COR.laranja; const marca = e.marca || 'nenhuma';
  const rot = rotuloTopo(T(t, 'rotulo'), { cor: COR.preto, corHi: COR.azul, y: 112 }); svg += rot.svg; r.caixa('rótulo', { ...rot.caixa, tipo: 'texto' });
  if (!rot.ok) r.problemas.push('rótulo: passa da largura da tela');
  const x0 = e.barra === false ? PAD : PAD + 36; const lw = W - PAD - x0; const apT = T(t, 'apoio');
  const topo = 146; const reserva = img ? 420 : 0; const disp = Y_FOTO_FIM - reserva - 40 - topo;
  const par = ajustarPar({ texto: T(t, 'titulo'), k: 'tBlack', larg: lw, max: 108, min: MIN.titulo + 8, entrelinha: 1.0 }, { texto: apT, k: 'iSemi', larg: lw, max: 46, min: MIN.apoio, entrelinha: 1.16 }, { alt: disp, gap: 22 });
  const b = par.t; r.texto('título', b, 'titulo'); const d = desenhar(b, { x: x0, y: topo, cor: corTit, corHi, marca: marca === 'circulo' || marca === 'sublinhado' ? marca : 'nenhuma', semente: 21 }); svg += d.svg; tit(r, 'título', b, d);
  let fim = topo + b.altura;
  if (par.a) { const y = topo + b.altura + 22; r.texto('apoio', par.a, 'apoio'); const da = desenhar(par.a, { x: x0, y }); svg += da.svg; tit(r, 'apoio', par.a, da); fim = y + par.a.altura; }
  if (e.barra !== false) svg += `<rect x="${PAD - 4}" y="${82}" width="8" height="${fim - 82 + 6}" fill="${COR.laranja}"/>`;
  const fy = Math.max(fim + 40, 540); const hFoto = Y_FOTO_FIM - fy;
  if (img && hFoto >= 380) { const f = await foto(img, { x: 0, y: fy, w: W, h: hFoto, enq: t.foto.enq, creditoX: PAD }); svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' }); }
  else { r.sem_imagem = true; if (img) r.problemas.push('sem espaço para a foto: encurte o título ou o apoio'); svg += `<rect x="${PAD}" y="${Math.min(fy, 900)}" width="${LARG}" height="6" fill="${COR.laranja}"/>`; }
  svg += rodape({ n: ctx.n, total: ctx.total }); return svg;
}

async function lContraste(t, ctx, r) {
  const img = imgDe(t, ctx); let svg = fundo();
  const rot = rotuloTopo(T(t, 'rotulo'), { y: 112 }); svg += rot.svg; r.caixa('rótulo', { ...rot.caixa, tipo: 'texto' });
  const xT = PAD + 40; const lw = W - PAD - xT;
  // as duas linhas usam o MESMO tamanho: a que mais exige define a medida
  const t1 = ajustar({ texto: T(t, 'titulo'), k: 'tBlack', larg: lw, alt: 330, max: 124, min: MIN.titulo + 16, entrelinha: 0.97 });
  const t2 = ajustar({ texto: T(t, 'linha2'), k: 'tBlack', larg: lw, alt: 330, max: 124, min: MIN.titulo + 16, entrelinha: 0.97 });
  const tam = Math.min(t1.tam, t2.tam); const b1 = ajustar({ texto: T(t, 'titulo'), k: 'tBlack', larg: lw, alt: 400, max: tam, min: tam, entrelinha: 0.97 }); const b2 = ajustar({ texto: T(t, 'linha2'), k: 'tBlack', larg: lw, alt: 400, max: tam, min: tam, entrelinha: 0.97 });
  r.texto('linha 1', b1, 'titulo'); r.texto('linha 2', b2, 'titulo');
  const y1 = 152; const d1 = desenhar(b1, { x: xT, y: y1 }); const y2 = y1 + b1.altura + 8; const d2 = desenhar(b2, { x: xT, y: y2, cor: COR.laranja });
  svg += d1.svg + d2.svg; tit(r, 'linha 1', b1, d1); tit(r, 'linha 2', b2, d2);
  svg += seta(PAD + 6, y1 + tam * 0.38, PAD + 30, y2 + tam * 0.4, { semente: 4, curva: 0.2 });
  const palavra = up(T(t, 'palavra')); let yAp = y2 + b2.altura + 40;
  const ap = ajustar({ texto: T(t, 'apoio'), k: 'iSemi', larg: 410, alt: 300, max: 46, min: MIN.apoio, entrelinha: 1.14 });
  // palavra gigante azul, inteira dentro da tela (decorativa: repete uma palavra que já está no texto)
  let topoPalavra = Y_FOTO_FIM; let alturaPalavra = 0;
  if (palavra) {
    const pw = ajustar({ texto: palavra, k: 'tBlack', larg: LARG, alt: 400, max: 360, min: MIN.palavra, entrelinha: 0.9, maxLinhas: 1 });
    alturaPalavra = pw.tam * 0.74; topoPalavra = Y_FOTO_FIM - alturaPalavra; const dp = desenhar(pw, { x: PAD, y: topoPalavra - pw.tam * 0.06, cor: COR.azul }); svg += dp.svg;
    r.caixa('palavra de fundo', { ...dp.caixa, tipo: 'texto', decorativo: true, sobre_foto: true });
  }
  if (T(t, 'apoio')) { r.texto('apoio', ap, 'apoio'); const da = desenhar(ap, { x: PAD, y: yAp }); svg += da.svg; tit(r, 'apoio', ap, da); }
  if (img) {
    // a foto pode cobrir até 24% da altura da palavra gigante: ela continua legível por inteiro
    const fx = 500; const fy = y2 + b2.altura + 28; const fim = palavra ? topoPalavra + alturaPalavra * 0.24 : Y_FOTO_FIM; const hh = fim - fy;
    if (hh < 300) { r.sem_imagem = true; r.problemas.push('sem espaço para a foto: encurte as linhas'); }
    else { const f = await foto(img, { x: fx, y: fy, w: W - MARGEM - fx, h: hh, forma: t.foto.forma || 'inclinado', enq: t.foto.enq, sombra: true, raio: 14, creditoX: fx + 14 }); svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' }); }
  } else r.sem_imagem = true;
  svg += rodape({ n: ctx.n, total: ctx.total }); return svg;
}

// "150 milhões" → { grande: '150', unidade: 'milhões' }; "US$ 5 milhões" → { grande: 'US$ 5', unidade: 'milhões' }
function partirValor(v) {
  const m = /^(.*?\d[\d.,]*%?)\s+(mil|milh[ãa]o|milh[õo]es|bilh[ãa]o|bilh[õo]es|trilh[ãa]o|trilh[õo]es)\b(.*)$/i.exec(String(v || '').trim());
  if (m) return { grande: m[1].replace(/\s+/g, ' '), unidade: `${m[2]}${m[3] || ''}`.trim() };
  return { grande: String(v || '').trim(), unidade: '' };
}
async function lEvidencia(t, ctx, r) {
  const img = imgDe(t, ctx); let svg = fundo(); const claim = ctx.claims?.[t.textos?.claim_id];
  const rot = rotuloTopo(T(t, 'rotulo'), { y: 112 }); svg += rot.svg; r.caixa('rótulo', { ...rot.caixa, tipo: 'texto' });
  if (!claim || claim.numero === null || !claim.valor_exibicao) { r.problemas.push('evidência: a tela não aponta para um dado verificado com número'); r.sem_imagem = !img; svg += rodape({ n: ctx.n, total: ctx.total }); return svg; }
  const { grande, unidade } = partirValor(claim.valor_exibicao);
  const g = ajustar({ texto: grande, k: 'tBlack', larg: LARG, alt: 400, max: unidade ? 340 : 380, min: MIN.valor, entrelinha: 0.86, maxLinhas: 1 });
  r.texto('valor', g, 'valor'); const dg = desenhar(g, { x: PAD - 6, y: 128, cor: COR.azul }); svg += dg.svg; tit(r, 'valor', g, dg);
  let y = 128 + g.altura + 2; const xCol = PAD; let yFotoTopo = y + 24;
  if (unidade) { const u = ajustar({ texto: unidade, k: 'tBlack', larg: LARG, alt: 300, max: Math.round(g.tam * 0.68), min: 110, entrelinha: 0.9, maxLinhas: 1 }); r.texto('unidade', u, 'legenda'); const du = desenhar(u, { x: PAD - 2, y, cor: COR.azul }); svg += du.svg; tit(r, 'unidade', u, du); y += u.altura + 2; yFotoTopo = y + 24; }
  const colW = img ? 470 : LARG;
  const lg = ajustar({ texto: T(t, 'legenda'), k: 'tBlack', larg: colW, alt: 250, max: 78, min: MIN.legenda + 8, entrelinha: 0.98 });
  r.texto('legenda', lg, 'legenda'); const dl = desenhar(lg, { x: xCol, y: y + 12 }); svg += dl.svg; tit(r, 'legenda', lg, dl); y += 12 + lg.altura + 22;
  const apT = T(t, 'apoio');
  if (apT) { const ap = ajustar({ texto: apT, k: 'iSemi', larg: colW, alt: 260, max: 42, min: MIN.apoio, entrelinha: 1.16 }); r.texto('apoio', ap, 'apoio'); const da = desenhar(ap, { x: xCol, y }); svg += da.svg; tit(r, 'apoio', ap, da); y += ap.altura + 20; }
  // fonte e atribuição do dado, sempre visíveis
  const dataFonte = claim.data_publicacao ? String(claim.data_publicacao).slice(0, 10).split('-').reverse().join('/') : (claim.consultado_em ? String(claim.consultado_em).slice(0, 10).split('-').reverse().join('/') : '');
  const fonteTxt = `${claim.atribuicao ? `${claim.atribuicao.charAt(0).toUpperCase()}${claim.atribuicao.slice(1)}. ` : ''}Fonte: ${claim.veiculo || 'fonte oficial'}${dataFonte ? ` · ${dataFonte}` : ''}`;
  if (claim.atribuicao) svg += asterisco(xCol + 24, y + 28, 40);
  const fo = ajustar({ texto: fonteTxt, k: 'iCorpo', larg: colW, alt: 100, max: 24, min: MIN.fonte, entrelinha: 1.25 });
  r.texto('fonte', fo, 'fonte'); const yf = Math.max(y + (claim.atribuicao ? 62 : 6), Y_FOTO_FIM - fo.altura - 4); const df = desenhar(fo, { x: xCol, y: yf, cor: COR.mudo }); svg += df.svg; tit(r, 'fonte', fo, df);
  if (img) {
    const fx = 560; const fy = Math.max(yFotoTopo, 480); const hh = Y_FOTO_FIM - fy;
    if (hh < 320) r.problemas.push('sem espaço para a foto: o valor ocupa a tela');
    const forma = t.foto.forma || 'retangulo';
    if (forma === 'print') { const f = await foto(img, { x: fx + 20, y: fy, w: W - MARGEM - fx - 20, h: hh, forma: 'inclinado', enq: t.foto.enq, sombra: true, raio: 20, creditoX: fx + 34 }); svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' }); }
    else { const f = await foto(img, { x: fx, y: fy, w: W - fx, h: hh, enq: t.foto.enq, creditoX: fx + 16 }); svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' }); }
  } else r.sem_imagem = true;
  svg += rodape({ n: ctx.n, total: ctx.total }); return svg;
}

async function lQuebraAzul(t, ctx, r) {
  const img = imgDe(t, ctx); let svg = fundo(COR.azul);
  const rot = rotuloTopo(T(t, 'rotulo'), { cor: COR.laranja, corHi: COR.marfim, y: 112 }); svg += rot.svg; r.caixa('rótulo', { ...rot.caixa, tipo: 'texto' });
  const reserva = img ? 440 : 0; const disp = H - reserva - 60 - 146;
  const par = ajustarPar({ texto: T(t, 'titulo'), k: 'tBlack', larg: LARG, max: 116, min: MIN.titulo + 10, entrelinha: 0.98 }, { texto: T(t, 'apoio'), k: 'iSemi', larg: 700, max: 50, min: MIN.apoio + 2, entrelinha: 1.14 }, { alt: disp, gap: 26 });
  const b = par.t; r.texto('título', b, 'titulo'); const d = desenhar(b, { x: PAD, y: 146, cor: COR.marfim, corHi: COR.laranja }); svg += d.svg; tit(r, 'título', b, d);
  let fim = 146 + b.altura;
  if (par.a) { const y = 146 + b.altura + 26; r.texto('apoio', par.a, 'apoio'); const da = desenhar(par.a, { x: PAD, y, cor: COR.marfim }); svg += da.svg; tit(r, 'apoio', par.a, da); fim = y + par.a.altura; }
  const fy = Math.max(fim + 60, 620); const hh = H - fy;
  if (img && hh >= 380) {
    const f = await foto(img, { x: 0, y: fy, w: W, h: hh, enq: t.foto.enq, credito: true, creditoX: PAD });
    svg += f.svg; r.caixa('foto', { ...f.caixa, tipo: 'foto' });
    // véu escuro só na faixa do rodapé, para a numeração e o @ ficarem legíveis sobre a foto
    svg += `<defs><linearGradient id="veu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171717" stop-opacity="0"/><stop offset="1" stop-color="#171717" stop-opacity="0.62"/></linearGradient></defs><rect x="0" y="${H - 190}" width="${W}" height="190" fill="url(#veu)"/>`;
    svg += seta(W - 150, fim + 18, W - 120, fy + 80, { semente: 8, curva: 0.7 });
  } else { r.sem_imagem = true; if (img) r.problemas.push('sem espaço para a foto: encurte o título ou o apoio'); svg += `<circle cx="${W - 170}" cy="${H - 250}" r="210" fill="${COR.laranja}"/>`; }
  svg += rodape({ n: ctx.n, total: ctx.total, claro: true }); return svg;
}

let _pedro;
async function pedroCirculo(d) {
  _pedro ||= await sharp(path.join(__dirname, '..', '..', 'assets', 'pedro-perfil.png')).png().toBuffer();
  const png = await sharp(_pedro).resize(d, d, { fit: 'cover' }).png().toBuffer();       // só redimensiona: o rosto não é retocado
  return `data:image/png;base64,${png.toString('base64')}`;
}
async function lPedro(t, ctx, r) {
  let svg = fundo();
  svg += linha('PEDRO DESTRAVA', { x: PAD, y: 104, k: 'iNegrito', tam: 24, esp: 6 }); svg += `<rect x="${PAD + A.largura('iNegrito', 'PEDRO DESTRAVA', 24, 6) + 40}" y="95" width="${W - PAD - (PAD + A.largura('iNegrito', 'PEDRO DESTRAVA', 24, 6) + 40)}" height="2" fill="${COR.preto}"/>`;
  r.caixa('rótulo', { x: PAD, y: 80, w: A.largura('iNegrito', 'PEDRO DESTRAVA', 24, 6), h: 30, tipo: 'texto' });
  const b = ajustar({ texto: T(t, 'titulo'), k: 'tBlack', larg: LARG, alt: 560, max: 122, min: MIN.titulo + 14, entrelinha: 0.98 });
  r.texto('título', b, 'titulo'); const d = desenhar(b, { x: PAD, y: 160, cor: COR.preto, corHi: COR.azul }); svg += d.svg; tit(r, 'título', b, d);
  const yb = Math.max(160 + b.altura + 50, 760); const dia = 420;
  svg += pincelada(-40, yb + 40, 210, 330, { semente: 3, inclina: -18 }) + pincelada(10, yb + 150, 150, 300, { semente: 7, inclina: -14 });
  svg += `<image x="${PAD + 24}" y="${yb}" width="${dia}" height="${dia}" href="${await pedroCirculo(dia)}"/>`;
  r.caixa('foto do Pedro', { x: PAD + 24, y: yb, w: dia, h: dia, tipo: 'foto' }); r.elementos.push('foto_do_pedro');
  const xc = PAD + 24 + dia + 44; const wc = W - PAD - xc;
  const seg = ajustar({ texto: 'Segue', k: 'tBlack', larg: wc, alt: 180, max: 120, min: 84, entrelinha: 0.95, maxLinhas: 1 });
  const dsg = desenhar(seg, { x: xc, y: yb + 6, cor: COR.laranja }); svg += dsg.svg; tit(r, 'segue', seg, dsg);
  const hd = ajustar({ texto: ACCOUNT.handle, k: 'tBlack', larg: wc, alt: 100, max: 60, min: 44, entrelinha: 1, maxLinhas: 1 });
  r.texto('@', hd, 'apoio'); const dh = desenhar(hd, { x: xc, y: yb + 6 + seg.altura, cor: COR.azul }); svg += dh.svg; tit(r, '@', hd, dh);
  const cv = ajustar({ texto: T(t, 'apoio'), k: 'tExtra', larg: wc, alt: Y_FOTO_FIM - (yb + 6 + seg.altura + hd.altura + 10), max: 52, min: MIN.apoio + 4, entrelinha: 1.04 });
  r.texto('convite', cv, 'apoio'); const dc = desenhar(cv, { x: xc, y: yb + 6 + seg.altura + hd.altura + 10 }); svg += dc.svg; tit(r, 'convite', cv, dc);
  svg += rodape({ n: ctx.n, total: ctx.total, esq: ACCOUNT.nome, esqK: 'iSemi' }); return svg;
}

const LAYOUTS = { manchete_produto: lManchete, foto_documental: lDocumental, contraste: lContraste, evidencia: lEvidencia, quebra_azul: lQuebraAzul, encerramento_pedro: lPedro };

// tela: { layout, variante, textos, foto, estilo }. ctx: { n, total, imagens: { id: { buf, credito, tipo } }, claims: { id: claim } }
async function renderizarTela(tela, ctx = {}) {
  const fn = LAYOUTS[tela.layout]; if (!fn) throw Object.assign(new Error(`Composição desconhecida: ${tela.layout}`), { code: 'LAYOUT', status: 400 });
  const r = new Relato(); const svg = await fn(tela, ctx, r);
  conferirGeometria(r);
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`)).png().toBuffer();
  return { png, metrics: { layout: tela.layout, variante: tela.variante || null, cabe: r.problemas.length === 0, problemas: [...new Set(r.problemas)], blocos: r.blocos, fonte_px: r.blocos.length ? Math.min(...r.blocos.map((b) => b.tam)) : null, caixas: r.caixas, sem_imagem: r.sem_imagem, elementos: r.elementos, largura: W, altura: H } };
}

module.exports = { renderizarTela, ajustar, ajustarPar, desenhar, foto, partirValor, quebrarLinhas, linha, COR, MIN, MARGEM, PAD, LAYOUTS: Object.keys(LAYOUTS), W, H };
