// "A Conta Aberta": prova com números REAIS informados pelo Pedro, sem IA. Todas as contas
// (percentuais, margem, conferência de que os números fecham) são feitas aqui, em código.
//
// Integridade:
//  - o nome do cliente só entra se `cliente_autorizou` for verdadeiro; senão a prova sai anonimizada
//    e o nome nem chega a ser guardado no conteúdo;
//  - os valores vêm do Pedro (registros do cliente): ficam rotulados como informados, com a limitação
//    "não verificado de forma independente", e a legenda diz isso;
//  - se os números não fecham (faturamento − custos ≠ sobra), a prova NÃO é criada: o Pedro corrige;
//  - sem link da isca escolhida não há chamada final com promessa (a pendência aparece).
const M = require('../../static/contentModel');
const L = require('./leadMagnets');

const erro = (m) => Object.assign(new Error(m), { code: 'ENTRADA', status: 400 });
const num = (x) => Math.round(Number(x) * 100) / 100;
const brl = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 1, maximumFractionDigits: 1 })}%`;
const limpa = (s, max) => String(s ?? '').replace(/[<>*\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const CUSTOS = [['comissao', 'Comissão do canal'], ['frete', 'Frete'], ['imposto', 'Imposto'], ['ads', 'Anúncios'], ['outros', 'Outros custos']];

// Confere e normaliza a entrada. Lança erro claro em português.
function calcular(e = {}) {
  const fat = num(e.faturamento);
  if (!Number.isFinite(fat) || fat <= 0 || fat > 1e9) throw erro('Informe o faturamento bruto (maior que zero).');
  const periodo = limpa(e.periodo, 30);
  const canal = limpa(e.canal, 40);
  if (!periodo) throw erro('Informe o período (ex.: set/2026).');
  if (!canal) throw erro('Informe o canal de venda (ex.: Shopee).');
  const custos = {};
  for (const [k, nome] of CUSTOS) {
    const v = e[k] === undefined || e[k] === '' || e[k] === null ? 0 : num(e[k]);
    if (!Number.isFinite(v) || v < 0 || v > 1e9) throw erro(`${nome}: informe um valor válido (zero ou mais).`);
    custos[k] = v;
  }
  const totalCustos = num(Object.values(custos).reduce((a, b) => a + b, 0));
  const calculada = num(fat - totalCustos);
  let sobra = calculada; let sobraInformada = false;
  if (e.sobrou !== undefined && e.sobrou !== '' && e.sobrou !== null) {
    const info = num(e.sobrou);
    if (!Number.isFinite(info)) throw erro('Quanto sobrou: informe um valor válido.');
    if (Math.abs(info - calculada) > Math.max(1, fat * 0.005)) {
      throw erro(`Os números não fecham: ${brl(fat)} de faturamento − ${brl(totalCustos)} de custos = ${brl(calculada)}, mas você informou que sobraram ${brl(info)}. Corrija um dos valores (ou inclua o custo que falta em “Outros custos”).`);
    }
    sobraInformada = true;
  }
  const p = (v) => Math.round((v / fat) * 1000) / 10;
  const percentuais = Object.fromEntries(CUSTOS.filter(([k]) => custos[k] > 0).map(([k]) => [k, p(custos[k])]));
  const margem = p(sobra);
  const identificado = e.cliente_autorizou === true && limpa(e.cliente, 60).length >= 2;
  const avisos = [];
  if (!identificado && limpa(e.cliente, 60)) avisos.push('O nome do cliente foi omitido porque não há autorização marcada.');
  if (sobra < 0) avisos.push('A operação deu prejuízo: confira os valores antes de publicar.');
  return {
    periodo, canal, categoria: limpa(e.categoria, 40) || 'varejo', faturamento: fat, custos, total_custos: totalCustos, sobra, sobra_informada: sobraInformada,
    percentuais, margem, identificado, cliente: identificado ? limpa(e.cliente, 60) : null, avisos,
  };
}

const rotuloLoja = (c) => (c.identificado ? c.cliente : `Loja de ${c.categoria}`);

// Monta o conteúdo completo (texto, afirmações com evidência, slides, legenda). A arte é gerada depois, pelo editor.
function criar(entrada, { iscas = L.PADRAO, agora = new Date() } = {}) {
  const c = calcular(entrada);
  const isca = (iscas || []).find((x) => x.id === entrada?.isca_id) || null;
  const cta = isca ? L.chamada(isca) : { cta: '', falta: 'Escolha uma isca para a chamada final.' };

  const linhas = [`Período: ${c.periodo}`, `Canal: ${c.canal}`, `Faturamento bruto: ${brl(c.faturamento)}`];
  CUSTOS.forEach(([k, nome]) => { if (c.custos[k] > 0) linhas.push(`${nome}: ${brl(c.custos[k])}`); });
  linhas.push(`Sobrou: ${brl(c.sobra)}`);
  const fonteTexto = linhas.join('\n');

  const conteudo = M.novoConteudo({ titulo: `Conta aberta: ${rotuloLoja(c)}, ${c.canal}, ${c.periodo}`, origem: { tipo: 'texto', texto_bruto: fonteTexto, prova_cliente: true } });
  conteudo.fonte_principal = { tipo: 'dados_informados', url: null, titulo: 'Números reais informados à Avanteza', veiculo: 'Avanteza', dominio: null, origem: 'Registros do cliente (informados por Pedro)', texto: fonteTexto, publicada_em: agora.toISOString() };
  const consultada = agora.toISOString();
  const ev = (id, trecho) => ({ id, tipo: 'primaria', autoridade: 'primaria', correspondencia: 'integral', relacao: 'sustenta', grupo: 'g_cliente', via: 'informado', trecho, trecho_encontrado: true, origem: 'Registros do cliente (informados por Pedro)', titulo: 'Números informados pelo cliente', consultada_em: consultada, limitacoes: 'Informado pelo Pedro a partir dos registros do cliente; não verificado de forma independente.' });
  const evidencias = []; const claims = [];
  const claim = (id, texto, valores, evId, extra = {}) => {
    const k = { id, texto, tipo: extra.tipo || 'fato', natureza: 'dado', central: true, valores, evidencias: [evId], revisao: {}, ...extra };
    claims.push(k); return k;
  };
  const pe = c.periodo;
  evidencias.push(ev('e_fat', `Faturamento bruto: ${brl(c.faturamento)}`));
  claim('a_fat', `Faturamento bruto de ${brl(c.faturamento)} via ${c.canal} em ${pe}.`, [{ valor: c.faturamento, unidade: 'BRL', periodo: pe }], 'e_fat');
  const nomeDe = Object.fromEntries(CUSTOS);
  const ids = { comissao: 'a_comissao', frete: 'a_frete', imposto: 'a_imposto', ads: 'a_ads', outros: 'a_outros' };
  for (const [k] of CUSTOS) {
    if (!(c.custos[k] > 0)) continue;
    evidencias.push(ev(`e_${k}`, `${nomeDe[k]}: ${brl(c.custos[k])}`));
    claim(ids[k], `${nomeDe[k]} de ${brl(c.custos[k])} em ${pe}.`, [{ valor: c.custos[k], unidade: 'BRL', periodo: pe }], `e_${k}`);
    // Percentual do faturamento: calculado aqui, ligado às duas evidências de entrada.
    const pc = claim(`p_${k}`, `${nomeDe[k]} equivale a ${pct(c.percentuais[k])} do faturamento.`, [{ valor: c.percentuais[k], unidade: '%', periodo: pe }], `e_${k}`, { tipo: 'calculo', calculo: { formula: 'custo ÷ faturamento × 100', entradas: [{ nome: nomeDe[k], valor: c.custos[k], unidade: 'R$' }, { nome: 'Faturamento', valor: c.faturamento, unidade: 'R$' }], resultado: c.percentuais[k], periodo: pe, limites: 'Cálculo simples sobre números informados pelo cliente.' } });
    pc.evidencias = [`e_${k}`, 'e_fat'];
  }
  evidencias.push(ev('e_sobra', `Sobrou: ${brl(c.sobra)}`));
  claim('a_sobra', `Sobraram ${brl(c.sobra)} em ${pe}.`, [{ valor: c.sobra, unidade: 'BRL', periodo: pe }], 'e_sobra');
  const pm = claim('p_margem', `A sobra equivale a ${pct(c.margem)} do faturamento.`, [{ valor: c.margem, unidade: '%', periodo: pe }], 'e_sobra', { tipo: 'calculo', calculo: { formula: '(faturamento − custos) ÷ faturamento × 100', entradas: [{ nome: 'Faturamento', valor: c.faturamento, unidade: 'R$' }, { nome: 'Custos', valor: c.total_custos, unidade: 'R$' }], resultado: c.margem, periodo: pe, limites: 'Cálculo simples sobre números informados pelo cliente.' } });
  pm.evidencias = ['e_sobra', 'e_fat'];
  // O estado (sustentada etc.) vem das mesmas regras do resto da ferramenta, não é escrito à mão.
  claims.forEach((k) => { const r = M.avaliarAfirmacao(k, evidencias); k.estado = r.estado; k.motivo_estado = r.motivo; k.exige_atribuicao = r.exige_atribuicao; });
  conteudo.claims = claims; conteudo.evidencias = evidencias;

  // Slides
  const loja = rotuloLoja(c);
  const capa = `Vendeu ${brl(c.faturamento)} via ${c.canal}. Sobraram **${brl(c.sobra)}**.`;
  const slides = [
    { id: 's1', layout: 'capa_tipografica', funcao: 'capa', texto: capa, claim_ids: ['a_fat', 'a_sobra'] },
    { id: 's2', layout: 'explicacao', funcao: 'contexto', titulo: 'Os números são reais', texto: `${loja} vendeu ${brl(c.faturamento)} via ${c.canal} em ${pe}. Estes valores vêm dos registros do cliente, passados à Avanteza.`, claim_ids: ['a_fat'] },
    { id: 's3', layout: 'comparacao', funcao: 'comparacao', texto: `Sobrou **${pct(c.margem)}** de tudo que entrou.`, dados: { esquerda: { rotulo: 'Vendeu', valor: brl(c.faturamento), detalhe: `${c.canal}, ${pe}` }, direita: { rotulo: 'Sobrou', valor: brl(c.sobra), detalhe: 'depois de todos os custos' } }, fonte_linha: `Dados informados pelo cliente · ${pe}`, claim_ids: ['a_fat', 'a_sobra', 'p_margem'] },
  ];
  CUSTOS.filter(([k]) => c.custos[k] > 0).sort((a, b) => c.custos[b[0]] - c.custos[a[0]]).slice(0, 4).forEach(([k, nome], i) => {
    slides.push({ id: `s${4 + i}`, layout: 'explicacao', funcao: 'explicacao', titulo: nome, texto: `${brl(c.custos[k])} foram para ${nome.toLowerCase()}: **${pct(c.percentuais[k])}** do faturamento.`, claim_ids: [ids[k], `p_${k}`] });
  });
  if (cta.cta) slides.push({ id: `s${slides.length + 1}`, layout: 'encerramento', funcao: 'encerramento', texto: cta.cta, claim_ids: [] });

  const custosEmLinha = CUSTOS.filter(([k]) => c.custos[k] > 0).map(([k, nome]) => `${nome.toLowerCase()} ${brl(c.custos[k])} (${pct(c.percentuais[k])})`).join(', ');
  const legenda = [
    capa.replace(/\*\*/g, ''),
    '',
    `Números reais de ${c.identificado ? c.cliente : 'um cliente da Avanteza (nome omitido)'} via ${c.canal}, em ${pe}: faturamento ${brl(c.faturamento)}${custosEmLinha ? `, ${custosEmLinha}` : ''}. Sobrou ${brl(c.sobra)}, ou ${pct(c.margem)}.`,
    'Dados informados pelo cliente à Avanteza, sem auditoria independente. Cada operação tem custos diferentes: isto não é promessa de resultado.',
  ].join('\n');
  const idsLegenda = ['a_fat', 'a_sobra', 'p_margem', ...CUSTOS.filter(([k]) => c.custos[k] > 0).flatMap(([k]) => [ids[k], `p_${k}`])];

  M.criarVersao(conteudo, { estrutura: 'antes_depois', capas: [], capa_escolhida: null, slides, legenda, legenda_claim_ids: idsLegenda, cta: cta.cta, hashtags: [], formato: 'carrossel' }, { quem: 'sistema', rotulo: 'Conta aberta (calculada em código)' });
  conteudo.briefing = { assunto: `Conta aberta: ${loja}, ${c.canal}`, objetivo: 'autoridade', tese_tipo: 'explicacao', tese: 'Faturamento não é lucro: mostrar onde o dinheiro foi.', estrutura: 'antes_depois', formato: 'carrossel', duvidas: [] };
  conteudo.pipeline = Object.fromEntries(Object.keys(conteudo.pipeline).map((k) => [k, { estado: 'concluida' }]));
  conteudo.status = 'em_revisao';
  // Cada texto foi montado em código só com as afirmações ligadas acima: não há fato solto para conferir.
  // As entradas de auditoria dizem isso explicitamente (origem) e caem se o texto for editado depois.
  const va = M.versaoAtiva(conteudo);
  conteudo.auditoria_textos = Object.fromEntries(va.slides.map((sl) => [sl.id, { slide_id: sl.id, hash_texto: M.hash(M.textoParaAuditoria(sl)), premissas: [], origem: 'gerada_em_codigo', gerado_em: consultada }]));
  conteudo.auditoria_textos.legenda = { slide_id: 'legenda', hash_texto: M.hash(va.legenda), premissas: [], origem: 'gerada_em_codigo', gerado_em: consultada };
  conteudo.prova = { tipo: 'conta_aberta', identificado: c.identificado, canal: c.canal, periodo: pe, isca_id: isca ? isca.id : null, criada_em: consultada };

  const pendencias = [];
  if (cta.falta) pendencias.push({ id: 'chamada_final', texto: cta.falta });
  return { conteudo, resumo: { faturamento: c.faturamento, total_custos: c.total_custos, sobra: c.sobra, margem: c.margem, percentuais: c.percentuais, identificado: c.identificado, loja }, avisos: c.avisos, pendencias };
}

module.exports = { calcular, criar, CUSTOS, brl, pct };
