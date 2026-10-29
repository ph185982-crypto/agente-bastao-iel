// "Meu Instagram": métricas reais por post, lidas da Graph API com a conexão usada para publicar.
// Só leitura: esta rota nunca publica, comenta ou altera nada na conta. Exige acesso (server.js).
const express = require('express');
const MI = require('../lib/meuInstagram');
const meta = require('../lib/meta');
const P = require('../lib/publicador');
const { armazem } = require('../lib/armazem');
const { limita } = require('../lib/access');
const Temas = require('../lib/temas');
const Estrategia = require('../lib/estrategia');

const router = express.Router();
const IDADE_MAX_H = 24; // depois disso o painel avisa que os números estão velhos

const montar = (snapshot, minPorGrupo) => {
  const idadeH = snapshot ? (Date.now() - Date.parse(snapshot.gerado_em)) / 3600000 : null;
  return {
    vazio: !snapshot,
    snapshot: snapshot ? { gerado_em: snapshot.gerado_em, janela_dias: snapshot.janela_dias, parcial: !!snapshot.parcial, avisos: snapshot.avisos || [], conta: snapshot.conta, serie_conta: snapshot.serie_conta || null } : null,
    analise: snapshot ? MI.analisar(snapshot.posts, { seguidoresDaConta: snapshot.conta?.seguidores ?? null, ...(minPorGrupo ? { minPorGrupo } : {}) }) : null,
    posts: snapshot ? snapshot.posts : [],
    velho: idadeH != null && idadeH > IDADE_MAX_H,
    historico: !!armazem()?.duravel,
  };
};

router.get('/painel', async (req, res) => {
  try {
    const a = armazem();
    const guardado = a?.duravel ? (await a.config.obter(require('../lib/account').ACCOUNT.ig_id)).meu_instagram : null;
    const est = await Estrategia.ler();
    res.json({ ...montar(guardado || null, est.min_posts_por_grupo), configurado: meta.faltando().length === 0, faltando: meta.faltando() });
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
    // Os posts lidos viram "temas usados": a ferramenta não repete assunto que já saiu no perfil.
    try { await Temas.semearDoInstagram(snapshot.posts); } catch (e) { console.error('[instagram] temas', e.message); }
    const est = await Estrategia.ler();
    res.json({ ...montar(snapshot, est.min_posts_por_grupo), configurado: true, faltando: [] });
  } catch (e) {
    const m = e.meta;
    if (m) return res.status(m.tipo === 'token' ? 401 : 502).json({ error: m.amigavel, code: 'META', meta: { code: m.code, tipo: m.tipo } });
    console.error('[instagram] atualizar', e.message);
    res.status(500).json({ error: 'Não consegui ler o Instagram agora. Tente de novo em instantes.' });
  }
});

// Referências: carrosséis públicos de OUTRAS contas profissionais (business discovery da Graph API), para estudar o que
// viraliza. Só leitura. Visualização de carrossel não é pública: a Graph devolve curtidas e comentários.
router.get('/referencias', limita({ max: 10, janelaMs: 60000, nome: 'ig-referencias' }), async (req, res) => {
  try {
    const usuarios = String(req.query.usuarios || '').split(',').map((u) => u.trim().replace(/^@/, '')).filter((u) => /^[\w.]{2,30}$/.test(u)).slice(0, 8);
    const paginas = Math.min(4, Math.max(1, Number(req.query.paginas) || 2));
    const c = meta.config(); const saida = [];
    for (const u of usuarios) {
      const conta = { usuario: u, seguidores: null, carrosseis: [], lidos: 0, erro: null };
      let depois = null;
      try {
        for (let p = 0; p < paginas; p++) {
          const media = `media${depois ? `.after(${depois})` : ''}.limit(50){media_type,like_count,comments_count,permalink,timestamp,caption,media_url,children{media_url}}`;
          const d = await meta.graph('GET', c.igId, { fields: `business_discovery.username(${u}){username,followers_count,${media}}` });
          const bd = d.business_discovery || {}; conta.seguidores = bd.followers_count ?? conta.seguidores;
          const itens = bd.media?.data || []; conta.lidos += itens.length;
          for (const m of itens) if (m.media_type === 'CAROUSEL_ALBUM') conta.carrosseis.push({ link: m.permalink, data: m.timestamp, curtidas: m.like_count ?? null, comentarios: m.comments_count ?? null, legenda: String(m.caption || '').slice(0, 600), capa: m.media_url || null, slides: (m.children?.data || []).map((x) => x.media_url).filter(Boolean).slice(0, 10) });
          depois = bd.media?.paging?.cursors?.after; if (!depois || !itens.length) break;
        }
      } catch (e) { conta.erro = String(e.message).slice(0, 200); }
      conta.carrosseis.sort((x, y) => (y.curtidas || 0) - (x.curtidas || 0)); conta.carrosseis = conta.carrosseis.slice(0, 15);
      saida.push(conta);
    }
    res.json({ contas: saida, aviso: 'Curtidas e comentários públicos; o Instagram não expõe visualizações de carrossel de outras contas.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
