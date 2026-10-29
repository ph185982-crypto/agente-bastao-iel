// Código de acesso criado pelo próprio app quando ele está aberto ao público (sem mexer na Vercel).
// node --test backend/lib/accessDono.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const arm = require('./armazem');
const A = require('./access');

async function servidor() {
  const app = express(); app.use(express.json());
  A.registrarRotas(app); app.use('/api', A.exigeAcesso); app.get('/api/privado', (req, res) => res.json({ ok: true }));
  const s = app.listen(0); await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const chamar = (p, { metodo = 'GET', corpo, token } = {}) => fetch(base + p, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined }).then(async (r) => ({ status: r.status, d: await r.json() }));
  return { s, chamar };
}

test('app aberto: o dono cria o código no app, o app fecha, o login vale e publicar libera', async () => {
  const antes = { v: process.env.VERCEL, m: process.env.APP_ACCESS_MODE, c: process.env.APP_ACCESS_CODE };
  arm._definir(Object.assign(arm.memoria(), { duravel: true })); A._zerarDono();
  process.env.VERCEL = '1'; process.env.APP_ACCESS_MODE = 'public'; delete process.env.APP_ACCESS_CODE;
  const { s, chamar } = await servidor();
  try {
    const P = require('./publicador');
    await assert.rejects(P.exigirAcessoProtegido(), (e) => e.code === 'ACESSO_ABERTO');
    assert.strictEqual((await chamar('/api/auth/status')).d.estado, 'aberto_publico');
    assert.strictEqual((await chamar('/api/auth/definir', { metodo: 'POST', corpo: { code: 'curto' } })).status, 400);
    const def = await chamar('/api/auth/definir', { metodo: 'POST', corpo: { code: 'meu-codigo-secreto-123' } });
    assert.strictEqual(def.status, 200); assert.ok(def.d.token);
    assert.strictEqual((await chamar('/api/auth/status')).d.estado, 'protegido');
    assert.strictEqual((await chamar('/api/privado')).status, 401);
    assert.strictEqual((await chamar('/api/privado', { token: def.d.token })).status, 200);
    // ninguém troca o código depois de criado
    assert.strictEqual((await chamar('/api/auth/definir', { metodo: 'POST', corpo: { code: 'outro-codigo-qualquer' } })).status, 409);
    assert.strictEqual((await chamar('/api/auth/login', { metodo: 'POST', corpo: { code: 'errado-errado-errado' } })).status, 401);
    const login = await chamar('/api/auth/login', { metodo: 'POST', corpo: { code: 'meu-codigo-secreto-123' } });
    assert.ok(login.d.token);
    // o código fica no banco como hash, nunca em texto
    const guardado = JSON.stringify(await arm.armazem().config.obter('__acesso'));
    assert.ok(!guardado.includes('meu-codigo-secreto-123'));
    // outra instância (cache zerado) lê do banco e continua fechada; publicar libera
    A._zerarDono();
    await P.exigirAcessoProtegido();
    assert.strictEqual((await chamar('/api/privado')).status, 401);
  } finally {
    s.close(); A._zerarDono();
    for (const [k, v] of [['VERCEL', antes.v], ['APP_ACCESS_MODE', antes.m], ['APP_ACCESS_CODE', antes.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('cookie de leitura: imagem (GET) passa com o cookie; escrita (POST) só com o cabeçalho', async () => {
  const antes = { v: process.env.VERCEL, m: process.env.APP_ACCESS_MODE, c: process.env.APP_ACCESS_CODE };
  arm._definir(arm.memoria()); A._zerarDono();
  delete process.env.VERCEL; delete process.env.APP_ACCESS_MODE; process.env.APP_ACCESS_CODE = 'codigo-do-teste-123';
  const app = express(); app.use(express.json());
  A.registrarRotas(app); app.use('/api', A.exigeAcesso);
  app.get('/api/img', (req, res) => res.json({ ok: true })); app.post('/api/mudar', (req, res) => res.json({ ok: true }));
  const s = app.listen(0); await new Promise((r) => s.once('listening', r)); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'codigo-do-teste-123' }) });
    const ck = login.headers.get('set-cookie'); assert.match(ck, /pico_t=.+HttpOnly; SameSite=Strict/);
    const cookie = ck.split(';')[0];
    assert.strictEqual((await fetch(`${base}/api/img`)).status, 401);
    assert.strictEqual((await fetch(`${base}/api/img`, { headers: { cookie } })).status, 200);
    assert.strictEqual((await fetch(`${base}/api/mudar`, { method: 'POST', headers: { cookie } })).status, 401);
    const { token } = await login.json();
    const c2 = await fetch(`${base}/api/auth/cookie`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.ok(c2.headers.get('set-cookie')?.startsWith('pico_t='));
    assert.strictEqual((await fetch(`${base}/api/auth/cookie`, { method: 'POST' })).status, 401);
  } finally {
    s.close();
    for (const [k, v] of [['VERCEL', antes.v], ['APP_ACCESS_MODE', antes.m], ['APP_ACCESS_CODE', antes.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
