// Arte do Pedro Destrava: família de layouts determinísticos em 1080 × 1350.
// Texto desenhado em SVG (sharp), com a quebra de linha MEDIDA pela fonte real
// (opentype.js lê os mesmos arquivos TTF que a renderização usa). Se o texto não
// cabe no tamanho mínimo legível do seu papel, a arte sai marcada com cabe:false
// e a revisão bloqueia: nada é espremido até ficar ilegível.
//
// Não existe aqui: selo de verificação, foto genérica de banco de imagens,
// ícones decorativos, texto gerado por IA dentro de imagem.
require('../fontSetup');
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');
const { ACCOUNT } = require('./account');

const W = 1080;
const H = 1350;
const MARGEM = 96;
const COR = { marfim: '#FAF7F0', marinho: '#0A1B33', mostarda: '#E8AA15', mudo: '#5B6475', linha: '#D9D3C4', branco: '#FFFFFF' };

const ASSETS = path.join(__dirname, '..', 'assets');
const ARQ = {
  display: { arquivo: 'Poppins-ExtraBold.ttf', familia: "'Poppins ExtraBold', 'Poppins', sans-serif", peso: 800 },
  rotulo: { arquivo: 'Poppins-Bold.ttf', familia: "'Poppins', sans-serif", peso: 700 },
  semi: { arquivo: 'Poppins-SemiBold.ttf', familia: "'Poppins SemiBold', 'Poppins', sans-serif", peso: 600 },
  corpo: { arquivo: 'PT_Serif-Web-Regular.ttf', familia: "'PT Serif', serif", peso: 400 },
  corpoNegrito: { arquivo: 'PT_Serif-Web-Bold.ttf', familia: "'PT Serif', serif", peso: 700 },
};
const _fontes = {};
const fonte = (k) => (_fontes[k] ||= opentype.loadSync(path.join(ASSETS, ARQ[k].arquivo)));

