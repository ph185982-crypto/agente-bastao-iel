// Vídeos (Reels gravados pelo Pedro): criar, receber o arquivo pelo Vercel Blob, fila do worker de edição e leitura.
// Montado em `/api/videos` (ver docs/VIDEOS_INTEGRACAO.md). Aprovar e publicar continuam em `/api/studio/:id/decidir`.
//
// Acesso: as rotas do app passam pelo acesso normal (`access.exigeAcesso`, montado em /api). As rotas `/worker/*` e
// `/blob` estão em ROTAS_CRON: aceitam também `Authorization: Bearer <CRON_SECRET>` (o worker do GitHub Actions).
const express = require('express');
const crypto = require('crypto');
const V = require('../lib/videos');
const access = require('../lib/access');
const { limita } = access;
const router = express.Router();

// Erros da biblioteca do Blob (assinatura ausente, evento inválido) começam com "Vercel Blob:" e são culpa do pedido, não do servidor.
const ehBlobError = (e) => /^Vercel Blob:/.test(String(e?.message || ''));
const { traduzir } = require('../lib/bancoErro');
const erro = (res, e0) => { const e = traduzir(e0); return res.status(e.status || (e.code === 'CONFLITO' ? 409 : ehBlobError(e) ? 400 : 500)).json({ error: e.message || 'Erro no vídeo.', code: e.code || (ehBlobError(e) ? 'BLOB' : 'VIDEO') }); };
const idDe = (req) => String(req.params.id || '').slice(0, 80);
const iguais = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Quem pode pedir um client token do Blob: sessão do app (token assinado), o worker (CRON_SECRET) ou o app aberto por
// escolha do dono. É uma segunda conferência além do `exigeAcesso` global: o token dá escrita no armazenamento.
function autorizado(req) {
  const h = String(req.headers?.authorization || '');
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (bearer && process.env.CRON_SECRET && iguais(bearer, process.env.CRON_SECRET)) return true;
  if (bearer && access.verify(bearer)) return true;
  return ['aberto_local', 'aberto_publico'].includes(access.estadoAcesso());
}
const callbackBase = () => String(process.env.PUBLIC_BASE_URL || process.env.VERCEL_BLOB_CALLBACK_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');

// ── Upload direto do navegador/worker para o Blob (client upload) ───────────
// 1) `blob.generate-client-token`: confere quem pede, o caminho `videos/<id>/…` e devolve um token de 1 h restrito
//    (vídeo/jpeg, 600 MB, sufixo aleatório). 2) `blob.upload-completed`: a Vercel avisa que o arquivo chegou (assinatura
//    conferida pela biblioteca) e o documento registra a origem. Se o aviso não chegar (ex.: local), o navegador chama
//    `POST /:id/enviado` com o mesmo efeito.
router.post('/blob', limita({ max: 40, janelaMs: 60000, nome: 'videos-blob' }), async (req, res) => {
  try {
    V.exigirBlob();
    const body = req.body;
    if (!body || typeof body.type !== 'string' || !body.payload) return res.status(400).json({ error: 'Corpo inválido para o upload.', code: 'ENTRADA' });
    const { handleUpload } = require('@vercel/blob/client');
    const base = callbackBase();
    const r = await handleUpload({
      request: req, body, token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!autorizado(req)) throw Object.assign(new Error('Acesso restrito. Entre com o código de acesso.'), { status: 401, code: 'AUTH_REQUIRED' });
        let p = null; try { p = JSON.parse(clientPayload || 'null'); } catch { /* sem payload */ }
        const id = String(p?.id || '').slice(0, 80);
        if (!id || !V.pathnameValido(id, pathname)) throw Object.assign(new Error('O arquivo precisa ir para videos/<id>/ do vídeo criado em POST /api/videos.'), { status: 400, code: 'CAMINHO' });
        await V.obter(id);  // o vídeo precisa existir (404 se não)
        const papel = ['origem', 'resultado', 'poster'].includes(p?.papel) ? p.papel : 'origem';
        return { ...V.restricoesToken(), tokenPayload: JSON.stringify({ id, papel }), ...(base ? { callbackUrl: `${base}/api/videos/blob` } : {}) };
      },
      ...(base ? { onUploadCompleted: async ({ blob, tokenPayload }) => { await V.registrarUploadConcluido({ blob, tokenPayload }); } } : {}),
    });
    res.json(r);
  } catch (e) { erro(res, e); }
});

