// Foto real do protagonista da pauta, com licença que permite uso com crédito (Wikimedia Commons).
// Aceita só CC BY (qualquer versão, incluindo "CC BY 3.0 br" da Agência Brasil), CC0 e domínio público.
// CC BY-SA fica de fora: a arte é uma adaptação e o "compartilha igual" obrigaria a licenciar o carrossel inteiro.
// O rosto nunca é gerado nem alterado: a arte só converte para preto e branco e recorta a borda.
const BASE = 'https://commons.wikimedia.org/w/api.php';
const UA = 'PedroDestravaEstudio/1.0 (https://agente-bastao-iel.vercel.app; contato via app)';
const LICENCA_OK = /^(cc[ -]by(?![ -]?sa)(?![ -]?nd)(?![ -]?nc)[ -]?\d(\.\d)?( [a-z]{2})?|cc0|public domain|domínio público|pd(-[a-z]+)?)$/i;
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const limpaHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

// Só CC0 / domínio público (licenças que não exigem crédito): usado no "Por trás da marca", que não leva crédito na legenda.
const LICENCA_LIVRE = /^(cc0( 1\.0)?|public domain|domínio público|pd(-[a-z]+)?)$/i;
// 21/11: o Pedro decidiu não filtrar por direito de uso ("pule eles"). Toda licença do Commons entra; o nome da licença fica
// registrado na imagem. FOTOS_SO_LIVRE=1 volta ao filtro antigo (só CC BY/CC0/domínio público; soLivre: só CC0/PD).
function licencaAceita(meta, { soLivre = false } = {}) {
  const nome = limpaHtml(meta?.LicenseShortName?.value || meta?.License?.value || '');
  if (process.env.FOTOS_SO_LIVRE !== '1') return nome.trim() || 'licença não informada';
  return (soLivre ? LICENCA_LIVRE : LICENCA_OK).test(nome.trim()) ? nome : null;
}

// Pontua: nome no título do arquivo, foto recente, formato retrato, tamanho bom.
function pontuar(item, nome) {
  const titulo = sem(item.title);
  const partes = sem(nome).split(/\s+/).filter((p) => p.length >= 3);
  if (!partes.length || !partes.every((p) => titulo.includes(p))) return -1;
  const ii = item.imageinfo?.[0] || {};
  if (!/\.(jpe?g|png)$/i.test(item.title) || (ii.width || 0) < 700 || (ii.height || 0) < 700) return -1;
  const ano = Number((titulo.match(/\b(20[12]\d)\b/) || [])[1] || (String(ii.extmetadata?.DateTimeOriginal?.value || '').match(/\b(20[12]\d)\b/) || [])[1] || 0);
  let p = 10;
  if (ano) p += Math.max(0, 8 - (2026 - ano));
  if ((ii.height || 0) >= (ii.width || 0) * 0.9) p += 3;
  if (/(retrato|portrait|oficial|official|foto oficial)/.test(titulo)) p += 4;
  if (/(reuniao|meeting|cerimonia|ceremony|grupo|group|com |with )/.test(titulo)) p -= 3;
  return p;
}

// Lugar/instituição: foto do ambiente, nunca retrato de alguém (uma senadora qualquer na capa sugere que ela está na notícia).
const PESSOA = /(senador|deputad|ministr|president|governador|prefeit|discurs|pronunciament|entrevista|retrato|portrait|posse|cerimonia|homenage|reuniao|audiencia|depoiment|protest|manifest|greenpeace|\bato\b|faixa|cartaz|banner|ocupa)/;
function pontuarLugar(item, nome) {
  const titulo = sem(item.title);
  const partes = sem(nome).split(/\s+/).filter((p) => p.length >= 4);
  if (!partes.length || partes.filter((p) => titulo.includes(p)).length < Math.min(2, partes.length)) return -1;
  if (PESSOA.test(titulo)) return -1;
  // séries numeradas do Flickr (Agência Senado/Câmara, "(14786000717)") são fotos de sessão: quase sempre alguém discursando
  if (/\(\d{8,}\)/.test(titulo) || /\b(sessao|plenario)\b/.test(titulo) && !/(vista|panorama|vazio|empty)/.test(titulo)) return -1;
  const ii = item.imageinfo?.[0] || {};
  if (!/\.(jpe?g|png)$/i.test(item.title) || (ii.width || 0) < 1000 || (ii.height || 0) < 700) return -1;
  let p = 10;
  if (/(fachada|predio|edificio|exterior|vista|panorama|cupula|congresso nacional)/.test(titulo)) p += 5;
  if (/(plenario|vista|fachada|predio|panorama|interior|exterior|sessao|cupula|edificio|sede|congresso)/.test(titulo)) p += 5;
  const ano = Number((titulo.match(/\b(1[89]\d\d|20[0-2]\d)\b/) || [])[1] || 0);
  if (ano && ano < 1990) return -1; // foto histórica não serve de capa de notícia
  return p;
}

