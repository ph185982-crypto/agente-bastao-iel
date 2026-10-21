const express = require('express');
const push = require('../lib/push');
const { limita } = require('../lib/access');

const router = express.Router();
const falha = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Erro nas notificações.' });

router.get('/chave', (req, res) => res.json({ configurado: push.configurado(), chave_publica: push.chavePublica() }));

router.post('/subscribe', limita({ max: 20, janelaMs: 60000, nome: 'push-subscribe' }), async (req, res) => {
  try { res.json({ ok: true, aparelhos: await push.salvarAssinatura(req.body?.assinatura) }); } catch (e) { falha(res, e); }
});
router.post('/unsubscribe', async (req, res) => {
  try { res.json({ ok: true, aparelhos: await push.removerAssinatura(String(req.body?.endpoint || '')) }); } catch (e) { falha(res, e); }
});
// Uma notificação por lote ("5 conteúdos novos para aprovar").
router.post('/notificar-lote', limita({ max: 10, janelaMs: 60000, nome: 'push-lote' }), async (req, res) => {
  try { res.json(await push.notificarLote(req.body?.n)); } catch (e) { falha(res, e); }
});

module.exports = router;
