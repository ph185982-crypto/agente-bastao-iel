// Verificação do token OIDC do GitHub Actions: assinatura, repositório, branch, workflow, validade.
// node --test backend/lib/githubOidc.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const O = require('./githubOidc');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const fetcher = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const AGORA = Date.parse('2026-11-08T12:00:00Z');
const REPO = 'ph185982-crypto/agente-bastao-iel';
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims = {}, { kid = 'k1', chave = privateKey } = {}) {
  const base = { iss: 'https://token.actions.githubusercontent.com', aud: 'agente-bastao-iel', exp: AGORA / 1000 + 300, nbf: AGORA / 1000 - 5, repository: REPO, ref: 'refs/heads/main', event_name: 'schedule', job_workflow_ref: `${REPO}/.github/workflows/video-worker.yml@refs/heads/main`, ...claims };
  const h = b({ alg: 'RS256', kid, typ: 'JWT' }); const p = b(base);
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), chave).toString('base64url')}`;
}
const ok = (t) => O.verificar(t, { fetcher, agora: AGORA });
test.beforeEach(() => O._zerar());

test('token válido do workflow do editor passa; o da coleta também', async () => {
  assert.strictEqual(await ok(jwt()), true);
  assert.strictEqual(await ok(jwt({ job_workflow_ref: `${REPO}/.github/workflows/reciclagem.yml@refs/heads/main`, event_name: 'workflow_dispatch' })), true);
});

test('recusa: repositório de outro dono, branch que não é a principal, workflow não listado, evento de PR', async () => {
  assert.strictEqual(await ok(jwt({ repository: 'outro/repo' })), false);
  assert.strictEqual(await ok(jwt({ ref: 'refs/heads/feature' })), false);
  assert.strictEqual(await ok(jwt({ job_workflow_ref: `${REPO}/.github/workflows/outro.yml@refs/heads/main` })), false);
  assert.strictEqual(await ok(jwt({ event_name: 'pull_request' })), false);
});

test('recusa: expirado, audiência errada, emissor errado, assinatura de outra chave, lixo', async () => {
  assert.strictEqual(await ok(jwt({ exp: AGORA / 1000 - 1 })), false);
  assert.strictEqual(await ok(jwt({ aud: 'outra-coisa' })), false);
  assert.strictEqual(await ok(jwt({ iss: 'https://evil.example' })), false);
  const outra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.strictEqual(await ok(jwt({}, { chave: outra })), false);
  assert.strictEqual(await ok(jwt({}, { kid: 'desconhecida' })), false);
  assert.strictEqual(await ok('abc'), false);
  assert.strictEqual(await ok('a.b.c'), false);
  assert.strictEqual(await ok(''), false);
});

test('JWKS indisponível: não autoriza (falha fechada)', async () => {
  await assert.rejects(O.verificar(jwt(), { fetcher: async () => ({ ok: false, status: 500 }), agora: AGORA }));
});
