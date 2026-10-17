// Fontes PRIMÁRIAS abertas: Banco Central (SGS), IBGE (SIDRA) e Câmara dos
// Deputados. São APIs públicas dos próprios órgãos, sem chave. Cada resposta
// vira uma evidência com a URL exata consultada, o período, a unidade e a
// abrangência. Cálculos guardam a fórmula e as entradas.
const { safeFetch } = require('./safeFetch');
const { novaEvidencia } = require('./evidence');

// Séries que conferi na API (id, nome, unidade, periodicidade).
const SERIES_BCB = {
  433: { nome: 'IPCA, variação mensal', unidade: '% ao mês', periodicidade: 'mensal', abrangencia: 'Brasil' },
  1737: { nome: 'IPCA, número-índice (dez/1993 = 100)', unidade: 'pontos', periodicidade: 'mensal', abrangencia: 'Brasil' },
  1619: { nome: 'Salário mínimo vigente', unidade: 'R$ por mês', periodicidade: 'mensal', abrangencia: 'Brasil' },
  432: { nome: 'Meta Selic', unidade: '% ao ano', periodicidade: 'diária', abrangencia: 'Brasil' },
};

const ddmmaaaa = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

async function pegaJson(url, { fetcher = safeFetch, tentativas = 2, timeoutMs = 20000 } = {}) {
  let erro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetcher(url, { timeoutMs, accept: 'application/json', tipos: [/^application\/json/, /^text\/json/, /^text\/plain/] });
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      return { json: JSON.parse(r.corpo), url_final: r.url_final || url, consultada_em: r.acessada_em || new Date().toISOString() };
    } catch (e) { erro = e; }
  }
  throw new Error(`Fonte oficial indisponível agora (${erro.message}).`);
}

// Série do BCB num intervalo (datas ISO yyyy-mm-dd) ou os últimos N pontos.
async function serieBcb(codigo, { inicio, fim, ultimos, fetcher } = {}) {
  const meta = SERIES_BCB[codigo];
  if (!meta) throw new Error(`Série ${codigo} fora da lista conferida.`);
  const url = ultimos
    ? `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/${Number(ultimos)}?formato=json`
    : `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${ddmmaaaa(new Date(inicio))}&dataFinal=${ddmmaaaa(new Date(fim))}`;
  const { json, url_final, consultada_em } = await pegaJson(url, { fetcher });
  const pontos = (json || []).map((p) => ({ data: p.data, valor: Number(String(p.valor).replace(',', '.')) })).filter((p) => Number.isFinite(p.valor));
  return { meta, pontos, url: url_final, consultada_em };
}

