// Cópia fiel: mantém a imagem original (desenho, foto, layout, cores) e troca SÓ o texto pelo traduzido, no mesmo lugar.
//  1. A OCR dá cada parágrafo com a caixa (x0, y0, x1, y1) e a altura da linha.
//  2. Cor de fundo = mediana do anel em volta da caixa; cor do texto = média dos pixels da caixa que fogem do fundo.
//  3. Pinta a caixa com a cor de fundo e escreve a tradução (Inter, desenhada como contorno: não depende de fonte instalada),
//     do tamanho original, encolhendo até caber; centralizada se o original era centralizado.
// Sem IA e sem custo: roda no servidor com sharp + opentype.
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const _f = {};
// Padrão da marca em TODO conteúdo (decisão do Pedro, 14/11/2026): Inter Bold nos títulos e Inter Regular no corpo,
// as mesmas fontes dos carrosséis da ferramenta (arteTweet: iNegrito / iCorpo).
const fonte = (peso) => (_f[peso] ||= opentype.loadSync(path.join(ASSETS, peso === 'negrito' ? 'Inter-Bold.ttf' : 'Inter-Regular.ttf')));
// Cores da marca para o texto: grafite do formato tweet sobre fundo claro, branco do ensaio sobre fundo escuro.
const MARCA = { escuro: [15, 20, 25], claro: [255, 255, 255] };
const corDaMarca = (fundo) => (0.299 * fundo[0] + 0.587 * fundo[1] + 0.114 * fundo[2] > 140 ? MARCA.escuro : MARCA.claro);

const W45 = 1080; const H45 = 1350;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Parágrafo que vale trocar: texto de verdade (letras), confiança boa, não é ruído do desenho.
function ehTexto(p) {
  const t = String(p?.texto || '');
  const letras = (t.match(/\p{L}/gu) || []).length;
  return (p.confianca ?? 0) >= 60 && letras >= 2 && letras / Math.max(1, t.replace(/\s/g, '').length) >= 0.4 && p.x1 > p.x0 && p.y1 > p.y0;
}

function pixel(raw, info, x, y) { const i = (y * info.width + x) * info.channels; return [raw[i], raw[i + 1], raw[i + 2]]; }

// Cores de fundo e de texto de uma caixa.
function cores(raw, info, b) {
  const pad = Math.max(4, Math.round(b.altura_linha * 0.25)); const anel = Math.max(6, Math.round(b.altura_linha * 0.35));
  const X0 = Math.max(0, b.x0 - pad - anel); const X1 = Math.min(info.width - 1, b.x1 + pad + anel);
  const Y0 = Math.max(0, b.y0 - pad - anel); const Y1 = Math.min(info.height - 1, b.y1 + pad + anel);
  const R = []; const G = []; const B = [];
  const passo = Math.max(1, Math.round((X1 - X0) / 120));
  for (let y = Y0; y <= Y1; y += passo) for (let x = X0; x <= X1; x += passo) {
    const dentro = x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
    if (dentro) continue; const c = pixel(raw, info, x, y); R.push(c[0]); G.push(c[1]); B.push(c[2]);
  }
  const fundo = [mediana(R), mediana(G), mediana(B)];
  let soma = [0, 0, 0]; let n = 0;
  const p2 = Math.max(1, Math.round((b.x1 - b.x0) / 160));
  for (let y = b.y0; y <= b.y1; y += p2) for (let x = b.x0; x <= b.x1; x += p2) {
    const c = pixel(raw, info, Math.min(info.width - 1, x), Math.min(info.height - 1, y));
    if (dist(c, fundo) > 90) { soma = [soma[0] + c[0], soma[1] + c[1], soma[2] + c[2]]; n++; }
  }
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const texto = n ? soma.map((v) => v / n) : (lum(fundo) > 140 ? [17, 17, 17] : [250, 250, 250]);
  return { fundo, texto, pad };
}

function quebrar(f, texto, tam, largura) {
  const out = [];
  // "\n" no texto é quebra obrigatória (frases que eram linhas separadas no original).
  for (const parte of String(texto).split('\n')) {
    let atual = '';
    for (const w of parte.split(/\s+/).filter(Boolean)) {
      const teste = atual ? `${atual} ${w}` : w;
      if (!atual || f.getAdvanceWidth(teste, tam) <= largura) atual = teste; else { out.push(atual); atual = w; }
    }
    if (atual) out.push(atual);
  }
  return out;
}

