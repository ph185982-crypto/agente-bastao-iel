// App Store (API pública de busca da Apple): quando o negócio é um aplicativo, o número de avaliações é medido pela própria loja.
// Só entra se o nome do app é igual ao da empresa e (o site do desenvolvedor bate com o site oficial OU o desenvolvedor tem o mesmo nome).
const { safeFetch } = require('../safeFetch');
const U = require('./util');
const Ev = require('../evidence');

async function consultar(cand, { agora = Date.now(), fetcher = safeFetch } = {}) {
  const termo = encodeURIComponent(cand.nome);
  const r = await fetcher(`https://itunes.apple.com/search?term=${termo}&entity=software&country=us&limit=5`, { timeoutMs: 8000, maxBytes: 600000, accept: 'application/json' });
  if (r.status >= 400) return null;
  let j; try { j = JSON.parse(r.corpo); } catch { return null; }
  const alvo = U.norm(cand.nome).replace(/\s+/g, '');
  const dom = cand.chave?.dominio || (cand.url_oficial ? Ev.dominioRegistravel(cand.url_oficial) : '');
  const app = (j.results || []).find((a) => {
    const nome = U.norm(a.trackName).replace(/\s+/g, '');
    if (!(nome === alvo || nome.startsWith(alvo))) return false;
    const siteDev = a.sellerUrl ? Ev.dominioRegistravel(a.sellerUrl) : '';
    return (dom && siteDev === dom) || U.norm(a.sellerName || a.artistName).replace(/\s+/g, '').includes(alvo);
  });
  if (!app || !Number.isFinite(app.userRatingCount) || app.userRatingCount < 1) return null;
  const nota = Number.isFinite(app.averageUserRating) ? `, nota média ${app.averageUserRating.toFixed(1)}` : '';
  return {
    url: app.trackViewUrl.split('?')[0], url_pedida: app.trackViewUrl, titulo: app.trackName, veiculo: 'App Store (Apple)', publicada_em: app.currentVersionReleaseDate || null,
    acessada_em: new Date(agora).toISOString(), dominio: 'apple.com',
    texto: `${app.trackName} tem ${app.userRatingCount} avaliações na App Store${nota}.`,
    metrica: { tipo: 'avaliacoes_app', numero: app.userRatingCount },
  };
}
module.exports = { consultar };
