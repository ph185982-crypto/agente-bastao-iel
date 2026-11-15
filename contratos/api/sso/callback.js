// Retorno do login único (Avanteza ID): a Central redireciona para cá com ?token=<JWT ES256 de 60 s>.
// Token válido (audience "contratos") → grava o cookie de sessão e volta para a página.
const { verifyAvantezaToken } = require('../_lib/avanteza-sso');
const { segredoSessao, assinarSessao, cookieDeSessao } = require('../_lib/sessao');

const AUDIENCE = 'contratos';

function tokenDaRequisicao(req) {
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  try { return new URL(req.url, 'http://local').searchParams.get('token') || ''; } catch (_) { return ''; }
}

function redirecionar(res, destino) {
  res.statusCode = 302;
  res.setHeader('Location', destino);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer'); // o token veio na URL: não repassar adiante
  res.end();
}

/** Cria o handler; `keys` (JWKS) pode ser injetado nos testes para não depender da rede. */
function criarHandler({ keys } = {}) {
  return async function handler(req, res) {
    if (req.method && req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end(); }
    try {
      if (!segredoSessao()) throw new Error('SESSION_SECRET ausente ou curta: login único indisponível');
      const usuario = await verifyAvantezaToken(tokenDaRequisicao(req), { audience: AUDIENCE, keys });
      res.setHeader('Set-Cookie', cookieDeSessao(assinarSessao({ email: usuario.email, nome: usuario.name })));
      return redirecionar(res, '/');
    } catch (e) {
      console.error('[sso] falha no retorno do login único:', e && e.message);
      return redirecionar(res, '/?erro=sso');
    }
  };
}

module.exports = criarHandler();
module.exports.criarHandler = criarHandler;
