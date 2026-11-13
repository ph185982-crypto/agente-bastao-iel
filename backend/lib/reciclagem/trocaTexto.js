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
const fonte = (peso) => (_f[peso] ||= opentype.loadSync(path.join(ASSETS, peso === 'negrito' ? 'Inter-Bold.ttf' : 'Inter-SemiBold.ttf')));

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
  const out = []; let atual = '';
  for (const w of String(texto).split(/\s+/).filter(Boolean)) {
    const teste = atual ? `${atual} ${w}` : w;
    if (!atual || f.getAdvanceWidth(teste, tam) <= largura) atual = teste; else { out.push(atual); atual = w; }
  }
  if (atual) out.push(atual);
  return out;
}

// Encaixa a tradução na caixa original: mesmo tamanho de letra, encolhendo até caber (mínimo 55%).
function diagramar(b, texto, info) {
  const negrito = b.altura_linha >= 38 || b.titulo;
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

// Monta o SVG com a pintura das caixas e o texto novo (contornos).
function svgTroca(blocos, info, raw) {
  let rects = ''; let textos = ''; const trocados = [];
  for (const b of blocos) {
    if (!b.novo || !ehTexto(b)) continue;
    const { fundo, texto: corTexto, pad } = cores(raw, info, b);
    const d = diagramar(b, b.novo, info);
    const alto = d.linhas.length * d.tam * 1.18;
    const y0 = (b.y0 + b.y1) / 2 - alto / 2;
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">${rects}${textos}</svg>`, trocados };
}

// Troca o texto na imagem original. `blocos`: parágrafos da OCR com `novo` (tradução) quando é para trocar.
async function substituir(buf, blocos) {
  const img = sharp(buf).rotate();
  const { data: raw, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { svg, trocados } = svgTroca(blocos || [], info, raw);
  if (!trocados.length) return { buffer: await img.jpeg({ quality: 92 }).toBuffer(), trocados };
  const out = await sharp(raw, { raw: { width: info.width, height: info.height, channels: info.channels } }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
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

module.exports = { ehTexto, cores, quebrar, diagramar, substituir, encaixar45 };
