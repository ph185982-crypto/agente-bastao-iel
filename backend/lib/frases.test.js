// Frases do Pedro: fiscal em código e produção de posts de 1 imagem.
// node --test backend/lib/frases.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const F = require('./frases');
const { ACCOUNT } = require('./account');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));

test('fiscal: barra clichê de coach, cara de IA, tamanho, emoji/hashtag, nota baixa e frase parecida', () => {
  const r = F.fiscal([
    { frase: 'O boleto não espera você ficar motivado pra vencer.', nota: 9, tema: 'dinheiro', fundo: 'city night lights' },
    { frase: 'Saia da zona de conforto e vença hoje mesmo.', nota: 9 },
    { frase: 'O problema é que ninguém te ensinou a cobrar pelo que faz.', nota: 9 },
    { frase: 'Vende.', nota: 9 },
    { frase: 'Cliente novo chega quando você aparece todo dia #foco', nota: 9 },
    { frase: 'Loja vazia na segunda ensina mais que curso caro.', nota: 6 },
    { frase: 'O boleto não espera você ficar motivado.', nota: 9 },
    { frase: 'Quem cobra barato pra fechar vai trabalhar o dobro pra pagar as contas.', nota: 8.5 },
  ], ['Quem cobra barato pra fechar trabalha o dobro pra pagar as contas.']);
  assert.deepStrictEqual(r.ok.map((x) => x.frase), ['O boleto não espera você ficar motivado pra vencer.']);
  assert.deepStrictEqual(r.ok[0].fundo, 'city night lights');
  assert.deepStrictEqual(r.barradas.map((x) => x.motivo.split(' (')[0]), ['clichê de coach', 'cara de IA', 'curta demais', 'tem hashtag, @, link ou emoji', 'nota 6 abaixo de 8', 'parecida com uma frase já feita', 'parecida com uma frase já feita']);
});

test('produzir: cada frase aprovada vira um post de 1 imagem na fila de aprovação, com legenda para repostar e sem crédito', async () => {
  novo();
  const ia = async ({ usuario }) => ({ dados: { frases: [
    { frase: 'Ninguém vê o seu esforço até o dia em que o resultado aparece na conta.', nota: 9, tema: 'disciplina', fundo: 'empty road sunrise' },
    { frase: 'Cliente não compra produto, compra a certeza de que vai dar certo.', nota: 9, tema: 'vender', fundo: 'coffee desk morning' },
    { frase: 'Acredite nos seus sonhos e nunca desista.', nota: 9 },
  ] }, llm: { model: 'teste' }, usuario });
  const r = await F.produzir(5, { deps: { ia, formato: { pexelsKey: '' } } });
  assert.strictEqual(r.criados.length, 2); assert.strictEqual(r.barradas.length, 1);
  const c = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, r.criados[0].id)).doc;
  assert.strictEqual(c.status, 'em_revisao');
  const v = require('../../static/contentModel').versaoAtiva(c);
  assert.strictEqual(v.slides.length, 1); assert.strictEqual(v.slides[0].layout, 'papel_frase');
  assert.match(v.legenda, /reposta nos seus stories/); assert.doesNotMatch(v.legenda, /Fotos?:|Pexels/);
  assert.ok(c.arte.renders[0].elementos.includes('degrade_codigo'), 'sem chave do Pexels: degradê, tela de frase (não capa)');
  assert.strictEqual(c.frase.tema, 'disciplina');
  // histórico guardado: a mesma frase não sai de novo
  const hist = (await arm.armazem().config.obter(ACCOUNT.ig_id)).frases_historico;
  assert.strictEqual(hist.length, 2);
  const r2 = await F.produzir(5, { deps: { ia, formato: { pexelsKey: '' } } });
  assert.strictEqual(r2.criados.length, 0);
});
