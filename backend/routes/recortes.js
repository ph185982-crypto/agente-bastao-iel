// Biblioteca de recortes do tema "reportagem" (ver lib/recortes.js). Envio em JSON (base64) para caber no limite da função.
const express = require('express');
const R = require('../lib/recortes');
const { limita } = require('../lib/access');
const router = express.Router();
const erro = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Erro nos recortes.', code: e.code || 'RECORTE' });

router.get('/', async (req, res) => { try { res.json(await R.listar()); } catch (e) { erro(res, e); } });
router.get('/:id/arquivo', async (req, res) => {
  try {
    const b = await R.obter(req.params.id);
    if (!b) return res.status(404).json({ error: 'Recorte não encontrado.', code: 'RECORTE' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' }).send(b);
  } catch (e) { erro(res, e); }
});
router.post('/', limita({ max: 10, janelaMs: 60000, nome: 'recorte-novo' }), express.json({ limit: '12mb' }), async (req, res) => {
  try {
    const b = req.body || {};
    const m = /^data:image\/(png|webp);base64,(.+)$/.exec(String(b.arquivo || ''));
    if (!m) return res.status(400).json({ error: 'Envie o recorte como PNG ou WebP.', code: 'RECORTE' });
    res.status(201).json(await R.adicionar({ nome: b.nome, credito: b.credito, licenca: b.licenca, origem_url: b.origem_url, exige_credito: b.exige_credito !== false, png: Buffer.from(m[2], 'base64') }));
  } catch (e) { erro(res, e); }
});
router.delete('/:id', async (req, res) => { try { res.json(await R.remover(req.params.id)); } catch (e) { erro(res, e); } });
module.exports = router;
