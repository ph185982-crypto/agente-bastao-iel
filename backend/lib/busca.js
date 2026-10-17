// Busca web OPCIONAL para achar outras fontes de uma afirmação.
// A busca só ENCONTRA links. Nenhum resultado vira evidência pelo que o buscador
// diz: o servidor abre cada página (mesmas proteções de rede), extrai o texto e
// o trecho precisa existir literalmente no que foi lido.
//
// Provedores (escolhidos pela chave presente no servidor):
//  - TAVILY_API_KEY → Tavily, POST /search, topic "news" (docs.tavily.com, conferido em 17/10/2026);
//  - BRAVE_SEARCH_API_KEY → Brave News Search (GET /res/v1/news/search). O formato da
//    resposta não estava descrito na página lida: o código lê só título e URL e
//    ignora o resto.
// Sem chave: devolve null e a conferência explica a cobertura (feeds + dados oficiais).
const { safeFetch } = require('./safeFetch');

function provedor() {
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave';
  return null;
}

const limpa = (r) => (r && /^https?:\/\//.test(r.url || '') ? { titulo: String(r.title || '').slice(0, 300), url: r.url, publicada_em: r.published_date || r.page_age || null } : null);

async function buscar(consulta, { dias = 30, max = 6, fetcher } = {}) {
  const p = provedor();
  if (!p) return null;
  const t0 = Date.now();
  const q = String(consulta || '').slice(0, 300);
  if (p === 'tavily') {
    const r = await (fetcher || fetch)('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query: q, topic: 'news', search_depth: 'basic', time_range: dias <= 7 ? 'week' : dias <= 31 ? 'month' : 'year', max_results: Math.min(max, 10), include_raw_content: false, include_usage: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Busca (Tavily) respondeu HTTP ${r.status}`);
    const j = await r.json();
    return { provedor: 'tavily', duracao_ms: Date.now() - t0, creditos: j.usage?.credits ?? null, resultados: (j.results || []).map(limpa).filter(Boolean) };
  }
  const u = new URL('https://api.search.brave.com/res/v1/news/search');
  u.search = new URLSearchParams({ q, country: 'BR', search_lang: 'pt-br', freshness: dias <= 1 ? 'pd' : dias <= 7 ? 'pw' : dias <= 31 ? 'pm' : 'py', count: String(Math.min(max, 20)) }).toString();
  const r = await (fetcher || fetch)(u.toString(), { headers: { accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Busca (Brave) respondeu HTTP ${r.status}`);
  const j = await r.json();
  return { provedor: 'brave', duracao_ms: Date.now() - t0, creditos: null, resultados: (j.results || []).map(limpa).filter(Boolean) };
}

const cobertura = () => (provedor()
  ? `Busca web ativa (${provedor()}): além dos feeds e dados oficiais, procura outras matérias na web; cada uma é aberta e lida antes de contar.`
  : 'Sem busca web configurada: a conferência usa a matéria que você trouxe, os feeds dos veículos cadastrados e os dados oficiais (Banco Central, IBGE, Câmara). Notícias de outros veículos podem não ser encontradas.');

module.exports = { buscar, provedor, cobertura, _safeFetch: safeFetch };
