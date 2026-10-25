// Etapa /api/content/ganchos com IA simulada: só fatos sustentados e posts do perfil como "recentes".
// node --test backend/lib/ganchosRota.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const A = require('./armazem');
const { ACCOUNT } = require('./account');

let srv; let base; let envAntes; let enviados = [];
test.before(async () => {
  envAntes = { ...process.env };
  process.env.GROQ_API_KEY = 'chave-falsa-de-teste';
  const llmJson = require('./llmJson');
  llmJson.pedirJson = async ({ usuario }) => { enviados.push(usuario); return { llm: { provider: 'simulado', model: 'teste', tokens: { entrada: 10, saida: 10, total: 20 } }, dados: { ganchos: [
    { formula: 'antes_depois', texto: 'Em 2010 o mínimo era R$ 510; hoje é R$ 1.518', claim_ids: ['a1'] },
    { formula: 'quanto_sobra', texto: 'Quanto sobra do R$ 1.518 depois do aluguel?', claim_ids: ['a1'] },
    { formula: 'numero_grande', texto: 'Aluguel sobe 9% e a Selic 15%', claim_ids: ['a2'] },
  ] } }; };
  for (const k of Object.keys(require.cache)) if (/backend[\\/]routes[\\/]content\.js$/.test(k)) delete require.cache[k];
  const arm = Object.assign(A.memoria(), { duravel: true });
  A._definir(arm);
  await arm.config.salvar(ACCOUNT.ig_id, { meu_instagram: { posts: [{ id: 'm1', legenda: 'Aluguel sobe 9% e pesa no bolso de quem trabalha. Segue o perfil.' }] } });
  const app = express();
  app.use(express.json());
  app.use('/api/content', require('../routes/content'));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}/api/content`;
});
test.after(() => { srv.close(); for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });

const post = async (corpo) => { const r = await fetch(`${base}/ganchos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }); return { status: r.status, json: await r.json() }; };
const claims = [
  { id: 'a1', texto: 'Em 2010 o salário mínimo era de R$ 510; em 2025 passou a R$ 1.518.', estado: 'sustentada' },
  { id: 'a2', texto: 'O aluguel subiu 9% em 12 meses.', estado: 'sustentada' },
  { id: 'a3', texto: 'Texto ainda não verificado com R$ 999.', estado: 'nao_verificada' },
];

test('devolve top 3 com verificações, descarta número inventado e usa só fatos sustentados', async () => {
  const r = await post({ request_id: 'g1', assunto: 'Salário mínimo', claims });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.top.length >= 2);
  assert.ok(r.json.descartados.some((d) => /número que os fatos ligados não têm/.test(d.motivo)), 'Selic 15% não está nos fatos');
  assert.ok(!enviados.at(-1).includes('R$ 999'), 'afirmação não verificada não vai para o prompt');
  assert.ok(r.json.consumo && r.json.consumo.etapa === 'ganchos', 'consumo registrado');
});

test('posts do perfil lidos pela aba Resultados entram como "recentes" e o gancho parecido é descartado', async () => {
  enviados = [];
  const r = await post({ request_id: 'g2', assunto: 'Aluguel', claims: [claims[1]] });
  assert.match(enviados[0], /Aluguel sobe 9% e pesa no bolso/);
  assert.strictEqual(r.status, 200);
});

test('mesmo request_id devolve o mesmo resultado sem chamar a IA de novo', async () => {
  enviados = [];
  const a = await post({ request_id: 'g3', assunto: 'Salário', claims });
  const n = enviados.length;
  const b = await post({ request_id: 'g3', assunto: 'Salário', claims });
  assert.strictEqual(enviados.length, n);
  assert.deepStrictEqual(a.json.top.map((x) => x.texto), b.json.top.map((x) => x.texto));
});

test('sem fato sustentado: 400 claro; sem IA: 503', async () => {
  const r = await post({ request_id: 'g4', assunto: 'x', claims: [claims[2]] });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /Confira os fatos/);
  const chave = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY;
  const sem = await post({ request_id: 'g5', assunto: 'x', claims });
  process.env.GROQ_API_KEY = chave;
  assert.strictEqual(sem.status, 503);
});