async function buscar(nome, { fetcher = fetch, limite = 25, modo = 'pessoa', soLivre = false } = {}) {
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${nome} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(limite), prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1280', origin: '*' });
  const r = await fetcher(`${BASE}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Commons respondeu ${r.status}`);
  const d = await r.json();
  const itens = Object.values(d?.query?.pages || {});
  return itens
    .map((it) => ({ it, lic: licencaAceita(it.imageinfo?.[0]?.extmetadata, { soLivre }), p: modo === 'lugar' ? pontuarLugar(it, nome) : modo === 'marca' ? pontuarMarca(it, nome) : modo === 'conceito' ? pontuarConceito(it, nome) : pontuar(it, nome) }))
    .filter((x) => x.lic && x.p >= 0)
    .sort((a, b) => b.p - a.p)
    .map(({ it, lic }) => {
      const ii = it.imageinfo[0]; const em = ii.extmetadata || {};
      return { titulo: it.title, url: ii.thumburl || ii.url, pagina: ii.descriptionurl, licenca: lic, autor: limpaHtml(em.Artist?.value || em.Credit?.value || 'autor não informado').slice(0, 120), largura: ii.thumbwidth || ii.width, altura: ii.thumbheight || ii.height };
    });
}

// Baixa um item da busca. Devolve { dados, meta } ou null (host fora do Commons, tamanho estranho, falha).
async function baixar(f, nome, fetcher) {
  try {
    const u = new URL(f.url);
    if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(u.hostname)) return null; // o Commons passou a servir miniaturas por thumb.
    const r = await fetcher(f.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const dados = Buffer.from(await r.arrayBuffer());
    if (dados.length < 20000 || dados.length > 8 * 1024 * 1024) return null;
    return { dados, meta: { id: `commons_${require('crypto').createHash('sha1').update(f.titulo).digest('hex').slice(0, 12)}`, tipo: 'foto_real', titulo: f.titulo, origem: f.pagina, autor: f.autor, licenca: f.licenca, exige_credito: !/cc0|public domain|domínio público|^pd/i.test(f.licenca), alt: `Foto de ${nome}` } };
  } catch { return null; }
}

// Baixa a melhor foto. Devolve { dados: Buffer, meta } ou null (sem foto com licença aceita).
async function fotoDe(nome, { fetcher = fetch, modo = 'pessoa', soLivre = false } = {}) {
  if (!nome || sem(nome).length < 4) return null;
  const lista = await buscar(nome, { fetcher, modo, soLivre });
  for (const f of lista.slice(0, 3)) { const x = await baixar(f, nome, fetcher); if (x) return x; }
  return null;
}

// Marca (loja, produto, fachada, fundador): o nome da marca tem de estar no título do arquivo; logotipo fica de fora
// (vira fundo ruim e costuma ter regra de marca registrada). Foto recente e boa resolução pesam a favor.
function pontuarMarca(item, nome) {
  const titulo = sem(item.title);
  const partes = sem(nome).split(/\s+/).filter((p) => p.length >= 2);
  if (!partes.length || !partes.every((p) => titulo.includes(p))) return -1;
  if (/\b(logo|logotipo|logomarca|wordmark|icon|icone|simbolo|symbol)\b/.test(titulo)) return -1;
  const ii = item.imageinfo?.[0] || {};
  if (!/\.(jpe?g|png)$/i.test(item.title) || (ii.width || 0) < 700 || (ii.height || 0) < 600) return -1;
  let p = 10;
  if (/(loja|store|shop|fachada|facade|restaurante|restaurant|unidade|quiosque|kiosk|produto|product|sede|headquarters|fabrica|factory)/.test(titulo)) p += 4;
  const ano = Number((titulo.match(/\b(20[0-2]\d)\b/) || [])[1] || 0);
  if (ano) p += Math.max(0, 6 - Math.floor((2026 - ano) / 2));
  return p;
}

