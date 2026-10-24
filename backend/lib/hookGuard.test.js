// Guarda de ganchos: não copia exemplo do playbook nem post publicado; checks objetivos, sem nota.
// node --test backend/lib/hookGuard.test.js
const test = require('node:test');
const assert = require('node:assert');
const H = require('../../static/hookGuard');
const PB = require('../../static/viralPlaybook');

test('todo exemplo do playbook é recusado, igual ou com pequenas variações', () => {
  for (const g of Object.values(PB.GANCHOS)) {
    assert.strictEqual(H.verificar(g.exemplo).ok, false, g.exemplo);
    assert.strictEqual(H.verificar(g.exemplo.toUpperCase().replace(/\./g, '!')).ok, false, `${g.exemplo} (caixa e pontuação)`);
    assert.strictEqual(H.verificar(`${g.exemplo} Veja por quê`).ok, false, `${g.exemplo} (com sobra no fim)`);
  }
});

test('os dois ganchos publicados sem resultado não voltam, mesmo reescritos de leve', () => {
  assert.strictEqual(H.verificar('R$100 de 1994 só valem R$11,19 hoje').ok, false);
  assert.strictEqual(H.verificar('R$ 100 de 1994 só valem R$ 11,19 hoje.').ok, false);
  assert.strictEqual(H.verificar('Promoção de 50% quase nunca traz economia real.').ok, false);
});

test('mesmo mecanismo com tema, ano e número diferentes é permitido (o que se copia é o texto, não a ideia)', () => {
  assert.strictEqual(H.verificar('R$ 100 de 1998 valem R$ 31 hoje, segundo o IPCA').ok, true);
  assert.strictEqual(H.verificar('Fim da escala 6x1: quanto sobra no seu bolso').ok, true);
});

test('posts já publicados entram na comparação (strings ou { texto, origem })', () => {
  const contra = ['Seu salário subiu 3 vezes e o mercado 5', { texto: 'Aluguel sobe mais que salário há quatro anos', origem: 'post de 12/10' }];
  const a = H.verificar('Seu salário subiu três vezes e o mercado 5', { contra });
  assert.strictEqual(a.ok, false);
  const b = H.verificar('Aluguel sobe mais que o salário há quatro anos', { contra });
  assert.strictEqual(b.ok, false);
  assert.match(b.motivo, /post de 12\/10/);
  assert.strictEqual(H.verificar('Imposto no preço do café: quanto fica com o governo', { contra }).ok, true);
});

test('checks objetivos: sem nota, cada item diz sim ou não', () => {
  const bom = H.checks('Fim da escala 6x1: quanto sobra no seu bolso');
  assert.strictEqual(bom.ok, bom.total);
  assert.ok(bom.formula);
  assert.ok(!('nota' in bom) && !('score' in bom));
  const ruim = H.checks('Como adaptar sua operação para manter a produtividade diante das novas regras de trabalho no país?');
  const porId = Object.fromEntries(ruim.itens.map((i) => [i.id, i.ok]));
  assert.strictEqual(porId.curto, false);
  assert.strictEqual(porId.sem_cliche, false);
  const cliche = H.checks('Descubra o segredo do sucesso nos negócios');
  assert.strictEqual(cliche.itens.find((i) => i.id === 'sem_cliche').ok, false);
});

test('fórmulas nomeadas são reconhecidas pelo formato', () => {
  assert.strictEqual(H.detectarFormula('Quanto sobra do seu salário depois do imposto'), 'quanto_sobra');
  assert.strictEqual(H.detectarFormula('Em 2010 o mínimo era R$ 510; hoje é R$ 1.518'), 'numero_grande');
  assert.strictEqual(H.detectarFormula('Seu aluguel vai subir quanto este ano?'), 'pergunta_que_doi');
  assert.strictEqual(H.detectarFormula('Promoção quase nunca é desconto'), 'contraintuitiva');
  assert.strictEqual(H.detectarFormula('Palavras soltas sem nada'), null);
});

test('semelhança é simétrica, entre 0 e 1, e vazio nunca "copia"', () => {
  assert.strictEqual(H.similaridade('', 'qualquer coisa'), 0);
  const a = 'O mercado ficou mais caro'; const b = 'Mercado mais caro que ontem';
  assert.strictEqual(H.similaridade(a, b), H.similaridade(b, a));
  assert.ok(H.similaridade(a, b) > 0 && H.similaridade(a, b) < 1);
});
