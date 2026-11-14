// Piloto automático do carrossel "top": produz sozinho, o Pedro só aprova.
//  - Produção: de manhã cedo até a noite, pega a próxima pauta (descoberta de notícias, já triada e priorizada), cria o
//    carrossel e avança o pipeline até ter a meta do dia + reserva PRONTOS para aprovar.
//  - Aprovação: duas janelas (padrão 8h e 14h) com UM aviso cada ("N carrosséis prontos para aprovar").
//  - Publicação: aprovar AGENDA no próximo horário livre da grade; no horário, publica pelo fluxo existente.
//    Nada é publicado sem aprovação; publicação pausada ou acesso aberto seguram tudo na agenda.
// Cada chamada de `rodada` cabe no limite da função (≈45 s). Quem chama: o agendador (GitHub Actions a cada 10 min),
// a rotina diária da Vercel e o app aberto.
const crypto = require('crypto');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const T = require('./pipeline');

const conta = () => ACCOUNT.ig_id;
const PADRAO = Object.freeze({
  ativo: true, meta_dia: 8, reserva: 2, candidatos_max_dia: 30,
  inicio_producao: '03:00', fim_producao: '20:30', // começa de madrugada: às 8h já há carrosséis prontos
  horarios: ['09:00', '11:00', '12:30', '15:00', '17:00', '18:30', '20:00', '21:30'],
  janelas_aprovacao: ['08:00', '14:00'],
  // 'auto' reparte as vagas pelo placar real (envios por mil de cada formato, com 20% de teste); sem dado suficiente, faz o rodízio dos quatro.
  roteiros_dia: 10, // roteiros de Reels aprovados pelos fiscais por dia (aba Vídeos); 0 desliga
  formato_padrao: 'auto', // 'auto' | 'tweet' | 'estatico' (1 imagem + legenda longa) | 'ensaio' (texto corrido escuro) | 'alterna'
});
// Formatos que o piloto pode pedir ao pipeline; 'alterna' roda tweet → ensaio → estatico para o feed variar.
const FORMATOS_PILOTO = ['tweet', 'estatico', 'ensaio', 'alterna', 'auto'];
const FORMATOS_AUTO = ['tweet', 'estatico', 'ensaio'];
const RODIZIO = ['tweet', 'ensaio', 'estatico'];
const proximoDoRodizio = (ultimo) => RODIZIO[(RODIZIO.indexOf(ultimo) + 1) % RODIZIO.length]; // desconhecido (-1) → tweet
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status, code: 'PILOTO' });