// Várias fotos da MARCA (uma por slide), cada uma com licença aceita e crédito. Devolve [{ dados, meta }] (pode vir vazia).
async function fotosDaMarca(nome, { fetcher = fetch, max = 4, excluir = [], soLivre = false } = {}) {
  if (!nome || sem(nome).replace(/\s+/g, '').length < 2) return [];
  const lista = await buscar(nome, { fetcher, modo: 'marca', limite: 40, soLivre });
  const out = [];
  for (const f of lista) {
    if (out.length >= max) break;
    const x = await baixar(f, nome, fetcher);
    if (x && !excluir.includes(x.meta.id) && !out.some((y) => y.meta.id === x.meta.id)) out.push({ ...x, meta: { ...x.meta, alt: `Foto ligada à marca ${nome}` } });
  }
  return out;
}

// Conceito genérico (entrega, celular, fábrica…) para o slide que ficou sem foto da marca: pelo menos uma palavra da busca
// no título do arquivo, sem logotipo, foto grande (lado maior ≥ 900 px).
function pontuarConceito(item, termo) {
  const titulo = sem(item.title);
  const partes = sem(termo).split(/\s+/).filter((p) => p.length >= 4);
  const acertos = partes.filter((p) => titulo.includes(p)).length;
  if (!acertos) return -1;
  if (/\b(logo|logotipo|logomarca|wordmark|icon|icone|simbolo|symbol|map|mapa|diagram|chart|grafico|flag|bandeira)\b/.test(titulo)) return -1;
  const ii = item.imageinfo?.[0] || {};
  if (!/\.(jpe?g)$/i.test(item.title) || Math.max(ii.width || 0, ii.height || 0) < 900) return -1;
  const ano = Number((titulo.match(/\b(1[89]\d\d|20[0-2]\d)\b/) || [])[1] || 0);
  if (ano && ano < 1980) return -1;
  return 10 + acertos * 3;
}

// Uma foto do Commons para um CONCEITO (termos da tela). Por padrão só CC0/domínio público (sem crédito obrigatório).
async function fotosDoConceito(termo, { fetcher = fetch, max = 1, excluir = [], soLivre = true } = {}) {
  if (!termo || sem(termo).replace(/\s+/g, '').length < 4) return [];
  const lista = await buscar(termo, { fetcher, modo: 'conceito', limite: 30, soLivre });
  const out = [];
  for (const f of lista) {
    if (out.length >= max) break;
    const x = await baixar(f, termo, fetcher);
    if (x && !excluir.includes(x.meta.id)) out.push({ ...x, meta: { ...x.meta, alt: f.titulo.replace(/^File:/, '').replace(/\.[a-z]+$/i, '') } });
  }
  return out;
}