// Tamanhos mínimos legíveis por papel (px em 1080 de largura).
const MINIMO = { titulo_capa: 58, titulo: 44, corpo: 38, corpo_prova: 36, texto_comparacao: 34, valor: 56, fonte_linha: 20, cta: 48 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// ── Medição ────────────────────────────────────────────────────────────────
function largura(k, texto, tam, espaco = 0) {
  return fonte(k).getAdvanceWidth(texto, tam, { kerning: true }) + espaco * Math.max(0, [...texto].length - 1);
}

// "Texto com **destaque**" → palavras [{t, hi}] (pontuação colada ao destaque não ganha espaço).
function palavras(texto) {
  const out = [];
  let prevEsp = true;
  String(texto || '').split(/(\*\*[^*]+\*\*)/g).forEach((parte) => {
    if (!parte) return;
    const hi = /^\*\*[^*]+\*\*$/.test(parte);
    const limpo = hi ? parte.slice(2, -2) : parte;
    const colada = out.length > 0 && !prevEsp && !/^\s/.test(limpo);
    prevEsp = /\s$/.test(limpo);
    limpo.split(/\s+/).filter(Boolean).forEach((t, i) => out.push({ t, hi, colada: i === 0 && colada }));
  });
  // "R$" nunca fica sozinho no fim de linha.
  for (let i = out.length - 2; i >= 0; i--) {
    if (/^(R|US|U)?\$$/.test(out[i].t)) out.splice(i, 2, { t: `${out[i].t} ${out[i + 1].t}`, hi: out[i].hi || out[i + 1].hi, colada: out[i].colada });
  }
  // "140 mil", "2 milhões" não se separam do número.
  for (let i = out.length - 1; i >= 1; i--) {
    if (/^(mil|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o|trilh[õo]es|trilh[ãa]o)[.,;:!?]?$/i.test(out[i].t) && /\d$/.test(out[i - 1].t) && !out[i].colada) {
      out.splice(i - 1, 2, { t: `${out[i - 1].t} ${out[i].t}`, hi: out[i - 1].hi || out[i].hi, colada: out[i - 1].colada });
    }
  }
  return out;
}

function quebrar(texto, k, tam, larguraMax) {
  const ws = palavras(texto);
  const esp = largura(k, ' ', tam);
  const linhas = [];
  let atual = [];
  let x = 0;
  let largaDemais = false;
  for (const w of ws) {
    // Palavra em destaque no corpo é desenhada em negrito: mede em negrito.
    const wl = largura(w.hi && k === 'corpo' ? 'corpoNegrito' : k, w.t, tam);
    if (wl > larguraMax) largaDemais = true;
    const sp = atual.length && !w.colada ? esp : 0;
    if (atual.length && x + sp + wl > larguraMax) { linhas.push(atual); atual = []; x = 0; }
    const sp2 = atual.length && !w.colada ? esp : 0;
    atual.push({ ...w, x: x + sp2, larg: wl });
    x += sp2 + wl;
  }
  if (atual.length) linhas.push(atual);
  return { linhas, largaDemais, nPalavras: ws.length };
}

// Maior tamanho (de max a min, passo 2) em que o texto cabe na caixa.
function ajustar({ texto, k, larg, alt, max, min, entrelinha = 1.22, papel }) {
  const minimo = Math.max(min, MINIMO[papel] || 0);
  for (let tam = max; tam >= minimo; tam -= 2) {
    const q = quebrar(texto, k, tam, larg);
    const h = q.linhas.length * tam * entrelinha;
    if (!q.largaDemais && h <= alt) return { tam, linhas: q.linhas, entrelinha, altura: h, cabe: true, minimo, papel };
  }
  const q = quebrar(texto, k, minimo, larg);
  const h = q.linhas.length * minimo * entrelinha;
  return { tam: minimo, linhas: q.linhas, entrelinha, altura: h, cabe: false, sobra: Math.max(0, Math.round(h - alt)), minimo, papel, palavrasAtuais: q.nPalavras };
}

// ── Desenho ────────────────────────────────────────────────────────────────
function textoSvg(bloco, { x, y, k, cor, corDestaque, marcador = false, alinhar = 'esquerda', larguraBox }) {
  const f = ARQ[k];
  const kn = k === 'corpo' ? 'corpoNegrito' : k;
  let out = '';
  const linhaH = bloco.tam * bloco.entrelinha;
  bloco.linhas.forEach((ln, i) => {
    const base = y + i * linhaH + bloco.tam * 0.92;
    const larguraLinha = ln.reduce((m, w) => Math.max(m, w.x + w.larg), 0);
    const desloc = alinhar === 'centro' ? (larguraBox - larguraLinha) / 2 : 0;
    // Retângulo de marca-texto atrás de palavras seguidas em destaque.
    if (marcador) {
      let ini = null;
      ln.forEach((w, j) => {
        if (w.hi && ini === null) ini = j;
        if ((!w.hi || j === ln.length - 1) && ini !== null) {
          const fim = w.hi ? j : j - 1;
          const x0 = x + desloc + ln[ini].x - 8; const x1 = x + desloc + ln[fim].x + ln[fim].larg + 8;
          out += `<rect x="${x0.toFixed(1)}" y="${(base - bloco.tam * 0.82).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(bloco.tam * 1.0).toFixed(1)}" rx="6" fill="${COR.mostarda}"/>`;
          ini = null;
        }
      });
    }
    ln.forEach((w) => {
      const dest = w.hi;
      const fam = dest && kn !== k ? ARQ[kn] : f;
      const cr = dest && !marcador ? (corDestaque || cor) : cor;
      out += `<text x="${(x + desloc + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${fam.familia}" font-weight="${fam.peso}" font-size="${bloco.tam}" fill="${cr}">${esc(w.t)}</text>`;
    });
  });
  return out;
}

function rotuloSvg(texto, { x, y, tam = 26, cor = COR.marinho, espaco = 3, alinhar = 'start' }) {
  return `<text x="${x}" y="${y}" font-family="${ARQ.rotulo.familia}" font-weight="700" font-size="${tam}" letter-spacing="${espaco}" fill="${cor}" text-anchor="${alinhar}">${esc(String(texto).toUpperCase())}</text>`;
}

function chrome({ indice, total, cor = COR.marinho, corMarca = COR.mostarda }) {
  const handle = ACCOUNT.handle;
  let s = `<rect x="${MARGEM}" y="84" width="16" height="16" fill="${corMarca}"/>`;
  s += `<text x="${MARGEM + 30}" y="100" font-family="${ARQ.rotulo.familia}" font-weight="700" font-size="26" letter-spacing="0.5" fill="${cor}">${esc(handle)}</text>`;
  if (total > 1) s += `<text x="${W - MARGEM}" y="100" text-anchor="end" font-family="${ARQ.rotulo.familia}" font-weight="700" font-size="26" letter-spacing="1" fill="${cor}" opacity="0.65">${String(indice).padStart(2, '0')}/${String(total).padStart(2, '0')}</text>`;
  return s;
}

const svg = (fundo, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${fundo}"/>${inner}</svg>`;
const LARG = W - 2 * MARGEM;

const FUNCAO_ROTULO = { capa: 'ASSUNTO', contexto: 'CONTEXTO', prova: 'PROVA', explicacao: 'EXPLICAÇÃO', comparacao: 'COMPARAÇÃO', consequencia: 'NA PRÁTICA', opiniao: 'MINHA LEITURA', encerramento: '' };

// ── Layouts ────────────────────────────────────────────────────────────────
function layoutCapaTipografica(s, ctx) {
  const t = ajustar({ texto: s.texto, k: 'display', larg: LARG, alt: 700, max: 100, min: 58, entrelinha: 1.12, papel: 'titulo_capa' });
  const y0 = Math.round(260 + (880 - t.altura) * 0.36);
  const fim = y0 + t.altura;
  let inner = chrome(ctx);
  if (s.rotulo) inner += rotuloSvg(s.rotulo, { x: MARGEM, y: y0 - 56, cor: COR.mostarda });
  inner += textoSvg(t, { x: MARGEM, y: y0, k: 'display', cor: COR.marinho, marcador: true });
  inner += `<rect x="${MARGEM}" y="${Math.min(fim + 56, 1090)}" width="140" height="10" fill="${COR.marinho}"/>`;
  if (ctx.total > 1) inner += rotuloSvg('Arraste →', { x: MARGEM, y: H - 96, tam: 26, espaco: 2 });
  return { svg: svg(COR.marfim, inner), blocos: [{ nome: 'titulo', ...resumo(t) }] };
}

function layoutExplicacao(s, ctx) {
  const rot = FUNCAO_ROTULO[s.funcao] ?? '';
  let y = 250;
  const blocos = [];
  let inner = chrome(ctx);
  if (rot) { inner += rotuloSvg(rot, { x: MARGEM, y: 214, cor: COR.mostarda }); }
  if (s.titulo) {
    const ti = ajustar({ texto: s.titulo, k: 'display', larg: LARG, alt: 300, max: 64, min: 44, entrelinha: 1.15, papel: 'titulo' });
    inner += textoSvg(ti, { x: MARGEM, y, k: 'display', cor: COR.marinho });
    y += ti.altura + 36;
    blocos.push({ nome: 'titulo', ...resumo(ti) });
  }
  const alt = H - 130 - y - 40;
  const c = ajustar({ texto: s.texto, k: 'corpo', larg: LARG, alt, max: 56, min: 38, entrelinha: 1.38, papel: 'corpo' });
  inner += textoSvg(c, { x: MARGEM, y, k: 'corpo', cor: COR.marinho, marcador: true });
  blocos.push({ nome: 'corpo', ...resumo(c, alt) });
  return { svg: svg(COR.marfim, inner), blocos };
}

function layoutProva(s, ctx) {
  const blocos = [];
  let inner = chrome(ctx);
  inner += rotuloSvg(FUNCAO_ROTULO.prova, { x: MARGEM, y: 214, cor: COR.mostarda });
  const fonteTxt = s.fonte_linha || '';
  const fl = fonteTxt ? ajustar({ texto: fonteTxt, k: 'semi', larg: LARG, alt: 120, max: 26, min: 20, entrelinha: 1.3, papel: 'fonte_linha' }) : null;
  const yCard = 262;
  const hCardMax = (fl ? H - 120 - fl.altura - 40 : H - 160) - yCard;
  const c = ajustar({ texto: s.texto, k: 'corpo', larg: LARG - 84, alt: hCardMax - 96, max: 50, min: 36, entrelinha: 1.38, papel: 'corpo_prova' });
  const hCard = Math.min(hCardMax, c.altura + 96);
  inner += `<rect x="${MARGEM}" y="${yCard}" width="${LARG}" height="${hCard.toFixed(1)}" rx="10" fill="${COR.branco}" stroke="${COR.linha}" stroke-width="2"/>`;
  inner += `<rect x="${MARGEM}" y="${yCard}" width="14" height="${hCard.toFixed(1)}" fill="${COR.mostarda}"/>`;
  inner += textoSvg(c, { x: MARGEM + 54, y: yCard + 48, k: 'corpo', cor: COR.marinho, marcador: true });
  blocos.push({ nome: 'prova', ...resumo(c, hCardMax - 96) });
  if (fl) {
    inner += textoSvg(fl, { x: MARGEM, y: yCard + hCard + 36, k: 'semi', cor: COR.mudo });
    blocos.push({ nome: 'fonte', ...resumo(fl) });
  } else {
    blocos.push({ nome: 'fonte', tam: 0, cabe: false, motivo: 'Slide de prova sem linha de fonte' });
  }
  return { svg: svg(COR.marfim, inner), blocos, semFonte: !fl };
}

function layoutComparacao(s, ctx) {
  const d = s.dados || {};
  const e = d.esquerda || {}; const dr = d.direita || {};
  const blocos = [];
  let inner = chrome(ctx);
  inner += rotuloSvg(FUNCAO_ROTULO.comparacao, { x: MARGEM, y: 214, cor: COR.mostarda });
  const wCard = (LARG - 36) / 2; const yCard = 262; const hCard = 380;
  const card = (dado, x, escuro) => {
    const fundo = escuro ? COR.marinho : COR.branco;
    const txt = escuro ? COR.marfim : COR.marinho;
    let g = `<rect x="${x}" y="${yCard}" width="${wCard}" height="${hCard}" rx="10" fill="${fundo}" ${escuro ? '' : `stroke="${COR.linha}" stroke-width="2"`}/>`;
    g += rotuloSvg(dado.rotulo || '', { x: x + 32, y: yCard + 56, tam: 24, cor: escuro ? COR.mostarda : COR.mudo });
    const v = ajustar({ texto: String(dado.valor || ''), k: 'display', larg: wCard - 64, alt: 140, max: 84, min: 56, entrelinha: 1.1, papel: 'valor' });
    g += textoSvg(v, { x: x + 32, y: yCard + 92, k: 'display', cor: escuro ? COR.mostarda : COR.marinho });
    blocos.push({ nome: `valor_${escuro ? 'direita' : 'esquerda'}`, ...resumo(v, 140) });
    const det = ajustar({ texto: String(dado.detalhe || ''), k: 'corpo', larg: wCard - 64, alt: hCard - 92 - v.altura - 64, max: 34, min: 28, entrelinha: 1.35, papel: 'texto_comparacao' });
    g += textoSvg(det, { x: x + 32, y: yCard + 92 + v.altura + 18, k: 'corpo', cor: txt });
    blocos.push({ nome: `detalhe_${escuro ? 'direita' : 'esquerda'}`, ...resumo(det) });
    return g;
  };
  inner += card(e, MARGEM, false) + card(dr, MARGEM + wCard + 36, true);
  const fonteTxt = s.fonte_linha || '';
  const fl = fonteTxt ? ajustar({ texto: fonteTxt, k: 'semi', larg: LARG, alt: 110, max: 24, min: 20, entrelinha: 1.3, papel: 'fonte_linha' }) : null;
  const yTexto = yCard + hCard + 48;
  const altTexto = (fl ? H - 120 - fl.altura - 40 : H - 150) - yTexto;
  const t = ajustar({ texto: s.texto, k: 'corpo', larg: LARG, alt: altTexto, max: 46, min: 34, entrelinha: 1.38, papel: 'texto_comparacao' });
  inner += textoSvg(t, { x: MARGEM, y: yTexto, k: 'corpo', cor: COR.marinho, marcador: true });
  blocos.push({ nome: 'texto', ...resumo(t, altTexto) });
  if (fl) { inner += textoSvg(fl, { x: MARGEM, y: H - 100 - fl.altura, k: 'semi', cor: COR.mudo }); blocos.push({ nome: 'fonte', ...resumo(fl) }); }
  else blocos.push({ nome: 'fonte', tam: 0, cabe: false, motivo: 'Comparação sem linha de fonte' });
  return { svg: svg(COR.marfim, inner), blocos, semFonte: !fl };
}

function layoutEncerramento(s, ctx) {
  const c = ajustar({ texto: s.texto, k: 'display', larg: LARG, alt: 560, max: 88, min: 48, entrelinha: 1.14, papel: 'cta' });
  let inner = chrome({ ...ctx, cor: COR.marfim });
  inner += `<rect x="${MARGEM}" y="300" width="120" height="10" fill="${COR.mostarda}"/>`;
  inner += textoSvg(c, { x: MARGEM, y: 350, k: 'display', cor: COR.marfim, marcador: false, corDestaque: COR.mostarda });
  inner += `<text x="${MARGEM}" y="${H - 110}" font-family="${ARQ.display.familia}" font-weight="800" font-size="46" fill="${COR.mostarda}">${esc(ACCOUNT.handle)}</text>`;
  return { svg: svg(COR.marinho, inner), blocos: [{ nome: 'cta', ...resumo(c) }] };
}

function resumo(b, alt) { return { tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `Não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), ...(alt ? { altura_disponivel: Math.round(alt) } : {}) }; }

// ── Capa fotográfica (só com imagem escolhida pelo Pedro) ──────────────────
async function renderCapaFoto(s, ctx, imagemBuf) {
  const t = ajustar({ texto: s.texto, k: 'display', larg: LARG, alt: 560, max: 92, min: 58, entrelinha: 1.12, papel: 'titulo_capa' });
  const y0 = H - 150 - t.altura;
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.28" stop-color="${COR.marinho}" stop-opacity="0"/><stop offset="0.78" stop-color="${COR.marinho}" stop-opacity="0.9"/><stop offset="1" stop-color="${COR.marinho}" stop-opacity="0.96"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  let inner = grad + chrome({ ...ctx, cor: COR.marfim });
  inner += textoSvg(t, { x: MARGEM, y: y0, k: 'display', cor: COR.marfim, marcador: false, corDestaque: COR.mostarda });
  if (ctx.total > 1) inner += rotuloSvg('Arraste →', { x: MARGEM, y: H - 96, tam: 26, cor: COR.marfim, espaco: 2 });
  const base = await sharp(imagemBuf).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
  const png = await sharp(base).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${inner}</svg>`), top: 0, left: 0 }]).png().toBuffer();
  return { png, blocos: [{ nome: 'titulo', ...resumo(t) }] };
}

