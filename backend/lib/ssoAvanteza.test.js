// Login único "Avanteza ID": verificador do JWT da Central e a rota /api/sso/callback.
// node --test backend/lib/ssoAvanteza.test.js
// Nada aqui usa rede externa: o par de chaves P-256 é gerado no teste e a chave pública é passada ao verificador (`keys`).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('path');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'teste-1';
const KEYS = [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig' }];
const outra = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const agora = () => Math.floor(Date.now() / 1000);
function assinar(claims = {}, { chave = privateKey, header = {} } = {}) {
  const corpo = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID, ...header })}.${b64({ iss: 'avanteza-id', aud: 'conteudo', sub: 'Pedro@Avanteza.com.br', name: 'Pedro', role: 'admin', ret: '/', iat: agora(), exp: agora() + 60, jti: crypto.randomUUID(), ...claims })}`;
  const assinatura = crypto.sign('sha256', Buffer.from(corpo), { key: chave, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${corpo}.${assinatura}`;
}

const { verifyAvantezaToken, authorizeUrl } = require('./avantezaSso');

test('verificador: token válido devolve e-mail (minúsculo), nome, papel e caminho de volta', async () => {
  const u = await verifyAvantezaToken(assinar({ ret: '/?tab=central' }), { audience: 'conteudo', keys: KEYS });
  assert.deepStrictEqual({ email: u.email, name: u.name, role: u.role, returnTo: u.returnTo }, { email: 'pedro@avanteza.com.br', name: 'Pedro', role: 'admin', returnTo: '/?tab=central' });
});

test('verificador: audience de outro aplicativo é recusada', async () => {
  await assert.rejects(verifyAvantezaToken(assinar({ aud: 'crm' }), { audience: 'conteudo', keys: KEYS }), /outro aplicativo/);
});

test('verificador: token expirado é recusado', async () => {
  await assert.rejects(verifyAvantezaToken(assinar({ iat: agora() - 300, exp: agora() - 120 }), { audience: 'conteudo', keys: KEYS }), /expirado/);
});

test('verificador: token adulterado (conteúdo trocado, assinatura de outra chave, alg "none", emissor errado) é recusado', async () => {
  const [h, , a] = assinar().split('.');
  const trocado = `${h}.${b64({ iss: 'avanteza-id', aud: 'conteudo', sub: 'intruso@exemplo.com', exp: agora() + 60 })}.${a}`;
  await assert.rejects(verifyAvantezaToken(trocado, { audience: 'conteudo', keys: KEYS }), /assinatura inválida/);
  await assert.rejects(verifyAvantezaToken(assinar({}, { chave: outra.privateKey }), { audience: 'conteudo', keys: KEYS }), /assinatura inválida/);
  await assert.rejects(verifyAvantezaToken(assinar({}, { header: { alg: 'none' } }), { audience: 'conteudo', keys: KEYS }), /algoritmo/);
  await assert.rejects(verifyAvantezaToken(assinar({}, { header: { kid: 'desconhecida' } }), { audience: 'conteudo', keys: KEYS }), /chave desconhecida/);
  await assert.rejects(verifyAvantezaToken(assinar({ iss: 'outro-emissor' }), { audience: 'conteudo', keys: KEYS }), /emissor/);
  await assert.rejects(verifyAvantezaToken('abc', { audience: 'conteudo', keys: KEYS }), /malformado/);
});

test('verificador: caminho de volta externo vira "/" e a URL da Central leva app e return', async () => {
  for (const ret of ['//evil.example', 'https://evil.example', undefined]) {
    assert.strictEqual((await verifyAvantezaToken(assinar({ ret }), { audience: 'conteudo', keys: KEYS })).returnTo, '/');
  }
  const u = new URL(authorizeUrl('conteudo', '/?tab=central'));
  assert.strictEqual(u.pathname, '/sso/authorize');
  assert.strictEqual(u.searchParams.get('app'), 'conteudo');
  assert.strictEqual(u.searchParams.get('return'), '/?tab=central');
});