// Encaixa a tradução na caixa original: mesmo tamanho de letra, encolhendo até caber (mínimo 55%).
function diagramar(b, texto, info) {
  // Peso pelo original: tinta densa = negrito (medido: negrito ~0,21, regular ~0,09); sem medida, pelo tamanho da letra.
  const negrito = b.traco != null ? b.traco > 0.115 : (b.altura_linha >= 38 || b.titulo);
  const f = fonte(negrito ? 'negrito' : 'normal');
  const centrado = Math.abs(b.x0 - (info.width - b.x1)) < info.width * 0.06 && b.x0 > info.width * 0.06; // margens iguais dos dois lados
  // Largura disponível: a do original, podendo crescer até 12% (texto em português costuma ser mais longo), sem sair da imagem.
  const margem = Math.round(info.width * 0.05);
  // Rótulo curto (até 3 palavras) pode alargar mais, numa linha só, em vez de quebrar e ficar minúsculo.
  const curto = String(texto).split(/\s+/).length <= 3 && (b.n_linhas || 1) === 1;
  const largura = Math.min(info.width - 2 * margem, Math.round((b.x1 - b.x0) * (curto ? 1.9 : 1.12)));
  const alturaMax = Math.max(b.y1 - b.y0, b.altura_linha) * 1.08;
  const base = b.altura_linha * 0.98; let tam = base; let linhas;
  for (;;) {
    linhas = quebrar(f, texto, tam, largura);
    const alto = linhas.length * tam * 1.18;
    const largo = Math.max(...linhas.map((l) => f.getAdvanceWidth(l, tam)));
    if ((alto <= alturaMax && largo <= largura) || tam <= base * 0.55) break;
    tam *= 0.94;
  }
  return { f, tam, linhas, centrado, largura };
}

// Encolhe a caixa de apagar até a "tinta" da assinatura: linhas que atravessam a caixa inteira (moldura, divisória)
// não contam, e fica só o maior bloco de tinta. Assim apaga o logo e o @ sem comer o desenho em volta.
function refinarApagar(raw, info, b) {
  const borda = [];
  for (let x = b.x0; x <= b.x1; x += 2) { borda.push(pixel(raw, info, x, b.y0), pixel(raw, info, x, b.y1)); }
  for (let y = b.y0; y <= b.y1; y += 2) { borda.push(pixel(raw, info, b.x0, y), pixel(raw, info, b.x1, y)); }
  const fundo = [0, 1, 2].map((c) => mediana(borda.map((p) => p[c])));
  const tinta = (x, y) => dist(pixel(raw, info, x, y), fundo) > 60;
  const larg = b.x1 - b.x0 + 1;
  const linha = []; // tinta por linha, sem as linhas que atravessam (> 80% da largura)
  for (let y = b.y0; y <= b.y1; y++) { let n = 0; for (let x = b.x0; x <= b.x1; x++) if (tinta(x, y)) n++; linha.push(n > larg * 0.8 ? 0 : n); }
  // Grupos de linhas com tinta; fica o de mais tinta.
  // Logo e @ costumam ter um respiro entre eles: buraco de até 15% da altura da caixa ainda é a mesma assinatura.
  const buraco = Math.max(6, Math.round((b.y1 - b.y0) * 0.15));
  let melhor = null; let ini = -1; let massa = 0; let vazio = 0;
  for (let i = 0; i <= linha.length; i++) {
    const n = i < linha.length ? linha[i] : 0;
    if (n > 0) { if (ini < 0) ini = i; massa += n; vazio = 0; }
    else if (ini >= 0 && (++vazio > buraco || i === linha.length)) { const fim = i - vazio; if (!melhor || massa > melhor.massa) melhor = { a: ini, b: fim, massa }; ini = -1; massa = 0; vazio = 0; }
  }
  if (!melhor || melhor.massa < 8) return null;
  const ya = b.y0 + melhor.a; const yb = b.y0 + melhor.b;
  let xa = b.x1; let xb = b.x0;
  for (let y = ya; y <= yb; y++) for (let x = b.x0; x <= b.x1; x++) if (tinta(x, y)) { if (x < xa) xa = x; if (x > xb) xb = x; }
  const pad = 6;
  return { x0: Math.max(0, xa - pad), y0: Math.max(0, ya - pad), x1: Math.min(info.width - 1, xb + pad), y1: Math.min(info.height - 1, yb + pad), fundo };
}

