// Extrai de uma página HTML o que importa para checagem: título, veículo, datas,
// autor e o texto do corpo. Sem dependências: só cabeçalhos, JSON-LD e os
// parágrafos do <article>/<main>. O resultado é DADO (nunca instrução).
//
// O que NÃO faz, de propósito: executar JavaScript, passar por paywall, usar
// cookies ou contornar bloqueio. Página que exige isso volta como fonte
// "não legível" e o chamador registra a limitação.
const { decodifica } = require('./feeds');

const MAX_TEXTO = 30000;

const attr = (tag, nome) => {
  const m = String(tag).match(new RegExp(`${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodifica(m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
};

function metas(html) {
  const out = {};
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const nome = (attr(m[0], 'property') || attr(m[0], 'name') || attr(m[0], 'itemprop')).toLowerCase();
    const conteudo = attr(m[0], 'content');
    if (nome && conteudo && !(nome in out)) out[nome] = conteudo;
  }
  return out;
}

function jsonLd(html) {
  const itens = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(m[1].trim());
      const lista = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      lista.forEach((x) => itens.push(x));
    } catch { /* JSON-LD quebrado: ignora */ }
  }
  return itens;
}

const eNoticia = (x) => /NewsArticle|Article|ReportageNewsArticle|BlogPosting/i.test([].concat(x['@type'] || []).join(','));
const nomeDe = (v) => (Array.isArray(v) ? v.map(nomeDe).filter(Boolean).join(', ') : typeof v === 'string' ? v : v?.name || '');

const LIXO = /^(leia (tamb[eé]m|mais)|veja (tamb[eé]m|mais)|publicidade|an[uú]ncio|compartilhe|siga (a gente|o|a)|assine|newsletter|receba|cadastre-se|todos os direitos|copyright|©|v[ií]deo:|foto:|imagem:|cr[eé]ditos?:|reprodu[cç][aã]o|clique (aqui|para)|baixe o app|participe do canal)/i;

function textoDoCorpo(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|form|template|button|select|picture|figure|figcaption)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const todos = (tag) => [...h.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
  // Candidatos: cada <article>, <main> e o <body>. Fica o que rende mais texto
  // corrido: há portais (ex.: Senado) com um <article> pequeno de aviso e o texto
  // da matéria fora dele.
  const principais = [...todos('article'), ...todos('main')];
  let melhor = '';
  for (const c of principais) { const t = paragrafos(c); if (t.length > melhor.length) melhor = t; }
  if (melhor.length >= 1500) return melhor; // <article>/<main> com texto de verdade: não mistura o resto da página
  for (const c of [...todos('body'), h]) { const t = paragrafos(c); if (t.length > melhor.length * 1.15) melhor = t; }
  return melhor;
}

function paragrafos(corpo) {
  const blocos = [];
  const re = /<(h[1-4]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(corpo))) {
    const texto = decodifica(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const titulo = /^h/i.test(m[1]);
    if (!texto) continue;
    // Fim da matéria: daqui pra baixo são chamadas para outras notícias.
    if (/^(mais not[íi]cias sobre|not[íi]cias relacionadas)\b/i.test(texto) && blocos.length >= 3) break;
    if (!titulo && texto.length < 40) continue;
    if (LIXO.test(texto)) continue;
    blocos.push(titulo ? `## ${texto}` : texto);
  }
  // Remove parágrafos repetidos em sequência (comum em páginas com carrossel).
  const unicos = blocos.filter((b, i) => b !== blocos[i - 1]);
  return unicos.join('\n\n');
}

const SINAIS_PAYWALL = /(assine (para|e) (ler|continuar)|conte[uú]do exclusivo para assinantes|fa[cç]a login para (ler|continuar)|restante do conte[uú]do|j[aá] [eé] assinante)/i;

function extrairArtigo(html, urlFinal = '') {
  const m = metas(html);
  const ld = jsonLd(html).find(eNoticia) || {};
  const titulo = decodifica(m['og:title'] || ld.headline || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  let host = '';
  try { host = new URL(urlFinal).hostname.replace(/^www\./, ''); } catch { /* sem url */ }
  const veiculo = decodifica(m['og:site_name'] || m['application-name'] || nomeDe(ld.publisher) || host).trim();
  const publicada = m['article:published_time'] || m['og:article:published_time'] || m['datepublished'] || m['date'] || m['pubdate'] || ld.datePublished
    || (html.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i)?.[1] || '');
  const modificada = m['article:modified_time'] || m['og:updated_time'] || ld.dateModified || '';
  const iso = (s) => { const d = new Date(s); return s && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
  const canonical = (html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [''])[0];
  const autores = decodifica(m.author || m['article:author'] || nomeDe(ld.author) || '').trim();
  let texto = textoDoCorpo(html);
  const truncado = texto.length > MAX_TEXTO;
  if (truncado) texto = texto.slice(0, MAX_TEXTO);

  const paragrafos = texto ? texto.split('\n\n').length : 0;
  const observacoes = [];
  if (SINAIS_PAYWALL.test(html) && texto.length < 2500) observacoes.push('A página parece limitada a assinantes: só o início foi lido.');
  if (texto.length < 400) observacoes.push('Pouco texto legível. A página pode depender de JavaScript ou exigir login; cole o texto ou um print.');
  if (truncado) observacoes.push('Texto longo: só os primeiros 30 mil caracteres foram lidos.');

  return {
    titulo,
    veiculo,
    autores: autores || null,
    publicada_em: iso(publicada),
    atualizada_em: iso(modificada),
    url_canonica: attr(canonical, 'href') || null,
    texto,
    paragrafos,
    legivel: texto.length >= 400,
    observacoes,
  };
}

module.exports = { extrairArtigo, textoDoCorpo, metas, jsonLd };
