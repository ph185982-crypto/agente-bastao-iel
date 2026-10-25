// Padrão "Pedro Destrava — Minimalista" (pedro_minimalista_estrategico_v1): 1080 × 1350 PNG, fundo #FFFFFF liso.
// Títulos #111111 (Inter 700), corpo #444444 (Inter 400). Sem textura, degradê, borda, caixa, cartão, sombra, ícone, seta,
// moldura de celular, selo, caixa-alta forçada nem numeração visível (numeração só se pedida em ctx.numeracao).
// Nome, @ e foto do Pedro só no encerramento.
//
// Medidas do padrão (conferidas por MEDIÇÃO a cada render, em `metrics.medidas`):
//   margem lateral 96 px (faixa aceita 88–100) · topo e base ≥ 96 px (mínimo 80)
//   título 82→64 px, entrelinha 1,10 · corpo 44→36 px, entrelinha 1,32
//   título→corpo 44 px (36–52) · texto→foto 52 px (40–64)
// O texto nunca encolhe abaixo do mínimo: se não cabe, a tela sai marcada (bloqueio), nunca espremida.
//
// Composições (componentes reutilizáveis):
//   min_foto (A)         texto em cima, foto retangular embaixo, sem cantos arredondados
//   min_texto (B)        só texto, alinhado à esquerda
//   min_produto (C)      produto recortado (PNG com fundo transparente) sobre o branco; sem recorte limpo vira retângulo
//   min_encerramento (D) conclusão + convite + @, e a foto aprovada do Pedro discreta (retangular); sem foto aprovada, encerramento tipográfico e aviso
require('../../fontSetup');
const sharp = require('sharp');
const A = require('../arte');
const E = require('./arte2');
const { ACCOUNT } = require('../account');

const { W, H } = E;
const M = 96;                         // margem lateral
const LARG = W - 2 * M;               // 888
const TOPO = 96; const BASE = 96;     // respiro superior e inferior
const FIM = H - BASE;                 // 1254
const TIT = Object.freeze({ max: 82, min: 64, entrelinha: 1.1 });
const CORPO = Object.freeze({ max: 44, min: 36, entrelinha: 1.32 });
const GAP_TC = 44; const GAP_FOTO = 52; const FOTO_MIN = 360;
const FAIXAS = Object.freeze({ margem: [88, 100], topo_base_min: 80, titulo: [64, 82], titulo_entrelinha: [1.05, 1.15], corpo: [36, 44], corpo_entrelinha: [1.25, 1.4], gap_titulo_corpo: [36, 52], gap_texto_foto: [40, 64] });
const AMPLIACAO_AVISO = 1.4; const AMPLIACAO_MAX = 2.0;   // acima disso a foto ficaria visivelmente borrada
const COR = Object.freeze({ fundo: '#FFFFFF', titulo: '#111111', corpo: '#444444' });
const MIN = { titulo: TIT.min, corpo: CORPO.min };
const K_T = 'iNegrito'; const K_C = 'iCorpo';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const TXT = (texto) => String(texto ?? '').replace(/\*\*/g, '').trim();
const r1 = (x) => Math.round(x * 10) / 10;

function bloco(b, { x, y, cor, k }) {
  const f = A.ARQ[k]; const lh = b.tam * b.entrelinha; let svg = '';
  b.linhas.forEach((ln, i) => {
    const base = y + i * lh + b.tam * 0.8;
    ln.forEach((w) => { svg += `<text x="${(x + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${f.familia}" font-weight="${f.peso}" font-size="${b.tam}" fill="${cor}">${esc(w.t)}</text>`; });
  });
  return svg;
}

