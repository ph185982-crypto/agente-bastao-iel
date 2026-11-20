// Reciclagem › "Em alta no Brasil": pontuação que favorece o recente, dedupe, fontes independentes (uma falha não
// derruba as outras), freio pela cota da Meta e rodízio de no máximo 12 contas, retenção de 72 h, rotas com acesso.
// node --test backend/lib/reciclagem/emAlta.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const arm = require('../armazem');
const EA = require('./emAlta');
const Coletar = require('./coletar');

const AGORA = Date.parse('2026-11-20T15:00:00Z');
const h = (n, base = AGORA) => new Date(base - n * 3600000).toISOString();
const novo = () => { const a = Object.assign(arm.memoria(), { duravel: true }); arm._definir(a); return a; };
const midia = (id, { horas = 2, curtidas = 10000, comentarios = 100, views = null, tipo = 'IMAGE', produto = 'FEED', base = AGORA } = {}) => ({ permalink: `https://www.instagram.com/p/${id}/`, timestamp: h(horas, base), like_count: curtidas, comments_count: comentarios, view_count: views, media_type: tipo, media_product_type: produto, caption: `Legenda ${id}`, media_url: `https://cdn.test/${id}.jpg` });

// Graph falsa: business_discovery por handle; "invalida" simula @ inexistente; "limite" simula a Meta freando.
function graphFalsa(porHandle) {
  const chamadas = [];
  const graph = async (metodo, caminho, params) => {
    const handle = /username\(([^)]+)\)/.exec(params.fields)[1]; chamadas.push(handle);
    if (handle === 'invalida') throw Object.assign(new Error('A Meta recusou.'), { meta: { tipo: 'outro', amigavel: 'A Meta recusou.', mensagem_original: 'Invalid user id' } });
    if (handle === 'limite') throw Object.assign(new Error('limite'), { meta: { tipo: 'limite', amigavel: 'A Meta limitou as chamadas.' } });
    const c = porHandle[handle] || { seguidores: 1000000, posts: [] };
    return { business_discovery: { username: handle, followers_count: c.seguidores, media: { data: c.posts } } };
  };
  return { graph, chamadas };
}
const RSS = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
<item><title>Final da Libertadores</title><ht:approx_traffic>500 mil+</ht:approx_traffic><pubDate>Fri, 20 Nov 2026 06:00:00 -0800</pubDate><ht:picture>https://img.test/a.jpg</ht:picture><ht:news_item><ht:news_item_title>Flamengo x Palmeiras</ht:news_item_title><ht:news_item_url>https://ge.test/n1</ht:news_item_url><ht:news_item_source>ge</ht:news_item_source></ht:news_item></item>
<item><title>BBB 27</title><ht:approx_traffic>20K+</ht:approx_traffic></item>
<item><title>Final da Libertadores</title><ht:approx_traffic>100+</ht:approx_traffic></item>
</channel></rss>`;
const fetcherRss = async () => ({ ok: true, text: async () => RSS });
const semRapid = { rapidKey: '' };

test('pontuação: o post recente com muito engajamento por hora ganha do antigo com mais curtidas no total', () => {
  const recente = EA.pontuar({ curtidas: 50000, comentarios: 1000, publicado_em: h(2) }, 10000000, AGORA);
  const antigo = EA.pontuar({ curtidas: 200000, comentarios: 1000, publicado_em: h(40) }, 10000000, AGORA);
  assert.ok(recente.score > antigo.score, `${recente.score} > ${antigo.score}`);
  assert.strictEqual(recente.engajamento, 53000); assert.strictEqual(recente.por_hora, 26500);
  // Meio-termo de tamanho: página 4× maior com o mesmo engajamento pontua a metade (raiz de 4), não um quarto.
  const peq = EA.pontuar({ curtidas: 1000, comentarios: 0, publicado_em: h(1) }, 1000000, AGORA);
  const grande = EA.pontuar({ curtidas: 1000, comentarios: 0, publicado_em: h(1) }, 4000000, AGORA);
  assert.strictEqual(grande.score * 2, peq.score);
  // Curtidas ocultas: 5% das views entram no lugar; sem nenhuma métrica não pontua.
  assert.strictEqual(EA.engajamento({ curtidas: null, comentarios: 10, visualizacoes: 100000 }), 5030);
  assert.strictEqual(EA.pontuar({ publicado_em: h(1) }, 1e6, AGORA), null);
  assert.strictEqual(EA.trafego('200.000+'), 200000); assert.strictEqual(EA.trafego('2 mil+'), 2000); assert.strictEqual(EA.trafego('1,5 mi+'), 1500000); assert.strictEqual(EA.trafego('20K+'), 20000); assert.strictEqual(EA.trafego('1M+'), 1000000); assert.strictEqual(EA.trafego(''), null);
});

test('Instagram: só posts das últimas 48 h entram; mesmo permalink em duas páginas vira um item só', async () => {
  const colab = midia('colab', { horas: 3, curtidas: 90000 });
  const g = graphFalsa({ choquei: { seguidores: 30000000, posts: [midia('c1', { horas: 1 }), midia('c2', { horas: 60 }), colab] }, gshow: { seguidores: 20000000, posts: [colab, midia('g1', { horas: 5, tipo: 'CAROUSEL_ALBUM' })] } });
  const r = await EA.coletarInstagram({ contas: [{ handle: 'choquei', cat: 'entretenimento' }, { handle: 'gshow', cat: 'entretenimento' }], graph: g.graph, igId: '178', agora: AGORA });
  assert.strictEqual(r.itens.length, 4, 'c2 (60 h) fica de fora');
  assert.ok(!r.itens.some((i) => i.permalink.includes('c2')));
  novo();
  const gu = await EA.guardar(r.itens, { agora: AGORA });
  assert.strictEqual(gu.novos, 3, 'o post em colaboração entra uma vez');
  const l = await EA.listar({ agora: AGORA });
  assert.strictEqual(l.total, 3);
  assert.strictEqual(l.itens[0].score, 100, 'o maior da fonte vira 100');
  assert.ok(l.itens.every((i, k) => k === 0 || i.score <= l.itens[k - 1].score), 'ordenado por score');
  const it = l.itens.find((i) => i.permalink.includes('g1'));
  assert.strictEqual(it.tipo, 'carrossel'); assert.strictEqual(it.fonte, 'instagram'); assert.strictEqual(it.conta.handle, 'gshow');
  assert.ok(it.metricas.curtidas && it.metricas.engajamento && it.publicado_em && it.coletado_em && it.thumbnail, 'item com métricas, datas e miniatura');
});

test('Google Trends: tráfego, notícia e miniatura; título repetido entra uma vez', () => {
  const t = EA.parseTrends(RSS, { agora: AGORA });
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual([t[0].titulo, t[0].metricas.buscas, t[0].thumbnail, t[0].permalink, t[0].noticias[0].fonte], ['Final da Libertadores', 500000, 'https://img.test/a.jpg', 'https://ge.test/n1', 'ge']);
  assert.match(t[1].permalink, /google\.com\/search\?q=BBB%2027/);
  assert.strictEqual(t[1].score, 20000);
});

test('uma fonte falhando não derruba as outras (Meta fora do ar, RSS fora do ar, RapidAPI recusando)', async () => {
  novo();
  const graphQuebrada = async () => { throw new Error('rede caiu'); };
  const r1 = await EA.coletar({ deps: { graph: graphQuebrada, igId: '1', uso: () => ({}), estadoReciclagem: {}, contas: [{ handle: 'a' }], fetcher: fetcherRss, ...semRapid }, agora: AGORA });
  assert.strictEqual(r1.fontes.instagram.ok, false); assert.strictEqual(r1.fontes.google_trends.ok, true); assert.strictEqual(r1.novos, 2);
  novo();
  const g = graphFalsa({ a: { seguidores: 1e6, posts: [midia('x1')] } });
  const r2 = await EA.coletar({ deps: { graph: g.graph, igId: '1', uso: () => ({}), estadoReciclagem: {}, contas: [{ handle: 'a' }], fetcher: async () => { throw new Error('timeout'); }, rapidKey: 'K', fetcherRapid: async () => ({ ok: false, status: 403 }) }, agora: AGORA });
  assert.strictEqual(r2.fontes.instagram.ok, true); assert.strictEqual(r2.fontes.google_trends.ok, false); assert.strictEqual(r2.fontes.instagram_hashtag.ok, false);
  assert.strictEqual(r2.novos, 1);
  const est = await EA.lerEstado();
  assert.ok(Date.parse(est.rapidapi_bloqueio_ate) > AGORA, 'RapidAPI recusou (403): fica 24 h fora');
  const r3 = await EA.coletar({ deps: { graph: g.graph, igId: '1', uso: () => ({}), estadoReciclagem: {}, contas: [{ handle: 'a' }], fetcher: fetcherRss, rapidKey: 'K', fetcherRapid: async () => { throw new Error('não devia chamar'); } }, origem: 'cron', agora: AGORA + 3600000 });
  assert.match(r3.fontes.instagram_hashtag.pulado, /recusou antes/);
});

test('RapidAPI explore_tag: top da hashtag vira item (só recente), com dono e link do post', async () => {
  novo();
  const nodes = [{ media: { code: 'ABC', taken_at: Math.floor((AGORA - 3 * 3600000) / 1000), like_count: 40000, comment_count: 500, media_type: 8, user: { username: 'perfil' }, caption: { text: 'meme do dia' }, image_versions2: { candidates: [{ url: 'https://cdn.test/abc.jpg' }] } } }, { media: { code: 'OLD', taken_at: Math.floor((AGORA - 80 * 3600000) / 1000), like_count: 1, comment_count: 0, media_type: 1 } }];
  const urls = [];
  const r = await EA.coletar({ deps: { meta: { faltando: () => ['META_PAGE_ACCESS_TOKEN'], uso: () => ({}) }, estadoReciclagem: {}, fetcher: fetcherRss, rapidKey: 'K', fetcherRapid: async (u, o) => { urls.push(u); assert.strictEqual(o.headers['x-rapidapi-key'], 'K'); return { ok: true, json: async () => ({ result: { sections: [{ layout_content: { medias: nodes } }] } }) }; } }, agora: AGORA });
  assert.strictEqual(urls.length, 1, 'uma hashtag por rodada'); assert.match(urls[0], /explore_tag\?hashtag=brasil/);
  assert.strictEqual(r.fontes.instagram_hashtag.itens, 1);
  assert.match(r.fontes.instagram.pulado, /não configurado/);
  const l = await EA.listar({ fonte: 'instagram_hashtag', agora: AGORA });
  assert.strictEqual(l.itens[0].permalink, 'https://www.instagram.com/p/ABC/'); assert.strictEqual(l.itens[0].conta.handle, 'perfil'); assert.strictEqual(l.itens[0].tipo, 'carrossel');
});

test('freio da Meta: no máximo 12 contas por rodada em rodízio; 4 com cota ≥ 50%; nenhuma com ≥ 75% ou pausa da Reciclagem', async () => {
  const contas = Array.from({ length: 30 }, (_, i) => ({ handle: `pagina${i}` }));
  const base = { igId: '1', estadoReciclagem: {}, contas, fetcher: fetcherRss, ...semRapid };
  novo();
  let g = graphFalsa({});
  await EA.coletar({ deps: { ...base, graph: g.graph, uso: () => ({ pct: 10 }) }, origem: 'cron', agora: AGORA });
  assert.strictEqual(g.chamadas.length, 12);
  const primeira = [...g.chamadas];
  g = graphFalsa({});
  await EA.coletar({ deps: { ...base, graph: g.graph, uso: () => ({ pct: 10 }) }, origem: 'cron', agora: AGORA + 3 * 3600000 });
  assert.strictEqual(g.chamadas.length, 12);
  assert.ok(!g.chamadas.some((x) => primeira.includes(x)), 'rodízio: a segunda rodada lê as que ainda não foram lidas');
  g = graphFalsa({});
  const r = await EA.coletar({ deps: { ...base, graph: g.graph, uso: () => ({ pct: 55 }) }, origem: 'cron', agora: AGORA + 6 * 3600000 });
  assert.strictEqual(g.chamadas.length, 4); assert.strictEqual(r.fontes.instagram.max_por_rodada, 4);
  g = graphFalsa({});
  const alta = await EA.coletar({ deps: { ...base, graph: g.graph, uso: () => ({ pct: 80 }) }, origem: 'cron', agora: AGORA + 9 * 3600000 });
  assert.strictEqual(g.chamadas.length, 0); assert.match(alta.fontes.instagram.pulado, /80%/); assert.strictEqual(alta.fontes.google_trends.ok, true, 'Trends segue mesmo com a Meta freada');
  g = graphFalsa({});
  await EA.coletar({ deps: { ...base, graph: g.graph, uso: () => ({ pct: 5 }), estadoReciclagem: { leve_pausa_ate: new Date(AGORA + 13 * 3600000).toISOString() } }, origem: 'cron', agora: AGORA + 12 * 3600000 });
  assert.strictEqual(g.chamadas.length, 0, 'a Reciclagem principal está em pausa por limite: esta espera também');
});

test('limite da Meta para a rodada e pausa as próximas; @ inválido sai do rodízio por 7 dias', async () => {
  novo();
  const g = graphFalsa({});
  const base = { igId: '1', estadoReciclagem: {}, fetcher: fetcherRss, ...semRapid, uso: () => ({ pct: 0 }) };
  const r = await EA.coletar({ deps: { ...base, graph: g.graph, contas: [{ handle: 'invalida' }, { handle: 'ok1' }] }, origem: 'cron', agora: AGORA });
  assert.strictEqual(r.fontes.instagram.contas_lidas, 1);
  const est = await EA.lerEstado(); assert.ok(est.recusadas.invalida);
  const g2 = graphFalsa({});
  await EA.coletar({ deps: { ...base, graph: g2.graph, contas: [{ handle: 'invalida' }, { handle: 'ok1' }] }, origem: 'cron', agora: AGORA + 3600000 });
  assert.deepStrictEqual(g2.chamadas, ['ok1'], 'a recusada não é chamada de novo');
  novo();
  const g3 = graphFalsa({});
  const r3 = await EA.coletar({ deps: { ...base, graph: g3.graph, contas: [{ handle: 'limite' }, { handle: 'b' }, { handle: 'c' }, { handle: 'd' }, { handle: 'e' }, { handle: 'f' }] }, origem: 'cron', agora: AGORA });
  assert.ok(g3.chamadas.length < 6 && r3.fontes.instagram.parcial, 'para a rodada na primeira recusa por limite');
  const g4 = graphFalsa({});
  const r4 = await EA.coletar({ deps: { ...base, graph: g4.graph, contas: [{ handle: 'b' }] }, origem: 'cron', agora: AGORA + 10 * 60000 });
  assert.strictEqual(g4.chamadas.length, 0); assert.match(r4.fontes.instagram.pulado, /pausa/);
});

test('"Atualizar agora" seguido não gasta cota de novo; coleta em andamento não roda em paralelo', async () => {
  novo();
  const g = graphFalsa({});
  const deps = { graph: g.graph, igId: '1', uso: () => ({}), estadoReciclagem: {}, contas: [{ handle: 'a' }], fetcher: fetcherRss, ...semRapid };
  await EA.coletar({ deps, agora: AGORA });
  const r = await EA.coletar({ deps, agora: AGORA + 60000 });
  assert.strictEqual(r.recente, true); assert.strictEqual(g.chamadas.length, 1);
  const arm2 = require('../armazem').armazem();
  await arm2.radar.salvar(require('../account').ACCOUNT.ig_id, EA.TIPO_ESTADO, 'estado', { ...(await EA.lerEstado()), coletando_ate: new Date(AGORA + 10 * 60000 + 30000).toISOString() });
  const r2 = await EA.coletar({ deps, origem: 'cron', agora: AGORA + 10 * 60000 });
  assert.strictEqual(r2.ocupado, true);
});

test('retenção de 72 h: post velho e busca coletada há mais de 72 h saem do armazém', async () => {
  novo();
  const velho = { id: EA.idDe('instagram', 'velho'), fonte: 'instagram', tipo: 'imagem', permalink: 'https://www.instagram.com/p/velho/', publicado_em: h(80), coletado_em: h(70), score: 9, metricas: {} };
  const buscaVelha = { id: EA.idDe('google_trends', 'x'), fonte: 'google_trends', tipo: 'busca', titulo: 'x', permalink: 'https://x.test', publicado_em: h(10), coletado_em: h(73), score: 1, metricas: {} };
  const novoItem = { id: EA.idDe('instagram', 'novo'), fonte: 'instagram', tipo: 'imagem', permalink: 'https://www.instagram.com/p/novo/', publicado_em: h(5), coletado_em: h(0), score: 1, metricas: {} };
  await EA.guardar([velho, buscaVelha], { agora: AGORA - 20 * 3600000 });
  assert.strictEqual((await EA.listar({ agora: AGORA - 20 * 3600000 })).total, 2);
  const g = await EA.guardar([novoItem], { agora: AGORA });
  assert.strictEqual(g.removidos, 2);
  const l = await EA.listar({ agora: AGORA });
  assert.deepStrictEqual(l.itens.map((i) => i.permalink), ['https://www.instagram.com/p/novo/']);
});

test('levar para a Reciclagem: carrossel do Instagram vira item rc_… pronto para o "Reciclar"; reel e busca não', async () => {
  novo();
  const r = await EA.coletarInstagram({ contas: [{ handle: 'choquei', nome: 'Choquei' }], graph: graphFalsa({ choquei: { seguidores: 3e7, posts: [{ ...midia('car', { tipo: 'CAROUSEL_ALBUM' }), children: { data: [{ media_type: 'IMAGE', media_url: 'https://cdn.test/s1.jpg' }, { media_type: 'IMAGE', media_url: 'https://cdn.test/s2.jpg' }] } }, midia('reel', { tipo: 'VIDEO', produto: 'REELS', views: 1e6 })] } }).graph, igId: '1', agora: AGORA });
  await EA.guardar([...r.itens, ...EA.parseTrends(RSS, { agora: AGORA })], { agora: AGORA });
  const l = (await EA.listar({ agora: AGORA })).itens;
  const car = l.find((i) => i.tipo === 'carrossel');
  const lev = await EA.levarParaReciclagem(car.id, { agora: AGORA });
  assert.strictEqual(lev.id, Coletar.idDe(car.permalink));
  const doc = await Coletar.obter(lev.id);
  assert.deepStrictEqual([doc.rede, doc.tipo, doc.conta.handle, doc.origem, doc.midias.length], ['instagram', 'carrossel', 'choquei', 'em_alta', 2]);
  assert.ok((await EA.obter(car.id)).levado.id === lev.id);
  await assert.rejects(EA.levarParaReciclagem(l.find((i) => i.tipo === 'reel').id), /carrossel/);
  await assert.rejects(EA.levarParaReciclagem(l.find((i) => i.fonte === 'google_trends').id), /Instagram/);
});

test('contas: lista curada (25+) editável; handle inválido é recusado', async () => {
  novo();
  assert.ok(EA.CONTAS.length >= 25 && EA.CONTAS.every((c) => /^[a-z0-9._]+$/.test(c.handle) && EA.CATEGORIAS.includes(c.cat)));
  assert.strictEqual(new Set(EA.CONTAS.map((c) => c.handle)).size, EA.CONTAS.length);
  const c = await EA.salvarConfig({ adicionar: [{ handle: '@NovaPagina', nome: 'Nova', cat: 'humor' }], remover: ['choquei'] });
  assert.ok(c.contas.some((x) => x.handle === 'novapagina' && x.adicionada)); assert.ok(!c.contas.some((x) => x.handle === 'choquei'));
  await assert.rejects(EA.salvarConfig({ adicionar: [{ handle: 'com espaço' }] }), /inválido/);
});

test('rotas: lista com filtro de fonte, coleta com dependências falsas, levar e id inválido', async () => {
  novo(); process.env.TESTE_RECICLAGEM = '1'; delete process.env.VERCEL;
  const agora = Date.now();
  const g = graphFalsa({ a: { seguidores: 1e6, posts: [midia('r1', { base: agora, tipo: 'CAROUSEL_ALBUM' })] } });
  global.__RECICLAGEM_DEPS__ = { emAlta: { graph: g.graph, igId: '1', uso: () => ({}), estadoReciclagem: {}, contas: [{ handle: 'a' }], fetcher: fetcherRss, ...semRapid } };
  const app = express(); app.use(express.json()); app.use('/api/reciclagem', require('../../routes/reciclagem'));
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api/reciclagem`;
  try {
    const c = await (await fetch(`${base}/em-alta/coletar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    assert.strictEqual(c.ok, true); assert.strictEqual(c.fontes.instagram.contas_lidas, 1);
    const todos = await (await fetch(`${base}/em-alta`)).json();
    assert.ok(todos.total >= 2); assert.strictEqual(todos.estado.agenda.cron_utc, '17 */3 * * *');
    const ig = await (await fetch(`${base}/em-alta?fonte=instagram`)).json();
    assert.ok(ig.itens.length === 1 && ig.itens[0].fonte === 'instagram');
    const lev = await fetch(`${base}/em-alta/${ig.itens[0].id}/levar`, { method: 'POST' });
    assert.strictEqual(lev.status, 201); assert.match((await lev.json()).id, /^rc_[a-f0-9]{16}$/);
    assert.strictEqual((await fetch(`${base}/em-alta/xyz/levar`, { method: 'POST' })).status, 400);
    assert.strictEqual((await fetch(`${base}/em-alta/contas`)).status, 200);
  } finally { srv.close(); delete global.__RECICLAGEM_DEPS__; delete process.env.TESTE_RECICLAGEM; }
});

test('acesso: rotas do "Em alta" pedem login; o cron passa só com o CRON_SECRET e só na rota de coleta', async () => {
  const antes = { ...process.env };
  try {
    Object.assign(process.env, { VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-em-alta', CRON_SECRET: 'segredo-cron-em-alta' }); delete process.env.APP_ACCESS_MODE;
    const access = require('../access');
    const passa = (url, auth) => new Promise((ok) => {
      const res = { status: (s) => ({ json: () => ok(s) }) };
      const r = access.exigeAcesso({ originalUrl: url, headers: auth ? { authorization: auth } : {} }, res, () => ok('passou'));
      if (r && typeof r.then === 'function') r.catch(() => ok('erro'));
    });
    assert.strictEqual(await passa('/api/reciclagem/em-alta'), 401);
    assert.strictEqual(await passa('/api/reciclagem/em-alta/coletar'), 401);
    assert.strictEqual(await passa('/api/reciclagem/em-alta/coletar', 'Bearer segredo-cron-em-alta'), 'passou');
    assert.strictEqual(await passa('/api/reciclagem/em-alta', 'Bearer segredo-cron-em-alta'), 401, 'CRON_SECRET não abre a lista');
    assert.strictEqual(await passa('/api/reciclagem/em-alta/contas', 'Bearer segredo-cron-em-alta'), 401);
  } finally { for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k]; Object.assign(process.env, antes); }
});

test('em alta: no máximo 4 posts por página no ranking de uma rodada', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'emAlta.js'), 'utf8');
  assert.match(src, /MAX_POR_CONTA = 4/);
});
