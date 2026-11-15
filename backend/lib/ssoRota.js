// Login único "Avanteza ID": a Central (AVANTEZA_HUB_URL) autentica a pessoa e devolve um JWT ES256 de 60 s
// para este aplicativo (aud = "conteudo"). Aqui o JWT é conferido e trocado pelo MESMO token de acesso que o
// login por código emite (backend/lib/access.js). Nenhum segredo é compartilhado com a Central.
//
// Entrega ao navegador: o front guarda o token em localStorage, então o callback redireciona para a página
// com o token no FRAGMENTO (#sso=...). O fragmento não vai para o servidor nem para registros de acesso;
// static/auth.js lê, guarda e limpa. Erros voltam como #sso_erro=<código curto>.
const access = require('./access');
const { verifyAvantezaToken, authorizeUrl } = require('./avantezaSso');

const APP_ID = 'conteudo';

// Só caminhos internos: nada de "//host", "/\host", esquema, quebra de linha ou fragmento próprio.
function caminhoSeguro(v) {
  const s = typeof v === 'string' ? v : '';
  return /^\/(?![/\\])[^\\\s#]*$/.test(s) && s.length <= 500 ? s : '/';
}

// Cada JWT da Central vale uma vez só (por instância): guarda o jti até ele expirar.
const usados = new Map(); // jti -> expira em (ms)
function jaUsado(jti) {
  const agora = Date.now();
  for (const [k, ate] of usados) if (ate < agora) usados.delete(k);
  if (!jti) return false;
  if (usados.has(jti)) return true;
  usados.set(jti, agora + 120000);
  return false;
}

function redirecionar(res, destino) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, destino);
}

// `keys` só é passado nos testes (chave pública gerada na hora); em produção o verificador busca o JWKS da Central.
function registrar(app, { keys } = {}) {
  // Início do login: manda para a Central, que devolve em /api/sso/callback.
  app.get('/api/sso/entrar', (req, res) => redirecionar(res, authorizeUrl(APP_ID, caminhoSeguro(req.query.return))));

  app.get('/api/sso/callback', async (req, res) => {
    const erro = (codigo) => redirecionar(res, `/#sso_erro=${codigo}`);
    let usuario;
    try {
      usuario = await verifyAvantezaToken(req.query.token, { audience: APP_ID, keys });
    } catch (e) {
      console.warn('[sso] token recusado:', String(e.message).slice(0, 80));
      return erro(/JWKS|fetch|timeout|aborted/i.test(String(e.message)) ? 'central' : 'invalido');
    }
    if (jaUsado(usuario.jti)) return erro('invalido');
    try {
      await access.carregarDono();
      const estado = access.estadoAcesso();
      const destino = caminhoSeguro(usuario.returnTo);
      // App aberto (computador local ou modo público): não há token a emitir, só entra.
      if (estado === 'aberto_local' || estado === 'aberto_publico') return redirecionar(res, destino);
      // Sem código no servidor não existe segredo para assinar o token de acesso: continua fechado.
      if (estado === 'nao_configurado') return erro('config');
      const { token } = access.emitirAcesso(req, res, usuario.email);
      return redirecionar(res, `${destino}#sso=${encodeURIComponent(token)}`);
    } catch (e) {
      console.error('[sso] falha ao abrir a sessão:', String(e.message).slice(0, 100));
      return erro('servidor');
    }
  });
}

module.exports = { registrar, caminhoSeguro, APP_ID };
