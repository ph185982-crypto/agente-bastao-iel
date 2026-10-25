// Pipeline diário do Radar de Negócios, em ETAPAS que gravam o ponto de retomada:
//   coletar → candidatos → verificar → avaliar → selecionar → gerar → notificar
// Cada chamada de `avancar` trabalha até esgotar o orçamento de tempo (a função da Vercel tem 60 s) e devolve o controle;
// quem chamou (cron, botão, fila) chama de novo até `concluida`. Se o servidor cair no meio, a próxima chamada
// continua do último ponto gravado: nenhuma etapa refaz o que já está salvo e nada é gerado duas vezes.
// NUNCA publica: o carrossel fica na fila de aprovação.
const llmJson = require('../llmJson');
const store = require('./store');
const Fontes = require('./fontes');
const Cand = require('./candidatos');
const Verif = require('./verificacao');
const Pont = require('./pontuacao');
const Imagens = require('./imagens');
const Carrossel = require('./carrossel2');
const Aprend = require('./aprendizado');
const C = require('./config');
const U = require('./util');

const ETAPAS = ['coletar', 'candidatos', 'verificar', 'avaliar', 'selecionar', 'gerar', 'notificar'];
const ROTULO_ETAPA = { coletar: 'Lendo as fontes', candidatos: 'Identificando negócios', verificar: 'Verificando fontes e dados', avaliar: 'Avaliando oportunidades', selecionar: 'Escolhendo as cinco melhores', gerar: 'Gerando o carrossel', notificar: 'Avisando você' };
const LEASE_MS = 75000;
const MARGEM_MS = 9000;
const MAX_TENTATIVAS = 3;
const MSG_NOTIFICACAO = 'Uma nova ideia de negócio está pronta para você.';

const agoraDe = (deps) => (deps.agora ? deps.agora() : Date.now());
const novoRun = ({ id, origem, agora }) => ({
  id, tipo: 'execucao', origem, dia: U.diaBRT(agora), estado: 'em_andamento', etapa: ETAPAS[0], etapas: {}, cursor: {}, tentativas: {}, erros: [], avisos: [],
  contadores: { fontes_ativas: 0, fontes_consultadas: 0, fontes_com_falha: 0, itens_lidos: 0, itens_analisados: 0, candidatos_encontrados: 0, duplicados_removidos: 0, ja_usados_removidos: 0, verificados: 0, aprovadas: 0, descartadas: 0, pautas: 0 },
  fontes: [], consumo: { chamadas: 0, tokens_entrada: 0, tokens_saida: 0, custo_usd_estimado: 0, provedores: [] }, resultado: {},
  iniciado_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString(), lease_ate: null, finalizado_em: null,
});

// ── Criar / localizar a execução ────────────────────────────────────────────
async function iniciar({ origem = 'manual', deps: depsEntrada = {}, forcar = false } = {}) {
  const deps = { ...U.depsDeTeste(), ...depsEntrada };
  const agora = agoraDe(deps);
  const cfg = await store.config();
  const dia = U.diaBRT(agora);
  if (origem === 'cron') {
    if (!cfg.ativo && !forcar) return { run: null, ignorada: true, motivo: 'O Radar está desligado.' };
    const id = `rd_${dia.replace(/-/g, '')}_cron`;
    const ja = await store.obter('execucao', id);
    if (ja) return { run: ja.doc, rev: ja.rev, existente: true };
    try { const run = novoRun({ id, origem, agora }); const r = await store.salvar('execucao', id, run, 0); return { run, rev: r.rev, existente: false }; }
    catch (e) { if (e.code === 'CONFLITO') { const j = await store.obter('execucao', id); return { run: j.doc, rev: j.rev, existente: true }; } throw e; }
  }
  const todas = await store.listar('execucao', 60);
  const ativa = todas.find((r) => r.estado === 'em_andamento' && agora - Date.parse(r.atualizado_em) < 15 * 60000);
  if (ativa) return { run: ativa, rev: ativa._rev, existente: true };
  const manuaisHoje = todas.filter((r) => r.dia === dia && r.origem === 'manual').length;
  if (manuaisHoje >= (cfg.max_manuais_dia || C.LIMITE_PESQUISAS_MANUAIS_DIA)) throw U.erro(`O limite de ${cfg.max_manuais_dia} pesquisas manuais por dia foi atingido. A pesquisa automática das 7h continua valendo.`, 'LIMITE_DIARIO', 429);
  const id = `rd_${dia.replace(/-/g, '')}_${agora.toString(36)}`;
  const run = novoRun({ id, origem: 'manual', agora });
  const r = await store.salvar('execucao', id, run, 0);
  return { run, rev: r.rev, existente: false };
}

