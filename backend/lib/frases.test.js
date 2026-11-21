// Frases famosas: marcação da palavra-chave sem mudar o texto e produção de posts de 1 imagem.
// node --test backend/lib/frases.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const F = require('./frases');
const M = require('../../static/contentModel');
const { ACCOUNT } = require('./account');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const BANCO = [
  { texto: 'Faça o que puder, com o que tiver, onde estiver.', autor: 'Theodore Roosevelt', fonte: 'https://pt.wikiquote.org/wiki/Theodore_Roosevelt' },
  { texto: 'A melhor maneira de começar é parar de falar e começar a fazer.', autor: 'Walt Disney', fonte: 'https://pt.wikiquote.org/wiki/Walt_Disney' },
  { texto: 'Pessoas sem vícios têm poucas virtudes.', autor: 'Abraham Lincoln', fonte: 'https://pt.wikiquote.org/wiki/Abraham_Lincoln' },
  { texto: 'A guerra é a continuação da política por outros meios.', autor: 'X', fonte: 'https://pt.wikiquote.org/wiki/X' },
];

test('marcar: só insere ** em volta do trecho existente; recusa pedaço de palavra e trecho inexistente', () => {
  assert.strictEqual(F.marcar('A melhor maneira de começar é parar de falar e começar a fazer.', 'fazer'), 'A melhor maneira de começar é parar de falar e começar a **fazer.**');
  assert.strictEqual(F.marcar('Faça o que puder', 'aça'), null);
  assert.strictEqual(F.marcar('parar de falar e começar a fazer', 'parar de falar e começar'), null, 'no máximo 3 palavras');
  assert.strictEqual(F.marcar('Faça o que puder', 'sonhar'), null);
  assert.strictEqual(F.destaquePadrao('Pessoas sem vícios têm poucas virtudes.'), 'virtudes');
  assert.ok(F.FORA.test('A guerra é a continuação da política'));
});

test('produzir: frases famosas do banco, texto intacto com autor, fundo alternando preto e branco, sem repetir', async () => {
  novo();
  const ia = async ({ usuario }) => {
    const linhas = usuario.split('\n');
    const i = (t) => linhas.findIndex((l) => l.includes(t));
    return { dados: { itens: [{ i: i('Walt Disney'), nota: 9, destaque: 'fazer' }, { i: i('Roosevelt'), nota: 9, destaque: 'onde estiver' }, { i: i('Lincoln'), nota: 5, destaque: 'vícios' }] } };
  };
  const r = await F.produzir(5, { deps: { ia, banco: BANCO } });
  assert.strictEqual(r.criados.length, 2, 'nota baixa e tema de guerra/política ficam de fora');
  const docs = await Promise.all(r.criados.map(async (x) => (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, x.id)).doc));
  const vs = docs.map((c) => M.versaoAtiva(c));
  assert.deepStrictEqual(vs.map((v) => v.slides[0].layout), ['frase_classica', 'frase_classica']);
  assert.deepStrictEqual(vs.map((v) => v.slides[0].dados.fundo), ['preto', 'branco']);
  assert.ok(vs.every((v) => /\*\*[^*]+\*\*/.test(v.slides[0].texto)));
  assert.strictEqual(vs[0].slides[0].texto.replace(/\*\*/g, ''), 'A melhor maneira de começar é parar de falar e começar a fazer.', 'o texto da frase não muda');
  assert.match(vs[0].legenda, /— Walt Disney/); assert.match(vs[0].legenda, /reposta nos seus stories/);
  assert.ok(docs[0].arte.renders[0].elementos.includes('palavra_chave') && docs[0].arte.renders[0].elementos.includes('assinatura_pedro'));
  assert.ok(docs[1].arte.renders[0].elementos.includes('fundo_branco'));
  const r2 = await F.produzir(5, { deps: { ia, banco: BANCO } });
  assert.strictEqual(r2.criados.length, 0, 'as já usadas não voltam');
});

test('produzir sem IA: sorteia e destaca a palavra mais longa', async () => {
  novo();
  const r = await F.produzir(1, { deps: { ia: async () => { throw new Error('fora do ar'); }, banco: BANCO.slice(0, 1) } });
  assert.strictEqual(r.criados.length, 1);
  const c = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, r.criados[0].id)).doc;
  assert.match(M.versaoAtiva(c).slides[0].texto, /\*\*estiver\.\*\*/);
});

test('post de frase passa nos portões de publicação (a citação da legenda tem a fonte do Wikiquote)', async () => {
  novo();
  const r = await F.produzir(1, { deps: { ia: async () => ({ dados: { itens: [{ i: 0, nota: 9, destaque: 'fazer' }] } }), banco: [BANCO[1]] } });
  const c = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, r.criados[0].id)).doc;
  const QG = require('../../static/qualityGates.js');
  const k = M.clone(c); k.claims.forEach((x) => { x.revisao = { ...(x.revisao || {}), confirmada_por_pedro: true }; });
  assert.deepStrictEqual(QG.avaliar(k, { conta: M.ACCOUNT_PIN }).bloqueios.map((b) => b.codigo || b.id), []);
  assert.strictEqual(c.fonte_principal.url, 'https://pt.wikiquote.org/wiki/Walt_Disney');
});