// ── Rota: servidor mínimo com o MESMO middleware de acesso do app ───────────────────────────────────────────────
let srv; let base; const envAntes = { ...process.env };
async function sobe(env) {
  for (const k of ['APP_ACCESS_CODE', 'APP_ACCESS_MODE', 'VERCEL', 'NODE_ENV', 'CRON_SECRET', 'DATABASE_URL']) delete process.env[k];
  Object.assign(process.env, env);
  if (srv) await new Promise((r) => srv.close(r));
  Object.keys(require.cache).filter((k) => k.includes(`${path.sep}backend${path.sep}`)).forEach((k) => { delete require.cache[k]; });
  const express = require('express');
  const access = require('./access');
  const app = express();
  app.use(express.json());
  access.registrarRotas(app);
  require('./ssoRota').registrar(app, { keys: KEYS });
  app.use('/api', access.exigeAcesso);
  app.get('/api/privado', (req, res) => res.json({ ok: true }));
  app.post('/api/privado', (req, res) => res.json({ ok: true }));
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  return access;
}
const callback = (token) => fetch(`${base}/api/sso/callback?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
test.after(async () => {
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k];
  Object.assign(process.env, envAntes);
});

test('callback: JWT válido emite o token de acesso do app, no fragmento, e o middleware existente o aceita', async () => {
  const access = await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-sso-1' });
  assert.strictEqual((await fetch(`${base}/api/privado`)).status, 401, 'sem token a rota privada continua fechada');

  const r = await callback(assinar({ ret: '/?tab=central' }));
  assert.strictEqual(r.status, 302);
  const destino = r.headers.get('location');
  assert.match(destino, /^\/\?tab=central#sso=[\w-]+\.[\w-]+$/, destino);
  assert.ok(!destino.split('#')[0].includes('sso='), 'o token não vai em query string');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');

  const token = decodeURIComponent(destino.split('#sso=')[1]);
  const p = access.verify(token);
  assert.strictEqual(p.sub, 'pedro@avanteza.com.br');
  assert.ok(p.exp > agora() + 13 * 24 * 3600, 'mesma validade do login por código (14 dias)');
  assert.strictEqual((await fetch(`${base}/api/privado`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.strictEqual((await fetch(`${base}/api/privado`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status, 200);
  const st = await (await fetch(`${base}/api/auth/status`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.strictEqual(st.authenticated, true);

  // Cookie de leitura (imagens): o mesmo do login por código.
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^pico_t=.+; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
  assert.strictEqual((await fetch(`${base}/api/privado`, { headers: { cookie: cookie.split(';')[0] } })).status, 200);

  // É o mesmo esquema do login por código: os dois tokens valem lado a lado.
  const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'codigo-de-teste-sso-1' }) })).json();
  assert.ok(access.verify(login.token));
  assert.strictEqual((await fetch(`${base}/api/privado`, { headers: { authorization: `Bearer ${login.token}` } })).status, 200);
});

test('callback: token recusado volta para a tela de acesso com mensagem curta e não emite nada', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-sso-1' });
  const ruins = { 'audience errada': assinar({ aud: 'crm' }), expirado: assinar({ exp: agora() - 120 }), 'outra chave': assinar({}, { chave: outra.privateKey }), malformado: 'abc', vazio: '' };
  for (const [nome, t] of Object.entries(ruins)) {
    const r = await callback(t);
    assert.strictEqual(r.status, 302, nome);
    assert.strictEqual(r.headers.get('location'), '/#sso_erro=invalido', nome);
    assert.strictEqual(r.headers.get('set-cookie'), null, nome);
  }
});

test('callback: o mesmo JWT da Central não vale duas vezes', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-sso-1' });
  const t = assinar();
  assert.match((await callback(t)).headers.get('location'), /^\/#sso=/);
  assert.strictEqual((await callback(t)).headers.get('location'), '/#sso_erro=invalido');
});

test('callback: caminho de volta nunca sai do app', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-sso-1' });
  for (const ret of ['//evil.example/x', '/\\evil.example', 'https://evil.example', '/a#b']) {
    const destino = (await callback(assinar({ ret }))).headers.get('location');
    assert.match(destino, /^\/#sso=/, `${ret} → ${destino}`);
  }
  const { caminhoSeguro } = require('./ssoRota');
  assert.strictEqual(caminhoSeguro('/?tab=videos'), '/?tab=videos');
  assert.strictEqual(caminhoSeguro('/\\evil'), '/');
  assert.strictEqual(caminhoSeguro(['/a']), '/');
});

test('callback: servidor publicado sem código de acesso continua fechado; app aberto só entra, sem token', async () => {
  await sobe({ VERCEL: '1' });
  assert.strictEqual((await callback(assinar())).headers.get('location'), '/#sso_erro=config');
  await sobe({});
  const r = await callback(assinar());
  assert.strictEqual(r.headers.get('location'), '/');
  assert.strictEqual(r.headers.get('set-cookie'), null);
});

test('entrar: manda para a Central com app=conteudo e o caminho de volta', async () => {
  await sobe({ VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-sso-1' });
  const r = await fetch(`${base}/api/sso/entrar?return=${encodeURIComponent('/?tab=central')}`, { redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  const u = new URL(r.headers.get('location'));
  assert.strictEqual(`${u.origin}${u.pathname}`, 'https://app.avanteza.com.br/sso/authorize');
  assert.strictEqual(u.searchParams.get('app'), 'conteudo');
  assert.strictEqual(u.searchParams.get('return'), '/?tab=central');
});

test('servidor real (backend/server.js, a entrada da Vercel): /api/sso/callback fica fora da verificação de acesso; o resto de /api/sso não', async () => {
  for (const k of ['APP_ACCESS_CODE', 'APP_ACCESS_MODE', 'VERCEL', 'NODE_ENV', 'CRON_SECRET', 'DATABASE_URL']) delete process.env[k];
  Object.assign(process.env, { VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-sso-1' });
  if (srv) await new Promise((r) => srv.close(r));
  Object.keys(require.cache).filter((k) => k.includes(`${path.sep}backend${path.sep}`)).forEach((k) => { delete require.cache[k]; });
  const app = require('../../api/index.js');
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  const r = await callback('abc');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/#sso_erro=invalido');
  assert.strictEqual((await fetch(`${base}/api/sso/entrar`, { redirect: 'manual' })).status, 302);
  const central = await fetch(`${base}/api/sso/central`, { redirect: 'manual' });
  assert.strictEqual(central.status, 302);
  assert.strictEqual(central.headers.get('location'), 'https://app.avanteza.com.br/central');
  assert.strictEqual((await fetch(`${base}/api/sso/outra`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/content/`)).status, 401);
});
