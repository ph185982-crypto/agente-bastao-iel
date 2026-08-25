// ── Leitura de carrossel a partir dos prints (sem IA) ─────────────────────────
// Cada print é UMA tela do carrossel. Daqui sai o título e o corpo de cada tela,
// para serem remontados no nosso formato (nossa fonte, nossa paleta, nosso CTA).
//
// O texto sai igual ao do post original de propósito: sem IA não há como
// reescrever sem inventar, e inventar fato é pior que repetir. O que muda é a
// embalagem — e o CTA, que passa a apontar para o nosso perfil.

const { ehChrome } = require('./lerPrint');
const { gerarCarrossel } = require('./roboCopy');

// Lixo que aparece dentro da tela do carrossel (do post original ou do app),
// além do que ehChrome() já cobre: contador de telas, seta de arrastar, pontos
// de paginação e a marca d'água do autor.
const CHROME_CARROSSEL = [
  /^\d{1,2}\s*[\/|de]{1,2}\s*\d{1,2}$/i,          // "3/8", "3 de 8"
  /^(arrasta|arraste|swipe|deslize)\b/i,
  /^[→>»▶←‹›•·…]+$/,
  /^(continua|cont\.)$/i,
  /^[A-Z]{1,3}$/,                                  // letra solta que a OCR inventa
  // Marca d'água do autor, carimbada em toda tela do carrossel. O arroba é o
  // caractere que a OCR mais erra, então aceita as formas que ela costuma dar.
  /^[@©O0]\s?[a-z0-9._]{3,30}$/i,
];

// Contador e seta ficam nas duas pontas da MESMA linha ("1/4    ARRASTA >>>"),
// então filtrar a linha inteira não resolve: é preciso arrancar os pedaços e ver
// o que sobra. Sem isso o contador entra no corpo do texto.
const PEDACOS_CHROME = [
  /\b\d{1,2}\s*\/\s*\d{1,2}\b/g,
  /\b(arrasta|arraste|swipe|deslize)\b[^\S\n]*[>»→]*/gi,
  /[>»→‹«←]{2,}/g,
];

