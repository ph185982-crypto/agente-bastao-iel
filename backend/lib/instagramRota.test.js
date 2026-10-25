// Rota "Meu Instagram" contra a Graph SIMULADA: só leitura, métrica ausente não vira zero.
// node --test backend/lib/instagramRota.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const A = require('./armazem');
const { ACCOUNT } = require('./account');
const { graphFalsa } = require('./graphFalsa');

const TOKEN = 'TOKEN_FALSO_DE_TESTE_123';
let graph; let srv; let base; let envAntes; let arm;
const agora = Date.now();
const h = (n) => new Date(agora - n * 3600000).toISOString();

test.before(async () => {
  envAntes = { ...process.env };
  graph = graphFalsa(TOKEN, ACCOUNT);
  await new Promise((r) => graph.srv.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { META_GRAPH_BASE: `http://127.0.0.1:${graph.srv.address().port}`, META_PAGE_ACCESS_TOKEN: TOKEN, META_IG_USER_ID: ACCOUNT.meta_ig_id, META_PAGE_ID: '123', PUBLISH_SECRET: 'segredo-de-teste-publicacao', PUBLIC_BASE_URL: 'https://app.teste' });
  delete process.env.VERCEL;
  for (const k of Object.keys(require.cache)) if (/backend[\\/](lib[\\/](meta|meuInstagram|publicador)|routes[\\/]instagram)\.js$/.test(k)) delete require.cache[k];
  arm = Object.assign(A.memoria(), { duravel: true });
  A._definir(arm);
  const app = express();
  app.use(express.json());
  app.use('/api/instagram', require('../routes/instagram'));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}/api/instagram`;
});
test.after(() => { graph.srv.close(); srv.close(); for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });

const atualizar = (quem) => fetch(`${base}/atualizar`, { method: 'POST', headers: { 'x-forwarded-for': quem } });
const midia = (id, tipo, horas) => ({ id, media_type: tipo === 'reel' ? 'VIDEO' : tipo === 'carrossel' ? 'CAROUSEL_ALBUM' : 'IMAGE', media_product_type: tipo === 'reel' ? 'REELS' : 'FEED', permalink: `https://www.instagram.com/p/${id}/`, timestamp: h(horas), caption: `Legenda ${id}` });

test('painel vazio: avisa que ainda não há leitura e não inventa número', async () => {
  const r = await (await fetch(`${base}/painel`)).json();
  assert.strictEqual(r.vazio, true);
  assert.strictEqual(r.analise, null);
  assert.strictEqual(r.configurado, true);
});

test('atualizar: lê posts reais da Graph simulada, guarda no servidor e só faz leituras (GET)', async () => {
  graph.est.midias = [midia('media_1', 'carrossel', 200), midia('media_2', 'reel', 300), midia('media_3', 'imagem', 5)];
  graph.est.insights = {
    media_1: { reach: 5000, saved: 20, shares: 100, total_interactions: 400, views: 9000, follows: 12, profile_visits: 30 },
    media_2: { reach: 8000, saved: 10, shares: 40, total_interactions: 200, views: 15000 },
    media_3: { reach: 300 },
  };
  graph.est.chamadas.length = 0;
  const resp = await atualizar('t-leitura');
  assert.strictEqual(resp.status, 200);
  const r = await resp.json();
  assert.strictEqual(r.snapshot.conta.seguidores, 166772);
  assert.strictEqual(r.posts.length, 3);
  const c = r.posts.find((p) => p.id === 'media_1');
  assert.strictEqual(c.compartilhamentos, 100);
  assert.strictEqual(r.analise.n_imaturos, 1, 'o post de 5 h não entra nas comparações');
  assert.strictEqual(r.analise.n_comparaveis, 2);
  const reel = r.posts.find((p) => p.id === 'media_2');
  assert.strictEqual(reel.seguidores_ganhos, null, 'Reel: a Meta não informa seguidor por post → null, não zero');
  assert.ok(r.analise.por_tipo.reel.amostra === 'pequena');
  // só leitura: nada de POST/DELETE na Meta
  assert.ok(graph.est.chamadas.every((x) => x.metodo === 'GET'), 'a rota só lê');
  assert.ok(graph.est.chamadas.every((x) => x.params.access_token === TOKEN));
  // guardado no servidor; o painel agora abre sem chamar a Meta
  graph.est.chamadas.length = 0;
  const p = await (await fetch(`${base}/painel`)).json();
  assert.strictEqual(p.vazio, false);
  assert.strictEqual(p.posts.length, 3);
  assert.strictEqual(graph.est.chamadas.length, 0, 'abrir o painel não gasta chamadas da Meta');
  assert.strictEqual(p.historico, true);
});

test('atualizar: posts publicados pela ferramenta são marcados pelo ID real do post', async () => {
  const c = require('../../static/contentModel').novoConteudo({ titulo: 'FIXTURE' });
  await arm.conteudos.salvar(ACCOUNT.ig_id, c.id, c, 0);
  await arm.publicacoes.iniciar(ACCOUNT.ig_id, c.id, 'instagram', { versao: 'v1', hash_versao: 'h' });
  await arm.publicacoes.atualizar(ACCOUNT.ig_id, c.id, 'instagram', ['iniciada'], 'publicada', { ig_media_id: 'media_1' });
  const r = await (await atualizar('t-origem')).json();
  assert.strictEqual(r.posts.find((p) => p.id === 'media_1').da_ferramenta, true);
  assert.strictEqual(r.posts.find((p) => p.id === 'media_1').content_id, c.id);
  assert.strictEqual(r.posts.find((p) => p.id === 'media_2').da_ferramenta, false);
});

test('sem permissão de métricas: mensagem clara, nada de zero', async () => {
  graph.est.insightsFalha = { message: '(#10) Application does not have permission', code: 10 };
  const r = await (await atualizar('t-permissao')).json();
  assert.ok(r.snapshot.avisos.some((a) => /instagram_manage_insights/.test(a)));
  assert.ok(r.posts.every((p) => p.alcance === null));
  graph.est.insightsFalha = null;
});

test('token revogado devolve 401 com mensagem em português; sem configuração devolve 409', async () => {
  graph.est.tokenInvalido = true;
  const r = await atualizar('t-token');
  assert.strictEqual(r.status, 401);
  assert.match((await r.json()).error, /Reconecte/);
  graph.est.tokenInvalido = false;
  const tok = process.env.META_PAGE_ACCESS_TOKEN; delete process.env.META_PAGE_ACCESS_TOKEN;
  const sem = await atualizar('t-semconfig');
  assert.strictEqual(sem.status, 409);
  assert.strictEqual((await sem.json()).code, 'META_NAO_CONFIGURADA');
  process.env.META_PAGE_ACCESS_TOKEN = tok;
});

test('limite de uso: a terceira atualização no mesmo minuto é recusada', async () => {
  const codigos = [];
  for (let i = 0; i < 4; i++) codigos.push((await atualizar('t-limite')).status);
  assert.ok(codigos.includes(429), `códigos: ${codigos}`);
});
