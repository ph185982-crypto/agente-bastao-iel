// Links de mídia que vêm do navegador não podem alcançar a rede interna.
// node --test backend/lib/midiaSegura.test.js
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const { abrirStream } = require('./midiaSegura');

test('endereços internos, portas estranhas, protocolos e credenciais são recusados antes de conectar', async () => {
  for (const u of ['http://127.0.0.1/x.mp4', 'http://localhost/x.mp4', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/x.mp4', 'http://[::1]/x.mp4', 'https://exemplo.com:8443/x.mp4', 'file:///etc/passwd', 'ftp://exemplo.com/x.mp4', 'https://u:s@exemplo.com/x.mp4', 'isto não é link']) {
    await assert.rejects(() => abrirStream(u), (e) => e.isUrlError, u);
  }
});

test('nome público que resolve para IP interno é recusado na conexão (DNS rebinding)', async () => {
  const resolver = (host, opts, cb) => cb(null, [{ address: '10.1.2.3', family: 4 }]);
  await assert.rejects(() => abrirStream('http://video.exemplo.com/x.mp4', { resolver, timeout: 3000 }), (e) => /rede interna|IP_INTERNO/.test(`${e.message} ${e.code}`) || e.isUrlError);
});

test('redirecionamento para endereço interno é recusado; destino público é seguido', async () => {
  const original = axios.get;
  const chamadas = [];
  axios.get = async (url) => {
    chamadas.push(url);
    if (url.startsWith('https://cdn.exemplo.com/a')) return { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }, data: { destroy() {} } };
    if (url.startsWith('https://cdn.exemplo.com/b')) return { status: 302, headers: { location: '/c.mp4' }, data: { destroy() {} } };
    return { status: 200, headers: { 'content-type': 'video/mp4' }, data: {} };
  };
  try {
    await assert.rejects(() => abrirStream('https://cdn.exemplo.com/a'), (e) => e.isUrlError);
    assert.ok(!chamadas.some((u) => u.includes('169.254')), 'nem tentou conectar no destino interno');
    const ok = await abrirStream('https://cdn.exemplo.com/b');
    assert.strictEqual(ok.status, 200);
    assert.ok(chamadas.includes('https://cdn.exemplo.com/c.mp4'));
    axios.get = async (url) => ({ status: 302, headers: { location: `${url}x` }, data: { destroy() {} } });
    await assert.rejects(() => abrirStream('https://cdn.exemplo.com/loop'), /Redirecionamentos demais/);
  } finally { axios.get = original; }
});

test('rotas que recebem link do navegador devolvem 400 para endereço interno', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/content-finder', require('../routes/contentFinder'));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/content-finder/preview-video`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoUrl: 'http://169.254.169.254/latest/meta-data/' }) });
    assert.strictEqual(r.status, 400);
  } finally { srv.close(); }
});
