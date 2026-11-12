// "Minhas histórias e casos": API do cadastro. Nada aqui publica: gerar cria o conteúdo e ele vai para a aba Aprovar.
const express = require('express');
const H = require('../lib/historias');
const { limita } = require('../lib/access');
const { traduzir } = require('../lib/bancoErro');

const router = express.Router();
const erro = (res, e0) => { const e = traduzir(e0); if (!e.status && !e.code) console.error('[historias]', e.message); return res.status(e.status || 500).json({ error: e.status ? e.message : 'Não consegui abrir suas histórias agora.', code: e.code || 'HISTORIA' }); };
const ID = /^hs_[a-f0-9]{16}$/;
const idDe = (req) => { if (!ID.test(String(req.params.id))) throw Object.assign(new Error('Identificador inválido.'), { status: 400 }); return req.params.id; };

// Fotos do Pedro para as capas (declaradas antes de '/:id').
const F = require('../lib/fotosPedro');
router.get('/fotos', async (req, res) => { try { res.json(await F.listar()); } catch (e) { erro(res, e); } });
router.post('/fotos', limita({ max: 30, janelaMs: 60000, nome: 'fotos-enviar' }), async (req, res) => { try { res.status(201).json(await F.enviar(String(req.body?.imagem || ''))); } catch (e) { erro(res, e); } });
router.delete('/fotos/:id', async (req, res) => { try { res.json(await F.apagar(String(req.params.id))); } catch (e) { erro(res, e); } });

router.get('/', async (req, res) => { try { res.json({ itens: await H.listar(), tipos: H.TIPOS, min: H.MIN_TEXTO, max: H.MAX_TEXTO }); } catch (e) { erro(res, e); } });
router.post('/', limita({ max: 20, janelaMs: 60000, nome: 'historias-criar' }), async (req, res) => { try { res.status(201).json(await H.criar(req.body || {})); } catch (e) { erro(res, e); } });
router.put('/:id', limita({ max: 30, janelaMs: 60000, nome: 'historias-editar' }), async (req, res) => { try { res.json(await H.editar(idDe(req), req.body || {})); } catch (e) { erro(res, e); } });
router.delete('/:id', async (req, res) => { try { res.json(await H.apagar(idDe(req))); } catch (e) { erro(res, e); } });
// Gera o carrossel agora; o conteúdo entra no índice do piloto para ser levado até a aba Aprovar.
router.post('/:id/gerar', limita({ max: 6, janelaMs: 60000, nome: 'historias-gerar' }), async (req, res) => {
  try {
    const r = await H.gerar(idDe(req), { formato: req.body?.formato || null });
    try { await require('../lib/top/piloto').registrar(r.id, { titulo: r.titulo }); } catch { /* sem índice: o app conduz */ }
    res.status(201).json(r);
  } catch (e) { erro(res, e); }
});

module.exports = router;
