// Monitor de notícias em alta. POST /tick é chamado pelo app aberto, por um agendador externo (com CRON_SECRET)
// ou pelo botão "Buscar agora". Só cria ROTEIROS em preparação: não gera carrossel nem publica.
const express = require('express');
const M = require('../lib/monitor');
const { limita } = require('../lib/access');
const router = express.Router();
const erro = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Erro no monitor.', code: e.code || 'MONITOR' });

router.get('/estado', async (req, res) => { try { res.json(await M.estado()); } catch (e) { erro(res, e); } });
router.post('/tick', limita({ max: 4, janelaMs: 60000, nome: 'monitor-tick' }), async (req, res) => {
  try { res.json(await M.tick({ forcar: req.body?.forcar === true })); } catch (e) { erro(res, e); }
});
module.exports = router;
