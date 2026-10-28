// Checagem por código do carrossel "top": nada aqui depende da IA concordar consigo mesma.
//  - Fato só vale se o TRECHO citado está, palavra por palavra, no texto da matéria lida, e se todo número do fato está no trecho.
//  - Todo número que aparece no carrossel (títulos, textos, dados, faixa) tem de ser um número de fato verificado
//    (ou a variação exata entre os dois lados de uma comparação).
//  - Regras de forma: frases proibidas, "segundo X" repetido, tamanho de capa e de tela, prova com fonte.
const M = require('../../../static/contentModel');
const HG = require('../../../static/hookGuard');
const E = require('../../../static/editorial');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[“”"«»'’]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (s) => String(s || '').replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;

// Fatos devolvidos pela IA → só os verificáveis no texto. Cada número do fato precisa aparecer no trecho.
function verificarFatos(fatos, textoFonte) {
  const corpo = norm(textoFonte);
  const ok = []; const descartados = [];
  (Array.isArray(fatos) ? fatos : []).slice(0, 14).forEach((f, i) => {
    const trecho = String(f?.trecho || '').trim();
    const texto = String(f?.texto || '').trim();
    if (!trecho || !texto) return descartados.push({ id: f?.id, motivo: 'sem trecho ou sem texto' });
    if (trecho.length < 20 || !corpo.includes(norm(trecho))) return descartados.push({ id: f?.id, motivo: 'o trecho não está no texto da matéria' });
    const nTrecho = M.extrairNumeros(trecho).map((n) => n.valor);
    const soltos = M.extrairNumeros(texto).filter(M.exigeOrigem).filter((n) => !nTrecho.some((v) => M.igual(v, n.valor)));
    if (soltos.length) return descartados.push({ id: f?.id, motivo: `número fora do trecho: ${soltos.map((n) => n.raw).join(', ')}` });
    ok.push({ id: `f${ok.length + 1}`, id_ia: String(f.id || `f${i + 1}`), texto: texto.slice(0, 400), trecho: trecho.slice(0, 600), tipo: ['fato', 'declaracao', 'previsao', 'opiniao_de_terceiro'].includes(f.tipo) ? f.tipo : 'fato', quem: String(f.quem || '').slice(0, 80) || null, valores: nTrecho });
  });
  return { fatos: ok, descartados };
}

// Datas (27/10/2026, 27/10, out/2026, 27 de outubro de 2026) situam a fonte; não são afirmação numérica.
const MESES = '(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)';
function semDatas(txt) {
  return String(txt || '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+de\\s+${MESES}(?:\\s+de\\s+\\d{4})?`, 'gi'), ' ')
    .replace(new RegExp(`\\b${MESES}\\.?\\s*(?:\\/|de)\\s*\\d{4}\\b`, 'gi'), ' ')
    .replace(/#\S+/g, ' ');
}

function textosDaTela(t) {
  const d = t.dados || {};
  const lado = (l) => (l ? `${l.rotulo || ''} ${l.valor || ''} ${l.unidade || ''}` : '');
  return [t.titulo, t.texto, t.subtitulo, t.destaque, t.apoio, t.cta, t.cta_apoio, lado(d.esquerda), lado(d.direita), d.faixa ? `${d.faixa.valor || ''} ${d.faixa.texto || ''}` : '', d.numero ? `${d.numero.rotulo || ''} ${d.numero.valor || ''}` : ''].filter(Boolean).join(' \n ');
}

function variacao(d) {
  if (!d?.esquerda || !d?.direita) return null;
  const a = M.extrairNumeros(`${d.esquerda.valor} ${d.esquerda.unidade || ''}`)[0]; const b = M.extrairNumeros(`${d.direita.valor} ${d.direita.unidade || ''}`)[0];
  if (!a || !b || !(Math.abs(a.valor) > 0)) return null;
  return Math.abs((b.valor - a.valor) / a.valor * 100);
}

// Números de um texto que não estão nos fatos (ignora datas).
// Valores aceitos: os dos fatos e a mesma grandeza escrita abreviada ("R$ 9,293 tri" = 9.293 × 10^12; "239,4 bi").
function permitidosDe(fatos) {
  const base = fatos.flatMap((f) => f.valores);
  return [...base, ...base.flatMap((v) => [1e3, 1e6, 1e9, 1e12].map((m) => v / m).filter((x) => Math.abs(v) >= 1e3 && x >= 1 && x < 1000))];
}
function numerosSemFonte(texto, fatos) {
  const permitidos = permitidosDe(fatos);
  return M.extrairNumeros(semDatas(texto)).filter(M.exigeOrigem).filter((n) => !permitidos.some((v) => M.igual(v, n.valor)));
}

// Checa um roteiro (capa + telas + legenda) contra os fatos verificados. Devolve { ok, problemas[] }.
function checarRoteiro(r, fatos) {
  const problemas = [];
  const permitidos = permitidosDe(fatos);
  const telas = Array.isArray(r?.telas) ? r.telas : [];
  if (!r?.capa || palavras(r.capa) > 14) problemas.push(`Capa ausente ou longa demais (${palavras(r?.capa)} palavras; máximo 14).`);
  if (telas.length < 4 || telas.length > 8) problemas.push(`O carrossel tem ${telas.length} telas de conteúdo; use de 4 a 8 (a capa e o fechamento são à parte).`);
  const todos = [{ onde: 'capa', texto: r?.capa || '' }, ...telas.map((t, i) => ({ onde: `tela ${i + 2}`, texto: textosDaTela(t), t })), { onde: 'legenda', texto: r?.legenda || '' }];
  for (const x of todos) {
    for (const n of M.extrairNumeros(semDatas(x.texto)).filter(M.exigeOrigem)) {
      const ok = permitidos.some((v) => M.igual(v, n.valor)) || (n.tipo === 'percentual' && x.t && variacao(x.t.dados) != null && Math.abs(Math.abs(n.valor) - variacao(x.t.dados)) <= 0.15);
      if (!ok) problemas.push(`${x.onde}: o número “${n.raw}” não está em nenhum fato verificado da matéria.`);
    }
    for (const f of E.FRASES_PROIBIDAS || []) if (f.re && f.re.test(x.texto)) problemas.push(`${x.onde}: usa a expressão proibida “${f.rotulo}”.`);
  }
  const segundo = todos.filter((x) => x.onde !== 'legenda' && /\b([Ss]egundo|[Dd]e acordo com|[Cc]onforme)\s+(?:(?:o|a|os|as)\s+)?[A-ZÁÉÍÓÚ]/.test(x.texto)).length;
  if (segundo > 1) problemas.push(`“Segundo …” aparece em ${segundo} telas: cite a fonte só na tela de prova e na legenda.`);
  telas.forEach((t, i) => {
    const n = palavras(`${t.titulo || ''} ${t.texto || ''}`);
    if (n > 45) problemas.push(`tela ${i + 2}: ${n} palavras (máximo 45). Corte.`);
    if (['rep_comparacao', 'rep_numero'].includes(t.layout) && !(t.fatos || []).length) problemas.push(`tela ${i + 2}: prova sem fato ligado (fatos: ["f1"…]).`);
    if (t.layout === 'rep_comparacao' && !(t.dados?.esquerda?.valor && t.dados?.direita?.valor)) problemas.push(`tela ${i + 2}: comparação sem os dois valores.`);
    if (t.layout === 'rep_numero' && !t.dados?.numero?.valor) problemas.push(`tela ${i + 2}: número gigante sem o número.`);
  });
  if (!telas.some((t) => t.papel === 'leitura')) problemas.push('Falta a tela com a leitura do Pedro (papel "leitura").');
  if (!telas.some((t) => ['rep_comparacao', 'rep_numero'].includes(t.layout) || t.papel === 'prova')) problemas.push('Falta uma tela de prova com número ou dado.');
  const cop = HG.verificar(r?.capa || '', { contra: [] });
  if (!cop.ok) problemas.push(`Capa: ${cop.motivo}`);
  return { ok: problemas.length === 0, problemas: [...new Set(problemas)] };
}

module.exports = { verificarFatos, checarRoteiro, textosDaTela, variacao, norm, palavras, semDatas, numerosSemFonte };
