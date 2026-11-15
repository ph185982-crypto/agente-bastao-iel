// LinkedIn: conectar a conta (OAuth), ligar/desligar a publicação junto com o Instagram e repetir uma publicação.
// Nada publica sem aprovação: o LinkedIn só recebe o que o Pedro aprovou para o Instagram.
const express = require('express');
const L = require('../lib/linkedin');
const { limita } = require('../lib/access');
const { traduzir } = require('../lib/bancoErro');

const router = express.Router();
const erro = (res, e0) => { const e = traduzir(e0); if (!e.status) console.error('[linkedin]', e.message); return res.status(e.status || 500).json({ error: e.status ? e.message : 'Não consegui falar com o LinkedIn agora.', code: e.code || 'LINKEDIN' }); };
const pagina = (titulo, texto) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${titulo}</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#F6F5F0;color:#18191D;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px"><main style="max-width:420px;background:#FCFBF8;border:1px solid #DFDCD0;border-radius:14px;padding:24px"><h1 style="font-size:22px;margin:0 0 10px">${titulo}</h1><p style="line-height:1.5;margin:0 0 18px">${texto}</p><a href="/?tab=ajustes" style="display:inline-block;background:#2448FF;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Voltar para a ferramenta</a></main></body></html>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/estado', async (req, res) => { try { res.json(await L.estado()); } catch (e) { erro(res, e); } });
router.get('/conectar', (req, res) => { try { res.redirect(302, L.urlConectar()); } catch (e) { res.status(e.status || 500).type('html').send(pagina('LinkedIn ainda não configurado', esc(e.message))); } });
router.get('/callback', limita({ max: 10, janelaMs: 60000, nome: 'linkedin-callback' }), async (req, res) => {
  if (req.query.error) return res.type('html').send(pagina('Conexão cancelada', `O LinkedIn não autorizou: ${esc(req.query.error_description || req.query.error)}.`));
  try { const c = await L.concluirConexao({ code: String(req.query.code || ''), state: String(req.query.state || '') }); res.type('html').send(pagina('LinkedIn conectado', `Conectado como <b>${esc(c.nome || 'você')}</b>. A partir de agora, o que você aprovar para o Instagram sai também no seu LinkedIn. Dá para desligar em Perfil → Conexões.`)); }
  catch (e) { res.status(e.status || 500).type('html').send(pagina('Não deu para conectar', esc(e.message))); }
});
router.post('/ativo', async (req, res) => { try { await L.definirAtivo(req.body?.ativo === true); res.json(await L.estado()); } catch (e) { erro(res, e); } });
router.post('/desconectar', async (req, res) => { try { await L.desconectar(); res.json(await L.estado()); } catch (e) { erro(res, e); } });
// Repetir a publicação de um conteúdo já aprovado (ex.: o LinkedIn falhou e o Instagram saiu).
router.post('/publicar/:id', limita({ max: 6, janelaMs: 60000, nome: 'linkedin-publicar' }), async (req, res) => { try { res.json(await L.publicar(String(req.params.id).slice(0, 120), { hash: String(req.body?.hash_versao || '') || undefined })); } catch (e) { erro(res, e); } });

module.exports = router;
