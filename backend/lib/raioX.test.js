// Raio-X do perfil: leitura completa da Meta, sempre cifrada (o repositório e o log do Actions são públicos).
// node --test backend/lib/raioX.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const RX = require('./raioX');
const arm = require('./armazem');
const { invokeRoute } = require('./invokeRoute');

const par = () => { const k = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); return { pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };

test('cifra com a chave pública e só a privada abre; chave fraca ou inválida é recusada', () => {
  const k = par(); const dado = { posts: [{ id: '1', legenda: 'Olá, ação e coração', alcance: 1234 }] };
  const c = RX.cifrar(dado, k.pub);
  assert.ok(!c.includes('1234') && !c.includes('Olá'));
  assert.deepStrictEqual(RX.decifrar(c, k.priv), dado);
  assert.throws(() => RX.decifrar(c, par().priv));
  assert.throws(() => RX.cifrar(dado, 'abc'), /inválida/);
  const fraca = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.throws(() => RX.cifrar(dado, fraca), /2048/);
});

test('posts: lê a página, cai para métricas básicas quando a Meta recusa a lista completa e devolve o cursor', async () => {
  const chamadas = [];
  const grafo = async (m, caminho, p) => {
    chamadas.push([caminho, p.metric || p.fields]);
    if (caminho.endsWith('/media')) return { data: [{ id: 'a', media_type: 'CAROUSEL_ALBUM', timestamp: new Date().toISOString(), caption: 'Capa forte', like_count: 10, comments_count: 2, children: { data: [{ id: 'x' }, { id: 'y' }] } }, { id: 'b', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: new Date().toISOString(), thumbnail_url: 'https://cdn/t.jpg' }], paging: { next: 'https://x', cursors: { after: 'CUR' } } };
    if (caminho === 'a/insights' && p.metric.includes('likes')) throw Object.assign(new Error('x'), { meta: { tipo: 'outro', mensagem_original: '(#100) metric not supported' } });
    if (caminho === 'a/insights') return { data: [{ name: 'reach', values: [{ value: 500 }] }, { name: 'follows', values: [{ value: 3 }] }] };
    return { data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'ig_reels_avg_watch_time', values: [{ value: 7000 }] }] };
  };
  const r = await RX.posts({ grafo, igId: 'IG', fichasPorMidia: new Map([['a', { tipo: 'frase' }]]) });
  assert.strictEqual(r.proximo, 'CUR'); assert.strictEqual(r.fim, false);
  const [a, b] = r.posts;
  assert.strictEqual(a.alcance, 500); assert.strictEqual(a.seguidores, 3); assert.strictEqual(a.slides, 2); assert.strictEqual(a.ficha.tipo, 'frase'); assert.strictEqual(a.curtidas, 10);
  assert.strictEqual(b.tipo, 'reel'); assert.strictEqual(b.tempo_medio_ms, 7000); assert.strictEqual(b.capa, 'https://cdn/t.jpg');
});

test('posts: limite da Meta para de chamar e marca limite_atingido', async () => {
  let n = 0;
  const grafo = async (m, caminho) => { if (caminho.endsWith('/media')) return { data: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, media_type: 'IMAGE', timestamp: new Date().toISOString() })) }; n++; throw Object.assign(new Error('x'), { meta: { tipo: 'limite', mensagem_original: '(#4) Application request limit reached' } }); };
  const r = await RX.posts({ grafo, igId: 'IG', fichasPorMidia: new Map() });
  assert.strictEqual(r.limite_atingido, true); assert.ok(n <= 6, `chamadas: ${n}`); assert.strictEqual(r.fim, true);
});

test('conta: janelas com seguidores × não seguidores e quem seguiu × quem saiu; erro de uma métrica não derruba o resto', async () => {
  const grafo = async (m, caminho, p) => {
    if (!caminho.includes('/')) return { username: 'pedro_destrava', followers_count: 165000, media_count: 900 };
    if (p.metric === 'reach,follower_count') return { data: [{ name: 'follower_count', values: [{ end_time: '2026-11-20T08:00:00+0000', value: 12 }] }] };
    if (p.metric === 'reach' && p.breakdown === 'follow_type') return { data: [{ name: 'reach', total_value: { value: 1000, breakdowns: [{ dimension_keys: ['follow_type'], results: [{ dimension_values: ['FOLLOWER'], value: 900 }, { dimension_values: ['NON_FOLLOWER'], value: 100 }] }] } }] };
    if (p.metric === 'follows_and_unfollows') return { data: [{ name: 'follows_and_unfollows', total_value: { breakdowns: [{ dimension_keys: ['follow_type'], results: [{ dimension_values: ['FOLLOWER'], value: 40 }, { dimension_values: ['NON_FOLLOWER'], value: 70 }] }] } }] };
    if (p.metric === 'follower_demographics' && p.breakdown === 'age') return { data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: ['age'], results: [{ dimension_values: ['25-34'], value: 50000 }] }] } }] };
    throw Object.assign(new Error('x'), { meta: { tipo: 'outro', mensagem_original: '(#100) nope' } });
  };
  const c = await RX.conta({ grafo, igId: 'IG', janelas: 1 });
  assert.strictEqual(c.perfil.followers_count, 165000);
  assert.deepStrictEqual(c.janelas[0].m.reach.cortes[0].itens, [{ valor: 'FOLLOWER', n: 900 }, { valor: 'NON_FOLLOWER', n: 100 }]);
  assert.deepStrictEqual(c.janelas[0].m.follows_and_unfollows.cortes[0].itens.map((x) => x.n), [40, 70]);
  assert.strictEqual(c.demografia.follower_demographics.age[0].valor, '25-34');
  assert.ok(c.erros.length > 0); assert.ok(c.janelas[0].m.views_erro);
});

test('tipo do conteúdo: cada linha da ferramenta tem o seu nome', () => {
  assert.strictEqual(RX.tipoDoConteudo({ frase: { texto: 'x' } }), 'frase');
  assert.strictEqual(RX.tipoDoConteudo({ top: { formato: 'marca', entrada: {} } }), 'por_tras_da_marca');
  assert.strictEqual(RX.tipoDoConteudo({ top: { formato: 'marca', entrada: { estilo: 'revelacao' } } }), 'quem_e_ele');
  assert.strictEqual(RX.tipoDoConteudo({ top: { formato: 'ensaio', entrada: {} } }), 'noticia_ensaio');
  assert.strictEqual(RX.tipoDoConteudo({ video: {} }), 'video_editado');
  assert.strictEqual(RX.tipoDoConteudo(null), null);
});

test('rota: sem chave pública recusa (nada sai em texto aberto); OIDC do raio-x.yml está liberado só para esta rota e as do worker', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const Rt = require('../routes/crescimento');
  await assert.rejects(invokeRoute(Rt, 'GET', '/raio-x?parte=conta'), (e) => e.status === 400);
  const fs = require('fs');
  assert.match(fs.readFileSync(require.resolve('./access.js'), 'utf8'), /ROTAS_OIDC = \[.*crescimento\\\/raio-x\$\//);
  assert.match(fs.readFileSync(require.resolve('./githubOidc.js'), 'utf8'), /'raio-x\.yml'/);
});
