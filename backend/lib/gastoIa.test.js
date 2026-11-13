// Gasto com IA paga: preço, registro, teto mensal e ritmo do dia; escolha do modelo por etapa (servidor OpenAI falso).
// node --test backend/lib/gastoIa.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const arm = require('./armazem');
const G = require('./gastoIa');

const novo = () => { arm._definir(Object.assign(arm.memoria(), { duravel: true })); G._zerar(); };
const DIA = Date.parse('2026-11-13T15:00:00Z');

test('custo: prefixo em cache sai a 10% e o raciocínio conta como saída', () => {
  const c = G.custo('gpt-5.4', { prompt_tokens: 10000, prompt_tokens_details: { cached_tokens: 8000 }, completion_tokens: 3000 });
  // 2.000 × 2,50 + 8.000 × 0,25 + 3.000 × 15 = 5.000 + 2.000 + 45.000 = 52.000 / 1e6
  assert.strictEqual(Math.round(c.usd * 1e6), 52000);
  assert.strictEqual(G.custo('gpt-5.4-mini-2026-03-17', { prompt_tokens: 1e6, completion_tokens: 0 }).usd, 0.75, 'versão datada usa o preço do modelo');
  assert.strictEqual(G.custo('modelo-desconhecido', { prompt_tokens: 1 }), null);
});

test('teto: registra por dia, etapa e modelo; para no ritmo do dia e no teto do mês; o mês novo zera', async () => {
  novo(); const antes = process.env.IA_TETO_MENSAL_USD; process.env.IA_TETO_MENSAL_USD = '30';
  try {
    assert.strictEqual(await G.podeGastar({ agora: DIA }), true);
    // US$ 1,50 num dia (o ritmo do dia é 30 ÷ 30 × 2 = US$ 2)
    await G.registrar('gpt-5.4', { prompt_tokens: 0, completion_tokens: 100000 }, { agora: DIA, etapa: 'roteiro' });
    assert.strictEqual(await G.podeGastar({ agora: DIA }), true);
    await G.registrar('gpt-5.4-mini', { prompt_tokens: 0, completion_tokens: 120000 }, { agora: DIA, etapa: 'juri' }); // + 0,54
    assert.strictEqual(await G.podeGastar({ agora: DIA }), false, 'passou do ritmo do dia');
    assert.strictEqual(await G.podeGastar({ agora: DIA + 86400000 }), true, 'no dia seguinte volta');
    const r = await G.resumo({ agora: DIA });
    assert.deepStrictEqual({ usd: r.usd, hoje: r.hoje_usd, chamadas: r.chamadas, teto: r.teto_usd }, { usd: 2.04, hoje: 2.04, chamadas: 2, teto: 30 });
    assert.deepStrictEqual(r.por_etapa, { roteiro: 1.5, juri: 0.54 });
    // teto do mês
    process.env.IA_TETO_MENSAL_USD = '2';
    assert.strictEqual(await G.podeGastar({ agora: DIA + 86400000 }), false, 'chegou no teto do mês');
    assert.strictEqual(await G.podeGastar({ agora: Date.parse('2026-12-02T15:00:00Z') }), true, 'mês novo começa do zero');
  } finally { if (antes === undefined) delete process.env.IA_TETO_MENSAL_USD; else process.env.IA_TETO_MENSAL_USD = antes; }
});

test('cascata: roteiro e capas vão ao modelo forte, ângulo e júri ao barato, painel nunca paga; sem orçamento a OpenAI sai', async () => {
  novo();
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
      const j = JSON.parse(b || '{}'); pedidos.push(j);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2000, prompt_tokens_details: { cached_tokens: 1500 }, completion_tokens: 1000, total_tokens: 3000 } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const env = { k: process.env.OPENAI_API_KEY, u: process.env.OPENAI_BASE_URL, f: process.env.IA_OPENAI, g: process.env.GROQ_API_KEY, gm: process.env.GEMINI_API_KEY, c: process.env.CEREBRAS_API_KEY, o: process.env.OPENROUTER_API_KEY, m: process.env.IA_PREMIUM_MODELO };
  process.env.OPENAI_API_KEY = 'sk-teste'; process.env.OPENAI_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`; process.env.IA_OPENAI = '1';
  for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'IA_PREMIUM_MODELO']) delete process.env[k];
  const llmJson = require('./llmJson');
  try {
    const pedir = (o) => llmJson.pedirJson({ sistema: 'Instrução fixa da etapa.', usuario: 'oi', maxTokens: 300, preferirMelhor: true, ...o });
    assert.strictEqual((await pedir({ pago: 'premium', etapa: 'roteiro' })).llm.model, 'gpt-5.4');
    assert.strictEqual((await pedir({ pago: 'mini', etapa: 'juri' })).llm.model, 'gpt-5.4-mini');
    assert.ok(pedidos.every((p) => /^pd-/.test(p.prompt_cache_key)), 'chave de cache do prompt em toda chamada à OpenAI');
    assert.ok(pedidos.every((p) => p.reasoning_effort === 'low'), 'raciocínio curto');
    await assert.rejects(pedir({ pago: 'nunca', etapa: 'painel' }), 'painel nunca usa a OpenAI (aqui não há IA gratuita)');
    const r = await G.resumo();
    assert.strictEqual(r.chamadas, 2); assert.deepStrictEqual(Object.keys(r.por_etapa).sort(), ['juri', 'roteiro']); assert.strictEqual(r.cache_pct, 75);
    // sem orçamento: a OpenAI some da cascata
    const antes = process.env.IA_TETO_MENSAL_USD; process.env.IA_TETO_MENSAL_USD = '0.000001'; G._zerar();
    const n = pedidos.length;
    await assert.rejects(pedir({ pago: 'premium', etapa: 'roteiro' }));
    assert.strictEqual(pedidos.length, n, 'nenhuma chamada paga depois do teto');
    if (antes === undefined) delete process.env.IA_TETO_MENSAL_USD; else process.env.IA_TETO_MENSAL_USD = antes;
  } finally {
    srv.close();
    for (const [k, v] of [['OPENAI_API_KEY', env.k], ['OPENAI_BASE_URL', env.u], ['IA_OPENAI', env.f], ['GROQ_API_KEY', env.g], ['GEMINI_API_KEY', env.gm], ['CEREBRAS_API_KEY', env.c], ['OPENROUTER_API_KEY', env.o], ['IA_PREMIUM_MODELO', env.m]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
