// Provider routing only: no real credentials, drafts or external requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(reply, models = []) {
  const calls = [], logs = [], mod = { exports: {} };
  class OpenAI {
    constructor() {
      this.chat = { completions: { create: async opts => { calls.push(opts.model); return reply(opts.model, calls.length); } } };
      this.models = { list: async () => ({ data: models.map(id => ({ id })) }) };
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('./llm'), 'utf8'), {
    module: mod, require: name => { assert.equal(name, 'openai'); return OpenAI; },
    process: { env: { GROQ_API_KEY: 'fixture-not-a-key' } },
    console: { warn: (...args) => logs.push(args.join(' ')) },
  });
  return { client: mod.exports.createCompatClient(), calls, logs };
}
const ok = model => ({ model, choices: [{ message: { content: '{"ok":true}' } }] });
const rate = () => Object.assign(new Error('Rate limit reached for model `openai/gpt-oss-120b` in organization `private-org` on tokens per minute (TPM): Limit 8000, Used 6000, Requested 4000. SECRET fixture'), { status: 429, headers: { 'retry-after': '12' } });
const options = { model: 'gpt-4o', response_format: { type: 'json_object' }, messages: [] };

test('model-specific Groq 429 tries the next configured model without another provider', async () => {
  const f = fixture(model => { if (model === 'openai/gpt-oss-120b') throw rate(); return ok(model); });
  const r = await f.client.chat.completions.create(options);
  assert.deepEqual(f.calls, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  assert.equal(r.__llm.model, 'openai/gpt-oss-20b');
  assert.equal(r.__llm.tentativas_provedor, 2);
  assert(!f.logs.join(' ').includes('private-org'));
  assert(!f.logs.join(' ').includes('SECRET'));
  assert.match(f.logs.join(' '), /"metric":"tokens per minute"/);
  assert.match(f.logs.join(' '), /"retry_after_seconds":12/);
});

test('account quota and authentication errors stop the provider, not a model loop', async () => {
  for (const status of [401, 403, 429]) {
    const f = fixture(() => { throw Object.assign(new Error('Account unavailable'), { status }); });
    await assert.rejects(f.client.chat.completions.create(options), e => e.status === status);
    assert.equal(f.calls.length, 1);
  }
});

test('all model quotas preserve 429 for durable backoff even if discovery ends in 404', async () => {
  const f = fixture(model => { if (model === 'retired-model') throw Object.assign(new Error('Not found'), { status: 404 }); throw rate(); }, ['retired-model']);
  await assert.rejects(f.client.chat.completions.create(options), e => e.status === 429);
  assert.equal(new Set(f.calls).size, f.calls.length, 'each model attempted at most once');
  assert.equal(f.calls.length, 4, 'no second cascade without response_format for rate limits');
});

test('a cached successful model that later fills its quota is not retried twice', async () => {
  let cachedFailed = false;
  const f = fixture(model => { if (cachedFailed && model === 'openai/gpt-oss-120b') throw rate(); return ok(model); });
  await f.client.chat.completions.create(options);
  cachedFailed = true;
  const r = await f.client.chat.completions.create(options);
  assert.deepEqual(f.calls, ['openai/gpt-oss-120b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  assert.equal(r.__llm.model, 'openai/gpt-oss-20b');
});

test('discovery never sends a text draft to speech or guard models', async () => {
  const f = fixture(model => {
    if (model === 'text-chat-fixture') return ok(model);
    throw Object.assign(new Error('Not found'), { status: 404 });
  }, ['canopylabs/orpheus-v1-english', 'canopylabs/orpheus-arabic-saudi', 'whisper-large-v3', 'openai/gpt-oss-safeguard-20b', 'text-chat-fixture']);
  const r = await f.client.chat.completions.create(options);
  assert.equal(r.__llm.model, 'text-chat-fixture');
  assert(!f.calls.some(model => /orpheus|whisper|safeguard/.test(model)));
});
