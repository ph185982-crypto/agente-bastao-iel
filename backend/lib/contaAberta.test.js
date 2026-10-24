// "A Conta Aberta": contas em código, anonimização, números que fecham, isca com link. node --test backend/lib/contaAberta.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const A = require('./armazem');
const CA = require('./contaAberta');
const L = require('./leadMagnets');
const G = require('../../static/qualityGates');
const M = require('../../static/contentModel');

const base = { faturamento: 120000, comissao: 24000, frete: 9000, imposto: 7200, ads: 12000, outros: 55000, periodo: 'set/2026', canal: 'Shopee', categoria: 'moda', isca_id: 'calculadora_preco' };
const iscas = [{ id: 'calculadora_preco', nome: 'Calculadora de preço', palavra: 'PRECO', link: 'https://exemplo.test/calculadora' }, { id: 'raiox_dependencia', nome: 'Raio-X de Dependência', palavra: 'RAIOX', link: '' }];

test('percentuais e margem são calculados em código e arredondados a 1 casa', () => {
  const c = CA.calcular(base);
  assert.deepStrictEqual(c.percentuais, { comissao: 20, frete: 7.5, imposto: 6, ads: 10, outros: 45.8 });
  assert.strictEqual(c.total_custos, 107200);
  assert.strictEqual(c.sobra, 12800);
  assert.strictEqual(c.margem, 10.7);
});

test('números que não fecham NÃO viram prova: a mensagem diz as contas e como corrigir', () => {
  assert.throws(() => CA.calcular({ ...base, sobrou: 50000 }), (e) => e.status === 400 && /não fecham/.test(e.message) && /R\$ 12\.800/.test(e.message) && /R\$ 50\.000/.test(e.message));
  assert.doesNotThrow(() => CA.calcular({ ...base, sobrou: 12800 }), 'sobra informada igual à calculada passa');
  assert.doesNotThrow(() => CA.calcular({ ...base, sobrou: 12800.4 }), 'diferença de centavos é tolerada');
});

test('entrada inválida: faturamento, período, canal, custo negativo', () => {
  for (const ruim of [{ ...base, faturamento: 0 }, { ...base, faturamento: 'abc' }, { ...base, periodo: '' }, { ...base, canal: '' }, { ...base, frete: -5 }, { ...base, ads: 'x' }]) {
    assert.throws(() => CA.calcular(ruim), (e) => e.code === 'ENTRADA' && e.status === 400, JSON.stringify(ruim));
  }
});

test('anonimiza por padrão: sem autorização o nome não aparece em lugar nenhum do conteúdo', () => {
  const r = CA.criar({ ...base, cliente: 'Loja Segredo Ltda', cliente_autorizou: false }, { iscas });
  assert.strictEqual(r.resumo.identificado, false);
  assert.ok(r.avisos.some((a) => /omitido/.test(a)));
  assert.ok(!JSON.stringify(r.conteudo).includes('Segredo'), 'o nome não é nem guardado');
  assert.match(M.versaoAtiva(r.conteudo).legenda, /nome omitido/);
  const sem = CA.criar({ ...base, cliente: 'Loja Segredo Ltda' }, { iscas });
  assert.ok(!JSON.stringify(sem.conteudo).includes('Segredo'), 'cliente sem o campo de autorização também fica anônimo');
});

test('com autorização o nome entra; autorização sem nome continua anônima', () => {
  const ok = CA.criar({ ...base, cliente: 'Loja Aurora', cliente_autorizou: true }, { iscas });
  assert.strictEqual(ok.resumo.identificado, true);
  assert.match(M.versaoAtiva(ok.conteudo).slides[1].texto, /Loja Aurora vendeu/);
  const so = CA.criar({ ...base, cliente_autorizou: true }, { iscas });
  assert.strictEqual(so.resumo.identificado, false);
  assert.match(M.versaoAtiva(so.conteudo).slides[1].texto, /Loja de moda/);
});

test('o conteúdo passa pelas regras de revisão: só falta gerar a arte; afirmações vêm das regras, não escritas à mão', () => {
  const r = CA.criar(base, { iscas });
  const g = G.avaliar(r.conteudo, { conta: M.ACCOUNT_PIN });
  assert.deepStrictEqual(g.bloqueios.map((b) => b.id), ['arte_pendente']);
  assert.ok(r.conteudo.claims.every((k) => k.estado === 'sustentada'));
  assert.ok(r.conteudo.evidencias.every((e) => /não verificado de forma independente/.test(e.limitacoes)), 'a limitação fica registrada');
  assert.match(M.versaoAtiva(r.conteudo).legenda, /sem auditoria independente/);
  assert.match(M.versaoAtiva(r.conteudo).legenda, /não é promessa de resultado/);
});

test('editar um número depois quebra a revisão (número sem origem): ninguém troca valor sem passar pelas regras', () => {
  const r = CA.criar(base, { iscas });
  M.editarSlide(r.conteudo, 's3', { texto: 'Sobrou **25%** de tudo que entrou.' });
  const g = G.avaliar(r.conteudo, { conta: M.ACCOUNT_PIN });
  assert.ok(g.bloqueios.some((b) => ['numero_sem_origem', 'numero_sem_afirmacao', 'titulo_nao_auditado', 'texto_nao_auditado'].includes(b.id)));
});

