// Testes do extrator de foto — rode com: node --test backend/lib/extrairFoto.test.js
// Duas camadas: funções puras (perfilDeTextura, maiorFaixaTexturizada) com
// pixels sintéticos, e o pipeline completo (localizarFoto/extrairFotoDaTela)
// com imagens geradas pelo sharp — não precisa de foto real nem de rede.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const {
  perfilDeTextura, maiorFaixaTexturizada, localizarFoto, extrairFotoDaTela,
} = require('./extrairFoto');

const FRACAO_MINIMA = 0.32; // espelha o limiar interno do módulo, só pra deixar o teste explícito

// ── perfilDeTextura ────────────────────────────────────────────────────────────
function bufferFaixaLisa(width, height, valor) {
  return Buffer.alloc(width * height, valor);
}
function bufferFaixaRuido(width, height) {
  const buf = Buffer.alloc(width * height);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

test('perfilDeTextura: faixa lisa tem fração baixa, faixa com ruído tem fração alta', () => {
  const w = 40, h = 40;
  const lisa = bufferFaixaLisa(w, h, 200);
  const ruido = bufferFaixaRuido(w, h);

  const pLisa = perfilDeTextura(lisa, { width: w, height: h }, 4);
  const pRuido = perfilDeTextura(ruido, { width: w, height: h }, 4);

  assert.ok(pLisa.every(b => b.fracao < 0.05), `faixa lisa com fração alta: ${JSON.stringify(pLisa)}`);
  assert.ok(pRuido.every(b => b.fracao > 0.5), `faixa de ruído com fração baixa: ${JSON.stringify(pRuido)}`);
});

test('perfilDeTextura: um degradê lento também conta como liso (gradiente não é foto)', () => {
  const w = 30, h = 60;
  const buf = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const v = Math.round((y / h) * 255); // muda devagar de cima pra baixo
    for (let x = 0; x < w; x++) buf[y * w + x] = v;
  }
  const perfil = perfilDeTextura(buf, { width: w, height: h }, 12);
  // Dentro de CADA bloco a variação é pequena — é textura local que importa, não a mudança total da imagem.
  assert.ok(perfil.every(b => b.fracao < 0.1), `gradiente virou "textura": ${JSON.stringify(perfil.map(b => b.fracao))}`);
});

test('perfilDeTextura: título grande e nítido sobre fundo liso NÃO conta como foto', () => {
  // 15% da área é "letra" (valor 20, escuro) sobre fundo liso (valor 235) —
  // desvio-padrão desse bloco seria alto (é justamente o que quebrava antes),
  // mas a ÁREA que foge do fundo é pequena, e é isso que importa.
  const w = 100, h = 20;
  const buf = Buffer.alloc(w * h, 235);
  for (let i = 0; i < buf.length * 0.15; i++) buf[i] = 20;
  const perfil = perfilDeTextura(buf, { width: w, height: h }, 1);
  assert.ok(perfil[0].fracao < FRACAO_MINIMA, `texto sobre fundo liso passou como foto: ${perfil[0].fracao}`);
});

// ── maiorFaixaTexturizada ──────────────────────────────────────────────────────
test('maiorFaixaTexturizada acha a maior faixa contínua', () => {
  const perfil = [0.1, 0.1, 0.4, 0.4, 0.4, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1].map(f => ({ fracao: f }));
  const r = maiorFaixaTexturizada(perfil, 0.3, 0);
  assert.deepStrictEqual(r, { inicio: 6, fim: 10 });
});

test('maiorFaixaTexturizada tolera um buraco pequeno no meio da foto', () => {
  // texto curto sobre a foto derruba a textura de 1 bloco isolado — não pode partir a faixa
  const perfil = [0.1, 0.4, 0.4, 0.4, 0.1, 0.4, 0.4, 0.1].map(f => ({ fracao: f }));
  const r = maiorFaixaTexturizada(perfil, 0.3, 1);
  assert.deepStrictEqual(r, { inicio: 1, fim: 6 });
});

test('maiorFaixaTexturizada devolve null quando não há nada acima do limiar', () => {
  const perfil = [0.05, 0.06, 0.04, 0.07, 0.05].map(f => ({ fracao: f }));
  assert.strictEqual(maiorFaixaTexturizada(perfil, 0.3, 1), null);
});

