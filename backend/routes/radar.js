// Radar de Negócios: API. Nada aqui publica no Instagram: o carrossel fica na fila de aprovação do Radar
// e o Pedro baixa o ZIP, posta por conta própria e marca como publicado.
const express = require('express');
const sharp = require('sharp');
const store = require('../lib/radar/store');
const pipeline = require('../lib/radar/pipeline');
const Carrossel = require('../lib/radar/carrossel');
const Aprend = require('../lib/radar/aprendizado');
const Copy = require('../lib/radar/copy');
const Fila = require('../lib/radar/fila');
const C = require('../lib/radar/config');
const U = require('../lib/radar/util');
const llmJson = require('../lib/llmJson');
const { limita } = require('../lib/access');

const router = express.Router();
const erro = (res, e) => res.status(e.status || (e.code === 'CONFLITO' ? 409 : 500)).json({ error: e.status || e.code === 'CONFLITO' ? e.message : `Erro no Radar: ${U.limita(e.message, 160)}`, code: e.code || 'RADAR', ...(e.erros ? { erros: e.erros } : {}) });
const rota = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { if (!res.headersSent) erro(res, e); } };
const ID = /^[\w.-]{3,80}$/;
const exigeId = (id) => { if (!ID.test(String(id))) throw U.erro('Identificador inválido.', 'ENTRADA', 400); return id; };

// ── Apresentação ────────────────────────────────────────────────────────────
function resumoDemanda(o) {
  const usaveis = (o.verificacao?.claims || []).filter((c) => c.usavel && c.numero !== null && ['usuarios', 'clientes', 'crescimento', 'vendas', 'receita', 'avaliacoes_app', 'tendencia', 'paises'].includes(c.tipo));
  if (usaveis.length) return { confirmada: true, itens: usaveis.slice(0, 3).map((c) => ({ texto: c.texto, valor: c.valor_exibicao, atribuicao: c.atribuicao, tipo: c.tipo })) };
  return { confirmada: false, itens: [], citada: o.prova_demanda_citada && o.prova_demanda_citada !== 'não informado' ? o.prova_demanda_citada : null };
}
function visao(o, { detalhe = false } = {}) {
  const v = o.verificacao || {};
  const base = {
    id: o.id, nome: o.nome, pais: o.pais, categoria: o.categoria, categoria_rotulo: C.CATEGORIAS[o.categoria], ia: !!o.ia, resumo: o.resumo, como_ganha_dinheiro: o.como_ganha_dinheiro,
    modelo_receita: o.modelo_receita, prova_demanda: resumoDemanda(o), investimento_para_testar: o.investimento_para_testar, adaptacao_brasil: o.adaptacao_brasil,
    pontuacao: o.pontuacao ?? null, status: o.status, rank: o.rank ?? null, descartada_motivo: o.descartada_motivo || null,
    verificacao_estado: v.estado || null, fonte_oficial: v.fonte_oficial || null,
    fontes: (v.fontes?.length ? v.fontes : (o.fontes_itens || []).map((f) => ({ url: f.url, veiculo: f.fonte_nome, classe: f.fonte_classe, publicada_em: f.publicada_em }))).map((f) => ({ url: f.url, veiculo: f.veiculo, classe: f.classe, publicada_em: f.publicada_em, acessada_em: f.acessada_em || null })),
    imagem: o.imagem?.arquivo ? { url: `/api/radar/oportunidades/${o.id}/imagem`, tipo: o.imagem.tipo, descricao: o.imagem.descricao, origem: o.imagem.origem, licenca: o.imagem.licenca } : null,
    imagem_motivo: o.imagem_motivo || null, encontrada_em: o.encontrada_em, carrossel_id: o.carrossel_id || null, reels: !!o.reels_id, run_id: o.run_id,
    marcas: { baixo_investimento: o.investimento_para_testar?.nivel === 'baixo', adaptavel_brasil: (o.criterios?.brasil?.nivel ?? 0) >= 2, ia: !!o.ia },
    elegivel_carrossel: v.estado === 'verificada' && (v.numeros_usaveis || []).length > 0, motivo_sem_carrossel: v.estado !== 'verificada' ? 'Ainda sem fonte oficial ou duas fontes independentes.' : !(v.numeros_usaveis || []).length ? 'Nenhum número comprovado para a tela de prova.' : null,
  };
  if (!detalhe) return base;
  return { ...base, problema: o.problema, solucao: o.solucao, criterios: o.criterios || null, motivo_avaliacao: o.motivo_avaliacao || null, verificacao: { ...v, claims: (v.claims || []) }, decisoes: o.decisoes || [], avisos: o.avisos || [], carrosseis: o.carrosseis || [], limiar: C.LIMIAR_CARROSSEL };
}
const visaoCarrossel = (c, op) => ({
  id: c.id, op_id: c.op_id, versao: c.versao, estado: c.estado, etapa: c.etapa, nome: op?.nome || null, categoria: op?.categoria || null, pontuacao: op?.pontuacao ?? null,
  criado_em: c.criado_em, pronto_em: c.pronto_em || null, slides: (c.render || []).map((r) => ({ n: r.n, url: `/api/radar/carrosseis/${c.id}/slide/${r.n}`, cabe: r.metricas?.cabe })),
  textos: (c.copia?.slides || []).map((s) => ({ n: s.n, funcao: s.funcao, texto: s.texto, palavras: s.palavras })), legenda: c.copia?.legenda || null, hashtags: c.copia?.hashtags || [],
  imagens: c.imagens || [], avisos: c.avisos || [], erro: c.erro || null, zip: c.pacote ? { url: `/api/radar/carrosseis/${c.id}/zip`, bytes: c.pacote.bytes, nome: c.pacote.nome_download, arquivos: c.pacote.arquivos } : null,
  ficha_markdown: c.ficha_markdown || null, decisao: c.decisao || null, publicacao: c.publicacao || null, metricas: c.metricas || null, excecao_limiar: !!c.excecao_limiar, historico: (c.historico || []).slice(-10),
});

