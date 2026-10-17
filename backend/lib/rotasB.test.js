// Rotas da Mesa (B) sem IA e sem rede externa. node --test backend/lib/rotasB.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api/content', require('../routes/content'));
let srv; let base;
test.before(async () => { await new Promise((r) => { srv = app.listen(0, r); }); base = `http://127.0.0.1:${srv.address().port}/api/content`; });
test.after(() => srv.close());
const post = async (rota, corpo) => { const r = await fetch(`${base}/${rota}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }); return { status: r.status, json: await r.json() }; };

test('ingest: endereço interno é recusado (proteção contra acesso à rede interna)', async () => {
  for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost:3000', 'file:///etc/passwd', 'http://10.0.0.1/']) {
    const r = await post('ingest', { url });
    assert.strictEqual(r.status, 400, url);
    assert.ok(r.json.error);
  }
});

test('ingest: rede social não é lida; texto colado vira fonte com aviso', async () => {
  const r = await post('ingest', { url: 'https://www.instagram.com/p/abc/' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.fonte.acesso, 'nao_legivel');
  const t = await post('ingest', { texto: 'O Senado aprovou hoje o projeto. '.repeat(20) });
  assert.strictEqual(t.json.fonte.tipo, 'texto');
  assert.ok(t.json.fonte.observacoes.some((o) => /veracidade/.test(o)));
  assert.strictEqual((await post('ingest', {})).status, 400);
});

test('sem chave de IA: erro honesto, não resposta inventada', async () => {
  const antes = { ...process.env };
  for (const k of Object.keys(process.env)) if (/GROQ|GEMINI|OPENROUTER|ANTHROPIC|OPENAI|MISTRAL|CEREBRAS/i.test(k)) delete process.env[k];
  const r = await post('claims', { fonte: { texto: 'x'.repeat(500), legivel: true } });
  Object.assign(process.env, antes);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.code, 'SEM_IA');
});

test('render-slide: devolve PNG 1080x1350 com métricas; imagem inválida é recusada', async () => {
  const slide = { id: 's1', funcao: 'explicacao', layout: 'explicacao', texto: 'O Senado aprovou o teto de **R$ 140 mil** para o MEI.' };
  const r = await post('render-slide', { slide, indice: 2, total: 6 });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.png.startsWith('data:image/png;base64,'));
  const sharp = require('sharp');
  const meta = await sharp(Buffer.from(r.json.png.split(',')[1], 'base64')).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [1080, 1350]);
  assert.strictEqual(r.json.metrics.cabe, true);
  const ruim = await post('render-slide', { slide, imagem: 'data:image/png;base64,AAAA' });
  assert.strictEqual(ruim.status, 400);
  assert.ok(ruim.json.error);
  const svg = await post('render-slide', { slide, imagem: 'data:image/svg+xml;base64,PHN2Zy8+' });
  assert.ok(svg.json.error && /PNG, JPG ou WebP/.test(svg.json.error));
});

test('render-slide: texto longo demais não é espremido — avisa que não cabe', async () => {
  const slide = { id: 's1', funcao: 'explicacao', layout: 'explicacao', texto: 'palavra '.repeat(400) };
  const r = await post('render-slide', { slide });
  assert.strictEqual(r.json.metrics.cabe, false);
});

test('request_id repetido devolve o mesmo resultado sem refazer o trabalho', async () => {
  const slide = { id: 's1', funcao: 'explicacao', layout: 'explicacao', texto: 'Teste de duplicidade.' };
  const [a, b] = await Promise.all([post('render-slide', { slide, request_id: 'dup-1' }), post('render-slide', { slide, request_id: 'dup-1' })]);
  assert.strictEqual(a.json.png, b.json.png);
});

test('calculo-ipca: entrada inválida é recusada', async () => {
  assert.strictEqual((await post('calculo-ipca', { valor: -1, de: '1994-07', ate: '2026-09' })).status, 400);
  assert.ok((await post('calculo-ipca', { valor: 100, de: 'x', ate: '2026-09' })).json.error);
});