// ── Consumo de IA ───────────────────────────────────────────────────────────
// Preço público da OpenAI (gpt-4o-mini, US$ por milhão de tokens) só para provedores PAGOS; os gratuitos custam 0.
const PRECO_PAGO = { entrada: 0.15, saida: 0.60 };
function somarConsumo(run, chamadas = []) {
  chamadas.filter((c) => c.ok !== false && c.provider && c.provider !== 'falhou').forEach((c) => {
    run.consumo.chamadas += 1;
    const ent = c.tokens?.entrada || 0; const sai = c.tokens?.saida || 0;
    run.consumo.tokens_entrada += ent; run.consumo.tokens_saida += sai;
    if (c.pago) run.consumo.custo_usd_estimado += (ent * PRECO_PAGO.entrada + sai * PRECO_PAGO.saida) / 1e6;
    if (!run.consumo.provedores.includes(c.provider)) run.consumo.provedores.push(c.provider);
  });
  run.consumo.custo_usd_estimado = Math.round(run.consumo.custo_usd_estimado * 10000) / 10000;
}

// ── Etapas ──────────────────────────────────────────────────────────────────
const E = {};

E.coletar = async (run, ctx) => {
  const r = await Fontes.coletar({ deps: ctx.deps, agora: ctx.agora });
  const ativas = r.status.filter((s) => !s.inativo);
  const ok = ativas.filter((s) => s.ok);
  run.fontes = r.status;
  run.contadores.fontes_ativas = ativas.length; run.contadores.fontes_consultadas = ok.length; run.contadores.fontes_com_falha = ativas.length - ok.length;
  run.contadores.itens_lidos = r.itens.length;
  if (!ok.length) throw U.erro('Nenhuma fonte respondeu. Verifique a conexão do servidor e tente de novo.', 'SEM_FONTES', 502);
  const p = Fontes.preparar(r.itens, { agora: ctx.agora });
  run.contadores.itens_analisados = p.itens.length;
  await store.salvar('coleta', run.id, { itens: p.itens, todos: p.todos.map((i) => ({ id: i.id, titulo: i.titulo, url: i.url, resumo: U.limita(i.resumo, 160), publicada_em: i.publicada_em, fonte_id: i.fonte_id, fonte_nome: i.fonte_nome, fonte_classe: i.fonte_classe })), tendencias: r.tendencias, duplicados_de_itens: p.duplicados, antigos: p.antigos, brutos: [] });
  return { concluida: true };
};

