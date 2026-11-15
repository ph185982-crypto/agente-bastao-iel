// Estado da sessão para a página.
//   GET            → { autenticado, email, nome, sso, pin, entrar }
//   POST / DELETE  → encerra a sessão (apaga o cookie)
const { authorizeUrl } = require('./_lib/avanteza-sso');
const { lerSessao, segredoSessao, cookieDeSaida, pinConfere } = require('./_lib/sessao');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const metodo = req.method || 'GET';

  if (metodo === 'POST' || metodo === 'DELETE') {
    res.setHeader('Set-Cookie', cookieDeSaida());
    res.statusCode = 200;
    return res.end(JSON.stringify({ autenticado: false }));
  }
  if (metodo !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET, POST, DELETE'); return res.end(JSON.stringify({ error: 'method_not_allowed' })); }

  const sessao = lerSessao(req);
  const sso = !!segredoSessao();
  res.statusCode = 200;
  return res.end(JSON.stringify({
    autenticado: !!sessao,
    email: sessao ? sessao.email : null,
    nome: sessao ? sessao.nome : null,
    sso, // false = SESSION_SECRET ausente: só o PIN funciona
    mensagem: sso ? null : 'Login único indisponível: falta configurar SESSION_SECRET no projeto. Use o PIN.',
    pin: pinConfere(req), // true quando o cabeçalho x-nexo-pin enviado confere (a página usa para validar o PIN)
    entrar: authorizeUrl('contratos', '/'),
  }));
};