test('chamada final só existe com link da isca; sem link aparece a pendência e não há CTA', () => {
  const com = CA.criar(base, { iscas });
  assert.match(M.versaoAtiva(com.conteudo).cta, /^Comenta PRECO que eu te mando: Calculadora de preço\.$/);
  assert.deepStrictEqual(com.pendencias, []);
  assert.strictEqual(M.versaoAtiva(com.conteudo).slides.at(-1).layout, 'encerramento');
  const semLink = CA.criar({ ...base, isca_id: 'raiox_dependencia' }, { iscas });
  assert.strictEqual(M.versaoAtiva(semLink.conteudo).cta, '');
  assert.match(semLink.pendencias[0].texto, /Falta o link/);
  assert.ok(!M.versaoAtiva(semLink.conteudo).slides.some((s) => s.layout === 'encerramento'));
  const nenhuma = CA.criar({ ...base, isca_id: undefined }, { iscas });
  assert.match(nenhuma.pendencias[0].texto, /Escolha uma isca/);
});

test('prejuízo gera aviso; custo zero não vira slide', () => {
  const p = CA.criar({ faturamento: 1000, comissao: 800, frete: 400, periodo: 'set/2026', canal: 'Shopee' }, { iscas });
  assert.ok(p.avisos.some((a) => /prejuízo/.test(a)));
  assert.strictEqual(p.resumo.sobra, -200);
  const v = M.versaoAtiva(CA.criar({ ...base, ads: 0, outros: 0 }, { iscas }).conteudo);
  assert.ok(!v.slides.some((s) => /Anúncios|Outros custos/.test(s.titulo || '')));
});

// ── iscas e DMs ──
test('iscas: palavra normalizada, link só https, sem duplicar; sem banco devolve o padrão', async () => {
  A._definir(A.memoria());
  assert.strictEqual((await L.ler()).length, 2);
  const arm = Object.assign(A.memoria(), { duravel: true }); A._definir(arm);
  const r = await L.salvar([{ id: 'Calc Preço!', nome: 'Calculadora', palavra: ' preço ', link: 'https://x.test/c' }]);
  assert.deepStrictEqual(r.iscas[0], { id: 'calcpreo', nome: 'Calculadora', palavra: 'PRECO', link: 'https://x.test/c' });
  assert.strictEqual((await L.ler())[0].palavra, 'PRECO');
  for (const ruim of [[{ id: 'a', nome: 'A', palavra: 'ab', link: '' }], [{ id: 'a', nome: 'A', palavra: 'ABC', link: 'javascript:alert(1)' }], [{ id: 'a', nome: 'A', palavra: 'ABC', link: 'http://x.test' }], [{ id: 'a', nome: 'A', palavra: 'ABC' }, { id: 'b', nome: 'B', palavra: 'abc' }], []]) {
    await assert.rejects(() => L.salvar(ruim), (e) => e.status === 400, JSON.stringify(ruim));
  }
});

test('DMs por palavra: manual, por semana, idempotente e validado (qualificadas ≤ total)', async () => {
  A._definir(Object.assign(A.memoria(), { duravel: true }));
  const agora = new Date('2026-10-23T12:00:00Z');
  assert.strictEqual(L.semanaDe(agora), '2026-W43');
  await L.registrarDms({ palavra: 'preco', dms: 12, qualificadas: 3 }, agora);
  const r = await L.registrarDms({ palavra: 'PRECO', dms: 15, qualificadas: 4 }, agora);
  assert.strictEqual(r.dms.length, 1, 'mesma semana e palavra substituem');
  assert.deepStrictEqual([r.dms[0].dms, r.dms[0].qualificadas], [15, 4]);
  await L.registrarDms({ palavra: 'RAIOX', dms: 2 }, agora);
  assert.strictEqual((await L.lerDms()).find((x) => x.palavra === 'RAIOX').qualificadas, null, 'não informado fica null, não zero');
  for (const ruim of [{ palavra: 'ab', dms: 1 }, { palavra: 'PRECO', dms: -1 }, { palavra: 'PRECO', dms: 5, qualificadas: 9 }, { palavra: 'PRECO', dms: 1.5 }]) {
    await assert.rejects(() => L.registrarDms(ruim, agora), (e) => e.status === 400, JSON.stringify(ruim));
  }
});

test('rota conta-aberta devolve o conteúdo pronto e erro 400 claro quando os números não fecham', async () => {
  const arm = Object.assign(A.memoria(), { duravel: true }); A._definir(arm);
  await L.salvar(iscas.map((x) => ({ ...x, link: x.link || 'https://x.test/raiox' })));
  for (const k of Object.keys(require.cache)) if (/backend[\\/]routes[\\/]content\.js$/.test(k)) delete require.cache[k];
  const app = express(); app.use(express.json()); app.use('/api/content', require('../routes/content'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api/content`;
  try {
    const ok = await (await fetch(`${url}/conta-aberta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: 'ca1', entrada: base }) })).json();
    assert.ok(ok.conteudo && ok.resumo.margem === 10.7);
    const mal = await fetch(`${url}/conta-aberta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: 'ca2', entrada: { ...base, sobrou: 1 } }) });
    assert.strictEqual(mal.status, 400);
    assert.match((await mal.json()).error, /não fecham/);
    const dm = await fetch(`${url}/dms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ palavra: 'PRECO', dms: 7 }) });
    assert.strictEqual(dm.status, 200);
    const get = await (await fetch(`${url}/iscas`)).json();
    assert.ok(get.iscas.length === 2 && get.dms.length === 1);
  } finally { srv.close(); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); }
});
