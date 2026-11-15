const test = require('node:test');
const assert = require('node:assert/strict');
const { respostaFalsa, requisicao, novoEmissor } = require('./apoio');

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';

const S = require('../api/_lib/sessao');
const { criarHandler } = require('../api/sso/callback');

const emissor = novoEmissor();
const handler = criarHandler({ keys: emissor.keys });
const chamar = async (token, h = handler) => { const res = respostaFalsa(); await h(requisicao({ query: { token }, url: '/api/sso/callback' }), res); return res; };
const agora = () => Math.floor(Date.now() / 1000);

function semSessao(res) {
  assert.equal(res.statusCode, 302);
  assert.equal(res.getHeader('Location'), '/?erro=sso');
  assert.equal(res.getHeader('Set-Cookie'), undefined);
}

test('token válido cria a sessão e volta para a página', async () => {
  const res = await chamar(emissor.emitir());
  assert.equal(res.statusCode, 302);
  assert.equal(res.getHeader('Location'), '/');
  const cookie = res.getHeader('Set-Cookie');
  for (const parte of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) assert.ok(cookie.includes(parte), parte);
  const valor = cookie.match(/^avz_contratos=([^;]+);/)[1];
  const s = S.lerSessao(requisicao({ headers: { cookie: `avz_contratos=${valor}` } }));
  assert.equal(s.email, 'pedro@avanteza.com.br'); // e-mail normalizado em minúsculas
  assert.equal(s.nome, 'Pedro');
});

test('token lido da URL quando não há req.query', async () => {
  const res = respostaFalsa();
  await handler({ method: 'GET', headers: {}, url: `/api/sso/callback?token=${emissor.emitir()}` }, res);
  assert.equal(res.getHeader('Location'), '/');
});

test('audience errada é recusada', async () => semSessao(await chamar(emissor.emitir({ aud: 'crm' }))));

test('token expirado é recusado', async () => semSessao(await chamar(emissor.emitir({ iat: agora() - 300, exp: agora() - 120 }))));

test('emissor errado, token ausente e token malformado são recusados', async () => {
  semSessao(await chamar(emissor.emitir({ iss: 'outro' })));
  semSessao(await chamar(''));
  semSessao(await chamar('a.b'));
});

test('assinatura de outra chave e payload adulterado são recusados', async () => {
  const intruso = novoEmissor(); // mesmo kid, outra chave privada
  semSessao(await chamar(intruso.emitir()));
  const [h, , a] = emissor.emitir().split('.');
  const p = Buffer.from(JSON.stringify({ iss: 'avanteza-id', aud: 'contratos', sub: 'intruso@x.com', exp: agora() + 60 })).toString('base64url');
  semSessao(await chamar(`${h}.${p}.${a}`));
  semSessao(await chamar(novoEmissor('kid-desconhecido').emitir()));
});

test('sem SESSION_SECRET o retorno do login único falha com erro claro', async () => {
  const guardado = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try { semSessao(await chamar(emissor.emitir())); } finally { process.env.SESSION_SECRET = guardado; }
});

test('só aceita GET', async () => {
  const res = respostaFalsa();
  await handler(requisicao({ method: 'POST', query: { token: emissor.emitir() } }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader('Set-Cookie'), undefined);
});
