// Publicação OPCIONAL na Página do Facebook (desligada por padrão; chave em Ajustes).
// A API do Instagram NÃO replica na Página: aqui é uma chamada própria.
//  - 1 imagem: POST /{page-id}/photos  (url) — conferido na documentação (Pages API → posts);
//  - várias imagens: cada foto sobe com published=false e o post sai em /{page-id}/feed com
//    attached_media. ⚠️ O attached_media e o parâmetro de legenda da foto NÃO estavam na página da
//    documentação consultada em 21/10/2026: confirme com uma Página de teste antes de ligar.
//  - permissões: pages_manage_posts (+ pages_read_engagement); token de Página.
// Diferente do Instagram, não há container para esperar: tudo acontece numa chamada curta.
const meta = require('../meta');
const { armazem } = require('../armazem');
const P = require('../publicador');

const REDE = 'facebook';

async function publicar(id, { hash, base } = {}) {
  const a = armazem();
  const cfg = await P.config();
  if (!cfg.publishers?.facebook) throw new P.ErroPub('FACEBOOK_DESLIGADO', 'A publicação no Facebook está desligada em Ajustes.', 409);
  if (!process.env.META_PAGE_ID || !process.env.META_PAGE_ACCESS_TOKEN || !process.env.PUBLISH_SECRET) throw new P.ErroPub('SEM_CONFIG', 'Falta META_PAGE_ID, META_PAGE_ACCESS_TOKEN ou PUBLISH_SECRET no servidor.', 503);
  if (cfg.publish_paused) throw new P.ErroPub('PAUSADO', 'As publicações estão pausadas.', 409);
  const { c, v } = await P.carregarAprovado(id, hash);
  const { slides, avisos } = await P.conferirMidias(c, v, cfg);
  const legenda = P.montarLegenda(v);
  if (!base) throw new P.ErroPub('SEM_URL_PUBLICA', 'Defina PUBLIC_BASE_URL no servidor.', 503);

  const existente = await a.publicacoes.obter(P.conta(), id, REDE);
  if (existente && existente.estado !== 'erro') return P.resposta(existente);
  const dados = { versao: v.id, hash_versao: v.hash, n_slides: slides.length, avisos, erro: null };
  let pub;
  if (existente) pub = await a.publicacoes.reiniciar(P.conta(), id, REDE, dados);
  else { const r = await a.publicacoes.iniciar(P.conta(), id, REDE, dados); pub = r.criada ? r.pub : null; }
  if (!pub) return P.resposta(await a.publicacoes.obter(P.conta(), id, REDE));   // outra chamada simultânea venceu

  const pagina = process.env.META_PAGE_ID;
  try {
    let postId;
    if (slides.length === 1) {
      const r = await meta.graph('POST', `${pagina}/photos`, { url: P.urlMidia(base, id, v.hash, 0), caption: legenda });
      postId = r.post_id || r.id;
    } else {
      const fotos = await Promise.all(slides.map((_, i) => meta.graph('POST', `${pagina}/photos`, { url: P.urlMidia(base, id, v.hash, i), published: false })));
      const r = await meta.graph('POST', `${pagina}/feed`, { message: legenda, attached_media: JSON.stringify(fotos.map((f) => ({ media_fbid: f.id }))) });
      postId = r.id;
    }
    const feita = await a.publicacoes.atualizar(P.conta(), id, REDE, ['iniciada'], 'publicada', { ig_media_id: postId, permalink: `https://www.facebook.com/${postId}`, publicada_em: new Date().toISOString() });
    return P.resposta(feita || await a.publicacoes.obter(P.conta(), id, REDE));
  } catch (e) {
    const erro = e.meta || meta.interpretarErro(e);
    return P.resposta(await a.publicacoes.atualizar(P.conta(), id, REDE, ['iniciada'], 'erro', { erro }) || await a.publicacoes.obter(P.conta(), id, REDE));
  }
}

module.exports = { name: REDE, publicar, async status(id) { const p = await armazem().publicacoes.obter(P.conta(), id, REDE); return p ? P.resposta(p) : null; } };
