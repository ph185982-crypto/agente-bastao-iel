// Monitor de notícias em alta: a cada rodada lê os feeds dos veículos, separa o que está sendo coberto por
// vários veículos AGORA, tria (prioridade, tema já usado, política neutra...), avisa o Pedro e já manda
// montar o ROTEIRO. Nunca gera o carrossel nem publica: o Pedro aprova o roteiro, depois valida o carrossel
// e só então toca em "Aprovar e publicar".
//
// "Em alta" aqui = o mesmo acontecimento aparece em pelo menos N veículos diferentes dentro da janela de
// horas (padrão 3 veículos em 12 h). É um sinal de cobertura, não de audiência: a tela diz isso.
//
// Custo: cada rodada faz uma chamada de IA (triagem) e cada roteiro criado faz o pipeline de texto. Vem LIGADO por
// padrão (decisão do Pedro) e tem teto diário de roteiros (padrão 3); sem banco ou sem chave de IA ele não gasta nada.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const Estrategia = require('./estrategia');
const Temas = require('./temas');

const conta = () => ACCOUNT.ig_id;
const DIAS_VISTO = 3;
const TRAVA_MS = 150000;

// Dia de São Paulo (UTC-3, sem horário de verão) para o teto diário.
const diaSP = (agora) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);

function emAlta(p, cfg, agora) {
  const veiculos = [...new Set((p.veiculos || []).map((v) => String(v).trim()).filter(Boolean))];
  const datas = [p.publicada_em, ...(p.fontes || []).map((f) => f.publicada_em)].map((d) => Date.parse(d)).filter(Number.isFinite);
  const maisNova = datas.length ? Math.max(...datas) : null;
  const horas = maisNova == null ? null : Math.max(0, (agora - maisNova) / 3600000);
  return { veiculos, n: veiculos.length, horas: horas == null ? null : Math.round(horas * 10) / 10, em_alta: veiculos.length >= cfg.min_veiculos && horas != null && horas <= cfg.janela_horas };
}

async function lerEstado() { const a = armazem(); return a?.duravel ? ((await a.config.obter(conta())).monitor_estado || {}) : {}; }
async function gravarEstado(est) { const a = armazem(); if (a?.duravel) await a.config.salvar(conta(), { monitor_estado: est }); }

async function estado({ agora = Date.now() } = {}) {
  const e = await Estrategia.ler(); const st = await lerEstado();
  return { config: e.monitor, ultimo_tick: st.ultimo_tick || null, ultimo_resultado: st.ultimo_resultado || null, roteiros_hoje: st.dia === diaSP(agora) ? st.roteiros_hoje || 0 : 0, guardado: !!armazem()?.duravel,
    aviso: '“Em alta” = o mesmo acontecimento coberto por vários veículos ao mesmo tempo. É um sinal de cobertura, não de audiência.' };
}