E.candidatos = async (run, ctx) => {
  const reg = await store.obter('coleta', run.id);
  if (!reg) throw U.erro('A coleta desta execução não foi encontrada. Inicie uma nova pesquisa.', 'SEM_COLETA', 409);
  const coleta = reg.doc; const lotes = Cand.lotes(coleta.itens).slice(0, 4);
  let rev = reg.rev;
  while ((run.cursor.lote || 0) < lotes.length) {
    if (ctx.restante() < 22000) return { concluida: false };
    const i = run.cursor.lote || 0;
    const { candidatos } = await ctx.comIA(() => Cand.extrairLote(lotes[i], { deps: ctx.deps }));
    coleta.brutos.push(...candidatos);
    rev = (await store.salvar('coleta', run.id, coleta, rev)).rev;
    run.cursor.lote = i + 1;
    await ctx.checkpoint();
  }
  // junta, remove repetidos e barra o que já foi usado/sugerido
  const encontrados = coleta.brutos;
  const juntos = Cand.juntar(encontrados).map((c) => Cand.reforcarFontes(c, coleta.todos || []));
  const existentes = (await store.listar('oportunidade', 800)).filter((o) => o.run_id !== run.id);
  const { livres, barrados } = Cand.barrarRepetidos(juntos, existentes, { dias: (await store.config()).dias_sem_repetir, agora: ctx.agora, mesmoRunId: run.id });
  run.contadores.candidatos_encontrados = juntos.length;
  run.contadores.duplicados_removidos = encontrados.length - juntos.length;
  run.contadores.ja_usados_removidos = barrados.length;
  run.resultado.barrados = barrados.slice(0, 40).map((b) => ({ nome: b.candidato.nome, motivo: b.motivo }));
  if (juntos.length < C.MIN_CANDIDATOS) run.avisos.push(`Só ${juntos.length} negócios foram identificados (a meta é ${C.MIN_CANDIDATOS}). As fontes do dia trouxeram pouco material.`);
  const agoraISO = new Date(ctx.agora).toISOString();
  for (const c of livres) {
    await store.salvar('oportunidade', c.id, { ...c, tipo: 'oportunidade', status: 'candidata', run_id: run.id, encontrada_em: agoraISO, nota_previa: Cand.notaPrevia(c), decisoes: [] });
  }
  run.cursor.candidatos_ids = livres.map((c) => c.id);
  return { concluida: true };
};

async function lerCand(id) { const r = await store.obter('oportunidade', id); return r ? { doc: r.doc, rev: r.rev } : null; }

E.verificar = async (run, ctx) => {
  if (!run.cursor.fila) {
    const todas = (await Promise.all((run.cursor.candidatos_ids || []).map(lerCand))).filter(Boolean).map((r) => r.doc);
    const ordenadas = todas.sort((a, b) => b.nota_previa - a.nota_previa);
    // No máximo 4 vagas para quem só tem pista de catálogo (Product Hunt, Kickstarter, Show HN): quase nunca trazem número.
    let soCatalogo = 0;
    const fila = ordenadas.filter((c) => !c.sinais_de_risco.length).filter((c) => { const so = !c.fontes_itens.some((f) => f.fonte_classe === 'imprensa'); if (so) { soCatalogo += 1; return soCatalogo <= 4; } return true; }).slice(0, C.MAX_VERIFICAR).map((c) => c.id);
    run.cursor.fila = fila; run.cursor.verificar_idx = 0;
    // quem não entrou na fila é descartado com motivo claro (pode voltar em 14 dias)
    for (const c of ordenadas.filter((x) => !fila.includes(x.id))) {
      const motivo = c.sinais_de_risco.length ? `Sinal de ${C.SINAIS_DESCARTE[c.sinais_de_risco[0]]}.` : 'Não passou na pré-seleção (pouco material ou pouca relevância para o perfil).';
      await store.atualizar('oportunidade', c.id, (o) => { o.status = 'descartada'; o.descartada_motivo = motivo; return o; });
    }
    await ctx.checkpoint();
  }
  const fila = run.cursor.fila;
  while (run.cursor.verificar_idx < fila.length) {
    if (ctx.restante() < 30000) return { concluida: false };
    const lote = fila.slice(run.cursor.verificar_idx, run.cursor.verificar_idx + 3);
    await Promise.all(lote.map(async (id) => {
      const reg = await lerCand(id); if (!reg) return;
      let resultado;
      try { resultado = await ctx.comIA(() => Verif.verificar(reg.doc, { deps: ctx.deps, agora: ctx.agora })); }
      catch (e) { if (['SEM_IA', 'LIMITE'].includes(e.code) || U.erroTemporario(e)) throw e; resultado = { verificacao: { estado: 'insuficiente', claims: [], fontes: [], numeros_usaveis: [], motivos: [`Falha ao verificar: ${U.limita(e.message, 120)}`], limitacoes: [], existencia_confirmada: false, demanda_verificada: 0, claims_rejeitadas: [] } }; run.avisos.push(`Falha ao verificar ${reg.doc.nome}: ${U.limita(e.message, 100)}`); }
      const v = resultado.verificacao;
      await store.atualizar('oportunidade', id, (o) => {
        o.verificacao = v; o.verificada_em = new Date(ctx.agora).toISOString();
        if (v.estado === 'reprovada') { o.status = 'descartada'; o.descartada_motivo = v.descartar?.motivo || v.motivos[0] || 'Reprovada na verificação.'; }
        else o.status = v.estado === 'verificada' ? 'verificada' : 'insuficiente';
        return o;
      });
    }));
    run.cursor.verificar_idx += lote.length; run.contadores.verificados = run.cursor.verificar_idx;
    await ctx.checkpoint();
  }
  return { concluida: true };
};

