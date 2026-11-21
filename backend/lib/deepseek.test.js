// DeepSeek como reserva barata da cascata de IA: preço registrado no teto mensal, modelo aceito como forte, chave só no servidor.
// node --test backend/lib/deepseek.test.js
const test = require('node:test');
const assert = require('node:assert');
const G = require('./gastoIa');
const L = require('./llm');
const fs = require('fs');

test('DeepSeek: custo pelo preço de pico, com cache do formato DeepSeek; modelo flash conta como forte', () => {
  const c = G.custo('deepseek-flash', { prompt_tokens: 1000000, completion_tokens: 1000000, prompt_cache_hit_tokens: 500000 });
  assert.strictEqual(Math.round(c.usd * 1000) / 1000, 1.353); // 0,5M×0,3 + 0,5M×0,006 + 1M×1,2
  assert.ok(L.modeloForte('deepseek-flash')); assert.ok(L.modeloForte('deepseek-v4-pro'));
});

test('DeepSeek: entra na cascata só com a chave no ambiente e sai com IA_DEEPSEEK=0; a chave nunca está no código', () => {
  const src = fs.readFileSync(require.resolve('./llm.js'), 'utf8');
  assert.match(src, /envKey: 'DEEPSEEK_API_KEY'/); assert.doesNotMatch(src, /sk-[a-f0-9]{20,}/);
  const antes = { ...process.env };
  try {
    for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'IA_DEEPSEEK']) delete process.env[k];
    assert.strictEqual(L.hasLlmKey(), false);
    process.env.DEEPSEEK_API_KEY = 'teste'; assert.strictEqual(L.hasLlmKey(), true);
    process.env.IA_DEEPSEEK = '0'; assert.strictEqual(L.hasLlmKey(), false);
  } finally { for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k]; Object.assign(process.env, antes); }
});
