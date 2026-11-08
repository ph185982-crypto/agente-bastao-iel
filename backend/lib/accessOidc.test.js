// O acesso do app libera as rotas do worker e da coleta para o token OIDC do GitHub, e só elas.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const O = require('./githubOidc');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt() {
  const t = Math.floor(Date.now() / 1000);
  const h = b({ alg: 'RS256', kid: 'k1' }); const p = b({ iss: 'https://token.actions.githubusercontent.com', aud: 'agente-bastao-iel', exp: t + 300, nbf: t - 5, repository: 'ph185982-crypto/agente-bastao-iel', ref: 'refs/heads/main', event_name: 'schedule', job_workflow_ref: 'ph185982-crypto/agente-bastao-iel/.github/workflows/video-worker.yml@refs/heads/main' });
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
}

test('acesso protegido: OIDC válido passa nas rotas do worker e da coleta; em outras rotas é 401', async () => {
  process.env.APP_ACCESS_CODE = 'codigo-de-teste-longo-123'; process.env.VERCEL = '1';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => (String(url).includes('/.well-known/jwks') ? { ok: true, json: async () => ({ keys: [jwk] }) } : realFetch(url, o));
  try {
    delete require.cache[require.resolve('./access')]; const access = require('./access');
    await access.carregarDono().catch(() => {});
    const chama = (path, bearer) => new Promise((resolve) => {
      const req = { originalUrl: path, headers: { authorization: `Bearer ${bearer}` }, method: 'GET' };
      const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); } };
      access.exigeAcesso(req, res, () => resolve(200));
    });
    const t = jwt();
    assert.strictEqual(await chama('/api/videos/worker/proximo', t), 200);
    assert.strictEqual(await chama('/api/reciclagem/coletar', t), 200);
    assert.strictEqual(await chama('/api/videos/worker/pexels?query=x', t), 200);
    assert.strictEqual(await chama('/api/videos', t), 401, 'rota do app não aceita OIDC');
    assert.strictEqual(await chama('/api/studio/c_1/decidir', t), 401);
    assert.strictEqual(await chama('/api/videos/worker/proximo', 'a.b.c'), 401);
  } finally { globalThis.fetch = realFetch; delete process.env.APP_ACCESS_CODE; delete process.env.VERCEL; O._zerar(); }
});
