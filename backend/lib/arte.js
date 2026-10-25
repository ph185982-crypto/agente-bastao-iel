// Arte do Pedro Destrava: família de layouts determinísticos em 1080 × 1350,
// na identidade visual definida pelo Pedro (azul #2448FF, laranja #FF7043, branco
// quente #F6F5F0, grafite #18191D; Manrope nos títulos e Inter no texto).
// Texto desenhado em SVG (sharp), com a quebra de linha MEDIDA pela fonte real
// (opentype.js lê os mesmos arquivos TTF que a renderização usa). Se o texto não
// cabe no tamanho mínimo legível do seu papel, a arte sai marcada com cabe:false
// e a revisão bloqueia: nada é espremido até ficar ilegível.
//
// Linguagem: tipografia grande, espaço livre, alinhamento à esquerda, UMA expressão
// em destaque por tela, enquadrada por colchetes [ ]; fundos alternando claro, azul
// e grafite; laranja só como ponto de atenção. Sem rótulos internos ("contexto",
// "explicação"...), sem gradientes, sem ícones decorativos.
//
// Não existe aqui: selo de verificação, foto genérica de banco de imagens,
// texto gerado por IA dentro de imagem, logotipo redigitado em fonte comum.
require('../fontSetup');
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');
const { ACCOUNT } = require('./account');

const W = 1080;
const H = 1350;
const MARGEM = 80; // a identidade pede pelo menos 72 px
const COR = { azul: '#2448FF', laranja: '#FF7043', claro: '#F6F5F0', grafite: '#18191D', mudo: '#686A73' };
// Paleta anterior, só para os desenhos legados que ainda a usam.
const LEGADO = { marfim: '#FAF7F0', marinho: '#0A1B33', mostarda: '#E8AA15', mudo: '#5B6475' };

// Combinações aprovadas: claro sobre azul, grafite sobre claro, azul sobre claro,
// grafite sobre laranja. Laranja em texto só como marcador gráfico (colchetes, filete).
const TEMA = {
  claro: { fundo: COR.claro, texto: COR.grafite, destaque: COR.azul, colchete: COR.azul, apoio: COR.mudo, apoioOp: 1, marca: COR.laranja },
  azul: { fundo: COR.azul, texto: COR.claro, destaque: COR.claro, colchete: COR.laranja, apoio: COR.claro, apoioOp: 0.8, marca: COR.laranja },
  grafite: { fundo: COR.grafite, texto: COR.claro, destaque: COR.claro, colchete: COR.laranja, apoio: COR.claro, apoioOp: 0.7, marca: COR.laranja },
};

const ASSETS = path.join(__dirname, '..', 'assets');
const ARQ = {
  // Chaves originais: usadas por módulos que desenham e medem com Poppins/PT Serif
  // (estúdio editorial, vídeo em movimento, cortes). Não mudam.
  display: { arquivo: 'Poppins-ExtraBold.ttf', familia: "'Poppins ExtraBold', 'Poppins', sans-serif", peso: 800 },
  rotulo: { arquivo: 'Poppins-Bold.ttf', familia: "'Poppins', sans-serif", peso: 700 },
  semi: { arquivo: 'Poppins-SemiBold.ttf', familia: "'Poppins SemiBold', 'Poppins', sans-serif", peso: 600 },
  corpo: { arquivo: 'PT_Serif-Web-Regular.ttf', familia: "'PT Serif', serif", peso: 400 },
  corpoNegrito: { arquivo: 'PT_Serif-Web-Bold.ttf', familia: "'PT Serif', serif", peso: 700 },
  // Identidade visual: Manrope nos títulos, Inter no texto.
  mDisplay: { arquivo: 'Manrope-ExtraBold.ttf', familia: "'Manrope ExtraBold', 'Manrope', sans-serif", peso: 800 },
  mRotulo: { arquivo: 'Manrope-Bold.ttf', familia: "'Manrope', sans-serif", peso: 700 },
  iSemi: { arquivo: 'Inter-SemiBold.ttf', familia: "'Inter SemiBold', 'Inter', sans-serif", peso: 600 },
  iCorpo: { arquivo: 'Inter-Regular.ttf', familia: "'Inter', sans-serif", peso: 400 },
  iNegrito: { arquivo: 'Inter-Bold.ttf', familia: "'Inter', sans-serif", peso: 700 },
};
// Versão em negrito de cada fonte de corpo (palavra em destaque).
const NEGRITO = { corpo: 'corpoNegrito', iCorpo: 'iNegrito' };
const _fontes = {};
const fonte = (k) => (_fontes[k] ||= opentype.loadSync(path.join(ASSETS, ARQ[k].arquivo)));