// ── Estado geral ────────────────────────────────────────────────────────────
router.get('/estado', rota(async (req, res) => {
  const agora = Date.now();
  const base = {
    proxima_pesquisa: U.proximaExecucao(agora), agenda: { cron_utc: '0 10 * * *', horario_brasilia: '07:00', conversao: 'Brasília é UTC−3 o ano todo (sem horário de verão desde 2019): 07:00 BRT = 10:00 UTC.' },
    ia_configurada: llmJson.hasLlmKey(), banco: store.disponivel(), push: require('../lib/push').configurado(), limiar: C.LIMIAR_CARROSSEL, filtros: C.FILTROS,
    fontes_configuradas: C.FONTES.map((f) => ({ id: f.id, nome: f.nome, idioma: f.idioma, classe: f.classe, ativa: !f.inativo, motivo_inativa: f.inativo || null })).concat(C.FONTES_API.map((f) => ({ id: f.id, nome: f.nome, idioma: 'en', classe: f.classe, ativa: true, motivo_inativa: null }))),
    termos: { en: C.TERMOS_EN, pt: C.TERMOS_PT }, publicacao_automatica: false,
  };
  if (!store.disponivel()) return res.json({ ...base, sem_banco: true, aviso: 'O Radar precisa do banco de dados no servidor (Cópia no servidor) para guardar as pesquisas.' });
  const [runs, ops, carrosseis, cfg] = await Promise.all([store.listar('execucao', 15), store.listar('oportunidade', 800), store.listar('carrossel', 100), store.config()]);
  const ultima = runs[0] || null; const concluida = runs.find((r) => r.estado !== 'em_andamento' && r.estado !== 'erro') || null;
  const ativa = runs.find((r) => r.estado === 'em_andamento') || null;
  const aprovacao = carrosseis.filter((c) => c.estado === 'aguardando_aprovacao');
  // retoma execução parada (processo morreu no meio): o ponto de retomada está gravado
  if (ativa && (!ativa.lease_ate || Date.parse(ativa.lease_ate) < agora) && agora - Date.parse(ativa.atualizado_em) > 60000 && cfg.ativo !== false) Fila.continuar(ativa.id).catch(() => {});
  const doRun = (ultima && ultima.contadores) || null;
  res.json({
    ...base, config: cfg,
    ultima_pesquisa: concluida ? { id: concluida.id, em: concluida.finalizado_em || concluida.atualizado_em, origem: concluida.origem, estado: concluida.estado } : null,
    execucao_ativa: ativa ? { id: ativa.id, origem: ativa.origem, progresso: pipeline.progresso(ativa), iniciado_em: ativa.iniciado_em, atualizado_em: ativa.atualizado_em, esperar_ate: ativa.esperar_ate || null } : null,
    metricas: {
      fontes_consultadas: (concluida || ultima)?.contadores?.fontes_consultadas ?? 0, fontes_ativas: (concluida || ultima)?.contadores?.fontes_ativas ?? 0,
      oportunidades_encontradas: (concluida || ultima)?.contadores?.candidatos_encontrados ?? 0, aprovadas: (concluida || ultima)?.contadores?.aprovadas ?? 0, descartadas: (concluida || ultima)?.contadores?.descartadas ?? 0,
      total_guardadas: ops.length, total_descartadas: ops.filter((o) => ['descartada', 'descartada_usuario'].includes(o.status)).length, na_ultima_pesquisa: doRun,
    },
    resultado_ultima: concluida ? { top5: concluida.resultado?.top5 || [], carrossel_id: concluida.resultado?.carrossel_id || null, sem_carrossel_motivo: concluida.resultado?.sem_carrossel_motivo || null, avisos: concluida.avisos || [], erros: (concluida.erros || []).slice(-3), consumo: concluida.consumo, fontes: concluida.fontes, notificacao: concluida.resultado?.notificacao || null } : null,
    fila_aprovacao: aprovacao.length, nova_ideia: aprovacao.length > 0,
  });
}));