E.avaliar = async (run, ctx) => {
  const docs = (await Promise.all((run.cursor.fila || []).map(lerCand))).filter(Boolean).map((r) => r.doc).filter((o) => o.verificacao && o.status !== 'descartada');
  if (!docs.length) return { concluida: true };
  if (!run.cursor.imagens_ok) {
    await U.emParalelo(docs.filter((o) => o.verificacao.estado === 'verificada'), 4, async (o) => {
      if (ctx.restante() < 12000) return;
      try { const b = await U.comTimeout(Imagens.buscar(o, { papel: 'negocio', deps: ctx.deps, agora: ctx.agora }), 25000, 'a busca de imagem'); if (b.ok) { o.imagem = await Imagens.guardar(store, o.id, b); } else o.imagem_motivo = b.motivo; }
      catch (e) { o.imagem_motivo = U.limita(e.message, 100); }
      await store.atualizar('oportunidade', o.id, (x) => { x.imagem = o.imagem || null; x.imagem_motivo = o.imagem_motivo || null; return x; });
    });
    run.cursor.imagens_ok = true; await ctx.checkpoint();
    return { concluida: false, continuar: true };
  }
  const recarregadas = (await Promise.all(docs.map((d) => lerCand(d.id)))).filter(Boolean).map((r) => r.doc);
  const { avaliacoes } = await ctx.comIA(() => Pont.avaliarLote(recarregadas, { deps: ctx.deps }));
  for (const o of recarregadas) {
    const a = avaliacoes.get(o.id);
    const r = Pont.aplicar(o, a);
    await store.atualizar('oportunidade', o.id, (x) => {
      Object.assign(x, { criterios: r.criterios, pontuacao: r.pontuacao, pontuacao_exata: r.pontuacao_exata, motivo_avaliacao: r.motivo_geral, avaliada_em: new Date(ctx.agora).toISOString() });
      if (!a) x.avisos = [...(x.avisos || []), 'A IA não avaliou esta oportunidade: a pontuação usa só os limites impostos pela verificação.'];
      const sinais = r.sinais_da_avaliacao.filter((s) => ['piramide', 'aposta', 'renda_garantida', 'enriquecimento_rapido', 'ilegal', 'especulacao', 'patrocinado', 'franquia'].includes(s));
      if (sinais.length) { x.status = 'descartada'; x.descartada_motivo = `Sinal de ${C.SINAIS_DESCARTE[sinais[0]]} apontado na avaliação.`; }
      return x;
    });
  }
  return { concluida: true };
};

