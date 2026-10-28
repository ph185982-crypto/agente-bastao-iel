// Carrossel "top" (notícia com tese, visual da referência). Cria, avança passo a passo (cada chamada cabe no limite da
// função) e consulta. Pronto, o carrossel aparece em "Para aprovar"; publicar continua exigindo o toque do Pedro.
const express = require('express');
const T = require('../lib/top/pipeline');
const { limita } = require('../lib/access');
const { armazem } = require('../lib/armazem');
const { ACCOUNT } = require('../lib/account');
const router = express.Router();
const erro = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Erro no carrossel.', code: e.code || 'TOP' });

router.post('/carrosseis', limita({ max: 12, janelaMs: 60000, nome: 'top-criar' }), async (req, res) => {
  try { const c = await T.criar({ url: req.body?.url, texto: req.body?.texto, titulo: req.body?.titulo, origem: req.body?.origem || 'manual' }); res.status(201).json(T.resumo(c)); } catch (e) { erro(res, e); }
});
router.post('/carrosseis/:id/passo', limita({ max: 30, janelaMs: 60000, nome: 'top-passo' }), async (req, res) => {
  try { const r = await T.passo(String(req.params.id).slice(0, 80)); res.json({ ...T.resumo(r.conteudo), concluido: r.concluido, ocupado: !!r.ocupado }); } catch (e) { erro(res, e); }
});
router.get('/carrosseis/:id', async (req, res) => {
  try { const r = await armazem().conteudos.obter(ACCOUNT.ig_id, String(req.params.id).slice(0, 80)); if (!r?.doc?.top) return res.status(404).json({ error: 'Carrossel não encontrado.' }); res.json(T.resumo(r.doc)); } catch (e) { erro(res, e); }
});
router.get('/regua', (req, res) => res.json({ ...T.regua(), etapas: T.ETAPAS.map((e) => ({ id: e, rotulo: T.ROTULO[e] })) }));
module.exports = router;