// Acha a assinatura do autor pela imagem, na região que a IA indicou ("base-centro"…): o bloco de tinta mais perto
// da borda indicada, ignorando linhas que atravessam a região (moldura, divisória). A IA nunca dá a posição exata.
function acharSelo(raw, info, posicao, protegidas = []) {
  const [v, h] = String(posicao).split('-');
  const W = info.width; const H = info.height;
  const ry = v === 'topo' ? [0, 0.22] : v === 'base' ? [0.78, 1] : [0.35, 0.65];
  // Topo e base: a faixa inteira (cabeçalho com foto + nome + @ atravessa a página); o lado só escolhe por onde começar.
  const rx = v !== 'meio' ? [0, 1] : h === 'esquerda' ? [0, 0.62] : h === 'direita' ? [0.38, 1] : [0.2, 0.8];
  const R = { x0: Math.round(W * rx[0]), x1: Math.round(W * rx[1]) - 1, y0: Math.round(H * ry[0]), y1: Math.round(H * ry[1]) - 1 };
  const borda = [];
  for (let x = R.x0; x <= R.x1; x += 3) borda.push(pixel(raw, info, x, R.y0), pixel(raw, info, x, R.y1));
  for (let y = R.y0; y <= R.y1; y += 3) borda.push(pixel(raw, info, R.x0, y), pixel(raw, info, R.x1, y));
  const fundo = [0, 1, 2].map((c) => mediana(borda.map((p) => p[c])));
  // O texto do conteúdo (já casado com a IA) nunca conta como assinatura: protege a caixa de cada um.
  const protegido = (x, y) => protegidas.some((b) => x >= b.x0 - 6 && x <= b.x1 + 6 && y >= b.y0 - 6 && y <= b.y1 + 6);
  const tinta = (x, y) => !protegido(x, y) && dist(pixel(raw, info, x, y), fundo) > 60;
  const larg = R.x1 - R.x0 + 1;
  const grupos = (vals, buraco) => { const g = []; let ini = -1; let vazio = 0; let massa = 0;
    for (let i = 0; i <= vals.length; i++) { const n = i < vals.length ? vals[i] : 0;
      if (n > 0) { if (ini < 0) ini = i; massa += n; vazio = 0; } else if (ini >= 0 && (++vazio > buraco || i === vals.length)) { g.push({ a: ini, b: i - vazio, massa }); ini = -1; massa = 0; vazio = 0; } }
    return g.filter((x) => x.massa >= 10); };
  const linhas = []; for (let y = R.y0; y <= R.y1; y++) { let n = 0; for (let x = R.x0; x <= R.x1; x++) if (tinta(x, y)) n++; linhas.push(n > larg * 0.7 ? 0 : n); }
  const gl = grupos(linhas, Math.max(6, Math.round(H * 0.012)));
  if (!gl.length) return null;
  const gy = v === 'topo' ? gl[0] : v === 'base' ? gl[gl.length - 1] : gl.reduce((a, b) => (b.massa > a.massa ? b : a));
  const ya = R.y0 + gy.a; const yb = R.y0 + gy.b;
  const cols = []; for (let x = R.x0; x <= R.x1; x++) { let n = 0; for (let y = ya; y <= yb; y++) if (tinta(x, y)) n++; cols.push(n); }
  const gc = grupos(cols, Math.max(10, Math.round(W * 0.025)));
  if (!gc.length) return null;
  const meio = (g) => R.x0 + (g.a + g.b) / 2;
  // Assinatura = foto + nome + @ juntos: parte do bloco da borda indicada e junta os vizinhos próximos (até 8% da largura).
  let iA = h === 'esquerda' ? 0 : h === 'direita' ? gc.length - 1 : gc.reduce((m, g, i) => (Math.abs(meio(g) - W / 2) < Math.abs(meio(gc[m]) - W / 2) ? i : m), 0);
  let iB = iA; const junta = W * 0.08;
  while (iA > 0 && gc[iA].a - gc[iA - 1].b <= junta) iA--;
  while (iB < gc.length - 1 && gc[iB + 1].a - gc[iB].b <= junta) iB++;
  const gx = { a: gc[iA].a, b: gc[iB].b };
  const pad = 8;
  const r = { x0: Math.max(0, R.x0 + gx.a - pad), x1: Math.min(W - 1, R.x0 + gx.b + pad), y0: Math.max(0, ya - pad), y1: Math.min(H - 1, yb + pad), fundo };
  // Selo grande demais não é selo (é parte do desenho ou da foto): não mexe.
  // Selo grande demais não é selo (é parte do desenho ou da foto): não mexe. Cabeçalho no topo/base pode ser maior (foto + nome + @).
  if ((r.x1 - r.x0) * (r.y1 - r.y0) > W * H * (v === 'meio' ? 0.06 : 0.14)) return null;
  // Fundo liso em volta: pinta; sobre foto: borra.
  const anel = []; for (let x = r.x0; x <= r.x1; x += 2) anel.push(pixel(raw, info, x, r.y0), pixel(raw, info, x, r.y1)); for (let y = r.y0; y <= r.y1; y += 2) anel.push(pixel(raw, info, r.x0, y), pixel(raw, info, r.x1, y));
  const desvio = Math.sqrt(anel.reduce((a, p) => a + dist(p, fundo) ** 2, 0) / Math.max(1, anel.length));
  // Liso = quase toda a borda (da caixa ou da região) tem a cor do fundo; foto e degradê ficam abaixo disso e são borrados.
  const parecido = (lista) => lista.filter((p) => dist(p, fundo) < 30).length / Math.max(1, lista.length);
  return { ...r, liso: desvio < 30 || parecido(anel) > 0.85 || parecido(borda) > 0.85 };
}

