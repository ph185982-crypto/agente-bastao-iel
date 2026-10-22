// Publicação no Instagram (e, depois, outras redes) — chamadas curtas, estado no servidor.
// Tudo aqui exige acesso (middleware em server.js), exceto a mídia pública, que usa token assinado.
// Publicar só acontece depois de aprovação explícita (a versão aprovada, com hash conferido).
const express = require('express');
const P = require('../lib/publicador');
const { armazem } = require('../lib/armazem');
const { ACCOUNT } = require('../lib/account');
const { limita } = require('../lib/access');

const router = express.Router();
const publico = express.Router();

const falha = (res, e) => {
  if (e instanceof P.ErroPub) return res.status(e.status).json({ error: e.message, code: e.code, ...(e.bloqueios ? { bloqueios: e.bloqueios } : {}) });
  const m = e.meta;
  if (m) return res.status(m.tipo === 'token' ? 401 : 502).json({ error: m.amigavel, code: 'META', meta: { code: m.code, subcode: m.subcode, tipo: m.tipo, mensagem_original: m.mensagem_original }, reconectar: m.tipo === 'token' });
  console.error('[publish]', e.message);
  res.status(500).json({ error: 'Erro ao publicar.', code: 'ERRO' });
};

// Endereço público usado pela Meta para baixar as imagens.
const baseUrl = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

router.get('/instagram/health', async (req, res) => {
  try { res.json(await P.saude()); } catch (e) { falha(res, e); }
});

router.get('/config', async (req, res) => {
  try { res.json({ config: await P.config() }); } catch (e) { falha(res, e); }
});
router.put('/config', async (req, res) => {
  try {
    const a = armazem();
    if (!a) return res.status(503).json({ error: 'Sem banco de dados no servidor.', code: 'SEM_ARMAZEM' });
    const b = req.body || {};
    const patch = {};
    if (typeof b.publish_paused === 'boolean') patch.publish_paused = b.publish_paused;
    if (Number.isFinite(Number(b.daily_publish_cap))) patch.daily_publish_cap = Math.min(50, Math.max(1, Number(b.daily_publish_cap)));
    if (typeof b.permitir_encerramento_provisorio === 'boolean') patch.permitir_encerramento_provisorio = b.permitir_encerramento_provisorio;
    if (b.publishers && typeof b.publishers === 'object') {
      const atual = (await P.config()).publishers || {};
      patch.publishers = { instagram: true, ...atual, ...(typeof b.publishers.facebook === 'boolean' ? { facebook: b.publishers.facebook } : {}) };   // LinkedIn não é configurável (não implementado)
    }
    await a.config.salvar(ACCOUNT.ig_id, patch);
    res.json({ config: await P.config() });
  } catch (e) { falha(res, e); }
});

router.get('/status', async (req, res) => {
  try { res.json({ publicacoes: await P.listarPublicacoes() }); } catch (e) { falha(res, e); }
});

router.post('/instagram/:id', limita({ max: 20, janelaMs: 60000, nome: 'publicar' }), async (req, res) => {
  try {
    const base = baseUrl() || (process.env.VERCEL ? '' : `${req.protocol}://${req.get('host')}`);
    res.json(await P.iniciar(String(req.params.id).slice(0, 120), { hash: String(req.body?.hash_versao || ''), base }));
  } catch (e) { falha(res, e); }
});

router.get('/instagram/:id/status', limita({ max: 120, janelaMs: 60000, nome: 'status-publicacao' }), async (req, res) => {
  try { res.json(await P.avancar(String(req.params.id).slice(0, 120))); } catch (e) { falha(res, e); }
});

// Facebook (opcional, desligado por padrão). Mesmas regras: só a versão aprovada.
router.post('/facebook/:id', limita({ max: 20, janelaMs: 60000, nome: 'publicar-facebook' }), async (req, res) => {
  try {
    const base = baseUrl() || (process.env.VERCEL ? '' : `${req.protocol}://${req.get('host')}`);
    res.json(await require('../lib/publishers').facebook.publish(String(req.params.id).slice(0, 120), { hash: String(req.body?.hash_versao || ''), base }));
  } catch (e) { falha(res, e); }
});
router.get('/facebook/:id/status', async (req, res) => {
  try { res.json(await require('../lib/publishers').facebook.getStatus(String(req.params.id).slice(0, 120))); } catch (e) { falha(res, e); }
});

// Cron (Vercel Hobby: 1x por dia): retoma o que ficou no meio.
router.get('/cron', async (req, res) => {
  try { res.json(await P.avancarPendentes()); } catch (e) { falha(res, e); }
});

// ── Mídia pública para a Meta ───────────────────────────────────────────────
publico.get('/video/:token.mp4',async(req,res)=>{
  try{
    const info=require('../lib/meta').verificarMidia(req.params.token);if(!info)return res.status(403).end();
    const reg=await armazem()?.conteudos.obter(ACCOUNT.ig_id,info.c);const c=reg?.doc;const v=c&&require('../../static/contentModel').versaoAtiva(c);
    if(!v || v.hash!==info.h || c.motion?.hash!==info.h || c.motion?.estado!=='pronto')return res.status(409).end();
    const arq=await armazem().arquivos.obter(ACCOUNT.ig_id,c.motion.blob_key);if(!arq)return res.status(404).end();
    const bytes=Buffer.from(arq.dados);const range=req.headers.range;
    res.set({'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'});
    if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();const start=m[1]?Number(m[1]):Math.max(0,bytes.length-Number(m[2]));const end=m[1]&&m[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;if(start>=bytes.length||start>end)return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();return res.status(206).set({'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}).end(bytes.subarray(start,end+1));}
    res.set('Content-Length',String(bytes.length)).end(bytes);
  }catch(e){falha(res,e);}
});
publico.get('/midia/:token.jpg', limita({ max: 120, janelaMs: 60000, nome: 'midia-publica' }), async (req, res) => {
  try {
    const jpg = await P.renderizarMidia(req.params.token);
    res.set({ 'Content-Type': 'image/jpeg', 'Content-Length': String(jpg.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(jpg);
  } catch (e) {
    if (e instanceof P.ErroPub) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error('[midia]', e.message);
    res.status(500).json({ error: 'Erro ao gerar a imagem.' });
  }
});

module.exports = router;
module.exports.publico = publico;