E.selecionar = async (run, ctx) => {
  const docs = (await Promise.all((run.cursor.fila || []).map(lerCand))).filter(Boolean).map((r) => r.doc).filter((o) => o.pontuacao !== undefined && o.status !== 'descartada');
  const aprend = await Aprend.pesos();
  const { escolhidas, auto } = Pont.selecionar(docs, { limiar: (await store.config()).limiar || C.LIMIAR_CARROSSEL, aprendizado: aprend });
  const ids = new Set(escolhidas.map((c) => c.id));
  for (const c of escolhidas) {
    await store.atualizar('oportunidade', c.id, (o) => { o.rank = c.rank; o.top5_em = new Date(ctx.agora).toISOString(); o.status = (o.verificacao.estado === 'verificada' && o.pontuacao >= C.LIMIAR_CARROSSEL) ? 'aprovada' : 'pauta'; return o; });
  }
  let descartadas = 0;
  for (const o of docs.filter((d) => !ids.has(d.id))) { descartadas += 1; await store.atualizar('oportunidade', o.id, (x) => { x.status = 'descartada'; x.descartada_motivo = x.descartada_motivo || `Ficou fora das cinco melhores (${x.pontuacao} pontos).`; return x; }); }
  const todos = await Promise.all((run.cursor.candidatos_ids || []).map(lerCand));
  run.contadores.descartadas = todos.filter((r) => r && r.doc.status === 'descartada').length;
  run.contadores.aprovadas = escolhidas.filter((c) => c.verificacao.estado === 'verificada' && c.pontuacao >= C.LIMIAR_CARROSSEL).length;
  run.contadores.pautas = escolhidas.length;
  run.resultado.top5 = escolhidas.map((c) => ({ id: c.id, nome: c.nome, pontuacao: c.pontuacao, rank: c.rank, estado: c.verificacao.estado }));
  run.resultado.auto_id = auto ? auto.id : null;
  if (!auto) run.resultado.sem_carrossel_motivo = escolhidas.length ? `Nenhuma oportunidade verificada chegou a ${C.LIMIAR_CARROSSEL} pontos com número comprovado (a melhor teve ${escolhidas[0].pontuacao}).` : 'Nenhuma oportunidade passou na verificação.';
  void descartadas;
  return { concluida: true };
};

E.gerar = async (run, ctx) => {
  const id = run.resultado.auto_id;
  if (!id) return { concluida: true };
  if (run.resultado.carrossel_id) return { concluida: true };
  if (ctx.restante() < 26000) return { concluida: false };
  try {
    // Padrão da descoberta de negócios: série "Negócios que você não viu". Se a IA não resolver todos os problemas de texto, o carrossel
    // segue como RASCUNHO com os bloqueios visíveis no editor (não some nem é descartado).
    const doc = await ctx.comIA(() => Carrossel.gerar(id, { deps: ctx.deps, origem: run.origem, agora: ctx.agora, orcamentoMs: Math.max(20000, ctx.restante() - 6000) }));
    if (doc.etapa !== 'pronto' && doc.estado !== 'erro') return { concluida: false };     // etapa interna ainda em andamento: continua na próxima passada
    run.resultado.carrossel_id = doc.id; run.resultado.carrossel_estado = doc.estado;
  } catch (e) {
    if (['SEM_IA', 'LIMITE'].includes(e.code) || U.erroTemporario(e)) throw e;     // limite da IA: espera e tenta de novo, não desiste do carrossel
    run.resultado.carrossel_erro = U.limita(e.message, 240); run.avisos.push(`Não consegui gerar o carrossel: ${U.limita(e.message, 160)}`);
  }
  return { concluida: true };
};

E.notificar = async (run, ctx) => {
  if (run.resultado.notificado_em) return { concluida: true };
  const notificar = ctx.deps.notificar || ((o) => require('../push').notificar(o));
  const temCarrossel = !!run.resultado.carrossel_id;
  const corpo = temCarrossel ? MSG_NOTIFICACAO : run.resultado.top5?.length ? `O Radar separou ${run.resultado.top5.length} pautas, mas nenhuma chegou a ${C.LIMIAR_CARROSSEL} pontos com prova. Veja na aba Radar.` : 'O Radar não encontrou oportunidades confirmadas hoje.';
  try { run.resultado.push = await Promise.resolve(notificar({ corpo, url: '/?tab=radar', tag: 'radar-nova-ideia', n: temCarrossel ? 1 : 0 })); }
  catch (e) { run.resultado.push = { erro: U.limita(e.message, 100) }; }
  run.resultado.notificado_em = new Date(ctx.agora).toISOString(); run.resultado.notificacao = corpo;
  return { concluida: true };
};