const mesAno = (iso) => { const d = new Date(iso); return { aaaamm: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`, dd: `01/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` }; };

// Número-índice do IPCA num mês (YYYY-MM). Tenta o SIDRA (IBGE) e cai no BCB.
async function ipcaIndice(ym, { fetcher } = {}) {
  const [y, m] = ym.split('-');
  const aaaamm = `${y}${m}`;
  try {
    const url = `https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/${aaaamm}/f/n`;
    const { json, url_final, consultada_em } = await pegaJson(url, { fetcher });
    const linha = (json || []).find((l) => l.V && l.V !== 'Valor');
    if (linha && Number.isFinite(Number(linha.V))) {
      return { valor: Number(linha.V), fonte: 'IBGE SIDRA, tabela 1737 (IPCA), variável 2266', url: url_final, consultada_em, periodo: linha.D3N, via: 'api_ibge' };
    }
  } catch { /* tenta o BCB */ }
  const ini = new Date(`${y}-${m}-01T00:00:00Z`);
  const fim = new Date(Date.UTC(Number(y), Number(m), 0));
  const s = await serieBcb(1737, { inicio: ini.toISOString(), fim: fim.toISOString(), fetcher });
  if (!s.pontos.length) throw new Error(`Sem valor do IPCA para ${ym}.`);
  return { valor: s.pontos[0].valor, fonte: 'Banco Central, SGS 1737 (IPCA número-índice)', url: s.url, consultada_em: s.consultada_em, periodo: s.pontos[0].data, via: 'api_bcb' };
}

// Quanto `valor` de `de` (YYYY-MM) vale em `ate` (YYYY-MM) corrigido pelo IPCA.
// Guarda fórmula, entradas e as duas evidências. NÃO é previsão nem opinião.
async function corrigirPorIpca({ valor, de, ate, fetcher }) {
  const [a, b] = await Promise.all([ipcaIndice(de, { fetcher }), ipcaIndice(ate, { fetcher })]);
  const resultado = Math.round(((valor * b.valor) / a.valor) * 100) / 100;
  const evid = (x, ym) => novaEvidencia({
    via: x.via, tipo: 'primaria', url: x.url, titulo: `IPCA número-índice, ${ym}`, origem: x.fonte,
    trecho: `IPCA número-índice em ${x.periodo}: ${x.valor} (base dez/1993 = 100)`,
    consultada_em: x.consultada_em, periodo: ym, unidade: 'pontos (dez/1993 = 100)', abrangencia: 'Brasil, índice geral',
    limitacoes: 'IPCA mede a inflação média de famílias de 1 a 40 salários mínimos; a correção é uma aproximação do poder de compra, não do custo de vida de uma pessoa.',
    relacao: 'sustenta',
  });
  return {
    resultado,
    calculo: {
      formula: 'valor × índice_final ÷ índice_inicial',
      entradas: [{ nome: 'valor', valor, unidade: 'R$' }, { nome: `índice ${de}`, valor: a.valor }, { nome: `índice ${ate}`, valor: b.valor }],
      resultado,
      periodo: `${de} a ${ate}`,
      limites: 'Correção pelo IPCA (IBGE); compara preços médios, não o orçamento de uma pessoa.',
    },
    evidencias: [evid(a, de), evid(b, ate)],
  };
}

// Compara um valor dito na matéria com o valor oficial.
function compararNumero(dito, oficial, { tolRel = 0.005, tolAbs = 0.005 } = {}) {
  const dif = Math.abs(dito - oficial);
  if (dif <= Math.max(Math.abs(oficial) * tolRel, tolAbs)) return 'sustenta';
  return 'contradiz';
}

// Valor de uma série num mês (YYYY-MM) como evidência primária.
async function evidenciaSerieBcb(codigo, ym, { fetcher } = {}) {
  const ini = new Date(`${ym}-01T00:00:00Z`);
  const [y, m] = ym.split('-').map(Number);
  const fim = new Date(Date.UTC(y, m, 0));
  const s = await serieBcb(codigo, { inicio: ini.toISOString(), fim: fim.toISOString(), fetcher });
  if (!s.pontos.length) return null;
  const p = s.pontos[s.pontos.length - 1];
  return {
    valor: p.valor,
    evidencia: novaEvidencia({
      via: 'api_bcb', tipo: 'primaria', url: s.url, titulo: s.meta.nome, origem: `Banco Central do Brasil, SGS ${codigo}`,
      trecho: `${s.meta.nome} em ${p.data}: ${p.valor} (${s.meta.unidade})`,
      consultada_em: s.consultada_em, periodo: p.data, unidade: s.meta.unidade, abrangencia: s.meta.abrangencia,
      limitacoes: 'Valor do período indicado; revisões posteriores da série são possíveis.', relacao: 'neutra',
    }),
  };
}

// ── Câmara dos Deputados: situação de uma proposição ───────────────────────
const SIGLAS_CAMARA = new Set(['PL', 'PLP', 'PEC', 'PDL', 'MPV', 'PRC', 'REQ', 'PLV', 'PLN']);

async function proposicaoCamara({ sigla, numero, ano, fetcher }) {
  sigla = String(sigla).toUpperCase();
  if (!SIGLAS_CAMARA.has(sigla)) throw new Error(`Tipo de proposição não suportado: ${sigla}`);
  const lista = await pegaJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?siglaTipo=${sigla}&numero=${Number(numero)}&ano=${Number(ano)}&itens=5`, { fetcher });
  const achada = (lista.json?.dados || [])[0];
  if (!achada) return null;
  const det = await pegaJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${achada.id}`, { fetcher });
  const d = det.json?.dados || {};
  const st = d.statusProposicao || {};
  const trecho = `${sigla} ${numero}/${ano}: situação “${st.descricaoSituacao || 'não informada'}”${st.dataHora ? ` em ${String(st.dataHora).slice(0, 10)}` : ''}${st.siglaOrgao ? `, órgão ${st.siglaOrgao}` : ''}. Ementa: ${d.ementa || achada.ementa || ''}`;
  return {
    id: achada.id,
    situacao: st.descricaoSituacao || null,
    evidencia: novaEvidencia({
      via: 'api_camara', tipo: 'primaria', url: det.url_final, titulo: `${sigla} ${numero}/${ano} — Câmara dos Deputados`, origem: 'Câmara dos Deputados, Dados Abertos',
      trecho, publicada_em: st.dataHora ? new Date(st.dataHora).toISOString() : null, consultada_em: det.consultada_em, periodo: st.dataHora ? String(st.dataHora).slice(0, 10) : null,
      abrangencia: 'Tramitação na Câmara (a matéria pode estar em outra Casa)',
      limitacoes: 'Reflete o último registro de tramitação no momento da consulta; a situação muda.', relacao: 'neutra',
    }),
  };
}

module.exports = { SERIES_BCB, serieBcb, ipcaIndice, corrigirPorIpca, compararNumero, evidenciaSerieBcb, proposicaoCamara, pegaJson, SIGLAS_CAMARA };