// deps injetáveis nos testes: descobrir, criar, kick, notificar, temIA, agora.
async function tick({ forcar = false, deps = {} } = {}) {
  const agora = deps.agora || Date.now();
  const est = await Estrategia.ler(); const cfg = est.monitor;
  const base = { em: new Date(agora).toISOString(), ativo: cfg.ativo };
  if (!cfg.ativo && !forcar) return { ...base, executou: false, motivo: 'O monitor está desligado (Ajustes → Estratégia de pautas).' };
  const a = armazem();
  if (!a?.duravel) return { ...base, executou: false, motivo: 'O monitor precisa do banco de dados no servidor para lembrar o que já avisou.' };

  const st = await lerEstado();
  if (st.executando_desde && agora - Date.parse(st.executando_desde) < TRAVA_MS) return { ...base, executou: false, motivo: 'Já há uma rodada em andamento.' };
  if (!forcar && st.ultimo_tick && agora - Date.parse(st.ultimo_tick) < Math.max(1, cfg.intervalo_min - 2) * 60000) return { ...base, executou: false, motivo: `Última rodada há menos de ${cfg.intervalo_min} minutos.` };
  await gravarEstado({ ...st, executando_desde: new Date(agora).toISOString() });

  const hoje = diaSP(agora);
  const resultado = { ...base, executou: true, alertas: [], erros: [], descartadas: 0 };
  let roteirosHoje = st.dia === hoje ? st.roteiros_hoje || 0 : 0;
  const visto = (st.visto || []).filter((v) => agora - Date.parse(v.em) < DIAS_VISTO * 86400000);
  try {
    const descobrir = deps.descobrir || require('./descoberta').descobrir;
    const r = await descobrir({ dias: Math.max(1, Math.ceil(cfg.janela_horas / 24)), recentes: [] });
    resultado.descartadas = (r.descartadas || []).length;
    resultado.ia_usada = !!r.ia?.usada;
    const novas = (r.pautas || []).map((p) => ({ p, alta: emAlta(p, cfg, agora) }))
      .filter(({ p, alta }) => alta.em_alta && (p.prioridade == null || p.prioridade >= cfg.limiar_prioridade))
      .filter(({ p }) => !visto.some((v) => v.id === p.id || Temas.mesmoTema(p.titulo, v.titulo)))
      .sort((x, y) => (y.p.prioridade ?? 0) - (x.p.prioridade ?? 0) || y.alta.n - x.alta.n)
      .slice(0, cfg.max_alertas_por_rodada);

    const temIA = deps.temIA ? deps.temIA() : require('./llmJson').hasLlmKey();
    const criar = deps.criar || ((o) => require('./studio').criar(o));
    const kick = deps.kick || (async (c) => require('../routes/studio')._internos.kick(c));
    for (const { p, alta } of novas) {
      const alerta = { id: p.id, titulo: p.titulo, veiculos: alta.veiculos, horas: alta.horas, prioridade: p.prioridade, roteiro: false, motivo_sem_roteiro: null };
      const link = (p.fontes || []).find((f) => f.url)?.url;
      if (!temIA) alerta.motivo_sem_roteiro = 'Sem chave de IA no servidor.';
      else if (!link) alerta.motivo_sem_roteiro = 'A pauta não tem link de matéria.';
      else if (roteirosHoje >= cfg.max_roteiros_dia) alerta.motivo_sem_roteiro = `Teto de ${cfg.max_roteiros_dia} roteiros por dia atingido.`;
      else {
        try {
          const c = await criar({ url: link, formato: 'carrossel', objetivo: 'seguidores', request_id: `mon:${p.id}`, roteiro_primeiro: true, titulo: p.titulo,
            monitor: { pauta_id: p.id, veiculos: alta.n, veiculos_nomes: alta.veiculos.slice(0, 8), horas: alta.horas, prioridade: p.prioridade ?? null, mecanismo: p.mecanismo || null, por_que_enviaria: p.por_que_enviaria || '', angulo: p.angulo || '', fontes: (p.fontes || []).slice(0, 3) } });
          await kick(c);
          alerta.roteiro = true; alerta.content_id = c.id; roteirosHoje += 1;
        } catch (e) { alerta.motivo_sem_roteiro = e.message; resultado.erros.push(`${p.titulo.slice(0, 60)}: ${e.message}`); }
      }
      visto.push({ id: p.id, titulo: p.titulo, em: new Date(agora).toISOString() });
      resultado.alertas.push(alerta);
    }

    if (resultado.alertas.length) {
      const [um, ...resto] = resultado.alertas;
      const montando = resultado.alertas.filter((x) => x.roteiro).length;
      const corpo = `Em alta: ${um.titulo.slice(0, 90)} (${um.veiculos.length} veículos)${resto.length ? ` e mais ${resto.length}` : ''}.${montando ? ' Estou montando o roteiro.' : ''}`;
      const notificar = deps.notificar || ((o) => require('./push').notificar(o));
      resultado.push = await Promise.resolve(notificar({ corpo, tag: 'monitor-alta', n: resultado.alertas.length })).catch((e) => ({ erro: e.message }));
    }
  } catch (e) {
    resultado.erros.push(e.message);
  } finally {
    await gravarEstado({ ultimo_tick: new Date(agora).toISOString(), dia: hoje, roteiros_hoje: roteirosHoje, visto: visto.slice(-200), ultimo_resultado: { em: resultado.em, alertas: resultado.alertas.map((x) => ({ titulo: x.titulo, veiculos: x.veiculos.length, roteiro: x.roteiro, motivo_sem_roteiro: x.motivo_sem_roteiro })), erros: resultado.erros.slice(0, 5), descartadas: resultado.descartadas } });
  }
  return resultado;
}

module.exports = { tick, estado, emAlta, diaSP };