// ── Motor ───────────────────────────────────────────────────────────────────
const erroTemporario = U.erroTemporario;

// `avancar` trabalha até o orçamento acabar. Devolve { run, concluida, ocupado, esperar_s }.
async function avancar(runId, { deps: depsEntrada = {}, orcamentoMs = 44000 } = {}) {
  const deps = { ...U.depsDeTeste(), ...depsEntrada };
  const inicio = Date.now();
  let reg = await store.obter('execucao', runId);
  if (!reg) throw U.erro('Execução não encontrada.', 'NAO_ENCONTRADA', 404);
  let run = reg.doc; let rev = reg.rev;
  if (run.estado !== 'em_andamento') return { run, concluida: true };
  const agora0 = agoraDe(deps);
  if (run.lease_ate && Date.parse(run.lease_ate) > agora0) return { run, ocupado: true, concluida: false };
  if (run.esperar_ate && !deps.semEspera && Date.parse(run.esperar_ate) > agora0) return { run, concluida: false, esperar_s: Math.ceil((Date.parse(run.esperar_ate) - agora0) / 1000) };
  const dono = U.sha(`${runId}${agora0}${Math.random()}`, 8);
  run.lease_ate = new Date(agora0 + LEASE_MS).toISOString(); run.lease_dono = dono;
  try { rev = (await store.salvar('execucao', runId, run, rev)).rev; } catch (e) { if (e.code === 'CONFLITO') return { run, ocupado: true, concluida: false }; throw e; }

  const ctx = {
    deps, agora: agora0,
    restante: () => orcamentoMs - (Date.now() - inicio),
    checkpoint: async () => { run.atualizado_em = new Date(agoraDe(deps)).toISOString(); run.lease_ate = new Date(agoraDe(deps) + LEASE_MS).toISOString(); rev = (await store.salvar('execucao', runId, run, rev)).rev; },
    comIA: async (fn) => {
      if (deps.pedirJson) return fn();                               // testes: sem registro de consumo
      const { resultado, consumo } = await llmJson.comConsumo(() => llmJson.comPrazo(Math.max(12000, ctx.restante() - 2000), fn));
      somarConsumo(run, consumo.chamadas); return resultado;
    },
  };
  let esperar = 0;
  try {
    while (run.estado === 'em_andamento' && ctx.restante() > MARGEM_MS) {
      const etapa = run.etapa; const fn = E[etapa];
      run.etapas[etapa] ||= { iniciada_em: new Date(agoraDe(deps)).toISOString() };
      try {
        const r = await fn(run, ctx);
        if (!r.concluida) { if (r.continuar) continue; break; }
        run.etapas[etapa].concluida_em = new Date(agoraDe(deps)).toISOString();
        const prox = ETAPAS[ETAPAS.indexOf(etapa) + 1];
        if (!prox) { run.estado = run.erros.length || run.avisos.length ? 'concluida_com_avisos' : 'concluida'; run.finalizado_em = new Date(agoraDe(deps)).toISOString(); run.etapa = 'fim'; }
        else run.etapa = prox;
        run.tentativas[etapa] = 0;
        await ctx.checkpoint();
      } catch (e) {
        if (e.code === 'CONFLITO') { return { run, ocupado: true, concluida: false }; }
        const n = (run.tentativas[etapa] = (run.tentativas[etapa] || 0) + 1);
        run.erros.push({ etapa, em: new Date(agoraDe(deps)).toISOString(), mensagem: U.limita(e.message, 220), codigo: e.code || null, tentativa: n });
        const terminal = ['SEM_IA', 'SEM_BANCO', 'SEM_COLETA'].includes(e.code) || n >= MAX_TENTATIVAS;
        if (terminal) {
          // gerar/notificar não derrubam a pesquisa: os dados já estão salvos
          if (etapa === 'gerar') { run.resultado.carrossel_erro = U.limita(e.message, 240); run.etapas[etapa].concluida_em = new Date(agoraDe(deps)).toISOString(); run.etapa = 'notificar'; await ctx.checkpoint(); continue; }
          if (etapa === 'notificar') { run.estado = 'concluida_com_avisos'; run.finalizado_em = new Date(agoraDe(deps)).toISOString(); await ctx.checkpoint(); break; }
          run.estado = 'erro'; run.finalizado_em = new Date(agoraDe(deps)).toISOString(); run.erro_final = { etapa, mensagem: e.code === 'SEM_IA' ? 'Nenhuma chave de IA está configurada no servidor.' : U.limita(e.message, 200) };
          await ctx.checkpoint(); break;
        }
        esperar = Math.min(120, 15 * n); run.esperar_ate = new Date(agoraDe(deps) + esperar * 1000).toISOString();
        await ctx.checkpoint(); break;
      }
    }
  } catch (e) {
    // falha do próprio banco: o que já estava gravado continua valendo e a próxima chamada retoma
    return { run, concluida: false, erro_banco: U.limita(e.message, 160) };
  }
  try { run.lease_ate = null; run.lease_dono = null; run.atualizado_em = new Date(agoraDe(deps)).toISOString(); await store.salvar('execucao', runId, run, rev); } catch { /* lease expira sozinho */ }
  return { run, concluida: run.estado !== 'em_andamento', esperar_s: esperar || undefined };
}