// Logo de empresa para o formato "Quem é ele?" (painel da aposta): arquivo vetorial do Commons com o nome da empresa e
// "logo" no título; vem como PNG com transparência (miniatura de 960 px, tamanho padrão aceito pela Wikimedia).
// Logo no Commons é marca nominativa (identifica a empresa citada na notícia) ou "PD-textlogo".
async function logoDe(empresa, { fetcher = fetch } = {}) {
  // 1º o logo oficial ligado à empresa no Wikidata (nome curto como "Gol" ou "O Boticário" também acha)
  try { const w = await marcaNoWikidata(empresa, { fetcher, estrito: true }); if (w?.logo) { const l = await arquivoCommons(w.logo, { fetcher, largura: 960 }); if (l) return l; } } catch { /* segue para a busca no Commons */ }
  // nome curto ("On", "3M") casa com qualquer arquivo: sem logo, o painel mostra o nome escrito
  const nome = sem(empresa).replace(/[^a-z0-9\s]/g, ' ').trim(); if (nome.replace(/\s/g, '').length < 4) return null;
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${empresa} logo filetype:drawing`, gsrnamespace: '6', gsrlimit: '15', prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '960', origin: '*' });
  const r = await fetcher(`${BASE}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const itens = Object.values((await r.json())?.query?.pages || {});
  const partes = nome.split(/\s+/).filter((p) => p.length >= 2);
  const pont = (it) => {
    const t = sem(it.title).replace(/[^a-z0-9\s]/g, ' ');
    if (!partes.every((p) => new RegExp(`(^|\\s)${p}(\\s|$)`).test(t)) || !/\blogo/.test(t)) return -1; // palavra inteira
    // O arquivo tem de ser DESSA empresa e de mais ninguém: tirando logo, ano e cor, sobram só as palavras do nome
    // ("7 Eleven logo" não serve para "Eleven"; "Kate Forbes logo" não serve para "Kate").
    const RUIDO = /^(file|logo|logos|svg|png|jpg|jpeg|wordmark|symbol|icon|brand|official|new|old|color|colour|white|black|blue|red|green|dark|light|horizontal|vertical|stacked|text|inc|ltd|sa|the|de|do|da|com|br|present|atual|current|simple|flat|bw)$/;
    const sobra = t.split(' ').filter((w) => w && !RUIDO.test(w) && !/^\d{4}$/.test(w) && !/^\d{4}\d{4}$/.test(w));
    if (sobra.some((w) => !partes.includes(w))) return -1;
    let p = 10 - (t.length / 20);
    if (/\b(20[12]\d|present|atual|current)\b/.test(t)) p += 3;       // versão recente do logo
    if (/\b(old|antigo|former|19\d\d|200\d)\b/.test(t)) p -= 4;
    if (/\b(icon|icone|symbol|simbolo|favicon|app)\b/.test(t)) p -= 2; // preferimos o logo com o nome
    return p;
  };
  const melhor = itens.map((it) => ({ it, p: pont(it) })).filter((x) => x.p >= 0).sort((a, b) => b.p - a.p)[0];
  if (!melhor?.it?.imageinfo?.[0]?.thumburl) return null;
  const img = await fetcher(melhor.it.imageinfo[0].thumburl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!img.ok) return null;
  const dados = Buffer.from(await img.arrayBuffer());
  return { dados, titulo: melhor.it.title, pagina: melhor.it.imageinfo[0].descriptionurl || null };
}