// Tamanhos mínimos legíveis por papel (px em 1080 de largura). Os papéis `id_*` seguem a
// identidade visual; antes de reduzir a letra, o texto deve ser encurtado: abaixo do mínimo a arte é bloqueada.
const MINIMO = { titulo_capa: 58, titulo: 44, corpo: 38, corpo_prova: 36, texto_comparacao: 34, valor: 56, fonte_linha: 20, cta: 48,
  // identidade: capa 88–116, títulos 64–84, apoio 36–44, créditos 24–28
  id_titulo_capa: 88, id_titulo: 64, id_corpo: 36, id_corpo_prova: 36, id_texto_comparacao: 32, id_valor: 56, id_fonte_linha: 24, id_cta: 56 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// ── Medição ────────────────────────────────────────────────────────────────
function largura(k, texto, tam, espaco = 0) {
  return fonte(k).getAdvanceWidth(texto, tam, { kerning: true }) + espaco * Math.max(0, [...texto].length - 1);
}

// "Texto com **destaque**" → palavras [{t, hi, colada, gIni, gFim}].
// Só a PRIMEIRA expressão em destaque vale (uma por tela); gIni/gFim marcam onde
// o colchete abre e fecha.
function palavras(texto, { unico = false } = {}) {
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
    if (/^(R|US|U)?\$$/.test(out[i].t)) out.splice(i, 2, { t: `${out[i].t}\u00A0${out[i + 1].t}`, hi: out[i].hi || out[i + 1].hi, colada: out[i].colada });
  }
  // "140 mil", "2 milhões" não se separam do número.
  for (let i = out.length - 1; i >= 1; i--) {
    if (/^(mil|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o|trilh[õo]es|trilh[ãa]o)[.,;:!?]?$/i.test(out[i].t) && /\d$/.test(out[i - 1].t) && !out[i].colada) {
      out.splice(i - 1, 2, { t: `${out[i - 1].t}\u00A0${out[i].t}`, hi: out[i - 1].hi || out[i].hi, colada: out[i - 1].colada });
    }
  }
  // Uma expressão principal por tela: destaques depois do primeiro grupo viram texto comum.
  if (unico) {
    let grupos = 0;
    out.forEach((w, i) => {
      if (w.hi && (i === 0 || !out[i - 1].hi)) grupos += 1;
      if (grupos > 1) w.hi = false;
    });
  }
  out.forEach((w, i) => {
    w.gIni = w.hi && (i === 0 || !out[i - 1].hi);
    w.gFim = w.hi && (i === out.length - 1 || !out[i + 1].hi);
  });
  return out;
}

const folga = (tam) => Math.round(tam * 0.4); // espaço reservado para cada colchete

function quebrar(texto, k, tam, larguraMax, { colchetes = false } = {}) {
  const ws = palavras(texto, { unico: colchetes });
  const esp = largura(k, ' ', tam);
  const linhas = [];
  let atual = [];
  let x = 0;
  let largaDemais = false;
  for (const w of ws) {
    // Palavra em destaque no corpo é desenhada em negrito: mede em negrito.
    const wl = largura(w.hi && NEGRITO[k] ? NEGRITO[k] : k, w.t, tam);
    const padL = colchetes && w.gIni ? folga(tam) : 0;
    const padR = colchetes && w.gFim ? folga(tam) : 0;
    const total = padL + wl + padR;
    if (total > larguraMax) largaDemais = true;
    const sp = atual.length && !w.colada ? esp : 0;
    if (atual.length && x + sp + total > larguraMax) { linhas.push(atual); atual = []; x = 0; }
    const sp2 = atual.length && !w.colada ? esp : 0;
    atual.push({ ...w, x: x + sp2 + padL, larg: wl, padL, padR });
    x += sp2 + total;
  }
  if (atual.length) linhas.push(atual);
  return { linhas, largaDemais, nPalavras: ws.length };
}

