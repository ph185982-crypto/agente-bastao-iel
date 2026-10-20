// /api/download/proxy não pode ser usado para ler a rede interna. node --test backend/lib/downloadProxy.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

test('proxy de download: só https nos CDNs da Meta; endereço interno e domínio qualquer são recusados', async () => {
  const app = express();
  app.use('/api/download', require('../routes/download'));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api/download/proxy`;
  try {
    for (const alvo of [
      `http://127.0.0.1:${srv.address().port}/api/download/proxy`,
      'http://169.254.169.254/latest/meta-data/',
      'https://exemplo.com/video.mp4',
      'https://cdninstagram.com.atacante.com/v.mp4',
      'http://scontent.cdninstagram.com/v.mp4',
      'file:///etc/passwd',
      'https://user:senha@scontent.cdninstagram.com/v.mp4',
    ]) {
      const r = await fetch(`${base}?videoUrl=${encodeURIComponent(alvo)}`);
      assert.strictEqual(r.status, 400, `${alvo} → ${r.status}`);
    }
    assert.strictEqual((await fetch(base)).status, 400);
  } finally { srv.close(); }
});
