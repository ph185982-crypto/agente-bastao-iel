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
});
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
  inteiro('meta_dia', 1, 15); inteiro('reserva', 0, 5); inteiro('candidatos_max_dia', 1, 30);
  for (const k of ['inicio_producao', 'fim_producao']) if (k in patch) { if (!HORA.test(patch[k])) throw erro(`${k} deve estar no formato HH:MM.`); out[k] = patch[k]; }
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
function proximoHorario(cfg, ocupados, agora) {
  let dia = diaSP(agora);
  for (let d = 0; d < 7; d++, dia = proximoDia(dia)) {
    for (const h of cfg.horarios) {
      const t = instante(dia, h);
      if (t < agora + 10 * 60000) continue;
      if (ocupados.some((o) => Math.abs(Date.parse(o) - t) < 60000)) continue;
      return new Date(t).toISOString();
    }
  }
  return null;
}

// Chamado pela aprovação: o conteúdo já está aprovado (studio.decidir). Grava o horário no conteúdo e na agenda.
async function agendar(id, { agora = Date.now() } = {}) {
  const a = armazem(); const cfg = await config(); const est = await lerEstado();
  const agenda = (est.agenda || []).filter((x) => x.id !== id);
  const quando = proximoHorario(cfg, agenda.map((x) => x.publicar_em), agora);
  if (!quando) throw erro('Não há horário livre na grade dos próximos 7 dias.', 409);
  const reg = await a.conteudos.obter(conta(), id); if (!reg) throw erro('Conteúdo não encontrado.', 404);
  const c = reg.doc;
  c.agenda = { publicar_em: quando, agendado_em: new Date(agora).toISOString() };
  c.studio = { ...(c.studio || {}), estado: 'agendado', job: null };
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  await gravarEstado({ ...est, agenda: [...agenda, { id, publicar_em: quando }].sort((x, y) => x.publicar_em.localeCompare(y.publicar_em)) });
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
  P.exigirAcessoProtegido();
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
    fila = (r.pautas || []).filter((p) => !usadas.has(p.id) && melhorLink(p) && !deServico(p.titulo)).map((p) => ({ id: p.id, titulo: p.titulo, url: melhorLink(p), prioridade: p.prioridade ?? null }))
      .sort((x, y) => (y.prioridade ?? 0) - (x.prioridade ?? 0)).slice(0, 12);
    est.fila_em = new Date(agora).toISOString();
  }
  est.fila = fila;
  return fila.shift() || null;
}

// ── Rodada ──────────────────────────────────────────────────────────────────────
async function rodada({ agora = Date.now(), orcamentoMs = 45000, deps = {} } = {}) {
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
  est.criados = (est.criados || []).filter((x) => Date.parse(x.em) > agora - 3 * 86400000);
  est.usadas = (est.usadas || []).filter((x) => Date.parse(x.em) > agora - 14 * 86400000);
  const r = { em: new Date(agora).toISOString(), dia, hora, ativo: cfg.ativo, publicados: [], avisos: [], avancados: [], criado: null };

  // 1) Agenda vencida → publica (vale mesmo com o piloto desligado: foi aprovado pelo Pedro).
  for (const item of [...(est.agenda || [])].filter((x) => Date.parse(x.publicar_em) <= agora)) {
    try { await publicarAgora(item.id, deps); removidos.add(item.id); r.publicados.push(item.id); }
    catch (e) {
      if (/não está aprovado|não encontrado/i.test(e.message)) removidos.add(item.id);
      r.avisos.push(`Publicação de ${item.id} segurada: ${e.message}`);
    }
  }
  if (!cfg.ativo) { est.ultima_rodada = r; await gravarRodada(est, removidos); return { executou: true, ...r, motivo: 'Piloto desligado: só a agenda já aprovada foi conferida.' }; }

  // 2) Avança o que está em produção.
  for (const x of est.criados.filter((y) => y.estado === 'em_andamento')) {
    if (restante() < 16000) break;
    try {
      const p = await T.passo(x.id, { deps: deps.pipeline || {}, orcamentoMs: Math.min(44000, restante() - 4000) });
      x.estado = p.conteudo.top.estado; x.nota = p.conteudo.top.escolha?.nota ?? null; r.avancados.push({ id: x.id, estado: x.estado });
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
  const naJanela = hora >= cfg.inicio_producao && hora <= cfg.fim_producao;
  if (naJanela && !emAndamento && prontosHoje < cfg.meta_dia + cfg.reserva && (est.criados_hoje || 0) < cfg.candidatos_max_dia && restante() > 12000) {
    try {
      const pauta = await proximaPauta(est, { agora, deps, restante });
      if (pauta) {
        const c = await (deps.criar || T.criar)({ url: pauta.url, titulo: pauta.titulo, origem: 'piloto' });
        est.criados.push({ id: c.id, dia, em: new Date(agora).toISOString(), pauta_id: pauta.id, titulo: pauta.titulo, estado: 'em_andamento' });
        est.usadas.push({ id: pauta.id, em: new Date(agora).toISOString() });
        est.criados_hoje = (est.criados_hoje || 0) + 1; r.criado = { id: c.id, titulo: pauta.titulo };
        // aproveita o resto da rodada para já avançar o carrossel recém-criado
        if (restante() > 20000 && !deps.criar) {
          try { const p2 = await T.passo(c.id, { deps: deps.pipeline || {}, orcamentoMs: Math.min(44000, restante() - 4000) }); const x = est.criados[est.criados.length - 1]; x.estado = p2.conteudo.top.estado; r.avancados.push({ id: c.id, estado: x.estado }); } catch (e) { r.avisos.push(`${c.id}: ${String(e.message).slice(0, 120)}`); }
        }
      } else r.avisos.push('Sem pauta nova agora (fila vazia ou descoberta adiada).');
    } catch (e) { r.avisos.push(`Criação falhou: ${String(e.message).slice(0, 160)}`); }
  }
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
}

// Marca no índice que o Pedro decidiu (aprovou ou descartou): deixa de contar como "pronto para aprovar".
async function registrarDecisao(id, decisao) {
  const est = await lerEstado();
  const x = (est.criados || []).find((y) => y.id === id);
  if (x) { x.decidido = decisao; await gravarEstado(est); }
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
    ultima_rodada: est.ultima_rodada || null, guardado: !!armazem()?.duravel,
  };
}

module.exports = { deServico, rodada, registrar, agendar, desagendar, publicarAgora, config, salvarConfig, validar, resumoDoDia, registrarDecisao, proximoHorario, melhorLink, diaSP, horaSP, instante, PADRAO };
