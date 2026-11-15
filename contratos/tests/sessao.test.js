const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { respostaFalsa, requisicao } = require('./apoio');

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';
process.env.SESSION_SECRET = SEGREDO;
process.env.NEXO_PIN = '4321';

const S = require('../api/_lib/sessao');
const comCookie = (valor) => requisicao({ headers: { cookie: `outro=1; ${S.NOME_COOKIE}=${valor}; x=y` } });

test('assina e lê a sessão', () => {
  const valor = S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana Souza' });
  assert.match(valor, /^[\w-]+\.[\w-]+$/);
  const s = S.lerSessao(comCookie(valor));
  assert.equal(s.email, 'ana@avanteza.com.br');
  assert.equal(s.nome, 'Ana Souza');
  const restante = s.exp - Math.floor(Date.now() / 1000);
  assert.ok(restante > 12 * 3600 - 5 && restante <= 12 * 3600);
});

test('cookie de sessão tem os atributos exigidos', () => {
  const c = S.cookieDeSessao('abc.def');
  for (const parte of ['avz_contratos=abc.def', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) assert.ok(c.includes(parte), parte);
  assert.match(S.cookieDeSaida(), /^avz_contratos=;.*Max-Age=0/);
});

test('sessão adulterada é recusada', () => {
  const valor = S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana' });
  const [payload, assinatura] = valor.split('.');
  // payload trocado, assinatura original
  const falso = Buffer.from(JSON.stringify({ email: 'intruso@x.com', nome: 'X', exp: 9999999999 })).toString('base64url');
  assert.equal(S.lerSessao(comCookie(`${falso}.${assinatura}`)), null);
  // assinatura alterada em um caractere
  const trocada = assinatura.slice(0, -1) + (assinatura.endsWith('A') ? 'B' : 'A');
  assert.equal(S.lerSessao(comCookie(`${payload}.${trocada}`)), null);
  // assinada com outro segredo
  const outro = crypto.createHmac('sha256', 'outro-segredo-qualquer-com-32-caracteres!!').update(payload).digest('base64url');
  assert.equal(S.lerSessao(comCookie(`${payload}.${outro}`)), null);
  // formatos inválidos
  for (const v of ['', 'abc', `${payload}.`, `.${assinatura}`, `${payload}.${assinatura}.x`]) assert.equal(S.lerSessao(comCookie(v)), null);
  assert.equal(S.lerSessao(requisicao()), null);
});

test('sessão expirada é recusada', () => {
  const treze_horas_atras = Date.now() - 13 * 3600 * 1000;
  const valor = S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana' }, SEGREDO, treze_horas_atras);
  assert.equal(S.lerSessao(comCookie(valor)), null);
  // a mesma sessão valia no momento em que foi emitida
  assert.equal(S.lerValorSessao(valor, SEGREDO, treze_horas_atras + 1000).email, 'ana@avanteza.com.br');
});

test('exigirAcesso aceita sessão válida ou PIN correto e nega o resto', () => {
  let res = respostaFalsa();
  const valor = S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana' });
  assert.deepEqual(S.exigirAcesso(comCookie(valor), res), { tipo: 'sessao', email: 'ana@avanteza.com.br', nome: 'Ana' });
  assert.equal(res.encerrada, false);

  res = respostaFalsa();
  assert.deepEqual(S.exigirAcesso(requisicao({ headers: { 'x-nexo-pin': '4321' } }), res), { tipo: 'pin' });

  res = respostaFalsa();
  assert.equal(S.exigirAcesso(requisicao({ headers: { 'x-nexo-pin': '0000' } }), res), null);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.corpo).error, 'invalid_pin');

  res = respostaFalsa();
  assert.equal(S.exigirAcesso(requisicao(), res), null);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.corpo).error, 'nao_autenticado');
});

test('sem SESSION_SECRET o login único fica indisponível e o PIN continua valendo', () => {
  const valor = S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana' });
  delete process.env.SESSION_SECRET;
  try {
    assert.equal(S.segredoSessao(), null);
    assert.equal(S.lerSessao(comCookie(valor)), null);
    assert.throws(() => S.assinarSessao({ email: 'a@b.c' }), /SESSION_SECRET/);
    assert.deepEqual(S.exigirAcesso(requisicao({ headers: { 'x-nexo-pin': '4321' } }), respostaFalsa()), { tipo: 'pin' });
    process.env.SESSION_SECRET = 'curta';
    assert.equal(S.segredoSessao(), null);
  } finally { process.env.SESSION_SECRET = SEGREDO; }
});

test('sem SESSION_SECRET e sem NEXO_PIN responde 500 (servidor não configurado)', () => {
  delete process.env.SESSION_SECRET; delete process.env.NEXO_PIN;
  try {
    const res = respostaFalsa();
    assert.equal(S.exigirAcesso(requisicao({ headers: { 'x-nexo-pin': 'qualquer' } }), res), null);
    assert.equal(res.statusCode, 500);
  } finally { process.env.SESSION_SECRET = SEGREDO; process.env.NEXO_PIN = '4321'; }
});

test('/api/sessao informa o estado e encerra a sessão', async () => {
  const handler = require('../api/sessao');
  let res = respostaFalsa();
  await handler(requisicao(), res);
  let d = JSON.parse(res.corpo);
  assert.equal(d.autenticado, false); assert.equal(d.sso, true); assert.equal(d.pin, false);
  assert.equal(d.entrar, 'https://app.avanteza.com.br/sso/authorize?app=contratos&return=%2F');

  res = respostaFalsa();
  await handler(comCookie(S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana' })), res);
  d = JSON.parse(res.corpo);
  assert.deepEqual([d.autenticado, d.email, d.nome], [true, 'ana@avanteza.com.br', 'Ana']);

  res = respostaFalsa();
  await handler(requisicao({ headers: { 'x-nexo-pin': '4321' } }), res);
  assert.equal(JSON.parse(res.corpo).pin, true);

  for (const method of ['POST', 'DELETE']) {
    res = respostaFalsa();
    await handler(requisicao({ method }), res);
    assert.match(res.getHeader('Set-Cookie'), /^avz_contratos=;.*Max-Age=0/);
    assert.equal(JSON.parse(res.corpo).autenticado, false);
  }
});

test('APIs exigem acesso: /api/cnpj, /api/clicksign e /api/zapsign negam sem sessão nem PIN', async () => {
  process.env.CLICKSIGN_TOKEN = 'x'; process.env.ZAPSIGN_TOKEN = 'x';
  const casos = [['../api/cnpj', requisicao({ query: { cnpj: '00000000000191' } })],
    ['../api/clicksign', requisicao({ method: 'POST', body: { action: 'list' } })],
    ['../api/zapsign', requisicao({ method: 'POST', body: { action: 'list' } })]];
  for (const [mod, req] of casos) {
    const res = respostaFalsa();
    await require(mod)(req, res);
    assert.equal(res.statusCode, 401, mod);
    assert.equal(res.getHeader('Access-Control-Allow-Origin'), undefined, mod);
  }
  // com sessão válida a checagem passa (ação inválida → 400, sem chamar o provedor)
  for (const mod of ['../api/clicksign', '../api/zapsign']) {
    const req = comCookie(S.assinarSessao({ email: 'ana@avanteza.com.br', nome: 'Ana' }));
    Object.assign(req, { method: 'POST', body: { action: 'nao-existe' } });
    const res = respostaFalsa();
    await require(mod)(req, res);
    assert.equal(res.statusCode, 400, mod);
  }
});