// Mede título e corpo juntos dentro de uma altura. Tenta o maior título, depois o maior corpo; nunca abaixo do mínimo.
function medir({ titulo, corpo, alt }) {
  const aj = (texto, k, tam, lh) => E.ajustar({ texto, k, larg: LARG, alt: 9999, max: tam, min: tam, entrelinha: lh });
  for (let tt = TIT.max; tt >= TIT.min; tt -= 2) {
    const bt = aj(titulo, K_T, tt, TIT.entrelinha); if (!bt.cabe) continue;
    if (!corpo) { if (bt.altura <= alt) return { t: bt, c: null, gap: 0, altura: bt.altura }; continue; }
    for (let tc = CORPO.max; tc >= CORPO.min; tc -= 2) {
      const bc = aj(corpo, K_C, tc, CORPO.entrelinha); if (!bc.cabe) continue;
      const h = bt.altura + GAP_TC + bc.altura; if (h <= alt) return { t: bt, c: bc, gap: GAP_TC, altura: h };
    }
  }
  const bt = aj(titulo, K_T, TIT.min, TIT.entrelinha); const bc = corpo ? aj(corpo, K_C, CORPO.min, CORPO.entrelinha) : null;
  const h = bt.altura + (bc ? GAP_TC + bc.altura : 0);
  return { t: { ...bt, cabe: false }, c: bc ? { ...bc, cabe: false } : null, gap: bc ? GAP_TC : 0, altura: h, falhou: true, falta: Math.round(h - alt) };
}

function desenharTexto(m, y, r) {
  let svg = bloco(m.t, { x: M, y, cor: COR.titulo, k: K_T });
  r.caixas.push({ nome: 'titulo', x: M, y, w: Math.round(m.t.largura), h: Math.round(m.t.altura) });
  r.blocos.push({ nome: 'título', tam: m.t.tam, entrelinha: m.t.entrelinha, cabe: m.t.cabe });
  if (m.c) {
    const yc = y + m.t.altura + m.gap;
    svg += bloco(m.c, { x: M, y: yc, cor: COR.corpo, k: K_C });
    r.caixas.push({ nome: 'corpo', x: M, y: Math.round(yc), w: Math.round(m.c.largura), h: Math.round(m.c.altura) });
    r.blocos.push({ nome: 'corpo', tam: m.c.tam, entrelinha: m.c.entrelinha, cabe: m.c.cabe });
  }
  return svg;
}

