// Growth Dashboard, Diagnóstico de crescimento e DNA Editorial. Só leitura de dados que a ferramenta já guardou (nenhuma chamada à
// Meta aqui: quem lê a Meta é "Atualizar números" e a coleta diária do piloto). Ver backend/lib/crescimento.js.
const express = require('express');
const C = require('../lib/crescimento');
const Dna = require('../lib/dnaEditorial');
const Placar = require('../lib/placar');
const { armazem } = require('../lib/armazem');
const { ACCOUNT } = require('../lib/account');
const { limita } = require('../lib/access');

const router = express.Router();
const erroJson = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Não consegui abrir agora. Tente de novo em instantes.', code: e.code || 'CRESCIMENTO' });
const DIAS = [7, 30, 90];

async function dados() {
  const a = armazem(); const cfg = a?.duravel ? await a.config.obter(ACCOUNT.ig_id) : {};
  const snap = cfg.meu_instagram || null; const arquivo = await Placar.lerArquivo(a);
  return { snap, posts: C.juntarPosts(snap?.posts, arquivo), dms: Array.isArray(cfg.dms_por_palavra) ? cfg.dms_por_palavra : [], guardado: !!a?.duravel, arquivo: arquivo.length };
}

router.get('/painel', async (req, res) => {
  try {
    const d = await dados(); const q = req.query;
    const opc = {}; const de = Date.parse(q.de); const ate = Date.parse(q.ate);
    if (Number.isFinite(de) && Number.isFinite(ate) && ate > de && ate - de <= 366 * 86400000) { opc.de = de; opc.ate = ate; } else opc.dias = DIAS.includes(Number(q.dias)) ? Number(q.dias) : 30;
    res.json({ ...C.painel({ posts: d.posts, serie: d.snap?.serie_conta || null, seguidores: d.snap?.conta?.seguidores ?? null, dms: d.dms, gerado_em: d.snap?.gerado_em || null, ...opc }),
      origem: { snapshot_em: d.snap?.gerado_em || null, posts_no_arquivo: d.arquivo, banco: d.guardado }, vazio: !d.snap && !d.arquivo });
  } catch (e) { console.error('[crescimento] painel', e.message); erroJson(res, e); }
});

router.get('/diagnostico', async (req, res) => {
  try {
    const d = await dados(); const dna = await Dna.ler();
    res.json({ ...C.diagnostico({ posts: d.posts, transicao: dna.transicao, pilares: dna.pilares }), origem: { snapshot_em: d.snap?.gerado_em || null, posts_no_arquivo: d.arquivo, posts_considerados: d.posts.length }, vazio: !d.posts.length });
  } catch (e) { console.error('[crescimento] diagnostico', e.message); erroJson(res, e); }
});

router.get('/dna', async (req, res) => { try { res.json({ ...(await Dna.ler()), tipos_banco: Dna.TIPOS_BANCO }); } catch (e) { erroJson(res, e); } });
router.put('/dna', limita({ max: 20, janelaMs: 60000, nome: 'dna-salvar' }), async (req, res) => { try { res.json(await Dna.salvar(req.body || {})); } catch (e) { erroJson(res, e); } });
router.post('/dna/banco', limita({ max: 20, janelaMs: 60000, nome: 'dna-banco' }), async (req, res) => { try { res.status(201).json(await Dna.adicionarAoBanco(req.body || {})); } catch (e) { erroJson(res, e); } });
router.delete('/dna/banco/:id', limita({ max: 20, janelaMs: 60000, nome: 'dna-banco-del' }), async (req, res) => { try { res.json(await Dna.apagarDoBanco(String(req.params.id))); } catch (e) { erroJson(res, e); } });

module.exports = router;