// ── pipeline completo (imagens sintéticas via sharp) ────────────────────────────
async function pngRuido(w, h) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Banda de título lisa em cima + foto (ruído) preenchendo o resto — o layout
// mais comum de carrossel educativo real.
async function telaComBandaEFoto(w, h, alturaBanda) {
  const banda = await sharp({ create: { width: w, height: alturaBanda, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const foto = await pngRuido(w, h - alturaBanda);
  return sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: banda, top: 0, left: 0 }, { input: foto, top: alturaBanda, left: 0 }])
    .png()
    .toBuffer();
}

// Card 100% design: gradiente liso do topo à base, sem foto nenhuma — como os
// carrosséis de "citação"/frase que não têm imagem de verdade.
async function telaSoDesign(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#12251f"/><stop offset="1" stop-color="#0a3b2e"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('tela com banda de título + foto: a região achada é a foto, não a banda', async () => {
  const w = 300, h = 600, alturaBanda = 150;
  const png = await telaComBandaEFoto(w, h, alturaBanda);
  const regiao = await localizarFoto(png);

  assert.ok(regiao, 'não achou região nenhuma');
  // a região deve começar depois (ou bem perto) do fim da banda, e ocupar o resto
  assert.ok(regiao.top >= alturaBanda - 40, `região começou dentro da banda: top=${regiao.top}`);
  assert.ok(regiao.height > (h - alturaBanda) * 0.5, `região menor que a foto de verdade: ${regiao.height}`);
});

// Banda com TÍTULO GRANDE E NEGRITO (não só um retângulo cinza) — é o caso que
// quebrava antes: letra grande em negrito cria desvio-padrão tão alto quanto
// foto de verdade, mesmo ocupando pouca área do bloco.
async function telaComTituloGrandeEFoto(w, h, alturaBanda) {
  const svgTitulo = `<svg width="${w}" height="${alturaBanda}">
    <rect width="${w}" height="${alturaBanda}" fill="#ffffff"/>
    <text x="30" y="${alturaBanda * 0.4}" font-family="sans-serif" font-size="${Math.round(alturaBanda * 0.28)}" font-weight="900" fill="#000000">Abastecer de noite</text>
    <text x="30" y="${alturaBanda * 0.8}" font-family="sans-serif" font-size="${Math.round(alturaBanda * 0.28)}" font-weight="900" fill="#000000">rende mais?</text>
  </svg>`;
  const banda = await sharp(Buffer.from(svgTitulo)).png().toBuffer();
  const foto = await pngRuido(w, h - alturaBanda);
  return sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: banda, top: 0, left: 0 }, { input: foto, top: alturaBanda, left: 0 }])
    .png()
    .toBuffer();
}

test('título grande e nítido não engana a detecção — a região continua sendo só a foto', async () => {
  const w = 400, h = 700, alturaBanda = 210; // banda ocupa 30% — igual ao caso real que quebrou
  const png = await telaComTituloGrandeEFoto(w, h, alturaBanda);
  const regiao = await localizarFoto(png);

  assert.ok(regiao, 'não achou região nenhuma');
  assert.ok(regiao.top >= alturaBanda - 40, `pegou parte do título: top=${regiao.top} (banda termina em ${alturaBanda})`);
  assert.ok(regiao.height > (h - alturaBanda) * 0.6, `região menor que a foto de verdade: ${regiao.height}`);
});

test('tela só de design (gradiente, sem foto): não força nada', async () => {
  const png = await telaSoDesign(280, 500);
  const regiao = await localizarFoto(png);
  assert.strictEqual(regiao, null, `achou foto onde não tinha: ${JSON.stringify(regiao)}`);

  const foto = await extrairFotoDaTela(png);
  assert.strictEqual(foto, null);
});

test('tela inteira de foto: a região cobre quase tudo', async () => {
  const png = await pngRuido(300, 500);
  const regiao = await localizarFoto(png);
  assert.ok(regiao, 'não achou foto numa tela 100% foto');
  assert.ok(regiao.height > 400, `região pequena demais numa foto cheia: ${regiao.height}`);
});

test('extrairFotoDaTela devolve um buffer de imagem válido, recortado', async () => {
  const w = 300, h = 600, alturaBanda = 150;
  const png = await telaComBandaEFoto(w, h, alturaBanda);
  const foto = await extrairFotoDaTela(png);
  assert.ok(foto, 'não extraiu nada');
  const meta = await sharp(foto).metadata();
  assert.ok(meta.height < h, 'não cortou a banda de fora');
  assert.strictEqual(meta.width, w);
});

test('aguenta imagem minúscula ou quase sólida sem quebrar', async () => {
  const minuscula = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } }).png().toBuffer();
  await assert.doesNotReject(() => localizarFoto(minuscula));
  await assert.doesNotReject(() => extrairFotoDaTela(minuscula));
});
