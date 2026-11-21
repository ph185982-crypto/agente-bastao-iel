// Fotos REAIS pelo Google Imagens (pedido do Pedro, 21/11: "busque as fotos no Google"). Usa a API "Real-Time Image Search"
// do RapidAPI (resultados do Google Imagens) com a RAPIDAPI_KEY do servidor. Só entram fotos grandes, de sites de notícia,
// da própria marca ou de imprensa; banco de imagem pago (Getty, Shutterstock…) e rede social ficam de fora (marca d'água,
// licença). O texto gravado na foto continua barrado pela visão/OCR da etapa de fotos.
const HOST = process.env.GOOGLE_IMAGENS_HOST || 'real-time-image-search.p.rapidapi.com';
const BLOQUEADOS = /(gettyimages|shutterstock|istockphoto|alamy|dreamstime|depositphotos|123rf|adobe\.com|stock\.adobe|bigstock|pond5|agefotostock|vecteezy|freepik|pinterest|pinimg|facebook|fbcdn|instagram|cdninstagram|tiktok|x\.com|twitter|twimg|youtube|ytimg|reddit|wikipedia|wikimedia|lookaside|encrypted-tbn|gstatic)/i;
const chave = () => process.env.RAPIDAPI_KEY_GOOGLE || process.env.RAPIDAPI_KEY || '';
const disponivel = () => !!chave() && process.env.GOOGLE_IMAGENS !== '0';

// Devolve [{ url, titulo, fonte, pagina, largura, altura }] ou lança com { cota } / { semAssinatura }.
async function buscar(consulta, { fetcher = globalThis.fetch, limite = 20, minLado = 900 } = {}) {
  const q = new URLSearchParams({ query: String(consulta).slice(0, 120), limit: String(limite), size: 'large', type: 'photo', region: 'br', safe_search: 'on' });
  const r = await fetcher(`https://${HOST}/search?${q}`, { headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': chave(), accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const corpo = await r.text();
  if (r.status === 429) throw Object.assign(new Error('Google Imagens: cota do RapidAPI esgotada'), { cota: true });
  if (r.status === 403 || r.status === 401) throw Object.assign(new Error(`Google Imagens: a chave do RapidAPI não tem acesso a ${HOST} (${corpo.replace(/\s+/g, ' ').slice(0, 120)})`), { semAssinatura: true });
  if (!r.ok) throw new Error(`Google Imagens respondeu ${r.status}`);
  let j; try { j = JSON.parse(corpo); } catch { throw new Error('Google Imagens: resposta inválida'); }
  const itens = Array.isArray(j?.data) ? j.data : Array.isArray(j?.results) ? j.results : [];
  const vistos = new Set();
  return itens.map((x) => ({ url: x.url || x.image?.url || x.original || '', titulo: String(x.title || '').slice(0, 200), fonte: String(x.source || x.domain || '').slice(0, 80), pagina: x.source_url || x.link || x.page_url || null, largura: Number(x.width || x.image?.width) || 0, altura: Number(x.height || x.image?.height) || 0 }))
    .filter((x) => /^https:\/\//.test(x.url) && !BLOQUEADOS.test(x.url) && !BLOQUEADOS.test(x.pagina || '') && Math.max(x.largura, x.altura) >= minLado && !vistos.has(x.url) && vistos.add(x.url));
}

module.exports = { buscar, disponivel, BLOQUEADOS, HOST };