router.get('/fontes', rota(async (req, res) => {
  const runs = store.disponivel() ? await store.listar('execucao', 5) : [];
  res.json({ fontes: runs[0]?.fontes || [], run: runs[0]?.id || null, consultado_em: runs[0]?.atualizado_em || null });
}));

// ── Execuções ───────────────────────────────────────────────────────────────
router.post('/pesquisar', limita({ max: 4, janelaMs: 60000, nome: 'radar-pesquisar' }), rota(async (req, res) => {
  if (!llmJson.hasLlmKey()) throw U.erro('Nenhuma chave de IA está configurada no servidor.', 'SEM_IA', 503);
  if (!store.disponivel()) throw U.erro('O Radar precisa do banco de dados no servidor.', 'SEM_BANCO', 503);
  const r = await pipeline.iniciar({ origem: 'manual' });
  await Fila.continuar(r.run.id);
  res.status(202).json({ run_id: r.run.id, existente: r.existente, progresso: pipeline.progresso(r.run) });
}));

router.get('/execucoes/:id', rota(async (req, res) => {
  const r = await store.obter('execucao', exigeId(req.params.id));
  if (!r) throw U.erro('Execução não encontrada.', 'NAO_ENCONTRADA', 404);
  res.json({ id: r.doc.id, estado: r.doc.estado, origem: r.doc.origem, progresso: pipeline.progresso(r.doc), contadores: r.doc.contadores, avisos: r.doc.avisos, erros: r.doc.erros.slice(-3), resultado: r.doc.resultado, erro_final: r.doc.erro_final || null, consumo: r.doc.consumo, iniciado_em: r.doc.iniciado_em, finalizado_em: r.doc.finalizado_em });
}));
// Avança a execução dentro desta requisição (o app aberto conduz; a fila e o cron são reforço).
router.post('/execucoes/:id/passo', limita({ max: 30, janelaMs: 60000, nome: 'radar-passo' }), rota(async (req, res) => {
  const r = await pipeline.avancar(exigeId(req.params.id), { orcamentoMs: process.env.VERCEL ? 42000 : 30000 });
  res.json({ concluida: r.concluida, ocupado: !!r.ocupado, esperar_s: r.esperar_s || null, erro_banco: r.erro_banco || null, estado: r.run.estado, progresso: pipeline.progresso(r.run), contadores: r.run.contadores, resultado: r.run.resultado, avisos: r.run.avisos, erros: r.run.erros.slice(-3), erro_final: r.run.erro_final || null });
}));

