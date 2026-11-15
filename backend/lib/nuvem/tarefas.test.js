// node --test backend/lib/nuvem/tarefas.test.js
const test = require('node:test'); const assert = require('node:assert');
const T = require('./tarefas');
test('cria a tarefa HTTP com segredo, atraso e nome (idempotência); 409 = já na fila', async () => {
  Object.assign(process.env, { GCP_PROJETO: 'p1', GCP_REGIAO: 'southamerica-east1', PUBLIC_BASE_URL: 'https://app.run/', CRON_SECRET: 's3' });
  const chamadas = [];
  const f = async (url, o = {}) => {
    chamadas.push({ url, o });
    if (url.includes('metadata')) return { ok: true, json: async () => ({ access_token: 'tk', expires_in: 3600 }) };
    return chamadas.length > 2 ? { ok: false, status: 409 } : { ok: true, status: 200, json: async () => ({ name: 'x' }) };
  };
  await T.criar({ caminho: '/api/nuvem/studio', corpo: { id: 'a' }, atrasoS: 30, chave: 'piloto:123' }, { f });
  const { url, o } = chamadas[1]; const { task } = JSON.parse(o.body);
  assert.strictEqual(url, 'https://cloudtasks.googleapis.com/v2/projects/p1/locations/southamerica-east1/queues/pedro/tasks');
  assert.strictEqual(o.headers.Authorization, 'Bearer tk');
  assert.strictEqual(task.httpRequest.url, 'https://app.run/api/nuvem/studio');
  assert.strictEqual(task.httpRequest.headers.Authorization, 'Bearer s3');
  assert.deepStrictEqual(JSON.parse(Buffer.from(task.httpRequest.body, 'base64')), { id: 'a' });
  assert.ok(task.name.endsWith('/tasks/piloto-123')); assert.ok(Date.parse(task.scheduleTime) > Date.now());
  assert.deepStrictEqual(await T.criar({ caminho: '/x', chave: 'piloto:123' }, { f }), { duplicada: true });
});
