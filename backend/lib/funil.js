// Conversion Intelligence: o funil Descoberta → Seguidor → Relacionamento → Interesse → Lead → Diagnóstico → Proposta → Cliente.
// O topo vem das métricas reais (Meta); do Lead para baixo, o Pedro registra (não há integração com DM, CRM ou agenda, e nada é
// inventado). Cada conteúdo tem um OBJETIVO (descoberta, identidade, autoridade, conversão): a sequência editorial recomendada
// sai da distribuição real desses objetivos. Conteúdo de descoberta não recebe CTA comercial.
//
// Dados pessoais: o registro guarda só o que o Pedro digitar (apelido e origem). Não coloque CPF, telefone ou e-mail aqui.
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const TIPO = 'lead';
const ESTAGIOS = ['lead', 'diagnostico', 'proposta', 'cliente', 'perdido'];
const ROTULO_ESTAGIO = { lead: 'Lead', diagnostico: 'Diagnóstico', proposta: 'Proposta', cliente: 'Cliente', perdido: 'Perdido' };
const ORIGENS = { palavra_chave: 'Palavra-chave (isca)', dm: 'Direct', comentario: 'Comentário', link_bio: 'Link na bio', indicacao: 'Indicação', outro: 'Outro' };
const OBJETIVOS = { descoberta: 'Descoberta', identidade: 'Identidade', autoridade: 'Autoridade', conversao: 'Conversão' };
const conta = () => ACCOUNT.ig_id;
const limpo = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const erro = (m, status = 400) => Object.assign(new Error(m), { status, code: 'FUNIL' });
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('O funil precisa do banco de dados no servidor.', 503); return a; };
const PARECE_DADO_PESSOAL = /(\d{3}\.?\d{3}\.?\d{3}-?\d{2})|(@[\w.-]+\.\w{2,})|(\(?\d{2}\)?\s?9?\d{4}-?\d{4})/;

function validar(e) {
  const nome = limpo(e.nome, 60); const nota = limpo(e.nota, 300);
  if (PARECE_DADO_PESSOAL.test(`${nome} ${nota}`)) throw erro('Não guarde CPF, telefone ou e-mail aqui: use só um apelido.');
  if (!ORIGENS[e.origem]) throw erro('Escolha a origem do lead.');
  const est = e.estagio || 'lead'; if (!ESTAGIOS.includes(est)) throw erro('Estágio inválido.');
  const valor = e.valor == null || e.valor === '' ? null : Number(e.valor);
  if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 1e7)) throw erro('Valor inválido.');
  return { nome: nome || 'Sem nome', origem: e.origem, palavra: limpo(e.palavra, 12).toUpperCase() || null, conteudo_id: limpo(e.conteudo_id, 60) || null, estagio: est, valor, nota };
}
async function listar() { const a = armazem(); if (!a?.duravel) return []; return (await a.radar.listar(conta(), TIPO, { limite: 1000 })).map((r) => r.doc).sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em))); }
async function criar(e, { agora = Date.now() } = {}) {
  const v = validar(e); const em = new Date(agora).toISOString();
  const doc = { id: `ld_${crypto.randomBytes(6).toString('hex')}`, ...v, criado_em: em, historico: [{ estagio: v.estagio, em }] };
  await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc;
}
async function mover(id, estagio, { agora = Date.now() } = {}) {
  if (!ESTAGIOS.includes(estagio)) throw erro('Estágio inválido.');
  const r = await db().radar.obter(conta(), TIPO, String(id)); if (!r) throw erro('Lead não encontrado.', 404);
  const doc = { ...r.doc, estagio, historico: [...(r.doc.historico || []), { estagio, em: new Date(agora).toISOString() }].slice(-20) };
  await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc;
}
async function apagar(id) { await db().radar.apagar(conta(), TIPO, String(id)); return { id, apagado: true }; }

// Quantos chegaram a cada estágio no período (quem virou cliente também passou por lead, diagnóstico e proposta).
function resumo(leads, { de = 0, ate = Date.now() } = {}) {
  const ordem = ['lead', 'diagnostico', 'proposta', 'cliente'];
  const noPeriodo = leads.filter((l) => { const t = Date.parse(l.criado_em); return t >= de && t <= ate; });
  const alcancou = (l, e) => (l.historico || []).some((h) => ordem.indexOf(h.estagio) >= ordem.indexOf(e)) || ordem.indexOf(l.estagio) >= ordem.indexOf(e);
  const contagem = Object.fromEntries(ordem.map((e) => [e, noPeriodo.filter((l) => alcancou(l, e)).length]));
  const taxa = (a, b) => (contagem[a] ? Math.round((contagem[b] / contagem[a]) * 100) : null);
  const porOrigem = {}; for (const l of noPeriodo) { const o = (porOrigem[l.origem] ||= { leads: 0, clientes: 0 }); o.leads++; if (alcancou(l, 'cliente')) o.clientes++; }
  const receita = noPeriodo.filter((l) => alcancou(l, 'cliente') && l.valor != null).reduce((s, l) => s + l.valor, 0);
  return { contagem, perdidos: noPeriodo.filter((l) => l.estagio === 'perdido').length, taxas: { lead_diagnostico: taxa('lead', 'diagnostico'), diagnostico_proposta: taxa('diagnostico', 'proposta'), proposta_cliente: taxa('proposta', 'cliente') }, por_origem: porOrigem, receita: receita || null };
}

// Sequência editorial pelos objetivos dos últimos conteúdos (os que o Pedro aprovou com objetivo marcado).
function sequencia(objetivos) {
  const ult = objetivos.slice(0, 10); const n = ult.length; const c = {}; for (const o of ult) c[o] = (c[o] || 0) + 1;
  if (n < 4) return { distribuicao: c, n, recomendacao: `Só ${n} conteúdo(s) com objetivo marcado. Marque o objetivo ao aprovar para a sequência ser recomendada pelos dados.` };
  const pct = (k) => Math.round(((c[k] || 0) / n) * 100);
  let rec;
  if (!c.autoridade && !c.conversao) rec = 'Os últimos conteúdos foram só de descoberta e identidade: o próximo pode ser de autoridade (um caso ou uma análise sua), sem CTA comercial forçado.';
  else if (pct('conversao') > 20) rec = `Conversão em ${pct('conversao')}% dos últimos ${n}: acima de 1 em 5 cansa a audiência. Volte a descoberta e identidade.`;
  else if (pct('descoberta') < 40) rec = `Descoberta em só ${pct('descoberta')}% dos últimos ${n}: sem gente nova entrando, o funil seca. Priorize curiosidade.`;
  else rec = 'Distribuição equilibrada. Mantenha cerca de 1 conteúdo de conversão a cada 5 a 8.';
  return { distribuicao: c, n, recomendacao: rec };
}

// CTA por objetivo: descoberta não recebe CTA comercial.
const ctaPermitido = (objetivo) => ({ descoberta: ['envio', 'salvar', 'comentar'], identidade: ['envio', 'comentar', 'salvar'], autoridade: ['salvar', 'comentar', 'isca'], conversao: ['isca', 'dm'] }[objetivo] || ['envio', 'salvar', 'comentar']);

module.exports = { TIPO, ESTAGIOS, ROTULO_ESTAGIO, ORIGENS, OBJETIVOS, validar, listar, criar, mover, apagar, resumo, sequencia, ctaPermitido };