// Cron diário (Vercel: 0 10 * * * UTC = 07:00 de Brasília). Idempotente: uma execução por dia.
async function cron(req, res) {
  const a = await pipeline.iniciar({ origem: 'cron' });
  if (a.ignorada) return res.json({ ok: true, ignorada: true, motivo: a.motivo });
  const pend = a.existente ? [] : [a.run];
  if (a.existente && a.run.estado === 'em_andamento') pend.push(a.run);
  if (!pend.length) return res.json({ ok: true, run_id: a.run.id, existente: true, estado: a.run.estado });
  if (!llmJson.hasLlmKey()) { await Fila.continuar(a.run.id).catch(() => {}); return res.status(503).json({ error: 'Nenhuma chave de IA está configurada no servidor.', code: 'SEM_IA', run_id: a.run.id }); }
  const r = await pipeline.avancar(a.run.id, { orcamentoMs: 42000 });
  if (!r.concluida) await Fila.continuar(a.run.id, { atrasoS: r.esperar_s || 0 });
  res.json({ ok: true, run_id: a.run.id, concluida: r.concluida, estado: r.run.estado, progresso: pipeline.progresso(r.run), continua_em_segundo_plano: !r.concluida });
}
router.get('/cron', rota(cron));
router.post('/cron', rota(cron));

