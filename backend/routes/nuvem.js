// Rotas que o Cloud Tasks chama no Google Cloud Run (equivalentes a api/studio-worker.js e api/radar-worker.js da Vercel).
// Autenticação: CRON_SECRET (ROTAS_CRON em lib/access.js). A rota só responde quando termina o trabalho: assim o
// Cloud Run mantém a CPU ligada durante a etapa. Falta de trabalho → 200 (a tarefa sai da fila).
const express = require('express');
const T = require('../lib/nuvem/tarefas');
const router = express.Router();

router.post('/studio', async (req, res) => {
  try {
    const { id, job } = req.body || {};
    if (typeof id !== 'string' || !/^\w[\w.:-]{0,119}$/.test(id) || typeof job !== 'string') return res.json({ ignorado: true });
    const studio = require('../lib/studio'); const { executar } = require('./studio')._internos;
    const antes = (await studio.ler(id)).doc;
    if (antes.studio?.job !== job || !['gerando', 'publicando'].includes(antes.studio.estado)) return res.json({ encerrado: true });
    const falta = Math.ceil((Date.parse(antes.studio.adiar_ate) - Date.now()) / 1000);
    if (falta > 0) { await T.criar({ caminho: '/api/nuvem/studio', corpo: { id, job }, atrasoS: falta, chave: `st-${id}-${job}-espera-${Date.parse(antes.studio.adiar_ate)}` }); return res.json({ adiado: falta }); }
    await executar(id, job);
    const c = (await studio.ler(id)).doc;
    if (c.studio?.job === job && ['gerando', 'publicando'].includes(c.studio.estado) && c.studio.lease) {
      await T.criar({ caminho: '/api/nuvem/studio', corpo: { id, job }, atrasoS: 20, chave: `st-${id}-${job}-lease-${Math.floor(Date.now() / 20000)}` });
    }
    res.json({ ok: true });
  } catch (e) { console.error('[nuvem studio]', e.message); res.status(500).json({ error: e.message }); } // 500 → o Cloud Tasks tenta de novo
});

router.post('/radar', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (typeof id !== 'string' || !/^(rd|pt|lt)_[\w]{3,60}$/.test(id)) return res.json({ ignorado: true });
    const continuar = (atrasoS) => require('../lib/radar/fila').continuar(id, { atrasoS });
    if (id.startsWith('pt_') || id.startsWith('lt_')) {
      const Pauta = require('../lib/radar/pauta');
      const r = id.startsWith('pt_') ? await Pauta.avancar(id, { orcamentoMs: 240000 }) : await Pauta.avancarLote(id, { orcamentoMs: 240000 });
      if (!(r.concluida || r.concluido)) await continuar(r.ocupado ? 20 : (r.esperar_s || 3));
      return res.json({ ok: true });
    }
    const reg = await require('../lib/radar/store').obter('execucao', id);
    if (!reg || reg.doc.estado !== 'em_andamento') return res.json({ encerrado: true });
    const r = await require('../lib/radar/pipeline').avancar(id, { orcamentoMs: 240000 });
    if (!r.concluida) await continuar(r.ocupado ? 20 : (r.esperar_s || 3));
    res.json({ ok: true });
  } catch (e) { console.error('[nuvem radar]', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = router;