// Ponto de foco (0–1). `enq` antigo é traduzido; 'auto' usa a detecção de atenção do sharp.
const FOCO_ENQ = { centro: [0.5, 0.5], topo: [0.5, 0.2], baixo: [0.5, 0.8], esquerda: [0.2, 0.5], direita: [0.8, 0.5] };
function focoDe(foto = {}) {
  const f = foto.foco; if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) return [Math.min(1, Math.max(0, f.x)), Math.min(1, Math.max(0, f.y))];
  return FOCO_ENQ[foto.enq] || null;
}
const cache = new Map();
async function meta(buf) {
  const k = `${buf.length}:${buf.subarray(0, 64).toString('hex')}:${buf.subarray(-64).toString('hex')}`;
  if (cache.has(k)) return cache.get(k);
  const img = sharp(buf, { limitInputPixels: 60e6 }).rotate(); const m = await img.metadata();
  const giro = [5, 6, 7, 8].includes(m.orientation); const sw = giro ? m.height : m.width; const sh = giro ? m.width : m.height;
  let recorte = false;
  if (m.hasAlpha) {
    const { data } = await sharp(buf).rotate().ensureAlpha().resize(16, 16, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const a = (x, y) => data[(y * 16 + x) * 4 + 3]; recorte = [a(0, 0), a(15, 0), a(0, 15), a(15, 15)].every((v) => v < 16);
  }
  const v = { sw, sh, recorte }; if (cache.size > 64) cache.clear(); cache.set(k, v); return v;
}

// Foto retangular dentro de uma área, sem deformar: corta no máximo 25% de cada eixo (em torno do foco) e,
// se a proporção da foto for muito diferente da área, deixa branco em vez de cortar o essencial. Print, documento
// e produto recortado aparecem inteiros. A saída não leva metadados (EXIF/GPS) da foto original.
async function colocarFoto(im, area, foto = {}, { inteira = false, recorte = false } = {}) {
  const { sw, sh } = await meta(im.buf); const ar = sw / sh; const aa = area.w / area.h;
  let box; let crop = { left: 0, top: 0, width: sw, height: sh };
  if (inteira || recorte) {
    const s = Math.min(area.w / sw, area.h / sh); box = { w: Math.round(sw * s), h: Math.round(sh * s) };
  } else {
    const t = Math.min(ar * 1.333, Math.max(ar * 0.75, aa));
    box = t >= aa ? { w: area.w, h: Math.round(area.w / t) } : { w: Math.round(area.h * t), h: area.h };
    if (ar > t) { const cw = Math.round(sh * t); crop = { left: 0, top: 0, width: cw, height: sh }; } else if (ar < t) { const ch = Math.round(sw / t); crop = { left: 0, top: 0, width: sw, height: ch }; }
    const f = focoDe(foto);
    if (f) { crop.left = Math.round(Math.min(sw - crop.width, Math.max(0, f[0] * sw - crop.width / 2))); crop.top = Math.round(Math.min(sh - crop.height, Math.max(0, f[1] * sh - crop.height / 2))); }
  }
  const x = area.x; const y = area.y;
  let pipe = sharp(im.buf, { limitInputPixels: 60e6 }).rotate();
  if (recorte) pipe = pipe.resize(box.w, box.h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();
  else if (inteira) pipe = pipe.resize(box.w, box.h, { fit: 'contain', background: '#FFFFFF' }).jpeg({ quality: 92 });
  else if (focoDe(foto) || (crop.width === sw && crop.height === sh)) pipe = pipe.extract(crop).resize(box.w, box.h, { fit: 'fill' }).jpeg({ quality: 92 });
  else pipe = pipe.resize(box.w, box.h, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 92 });
  const out = await pipe.toBuffer();
  const ampliacao = r1(Math.max(box.w / crop.width, box.h / crop.height));
  const corte = Math.round((1 - (crop.width * crop.height) / (sw * sh)) * 100);
  return { svg: `<image x="${x}" y="${y}" width="${box.w}" height="${box.h}" preserveAspectRatio="none" href="data:image/${recorte ? 'png' : 'jpeg'};base64,${out.toString('base64')}"/>`, caixa: { nome: 'foto', x, y, w: box.w, h: box.h }, ampliacao, corte_pct: corte, origem_px: [sw, sh], modo: recorte ? 'recorte' : inteira ? 'inteira' : 'retangulo' };
}

function avaliarFoto(f, r) {
  r.foto = { ampliacao: f.ampliacao, corte_pct: f.corte_pct, origem_px: f.origem_px, modo: f.modo };
  if (f.ampliacao > AMPLIACAO_MAX) r.problemas.push(`A imagem é pequena demais (${f.origem_px.join('×')} px): seria ampliada ${String(f.ampliacao).replace('.', ',')} vezes e ficaria borrada. Troque por uma maior`);
  else if (f.ampliacao > AMPLIACAO_AVISO) r.avisos.push(`Imagem ampliada ${String(f.ampliacao).replace('.', ',')} vezes: confira a nitidez`);
}

const fundo = () => `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>`;
const numero = (ctx) => (ctx.numeracao ? `<text x="${W - M}" y="${H - 40}" font-family="${A.ARQ[K_C].familia}" font-size="22" fill="${COR.corpo}" text-anchor="end">${ctx.n}/${ctx.total}</text>` : '');

// B — só texto, à esquerda, centrado na vertical (um pouco acima do centro óptico).
async function lTexto(t, ctx, r) {
  const m = medir({ titulo: TXT(t.textos?.titulo), corpo: TXT(t.textos?.corpo), alt: FIM - TOPO });
  if (m.falhou) r.problemas.push(`Título e texto passam ${m.falta} px do espaço. Encurte o texto`);
  const y = Math.max(TOPO, Math.round((H - m.altura) / 2 - 40));
  return fundo() + desenharTexto(m, y, r);
}

// A — texto em cima, foto retangular embaixo. Sem foto pertinente: vira só texto e avisa (nunca usa uma qualquer).
async function lFoto(t, ctx, r, { produto = false } = {}) {
  const im = ctx.imagens?.[t.foto?.imagem_id];
  if (!im) { r.sem_imagem = true; return lTexto(t, ctx, r); }
  const m = medir({ titulo: TXT(t.textos?.titulo), corpo: TXT(t.textos?.corpo), alt: FIM - TOPO - GAP_FOTO - FOTO_MIN });
  if (m.falhou) r.problemas.push(`Título e texto passam ${m.falta} px do espaço que sobra com a foto. Encurte o texto ou use a composição só de texto`);
  let svg = fundo() + desenharTexto(m, TOPO, r);
  const yFoto = Math.round(TOPO + m.altura + GAP_FOTO);
  const { recorte } = await meta(im.buf);
  const f = await colocarFoto(im, { x: M, y: yFoto, w: LARG, h: Math.max(FOTO_MIN, FIM - yFoto) }, t.foto, { inteira: ['print', 'documento'].includes(im.papel), recorte: produto && recorte });
  if (produto && !recorte) r.avisos.push('A imagem do produto não tem recorte limpo (fundo transparente): entrou como foto retangular');
  avaliarFoto(f, r); r.caixas.push(f.caixa); svg += f.svg;
  return svg;
}

// D — encerramento: conclusão, convite com o @ e a foto aprovada do Pedro, retangular e discreta, sem filtro nem moldura.
async function lEncerramento(t, ctx, r) {
  const titulo = TXT(t.textos?.titulo) || 'Segue para descobrir o próximo.';
  const apoio = TXT(t.textos?.apoio) || `Segue ${ACCOUNT.handle} para descobrir negócios que já funcionam no mundo.`;
  const pedro = ctx.fotoPedro || null;
  if (!pedro?.buf) {
    r.avisos.push('Sem foto aprovada do Pedro: encerramento tipográfico'); r.sem_foto_pedro = true;
    const m = medir({ titulo, corpo: apoio, alt: FIM - TOPO });
    if (m.falhou) r.problemas.push(`Título e convite passam ${m.falta} px do espaço. Encurte o convite`);
    return fundo() + desenharTexto(m, Math.max(TOPO, Math.round((H - m.altura) / 2 - 40)), r);
  }
  const m = medir({ titulo, corpo: apoio, alt: FIM - TOPO - GAP_FOTO - 320 });
  if (m.falhou) r.problemas.push(`Título e convite passam ${m.falta} px do espaço. Encurte o convite`);
  let svg = fundo() + desenharTexto(m, TOPO, r);
  const yFoto = Math.round(TOPO + m.altura + GAP_FOTO); const alt = Math.min(560, FIM - yFoto);
  const c = pedro.recorte || null; const sw = c ? c.width : (await meta(pedro.buf)).sw; const sh = c ? c.height : (await meta(pedro.buf)).sh;
  let h = alt; let w = Math.round(h * (sw / sh)); const lim = 1.35;            // a foto do Pedro não é ampliada além de 1,35×
  if (w / sw > lim) { w = Math.round(sw * lim); h = Math.round(w * (sh / sw)); }
  let pipe = sharp(pedro.buf).rotate(); if (c) pipe = pipe.extract(c);
  const buf = await pipe.resize(w, h, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
  svg += `<image x="${M}" y="${yFoto}" width="${w}" height="${h}" preserveAspectRatio="none" href="data:image/jpeg;base64,${buf.toString('base64')}"/>`;
  r.caixas.push({ nome: 'foto_pedro', x: M, y: yFoto, w, h }); r.elementos.push('foto_do_pedro');
  return svg;
}

const LAYOUTS = { min_foto: lFoto, min_texto: lTexto, min_produto: (t, ctx, r) => lFoto(t, ctx, r, { produto: true }), min_encerramento: lEncerramento };

// Conferência por medição: margens, topo/base, tamanhos, entrelinhas, distâncias e sobreposição das caixas desenhadas.
function medidas(r) {
  const cx = r.caixas; const tit = cx.find((c) => c.nome === 'titulo'); const cor = cx.find((c) => c.nome === 'corpo');
  const foto = cx.find((c) => c.nome === 'foto' || c.nome === 'foto_pedro'); const texto = cor || tit;
  const bt = r.blocos.find((b) => b.nome === 'título'); const bc = r.blocos.find((b) => b.nome === 'corpo');
  const out = {
    margem_esquerda: Math.min(...cx.map((c) => c.x)), margem_direita: Math.min(...cx.map((c) => W - (c.x + c.w))),
    topo: Math.min(...cx.map((c) => c.y)), base: Math.min(...cx.map((c) => H - (c.y + c.h))),
    titulo_px: bt?.tam ?? null, titulo_entrelinha: bt?.entrelinha ?? null, corpo_px: bc?.tam ?? null, corpo_entrelinha: bc?.entrelinha ?? null,
    gap_titulo_corpo: tit && cor ? Math.round(cor.y - (tit.y + tit.h)) : null, gap_texto_foto: foto && texto ? Math.round(foto.y - (texto.y + texto.h)) : null,
  };
  const p = []; const F = FAIXAS; const fora = (v, [a, b]) => v != null && (v < a - 0.5 || v > b + 0.5);
  if (out.margem_esquerda < F.margem[0] || out.margem_esquerda > F.margem[1]) p.push(`margem esquerda ${out.margem_esquerda} px (padrão 88–100)`);
  if (out.margem_direita < F.margem[0]) p.push(`margem direita ${out.margem_direita} px (mínimo 88)`);
  if (out.topo < F.topo_base_min) p.push(`respiro superior ${out.topo} px (mínimo 80)`);
  if (out.base < F.topo_base_min) p.push(`respiro inferior ${out.base} px (mínimo 80)`);
  if (fora(out.titulo_px, F.titulo)) p.push(`título com ${out.titulo_px} px (padrão 64–82)`);
  if (fora(out.titulo_entrelinha, F.titulo_entrelinha)) p.push('entrelinha do título fora do padrão');
  if (fora(out.corpo_px, F.corpo)) p.push(`corpo com ${out.corpo_px} px (padrão 36–44)`);
  if (fora(out.corpo_entrelinha, F.corpo_entrelinha)) p.push('entrelinha do corpo fora do padrão');
  if (fora(out.gap_titulo_corpo, F.gap_titulo_corpo)) p.push(`distância título→corpo ${out.gap_titulo_corpo} px (padrão 36–52)`);
  if (fora(out.gap_texto_foto, F.gap_texto_foto)) p.push(`distância texto→foto ${out.gap_texto_foto} px (padrão 40–64)`);
  for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) { const a = cx[i]; const b = cx[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) p.push(`${a.nome} e ${b.nome} se sobrepõem`); }
  return { ...out, fora_do_padrao: p };
}

// tela: { layout, textos: {titulo, corpo, apoio}, foto: {imagem_id, foco:{x,y}, enq} }
// ctx: { n, total, imagens: { id: { buf, papel } }, fotoPedro: { buf, recorte } | null, numeracao: false }
async function renderizarTela(tela, ctx = {}) {
  const fn = LAYOUTS[tela.layout]; if (!fn) throw Object.assign(new Error(`Composição desconhecida no padrão minimalista: ${tela.layout}`), { code: 'LAYOUT', status: 400 });
  const r = { blocos: [], caixas: [], problemas: [], avisos: [], elementos: [], sem_imagem: false, foto: null };
  const svg = (await fn(tela, ctx, r)) + numero(ctx);
  const med = medidas(r); r.problemas.push(...med.fora_do_padrao.map((x) => `Fora do padrão: ${x}`));
  const problemas = [...new Set(r.problemas)];
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`)).png().toBuffer();
  return { png, metrics: { layout: tela.layout, template: 'pedro_minimalista_estrategico_v1', cabe: problemas.length === 0, problemas, avisos: [...new Set(r.avisos)], blocos: r.blocos, caixas: r.caixas, medidas: med, fonte_px: r.blocos.length ? Math.min(...r.blocos.map((b) => b.tam)) : null, sem_imagem: r.sem_imagem, sem_foto_pedro: !!r.sem_foto_pedro, foto: r.foto, elementos: r.elementos, largura: W, altura: H } };
}

module.exports = { renderizarTela, colocarFoto, medir, medidas, meta, COR, M, MIN, TIT, CORPO, FAIXAS, TOPO, BASE, GAP_TC, GAP_FOTO, LAYOUTS: Object.keys(LAYOUTS) };