// Monta o SVG com a pintura das caixas e o texto novo (contornos).
function svgTroca(blocos, info, raw) {
  let rects = ''; let textos = ''; const trocados = []; const borrar = [];
  // Assinatura do autor (@, nome, logo, rosto, marca d'água): só apaga, com a cor do fundo em volta.
  for (const b of blocos.filter((x) => x.apagar)) {
    const r = b.posicao ? acharSelo(raw, info, b.posicao, blocos.filter((x) => !x.apagar && x.x1 > x.x0)) : (() => {
      const x0 = Math.max(0, b.x0); const y0 = Math.max(0, b.y0); const x1 = Math.min(info.width - 1, b.x1); const y1 = Math.min(info.height - 1, b.y1);
      return x1 > x0 && y1 > y0 ? refinarApagar(raw, info, { x0, y0, x1, y1 }) : null; })();
    if (!r) continue;
    if (r.liso !== false) rects += `<rect x="${r.x0}" y="${r.y0}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" fill="${hex(r.fundo)}"/>`;
    else borrar.push(r); // sobre foto: borra em vez de pintar um retângulo
    trocados.push({ original: b.texto, apagado: true, caixa: [r.x0, r.y0, r.x1, r.y1] });
  }
  for (const b of blocos) {
    if (b.apagar || !b.novo || (!b.visao && !ehTexto(b))) continue;
    const { fundo, pad } = cores(raw, info, b); const corTexto = corDaMarca(fundo); // nunca a cor do post original
    // Negrito ou regular pela espessura do traço do original: mediana das corridas horizontais de tinta ÷ altura da linha
    // (medido nos posts reais: regular ≈ 0,08–0,09; negrito ≈ 0,14).
    const corridas = [];
    for (let y = Math.max(0, b.y0); y <= Math.min(info.height - 1, b.y1); y++) { let r = 0; for (let x = Math.max(0, b.x0); x <= Math.min(info.width - 1, b.x1); x++) { if (dist(pixel(raw, info, x, y), fundo) > 90) r++; else { if (r) corridas.push(r); r = 0; } } }
    corridas.sort((p1, p2) => p1 - p2);
    const traco = corridas.length >= 20 && b.altura_linha ? corridas[Math.floor(corridas.length / 2)] / b.altura_linha : null;
    const d = diagramar({ ...b, traco }, b.novo, info);
    const alto = d.linhas.length * d.tam * 1.18;
    // Página de um texto só, sem o cabeçalho do autor: o texto vai para o meio da página (fica só a página branca com ele).
    const unico = blocos.filter((x) => !x.apagar && x.novo).length === 1 && blocos.some((x) => x.apagar && x.posicao && !x.posicao.startsWith('base'));
    const y0 = (unico ? info.height / 2 : (b.y0 + b.y1) / 2) - alto / 2;
    rects += `<rect x="${b.x0 - pad}" y="${b.y0 - pad}" width="${b.x1 - b.x0 + 2 * pad}" height="${b.y1 - b.y0 + 2 * pad}" fill="${hex(fundo)}"/>`;
    // A caixa nova pode ser maior que a original: pinta também a área do texto novo.
    const xs = d.linhas.map((l) => { const w = d.f.getAdvanceWidth(l, d.tam); return { l, w, x: d.centrado ? (b.x0 + b.x1) / 2 - w / 2 : b.x0 }; });
    const xMin = Math.min(...xs.map((z) => z.x)); const xMax = Math.max(...xs.map((z) => z.x + z.w));
    rects += `<rect x="${Math.round(xMin - pad / 2)}" y="${Math.round(y0 - pad / 2)}" width="${Math.round(xMax - xMin + pad)}" height="${Math.round(alto + pad)}" fill="${hex(fundo)}"/>`;
    xs.forEach((z, i) => {
      const baseLinha = y0 + (i + 0.82) * d.tam * 1.18 - d.tam * 0.09;
      textos += `<path d="${d.f.getPath(z.l, z.x, baseLinha, d.tam).toPathData(2)}" fill="${hex(corTexto)}"/>`;
    });
    trocados.push({ original: b.texto, novo: b.novo, tam: Math.round(d.tam), linhas: d.linhas.length });
  }
  return { borrar, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">${rects}${textos}</svg>`, trocados };
}

// Troca o texto na imagem original. `blocos`: parágrafos da OCR com `novo` (tradução) quando é para trocar.
// Nosso @ embaixo, centralizado, em todas as páginas da cópia (Inter Bold, cor da marca conforme o fundo).
function svgAssinatura(raw, info, handle) {
  if (!handle) return '';
  const f = fonte('negrito'); const tam = Math.round(info.height * 0.024);
  const w = f.getAdvanceWidth(handle, tam); const x = (info.width - w) / 2; const base = info.height - Math.round(info.height * 0.035);
  const area = { x0: Math.max(0, Math.round(x - tam)), x1: Math.min(info.width - 1, Math.round(x + w + tam)), y0: Math.max(0, Math.round(base - tam * 1.3)), y1: Math.min(info.height - 1, Math.round(base + tam * 0.6)) };
  const amostra = []; for (let xx = area.x0; xx <= area.x1; xx += 4) amostra.push(pixel(raw, info, xx, area.y0), pixel(raw, info, xx, area.y1));
  const fundo = [0, 1, 2].map((c) => mediana(amostra.map((p) => p[c])));
  const cor = corDaMarca(fundo);
  return `<path d="${f.getPath(handle, x, base, tam).toPathData(2)}" fill="${hex(cor)}" opacity="0.85"/>`;
}

// Página de texto refeita no nosso padrão (pedido do Pedro): fundo branco, texto traduzido em Inter (negrito onde o original
// era título/destaque), alinhado à esquerda e centralizado na altura, e o nosso @ embaixo. Sem nada do autor.
async function paginaTexto(paragrafos, { assinatura = null, largura = W45, altura = H45 } = {}) {
  // Só o que a Inter desenha (emoji e símbolo viram quadradinho): sai do texto.
  const desenhavel = (t) => [...String(t || '')].filter((ch) => /\s/.test(ch) || fonte('normal').charToGlyph(ch).index !== 0).join('').replace(/\s{2,}/g, ' ').trim();
  const brutos = (paragrafos || []).map((p) => ({ texto: desenhavel(p.texto), negrito: !!p.negrito })).filter((p) => p.texto);
  // Frase partida em várias linhas (texto escrito à mão lido linha a linha): junta enquanto a anterior não termina a frase.
  const lista = [];
  for (const p of brutos) {
    const ant = lista[lista.length - 1];
    if (ant && ant.negrito === p.negrito && !/[.!?:;…"”)]$/.test(ant.texto)) ant.texto = `${ant.texto} ${p.texto.charAt(0).toLowerCase()}${p.texto.slice(1)}`;
    else lista.push({ ...p });
  }
  const M = 96; const larg = largura - 2 * M; const util = altura - 2 * 150;
  let tam = 64; let medida = null;
  for (; tam >= 26; tam -= 2) {
    let h = 0; const linhas = [];
    for (const [i, p] of lista.entries()) {
      const t = p.negrito ? Math.round(tam * 1.08) : tam;
      const ls = quebrar(fonte(p.negrito ? 'negrito' : 'normal'), p.texto, t, larg);
      linhas.push({ ls, t, negrito: p.negrito }); h += ls.length * t * 1.28 + (i ? tam * 0.85 : 0);
    }
    medida = { linhas, h };
    if (h <= util) break;
  }
  let y = (altura - medida.h) / 2; let svg = `<rect width="${largura}" height="${altura}" fill="#FFFFFF"/>`;
  for (const [i, bl] of medida.linhas.entries()) {
    if (i) y += tam * 0.85;
    const f = fonte(bl.negrito ? 'negrito' : 'normal');
    for (const l of bl.ls) { y += bl.t * 1.28; svg += `<path d="${f.getPath(l, M, y - bl.t * 0.3, bl.t).toPathData(2)}" fill="${hex(MARCA.escuro)}"/>`; }
  }
  if (assinatura) {
    const f = fonte('negrito'); const t = Math.round(altura * 0.024); const w = f.getAdvanceWidth(assinatura, t);
    svg += `<path d="${f.getPath(assinatura, (largura - w) / 2, altura - Math.round(altura * 0.035), t).toPathData(2)}" fill="${hex(MARCA.escuro)}" opacity="0.85"/>`;
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">${svg}</svg>`)).flatten({ background: '#FFFFFF' }).jpeg({ quality: 92 }).toBuffer();
}

async function substituir(buf, blocos, { assinatura = null } = {}) {
  const img = sharp(buf).rotate();
  const { data: raw, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const r0 = svgTroca(blocos || [], info, raw); const { trocados, borrar } = r0;
  const nossa = svgAssinatura(raw, info, assinatura);
  const svg = nossa ? r0.svg.replace('</svg>', `${nossa}</svg>`) : r0.svg;
  if (!trocados.length && !nossa) return { buffer: await img.jpeg({ quality: 92 }).toBuffer(), trocados };
  const base = sharp(raw, { raw: { width: info.width, height: info.height, channels: info.channels } });
  const camadas = [];
  for (const r of borrar) {
    const w = r.x1 - r.x0; const h = r.y1 - r.y0; if (w < 4 || h < 4) continue;
    const pedaco = await sharp(raw, { raw: { width: info.width, height: info.height, channels: info.channels } }).extract({ left: r.x0, top: r.y0, width: w, height: h }).blur(Math.max(8, Math.min(w, h) / 3)).png().toBuffer();
    camadas.push({ input: pedaco, left: r.x0, top: r.y0 });
  }
  const out = await base.composite([...camadas, { input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
  return { buffer: out, trocados };
}

// 1080×1350 sem cortar nada: se a proporção já é 4:5 preenche; senão, encaixa inteira sobre a cor da borda.
async function encaixar45(buf) {
  const s = sharp(buf).rotate(); const m = await s.metadata();
  const w = m.autoOrient?.width || m.width; const h = m.autoOrient?.height || m.height;
  if (Math.abs(w / h - W45 / H45) < 0.03) return s.resize(W45, H45, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
  const st = await sharp(buf).rotate().resize(40, 40, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const borda = []; for (let i = 0; i < 40; i++) for (const [x, y] of [[i, 0], [i, 39], [0, i], [39, i]]) { const k = (y * 40 + x) * 3; borda.push([st[k], st[k + 1], st[k + 2]]); }
  const fundo = [0, 1, 2].map((c) => mediana(borda.map((p) => p[c])));
  return s.resize(W45, H45, { fit: 'contain', background: { r: fundo[0], g: fundo[1], b: fundo[2] } }).flatten({ background: { r: fundo[0], g: fundo[1], b: fundo[2] } }).jpeg({ quality: 90 }).toBuffer();
}

module.exports = { paginaTexto, corDaMarca, MARCA, acharSelo, refinarApagar, ehTexto, cores, quebrar, diagramar, substituir, encaixar45 };
