// Notificações: uma por lote, assinatura validada, aparelho morto removido. Sem rede.
const test = require('node:test');
const assert = require('node:assert');
const A = require('./armazem');
const push = require('./push');

const sub = (n) => ({ endpoint: `https://push.exemplo.test/${n}`, keys: { p256dh: 'BP'.padEnd(80, 'x'), auth: 'a'.repeat(22) } });
test.after(() => setTimeout(() => process.exit(process.exitCode || 0), 100).unref());

test('assinatura inválida é recusada; precisa de banco durável', async () => {
  assert.strictEqual(push.assinaturaValida({ endpoint: 'http://inseguro.test/x', keys: { p256dh: 'a', auth: 'b' } }), null, 'só https');
  assert.strictEqual(push.assinaturaValida({ endpoint: 'https://ok.test/x' }), null);
  assert.strictEqual(push.assinaturaValida('x'), null);
  A._definir(A.memoria());
  await assert.rejects(() => push.salvarAssinatura(sub(1)), (e) => e.status === 503);
});

test('uma notificação por lote para cada aparelho; aparelho que respondeu 410 é removido', async () => {
  const arm = Object.assign(A.memoria(), { duravel: true });
  A._definir(arm);
  process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
  await push.salvarAssinatura(sub(1)); await push.salvarAssinatura(sub(2)); await push.salvarAssinatura(sub(1));
  assert.strictEqual((await push.lista()).length, 2, 'mesmo aparelho não duplica');
  const enviados = [];
  const r = await push.notificarLote(5, { sender: async (s, p) => { enviados.push([s.endpoint, JSON.parse(p)]); if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 }); } });
  assert.strictEqual(enviados.length, 2, 'uma mensagem por aparelho, não por item');
  assert.strictEqual(enviados[0][1].corpo, '5 conteúdos novos para aprovar');
  assert.strictEqual(enviados[0][1].url, '/?tab=central');
  assert.deepStrictEqual([r.enviadas, r.removidas], [1, 1]);
  assert.strictEqual((await push.lista()).length, 1);
  const um = []; await push.notificarLote(1, { sender: async (s, p) => um.push(JSON.parse(p)) });
  assert.strictEqual(um[0].corpo, '1 conteúdo novo para aprovar');
});

test('sem chaves VAPID nada é enviado e o motivo é dito', async () => {
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  const r = await push.notificarLote(3, { sender: async () => { throw new Error('não devia chamar'); } });
  assert.strictEqual(r.enviadas, 0); assert.match(r.motivo, /VAPID/);
});
