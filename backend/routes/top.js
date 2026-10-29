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
  try { const c = await T.criar({ url: req.body?.url, texto: req.body?.texto, titulo: req.body?.titulo, origem: req.body?.origem || 'manual', formato: req.body?.formato || null }); res.status(201).json(T.resumo(c)); } catch (e) { erro(res, e); }
});
router.post('/carrosseis/:id/passo', limita({ max: 30, janelaMs: 60000, nome: 'top-passo' }), async (req, res) => {
  try { const r = await T.passo(String(req.params.id).slice(0, 80)); res.json({ ...T.resumo(r.conteudo), concluido: r.concluido, ocupado: !!r.ocupado }); } catch (e) { erro(res, e); }
});
router.get('/carrosseis/:id', async (req, res) => {
  try { const r = await armazem().conteudos.obter(ACCOUNT.ig_id, String(req.params.id).slice(0, 80)); if (!r?.doc?.top) return res.status(404).json({ error: 'Carrossel não encontrado.' }); res.json(T.resumo(r.doc)); } catch (e) { erro(res, e); }
});
const Piloto = require('../lib/top/piloto');
router.get('/piloto', async (req, res) => { try { res.json(await Piloto.resumoDoDia()); } catch (e) { erro(res, e); } });
router.put('/piloto', async (req, res) => { try { await Piloto.salvarConfig(req.body || {}); res.json(await Piloto.resumoDoDia()); } catch (e) { erro(res, e); } });
const Relogio = require('../lib/top/relogio');
// Toda rodada vinda de fora (GitHub, app aberto) também religa o relógio da fila, se a corrente tiver parado.
const rodar = async (req, res) => { try { const r = await Piloto.rodada(); await Relogio.agendarProxima(r); res.json(r); } catch (e) { erro(res, e); } };
router.post('/piloto/rodada', limita({ max: 6, janelaMs: 60000, nome: 'top-piloto' }), rodar);
router.get('/piloto/rodada', rodar); // rotina diária da Vercel usa GET
// Publicação que falhou (ex.: trava corrigida depois): volta para a agenda no próximo horário livre, sem nova aprovação —
// só aceita conteúdo que continua aprovado na mesma versão.
router.post('/carrosseis/:id/reagendar', async (req, res) => {
  try {
    const id = String(req.params.id).slice(0, 80); const reg = await armazem().conteudos.obter(ACCOUNT.ig_id, id);
    if (!reg) return res.status(404).json({ error: 'Conteúdo não encontrado.' });
    if (reg.doc.status !== 'aprovado' || !reg.doc.revisao?.aprovada_versao) return res.status(409).json({ error: 'O conteúdo não está aprovado.', code: 'NAO_APROVADO' });
    const c = await Piloto.agendar(id); res.json({ id: c.id, agenda: c.agenda });
  } catch (e) { erro(res, e); }
});
router.post('/carrosseis/:id/reparar', async (req, res) => { try { const c = await T.reparar(String(req.params.id).slice(0, 80)); res.json(T.resumo(c)); } catch (e) { erro(res, e); } });
router.post('/carrosseis/:id/revalidar', async (req, res) => {
  try { const r = await T.revalidar(String(req.params.id).slice(0, 80)); if (r.bloqueios.length) await Piloto.marcarEstado(r.conteudo.id, 'abaixo_da_regua'); res.json({ ...T.resumo(r.conteudo), bloqueios: r.bloqueios.map((b) => b.titulo) }); } catch (e) { erro(res, e); }
});
router.post('/carrosseis/:id/previas', async (req, res) => { try { res.json(await T.refazerPrevias(String(req.params.id).slice(0, 80))); } catch (e) { erro(res, e); } });
router.post('/carrosseis/:id/desagendar', async (req, res) => { try { const c = await Piloto.desagendar(String(req.params.id).slice(0, 80)); res.json({ id: c?.id, agenda: c?.agenda || null }); } catch (e) { erro(res, e); } });
router.get('/regua', (req, res) => res.json({ ...T.regua(), etapas: T.ETAPAS.map((e) => ({ id: e, rotulo: T.ROTULO[e] })) }));
module.exports = router;