// Maior tamanho (de max a min, passo 2) em que o texto cabe na caixa.
function ajustar({ texto, k, larg, alt, max, min, entrelinha = 1.22, papel, colchetes = false }) {
  const minimo = Math.max(min, MINIMO[papel] || 0);
  for (let tam = max; tam >= minimo; tam -= 2) {
    const q = quebrar(texto, k, tam, larg, { colchetes });
    const h = q.linhas.length * tam * entrelinha;
    if (!q.largaDemais && h <= alt) return { tam, linhas: q.linhas, entrelinha, altura: h, cabe: true, minimo, papel, colchetes };
  }
  const q = quebrar(texto, k, minimo, larg, { colchetes });
  const h = q.linhas.length * minimo * entrelinha;
  return { tam: minimo, linhas: q.linhas, entrelinha, altura: h, cabe: false, sobra: Math.max(0, Math.round(h - alt)), minimo, papel, palavrasAtuais: q.nPalavras, colchetes };
}

// ── Desenho ────────────────────────────────────────────────────────────────
// Colchete de abertura/fechamento: traço reto e grosso, assinatura gráfica da marca.
function colchete(lado, xBorda, topo, base, tam, cor) {
  const sw = Math.max(5, tam * 0.08);
  const braco = tam * 0.2;
  if (lado === 'esq') {
    const x = xBorda + sw / 2;
    return `<path d="M${(x + braco).toFixed(1)} ${topo.toFixed(1)} H${x.toFixed(1)} V${base.toFixed(1)} H${(x + braco).toFixed(1)}" fill="none" stroke="${cor}" stroke-width="${sw.toFixed(1)}" stroke-linejoin="miter"/>`;
  }
  const x = xBorda - sw / 2;
  return `<path d="M${(x - braco).toFixed(1)} ${topo.toFixed(1)} H${x.toFixed(1)} V${base.toFixed(1)} H${(x - braco).toFixed(1)}" fill="none" stroke="${cor}" stroke-width="${sw.toFixed(1)}" stroke-linejoin="miter"/>`;
}

