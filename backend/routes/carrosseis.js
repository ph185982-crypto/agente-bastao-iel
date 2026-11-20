// Formatos de carrossel de topo de funil (ver docs/CARROSSEIS_DIALOGO_E_PAPEL.md):
//   POST /api/carrosseis/dialogo          diálogo ilustrado (uma cena, balões mudando)
//   POST /api/carrosseis/papel-de-parede  capa + uma frase por tela sobre foto
// Montadas DEPOIS do porteiro de acesso (server.js: app.use('/api', access.exigeAcesso)): exigem o mesmo login das
// outras rotas. Criam o conteúdo, desenham as telas e guardam; o carrossel aparece em "Carrosséis para validar".
const express = require('express');
const { limita } = require('../lib/access');
const F = require('../lib/formatosCarrossel');

const router = express.Router();
const limite = limita({ max: 10, janelaMs: 60000, nome: 'carrosseis' });

// Erro de entrada volta com a mensagem; erro interno volta com mensagem fixa (nada de corpo cru de API nem chave).
const responder = (fn) => async (req, res) => {
  try { res.status(201).json(await fn(req.body || {})); } catch (e) {
    const status = Number(e.status) || 500;
    if (status >= 500 && status !== 503) console.error('[carrosseis]', e.code || e.name || 'erro');
    res.status(status).json({ error: status < 500 || status === 503 ? e.message : 'Não consegui criar o carrossel agora. Tente de novo.', code: e.code || 'ERRO' });
  }
};

router.post('/dialogo', limite, responder((b) => F.criarDialogo(b)));
router.post('/papel-de-parede', limite, responder((b) => F.criarPapelDeParede(b)));

module.exports = router;