// Brasília é UTC−3 o ano todo (sem horário de verão desde 2019).
const OFFSET_MS = 3 * 3600000;
const diaSP = (t) => new Date(t - OFFSET_MS).toISOString().slice(0, 10);
const horaSP = (t) => new Date(t - OFFSET_MS).toISOString().slice(11, 16);
const instante = (dia, hhmm) => Date.parse(`${dia}T${hhmm}:00-03:00`);
const proximoDia = (dia) => new Date(Date.parse(`${dia}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

function validar(patch = {}) {
  const out = {};
  if ('ativo' in patch) { if (typeof patch.ativo !== 'boolean') throw erro('ativo deve ser verdadeiro ou falso.'); out.ativo = patch.ativo; }
  const inteiro = (k, min, max) => { if (!(k in patch)) return; const n = Number(patch[k]); if (!Number.isInteger(n) || n < min || n > max) throw erro(`${k} deve ser um inteiro de ${min} a ${max}.`); out[k] = n; };
  inteiro('meta_dia', 1, 15); inteiro('reserva', 0, 5); inteiro('candidatos_max_dia', 1, 30); inteiro('roteiros_dia', 0, 15);
  for (const k of ['inicio_producao', 'fim_producao']) if (k in patch) { if (!HORA.test(patch[k])) throw erro(`${k} deve estar no formato HH:MM.`); out[k] = patch[k]; }
  if ('formato_padrao' in patch) { if (!FORMATOS_PILOTO.includes(patch.formato_padrao)) throw erro(`formato_padrao deve ser ${FORMATOS_PILOTO.slice(0, -1).join(', ')} ou auto.`); out.formato_padrao = patch.formato_padrao; }
  for (const k of ['horarios', 'janelas_aprovacao']) if (k in patch) {
    const l = Array.isArray(patch[k]) ? [...new Set(patch[k].map(String).map((x) => x.trim()))].sort() : null;
    if (!l || !l.length || l.length > 15 || !l.every((x) => HORA.test(x))) throw erro(`${k} deve ser uma lista de horários HH:MM (até 15).`);
    out[k] = l;
  }
  return out;
}

async function config() {
  const a = armazem(); const g = a?.duravel ? ((await a.config.obter(conta())).piloto || {}) : {};
  return { ...PADRAO, ...g };
}
async function salvarConfig(patch) {
  const a = armazem(); if (!a?.duravel) throw erro('O piloto precisa do banco de dados no servidor.', 503);
  const novo = { ...(await config()), ...validar(patch) };
  await a.config.salvar(conta(), { piloto: novo });
  return novo;
}
async function lerEstado() { const a = armazem(); return a?.duravel ? ((await a.config.obter(conta())).piloto_estado || {}) : {}; }
async function gravarEstado(e) { const a = armazem(); if (a?.duravel) await a.config.salvar(conta(), { piloto_estado: e }); }

// ── Agenda ──────────────────────────────────────────────────────────────────────
// Próximo horário livre da grade, a partir de agora + 10 min (hoje ou nos próximos dias).
// Sem limite de posts por dia: se a grade do dia já está toda ocupada, o post entra num horário extra do mesmo dia
// (de 30 em 30 min entre 08:00 e 22:30, a pelo menos 25 min de outro post) em vez de empurrar para amanhã.
function proximoHorario(cfg, ocupados, agora) {
  const livre = (t, folga) => !ocupados.some((o) => Math.abs(Date.parse(o) - t) < folga);
  let dia = diaSP(agora);
  for (let d = 0; d < 30; d++, dia = proximoDia(dia)) {
    let cheia = false;
    for (const h of cfg.horarios) {
      const t = instante(dia, h);
      if (t < agora + 10 * 60000) continue;
      if (!livre(t, 60000)) { cheia = true; continue; }
      return new Date(t).toISOString();
    }
    if (cheia) {
      for (let m = 8 * 60; m <= 22 * 60 + 30; m += 30) {
        const t = instante(dia, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
        if (t >= agora + 10 * 60000 && livre(t, 25 * 60000)) return new Date(t).toISOString();
      }
    }
  }
  return null;
}

async function agendar(id, { agora = Date.now() } = {}) {
  const a = armazem(); const cfg = await config(); const est = await lerEstado();
  const agenda = (est.agenda || []).filter((x) => x.id !== id);
  const quando = proximoHorario(cfg, agenda.map((x) => x.publicar_em), agora);
  if (!quando) throw erro('Não há horário livre nos próximos 30 dias.', 409);
  const reg = await a.conteudos.obter(conta(), id); if (!reg) throw erro('Conteúdo não encontrado.', 404);
  const c = reg.doc;
  c.agenda = { publicar_em: quando, agendado_em: new Date(agora).toISOString() };
  c.studio = { ...(c.studio || {}), estado: 'agendado', job: null };
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  await gravarEstado({ ...est, agenda: [...agenda, { id, publicar_em: quando }].sort((x, y) => x.publicar_em.localeCompare(y.publicar_em)) });
  await require('./relogio').agendarEm(Date.parse(quando), { agora }).catch(() => {}); // post para daqui a pouco: garante o tique no horário
  return c;
}

async function desagendar(id) {
  const a = armazem(); const est = await lerEstado();
  await gravarEstado({ ...est, agenda: (est.agenda || []).filter((x) => x.id !== id) });
  const reg = await a.conteudos.obter(conta(), id); if (!reg) return null;
  const c = reg.doc; delete c.agenda; c.studio = { ...(c.studio || {}), estado: 'pronto', job: null };
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  return c;
}

// No horário: entrega para o fluxo de publicação existente (o mesmo do "Aprovar e publicar").
async function publicarAgora(id, deps = {}) {
  const P = require('../publicador');
  await P.exigirAcessoProtegido();
  if ((await P.config()).publish_paused) throw Object.assign(erro('As publicações estão pausadas.', 409), { code: 'PAUSADO' });
  const a = armazem(); const reg = await a.conteudos.obter(conta(), id); if (!reg) throw erro('Conteúdo não encontrado.', 404);
  const c = reg.doc;
  if (c.status !== 'aprovado' || !c.revisao?.aprovada_versao) throw erro('O conteúdo não está aprovado.', 409);
  c.studio = { ...(c.studio || {}), job: crypto.randomUUID(), estado: 'publicando', etapa: 'publicacao', polls: 0 };
  c.agenda = { ...(c.agenda || {}), iniciado_em: new Date().toISOString() };
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  await (deps.enfileirar || ((x) => require('../../routes/studio')._internos.kick(x)))(c);
  return c;
}

// ── Pautas ──────────────────────────────────────────────────────────────────────
const LEGIVEIS = /(agenciabrasil\.ebc\.com\.br|senado\.leg\.br|camara\.leg\.br|gov\.br|bcb\.gov\.br|ibge\.gov\.br|poder360\.com\.br|cnnbrasil\.com\.br|g1\.globo\.com|infomoney\.com\.br|exame\.com|metropoles\.com)/i;
// Pauta de serviço (agenda do dia, resumo, "saiba quais") não vira tese: nem gasta uma tentativa do dia.
const DE_SERVICO = /\b(saiba (quais|o que|como)|leia a agenda|agenda d[eo]s?\b|destaques d|mais destaques|o que (abre|fecha|esperar|muda)|resumo d[aoe]|veja (os|as|o que|quais)|ao vivo|minuto a minuto|hor[oó]scopo|loterias?|mega-sena|quina\b|resultado d[ao] (jogo|sorteio)|indicadores e balan[cç]os)/i;
const deServico = (titulo) => DE_SERVICO.test(String(titulo || ''));
// Pauta que mexe com quem tem CNPJ (imposto, crédito, custo, venda, marketplace, trabalhista) sobe na fila: é o público do perfil.
const PARA_EMPREENDEDOR = /(imposto|tribut|simples nacional|\bmei\b|\bcnpj\b|empresa|empres[aá]rio|empreend|pequen[oa]s? neg[oó]cio|\bpme\b|folha|trabalhist|\bfgts\b|\binss\b|cr[eé]dito|juros|selic|financiamento|capital de giro|inadimpl|fal[eê]ncia|recupera[cç][aã]o judicial|varejo|e-?commerce|marketplace|mercado livre|shopee|amazon|frete|log[ií]stica|importa[cç][aã]o|exporta[cç][aã]o|tarifa|c[aâ]mbio|d[oó]lar|reforma tribut|nota fiscal|\bcbs\b|\bibs\b|\bicms\b|\bpix\b|consumo|vendas|faturamento|burocracia|regulament)/i;
const paraEmpreendedor = (titulo) => PARA_EMPREENDEDOR.test(String(titulo || ''));
function melhorLink(p) {
  const fs = (p.fontes || []).filter((f) => /^https?:\/\//.test(f.url || ''));
  return (fs.find((f) => LEGIVEIS.test(f.url)) || fs[0])?.url || null;
}
async function proximaPauta(est, { agora, deps, restante }) {
  const usadas = new Set((est.usadas || []).map((u) => u.id));
  let fila = (est.fila || []).filter((p) => !usadas.has(p.id));
  const velha = !est.fila_em || agora - Date.parse(est.fila_em) > 2 * 3600000;
  if ((!fila.length || velha) && restante() > 32000) {
    const r = await (deps.descobrir || require('../descoberta').descobrir)({ dias: 2 });
    fila = (r.pautas || []).filter((p) => !usadas.has(p.id) && melhorLink(p) && !deServico(p.titulo)).map((p) => ({ id: p.id, titulo: p.titulo, url: melhorLink(p), prioridade: (p.prioridade ?? 0) + (paraEmpreendedor(p.titulo) ? 25 : 0) }))
      .sort((x, y) => (y.prioridade ?? 0) - (x.prioridade ?? 0)).slice(0, 12);
    est.fila_em = new Date(agora).toISOString();
  }
  est.fila = fila;
  return fila.shift() || null;
}

// ── Rodada ──────────────────────────────────────────────────────────────────────
// Quando a próxima rodada tem o que fazer (ms): o relógio dorme até lá em vez de acordar o banco à toa.
function proximaAcao(cfg, est, { agora, dia, hora, removidos = new Set(), semPauta = false }) {
  const c = [];
  for (const x of est.agenda || []) if (!removidos.has(x.id)) { const t = Date.parse(x.publicar_em); if (t > agora) c.push(t); else c.push(agora + 10 * 60000); } // vencido e segurado: tenta de novo em 10 min
  if (!cfg.ativo) return c.length ? Math.min(...c) : null;
  for (const j of cfg.janelas_aprovacao || []) { const t = instante(dia, j); if (t > agora && !est.notificado?.[j]) c.push(t); }
  const folga = est.extra_dia?.dia === dia ? est.extra_dia.n : 0;
  const prontosHoje = (est.criados || []).filter((x) => x.dia === dia && x.estado === 'concluida' && x.decidido !== 'descartado').length;
  const cabeMais = prontosHoje < cfg.meta_dia + cfg.reserva + folga && (est.criados_hoje || 0) < cfg.candidatos_max_dia + folga;
  const amanha = instante(proximoDia(dia), cfg.inicio_producao);
  if (hora < cfg.inicio_producao) c.push(instante(dia, cfg.inicio_producao));
  else if (hora > cfg.fim_producao || !cabeMais) c.push(amanha);
  else if (est.ia_pausa_ate && Date.parse(est.ia_pausa_ate) > agora) c.push(Date.parse(est.ia_pausa_ate));
  else if (semPauta) c.push(Math.ceil((agora + 15 * 60000) / (30 * 60000)) * 30 * 60000); // fila de pautas vazia: olha de novo em ~30 min
  else c.push(agora + 5 * 60000);
  // Roteiros de Reels ainda faltando hoje: volta em poucos minutos (cada rodada faz 1 a 3 chamadas de IA).
  const metaRt = Number.isInteger(cfg.roteiros_dia) ? cfg.roteiros_dia : PADRAO.roteiros_dia;
  const rt = est.roteiros; const rtPausa = rt?.pausa_ate && Date.parse(rt.pausa_ate) > agora;
  if (metaRt > 0 && hora >= '05:00' && hora <= '22:30' && !rtPausa && (rt?.dia !== dia || require('../roteiros').pendente(rt, metaRt))) c.push(agora + 3 * 60000);
  return Math.min(...c);
}

async function rodada({ agora = Date.now(), orcamentoMs = 45000, deps = {}, extra = 0 } = {}) {
  const inicio = Date.now(); const restante = () => orcamentoMs - (Date.now() - inicio);
  const a = armazem(); if (!a?.duravel) return { executou: false, motivo: 'O piloto precisa do banco de dados no servidor.' };
  const cfg = await config();
  let est = await lerEstado();
  // Uma rodada por vez (GitHub, app aberto e relógio da fila podem chegar juntos).
  if (est.rodando_ate && Date.parse(est.rodando_ate) > Date.now()) return { executou: false, motivo: 'Outra rodada está em andamento.', avancados: [], publicados: [], avisos: [] };
  await gravarEstado({ ...est, rodando_ate: new Date(Date.now() + orcamentoMs + 15000).toISOString() });
  const removidos = new Set();
  const dia = diaSP(agora); const hora = horaSP(agora);
  if (est.dia !== dia) est = { ...est, dia, criados_hoje: 0, notificado: {} };
  // Pedido do Pedro de mais pautas hoje ("extra"): vale só para o dia atual, soma ao limite de candidatos e de prontos e ignora o horário.
  if (extra > 0) est.extra_dia = { dia, n: Math.min(6, Math.floor(extra)) };
  const folga = est.extra_dia?.dia === dia ? est.extra_dia.n : 0;
  est.criados = (est.criados || []).filter((x) => Date.parse(x.em) > agora - 3 * 86400000);
  est.usadas = (est.usadas || []).filter((x) => Date.parse(x.em) > agora - 14 * 86400000);
  const r = { em: new Date(agora).toISOString(), dia, hora, ativo: cfg.ativo, publicados: [], avisos: [], avancados: [], criado: null };

  // 0) Uma vez por dia, de madrugada: limpa o banco (prévias e fotos sem uso, revisões antigas).
  if (hora < '04:00' && est.limpeza_dia !== dia && !deps.semLimpeza) {
    est.limpeza_dia = dia;
    try { const l = await require('../manutencao').limpar({ orcamentoMs: Math.min(30000, restante() - 10000) }); r.limpeza = { apagados: l.apagados, mb: l.mb_liberados, revisoes: l.revisoes_podadas }; } catch (e) { r.avisos.push(`Limpeza do banco falhou: ${String(e.message).slice(0, 100)}`); }
  }
  // 0b) Painel de audiência: refaz as personas a cada 14 dias (a base e os comentários mudam) — falha não derruba a rodada.
  if (hora < '04:00' && est.painel_dia !== dia && !deps.semLimpeza && !deps.painel) {
    est.painel_dia = dia;
    try {
      const PN = require('../painel'); const doc = await PN.personasAtuais();
      if (!doc || Date.now() - Date.parse(doc.criado_em) > 14 * 86400000) {
        const llmJson = require('../llmJson');
        await PN.montar({ ia: (args) => llmJson.comConsumo(() => llmJson.comPrazo(30000, () => llmJson.pedirJson(args))).then((x) => x.resultado) });
        r.avisos.push('Painel de audiência atualizado.');
      }
    } catch (e) { r.avisos.push(`Painel não atualizou: ${String(e.message).slice(0, 100)}`); }
  }
  // 0c) De madrugada: apaga do Blob os vídeos brutos e os editados antigos (o Blob gratuito tem 1 GB).
  if (hora < '04:00' && est.faxina_video_dia !== dia && !deps.semLimpeza) {
    est.faxina_video_dia = dia;
    try { const f = await (deps.faxinaVideos || ((o) => require('../videos').faxina(o)))({ agora }); if (f.apagados) r.faxina_videos = f; } catch (e) { r.avisos.push(`Faxina de vídeos falhou: ${String(e.message).slice(0, 100)}`); }
  }
  // 0d) Uma vez por dia, a partir das 8h: alertas de operação (banco, acesso ao Instagram, relógio que ficou parado).
  if (hora >= '08:00' && est.alerta_dia !== dia && (process.env.VERCEL || deps.alertas)) {
    est.alerta_dia = dia;
    try { const al = await (deps.alertas || ((o) => require('../alertas').conferir(o)))({ agora, ultimaRodadaEm: est.ultima_rodada?.em || null }); if (al.frases?.length) r.alertas = al.frases; } catch { /* alerta nunca derruba a rodada */ }
  }
  // 0e) Uma vez por dia, a partir das 7h: lê os resultados reais dos posts (Meta) e refaz o placar que orienta a produção.
  if (hora >= '07:00' && est.metricas_dia !== dia && restante() > 40000 && (process.env.VERCEL || deps.coletarMetricas)) {
    est.metricas_dia = dia;
    try { const m = await (deps.coletarMetricas || ((o) => require('../placar').coletar(o)))({ agora, orcamentoMs: Math.min(22000, restante() - 18000) }); r.metricas = { posts: m.snapshot?.posts?.length || 0, parcial: !!m.snapshot?.parcial }; }
    catch (e) { r.avisos.push(`Leitura dos resultados falhou: ${String(e.meta?.amigavel || e.message).slice(0, 110)}`); }
  }
  // 1) Agenda vencida → publica (vale mesmo com o piloto desligado: foi aprovado pelo Pedro).
  for (const item of [...(est.agenda || [])].filter((x) => Date.parse(x.publicar_em) <= agora)) {
    try { await publicarAgora(item.id, deps); removidos.add(item.id); r.publicados.push(item.id); }
    catch (e) {
      if (/não está aprovado|não encontrado/i.test(e.message)) removidos.add(item.id);
      r.avisos.push(`Publicação de ${item.id} segurada: ${e.message}`);
      // Post aprovado que não saiu: o Pedro precisa saber na hora (um aviso por post por dia).
      if (!est.aviso_falha?.[item.id] || est.aviso_falha[item.id] !== dia) {
        est.aviso_falha = { ...Object.fromEntries(Object.entries(est.aviso_falha || {}).filter(([, d]) => d === dia)), [item.id]: dia };
        await (deps.notificar || ((o) => require('../push').notificar(o)))({ corpo: `Um post agendado não foi publicado: ${String(e.message).slice(0, 110)}`, tag: `piloto-falha-${item.id}` }).catch(() => {});
      }
    }
  }
  if (!cfg.ativo) { r.proxima_em = proximaAcao(cfg, est, { agora, dia, hora, removidos }); est.ultima_rodada = r; await gravarRodada(est, removidos); return { executou: true, ...r, motivo: 'Piloto desligado: só a agenda já aprovada foi conferida.' }; }

  // 2) Avança o que está em produção.
  for (const x of est.criados.filter((y) => y.estado === 'em_andamento')) {
    if (restante() < 16000) break;
    try {
      const p = await T.passo(x.id, { deps: deps.pipeline || {}, orcamentoMs: Math.min(44000, restante() - 4000) });
      x.estado = p.conteudo.top.estado; x.nota = p.conteudo.top.escolha?.nota ?? null; r.avancados.push({ id: x.id, estado: x.estado });
      if (p.conteudo.top.cota_dia && p.conteudo.top.adiar_ate) est.ia_pausa_ate = p.conteudo.top.adiar_ate;
      // IA gratuita sem cota por pelo menos 1 h: avisa uma vez por dia, de dia.
      if (p.conteudo.top.cota_dia && p.conteudo.top.adiar_ate && est.aviso_cota_dia !== dia && hora >= '08:00' && hora <= '21:30' && Date.parse(p.conteudo.top.adiar_ate) - agora >= 50 * 60000) {
        est.aviso_cota_dia = dia;
        await (deps.notificar || ((o) => require('../push').notificar(o)))({ corpo: `A IA gratuita ficou sem cota: a produção para até ${horaSP(Date.parse(p.conteudo.top.adiar_ate))}.`, tag: 'piloto-cota' }).catch(() => {});
      }
      // OpenAI sem créditos: avisa o Pedro uma vez por dia (o piloto fica parado até recarregar).
      if (p.conteudo.top.sem_credito && est.aviso_credito_dia !== dia) {
        est.aviso_credito_dia = dia;
        await (deps.notificar || ((o) => require('../push').notificar(o)))({ corpo: 'A OpenAI ficou sem créditos: o piloto parou de escrever. Recarregue em platform.openai.com → Billing.', tag: 'piloto-credito' }).catch(() => {});
        r.avisos.push('OpenAI sem créditos: produção parada até recarregar.');
      }
    } catch (e) { if (/não encontrado/i.test(e.message)) x.estado = 'erro'; r.avisos.push(`${x.id}: ${String(e.message).slice(0, 120)}`); }
  }

  // 3) Janela de aprovação: um aviso por janela, se houver algo pronto.
  const prontos = est.criados.filter((x) => x.estado === 'concluida' && !x.decidido).length;
  for (const j of cfg.janelas_aprovacao) {
    if (hora >= j && !est.notificado?.[j] && instante(dia, j) > agora - 3 * 3600000) {
      est.notificado = { ...(est.notificado || {}), [j]: true };
      if (prontos) await (deps.notificar || ((o) => require('../push').notificar(o)))({ corpo: prontos > 1 ? `${prontos} carrosséis prontos para aprovar. Toque para ver.` : '1 carrossel pronto para aprovar. Toque para ver.', tag: `piloto-${j}`, n: prontos }).catch(() => {});
    }
  }

  // 4) Cria o próximo, se ainda cabe hoje.
  // Descartado pelo Pedro não conta na meta: abre vaga para outro.
  const prontosHoje = est.criados.filter((x) => x.dia === dia && x.estado === 'concluida' && x.decidido !== 'descartado').length;
  const emAndamento = est.criados.filter((x) => x.estado === 'em_andamento').length;
  const naJanela = (hora >= cfg.inicio_producao && hora <= cfg.fim_producao) || folga > 0;
  const iaPausada = est.ia_pausa_ate && Date.parse(est.ia_pausa_ate) > agora;
  if (iaPausada) r.avisos.push(`IA gratuita sem cota até ${horaSP(Date.parse(est.ia_pausa_ate))}: nenhuma pauta nova até lá.`);
  if (naJanela && !iaPausada && !emAndamento && prontosHoje < cfg.meta_dia + cfg.reserva + folga && (est.criados_hoje || 0) < cfg.candidatos_max_dia + folga && restante() > 12000) {
    try {
      // Linhas próprias do Pedro: havendo história, caso ou passo a passo ainda não usado, 1 de cada 3 peças do dia sai dele.
      const doDia = est.criados.filter((x) => x.dia === dia); const proprias = doDia.filter((x) => x.linha && x.linha !== 'noticia').length;
      let historia = null;
      if (!deps.semHistorias && proprias * 3 <= doDia.length) { try { historia = await (deps.proximaHistoria || (() => require('../historias').proximaNaoUsada()))(); } catch { historia = null; } }
      if (historia) {
        const g = await (deps.gerarHistoria || ((id) => require('../historias').gerar(id, { origem: 'piloto' })))(historia.id);
        est.criados.push({ id: g.id, dia, em: new Date(agora).toISOString(), titulo: g.titulo, estado: 'em_andamento', formato: g.formato, linha: historia.tipo, historia_id: historia.id });
        est.criados_hoje = (est.criados_hoje || 0) + 1; r.criado = { id: g.id, titulo: g.titulo, linha: historia.tipo };
        if (restante() > 20000 && !deps.gerarHistoria) {
          try { const p2 = await T.passo(g.id, { deps: deps.pipeline || {}, orcamentoMs: Math.min(44000, restante() - 4000) }); const x = est.criados[est.criados.length - 1]; x.estado = p2.conteudo.top.estado; r.avancados.push({ id: g.id, estado: x.estado }); } catch (e) { r.avisos.push(`${g.id}: ${String(e.message).slice(0, 120)}`); }
        }
      }
      const pauta = historia ? null : await proximaPauta(est, { agora, deps, restante });
      if (historia) { /* a vaga desta rodada foi para a linha própria */ } else if (pauta) {
        // Formato padrão do feed: "reportagem" (o visual da marca). Dá para mudar em config.piloto (formato_padrao);
        // "alterna" faz o rodízio tweet → ensaio → estatico a cada pauta.
        const formato = FORMATOS_PILOTO.includes(cfg.formato_padrao) ? cfg.formato_padrao : 'auto'; // 'reportagem' salvo antes vira 'auto'
        const ultimoFmt = [...est.criados].reverse().find((x) => x.formato)?.formato;
        let fmt = formato === 'alterna' ? proximoDoRodizio(ultimoFmt) : formato;
        if (formato === 'auto') {
          // Placar real decide; sem dado suficiente, rodízio dos quatro formatos (é assim que o dado aparece).
          const Placar = require('../placar'); const pl = deps.placar !== undefined ? deps.placar : await Placar.ler().catch(() => null);
          fmt = Placar.sortear(FORMATOS_AUTO, pl?.pesos?.formato, (deps.sortear || Math.random)()) || FORMATOS_AUTO[(FORMATOS_AUTO.indexOf(ultimoFmt) + 1) % FORMATOS_AUTO.length];
        }
        const c = await (deps.criar || T.criar)({ url: pauta.url, titulo: pauta.titulo, origem: 'piloto', formato: fmt });
        est.criados.push({ id: c.id, dia, em: new Date(agora).toISOString(), pauta_id: pauta.id, titulo: pauta.titulo, estado: 'em_andamento', formato: fmt, linha: 'noticia' });
        est.usadas.push({ id: pauta.id, em: new Date(agora).toISOString() });
        est.criados_hoje = (est.criados_hoje || 0) + 1; r.criado = { id: c.id, titulo: pauta.titulo };
        // aproveita o resto da rodada para já avançar o carrossel recém-criado
        if (restante() > 20000 && !deps.criar) {
          try { const p2 = await T.passo(c.id, { deps: deps.pipeline || {}, orcamentoMs: Math.min(44000, restante() - 4000) }); const x = est.criados[est.criados.length - 1]; x.estado = p2.conteudo.top.estado; r.avancados.push({ id: c.id, estado: x.estado }); } catch (e) { r.avisos.push(`${c.id}: ${String(e.message).slice(0, 120)}`); }
        }
      } else { r.sem_pauta = true; r.avisos.push('Sem pauta nova agora (fila vazia ou descoberta adiada).'); }
    } catch (e) { r.avisos.push(`Criação falhou: ${String(e.message).slice(0, 160)}`); }
  }
  // 5) Roteiros de Reels: roteirista + fiscais avançam com o tempo que sobrou (IA gratuita; nada é publicado).
  const metaRoteiros = Number.isInteger(cfg.roteiros_dia) ? cfg.roteiros_dia : PADRAO.roteiros_dia;
  if (metaRoteiros > 0 && !iaPausada && hora >= '05:00' && hora <= '22:30' && restante() > 16000 && !deps.semRoteiros) {
    try {
      const rt = await (deps.roteiros || require('../roteiros').avancar)(est, { agora, dia, meta: metaRoteiros, orcamentoMs: restante() - 4000 });
      if (rt.salvos?.length || rt.descartados?.length || rt.fases?.length) r.roteiros = { salvos: rt.salvos?.length || 0, descartados: rt.descartados?.length || 0, fases: rt.fases?.length || 0 };
      if (rt.erro) r.avisos.push(`Roteiros: ${rt.erro}`);
    } catch (e) { r.avisos.push(`Roteiros falharam: ${String(e.message).slice(0, 120)}`); }
  }
  r.proxima_em = proximaAcao(cfg, est, { agora, dia, hora, removidos, semPauta: !!r.sem_pauta });
  est.ultima_rodada = { ...r, avisos: r.avisos.slice(0, 6) };
  await gravarRodada(est, removidos);
  return { executou: true, ...r };
}

// Grava o fim da rodada sem apagar o que mudou enquanto ela rodava: aprovação que agendou um post, decisão do Pedro,
// carrossel registrado pelo monitor. A agenda vem do estado atual (menos o que a rodada publicou ou descartou).
async function gravarRodada(est, removidos) {
  const atual = await lerEstado();
  const deAgora = new Map((atual.criados || []).map((x) => [x.id, x]));
  const criados = est.criados.map((x) => (deAgora.get(x.id)?.decidido ? { ...x, decidido: deAgora.get(x.id).decidido } : x));
  for (const x of atual.criados || []) if (!criados.some((y) => y.id === x.id) && Date.parse(x.em) > Date.now() - 3 * 86400000) criados.push(x);
  await gravarEstado({ ...est, criados, agenda: (atual.agenda || []).filter((x) => !removidos.has(x.id)), rodando_ate: null });
}

// Carrossel criado fora do piloto (ex.: monitor de notícias em alta) entra no índice para ser avançado nas rodadas.
async function registrar(id, { titulo = '', agora = Date.now() } = {}) {
  const est = await lerEstado();
  est.criados = [...(est.criados || []).filter((x) => x.id !== id), { id, dia: diaSP(agora), em: new Date(agora).toISOString(), titulo, estado: 'em_andamento', origem: 'monitor' }];
  await gravarEstado(est);
  await require('./relogio').agendarEm(agora + 60000, { agora }).catch(() => {}); // produção nova: não espera o tique parado
}

// Atualiza o estado de um item no índice (ex.: carrossel revalidado que saiu de "Para aprovar").
async function marcarEstado(id, estado) {
  const est = await lerEstado(); const x = (est.criados || []).find((y) => y.id === id);
  if (x) { x.estado = estado; await gravarEstado(est); }
}

// Marca no índice que o Pedro decidiu (aprovou ou descartou): deixa de contar como "pronto para aprovar".
async function registrarDecisao(id, decisao) {
  const est = await lerEstado();
  const x = (est.criados || []).find((y) => y.id === id);
  if (x) { x.decidido = decisao; await gravarEstado(est); }
}

// "Gerar roteiros agora" (aba Vídeos): roda só a fábrica de roteiros, respeitando a trava da rodada.
async function avancarRoteiros({ agora = Date.now(), orcamentoMs = 45000, deps = {} } = {}) {
  const a = armazem(); if (!a?.duravel) throw erro('Os roteiros precisam do banco de dados no servidor.', 503);
  const cfg = await config(); const est = await lerEstado();
  if (est.rodando_ate && Date.parse(est.rodando_ate) > Date.now()) return { ocupado: true, motivo: 'O piloto está rodando agora; os roteiros avançam nessa rodada.' };
  const dia = diaSP(agora);
  const meta = Math.max(Number.isInteger(cfg.roteiros_dia) ? cfg.roteiros_dia : PADRAO.roteiros_dia, 1);
  await gravarEstado({ ...est, rodando_ate: new Date(Date.now() + orcamentoMs + 15000).toISOString() });
  let r;
  try { r = await (deps.avancar || require('../roteiros').avancar)(est, { agora, dia, meta, orcamentoMs }); }
  finally { const atual = await lerEstado(); await gravarEstado({ ...atual, roteiros: est.roteiros, rodando_ate: null }); }
  return { ...r, resumo: require('../roteiros').resumo(est, { dia }) };
}

async function resumoDoDia({ agora = Date.now() } = {}) {
  const cfg = await config(); const est = await lerEstado(); const dia = diaSP(agora);
  const hoje = (est.criados || []).filter((x) => x.dia === dia);
  const cont = (f) => hoje.filter(f).length;
  return {
    config: cfg, dia, hora: horaSP(agora),
    hoje: { criados: hoje.length, em_producao: cont((x) => x.estado === 'em_andamento'), prontos: cont((x) => x.estado === 'concluida' && !x.decidido), aprovados: cont((x) => x.decidido === 'aprovado'), descartados_regua: cont((x) => ['descartada', 'abaixo_da_regua', 'erro'].includes(x.estado)) },
    itens: hoje.map((x) => ({ id: x.id, titulo: x.titulo || '', estado: x.estado, nota: x.nota ?? null, decidido: x.decidido || null })),
    agenda: (est.agenda || []).slice(0, 20), proximo_horario: proximoHorario(cfg, (est.agenda || []).map((x) => x.publicar_em), agora),
    roteiros: require('../roteiros').resumo(est, { dia }),
    ultima_rodada: est.ultima_rodada || null, guardado: !!armazem()?.duravel,
    ia_paga: process.env.IA_OPENAI === '1' && process.env.OPENAI_API_KEY ? await require('../gastoIa').resumo({ agora }).catch(() => null) : null,
  };
}

module.exports = { avancarRoteiros, proximaAcao, paraEmpreendedor, marcarEstado, deServico, rodada, registrar, agendar, desagendar, publicarAgora, config, salvarConfig, validar, resumoDoDia, registrarDecisao, proximoHorario, melhorLink, diaSP, horaSP, instante, proximoDoRodizio, PADRAO, FORMATOS_PILOTO, FORMATOS_AUTO, RODIZIO };
