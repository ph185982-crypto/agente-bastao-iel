const test = require('node:test');
const assert = require('node:assert/strict');
const { ipProibido, validaUrl } = require('./safeFetch');
const M = require('../../static/contentModel');

test('SSRF: IPv4 privado mapeado em IPv6 e toda a faixa link-local são bloqueados', () => {
  for (const ip of ['::ffff:10.0.0.1', '::ffff:a00:1', '0:0:0:0:0:ffff:7f00:1', 'fe90::1', 'febf::1']) {
    assert.equal(ipProibido(ip), true, ip);
    assert.throws(() => validaUrl(`http://[${ip}]/`), e => e.code === 'IP_INTERNO');
  }
  assert.equal(ipProibido('::ffff:808:808'), false);
  assert.equal(ipProibido('2001:4860:4860::8888'), false);
});

test('novo número no título reabre as afirmações e preserva a versão anterior', () => {
  const c = M.novoConteudo();
  c.claims = [{ id: 'a1', estado: 'sustentada', revisao: {} }];
  M.criarVersao(c, { slides: [{ id: 's1', titulo: 'R$ 140 mil', texto: 'Teto anunciado.', claim_ids: ['a1'] }] });
  const { efeito } = M.editarSlide(c, 's1', { titulo: 'R$ 180 mil' });
  assert.deepEqual(efeito.afirmacoes, ['a1']);
  assert.ok(c.claims[0].revisao.reaberta_em);
  assert.equal(c.copia.versoes[0].slides[0].titulo, 'R$ 140 mil');
});

test('servidor entrega a interface atual e mantém a API privada fechada sem configuração', async () => {
  const antes = { VERCEL: process.env.VERCEL, FRONTEND_URL: process.env.FRONTEND_URL, APP_ACCESS_CODE: process.env.APP_ACCESS_CODE };
  process.env.VERCEL = '1'; delete process.env.FRONTEND_URL; delete process.env.APP_ACCESS_CODE;
  const app = require('../server');
  const servidor = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const pagina = await fetch(base, { redirect: 'manual' });
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /mesaEditor\.js/);
    const script = await fetch(`${base}/contentModel.js`);
    assert.match(await script.text(), /textoParaAuditoria/);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const privado = await fetch(`${base}/api/sync/status`);
    assert.equal(privado.status, 503);
    assert.equal((await privado.json()).code, 'ACCESS_NOT_CONFIGURED');
  } finally {
    await new Promise(resolve => servidor.close(resolve));
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
