// Leitura de feeds RSS/Atom publicados pelos próprios veículos e agências.
// É o uso previsto de um feed (assinatura), diferente de raspar página ou usar
// um buscador fora dos termos. Tudo passa pelo safeFetch (sem rede interna,
// com limite de bytes e tempo). O que volta é DADO: título, link, data, resumo.
//
// Limite honesto: um feed só traz o que o veículo publicou nos últimos dias.
// Isto não é uma busca no tempo todo; uma afirmação antiga fica "não verificada"
// em vez de parecer confirmada.
const { safeFetch } = require('./safeFetch');

const FEEDS = [
  { id: 'agenciabrasil', nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', tipo: 'agencia_publica' },
  { id: 'agenciabrasil_economia', nome: 'Agência Brasil Economia', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', tipo: 'agencia_publica' },
  { id: 'agenciasenado', nome: 'Agência Senado', url: 'https://www12.senado.leg.br/noticias/rss', tipo: 'agencia_publica' },
  { id: 'g1_economia', nome: 'g1 Economia', url: 'https://g1.globo.com/rss/g1/economia/', tipo: 'jornal', inativo: 'o veículo recusa leitura automática (HTTP 403, testado em 17/10/2026)' },
  { id: 'g1_politica', nome: 'g1 Política', url: 'https://g1.globo.com/rss/g1/politica/', tipo: 'jornal', inativo: 'o veículo recusa leitura automática (HTTP 403, testado em 17/10/2026)' },
  { id: 'folha_mercado', nome: 'Folha Mercado', url: 'https://feeds.folha.uol.com.br/mercado/rss091.xml', tipo: 'jornal', inativo: 'o veículo recusa leitura automática (HTTP 403, testado em 17/10/2026)' },
  { id: 'infomoney', nome: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/', tipo: 'jornal' },
  { id: 'exame', nome: 'Exame', url: 'https://exame.com/feed/', tipo: 'jornal' },
  { id: 'poder360', nome: 'Poder360', url: 'https://www.poder360.com.br/feed/', tipo: 'jornal' },
];

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ', ccedil: 'ç', agrave: 'à', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ccedil: 'Ç', Atilde: 'Ã', Otilde: 'Õ', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô' };

function decodifica(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTIDADES ? ENTIDADES[n] : m));
}
const semCdata = (s) => String(s || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const semTags = (s) => decodifica(semCdata(s)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function campo(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i'));
  return m ? m[1] : '';
}

function dataISO(s) {
  const d = new Date(decodifica(semCdata(s)).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Aceita RSS 2.0 (<item>) e Atom (<entry>).
function parseFeed(xml, feed = {}) {
  const itens = [];
  const blocos = String(xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocos) {
    const titulo = semTags(campo(b, 'title'));
    let url = semTags(campo(b, 'link'));
    if (!url) { const m = b.match(/<link[^>]*href="([^"]+)"/i); url = m ? decodifica(m[1]) : ''; }
    const publicada = dataISO(campo(b, 'pubDate') || campo(b, 'published') || campo(b, 'updated') || campo(b, 'dc:date'));
    const resumo = semTags(campo(b, 'description') || campo(b, 'summary') || campo(b, 'content:encoded')).slice(0, 500);
    if (!titulo || !/^https?:\/\//i.test(url)) continue;
    itens.push({ titulo, url, publicada_em: publicada, resumo, origem: feed.nome || null, feed: feed.id || null, tipo_fonte: feed.tipo || null });
  }
  return itens;
}

const _cache = new Map(); // id -> { at, itens, erro }
const TTL_MS = 10 * 60e3;

async function lerFeed(feed, { force = false, fetcher = safeFetch } = {}) {
  const c = _cache.get(feed.id);
  if (!force && c && Date.now() - c.at < TTL_MS) return c;
  try {
    const r = await fetcher(feed.url, { timeoutMs: 10000, maxBytes: 1.5 * 1024 * 1024, accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8' });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    const itens = parseFeed(r.corpo, feed);
    const out = { at: Date.now(), itens, erro: null, consultado_em: new Date().toISOString() };
    _cache.set(feed.id, out);
    return out;
  } catch (e) {
    const out = { at: Date.now(), itens: [], erro: e.message, consultado_em: new Date().toISOString() };
    _cache.set(feed.id, out);
    return out;
  }
}

// Todos os feeds em paralelo; falha de um não derruba os outros e fica registrada.
// Feeds marcados como inativos não são lidos (o veículo recusa leitura automática):
// ficam no relatório com o motivo, sem tentar contornar.
async function lerTodos({ feeds = FEEDS, fetcher, force } = {}) {
  const ativos = feeds.filter((f) => !f.inativo);
  const res = await Promise.all(ativos.map(async (f) => ({ feed: f, ...(await lerFeed(f, { fetcher, force })) })));
  return {
    itens: res.flatMap((r) => r.itens),
    status: [
      ...res.map((r) => ({ id: r.feed.id, nome: r.feed.nome, ok: !r.erro, erro: r.erro, itens: r.itens.length, consultado_em: r.consultado_em })),
      ...feeds.filter((f) => f.inativo).map((f) => ({ id: f.id, nome: f.nome, ok: false, erro: f.inativo, itens: 0, inativo: true, consultado_em: null })),
    ],
  };
}

// ── Texto → termos ─────────────────────────────────────────────────────────
const STOP = new Set('de da do das dos a o as os e em no na nos nas um uma uns umas para por com sem sobre entre ate apos que se ao aos à às pelo pela pelos pelas como mais menos mas ou ja nao sim foi sao ser tem ter vai vao seu sua seus suas esta este isso esse essa'.split(' '));
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const termos = (s) => semAcento(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

function pontuacao(item, palavras) {
  const t = new Set(termos(`${item.titulo} ${item.resumo}`));
  const tituloTermos = new Set(termos(item.titulo));
  let p = 0;
  for (const w of palavras) {
    const radical = w.length > 5 ? w.slice(0, w.length - 1) : w;
    if (tituloTermos.has(w) || [...tituloTermos].some((x) => x.startsWith(radical))) p += 2;
    else if (t.has(w) || [...t].some((x) => x.startsWith(radical))) p += 1;
  }
  return p;
}

// Itens recentes que combinam com as palavras. Janela em dias.
function filtrar(itens, { palavras = [], dias = 4, agora = Date.now(), minimo = 1 } = {}) {
  const corte = agora - dias * 86400e3;
  const ps = palavras.flatMap((p) => termos(p));
  return itens
    .filter((i) => !i.publicada_em || Date.parse(i.publicada_em) >= corte)
    .map((i) => ({ ...i, relevancia: ps.length ? pontuacao(i, ps) : 1 }))
    .filter((i) => i.relevancia >= minimo)
    .sort((a, b) => b.relevancia - a.relevancia || Date.parse(b.publicada_em || 0) - Date.parse(a.publicada_em || 0));
}

// Agrupa notícias do MESMO acontecimento (vários veículos) pra mostrar uma pauta só.
function agruparEventos(itens, limite = 0.5) {
  const grupos = [];
  for (const it of itens) {
    const t = new Set(termos(it.titulo));
    let alvo = null;
    for (const g of grupos) {
      const inter = [...t].filter((w) => g.termos.has(w)).length;
      if (t.size && inter / Math.min(t.size, g.termos.size) >= limite && inter >= 3) { alvo = g; break; }
    }
    if (alvo) { alvo.itens.push(it); it.termos?.forEach?.((w) => alvo.termos.add(w)); }
    else grupos.push({ termos: t, itens: [it] });
  }
  return grupos.map((g) => ({ principal: g.itens[0], itens: g.itens, veiculos: [...new Set(g.itens.map((i) => i.origem))] }));
}

module.exports = { FEEDS, parseFeed, lerFeed, lerTodos, filtrar, agruparEventos, termos, decodifica, semTags };
