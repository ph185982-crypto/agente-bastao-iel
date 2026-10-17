// Cópia no servidor (sincronização entre aparelhos e recuperação).
// Tudo aqui exige acesso (middleware em server.js) e é separado pela conta fixa.
// O navegador continua com a sua cópia: o servidor nunca apaga o que está lá.
const express = require('express');
const { ACCOUNT } = require('../lib/account');
const { armazem, LIMITE_ARQUIVO } = require('../lib/armazem');
const { limita } = require('../lib/access');

const router = express.Router();
const conta = ACCOUNT.ig_id;

const precisa = (req, res, next) => {
  if (armazem()) return next();
  return res.status(503).json({ error: 'Armazenamento no servidor não configurado. O trabalho está só neste navegador.', code: 'SEM_ARMAZEM' });
};
const falha = (res, e) => {
  const http = e.code === 'CONFLITO' ? 409 : ['ENTRADA', 'CONTA', 'TAMANHO', 'TIPO'].includes(e.code) ? 400 : 500;
  res.status(http).json({ error: e.message, code: e.code || 'ERRO', ...(e.rev_atual !== undefined ? { rev_atual: e.rev_atual } : {}) });
};
const idValido = (s) => /^[A-Za-z0-9_.:-]{1,120}$/.test(String(s || ''));

router.get('/status', (req, res) => {
  const a = armazem();
  res.json({
    configurado: !!a, tipo: a?.tipo || null, duravel: !!a?.duravel,
    arquivos: a ? 'no mesmo banco (limite de 8 MB por arquivo)' : null,
    aviso: a ? null : 'Sem armazenamento no servidor: a única cópia está neste navegador. Exporte backups.',
  });
});

router.get('/conteudos', precisa, async (req, res) => {
  try { res.json({ conteudos: await armazem().conteudos.listar(conta) }); } catch (e) { falha(res, e); }
});

router.get('/conteudos/:id', precisa, async (req, res) => {
  try {
    if (!idValido(req.params.id)) throw Object.assign(new Error('Id inválido.'), { code: 'ENTRADA' });
    const r = await armazem().conteudos.obter(conta, req.params.id);
    if (!r) return res.status(404).json({ error: 'Não está no servidor.', code: 'NAO_ENCONTRADO' });
    res.json(r);
  } catch (e) { falha(res, e); }
});

router.put('/conteudos/:id', precisa, limita({ max: 120, janelaMs: 60000, nome: 'gravação' }), async (req, res) => {
  try {
    if (!idValido(req.params.id)) throw Object.assign(new Error('Id inválido.'), { code: 'ENTRADA' });
    const r = await armazem().conteudos.salvar(conta, req.params.id, req.body?.doc, Number(req.body?.base_rev) || 0);
    res.json(r);
  } catch (e) { falha(res, e); }
});

router.get('/conteudos/:id/historico', precisa, async (req, res) => {
  try { res.json({ revisoes: await armazem().conteudos.historico(conta, req.params.id) }); } catch (e) { falha(res, e); }
});

// Arquivos: só tipos esperados, conferidos pelo conteúdo (não pela extensão).
const TIPOS = { 'image/png': (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'image/webp': (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP', 'application/zip': (b) => b[0] === 0x50 && b[1] === 0x4b };

router.put('/arquivos/:chave', precisa, limita({ max: 60, janelaMs: 60000, nome: 'arquivos' }), async (req, res) => {
  try {
    const chave = req.params.chave;
    if (!idValido(chave)) throw Object.assign(new Error('Nome de arquivo inválido.'), { code: 'ENTRADA' });
    const tipo = String(req.body?.tipo || '');
    if (!TIPOS[tipo]) throw Object.assign(new Error('Tipo de arquivo não aceito (PNG, JPG, WebP ou ZIP).'), { code: 'TIPO' });
    const dados = Buffer.from(String(req.body?.base64 || ''), 'base64');
    if (!dados.length || dados.length > LIMITE_ARQUIVO) throw Object.assign(new Error('Arquivo vazio ou acima de 8 MB.'), { code: 'TAMANHO' });
    if (!TIPOS[tipo](dados)) throw Object.assign(new Error('O conteúdo do arquivo não corresponde ao tipo informado.'), { code: 'TIPO' });
    if (tipo.startsWith('image/')) {
      const meta = await require('sharp')(dados, { limitInputPixels: 40e6 }).metadata().catch(() => null);
      if (!meta) throw Object.assign(new Error('A imagem não pôde ser lida.'), { code: 'TIPO' });
    }
    res.json(await armazem().arquivos.salvar(conta, chave, dados, tipo));
  } catch (e) { falha(res, e); }
});

router.get('/arquivos/:chave', precisa, async (req, res) => {
  try {
    const a = await armazem().arquivos.obter(conta, req.params.chave);
    if (!a) return res.status(404).json({ error: 'Arquivo não está no servidor.', code: 'NAO_ENCONTRADO' });
    res.set({ 'Content-Type': a.tipo, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Sha256': a.sha256 || '' });
    res.send(a.dados);
  } catch (e) { falha(res, e); }
});

router.get('/arquivos', precisa, async (req, res) => {
  try { res.json({ arquivos: await armazem().arquivos.listar(conta) }); } catch (e) { falha(res, e); }
});

// Resultado de uma etapa (pesquisa, redação) gravado no servidor.
const jobs = express.Router();
jobs.get('/:rid', precisa, async (req, res) => {
  try {
    const j = await armazem().jobs.obter(String(req.params.rid).slice(0, 120));
    if (!j) return res.status(404).json({ error: 'Tarefa não encontrada.', code: 'NAO_ENCONTRADO' });
    res.json(j);
  } catch (e) { falha(res, e); }
});

module.exports = router;
module.exports.jobs = jobs;
