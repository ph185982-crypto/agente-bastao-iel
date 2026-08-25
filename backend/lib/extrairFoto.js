// ── Extrair a foto de dentro do print de uma tela (sem IA) ────────────────────
// Quando o carrossel original tem uma foto real de fundo, a gente quer USAR
// ESSA foto no clone — não buscar foto de banco aleatória, que sai sem nenhuma
// relação com o conteúdo (foi exatamente o bug: buscava no Pexels pelo texto do
// tema, e o resultado não tinha nada a ver).
//
// O sinal que separa "aqui é foto" de "aqui é banda de texto/design plano" NÃO
// pode ser desvio-padrão simples: um título grande e nítido sobre fundo liso
// (preto puro numa letra, branco puro no resto) gera desvio-padrão tão alto
// quanto uma foto de verdade, mesmo a letra ocupando uma fração pequena da
// área. O que separa de verdade é QUANTO DA ÁREA foge da cor dominante do
// bloco: numa foto, quase todo pixel varia; numa banda de texto, só a fina
// linha da letra varia — o resto é fundo parado.

const sharp = require('sharp');

const LARGURA_ANALISE = 200;     // resolução baixa só pra medir textura — rápido
const BLOCOS = 36;               // fatias horizontais/verticais analisadas
const DIF_MINIMA = 18;           // (0-255) o quanto um pixel precisa fugir da cor dominante do bloco
const FRACAO_MINIMA = 0.32;      // fração de pixels "fora do padrão" pra contar como bloco de foto
const TOLERANCIA_GAP = 1;        // blocos isolados abaixo do limiar não quebram a faixa
const RAZAO_MINIMA = 0.15;       // faixa menor que isso do total não vale como foto de fundo

// ── Estatística de um bloco (linha ou coluna) via histograma ──────────────────
// Acha a cor dominante do bloco (o valor mais frequente — não a média, que um
// texto preto-no-branco puxa pro meio) e mede que fração dos pixels foge dela.
function estatisticaBloco(amostrar, total, difMinima) {
  const hist = new Uint32Array(256);
  amostrar(v => { hist[v]++; });

  let moda = 0, maiorContagem = -1;
  for (let v = 0; v < 256; v++) {
    if (hist[v] > maiorContagem) { maiorContagem = hist[v]; moda = v; }
  }

  let fora = 0;
  for (let v = 0; v < 256; v++) {
    if (Math.abs(v - moda) > difMinima) fora += hist[v];
  }
  return total ? fora / total : 0;
}

// ── Perfil de textura por faixa horizontal ────────────────────────────────────
// Recebe pixels em escala de cinza (1 canal) já em baixa resolução e devolve,
// para cada bloco de linhas, a fração de pixels que fogem da cor dominante.
function perfilDeTextura(data, info, blocos = BLOCOS, difMinima = DIF_MINIMA) {
  const { width, height } = info;
  const linhasPorBloco = Math.max(1, Math.floor(height / blocos));
  const perfil = [];

  for (let b = 0; b * linhasPorBloco < height; b++) {
    const y0 = b * linhasPorBloco;
    const y1 = Math.min(height, y0 + linhasPorBloco);
    const total = (y1 - y0) * width;
    const fracao = estatisticaBloco(fn => {
      for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) fn(data[y * width + x]);
    }, total, difMinima);
    perfil.push({ y0, y1, fracao });
  }
  return perfil;
}

// Mesma ideia, por COLUNA — usada pra aparar margem lateral dentro da faixa
// vertical já encontrada (design com foto centralizada e barras nas laterais).
function perfilDeTexturaColunas(data, info, blocos = BLOCOS, difMinima = DIF_MINIMA) {
  const { width, height } = info;
  const colsPorBloco = Math.max(1, Math.floor(width / blocos));
  const perfil = [];

  for (let b = 0; b * colsPorBloco < width; b++) {
    const x0 = b * colsPorBloco;
    const x1 = Math.min(width, x0 + colsPorBloco);
    const total = height * (x1 - x0);
    const fracao = estatisticaBloco(fn => {
      for (let y = 0; y < height; y++) for (let x = x0; x < x1; x++) fn(data[y * width + x]);
    }, total, difMinima);
    perfil.push({ x0, x1, fracao });
  }
  return perfil;
}

