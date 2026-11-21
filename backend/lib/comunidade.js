// Comunidade: os comentários REAIS dos posts do Pedro, lidos pela Graph API (permissão instagram_manage_comments), classificados
// por regra (sem custo), com sugestão de resposta pela IA gratuita SÓ quando o Pedro pede, e nada enviado sem um toque dele.
// Também alimenta a Inteligência de Audiência (audiencia.js) e vira pauta para o motor de roteiros.
//
// Limites honestos: comentários de concorrentes, DMs e respostas a Stories NÃO são lidos (a API não entrega para outras contas;
// DMs e Stories exigem webhooks e permissões que este app não tem). O painel mostra isso.
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const C = require('./crescimento');

const TIPO = 'comentario'; const TIPO_PAUTA = 'pauta_comunidade';
const MAX_POR_POST = 50; const MAX_POSTS = 15; const DIAS_POSTS = 45;
const conta = () => ACCOUNT.ig_id;
const limpo = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const erro = (m, status = 400, code = 'COMUNIDADE') => Object.assign(new Error(m), { status, code });
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('A comunidade precisa do banco de dados no servidor.', 503, 'SEM_BANCO'); return a; };

const CLASSES = {
  pergunta: 'Pergunta', duvida: 'Dúvida', critica: 'Crítica', discordancia: 'Discordância', historia: 'História',
  sugestao: 'Sugestão de conteúdo', oportunidade: 'Oportunidade', interesse_comercial: 'Interesse comercial', spam: 'Spam', elogio: 'Elogio', outro: 'Outro',
};
const R = {
  spam: /(https?:\/\/|www\.|\bsigam?\b|\bsiga @|\bfollow\b|\bpromo[cç][aã]o\b|ganhe dinheiro|renda extra garantida|chama no pv|clique no link|\bbet\b|\bpix gr[aá]tis)/,
  comercial: /(quanto custa|qual o valor|qual valor|pre[cç]o d[ao] (consultoria|mentoria|curso)|consultoria|mentoria|como (te )?contrat|contratar voc|or[cç]amento|voc[eê] atende|trabalha com|me ajuda (na|com a) minha (loja|empresa)|quero (sua )?ajuda|tem curso|vende curso)/,
  sugestao: /(faz (um )?v[ií]deo|fala (sobre|de)|poderia falar|sugiro|sugest[aã]o|pr[oó]ximo v[ií]deo|faz sobre|explica (sobre|o|a)|traz (mais|um))/,
  oportunidade: /(algu[eé]m (sabe|indica)|ningu[eé]m fala|ningu[eé]m explica|falta conte[uú]do|procur(o|ando) (isso|algu[eé]m))/,
  discordancia: /(discordo|n[aã]o concordo|n[aã]o [eé] bem assim|n[aã]o [eé] verdade|na verdade|depende|nem sempre)/,
  critica: /(mentira|errad[oa]|fake|bobagem|lixo|rid[ií]culo|vergonha|p[eé]ssimo|engana[cç][aã]o|sensacionalis|clickbait|caça.?clique)/,
  duvida: /(n[aã]o entendi|d[uú]vida|confus|explica melhor|como assim|n[aã]o ficou claro)/,
  pergunta: /(\?\s*$|^\s*(como|quanto|qual|quais|por ?que|onde|quando|quem|o que|[eé] verdade|vale a pena|d[aá] pra|tem como)\b)/,
  historia: /\b(eu|comigo|minha|meu|trabalhei|j[aá] fui|aconteceu|na minha (loja|empresa|cidade)|meu (pai|chefe|patr[aã]o))\b/,
  elogio: /(parab[eé]ns|muito bom|excelente|top|incr[ií]vel|amei|sensacional|[oó]timo|obrigad|valeu|que conte[uú]do)/,
};
function classificar(texto) {
  const t = semAcento(texto).trim();
  if (!t || t.replace(/[^a-z0-9]/g, '').length < 2 || R.spam.test(t)) return 'spam';
  if (R.comercial.test(t)) return 'interesse_comercial';
  if (R.sugestao.test(t)) return 'sugestao';
  if (R.oportunidade.test(t)) return 'oportunidade';
  if (R.discordancia.test(t)) return 'discordancia';
  if (R.critica.test(t)) return 'critica';
  if (R.duvida.test(t)) return 'duvida';
  if (R.pergunta.test(t)) return 'pergunta';
  if (t.length >= 80 && R.historia.test(t)) return 'historia';
  if (R.elogio.test(t)) return 'elogio';
  return 'outro';
}
const POS = /(bom|boa|[oó]tim|excelente|top|amei|gostei|parab|verdade|concordo|incr[ií]vel|obrigad|valeu|faz sentido|perfeito)/g;
const NEG = /(ruim|p[eé]ssim|mentira|errad|lixo|rid[ií]cul|vergonha|absurd|odeio|engana|fake|bobagem|discordo|piada)/g;
function sentimento(texto) {
  const t = semAcento(texto); const p = (t.match(POS) || []).length; const n = (t.match(NEG) || []).length;
  return p > n ? 'positivo' : n > p ? 'negativo' : 'neutro';
}
const RESPONDER = new Set(['pergunta', 'duvida', 'critica', 'discordancia', 'historia', 'sugestao', 'oportunidade', 'interesse_comercial']);

