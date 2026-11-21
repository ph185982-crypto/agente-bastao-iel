// Banco de frases famosas (Wikiquote): só a seção "Verificadas" e crescimento aos poucos.
// node --test backend/lib/citacoes.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const C = require('./citacoes');
const { ACCOUNT } = require('./account');

const WIKI = `{{Info}}
== Citações ==
=== Verificadas ===
* "Do you want to sell sugared water or change the world?"
:- '' Tradução: "Você quer vender água com açúcar ou quer uma chance de mudar o mundo?"''
* "Faça o que puder, com o que tiver, onde estiver."
* "Curta."
* "If you don't know jewelry, know the jeweler."
=== Atribuídas ===
* "Esta frase é só atribuída e não pode entrar no banco."`;

test('extrair: só Verificadas, tradução quando existe, sem inglês sem tradução e sem frase curta', () => {
  assert.deepStrictEqual(C.extrair(WIKI, 'Fulano').map((q) => q.texto), ['Você quer vender água com açúcar ou quer uma chance de mudar o mundo?', 'Faça o que puder, com o que tiver, onde estiver.']);
  assert.deepStrictEqual(C.extrair('sem seção', 'X'), []);
});

test('crescer: lê poucos autores por vez, guarda no banco e para no primeiro 429', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const pedidos = [];
  const fetcher = async (url) => {
    const autor = new URL(url).searchParams.get('page'); pedidos.push(autor);
    if (autor === 'C') return { status: 429, ok: false };
    return { status: 200, ok: true, json: async () => ({ parse: { wikitext: WIKI.replace(/Faça o que puder/, `Faça o que puder, ${autor}`) } }) };
  };
  const r = await C.crescer({ max: 5, pausaMs: 0, deps: { fetcher, autores: ['A', 'B', 'C', 'D'], semente: [] } });
  assert.deepStrictEqual(pedidos, ['A', 'B', 'C']);
  assert.deepStrictEqual([r.lidos, r.novas, r.faltam], [2, 4, 2]);
  const todas = await C.todas({ deps: { semente: [{ texto: 'Semente qualquer com tamanho suficiente.', autor: 'S' }] } });
  assert.strictEqual(todas.length, 4, 'semente + as 3 únicas lidas (a tradução se repete entre A e B)');
});