// ── Worker de edição (GitHub Actions; CRON_SECRET) ──────────────────────────
router.get('/worker/proximo', limita({ max: 60, janelaMs: 60000, nome: 'videos-proximo' }), async (req, res) => {
  try { const job = await V.proximoJob(); if (!job) return res.status(204).end(); res.json(job); } catch (e) { erro(res, e); }
});
router.post('/worker/token', limita({ max: 60, janelaMs: 60000, nome: 'videos-token' }), async (req, res) => {
  try { const b = req.body || {}; res.json(await V.tokenDoWorker({ id: String(b.id || ''), pathname: b.pathname, contentType: b.contentType })); } catch (e) { erro(res, e); }
});
router.post('/worker/resultado', limita({ max: 30, janelaMs: 60000, nome: 'videos-resultado' }), async (req, res) => {
  try { const b = req.body || {}; const c = await V.registrarResultado(String(b.id || ''), { resultado: b.resultado, transcricao: b.transcricao, log: b.log, run_url: b.run_url }); res.json(V.resumo(c)); } catch (e) { erro(res, e); }
});
// Onde está o sinal de fila (arquivo no Blob). Resposta sem banco de dados: o editor consulta isto sem acordar o Neon.
router.get('/worker/sinal', limita({ max: 60, janelaMs: 60000, nome: 'videos-sinal' }), (req, res) => { const url = V.urlDoSinal(); res.json({ url }); });
// B-roll: o editor (GitHub Actions) pede os clipes por aqui e a chave do Pexels nunca sai do servidor. Devolve só o que o editor usa.
router.get('/worker/pexels', limita({ max: 120, janelaMs: 60000, nome: 'videos-pexels' }), async (req, res) => {
  try {
    const chave = process.env.PEXELS_API_KEY; if (!chave) return res.status(503).json({ error: 'Sem PEXELS_API_KEY no servidor.', code: 'SEM_PEXELS' });
    const q = String(req.query.query || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().slice(0, 80); if (!q) return res.status(400).json({ error: 'Falta a consulta.' });
    const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=portrait&size=medium&per_page=6`, { headers: { Authorization: chave }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).json({ error: `Pexels respondeu ${r.status}.` });
    const d = await r.json();
    res.json({ videos: (d.videos || []).map((v) => ({ id: v.id, user: { name: v.user?.name }, video_files: (v.video_files || []).map((f) => ({ id: f.id, quality: f.quality, file_type: f.file_type, width: f.width, height: f.height, link: f.link })) })) });
  } catch (e) { erro(res, e); }
});
router.post('/worker/erro', limita({ max: 30, janelaMs: 60000, nome: 'videos-erro' }), async (req, res) => {
  try { const b = req.body || {}; const c = await V.registrarErro(String(b.id || ''), { erro: b.erro, log: b.log, run_url: b.run_url }); res.json(V.resumo(c)); } catch (e) { erro(res, e); }
});

// ── App ─────────────────────────────────────────────────────────────────────
router.post('/', limita({ max: 12, janelaMs: 60000, nome: 'videos-criar' }), async (req, res) => {
  try { const b = req.body || {}; const c = await V.criar({ titulo: b.titulo, estilo: b.estilo, opcoes: b.opcoes, roteiro_id: b.roteiro_id, roteiro_texto: b.roteiro_texto }); res.status(201).json({ id: c.id, ...V.resumo(c), prefixo_blob: `videos/${c.id}/` }); } catch (e) { erro(res, e); }
});
// Fábrica de roteiros (até 10 por dia, aprovados pelos fiscais): situação do dia e "gerar agora".
router.get('/roteiros', async (req, res) => { try { const P = require('../lib/top/piloto'); res.json((await P.resumoDoDia()).roteiros); } catch (e) { erro(res, e); } });
router.post('/roteiros/gerar', limita({ max: 6, janelaMs: 60000, nome: 'roteiros-gerar' }), async (req, res) => {
  try { res.json(await require('../lib/top/piloto').avancarRoteiros({ orcamentoMs: 45000 })); } catch (e) { erro(res, e); }
});
router.get('/', async (req, res) => { try { res.json({ videos: await V.listar() }); } catch (e) { erro(res, e); } });
router.get('/:id', async (req, res) => { try { res.json(await V.obter(idDe(req))); } catch (e) { erro(res, e); } });
router.post('/:id/enviado', limita({ max: 20, janelaMs: 60000, nome: 'videos-enviado' }), async (req, res) => {
  try { const b = req.body || {}; const c = await V.registrarEnvio(idDe(req), { url: b.url, pathname: b.pathname, tamanho: b.tamanho, contentType: b.contentType, duracao_s: b.duracao_s, largura: b.largura, altura: b.altura }); res.json(V.resumo(c)); } catch (e) { erro(res, e); }
});
router.post('/:id/refazer', limita({ max: 10, janelaMs: 60000, nome: 'videos-refazer' }), async (req, res) => {
  try { const b = req.body || {}; const c = await V.refazer(idDe(req), { estilo: b.estilo, opcoes: b.opcoes }); res.json(V.resumo(c)); } catch (e) { erro(res, e); }
});
router.delete('/:id', limita({ max: 10, janelaMs: 60000, nome: 'videos-apagar' }), async (req, res) => {
  try { res.json(await V.apagar(idDe(req))); } catch (e) { erro(res, e); }
});

module.exports = router;
module.exports._internos = { autorizado };
