// Conferência por leitura da imagem (OCR): depois que a arte é desenhada, lê o PNG e confere se os textos e,
// principalmente, os NÚMEROS que deveriam estar lá estão lá. Serve de rede de segurança para o modo híbrido
// (fundo feito por IA, texto desenhado pelo código): se a leitura não achar um número exato, a arte não passa.
//
// Regras:
//  - Número é comparado de forma EXATA depois de normalizar: dígitos, separadores (, .), sinal (+ −), %, e a
//    unidade colada (mil, bi, mi, milhões...). "52,3 bi" ≠ "52,8 bi" ≠ "52,3 mi" ≠ "−52,3 bi" se o esperado era "+".
//  - Palavra com 5 letras ou mais tolera UMA troca/falta/sobra de letra (a OCR erra acento e letra colada).
//  - Palavra curta (até 4 letras) não é cobrada sozinha: a OCR erra demais e isso só geraria alarme falso.
//  - Frase sem número e sem palavra de 5+ letras não tem como ser conferida: vai em `nao_verificaveis`, não em `faltando`.
// O OCR é o Tesseract que já roda no servidor (lerPrint.js); injetável para teste.

const UNIDADES = ['mil', 'bi', 'mi', 'bilhoes', 'bilhao', 'milhoes', 'milhao', 'pib', '%'];

function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[   ]/g, ' ')
    .replace(/[−‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai as entidades numéricas já normalizadas: sinal + dígitos/separadores + unidade colada.
// O sinal só conta quando vem depois de espaço (ou do começo) e logo antes de "r$" ou do número, para não
// confundir com hífen de intervalo ("2022-2024").
const RE_NUMERO = /(?:(^|\s)([+-])\s?)?(?:r\$\s?)?(\d(?:[\d.,]*\d)?)(?:\s?(%|mil\b|bi\b|mi\b|bilhoes?\b|bilhao\b|milhoes?\b|milhao\b|pib\b))?/g;

function numeros(textoNormalizado) {
  const achados = [];
  const t = textoNormalizado;
  RE_NUMERO.lastIndex = 0;
  let m;
  while ((m = RE_NUMERO.exec(t))) {
    const sinal = m[2] || '';
    const unidade = m[4] || '';
    achados.push(`${sinal}${m[3]}${unidade ? ` ${unidade}` : ''}`);
    if (m.index === RE_NUMERO.lastIndex) RE_NUMERO.lastIndex++;
  }
  return achados;
}

function semNumeros(textoNormalizado) {
  return textoNormalizado.replace(RE_NUMERO, ' ');
}

function palavras(textoNormalizado) {
  return semNumeros(textoNormalizado).split(/[^a-z]+/).filter(Boolean);
}

// Distância de edição limitada: devolve true se for <= 1.
function distanciaAte1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);   // troca de uma letra
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);          // sobra uma letra em a
  return b.slice(i + 1) === a.slice(i);                                    // falta uma letra em a
}

async function ocrPadrao(png) {
  const { lerTexto } = require('./lerPrint');
  const r = await lerTexto(png);
  return r.text;
}

/**
 * @param {Buffer} png
 * @param {string[]} esperados  frases/valores que devem aparecer na arte
 * @param {{ocr?: (png:Buffer)=>Promise<string>|string}} [opcoes]
 * @returns {Promise<{ok:boolean, faltando:string[], detalhes:object[], nao_verificaveis:string[], lido:string}>}
 */
async function conferirTexto(png, esperados, { ocr } = {}) {
  const lidoCru = await (ocr || ocrPadrao)(png);
  const lido = normalizar(lidoCru);
  const numerosLidos = new Set(numeros(lido));
  const palavrasLidas = palavras(lido);
  const faltando = [];
  const detalhes = [];
  const naoVerificaveis = [];

  for (const esperado of esperados || []) {
    const e = normalizar(esperado);
    const nums = numeros(e);
    const pals = [...new Set(palavras(e).filter((p) => p.length >= 5))];
    if (!nums.length && !pals.length) { naoVerificaveis.push(esperado); continue; }
    const numFalta = nums.filter((n) => !numerosLidos.has(n));
    const palFalta = pals.filter((p) => !palavrasLidas.some((l) => distanciaAte1(p, l)));
    if (numFalta.length || palFalta.length) {
      faltando.push(esperado);
      detalhes.push({ esperado, numeros: numFalta, palavras: palFalta });
    }
  }
  return { ok: faltando.length === 0, faltando, detalhes, nao_verificaveis: naoVerificaveis, lido: String(lidoCru ?? '').trim() };
}

module.exports = { conferirTexto, normalizar, numeros, palavras, distanciaAte1, UNIDADES };