// ── Oportunidades ───────────────────────────────────────────────────────────
const STATUS_GRUPOS = { ativas: ['aprovada', 'pauta', 'salva', 'carrossel_gerado'], descartadas: ['descartada', 'descartada_usuario'], usadas: ['usada'], todas: null };
function passaFiltro(o, f) {
  if (!f || f === 'todos') return true;
  if (Object.keys(C.CATEGORIAS).includes(f)) return o.categoria === f;
  if (f === 'ia') return !!o.ia;
  if (f === 'baixo_investimento') return o.investimento_para_testar?.nivel === 'baixo';
  if (f === 'adaptavel_brasil') return (o.criterios?.brasil?.nivel ?? 0) >= 2;
  return true;
}
router.get('/oportunidades', rota(async (req, res) => {
  if (!store.disponivel()) return res.json({ oportunidades: [], sem_banco: true });
  const grupo = STATUS_GRUPOS[req.query.status] !== undefined ? req.query.status : 'ativas';
  const lista = (await store.listar('oportunidade', 800)).filter((o) => (STATUS_GRUPOS[grupo] ? STATUS_GRUPOS[grupo].includes(o.status) : o.status !== 'candidata')).filter((o) => passaFiltro(o, String(req.query.filtro || 'todos')));
  lista.sort((a, b) => (b.pontuacao ?? -1) - (a.pontuacao ?? -1) || Date.parse(b.encontrada_em) - Date.parse(a.encontrada_em));
  res.json({ oportunidades: lista.slice(0, 100).map((o) => visao(o)), total: lista.length, grupo });
}));
router.get('/oportunidades/:id', rota(async (req, res) => {
  const r = await store.obter('oportunidade', exigeId(req.params.id)); if (!r) throw U.erro('Oportunidade não encontrada.', 'NAO_ENCONTRADA', 404);
  const reels = r.doc.reels_id ? (await store.obter('reels', r.doc.reels_id))?.doc : null;
  res.json({ ...visao(r.doc, { detalhe: true }), reels });
}));
router.get('/oportunidades/:id/imagem', rota(async (req, res) => {
  const r = await store.obter('oportunidade', exigeId(req.params.id)); if (!r?.doc.imagem?.arquivo) return res.status(404).end();
  const a = await store.arquivoObter(r.doc.imagem.arquivo); if (!a) return res.status(404).end();
  res.set({ 'Content-Type': a.tipo || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).end(a.dados);
}));

const CAMPOS_EDITAVEIS = { nome: 80, pais: 40, resumo: 240, como_ganha_dinheiro: 280, adaptacao_brasil: 280, problema: 280, solucao: 280 };
router.post('/oportunidades/:id/acao', limita({ max: 20, janelaMs: 60000, nome: 'radar-acao' }), rota(async (req, res) => {
  const id = exigeId(req.params.id); const { acao } = req.body || {}; const agora = new Date().toISOString();
  const reg = await store.obter('oportunidade', id); if (!reg) throw U.erro('Oportunidade não encontrada.', 'NAO_ENCONTRADA', 404);
  const registrar = (o, extra = {}) => { (o.decisoes ||= []).push({ em: agora, acao, por: 'pedro', ...extra }); return o; };
  const saida = async (fn) => { const { doc } = await store.atualizar('oportunidade', id, fn); return res.json(visao(doc, { detalhe: true })); };
  if (acao === 'salvar_pauta') return saida((o) => { o.status = 'salva'; return registrar(o); });
  if (acao === 'descartar') return saida((o) => { o.status = 'descartada_usuario'; o.descartada_motivo = U.limita(req.body.motivo, 200) || 'Descartada por você.'; return registrar(o, { motivo: o.descartada_motivo }); });
  if (acao === 'marcar_usada') return saida((o) => { o.status = 'usada'; return registrar(o); });
  if (acao === 'restaurar') return saida((o) => { o.status = o.pontuacao >= C.LIMIAR_CARROSSEL && o.verificacao?.estado === 'verificada' ? 'aprovada' : 'pauta'; o.descartada_motivo = null; return registrar(o); });
  if (acao === 'editar') {
    const novos = {}; const campos = req.body.campos || {};
    for (const [k, max] of Object.entries(CAMPOS_EDITAVEIS)) if (typeof campos[k] === 'string') novos[k] = U.limita(campos[k], max);
    if (campos.categoria && C.CATEGORIAS[campos.categoria]) novos.categoria = campos.categoria;
    if (!Object.keys(novos).length) throw U.erro('Nada para editar.', 'ENTRADA');
    if ('nome' in novos && novos.nome.length < 2) throw U.erro('O nome é curto demais.', 'ENTRADA');
    return saida((o) => { const antes = {}; Object.keys(novos).forEach((k) => { antes[k] = o[k]; o[k] = novos[k]; }); return registrar(o, { antes, depois: novos, nota: 'Edição só de texto descritivo: números e fontes continuam os verificados.' }); });
  }
  if (acao === 'gerar_carrossel') {
    if (!llmJson.hasLlmKey()) throw U.erro('Nenhuma chave de IA está configurada no servidor.', 'SEM_IA', 503);
    const existentes = reg.doc.carrosseis || [];
    const ultimo = existentes.length ? (await store.obter('carrossel', existentes[existentes.length - 1]))?.doc : null;
    const retomar = ultimo && ['gerando', 'erro'].includes(ultimo.estado);
    if (ultimo && !retomar && req.body.nova_versao !== true) return res.json({ carrossel: visaoCarrossel(ultimo, reg.doc), existente: true });
    const versao = ultimo ? (retomar ? ultimo.versao : existentes.length + 1) : 1;
    const doc = await Carrossel.gerar(id, { deps: U.depsDeTeste(), versao, permitirBaixa: req.body.permitir_baixa === true, origem: 'manual' });
    return res.json({ carrossel: visaoCarrossel(doc, reg.doc) });
  }
  if (acao === 'gerar_reels') {
    if (!llmJson.hasLlmKey()) throw U.erro('Nenhuma chave de IA está configurada no servidor.', 'SEM_IA', 503);
    Carrossel.exigirVerificada(reg.doc, { permitirBaixa: true });
    const r = await Copy.gerarReels(reg.doc, { deps: U.depsDeTeste() });
    const rid = `rl_${id.replace(/^op_/, '')}_${Date.now().toString(36)}`;
    await store.salvar('reels', rid, { op_id: id, criado_em: agora, ...r });
    await store.atualizar('oportunidade', id, (o) => { o.reels_id = rid; return registrar(o, { reels_id: rid }); });
    return res.json({ reels: { id: rid, ...r } });
  }
  throw U.erro('Ação desconhecida.', 'ENTRADA');
}));

// ── Carrosséis e fila de aprovação ──────────────────────────────────────────
router.get('/carrosseis', rota(async (req, res) => {
  if (!store.disponivel()) return res.json({ carrosseis: [] });
  const [cs, ops] = await Promise.all([store.listar('carrossel', 60), store.listar('oportunidade', 800)]);
  const porId = new Map(ops.map((o) => [o.id, o]));
  res.json({ carrosseis: cs.map((c) => visaoCarrossel(c, porId.get(c.op_id))) });
}));
router.get('/carrosseis/:id', rota(async (req, res) => {
  const r = await store.obter('carrossel', exigeId(req.params.id)); if (!r) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const op = (await store.obter('oportunidade', r.doc.op_id))?.doc;
  res.json({ ...visaoCarrossel(r.doc, op), oportunidade: op ? visao(op, { detalhe: true }) : null });
}));
router.get('/carrosseis/:id/slide/:n', rota(async (req, res) => {
  const n = Number(req.params.n); if (!Number.isInteger(n) || n < 1 || n > C.TOTAL_SLIDES) throw U.erro('Tela inválida.', 'ENTRADA');
  const a = await store.arquivoObter(Carrossel.chaveSlide(exigeId(req.params.id), n)); if (!a) return res.status(404).json({ error: 'Imagem não encontrada.' });
  if (req.query.w) { const w = Math.min(1080, Math.max(120, Number(req.query.w) || 540)); return res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).end(await sharp(a.dados).resize(w).jpeg({ quality: 82 }).toBuffer()); }
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', ...(req.query.baixar ? { 'Content-Disposition': `attachment; filename="slide-${String(n).padStart(2, '0')}.png"` } : {}) }).end(a.dados);
}));
router.get('/carrosseis/:id/zip', rota(async (req, res) => {
  const id = exigeId(req.params.id); const r = await store.obter('carrossel', id);
  const a = r && await store.arquivoObter(Carrossel.chaveZip(id)); if (!a) return res.status(404).json({ error: 'O pacote ainda não está pronto.' });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${r.doc.pacote.nome_download}"`, 'Content-Length': String(a.dados.length) }).end(a.dados);
}));
router.post('/carrosseis/:id/decisao', limita({ max: 20, janelaMs: 60000, nome: 'radar-decisao' }), rota(async (req, res) => {
  const id = exigeId(req.params.id); const { acao } = req.body || {}; const agora = new Date().toISOString();
  if (acao === 'publicado') { const doc = await Aprend.marcarPublicado(id, { publicado_em: req.body.publicado_em, link: req.body.link || null, metricas: req.body.metricas || {} }); return res.json({ ok: true, estado: doc.estado, publicacao: doc.publicacao, metricas: doc.metricas }); }
  const { doc } = await store.atualizar('carrossel', id, (c) => {
    if (!['aguardando_aprovacao', 'aprovado', 'reprovado'].includes(c.estado)) throw U.erro('Este carrossel não está na fila de aprovação.', 'ESTADO', 409);
    if (acao === 'aprovar') { c.estado = 'aprovado'; c.decisao = { acao, em: agora, nota: U.limita(req.body.nota, 200) || null }; }
    else if (acao === 'reprovar') { c.estado = 'reprovado'; c.decisao = { acao, em: agora, motivo: U.limita(req.body.motivo, 300) || 'Reprovado por você.' }; }
    else if (acao === 'reabrir') { c.estado = 'aguardando_aprovacao'; c.decisao = null; }
    else throw U.erro('Ação desconhecida.', 'ENTRADA');
    (c.historico ||= []).push({ em: agora, evento: acao, detalhe: c.decisao });
    return c;
  });
  res.json({ ok: true, estado: doc.estado, decisao: doc.decisao });
}));
router.post('/carrosseis/:id/metricas', limita({ max: 20, janelaMs: 60000, nome: 'radar-metricas' }), rota(async (req, res) => {
  const doc = await Aprend.registrarMetricas(exigeId(req.params.id), req.body?.metricas || {});
  res.json({ ok: true, metricas: doc.metricas });
}));
router.get('/aprendizado', rota(async (req, res) => { res.json(await Aprend.painel()); }));

router.post('/config', rota(async (req, res) => { res.json(await store.salvarConfig(req.body || {})); }));

module.exports = router;
module.exports._internos = { visao, visaoCarrossel, cron };
