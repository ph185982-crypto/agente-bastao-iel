// Proteção no SERVIDOR para todas as rotas montadas em backend/server.js.
// node --test backend/lib/acesso.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Lê os prefixos direto do server.js: rota nova entra no teste sozinha.
const fonte = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const PREFIXOS = [...fonte.matchAll(/app\.use\('(\/api\/[a-z-]+)'/g)].map((m) => m[1]).filter((p) => p !== '/api/auth');
const AMOSTRAS = PREFIXOS.flatMap((p) => [['GET', `${p}/`], ['POST', `${p}/qualquer`]]).concat([['POST', '/api/content/copy'], ['POST', '/api/content/render-slide'], ['POST', '/api/content/ingest'], ['GET', '/api/nao-existe']]);

let base; let srv; const envAntes = { ...process.env };
async function sobe(env) {
  for (const k of ['APP_ACCESS_CODE', 'VERCEL', 'NODE_ENV', 'CRON_SECRET']) delete process.env[k];
  Object.assign(process.env, { PORT: '0' }, env);
  if (srv) await new Promise((r) => srv.close(r));
  Object.keys(require.cache).filter((k) => k.includes(`${path.sep}backend${path.sep}`)).forEach((k) => { delete require.cache[k]; });
  const app = require('../server');
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}`;
}
const chama = async (metodo, url, headers = {}) => {
  const r = await fetch(base + url, { method: metodo, headers: { 'content-type': 'application/json', ...headers }, body: metodo === 'POST' ? '{}' : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
test.after(async () => { setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); if (srv) await new Promise((r) => srv.close(r)); for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); });

test(`encontrou as rotas montadas (${PREFIXOS.length})`, () => { assert.ok(PREFIXOS.includes('/api/content') && PREFIXOS.includes('/api/queue') && PREFIXOS.length >= 15); });

test('publicado SEM código: toda rota privada responde 503 "configuração necessária"', async () => {
  await sobe({ VERCEL: '1' });
  for (const [m, u] of AMOSTRAS) {
    const r = await chama(m, u);
    assert.strictEqual(r.status, 503, `${m} ${u} → ${r.status}`);
    assert.strictEqual(r.json.code, 'ACCESS_NOT_CONFIGURED');
  }
  const st = await chama('GET', '/api/auth/status');
  assert.strictEqual(st.json.configured, false);
  assert.strictEqual((await chama('POST', '/api/auth/login')).status, 503);
  assert.strictEqual((await chama('GET', '/api/health')).status, 200);
});

test('publicado com código CURTO conta como não configurado', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: '1234' });
  assert.strictEqual((await chama('POST', '/api/content/copy')).status, 503);
});

test('publicado com código: sem token, token falso ou token de outro código → 401 em todas', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-antigo-de-teste' });
  const access = require('./access');
  const tokenAntigo = access.sign({ sub: 'pedro', exp: Math.floor(Date.now() / 1000) + 60 });
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-novo-de-teste-1' });
  for (const [m, u] of AMOSTRAS) {
    assert.strictEqual((await chama(m, u)).status, 401, `${m} ${u} sem token`);
    assert.strictEqual((await chama(m, u, { authorization: 'Bearer abc.def' })).status, 401, `${m} ${u} token falso`);
    assert.strictEqual((await chama(m, u, { authorization: `Bearer ${tokenAntigo}` })).status, 401, `${m} ${u} token de código antigo`);
  }
  const errado = await chama('POST', '/api/auth/login', {});
  assert.strictEqual(errado.status, 401);
});

test('publicado com código: token válido passa; agendamento só com CRON_SECRET', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-novo-de-teste-1', CRON_SECRET: 'segredo-cron-teste' });
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'codigo-novo-de-teste-1' }) });
  const { token } = await r.json();
  const ok = await chama('POST', '/api/content/render-slide', { authorization: `Bearer ${token}` });
  assert.notStrictEqual(ok.status, 401);
  assert.notStrictEqual(ok.status, 503);
  assert.strictEqual((await chama('GET', '/api/trending/mine')).status, 401);
  assert.strictEqual((await chama('GET', '/api/content/discover', { authorization: 'Bearer segredo-cron-teste' })).status, 401, 'CRON_SECRET não abre rotas que não são agendadas');
  // Não chama a rota agendada de verdade (ela consome APIs): confere só o porteiro.
  const access = require('./access');
  let passou = false;
  access.exigeAcesso({ originalUrl: '/api/trending/mine', headers: { authorization: 'Bearer segredo-cron-teste' } }, { status: () => ({ json: () => {} }) }, () => { passou = true; });
  assert.ok(passou);
});

test('computador local (sem VERCEL) e sem código: aberto para desenvolvimento', async () => {
  await sobe({});
  const st = await chama('GET', '/api/auth/status');
  assert.strictEqual(st.json.estado, 'aberto_local');
});

test('publicação: só a mídia assinada é pública; o resto de /api/publish exige acesso e o cron exige CRON_SECRET', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-novo-de-teste-1', CRON_SECRET: 'segredo-cron-teste', PUBLISH_SECRET: 'segredo-publicacao-teste' });
  // mídia: sem token válido a própria rota recusa (403), mas o porteiro do código não bloqueia (a Meta não tem o código)
  const m = await chama('GET', '/api/publico/midia/abc.def.jpg');
  assert.strictEqual(m.status, 403);
  assert.strictEqual((await chama('GET', '/api/publico/outra-coisa')).status, 401);
  for (const [met, u] of [['GET', '/api/publish/instagram/health'], ['POST', '/api/publish/instagram/c1'], ['GET', '/api/publish/instagram/c1/status'], ['PUT', '/api/publish/config'], ['GET', '/api/publish/status'], ['GET', '/api/publish/cron']]) {
    assert.strictEqual((await chama(met, u)).status, 401, `${met} ${u}`);
  }
  // cron com o segredo passa pelo porteiro (a rota responde 503 por falta de banco, não 401)
  const cron = await fetch(`${base}/api/publish/cron`, { headers: { authorization: 'Bearer segredo-cron-teste' } });
  assert.notStrictEqual(cron.status, 401);
  assert.strictEqual((await chama('GET', '/api/publish/instagram/health', { authorization: 'Bearer segredo-cron-teste' })).status, 401, 'CRON_SECRET não abre as outras rotas');
  // sem código no servidor: tudo (menos a mídia assinada) fecha com 503
  await sobe({ VERCEL: '1' });
  assert.strictEqual((await chama('POST', '/api/publish/instagram/c1')).status, 503);
});
