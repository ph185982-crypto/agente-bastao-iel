// Autenticação do GitHub Actions sem segredo guardado: o runner pede ao GitHub um token OIDC (JWT assinado, de poucos minutos)
// e o servidor confere a assinatura nas chaves públicas do GitHub e as "claims": só vale para este repositório, na branch
// principal e para os workflows listados. Quem não consegue rodar um workflow do repositório não tem como gerar esse token.
// Assim o editor de vídeo e a coleta da Reciclagem funcionam sem o Pedro cadastrar `CRON_SECRET` no GitHub.
const crypto = require('crypto');

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCIA = 'agente-bastao-iel';
const REPOSITORIO = () => process.env.GITHUB_OIDC_REPO || 'ph185982-crypto/agente-bastao-iel';
const WORKFLOWS = ['video-worker.yml', 'reciclagem.yml'];
// `push` só chega aqui da branch principal (ref conferido abaixo): quem consegue dar push na main já é o dono do repositório.
const EVENTOS = new Set(['schedule', 'workflow_dispatch', 'repository_dispatch', 'push']);
const FORMA_JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

let cache = { em: 0, chaves: [] };
async function chaves({ fetcher = globalThis.fetch, agora = Date.now(), forcar = false } = {}) {
  if (!forcar && cache.chaves.length && agora - cache.em < 3600000) return cache.chaves;
  const r = await fetcher(JWKS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`JWKS do GitHub indisponível (${r.status})`);
  const d = await r.json();
  cache = { em: agora, chaves: Array.isArray(d.keys) ? d.keys : [] };
  return cache.chaves;
}
const json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Devolve true só se o token é um JWT do GitHub Actions válido, deste repositório, da branch principal e de um workflow permitido.
async function verificar(token, { fetcher, agora = Date.now(), workflows = WORKFLOWS } = {}) {
  if (!FORMA_JWT.test(String(token || ''))) return false;
  const [h, p, s] = token.split('.');
  let cab; let claims;
  try { cab = json(h); claims = json(p); } catch { return false; }
  if (cab.alg !== 'RS256' || !cab.kid) return false;
  let jwk = (await chaves({ fetcher, agora })).find((k) => k.kid === cab.kid);
  if (!jwk) jwk = (await chaves({ fetcher, agora, forcar: true })).find((k) => k.kid === cab.kid); // chave nova: relê uma vez
  if (!jwk) return false;
  let ok = false;
  try { ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url')); } catch { return false; }
  if (!ok) return false;
  const t = Math.floor(agora / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !aud.includes(AUDIENCIA)) return false;
  if (!(claims.exp > t) || (claims.nbf && claims.nbf > t + 60)) return false;
  const repo = REPOSITORIO();
  if (claims.repository !== repo || claims.ref !== 'refs/heads/main' || !EVENTOS.has(claims.event_name)) return false;
  const wf = String(claims.job_workflow_ref || claims.workflow_ref || '');
  return workflows.some((f) => wf.startsWith(`${repo}/.github/workflows/${f}@refs/heads/main`));
}

module.exports = { verificar, chaves, FORMA_JWT, AUDIENCIA, _zerar: () => { cache = { em: 0, chaves: [] }; } };
