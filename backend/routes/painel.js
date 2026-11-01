// Painel de audiência: ver, montar, testar uma copy e conferir se acerta. Só leitura da própria conta; nada é publicado.
const express = require('express');
const PN = require('../lib/painel');
const llmJson = require('../lib/llmJson');
const { limita } = require('../lib/access');
const router = express.Router();
const erro = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Erro no painel.', code: e.code || 'PAINEL' });
const ia = (args) => llmJson.comConsumo(() => llmJson.comPrazo(50000, () => llmJson.pedirJson(args))).then((r) => r.resultado);

router.get('/', async (req, res) => {
  try {
    const [config, doc] = await Promise.all([PN.config(), PN.personasAtuais()]);
    res.json({ config, montado: !!doc, criado_em: doc?.criado_em || null, total: doc?.total || 0, retrato: doc?.retrato || null,
      personas: (doc?.personas || []).map((p) => ({ id: p.id, grupo: p.grupo, rotulo: p.rotulo, membros: p.membros, quem: p.quem, dor: p.dor, para_no_feed: p.para_no_feed, compartilha_quando: p.compartilha_quando })) });
  } catch (e) { erro(res, e); }
});
router.put('/config', async (req, res) => { try { res.json(await PN.salvarConfig(req.body || {})); } catch (e) { erro(res, e); } });
router.post('/montar', limita({ max: 4, janelaMs: 300000, nome: 'painel-montar' }), async (req, res) => {
  try { const d = await PN.montar({ ia }); res.json({ total: d.total, descritas: d.descritas, criado_em: d.criado_em, retrato: d.retrato, personas: d.personas.map((p) => ({ id: p.id, grupo: p.grupo, rotulo: p.rotulo, membros: p.membros, quem: p.quem })) }); } catch (e) { erro(res, e); }
});
// Teste de copy avulso: manda 1 a 3 capas (e opcionalmente slides) e recebe a nota do painel.
router.post('/avaliar', limita({ max: 10, janelaMs: 60000, nome: 'painel-avaliar' }), async (req, res) => {
  try {
    const b = req.body || {}; const capas = (Array.isArray(b.capas) ? b.capas : [b.capa]).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    if (!capas.length) return res.status(400).json({ error: 'Envie pelo menos uma capa em "capas".' });
    res.json(await PN.avaliar({ capas, slides: (Array.isArray(b.slides) ? b.slides : []).map(String).slice(0, 10), legenda: String(b.legenda || ''), tese: String(b.tese || '') }, { ia }));
  } catch (e) { erro(res, e); }
});
router.get('/calibracao', limita({ max: 3, janelaMs: 60000, nome: 'painel-calibracao' }), async (req, res) => { try { res.json(await PN.calibrar()); } catch (e) { erro(res, e); } });
module.exports = router;
