// Coleta do Radar: só fontes abertas (RSS/Atom, API pública do Hacker News, Google Trends). Nada de raspar página, de
// contornar bloqueio ou paywall. Tudo passa pelo safeFetch (sem rede interna, com limite de bytes e de tempo).
// O que volta é DADO (título, link, data, trecho): nunca instrução.
const feeds = require('../feeds');
const { safeFetch } = require('../safeFetch');
const C = require('./config');
const U = require('./util');

const TIMEOUT_FEED_MS = 9000;
const ACCEPT_FEED = 'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8';

const campo = (bloco, nome) => { const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i')); return m ? m[1] : ''; };
const primeiraImagem = (bloco) => {
  const m = bloco.match(/<media:(?:content|thumbnail)[^>]*\burl="([^"]+)"/i) || bloco.match(/<enclosure[^>]*\btype="image[^"]*"[^>]*\burl="([^"]+)"/i) || bloco.match(/<enclosure[^>]*\burl="([^"]+)"[^>]*\btype="image/i);
  return m ? feeds.decodifica(m[1]) : null;
};

// RSS 2.0 e Atom. Estende o leitor comum com o <content> do Atom (o Product Hunt escreve a frase de apresentação ali).
function lerItensDoFeed(xml, fonte, { agora = Date.now() } = {}) {
  const base = feeds.parseFeed(xml, { id: fonte.id, nome: fonte.nome, tipo: fonte.classe });
  const blocos = String(xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const porUrl = new Map();
  blocos.forEach((b) => {
    let url = feeds.semTags(campo(b, 'link'));
    if (!url) { const m = b.match(/<link[^>]*href="([^"]+)"/i); url = m ? feeds.decodifica(m[1]) : ''; }
    const conteudo = feeds.semTags(campo(b, 'content')).replace(/\bDiscussion\s*\|\s*Link\b/i, '').trim();
    porUrl.set(url, { conteudo, imagem: primeiraImagem(b) });
  });
  return base.map((i) => {
    const extra = porUrl.get(i.url) || {};
    const resumo = U.limita(i.resumo || extra.conteudo || '', 400);
    return {
      id: `it_${U.sha(i.url)}`, titulo: U.limita(i.titulo, 220), url: i.url, resumo, publicada_em: i.publicada_em,
      fonte_id: fonte.id, fonte_nome: fonte.nome, fonte_classe: fonte.classe, idioma: fonte.idioma, pais_fonte: fonte.pais || null,
      pontos: null, comentarios: null, url_discussao: null, imagem_feed: extra.imagem || null,
    };
  });
}

// Google Trends devolve o termo no <title> e o tráfego aproximado em <ht:approx_traffic>.
function lerTendencias(xml, fonte) {
  const blocos = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocos.map((b) => ({
    termo: feeds.semTags(campo(b, 'title')), trafego: feeds.semTags(campo(b, 'ht:approx_traffic')) || null,
    url: fonte.url, fonte_id: fonte.id, fonte_nome: fonte.nome, geo: /geo=(\w+)/.exec(fonte.url)?.[1] || null,
    publicada_em: feeds.semTags(campo(b, 'pubDate')) ? new Date(feeds.semTags(campo(b, 'pubDate'))).toISOString() : null,
  })).filter((t) => t.termo);
}

const lerHN = (json, fonte) => (json?.hits || []).filter((h) => h.title && (h.url || h.objectID)).map((h) => ({
  id: `it_${U.sha(h.url || `hn${h.objectID}`)}`, titulo: U.limita(feeds.decodifica(h.title), 220), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
  resumo: U.limita(feeds.decodifica((h.story_text || '').replace(/<[^>]*>/g, ' ')), 400), publicada_em: h.created_at || null,
  fonte_id: fonte.id, fonte_nome: fonte.nome, fonte_classe: fonte.classe, idioma: 'en', pais_fonte: fonte.pais || null,
  pontos: Number.isFinite(h.points) ? h.points : null, comentarios: Number.isFinite(h.num_comments) ? h.num_comments : null,
  url_discussao: `https://news.ycombinator.com/item?id=${h.objectID}`, imagem_feed: null,
}));

async function lerUmFeed(fonte, { fetcher, agora }) {
  const t0 = Date.now();
  try {
    const r = await fetcher(fonte.url, { timeoutMs: TIMEOUT_FEED_MS, maxBytes: 1.5 * 1024 * 1024, accept: ACCEPT_FEED });
    if (r.acesso_negado || r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}`), { code: r.acesso_negado ? 'NEGADO' : 'HTTP' });
    if (fonte.classe === 'tendencia') {
      const t = lerTendencias(r.corpo, fonte);
      return { fonte, ok: true, itens: [], tendencias: t, consultado_em: new Date(agora).toISOString(), ms: Date.now() - t0 };
    }
    const itens = lerItensDoFeed(r.corpo, fonte, { agora });
    if (!itens.length) throw Object.assign(new Error('o feed não trouxe itens legíveis'), { code: 'VAZIO' });
    return { fonte, ok: true, itens, tendencias: [], consultado_em: new Date(agora).toISOString(), ms: Date.now() - t0 };
  } catch (e) {
    return { fonte, ok: false, itens: [], tendencias: [], erro: e.code === 'TIMEOUT' ? 'tempo esgotado' : U.limita(e.message, 120), consultado_em: new Date(agora).toISOString(), ms: Date.now() - t0 };
  }
}

async function lerHackerNews({ fetcher, agora, termos }) {
  const desde = Math.floor((agora - 5 * 86400000) / 1000);
  const desde30 = Math.floor((agora - 60 * 86400000) / 1000);
  const consultas = [
    { fonte: C.FONTES_API[0], url: `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=${encodeURIComponent(`created_at_i>${desde},points>=12`)}&hitsPerPage=60` },
    ...termos.map((t) => ({ fonte: C.FONTES_API[1], termo: t, url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(t)}&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${desde30},points>=10`)}&hitsPerPage=12` })),
  ];
  const res = await U.emParalelo(consultas, 6, async (c) => {
    try {
      const r = await fetcher(c.url, { timeoutMs: TIMEOUT_FEED_MS, maxBytes: 1.5 * 1024 * 1024, accept: 'application/json' });
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      const itens = lerHN(JSON.parse(r.corpo), c.fonte).map((i) => ({ ...i, termo: c.termo || null }));
      return { ...c, ok: true, itens };
    } catch (e) { return { ...c, ok: false, itens: [], erro: e.code === 'TIMEOUT' ? 'tempo esgotado' : U.limita(e.message, 120) }; }
  });
  return res;
}

// Coleta tudo em paralelo. Falha de uma fonte não derruba as outras: fica no relatório com o motivo.
async function coletar({ deps = {}, agora = Date.now(), fontes = C.FONTES } = {}) {
  const fetcher = deps.fetcher || safeFetch;
  const ativas = fontes.filter((f) => !f.inativo);
  const [feedsRes, hnRes] = await Promise.all([
    U.emParalelo(ativas, 8, (f) => lerUmFeed(f, { fetcher, agora })),
    lerHackerNews({ fetcher, agora, termos: C.TERMOS_EN }),
  ]);
  const itens = [...feedsRes.flatMap((r) => r.itens), ...hnRes.flatMap((r) => r.itens)];
  const tendencias = feedsRes.flatMap((r) => r.tendencias);
  const status = [
    ...feedsRes.map((r) => ({ id: r.fonte.id, nome: r.fonte.nome, tipo: r.fonte.classe === 'tendencia' ? 'tendencias' : 'feed', ok: r.ok, itens: r.itens.length + r.tendencias.length, erro: r.erro || null, consultado_em: r.consultado_em, ms: r.ms })),
    { id: 'hn_show', nome: C.FONTES_API[0].nome, tipo: 'api', ok: hnRes[0].ok, itens: hnRes[0].itens.length, erro: hnRes[0].erro || null, consultado_em: new Date(agora).toISOString() },
    ...hnRes.slice(1).map((r) => ({ id: `hn_busca:${r.termo}`, nome: `Hacker News: “${r.termo}”`, tipo: 'busca', ok: r.ok, itens: r.itens.length, erro: r.erro || null, consultado_em: new Date(agora).toISOString() })),
    ...fontes.filter((f) => f.inativo).map((f) => ({ id: f.id, nome: f.nome, tipo: 'inativa', ok: false, itens: 0, inativo: true, erro: f.inativo, consultado_em: null })),
  ];
  return { itens, tendencias, status, termos: { en: C.TERMOS_EN, pt: C.TERMOS_PT } };
}

// ── Preparação: dedupe, janela de datas, ordenação por relevância ───────────
const RUIDO = /\b(election|elei[cç][aã]o|trump|biden|lula|bolsonaro|war\b|guerra|ukraine|ucr[aâ]nia|gaza|israel|nfl|nba|premier league|copa do mundo|futebol|bbb|celebrity|celebridade|obituary|morre|morreu|crime|assassin|shooting|earthquake|terremoto|hurricane|furac[aã]o)\b/i;

function relevancia(item, { agora, termos }) {
  const t = U.norm(`${item.titulo} ${item.resumo}`);
  let s = 0;
  for (const termo of termos) {
    const ws = U.norm(termo).split(' ').filter((w) => w.length > 3);
    const acertos = ws.filter((w) => t.includes(w)).length;
    if (ws.length && acertos / ws.length >= 0.6) s += 2;
  }
  if (item.termo) s += 2;                                  // veio de uma busca por termo
  if (Number.isFinite(item.pontos)) s += Math.min(4, Math.log10(1 + item.pontos));
  if (Number.isFinite(item.comentarios)) s += Math.min(2, Math.log10(1 + item.comentarios));
  if (item.fonte_classe === 'plataforma') s += 1.5;        // lançamentos de produto são, por natureza, candidatos
  if (/\b(revenue|arr\b|mrr\b|profit|bootstrapp|customers|users|raises?|raised|funding|launch|startup|saas|faturamento|receita|lucro|clientes|usu[aá]rios|lan[cç]a|neg[oó]cio|empreend)/i.test(t)) s += 1.5;
  const idade = item.publicada_em ? (agora - Date.parse(item.publicada_em)) / 86400000 : 7;
  s += idade <= 2 ? 1.5 : idade <= 7 ? 0.8 : 0;
  return s;
}

function preparar(itens, { agora = Date.now(), limite = 220, porFonte = 28, janelaDias = 30, termos = [...C.TERMOS_EN, ...C.TERMOS_PT] } = {}) {
  const vistos = new Set(); const titulos = new Set(); const out = [];
  let duplicados = 0; let velhos = 0; let ruido = 0;
  for (const i of itens) {
    const chaveUrl = i.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    const chaveTitulo = U.norm(i.titulo).slice(0, 80);
    if (vistos.has(chaveUrl) || (chaveTitulo.length > 20 && titulos.has(chaveTitulo))) { duplicados += 1; continue; }
    vistos.add(chaveUrl); titulos.add(chaveTitulo);
    if (i.publicada_em && agora - Date.parse(i.publicada_em) > janelaDias * 86400000) { velhos += 1; continue; }
    if (RUIDO.test(i.titulo)) { ruido += 1; continue; }
    out.push({ ...i, relevancia: relevancia(i, { agora, termos }) });
  }
  out.sort((a, b) => b.relevancia - a.relevancia);
  const contagem = {}; const final = [];
  for (const i of out) { contagem[i.fonte_id] = (contagem[i.fonte_id] || 0) + 1; if (contagem[i.fonte_id] <= porFonte) final.push(i); if (final.length >= limite) break; }
  return { itens: final, duplicados, antigos: velhos, ruido, total_lido: itens.length };
}

module.exports = { coletar, preparar, lerItensDoFeed, lerTendencias, lerHN, relevancia, lerUmFeed };