function tirarPedacosChrome(linha) {
  let s = String(linha || '');
  for (const re of PEDACOS_CHROME) s = s.replace(re, ' ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// A OCR inventa fragmentos onde há fundo com textura ou ícone ("o o ” o",
// "” [e]"). Texto de verdade tem pelo menos uma palavra com 3+ letras.
function ehRuidoDeOcr(linha) {
  const s = String(linha || '').trim();
  if (!s) return true;
  const letras = (s.match(/\p{L}/gu) || []).length;
  if (letras < 3) return true;
  if (letras / s.length < 0.5) return true;
  return !/\p{L}{3,}/u.test(s);
}

function ehChromeCarrossel(linha) {
  const s = String(linha || '').trim();
  if (!s) return true;
  if (ehChrome(s)) return true;
  if (CHROME_CARROSSEL.some(re => re.test(s))) return true;
  // Sobrou algo depois de arrancar contador e seta? Se não, era só interface.
  return !tirarPedacosChrome(s);
}

// Limpa uma linha para uso: tira os pedaços de interface e devolve vazio se o
// que restou for ruído.
function limparLinha(linha) {
  const s = tirarPedacosChrome(linha);
  return ehRuidoDeOcr(s) ? '' : s;
}

// A última tela do carrossel original é o CTA dele — pedindo pra seguir o perfil
// do autor. Esse texto não é aproveitado: no lugar entra o nosso.
function pareceCta(texto) {
  const t = String(texto || '').toLowerCase();
  const pedidos = /(segue|siga|seguir|salva|salve|compartilha|comenta|marca alguém|follow)/;
  return pedidos.test(t) && t.length < 400;
}

function blocos(texto) {
  const out = [];
  let atual = [];
  for (const linha of String(texto || '').split('\n')) {
    if (!linha.trim()) {
      if (atual.length) { out.push(atual.join(' ').replace(/\s{2,}/g, ' ').trim()); atual = []; }
    } else if (!ehChromeCarrossel(linha)) {
      const limpa = limparLinha(linha);
      if (limpa) atual.push(limpa);
    }
  }
  if (atual.length) out.push(atual.join(' ').replace(/\s{2,}/g, ' ').trim());
  return out.filter(Boolean);
}

// ── Título pela altura da letra ───────────────────────────────────────────────
// Numa tela de carrossel o título é desenhado bem maior que o corpo. Essa
// diferença é o sinal mais confiável que existe aqui: sobrevive quando não há
// linha em branco separando os dois, que é o caso comum.
const FATOR_TITULO = 1.25;   // quanto a linha precisa ser mais alta que o corpo

// Mediana inferior: com número par de linhas, fica com o valor de baixo. Numa
// tela de duas linhas (título + corpo), a mediana superior devolveria a altura
// do TÍTULO como base — e aí nada passaria do corte, a tela sairia sem título.
function medianaAltura(alturas) {
  if (!alturas.length) return 0;
  const ord = [...alturas].sort((a, b) => a - b);
  return ord[Math.floor((ord.length - 1) / 2)];
}

function separarPorAltura(linhas) {
  const uteis = linhas
    .map(l => ({ ...l, texto: ehChromeCarrossel(l.texto) ? '' : limparLinha(l.texto) }))
    .filter(l => l.texto);
  if (!uteis.length) return null;

  // A mediana representa o corpo, que é a maior parte das linhas.
  const base = medianaAltura(uteis.map(l => l.altura));
  if (!base) return null;

  // Título: as primeiras linhas seguidas que são visivelmente maiores.
  let fim = 0;
  while (fim < uteis.length && uteis[fim].altura >= base * FATOR_TITULO) fim++;

  // Nenhuma linha se destaca (tela só de corpo, ou fonte toda do mesmo tamanho):
  // devolve null para o chamador cair na heurística de texto.
  if (fim === 0 || fim === uteis.length) return null;

  const title = uteis.slice(0, fim).map(l => l.texto).join(' ').replace(/\s{2,}/g, ' ').trim();
  const body = uteis.slice(fim).map(l => l.texto).join(' ').replace(/\s{2,}/g, ' ').trim();
  return { title, body };
}

const MAX_PALAVRAS_TITULO = 12;

/**
 * Separa o texto lido de UMA tela em título e corpo. Função pura — é o que os
 * testes cobrem.
 *
 * @param {string|{linhas: Array, text: string}} entrada
 *   Texto cru da OCR, ou o resultado de lerLinhas() — que traz a altura de cada
 *   linha e permite achar o título pelo tamanho da letra, bem mais confiável.
 * @returns {{title: string, body: string, ehCta: boolean}}
 */
function separarTelaDeCarrossel(entrada) {
  const linhas = typeof entrada === 'object' && Array.isArray(entrada?.linhas) ? entrada.linhas : null;
  // O texto cru é o plano B. Quando só vieram as linhas, ele é montado a partir
  // delas — senão a tela sairia vazia se a separação por altura não decidir.
  const textoOcr = typeof entrada === 'string'
    ? entrada
    : (entrada?.text || (linhas || []).map(l => l.texto).join('\n'));

  // Caminho bom: altura da letra decide o que é título.
  if (linhas) {
    const porAltura = separarPorAltura(linhas);
    if (porAltura && porAltura.title && porAltura.body) {
      return { ...porAltura, ehCta: pareceCta(`${porAltura.title} ${porAltura.body}`) };
    }
  }

  const partes = blocos(textoOcr);
  if (!partes.length) return { title: '', body: '', ehCta: false };

  const tudo = partes.join(' ');
  const ehCta = pareceCta(tudo);

  // Caso comum: o título vem sozinho num bloco e o corpo abaixo.
  if (partes.length > 1 && partes[0].split(/\s+/).length <= MAX_PALAVRAS_TITULO) {
    return { title: partes[0], body: partes.slice(1).join(' ').trim(), ehCta };
  }

  // Bloco único: a primeira frase vira título, o resto é corpo. É como as telas
  // são escritas — uma afirmação curta e depois a explicação.
  const m = partes[0].match(/^(.{3,120}?[.!?:])\s+(.*)$/s);
  if (m) {
    const [, primeira, resto] = m;
    const corpo = [resto, ...partes.slice(1)].join(' ').trim();
    return { title: primeira.trim(), body: corpo, ehCta };
  }

  // Não deu pra separar: tudo vira título se for curto, senão tudo vira corpo
  // e o título fica pro chamador resolver (ele mostra pro autor editar).
  const palavras = partes[0].split(/\s+/);
  if (palavras.length <= MAX_PALAVRAS_TITULO) {
    return { title: partes[0], body: partes.slice(1).join(' ').trim(), ehCta };
  }
  return {
    title: palavras.slice(0, MAX_PALAVRAS_TITULO).join(' '),
    body: partes.join(' ').trim(),
    ehCta,
  };
}

/**
 * Monta o carrossel no NOSSO formato a partir das telas lidas dos prints.
 * Mantém o texto do original e troca a embalagem: a última tela vira o nosso
 * CTA, apontando para o nosso perfil em vez do perfil de origem.
 *
 * @param {object}   opts
 * @param {Array}    opts.telas     [{title, body, ehCta}] na ordem do carrossel
 * @param {string}   opts.handle    @ de quem vai publicar
 * @param {string}   opts.tema      assunto, usado nas hashtags e na busca de foto
 * @param {string}   opts.caption   legenda lida do print do post (opcional)
 * @param {number}   opts.variante  muda o sorteio do CTA e da legenda
 */
function montarCarrosselDoPrint({ telas = [], handle = '@pedro_destrava', tema, caption, variante = 0 } = {}) {
  const uteis = telas.filter(t => (t.title || t.body || '').trim());
  if (!uteis.length) return null;

  // A tela de CTA do autor original não é copiada — o nosso entra no lugar.
  const semCta = uteis.filter((t, i) => !(t.ehCta && i >= uteis.length - 2));
  const corpo = semCta.length ? semCta : uteis;

  const assunto = tema || corpo[0]?.title || '';
  // O robô entra só para o que é NOSSO: o CTA final e o fecho da legenda.
  const molde = gerarCarrossel({
    topic: assunto,
    slideCount: 5,
    handle,
    variante,
    marcadores: false,
  });

  const capa = corpo[0];
  const meio = corpo.slice(1);

  const slides = [
    {
      kind: 'cover',
      title: capa.title || capa.body || assunto,
      subtitle: capa.title && capa.body ? capa.body : molde.slides[0].subtitle,
      // A foto vem do PRINT dessa mesma tela — não é buscada em banco nenhum.
      // undefined quando a tela não tinha foto de verdade (card de texto puro).
      foto: capa.foto || null,
    },
    ...meio.map((t, i) => ({
      kind: 'content',
      number: String(i + 1).padStart(2, '0'),
      title: t.title || `Ponto ${i + 1}`,
      body: t.body || t.title || '',
      foto: t.foto || null,
    })),
    molde.slides[molde.slides.length - 1], // nosso CTA, com o nosso handle — sem foto, é sempre o template
  ];

  // Legenda: a do post original quando o print dela veio junto; senão a do robô.
  // O fecho é sempre nosso. O CTA sai da tela de CTA, não do fecho da legenda:
  // só a tela garante o handle (nem todo fecho sorteado cita o perfil), e o
  // handle é justamente o que não pode faltar aqui.
  const ctaLegenda = molde.slides[molde.slides.length - 1].body;
  const linhasMolde = molde.caption.split('\n').filter(l => l.trim());
  const tags = linhasMolde[linhasMolde.length - 1] || '';

  let legenda;
  if (caption && caption.trim()) {
    legenda = [caption.trim(), '', ctaLegenda, '', tags].join('\n').trim();
  } else {
    legenda = molde.caption.includes(handle)
      ? molde.caption
      : [molde.caption, '', ctaLegenda].join('\n').trim();
  }

  return {
    topic: assunto,
    caption: legenda,
    slides,
    fonte: 'print',
    telasLidas: uteis.length,
    ctaTrocado: corpo.length !== uteis.length,
  };
}

module.exports = {
  separarTelaDeCarrossel,
  montarCarrosselDoPrint,
  // exportados para teste
  ehChromeCarrossel,
  pareceCta,
};