// ── Wikidata: logo oficial (P154) e produto mais famoso da marca (P1056/P1716 com foto P18) ─────────────────────────
// Pedido do Pedro (22/11): a capa do "Por trás da marca" tem de mostrar a marca na hora (logo + um produto famoso com a
// logo), não uma foto qualquer da matéria. O Wikidata liga a empresa ao arquivo do logo e aos produtos dela (Ferrero →
// Nutella, Ferrero Rocher, Kinder; Gol → avião com a pintura da Gol). Sem chave, sem custo.
const WD = 'https://www.wikidata.org/w/api.php';
const EMPRESA = /(empresa|companhia|marca|fabricante|rede|varejist|grupo|multinacional|corpora|conglomerad|loja|company|brand|manufacturer|airline|aérea|aerea|retailer|chain|business|maker|producer|bank|banco|operadora|startup)/i;
const valores = (it, p) => (it?.claims?.[p] || []).map((x) => x?.mainsnak?.datavalue?.value).filter(Boolean);
async function wdJson(params, fetcher) {
  const r = await fetcher(`${WD}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  return r.json();
}
const SUFIXO_EMPRESA = /^(the|o|a|os|as|company|companies|inc|incorporated|corporation|corp|co|sa|s|se|ag|nv|ltda|plc|llc|group|grupo|holding|holdings|brasil|brazil|&|e|and|cia)$/;
async function marcaNoWikidata(nome, { fetcher = fetch, estrito = false } = {}) {
  const q = String(nome || '').trim(); if (sem(q).replace(/[^a-z0-9]/g, '').length < 2) return null;
  // Busca de texto só entre itens COM logo (acha "Gol" → Gol Linhas Aéreas) + busca por rótulo, nessa ordem.
  const [texto, rotulo] = await Promise.all([
    wdJson({ action: 'query', list: 'search', srlimit: '8', srsearch: `${q} haswbstatement:P154` }, fetcher).catch(() => null),
    wdJson({ action: 'wbsearchentities', language: 'pt', uselang: 'pt', type: 'item', limit: '20', search: q }, fetcher).catch(() => null),
  ]);
  const ids = [...new Set([...(texto?.query?.search || []).map((x) => x.title), ...(rotulo?.search || []).map((x) => x.id)].filter((x) => /^Q\d+$/.test(x || '')))].slice(0, 40);
  if (!ids.length) return null;
  const ent = {};
  for (let i = 0; i < ids.length; i += 20) Object.assign(ent, (await wdJson({ action: 'wbgetentities', props: 'claims|descriptions|labels|aliases|sitelinks', languages: 'pt|en', ids: ids.slice(i, i + 20).join('|') }, fetcher))?.entities || {});
  const lista = ids.map((id) => ent[id]).filter(Boolean);
  const desc = (it) => `${it.descriptions?.pt?.value || ''} ${it.descriptions?.en?.value || ''}`;
  // O nome pedido tem de aparecer como palavra inteira no nome da empresa ("Boticário" ⊂ "O Boticário", "Gol" ⊂ "Gol Linhas
  // Aéreas"); só apelido parecido não basta (a sigla "SBP" de um sistema de pagamento russo não vira a SBP do inseticida).
  const alvo = sem(q).replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nomeBate = (it) => [it.labels?.pt?.value, it.labels?.en?.value].filter(Boolean).some((l) => {
    const n = ` ${sem(l).replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    if (!(n.includes(` ${alvo} `) || ` ${alvo} `.includes(n))) return false;
    // estrito (logo de empresa citada no "Quem é ele?"): além do nome, só sobra palavra de razão social
    // ("Kate" não vira "Kate Spade & Company"; "Coca-Cola" vira "The Coca-Cola Company")
    return !estrito || n.replace(` ${alvo} `, ' ').trim().split(' ').filter(Boolean).every((w) => SUFIXO_EMPRESA.test(w));
  });
  // a empresa: tem logo, a descrição diz que é empresa/marca e o nome bate (nunca o sobrenome, a cidade ou a doença)
  const empresa = lista.find((it) => valores(it, 'P154').length && EMPRESA.test(desc(it)) && nomeBate(it));
  if (!empresa) return null;
  const out = { id: empresa.id, nome: empresa.labels?.pt?.value || empresa.labels?.en?.value || q, descricao: desc(empresa).trim(), categoria: valores(empresa, 'P373')[0] || null, logo: valores(empresa, 'P154')[0] || null, imagem: valores(empresa, 'P18')[0] || null, produto: null, produtos: [] };
  const prodIds = [...new Set([...valores(empresa, 'P1056'), ...valores(empresa, 'P1716')].map((v) => v.id).filter(Boolean))].slice(0, 20);
  if (prodIds.length) {
    const pe = (await wdJson({ action: 'wbgetentities', props: 'claims|labels|sitelinks', languages: 'pt|en', ids: prodIds.join('|') }, fetcher))?.entities || {};
    // produto de MARCA (tem logo próprio e foto), o mais conhecido primeiro (artigos na Wikipédia em mais línguas)
    const prods = Object.values(pe).filter((it) => valores(it, 'P18').length && valores(it, 'P154').length)
      .sort((a, b) => Object.keys(b.sitelinks || {}).length - Object.keys(a.sitelinks || {}).length);
    out.produtos = prods.slice(0, 3).map((it) => ({ nome: it.labels?.pt?.value || it.labels?.en?.value || '', arquivo: valores(it, 'P18')[0], categoria: valores(it, 'P373')[0] || null })).filter((x) => x.nome);
    if (prods[0]) out.produto = out.produtos[0];
  }
  return out;
}

// Baixa um arquivo do Commons pelo nome (miniatura PNG/JPG). Devolve { dados, titulo, pagina } ou null.
async function arquivoCommons(arquivo, { fetcher = fetch, largura = 1280, minBytes = 3000 } = {}) {
  if (!arquivo) return null;
  const d = await wdJson({ action: 'query', titles: `File:${arquivo}`, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: String(largura) }, (u, o) => fetcher(u.replace(WD, BASE), o));
  const ii = Object.values(d?.query?.pages || {})[0]?.imageinfo?.[0];
  const url = ii?.thumburl || ii?.url; if (!url) return null;
  const host = new URL(url).hostname; if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(host)) return null;
  const r = await fetcher(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const dados = Buffer.from(await r.arrayBuffer());
  if (dados.length < minBytes || dados.length > 10 * 1024 * 1024) return null;
  return { dados, titulo: `File:${arquivo}`, pagina: ii.descriptionurl || null };
}

