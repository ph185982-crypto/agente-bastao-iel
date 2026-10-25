// Identidade da conta. GET /api/account é barato (sem API externa);
// GET /api/account?confirm=1 confirma na API (username + id) e gasta 1 consulta.
const express = require('express');
const { ACCOUNT, SCHEMA_VERSION, confirmAccount, accountTag, envHandleProblem } = require('../lib/account');
const { limita } = require('../lib/access');

const router = express.Router();

router.get('/', limita({ max: 20, janelaMs: 60000, nome: 'conta' }), async (req, res) => {
  const base = { esperado: ACCOUNT, schema: SCHEMA_VERSION, ambiente_com_problema: envHandleProblem() };
  if (req.query.confirm !== '1') return res.json({ ...base, account: accountTag(null), confirmada: false });
  try {
    const conf = await confirmAccount({ force: req.query.force === '1' });
    res.json({ ...base, account: accountTag(conf), confirmada: true, perfil: conf });
  } catch (e) {
    res.status(e.code === 'ACCOUNT_MISMATCH' ? 409 : 502).json({ ...base, confirmada: false, error: e.message, detalhe: e.detail || null });
  }
});

module.exports = router;
