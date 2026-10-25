// Números em texto de notícia (inglês e português): US$ 1,2 milhão, $5M, 120k users, 1.200.000, 3x, 40%.
// Usado para conferir se o número de uma afirmação REALMENTE aparece no trecho citado, e para formatar o que vai para a tela.
const MULT = { k: 1e3, thousand: 1e3, mil: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, millions: 1e6, milhao: 1e6, milhoes: 1e6, b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9, bilhao: 1e9, bilhoes: 1e9, t: 1e12, trillion: 1e12, trilhao: 1e12, trilhoes: 1e12 };
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function parteNumerica(s) {
  let t = String(s).trim();
  const temPonto = t.includes('.'); const temVirg = t.includes(',');
  if (temPonto && temVirg) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');   // 1.234,56
    else t = t.replace(/,/g, '');                                                              // 1,234.56
  } else if (temVirg) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');             // 1,200,000 ou 1,5
  } else if (temPonto) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');                              // 1.200.000
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

const RE = /(US\$|U\$S|R\$|\$|€|£)?\s?(\d[\d.,]*\d|\d)\s?(%|percent|por cento|k\b|m\b|mm\b|mn\b|bn\b|b\b|x\b|thousand|millions?|billions?|trillions?|mil\b|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o|trilh[õo]es|trilh[ãa]o)?/gi;

function extrair(texto) {
  const t = String(texto || '').replace(/ /g, ' ');
  const out = []; let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(t))) {
    const base = parteNumerica(m[2]);
    if (base == null) continue;
    const suf = m[3] ? semAcento(m[3]).trim() : '';
    let valor = base; let tipo = 'quantidade';
    if (suf === '%' || suf === 'percent' || suf === 'por cento') tipo = 'percentual';
    else if (suf === 'x') tipo = 'multiplo';
    else if (MULT[suf]) valor = base * MULT[suf];
    const moeda = m[1] ? ({ 'US$': 'USD', 'U$S': 'USD', '$': 'USD', 'R$': 'BRL', '€': 'EUR', '£': 'GBP' }[m[1]] || null) : null;
    if (moeda) tipo = 'moeda';
    else if (tipo === 'quantidade' && Number.isInteger(valor) && valor >= 1900 && valor <= 2100 && !m[3]) tipo = 'ano';
    out.push({ raw: m[0].trim(), valor, tipo, moeda, indice: m.index });
  }
  return out;
}

const igual = (a, b) => (a === b) || Math.abs(a - b) <= Math.max(Math.abs(b) * 0.011, 0.005);
const aparece = (valor, texto) => extrair(texto).some((n) => igual(n.valor, valor));

// Valor para a tela, sempre em português: "US$ 5 milhões", "R$ 120 mil", "40 mil", "3,5x".
function formatar(valor, unidade) {
  if (valor == null || !Number.isFinite(valor)) return null;
  const abs = Math.abs(valor);
  const casa = (n, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  let corpo;
  if (abs >= 1e9) corpo = `${casa(valor / 1e9)} ${abs / 1e9 >= 2 ? 'bilhões' : 'bilhão'}`;
  else if (abs >= 1e6) corpo = `${casa(valor / 1e6)} ${abs / 1e6 >= 2 ? 'milhões' : 'milhão'}`;
  else if (abs >= 1e4) corpo = `${casa(valor / 1e3, 0)} mil`;
  else corpo = casa(valor, Number.isInteger(valor) ? 0 : 1);
  if (unidade === 'USD') return `US$ ${corpo}`;
  if (unidade === 'BRL') return `R$ ${corpo}`;
  if (unidade === 'EUR') return `€ ${corpo}`;
  if (unidade === 'GBP') return `£ ${corpo}`;
  if (unidade === '%') return `${casa(valor)}%`;
  if (unidade === 'x') return `${casa(valor)}x`;
  return corpo;
}

// Todo número com cara de dado (moeda, %, ano, ≥ 13 ou decimal) que aparece num texto de tela.
function numerosDeDado(texto) {
  return extrair(texto).filter((n) => n.tipo === 'moeda' || n.tipo === 'percentual' || n.tipo === 'ano' || n.tipo === 'multiplo' || n.valor >= 13 || !Number.isInteger(n.valor));
}

module.exports = { extrair, igual, aparece, formatar, numerosDeDado, parteNumerica, semAcento };