// Acha a maior faixa contínua de blocos "com textura de foto", tolerando
// alguns blocos abaixo do limiar isolados no meio (uma linha fina de texto
// sobre a própria foto não deveria partir a faixa em dois pedaços).
function maiorFaixaTexturizada(perfil, limiar = FRACAO_MINIMA, maxGap = TOLERANCIA_GAP) {
  const ativo = perfil.map(p => p.fracao >= limiar);
  let melhor = null, inicio = -1, ultimoOn = -1;
  for (let i = 0; i < ativo.length; i++) {
    if (ativo[i]) {
      if (inicio < 0) inicio = i;
      ultimoOn = i;
    } else if (inicio >= 0 && i - ultimoOn > maxGap) {
      if (!melhor || ultimoOn - inicio > melhor.fim - melhor.inicio) melhor = { inicio, fim: ultimoOn };
      inicio = -1;
    }
  }
  if (inicio >= 0 && (!melhor || ultimoOn - inicio > melhor.fim - melhor.inicio)) melhor = { inicio, fim: ultimoOn };
  return melhor;
}

/**
 * Acha a região da FOTO dentro do print, em coordenadas da imagem original.
 * Devolve null quando a tela não tem foto de verdade (card de texto puro,
 * fundo de gradiente) — nesse caso não faz sentido forçar nada.
 *
 * @param {Buffer} buffer  imagem original (qualquer tamanho)
 * @returns {Promise<{top: number, left: number, width: number, height: number}|null>}
 */
async function localizarFoto(buffer) {
  const { data, info } = await sharp(buffer)
    .resize({ width: LARGURA_ANALISE, withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const perfil = perfilDeTextura(data, info);
  const faixa = maiorFaixaTexturizada(perfil);
  if (!faixa) return null;

  const alturaFaixa = perfil[faixa.fim].y1 - perfil[faixa.inicio].y0;
  if (alturaFaixa / info.height < RAZAO_MINIMA) return null;

  // Volta pra coordenadas da imagem ORIGINAL (a análise rodou em baixa resolução).
  const meta = await sharp(buffer).metadata();
  const escala = meta.height / info.height;
  const top = Math.round(perfil[faixa.inicio].y0 * escala);
  const altura = Math.round(alturaFaixa * escala);

  // Aparo lateral: dentro da faixa vertical, tira margem lisa dos dois lados
  // (design com foto centralizada e faixas brancas/pretas nas bordas).
  const { left, width } = await apararMargensLaterais(buffer, meta, top, altura);

  return { top, left, width, height: altura };
}

async function apararMargensLaterais(buffer, meta, top, altura) {
  const largaoOriginal = meta.width;
  try {
    const { data, info } = await sharp(buffer)
      .extract({ left: 0, top, width: largaoOriginal, height: Math.max(1, altura) })
      .resize({ width: LARGURA_ANALISE, withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const perfil = perfilDeTexturaColunas(data, info);
    const faixa = maiorFaixaTexturizada(perfil);
    if (!faixa) return { left: 0, width: largaoOriginal };

    const escala = largaoOriginal / info.width;
    const left = Math.round(perfil[faixa.inicio].x0 * escala);
    const width = Math.round((perfil[faixa.fim].x1 - perfil[faixa.inicio].x0) * escala);
    // Aparo pequeno demais não vale o risco de cortar foto de verdade.
    if (width / largaoOriginal < 0.5) return { left: 0, width: largaoOriginal };
    return { left, width };
  } catch {
    return { left: 0, width: largaoOriginal };
  }
}

/**
 * Extrai a foto de dentro do print, já cortada, em resolução ORIGINAL (não a de
 * análise). Devolve null quando não há foto de verdade na tela.
 *
 * @param {Buffer} buffer
 * @returns {Promise<Buffer|null>}
 */
async function extrairFotoDaTela(buffer) {
  const regiao = await localizarFoto(buffer);
  if (!regiao) return null;
  try {
    const meta = await sharp(buffer).metadata();
    // O arredondamento entre a resolução de análise e a original pode passar
    // por 1-2px do limite real — sharp.extract() rejeita a região inteira
    // nesse caso, então trava aqui em vez de perder a foto por causa disso.
    const left = Math.max(0, Math.min(regiao.left, meta.width - 1));
    const top = Math.max(0, Math.min(regiao.top, meta.height - 1));
    const width = Math.max(1, Math.min(regiao.width, meta.width - left));
    const height = Math.max(1, Math.min(regiao.height, meta.height - top));
    return await sharp(buffer).extract({ left, top, width, height }).toBuffer();
  } catch {
    return null;
  }
}

// Versão compacta pra transportar entre requisições (a foto lida em /ler-tela
// precisa voltar ao servidor em /clonar — comprime pra caber tranquilo dentro
// do limite de corpo da Vercel mesmo com várias telas).
const LARGURA_TRANSPORTE = 900;
async function fotoParaTransporte(buffer) {
  return sharp(buffer)
    .resize({ width: LARGURA_TRANSPORTE, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

module.exports = {
  extrairFotoDaTela,
  fotoParaTransporte,
  // exportados para teste
  perfilDeTextura,
  perfilDeTexturaColunas,
  maiorFaixaTexturizada,
  localizarFoto,
};