// ── Coleta (Graph API) ──
async function coletar({ grafo, igId, posts = [], agora = Date.now(), orcamentoMs = 40000, deps = {} } = {}) {
  const a = deps.armazem || db(); const t0 = Date.now();
  const alvo = posts.filter((p) => agora - Date.parse(p.publicado_em) <= DIAS_POSTS * 86400000).slice(0, MAX_POSTS);
  let novos = 0; let lidos = 0; const erros = [];
  for (const p of alvo) {
    if (Date.now() - t0 > orcamentoMs) { erros.push('Tempo esgotado: o resto fica para a próxima leitura.'); break; }
    let r;
    try { r = await grafo('GET', `${p.id}/comments`, { fields: 'id,text,username,timestamp,like_count', limit: MAX_POR_POST }); } catch (e) {
      const m = e.meta || {}; erros.push(m.amigavel || e.message);
      if (m.tipo === 'token' || m.tipo === 'permissao' || /permiss|manage_comments|\(#10\)|\(#200\)/i.test(String(m.amigavel || e.message))) return { novos, lidos, erros, permissao: false };
      continue;
    }
    for (const c of r?.data || []) {
      if (!c?.id || !c.text) continue;
      lidos++;
      const id = String(c.id); const ant = (await a.radar.obter(conta(), TIPO, id))?.doc;
      const texto = limpo(c.text, 1000);
      const doc = { ...(ant || { estado: 'novo', criado_em: new Date(agora).toISOString() }), id, media_id: String(p.id), permalink: p.permalink || null, legenda_post: limpo(p.legenda, 120), texto, usuario: limpo(c.username, 40), em: c.timestamp || null, curtidas: Number.isFinite(c.like_count) ? c.like_count : null, classe: classificar(texto), sentimento: sentimento(texto), tema: C.temaDe(texto).id, tema_post: C.temaDe(p.legenda).id };
      await a.radar.salvar(conta(), TIPO, id, doc);
      if (!ant) novos++;
    }
  }
  return { novos, lidos, erros, permissao: true, posts_lidos: alvo.length };
}

async function listar({ classe = null, estado = null, limite = 300 } = {}) {
  const a = armazem(); if (!a?.duravel) return [];
  return (await a.radar.listar(conta(), TIPO, { limite: 2000 })).map((r) => r.doc)
    .filter((c) => (!classe || c.classe === classe) && (!estado || c.estado === estado))
    .sort((x, y) => String(y.em || '').localeCompare(String(x.em || ''))).slice(0, limite);
}
async function obter(id) { const r = await db().radar.obter(conta(), TIPO, String(id)); if (!r) throw erro('Comentário não encontrado.', 404); return r.doc; }
async function gravar(doc) { await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc; }

// ── Sugestão de resposta (IA gratuita, sob demanda, nunca enviada sozinha) ──
const SISTEMA_RESPOSTA = `Você ajuda o Pedro (@pedro_destrava) a responder comentários no Instagram. Escreva como ele fala: direto, curioso, humano, informal, simples, sem palanque e sem linguagem de IA.
Regras: até 40 palavras; não invente fato, número, opinião ou experiência do Pedro (use só o que está no DNA e no post); em crítica ou discordância, responda com respeito e com o ponto central, sem ironia; em interesse comercial, convide para conversar no direct sem empurrar venda; nunca prometa resultado.
Responda APENAS JSON: {"resposta":"","tom":"acolhedor|direto|explicativo|bem-humorado|firme","recomendacao":"responder|responder e fixar|não responder|levar para o direct","potencial_conteudo":"baixo|medio|alto","pauta":"se o comentário rende um conteúdo, uma frase com a ideia; senão vazio"}`;
async function sugerirResposta(id, { deps = {} } = {}) {
  const c = await (deps.obter || obter)(id);
  const dna = await (deps.dna ? deps.dna() : require('./dnaEditorial').ler()).catch(() => null);
  const llmJson = require('./llmJson');
  const pedir = deps.pedirJson || llmJson.pedirJson;
  const { dados } = await pedir({ sistema: SISTEMA_RESPOSTA + (dna ? `\n\n${require('./dnaEditorial').blocoParaPrompt(dna, { maxBanco: 4 })}` : ''), usuario: `POST (legenda): ${c.legenda_post}\nTIPO DO COMENTÁRIO: ${CLASSES[c.classe]}\n${llmJson.dado ? llmJson.dado('COMENTARIO', c.texto, 1000).bloco : `COMENTÁRIO: ${c.texto}`}`, maxTokens: 400, temperatura: 0.6, pago: 'nunca', etapa: 'resposta_comentario' });
  const r = { texto: limpo(dados?.resposta, 400), tom: limpo(dados?.tom, 20), recomendacao: limpo(dados?.recomendacao, 40), potencial_conteudo: ['baixo', 'medio', 'alto'].includes(dados?.potencial_conteudo) ? dados.potencial_conteudo : null, pauta: limpo(dados?.pauta, 240), gerado_em: new Date().toISOString(), aprovada: false };
  if (!r.texto) throw erro('A IA não devolveu uma resposta utilizável. Tente de novo.', 502);
  return (deps.gravar || gravar)({ ...c, resposta: r });
}

async function acao(id, { acao: ac, texto } = {}) {
  const c = await obter(id);
  if (ac === 'aprovar' || ac === 'editar') {
    const t = limpo(texto ?? c.resposta?.texto, 400); if (t.length < 2) throw erro('Escreva a resposta antes de aprovar.');
    return gravar({ ...c, resposta: { ...(c.resposta || {}), texto: t, aprovada: ac === 'aprovar', editada: ac === 'editar' || t !== c.resposta?.texto }, estado: ac === 'aprovar' ? 'aprovado' : c.estado });
  }
  if (ac === 'descartar') return gravar({ ...c, estado: 'descartado' });
  if (ac === 'pauta') { await criarPauta({ texto: c.texto, tema: c.tema, origem: { tipo: 'comentario', id: c.id, classe: c.classe }, ideia: c.resposta?.pauta || '' }); return gravar({ ...c, estado: c.estado === 'novo' ? 'pauta' : c.estado, virou_pauta: true }); }
  throw erro('Ação desconhecida.');
}

// Envio: só resposta APROVADA, só com confirmação explícita do Pedro (o botão manda confirmar: true).
async function enviarResposta(id, { confirmar = false, grafo } = {}) {
  if (confirmar !== true) throw erro('Confirme o envio: nenhuma resposta sai sem você confirmar.');
  const c = await obter(id);
  if (!c.resposta?.aprovada || !c.resposta?.texto) throw erro('Aprove a resposta antes de enviar.');
  if (c.resposta.enviada_em) throw erro('Esta resposta já foi enviada.', 409);
  const r = await grafo('POST', `${c.id}/replies`, { message: c.resposta.texto });
  return gravar({ ...c, estado: 'respondido', resposta: { ...c.resposta, enviada_em: new Date().toISOString(), reply_id: r?.id || null } });
}

// ── Pautas da comunidade (o motor de roteiros as lê primeiro) ──
async function criarPauta({ texto, tema = null, origem = {}, ideia = '' }) {
  const a = db(); const t = limpo(texto, 600); if (t.length < 8) throw erro('Pauta muito curta.');
  const doc = { id: `pc_${crypto.randomBytes(6).toString('hex')}`, texto: t, ideia: limpo(ideia, 240), tema, origem, criado_em: new Date().toISOString(), usada: false };
  await a.radar.salvar(conta(), TIPO_PAUTA, doc.id, doc); return doc;
}
async function listarPautas() {
  const a = armazem(); if (!a?.duravel) return [];
  return (await a.radar.listar(conta(), TIPO_PAUTA, { limite: 200 })).map((r) => r.doc).sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em)));
}
async function marcarPautaUsada(id) { const a = armazem(); if (!a?.duravel) return; const r = await a.radar.obter(conta(), TIPO_PAUTA, id); if (r) await a.radar.salvar(conta(), TIPO_PAUTA, id, { ...r.doc, usada: true, usada_em: new Date().toISOString() }); }

function resumo(comentarios) {
  const por = {}; for (const c of comentarios) por[c.classe] = (por[c.classe] || 0) + 1;
  return { total: comentarios.length, por_classe: por, pendentes: comentarios.filter((c) => c.estado === 'novo' && RESPONDER.has(c.classe)).length };
}

module.exports = { TIPO, TIPO_PAUTA, CLASSES, RESPONDER, classificar, sentimento, coletar, listar, obter, sugerirResposta, acao, enviarResposta, criarPauta, listarPautas, marcarPautaUsada, resumo };