// ── Fotos de capa da marca (22/11, "estamos muito amadores nessas fotos") ─────────────────────────────────────────────
// O que faz a capa parecer profissional: o PRODUTO famoso (Ferrero Rocher, Nutella), a LOJA (Boticário) ou o AVIÃO (Gol)
// em foto grande e bem feita. Busca no Commons por produto/tipo de negócio, exige o nome no título do arquivo, descarta
// logo, mapa, sede e documento, e põe na frente as "Quality images" (fotos revisadas pela comunidade) e as de alta resolução.
const AEREA = /(a[eé]rea|airline|avia[cç][aã]o|aviation)/i;
const LOJA = /(cosm[eé]t|perfum|beleza|beauty|varej|loja|retail|moda|fashion|vestu|cal[cç]ad|farm[aá]c|drogaria|supermerc|restaurant|fast.?food|caf[eé]|sorvet|chocolat|confeit|padaria)/i;
const RUIM_CAPA = /(logo|logotipo|wordmark|\bmapa?\b|\bmap\b|sede|headquarter|\bhq\b|document|jornal|newspaper|chart|gr[aá]fico|diagram|selo|stamp|\bpdf\b|screenshot|captura|interior of a|receipt|nota fiscal|ticket)/i;
async function buscarCommons(q, { fetcher, limite = 20 } = {}) {
  const d = await (await fetcher(`${BASE}?${new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: String(limite), gsrsearch: q, prop: 'imageinfo', iiprop: 'size|url', iiurlwidth: '1280' })}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).json().catch(() => ({}));
  return Object.values(d?.query?.pages || {}).map((it) => ({ titulo: it.title, ii: it.imageinfo?.[0] || {} }));
}
// De onde vêm as fotos: a CATEGORIA do Commons ligada ao produto/à marca no Wikidata (P373) — só tem foto daquilo
// (Ferrero Rocher, O Boticário, Gol Transportes Aéreos). Sem categoria, cai na busca por texto com o nome no título.
function consultasDeCapa(w, marca) {
  const curto = String(marca || w?.nome || '').trim();
  const qs = [];
  for (const p of (w?.produtos || []).slice(0, 3)) qs.push({ q: p.categoria ? `incategory:"${p.categoria}"` : p.nome, chave: p.nome, tipo: 'produto', categoria: !!p.categoria });
  const tipo = AEREA.test(w?.descricao || '') ? 'aviao' : LOJA.test(w?.descricao || '') ? 'loja' : 'marca';
  qs.push({ q: w?.categoria ? `incategory:"${w.categoria}"` : curto, chave: curto, tipo, categoria: !!w?.categoria });
  // companhia aérea: as fotos boas dos aviões ficam em subcategorias (por modelo/prefixo); busca também pelo texto
  if (tipo === 'aviao') qs.push({ q: `${curto} Boeing 737`, chave: curto, tipo, categoria: false }, { q: `${curto} Airbus`, chave: curto, tipo, categoria: false });
  return qs;
}
const BONUS_TIPO = { aviao: /(avi[aã]o|airplane|aeroplane|aircraft|boeing|airbus|\b7[0-9]7\b|a3[0-9]0|embraer|plane|pr-[a-z]{3})/, loja: /(loja|store|shop|shopping|boutique|quiosque|kiosk|mall|fachada)/, produto: /(jar|pote|pack|box|caixa|embalagem|bottle|garrafa|lata|\bcan\b|bar|barra|chocolate|frasco|perfume|produto|product)/, marca: /(loja|store|produto|product)/ };
function notaCapa(item, chave, { qualidade = false, categoria = false, tipo = 'marca' } = {}) {
  const t = sem(item.titulo); const ii = item.ii || {};
  if (!/\.(jpe?g|png|webp)$/i.test(item.titulo) || RUIM_CAPA.test(t)) return -1;
  const partes = sem(chave).replace(/^(o|a|os|as|the)\s+/, '').split(/[^a-z0-9]+/).filter((x) => x.length >= 2);
  const comNome = partes.length > 0 && partes.every((p) => new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(t));
  if (!comNome && !categoria) return -1;   // fora da categoria da marca, o nome tem de estar no arquivo
  // foto da MARCA (não de produto) tem de mostrar o nome ou o tipo do negócio (avião, loja): a categoria "Puma AG" tem
  // jogo de futebol patrocinado; a "Natura", retrato de pessoa
  if (tipo !== 'produto' && !comNome && !BONUS_TIPO[tipo]?.test(t)) return -1;
  const anoAntigo = Number((t.match(/\b(1[5-9]\d\d)\b/) || [])[1] || 0); if (anoAntigo && anoAntigo < 1995) return -1;   // anúncio de 1915 não é capa
  const menor = Math.min(ii.width || 0, ii.height || 0);
  if (menor < 900) return -1;
  let n = Math.min(Math.max(ii.width || 0, ii.height || 0), 5000) / 500 + (qualidade ? 20 : 0) + (comNome ? 8 : 0);
  if (BONUS_TIPO[tipo]?.test(t)) n += 6;
  if (tipo === 'aviao' && /(\bp[rspt][ -][a-z]{3}\b|737|a3[0-9]{2}|max ?8|e19[05])/.test(t)) n += 10;   // foto do avião (prefixo/modelo), não paisagem
  if (/(seen from|visto d[eo]|ao fundo|distant|silhouette|silhueta|night|noite|holding pattern|\bover\b|sobrevoando)/.test(t)) n -= 8;
  // outra companhia/concorrente na mesma foto ("TAM Airbus 320 and Gol Boeing 737") não serve de capa
  if (tipo === 'aviao' && /\b(tam|latam|azul|avianca|varig|american|united|delta|lufthansa|iberia|tap|copa)\b/.test(t.replace(new RegExp(partes.join('|'), 'g'), ''))) n -= 12;
  const ano = Number((t.match(/\b(20[0-2]\d)\b/) || [])[1] || 0); if (ano >= 2015) n += Math.min(4, (ano - 2014) / 2);
  return n;
}
async function melhorDaConsulta(c, fetcher, usados) {
  const [qi, todos] = await Promise.all([
    buscarCommons(`${c.q} incategory:"Quality_images"`, { fetcher, limite: 10 }).catch(() => []),
    buscarCommons(c.q, { fetcher, limite: 40 }).catch(() => []),
  ]);
  const qiSet = new Set(qi.map((x) => x.titulo));
  return [...qi, ...todos].filter((x) => !usados.has(x.titulo))
    .map((x) => ({ x, n: notaCapa(x, c.chave, { qualidade: qiSet.has(x.titulo), categoria: c.categoria, tipo: c.tipo }), qualidade: qiSet.has(x.titulo) }))
    .filter((y) => y.n >= 0).sort((a, b) => b.n - a.n)[0] || null;
}
/**
 * Até 2 fotos para a capa: os produtos famosos (os dois melhores, para montar lado a lado: Ferrero Rocher + Nutella) ou,
 * sem produto bom, a foto da marca (avião da Gol, loja do Boticário). Cada uma: { dados, titulo, pagina, nome, tipo, nota }.
 */
async function fotosDeCapa(w, marca, { fetcher = fetch, max = 2, notaMin = 14 } = {}) {
  const usados = new Set(); const achados = [];
  for (const c of consultasDeCapa(w, marca)) {
    const m = await melhorDaConsulta(c, fetcher, usados).catch(() => null);
    if (m) { usados.add(m.x.titulo); achados.push({ ...m, c }); }
  }
  const produtos = achados.filter((a) => a.c.tipo === 'produto' && a.n >= notaMin).sort((a, b) => b.n - a.n);
  const marcaFoto = achados.filter((a) => a.c.tipo !== 'produto' && a.n >= notaMin).sort((a, b) => b.n - a.n)[0];
  const escolha = produtos.length ? produtos.slice(0, max) : marcaFoto ? [marcaFoto] : [];
  const out = [];
  for (const a of escolha) {
    const url = a.x.ii.thumburl || a.x.ii.url; if (!url) continue;
    try {
      const r = await fetcher(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const dados = Buffer.from(await r.arrayBuffer()); if (dados.length < 30000) continue;
      out.push({ dados, titulo: a.x.titulo, pagina: a.x.ii.descriptionurl || null, nome: a.c.chave, tipo: a.c.tipo, qualidade: a.qualidade, nota: Math.round(a.n) });
    } catch { /* tenta a próxima */ }
  }
  return out;
}

module.exports = { fotosDeCapa, consultasDeCapa, notaCapa, marcaNoWikidata, arquivoCommons, logoDe, fotoDe, fotosDaMarca, fotosDoConceito, buscar, licencaAceita, pontuar, pontuarLugar, pontuarMarca, pontuarConceito, LICENCA_OK, LICENCA_LIVRE };