// ── Entrada principal ──────────────────────────────────────────────────────
// slide: { layout, funcao, titulo?, texto, rotulo?, dados?, fonte_linha? }
// opcoes: { indice, total, imagem (Buffer), arquivoEncerramento (Buffer) }
async function renderizarSlide(slide, { indice = 1, total = 1, imagem = null, arquivoEncerramento = null } = {}) {
  const ctx = { indice, total };
  const elementos = [];
  let layout = slide.layout;

  if (layout === 'encerramento' && arquivoEncerramento) {
    const meta = await sharp(arquivoEncerramento).metadata();
    const igual = meta.width === W && meta.height === H;
    const png = await sharp(arquivoEncerramento).resize(W, H, { fit: igual ? 'fill' : 'cover' }).png().toBuffer();
    return { png, metrics: { cabe: true, fonte_px: null, blocos: [], layout, elementos: ['arquivo_aprovado', ...(igual ? [] : ['arquivo_aprovado_redimensionado'])], arquivo: { largura: meta.width, altura: meta.height } } };
  }

  let r;
  if (layout === 'capa_foto') {
    if (imagem) {
      const x = await renderCapaFoto(slide, ctx, imagem);
      return { png: x.png, metrics: resumirMetricas(x.blocos, layout, ['imagem_do_pedro']) };
    }
    layout = 'capa_tipografica';
    elementos.push('sem_imagem_usou_tipografica');
  }
  if (layout === 'capa_tipografica') r = layoutCapaTipografica(slide, ctx);
  else if (layout === 'prova') r = layoutProva(slide, ctx);
  else if (layout === 'comparacao') r = layoutComparacao(slide, ctx);
  else if (layout === 'encerramento') { r = layoutEncerramento(slide, ctx); elementos.push('encerramento_tipografico'); }
  else { r = layoutExplicacao(slide, ctx); layout = 'explicacao'; }
  const png = await sharp(Buffer.from(r.svg)).png().toBuffer();
  const m = resumirMetricas(r.blocos, layout, elementos);
  if (r.semFonte) m.cabe = false;
  return { png, metrics: m };
}

function resumirMetricas(blocos, layout, elementos) {
  const medidos = blocos.filter((b) => b.tam);
  return {
    layout,
    cabe: blocos.every((b) => b.cabe !== false),
    fonte_px: medidos.length ? Math.min(...medidos.map((b) => b.tam)) : null,
    blocos,
    elementos,
    problemas: blocos.filter((b) => b.cabe === false).map((b) => b.motivo || `${b.nome} não cabe`),
  };
}

module.exports = { renderizarSlide, ajustar, quebrar, largura, palavras, MINIMO, COR, W, H, MARGEM };
