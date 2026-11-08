// Radar de Reciclagem: API. Lista o que viralizou nas contas vigiadas (com índice de viralidade, tema, mecanismo e
// tese), as tendências do dia, as contas editáveis, e recicla uma TESE em carrossel, post estático ou roteiro de reel.
// Nada aqui publica no Instagram: o que sai vai para a fila de aprovação da Mesa ("Para aprovar") ou vira roteiro.
// POST /coletar aceita o CRON_SECRET (GitHub Actions, 09:00 de Brasília) e o app (botão "Atualizar agora").
const express = require('express');
const Coletar = require('../lib/reciclagem/coletar');
const Reciclar = require('../lib/reciclagem/reciclar');
const Contas = require('../lib/reciclagem/contas');
const llmJson = require('../lib/llmJson');
const meta = require('../lib/meta');
const { limita } = require('../lib/access');

const router = express.Router();
const erro = (res, e) => res.status(e.status || (e.code === 'CONFLITO' ? 409 : 500)).json({ error: e.status || e.code ? e.message : `Erro na Reciclagem: ${String(e.message).slice(0, 160)}`, code: e.code || 'RECICLAGEM' });
const rota = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { if (!res.headersSent) { if (!e.status && !e.code) console.error('[reciclagem]', e.message); erro(res, e); } } };
const ID = /^rc_[a-f0-9]{16}$/;
const exigeId = (id) => { if (!ID.test(String(id))) throw Object.assign(new Error('Identificador inválido.'), { code: 'ENTRADA', status: 400 }); return id; };
// Dependências falsas só em teste local (nunca na Vercel), no mesmo padrão do Radar.
const depsDeTeste = () => (process.env.TESTE_RECICLAGEM === '1' && !process.env.VERCEL && global.__RECICLAGEM_DEPS__ ? global.__RECICLAGEM_DEPS__ : {});

async function estado() {
  const e = await Coletar.lerEstado().catch(() => ({}));
  return { banco: Coletar.disponivel(), ia: llmJson.hasLlmKey(), instagram: meta.faltando().filter((k) => k !== 'PUBLISH_SECRET').length === 0, youtube: !!process.env.YOUTUBE_API_KEY, push: require('../lib/push').configurado(), ultima_coleta: e.ultima_coleta || null, agenda: { cron_utc: '0 12 * * *', horario_brasilia: '09:00' }, mecanismos: Contas.MECANISMOS, idiomas: Contas.IDIOMAS, vl_alta: Coletar.VL_ALTA };
}

// Lista ordenada por VL. Filtros: dias (1–30), min_vl, mecanismo, idioma, rede.
router.get('/', rota(async (req, res) => {
  const q = req.query || {};
  const r = await Coletar.listar({ dias: q.dias, min_vl: q.min_vl, mecanismo: Contas.MECANISMOS[q.mecanismo] ? q.mecanismo : null, idioma: Contas.IDIOMAS.includes(q.idioma) ? q.idioma : null, rede: ['instagram', 'youtube'].includes(q.rede) ? q.rede : null, limite: q.limite });
  res.json({ ...r, estado: await estado() });
}));

router.get('/tendencias', rota(async (req, res) => { res.json(await Coletar.tendenciasGuardadas()); }));

// Coleta (cron do GitHub ou botão do app). Limite baixo: cada coleta gasta até 40 chamadas da Meta e 3 lotes de IA.
async function coletar(req, res) {
  if (!Coletar.disponivel()) return res.status(503).json({ error: 'A Reciclagem precisa do banco de dados no servidor (Cópia no servidor).', code: 'SEM_BANCO' });
  const origem = req.headers?.authorization === `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET ? 'cron' : 'manual';
  const r = await Coletar.coletar({ deps: depsDeTeste(), origem });
  res.json({ ok: true, ...r });
}
router.post('/coletar', limita({ max: 3, janelaMs: 10 * 60000, nome: 'reciclagem-coletar' }), rota(coletar));
router.get('/coletar', limita({ max: 3, janelaMs: 10 * 60000, nome: 'reciclagem-coletar' }), rota(coletar));

// Contas vigiadas: lista curada + ajustes do Pedro. PUT recebe a configuração inteira
// { instagram: { adicionar: [{handle, nome, pais, idioma, por_que}], remover: [handle] }, youtube: { adicionar: [{canal, nome, pais, idioma}], remover: [canal] } }.
router.get('/contas', rota(async (req, res) => { res.json(await Contas.carregar()); }));
router.put('/contas', limita({ max: 20, janelaMs: 60000, nome: 'reciclagem-contas' }), rota(async (req, res) => {
  await Contas.salvarConfig(req.body || {});
  res.json(await Contas.carregar());
}));

router.get('/:id', rota(async (req, res) => {
  const d = await Coletar.obter(exigeId(req.params.id)); if (!d) return res.status(404).json({ error: 'Item não encontrado.', code: 'NAO_ENCONTRADO' });
  res.json(Coletar.visao(d));
}));

// Recicla a TESE (nunca o texto) em carrossel, post estático ou roteiro de reel.
router.post('/:id/reciclar', limita({ max: 6, janelaMs: 60000, nome: 'reciclagem-reciclar' }), rota(async (req, res) => {
  const id = exigeId(req.params.id); const formato = String(req.body?.formato || '');
  if (!Reciclar.FORMATOS.includes(formato)) return res.status(400).json({ error: `Formato inválido. Use ${Reciclar.FORMATOS.join(', ')}.`, code: 'ENTRADA' });
  const deps = depsDeTeste();
  if (formato === 'reel' && !deps.pedirJson && !llmJson.hasLlmKey()) return res.status(503).json({ error: 'Nenhuma IA está configurada no servidor: o roteiro não pode ser escrito.', code: 'SEM_IA' });
  const r = await Reciclar.reciclar(id, { formato, deps });
  res.status(201).json(r);
}));

module.exports = router;
module.exports._internos = { estado, coletar };