// Roda até acabar ou até `maxMs` (usado pelo botão no servidor local e pelos testes).
async function executarTudo(runId, { deps = {}, maxMs = 20 * 60000, orcamentoMs = 44000 } = {}) {
  const t0 = Date.now(); let r;
  do { r = await avancar(runId, { deps, orcamentoMs }); if (r.concluida) break; if (r.esperar_s && deps.semEspera !== true) await new Promise((x) => setTimeout(x, Math.min(r.esperar_s, 5) * 1000)); else if (r.ocupado) await new Promise((x) => setTimeout(x, 500)); } while (Date.now() - t0 < maxMs);
  return r;
}

// Execuções paradas (processo morreu): quem chama (estado, cron) as retoma.
async function pendentes({ agora = Date.now() } = {}) {
  if (!store.disponivel()) return [];
  const todas = await store.listar('execucao', 20);
  return todas.filter((r) => r.estado === 'em_andamento' && (!r.lease_ate || Date.parse(r.lease_ate) < agora) && agora - Date.parse(r.atualizado_em) < 6 * 3600000);
}

function progresso(run) {
  const i = Math.max(0, ETAPAS.indexOf(run.etapa)); const total = ETAPAS.length;
  let detalhe = ROTULO_ETAPA[run.etapa] || 'Concluído';
  if (run.etapa === 'verificar' && run.cursor.fila) detalhe += ` (${run.cursor.verificar_idx || 0}/${run.cursor.fila.length})`;
  if (run.etapa === 'candidatos') detalhe += ` (lote ${(run.cursor.lote || 0) + 1})`;
  const pct = run.estado === 'em_andamento' ? Math.round((i / total) * 100) : run.estado === 'erro' ? Math.round((i / total) * 100) : 100;
  return { etapa: run.etapa, indice: i + 1, total, rotulo: detalhe, percentual: pct };
}

module.exports = { iniciar, avancar, executarTudo, pendentes, progresso, ETAPAS, ROTULO_ETAPA, MSG_NOTIFICACAO, novoRun, somarConsumo, erroTemporario };
