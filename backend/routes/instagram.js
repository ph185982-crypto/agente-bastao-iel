// "Meu Instagram": métricas reais por post, lidas da Graph API com a conexão usada para publicar.
// Só leitura: esta rota nunca publica, comenta ou altera nada na conta. Exige acesso (server.js).
const express = require('express');
const MI = require('../lib/meuInstagram');
const meta = require('../lib/meta');
const P = require('../lib/publicador');
const { armazem } = require('../lib/armazem');
const { limita } = require('../lib/access');

const router = express.Router();
const IDADE_MAX_H = 24; // depois disso o painel avisa que os números estão velhos

const montar = (snapshot) => {
  const idadeH = snapshot ? (Date.now() - Date.parse(snapshot.gerado_em)) / 3600000 : null;
  return {
    vazio: !snapshot,
    snapshot: snapshot ? { gerado_em: snapshot.gerado_em, janela_dias: snapshot.janela_dias, parcial: !!snapshot.parcial, avisos: snapshot.avisos || [], conta: snapshot.conta, serie_conta: snapshot.serie_conta || null } : null,
    analise: snapshot ? MI.analisar(snapshot.posts, { seguidoresDaConta: snapshot.conta?.seguidores ?? null }) : null,
    posts: snapshot ? snapshot.posts : [],
    velho: idadeH != null && idadeH > IDADE_MAX_H,
    historico: !!armazem()?.duravel,
  };
};

router.get('/painel', async (req, res) => {
  try {
    const a = armazem();
    const guardado = a?.duravel ? (await a.config.obter(require('../lib/account').ACCOUNT.ig_id)).meu_instagram : null;
    res.json({ ...montar(guardado || null), configurado: meta.faltando().length === 0, faltando: meta.faltando() });
  } catch (e) { console.error('[instagram] painel', e.message); res.status(500).json({ error: 'Não consegui abrir o painel agora.' }); }
});

router.post('/atualizar', limita({ max: 2, janelaMs: 60000, nome: 'instagram-atualizar' }), async (req, res) => {
  const falta = meta.faltando();
  if (falta.length) return res.status(409).json({ error: `A conexão com o Instagram não está configurada no servidor (falta ${falta.join(', ')}). Veja docs/META_SETUP.md.`, code: 'META_NAO_CONFIGURADA', faltando: falta });
  try {
    const daFerramenta = new Map();
    try { (await P.listarPublicacoes()).filter((p) => p.estado === 'publicada' && p.ig_media_id).forEach((p) => daFerramenta.set(String(p.ig_media_id), p.content_id)); } catch { /* sem banco: nenhum marcado */ }
    const snapshot = await MI.atualizar({ daFerramenta });
    const a = armazem();
    if (a?.duravel) await a.config.salvar(require('../lib/account').ACCOUNT.ig_id, { meu_instagram: snapshot });
    res.json({ ...montar(snapshot), configurado: true, faltando: [] });
  } catch (e) {
    const m = e.meta;
    if (m) return res.status(m.tipo === 'token' ? 401 : 502).json({ error: m.amigavel, code: 'META', meta: { code: m.code, tipo: m.tipo } });
    console.error('[instagram] atualizar', e.message);
    res.status(500).json({ error: 'Não consegui ler o Instagram agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