// Dois modos. Com `tema` (e blocos medidos com colchetes) desenha na identidade nova:
// destaque em cor própria, enquadrado por colchetes. Sem `tema` mantém o desenho original
// (cor/corDestaque/marcador), que outros módulos ainda usam.
function textoSvg(bloco, { x, y, k, tema, cor, corDestaque, marcador = false, alinhar = 'esquerda', larguraBox }) {
  const f = ARQ[k];
  const kn = NEGRITO[k] || k;
  let out = '';
  const linhaH = bloco.tam * bloco.entrelinha;
  const novo = !!tema;
  bloco.linhas.forEach((ln, i) => {
    const base = y + i * linhaH + bloco.tam * 0.92;
    const larguraLinha = ln.reduce((m, w) => Math.max(m, w.x + w.larg + (w.padR || 0)), 0);
    const desloc = alinhar === 'centro' ? (larguraBox - larguraLinha) / 2 : 0;
    if (novo) {
      const topoC = base - bloco.tam * 0.8;
      const baseC = base + bloco.tam * 0.22;
      ln.forEach((w) => {
        if (w.gIni && w.padL) out += colchete('esq', x + desloc + w.x - w.padL, topoC, baseC, bloco.tam, tema.colchete);
        if (w.gFim && w.padR) out += colchete('dir', x + desloc + w.x + w.larg + w.padR, topoC, baseC, bloco.tam, tema.colchete);
        const fam = w.hi && kn !== k ? ARQ[kn] : f;
        out += `<text x="${(x + desloc + w.x).toFixed(1)}" y="${base.toFixed(1)}" font-family="${fam.familia}" font-weight="${fam.peso}" font-size="${bloco.tam}" fill="${w.hi ? tema.destaque : tema.texto}">${esc(w.t)}</text>`;
      });
      return;
    }
    // Retângulo de marca-texto atrás de palavras seguidas em destaque.
    if (marcador) {
      let ini = null;
      ln.forEach((w, j) => {
        if (w.hi && ini === null) ini = j;
        if ((!w.hi || j === ln.length - 1) && ini !== null) {
          const fim = w.hi ? j : j - 1;
          const x0 = x + desloc + ln[ini].x - 8; const x1 = x + desloc + ln[fim].x + ln[fim].larg + 8;
          out += `<rect x="${x0.toFixed(1)}" y="${(base - bloco.tam * 0.82).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(bloco.tam * 1.0).toFixed(1)}" rx="6" fill="${LEGADO.mostarda}"/>`;
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

// Rótulo curto em caixa alta. `fam` escolhe a fonte (padrão: a original; a identidade usa 'mRotulo').
function rotuloSvg(texto, { x, y, tam = 26, cor = LEGADO.marinho, espaco = 3, alinhar = 'start', fam = 'rotulo', op = 1 }) {
  const f = ARQ[fam];
  return `<text x="${x}" y="${y}" font-family="${f.familia}" font-weight="${f.peso}" font-size="${tam}" letter-spacing="${espaco}" fill="${cor}" text-anchor="${alinhar}" opacity="${op}">${esc(String(texto).toUpperCase())}</text>`;
}

// Topo de cada tela: @ da conta e numeração. Com `tema` usa a identidade; sem ele, o desenho original.
function chrome({ indice, total, tema, cor = LEGADO.marinho, corMarca = LEGADO.mostarda }) {
  const handle = ACCOUNT.handle;
  if (tema) {
    let s = `<rect x="${MARGEM}" y="78" width="16" height="16" fill="${tema.marca}"/>`;
    s += `<text x="${MARGEM + 30}" y="94" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="26" fill="${tema.texto}">${esc(handle)}</text>`;
    if (total > 1) s += `<text x="${W - MARGEM}" y="94" text-anchor="end" font-family="${ARQ.iSemi.familia}" font-weight="600" font-size="24" letter-spacing="1" fill="${tema.texto}" opacity="0.7">${String(indice).padStart(2, '0')}/${String(total).padStart(2, '0')}</text>`;
    return s;
  }
  let s = `<rect x="96" y="84" width="16" height="16" fill="${corMarca}"/>`;
  s += `<text x="126" y="100" font-family="${ARQ.rotulo.familia}" font-weight="700" font-size="26" letter-spacing="0.5" fill="${cor}">${esc(handle)}</text>`;
  if (total > 1) s += `<text x="${W - 96}" y="100" text-anchor="end" font-family="${ARQ.rotulo.familia}" font-weight="700" font-size="26" letter-spacing="1" fill="${cor}" opacity="0.65">${String(indice).padStart(2, '0')}/${String(total).padStart(2, '0')}</text>`;
  return s;
}

const svg = (fundo, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${fundo}"/>${inner}</svg>`;
const LARG = W - 2 * MARGEM;
const FUNCAO_ROTULO = { capa: 'ASSUNTO', contexto: 'CONTEXTO', prova: 'PROVA', explicacao: 'EXPLICAÇÃO', comparacao: 'COMPARAÇÃO', consequencia: 'NA PRÁTICA', opiniao: 'MINHA LEITURA', encerramento: '' };
const dica = (tema, texto, y) => `<text x="${MARGEM}" y="${y}" font-family="${ARQ.mRotulo.familia}" font-weight="700" font-size="28" letter-spacing="2" fill="${tema.apoio}" opacity="${tema.apoioOp}">${esc(texto)}</text>`;

// Fundo por função da tela (alterna claro, azul e grafite); `slide.fundo` força um.
function nomeTema(s) {
  if (s.fundo && TEMA[s.fundo]) return s.fundo;
  if (s.funcao === 'consequencia') return 'azul';
  if (s.funcao === 'opiniao') return 'grafite';
  return 'claro';
}

const aj = (o) => ajustar({ colchetes: true, ...o });
const rotuloSvg_ = (t, o) => rotuloSvg(t, { fam: 'mRotulo', ...o });
const textoSvg_ = (b, o) => textoSvg(b, o);

// ── Layouts ────────────────────────────────────────────────────────────────
function layoutCapaTipografica(s, ctx) {
  const T = TEMA.azul;
  const t = aj({ texto: s.texto, k: 'mDisplay', larg: LARG, alt: 760, max: 116, min: 88, entrelinha: 1.08, papel: 'id_titulo_capa' });
  const kicker = s.rotulo ? 64 : 0;
  const bloco = kicker + t.altura + 48 + 10;
  const topo = 190; const base = H - 190;
  const y0 = Math.round(topo + Math.max(0, base - topo - bloco) * 0.5);
  let inner = chrome({ ...ctx, tema: T });
  if (s.rotulo) inner += rotuloSvg_(s.rotulo, { x: MARGEM, y: y0 + 26, tam: 26, cor: T.texto, op: 0.85 });
  inner += textoSvg_(t, { x: MARGEM, y: y0 + kicker, k: 'mDisplay', tema: T });
  inner += `<rect x="${MARGEM}" y="${Math.round(y0 + kicker + t.altura + 48)}" width="120" height="10" fill="${COR.laranja}"/>`;
  if (ctx.total > 1) inner += dica(T, 'ARRASTE  →', H - 96);
  return { svg: svg(T.fundo, inner), blocos: [{ nome: 'titulo', ...resumo(t) }], tema: 'azul' };
}

function layoutExplicacao(s, ctx, nome) {
  const T = TEMA[nome];
  const blocos = [];
  const rot = s.funcao === 'opiniao' ? 'minha leitura' : '';
  const TOPO = 190; const BASE = H - 130;
  const ti = s.titulo ? aj({ texto: s.titulo, k: 'mDisplay', larg: LARG, alt: 340, max: 84, min: 64, entrelinha: 1.12, papel: 'id_titulo' }) : null;
  const yRot = rot ? 56 : 0;
  const yCorpo0 = yRot + (ti ? ti.altura + 40 : 0);
  // Tela só com uma frase curta vira "manchete": letra de título, não de apoio.
  const manchete = !s.titulo && String(s.texto || '').length <= 170;
  const c = manchete
    ? aj({ texto: s.texto, k: 'mDisplay', larg: LARG, alt: BASE - TOPO - yRot, max: 84, min: 64, entrelinha: 1.12, papel: 'id_titulo' })
    : aj({ texto: s.texto, k: 'iCorpo', larg: LARG, alt: BASE - TOPO - yCorpo0, max: 44, min: 36, entrelinha: 1.42, papel: 'id_corpo' });
  const total = yCorpo0 + c.altura;
  const livre = (BASE - TOPO) - total;
  const desloc = livre > 120 ? Math.round(livre * 0.46) : 0;
  let inner = chrome({ ...ctx, tema: T });
  if (rot) inner += rotuloSvg_(rot, { x: MARGEM, y: TOPO + desloc + 26, cor: nome === 'claro' ? COR.azul : T.texto, op: nome === 'claro' ? 1 : 0.85 });
  let y = TOPO + desloc + yRot;
  if (ti) {
    inner += textoSvg_(ti, { x: MARGEM, y, k: 'mDisplay', tema: T });
    y += ti.altura + 40;
    blocos.push({ nome: 'titulo', ...resumo(ti) });
  }
  inner += textoSvg_(c, { x: MARGEM, y, k: manchete ? 'mDisplay' : 'iCorpo', tema: T });
  blocos.push({ nome: 'corpo', ...resumo(c, BASE - TOPO - yCorpo0) });
  return { svg: svg(T.fundo, inner), blocos, tema: nome, elementos: rot ? ['rotulo_opiniao'] : [] };
}

function layoutProva(s, ctx) {
  const T = TEMA.claro;
  const blocos = [];
  const TOPO = 200; const BASE = H - 130;
  const fl = s.fonte_linha ? aj({ texto: s.fonte_linha, k: 'iSemi', larg: LARG, alt: 120, max: 28, min: 24, entrelinha: 1.3, papel: 'id_fonte_linha' }) : null;
  const altC = BASE - TOPO - (fl ? fl.altura + 56 : 0);
  const c = aj({ texto: s.texto, k: 'iCorpo', larg: LARG - 56, alt: altC, max: 52, min: 36, entrelinha: 1.4, papel: 'id_corpo_prova' });
  const total = c.altura + (fl ? 56 + fl.altura : 0);
  const livre = (BASE - TOPO) - total;
  const y = TOPO + (livre > 120 ? Math.round(livre * 0.46) : 0);
  let inner = chrome({ ...ctx, tema: T });
  inner += `<rect x="${MARGEM}" y="${(y - 6).toFixed(1)}" width="12" height="${(c.altura + 12).toFixed(1)}" fill="${COR.azul}"/>`;
  inner += textoSvg_(c, { x: MARGEM + 56, y, k: 'iCorpo', tema: T });
  blocos.push({ nome: 'prova', ...resumo(c, altC) });
  if (fl) {
    inner += textoSvg_(fl, { x: MARGEM + 56, y: y + c.altura + 56, k: 'iSemi', tema: { ...T, texto: COR.mudo } });
    blocos.push({ nome: 'fonte', ...resumo(fl) });
  } else {
    blocos.push({ nome: 'fonte', tam: 0, cabe: false, motivo: 'Slide de prova sem linha de fonte' });
  }
  return { svg: svg(T.fundo, inner), blocos, semFonte: !fl, tema: 'claro' };
}

function layoutComparacao(s, ctx) {
  const T = TEMA.claro;
  const d = s.dados || {};
  const e = d.esquerda || {}; const dr = d.direita || {};
  const blocos = [];
  const wCard = (LARG - 32) / 2; const hCard = 420;
  const fl = s.fonte_linha ? aj({ texto: s.fonte_linha, k: 'iSemi', larg: LARG, alt: 110, max: 28, min: 24, entrelinha: 1.3, papel: 'id_fonte_linha' }) : null;
  const TOPO = 190; const FIM = fl ? H - 100 - fl.altura - 40 : H - 140;
  const gap = 56;
  const t = aj({ texto: s.texto, k: 'iCorpo', larg: LARG, alt: FIM - TOPO - hCard - gap, max: 44, min: 36, entrelinha: 1.4, papel: 'id_texto_comparacao' });
  const livre = (FIM - TOPO) - (hCard + gap + t.altura);
  const yCard = TOPO + (livre > 100 ? Math.round(livre * 0.4) : 0);
  let inner = chrome({ ...ctx, tema: T });
  const card = (dado, x, destaque) => {
    const tc = destaque ? TEMA.azul : T;
    let g = destaque
      ? `<rect x="${x}" y="${yCard}" width="${wCard}" height="${hCard}" fill="${COR.azul}"/>`
      : `<rect x="${x + 1.5}" y="${yCard + 1.5}" width="${wCard - 3}" height="${hCard - 3}" fill="none" stroke="${COR.grafite}" stroke-width="3"/>`;
    g += rotuloSvg_(dado.rotulo || '', { x: x + 32, y: yCard + 64, tam: 26, cor: destaque ? COR.claro : COR.mudo, op: destaque ? 0.85 : 1 });
    const v = aj({ texto: String(dado.valor || ''), k: 'mDisplay', larg: wCard - 64, alt: 150, max: 96, min: 56, entrelinha: 1.08, papel: 'id_valor' });
    g += textoSvg_(v, { x: x + 32, y: yCard + 100, k: 'mDisplay', tema: { ...tc, texto: destaque ? COR.claro : COR.grafite } });
    blocos.push({ nome: `valor_${destaque ? 'direita' : 'esquerda'}`, ...resumo(v, 150) });
    const det = aj({ texto: String(dado.detalhe || ''), k: 'iCorpo', larg: wCard - 64, alt: hCard - 100 - v.altura - 56, max: 36, min: 32, entrelinha: 1.35, papel: 'id_texto_comparacao' });
    g += textoSvg_(det, { x: x + 32, y: yCard + 100 + v.altura + 20, k: 'iCorpo', tema: { ...tc, texto: destaque ? COR.claro : COR.grafite } });
    blocos.push({ nome: `detalhe_${destaque ? 'direita' : 'esquerda'}`, ...resumo(det) });
    return g;
  };
  inner += card(e, MARGEM, false) + card(dr, MARGEM + wCard + 32, true);
  inner += textoSvg_(t, { x: MARGEM, y: yCard + hCard + gap, k: 'iCorpo', tema: T });
  blocos.push({ nome: 'texto', ...resumo(t, FIM - TOPO - hCard - gap) });
  if (fl) { inner += textoSvg_(fl, { x: MARGEM, y: H - 100 - fl.altura, k: 'iSemi', tema: { ...T, texto: COR.mudo } }); blocos.push({ nome: 'fonte', ...resumo(fl) }); }
  else blocos.push({ nome: 'fonte', tam: 0, cabe: false, motivo: 'Comparação sem linha de fonte' });
  return { svg: svg(T.fundo, inner), blocos, semFonte: !fl, tema: 'claro' };
}

function layoutEncerramento(s, ctx) {
  const T = TEMA.azul;
  const c = aj({ texto: s.texto, k: 'mDisplay', larg: LARG, alt: 620, max: 100, min: 56, entrelinha: 1.1, papel: 'id_cta' });
  let inner = chrome({ ...ctx, tema: T });
  inner += `<rect x="${MARGEM}" y="270" width="120" height="10" fill="${COR.laranja}"/>`;
  inner += textoSvg_(c, { x: MARGEM, y: 330, k: 'mDisplay', tema: T });
  inner += `<rect x="${MARGEM}" y="${H - 146}" width="22" height="22" fill="${COR.laranja}"/>`;
  inner += `<text x="${MARGEM + 40}" y="${H - 124}" font-family="${ARQ.mDisplay.familia}" font-weight="800" font-size="48" fill="${COR.claro}">${esc(ACCOUNT.handle)}</text>`;
  return { svg: svg(T.fundo, inner), blocos: [{ nome: 'cta', ...resumo(c) }], tema: 'azul' };
}

function resumo(b, alt) { return { tam: b.tam, minimo: b.minimo, cabe: b.cabe, linhas: b.linhas.length, ...(b.cabe ? {} : { sobra_px: b.sobra, motivo: `Não cabe nem no tamanho mínimo legível (${b.minimo}px)` }), ...(alt ? { altura_disponivel: Math.round(alt) } : {}) }; }

// ── Capa fotográfica (só com imagem escolhida pelo Pedro) ──────────────────
// Foto inteira em cima; o título fica num painel azul chapado embaixo (sem
// gradiente), então o texto nunca depende do que a foto tem por trás.
async function renderCapaFoto(s, ctx, imagemBuf) {
  const T = TEMA.azul;
  const t = aj({ texto: s.texto, k: 'mDisplay', larg: LARG, alt: 520, max: 104, min: 88, entrelinha: 1.08, papel: 'id_titulo_capa' });
  const painelH = Math.round(t.altura + 72 + 130);
  const yPainel = H - painelH;
  let inner = `<rect x="0" y="0" width="${W}" height="150" fill="${COR.grafite}" opacity="0.6"/>`;
  inner += chrome({ ...ctx, tema: T });
  inner += `<rect x="0" y="${yPainel}" width="${W}" height="${painelH}" fill="${COR.azul}"/>`;
  inner += textoSvg_(t, { x: MARGEM, y: yPainel + 64, k: 'mDisplay', tema: T });
  if (ctx.total > 1) inner += dica(T, 'ARRASTE  →', H - 56);
  // Fidelidade: respeita a orientação da câmera (EXIF), não distorce (cover) e não
  // aplica filtro algum na foto.
  const meta = await sharp(imagemBuf).rotate().metadata();
  const lado = meta.orientation && meta.orientation >= 5 ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };
  const ampliacao = Math.max(W / lado.w, H / lado.h);
  const base = await sharp(imagemBuf).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
  const png = await sharp(base).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${inner}</svg>`), top: 0, left: 0 }]).png().toBuffer();
  return { png, blocos: [{ nome: 'titulo', ...resumo(t) }], foto: { largura: lado.w, altura: lado.h, ampliacao: Math.round(ampliacao * 100) / 100 } };
}

const LARG_LEG = W - 2 * 96; // largura útil dos desenhos legados (margem de 96)
// Distinct visual experiments. Every preview and published image uses this renderer.
async function renderExperimental(s, ctx, imagem) {
  const estilo = s.estilo;
  const capa = ctx.indice === 1;
  const fim = s.layout === 'encerramento';
  const paleta = estilo === 'impacto' ? { bg:'#1747D1', fg:'#FFFFFF', ac:'#DBFF70' } : estilo === 'revista' ? { bg:'#F2EDE3', fg:'#14243E', ac:'#DC542F' } : { bg:'#14243E', fg:'#FFFFFF', ac:'#FFCD68' };
  const usaFoto = !!imagem && !fim;
  let base = usaFoto ? await sharp(imagem).rotate().resize(W,H,{ fit:'cover', position:'attention' }).png().toBuffer() : null;
  let inner = '';
  if (usaFoto) inner += `<defs><linearGradient id="photo-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08152B" stop-opacity=".45"/><stop offset=".28" stop-color="#08152B" stop-opacity=".05"/><stop offset=".65" stop-color="#08152B" stop-opacity=".85"/><stop offset="1" stop-color="#08152B"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#photo-shade)"/>`;
  const cor = usaFoto ? '#FFFFFF' : paleta.fg;
  inner += chrome({ ...ctx, cor, corMarca:paleta.ac });
  const blocos=[];
  if (fim) {
    inner += `<circle cx="900" cy="350" r="370" fill="${paleta.ac}" opacity=".09"/>`;
    inner += rotuloSvg('A próxima leitura começa aqui', { x:96,y:300,tam:24,cor:paleta.ac,espaco:1 });
    const t=ajustar({ texto:s.texto,k:'display',larg:LARG_LEG,alt:590,max:82,min:48,entrelinha:1.16,papel:'cta' });
    inner += textoSvg(t,{ x:96,y:380,k:'display',cor,corDestaque:paleta.ac }); blocos.push({ nome:'cta',...resumo(t) });
    inner += `<rect x="96" y="1110" width="${LARG}" height="110" rx="22" fill="${paleta.ac}"/><text x="540" y="1182" text-anchor="middle" font-family="${ARQ.rotulo.familia}" font-weight="700" font-size="40" fill="#14243E">SIGA ${esc(ACCOUNT.handle)}</text>`;
  } else {
    const texto = capa ? s.texto : [s.titulo,s.texto].filter(Boolean).join('\n\n');
    const t=ajustar({ texto,k:capa?'display':'semi',larg:LARG_LEG,alt:capa?600:760,max:capa?90:64,min:capa?58:38,entrelinha:capa?1.12:1.32,papel:capa?'titulo_capa':'corpo' });
    const y=usaFoto?Math.max(440,1100-t.altura):capa?340:300;
    if (!usaFoto && estilo === 'revista') inner += `<rect x="96" y="210" width="96" height="12" fill="${paleta.ac}"/>`;
    if (!capa) inner += rotuloSvg(FUNCAO_ROTULO[s.funcao] || 'NA PRÁTICA',{x:96,y:220,tam:24,cor:paleta.ac,espaco:2});
    inner += textoSvg(t,{x:96,y,k:capa?'display':'semi',cor,corDestaque:paleta.ac}); blocos.push({nome:'conteudo',...resumo(t)});
    if (s.fonte_linha) {
      const f=ajustar({texto:s.fonte_linha,k:'semi',larg:LARG_LEG,alt:76,max:24,min:20,entrelinha:1.3,papel:'fonte_linha'});
      inner+=textoSvg(f,{x:96,y:1160,k:'semi',cor}); blocos.push({nome:'fonte',...resumo(f)});
    }
    inner += rotuloSvg(usaFoto?'Imagem ilustrativa · deslize →':capa?'Deslize para entender →':`Continue →`,{x:96,y:1280,tam:20,cor,espaco:1});
  }
  const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${base?'':`<rect width="${W}" height="${H}" fill="${paleta.bg}"/>`}${inner}</svg>`);
  const png=base?await sharp(base).composite([{input:overlay}]).png().toBuffer():await sharp(overlay).png().toBuffer();
  return {png,metrics:resumirMetricas(blocos,s.layout,['experimento_'+estilo,...(usaFoto?['foto_ilustrativa_licenciada']:[])])};
}

// ── Entrada principal ──────────────────────────────────────────────────────
// slide: { layout, funcao, titulo?, texto, rotulo?, dados?, fonte_linha?, fundo? }
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

  if (slide.design === 'editorial_2026') return require('./editorialStudio').renderizar(slide, ctx, imagem);
  if (['foto_editorial', 'impacto', 'revista'].includes(slide.estilo)) return renderExperimental(slide, ctx, imagem);

  let r;
  if (layout === 'capa_foto') {
    if (imagem) {
      const x = await renderCapaFoto(slide, ctx, imagem);
      const m = resumirMetricas(x.blocos, layout, ['imagem_do_pedro', ...(x.foto.ampliacao > 1.5 ? ['foto_baixa_resolucao'] : [])]);
      m.foto = x.foto;
      return { png: x.png, metrics: m };
    }
    layout = 'capa_tipografica';
    elementos.push('sem_imagem_usou_tipografica');
  }
  if (layout === 'capa_tipografica') r = layoutCapaTipografica(slide, ctx);
  else if (layout === 'prova') r = layoutProva(slide, ctx);
  else if (layout === 'comparacao') r = layoutComparacao(slide, ctx);
  else if (layout === 'encerramento') { r = layoutEncerramento(slide, ctx); elementos.push('encerramento_tipografico'); }
  else { r = layoutExplicacao(slide, ctx, nomeTema(slide)); layout = 'explicacao'; }
  const png = await sharp(Buffer.from(r.svg)).png().toBuffer();
  const m = resumirMetricas(r.blocos, layout, [...elementos, ...(r.elementos || [])]);
  m.tema = r.tema;
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

module.exports = { renderizarSlide, ajustar, quebrar, largura, palavras, textoSvg, rotuloSvg, resumo, MINIMO, COR, TEMA, W, H, MARGEM };
