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
// Frases da matéria (para achar o trecho real quando a IA parafraseia).
const STOPW = new Set('a o e de da do das dos em no na nos nas um uma uns umas que com por para pelo pela pelos pelas se ao aos as os ou mais menos foi sao ser como sobre entre ate'.split(' '));
const conteudo = (s) => norm(s).replace(/[^a-z0-9%,. ]/g, ' ').split(/\s+/).map((w) => w.replace(/^[.,]+|[.,]+$/g, '')).filter((w) => w.length > 2 && !STOPW.has(w));
function frasesDe(texto) { return String(texto || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"“])/).map((x) => x.trim()).filter((x) => x.length >= 20); }
// Acha a frase (ou par de frases seguidas) da matéria que sustenta o trecho: mesmos números e ≥ 70% das palavras.
function acharTrecho(trecho, texto, frases) {
  const alvo = conteudo(trecho); if (alvo.length < 4) return null;
  const nums = M.extrairNumeros(`${trecho} ${texto}`).filter(M.exigeOrigem).map((n) => n.valor);
  let melhor = null;
  for (let i = 0; i < frases.length; i++) {
    for (const cand of [frases[i], frases[i] + ' ' + (frases[i + 1] || '')]) {
      const ws = new Set(conteudo(cand));
      const cobre = alvo.filter((w) => ws.has(w)).length / alvo.length;
      const vals = M.extrairNumeros(cand).map((n) => n.valor);
      if (cobre >= 0.7 && nums.every((v) => vals.some((x) => M.igual(x, v))) && (!melhor || cobre > melhor.cobre || (cobre === melhor.cobre && cand.length < melhor.frase.length))) melhor = { frase: cand.trim(), cobre };
    }
  }
  return melhor ? melhor.frase : null;
}

function verificarFatos(fatos, textoFonte) {
  const corpo = norm(textoFonte); const frases = frasesDe(textoFonte);
  const ok = []; const descartados = [];
  (Array.isArray(fatos) ? fatos : []).slice(0, 14).forEach((f, i) => {
    let trecho = String(f?.trecho || '').trim();
    const texto = String(f?.texto || '').trim();
    if (!trecho || !texto) return descartados.push({ id: f?.id, motivo: 'sem trecho ou sem texto' });
    if (trecho.length < 20 || !corpo.includes(norm(trecho))) {
      const real = acharTrecho(trecho, texto, frases);
      if (!real) return descartados.push({ id: f?.id, motivo: 'o trecho não está no texto da matéria' });
      trecho = real; // guarda a frase REAL da matéria como prova, não a paráfrase da IA
    }
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

// Régua de forma por formato. estatico: 1 slide (ou 2) e a legenda é o post; ensaio: blocos de texto corrido, sem foto.
const LEGENDA_ESTATICO = { min: 600, max: 1500, paragrafos_min: 4, paragrafos_max: 7 };
const ENSAIO = { min: 700, max: 1100, folga: 150, telas_min: 4, telas_max: 6 }; // folga: a IA erra a contagem de caracteres para mais ou para menos
const paragrafosDe = (txt) => String(txt || '').split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);

// Checa um roteiro (capa + telas + legenda) contra os fatos verificados. Devolve { ok, problemas[] }.
function checarRoteiro(r, fatos, { formato = 'reportagem', opiniao = false } = {}) {
  const problemas = [];
  const permitidos = permitidosDe(fatos);
  const telas = Array.isArray(r?.telas) ? r.telas : [];
  const estatico = formato === 'estatico'; const ensaio = formato === 'ensaio';
  const maxCapa = estatico ? 10 : 14;
  if (!r?.capa || palavras(r.capa) > maxCapa) problemas.push(`Capa ausente ou longa demais (${palavras(r?.capa)} palavras; máximo ${maxCapa}).`);
  if (estatico) {
    if (telas.length > 1) problemas.push(`O post estático tem ${telas.length} telas além da capa; no máximo 1 (o "virar").`);
    const leg = String(r?.legenda || ''); const n = leg.length; const ps = paragrafosDe(leg).length;
    if (n < LEGENDA_ESTATICO.min || n > LEGENDA_ESTATICO.max) problemas.push(`A legenda tem ${n} caracteres; o post estático pede de ${LEGENDA_ESTATICO.min} a ${LEGENDA_ESTATICO.max} (é o corpo do post).`);
    if (ps < LEGENDA_ESTATICO.paragrafos_min || ps > LEGENDA_ESTATICO.paragrafos_max) problemas.push(`A legenda tem ${ps} parágrafos; use de ${LEGENDA_ESTATICO.paragrafos_min} a ${LEGENDA_ESTATICO.paragrafos_max}, curtos.`);
    if (!/\b(manda|mande|envia|envie|marca|marque|compartilha|compartilhe)\b/i.test(leg)) problemas.push('A legenda não pede para mandar ou marcar alguém no fim.');
  } else if (ensaio) {
    if (telas.length < ENSAIO.telas_min || telas.length > ENSAIO.telas_max) problemas.push(`O ensaio tem ${telas.length} blocos; use de ${ENSAIO.telas_min} a ${ENSAIO.telas_max} (a abertura e o fechamento são à parte).`);
    const total = [r?.capa, ...telas.map((t) => t.texto), r?.fechamento?.titulo, r?.fechamento?.texto].map((x) => String(x || '').replace(/\*\*/g, '')).join(' ').length;
    if (total < ENSAIO.min - ENSAIO.folga || total > ENSAIO.max + ENSAIO.folga) problemas.push(`O ensaio tem ${total} caracteres no total; escreva de ${ENSAIO.min} a ${ENSAIO.max}.`);
    telas.forEach((t, i) => { const ps = paragrafosDe(t.texto).length; if (ps < 1 || ps > 3) problemas.push(`bloco ${i + 2}: ${ps} parágrafos (use 2 a 3, curtos).`); });
    if (!r?.fechamento?.titulo) problemas.push('Falta a frase de ouro do fechamento ("fechamento.titulo").');
  } else if (telas.length < 4 || telas.length > 8) problemas.push(`O carrossel tem ${telas.length} telas de conteúdo; use de 4 a 8 (a capa e o fechamento são à parte).`);
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
    const maxPal = ensaio ? 70 : estatico ? 26 : 45; // ensaio: 2–3 parágrafos curtos por bloco; estático: uma ideia no "virar"
    if (n > maxPal) problemas.push(`tela ${i + 2}: ${n} palavras (máximo ${maxPal}). Corte.`);
    if (['rep_comparacao', 'rep_numero'].includes(t.layout) && !(t.fatos || []).length) problemas.push(`tela ${i + 2}: prova sem fato ligado (fatos: ["f1"…]).`);
    if (t.layout === 'rep_comparacao' && !(t.dados?.esquerda?.valor && t.dados?.direita?.valor)) problemas.push(`tela ${i + 2}: comparação sem os dois valores.`);
    if (t.layout === 'rep_numero' && !t.dados?.numero?.valor) problemas.push(`tela ${i + 2}: número gigante sem o número.`);
  });
  if (!estatico) {
    if (!telas.some((t) => t.papel === 'leitura')) problemas.push(ensaio ? 'Falta o bloco com a leitura do Pedro (papel "leitura").' : 'Falta a tela com a leitura do Pedro (papel "leitura").');
    if (!opiniao && !telas.some((t) => ['rep_comparacao', 'rep_numero'].includes(t.layout) || t.papel === 'prova')) problemas.push(ensaio ? 'Falta um bloco de prova com número dos fatos.' : 'Falta uma tela de prova com número ou dado.');
  }
  const cop = HG.verificar(r?.capa || '', { contra: [] });
  if (!cop.ok) problemas.push(`Capa: ${cop.motivo}`);
  return { ok: problemas.length === 0, problemas: [...new Set(problemas)] };
}

module.exports = { verificarFatos, checarRoteiro, textosDaTela, variacao, norm, palavras, semDatas, numerosSemFonte, paragrafosDe, LEGENDA_ESTATICO, ENSAIO };
