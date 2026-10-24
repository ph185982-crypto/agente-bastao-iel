// Mais ganchos com IA SIMULADA: o código filtra e ordena. node --test backend/lib/ganchos.test.js
const test = require('node:test');
const assert = require('node:assert');
const llmReal = require('./llmJson');
const { gerarGanchos } = require('./ganchos');

const claims = [
  { id: 'a1', texto: 'Em 2010 o salário mínimo era de R$ 510; em 2025 passou a R$ 1.518.' },
  { id: 'a2', texto: 'O aluguel subiu 9% em 12 meses.' },
];
const llm = (ganchos) => ({ ...llmReal, pedirJson: async () => ({ dados: { ganchos }, llm: { provider: 'simulado', model: 'teste' } }) });
const g = (texto, formula = 'numero_grande', claim_ids = ['a1']) => ({ formula, texto, claim_ids });

test('ordena por verificações e escolhe fórmulas diferentes nas três primeiras', async () => {
  const r = await gerarGanchos({ assunto: 'Salário mínimo', claims }, { llmJson: llm([
    g('Em 2010 o mínimo era R$ 510; hoje é R$ 1.518'),
    g('Quanto sobra do R$ 1.518 depois do aluguel?', 'quanto_sobra'),
    g('Aluguel sobe 9% e o salário não acompanha', 'contraintuitiva', ['a2']),
    g('Em 2010 o mínimo era R$ 510 e hoje R$ 1.518, mas o que mudou?', 'numero_grande'),
  ]) });
  assert.strictEqual(r.top.length, 3);
  assert.strictEqual(new Set(r.top.map((x) => x.formula)).size, 3, 'fórmulas diferentes');
  assert.ok(r.top.every((x) => x.checks.ok >= 3 && Array.isArray(x.claim_ids)));
  assert.ok(!('nota' in r.top[0]) && !('score' in r.top[0]), 'sem nota inventada');
  assert.match(r.aviso, /Não é previsão/);
});

test('descarta: cópia de exemplo, número que os fatos não têm, número sem fato, repetido e post recente', async () => {
  const r = await gerarGanchos({ assunto: 'Salário mínimo', claims, recentes: ['Aluguel sobe 9% e pesa no bolso\nlegenda'] }, { llmJson: llm([
    g('Seus R$ 100 de 1994 valem R$ 11,19 hoje.', 'numero_grande', []),
    g('O mínimo era R$ 700 em 2010', 'numero_grande'),
    g('O mínimo subiu 300% em 15 anos', 'numero_grande', []),
    g('Em 2010 o mínimo era R$ 510; hoje é R$ 1.518'),
    g('Em 2010 o mínimo era R$ 510; hoje é R$ 1.518!'),
    g('Aluguel sobe 9% e pesa no bolso', 'quanto_sobra', ['a2']),
  ]) });
  const motivos = r.descartados.map((d) => d.motivo).join(' | ');
  assert.match(motivos, /exemplo do playbook/);
  assert.match(motivos, /número que os fatos ligados não têm/);
  assert.match(motivos, /sem apontar o fato/);
  assert.match(motivos, /Repete outro candidato/);
  assert.match(motivos, /post já publicado/);
  assert.strictEqual(r.top.length + r.outros.length, 1, 'sobrou só o gancho bom e original');
});

test('claim_ids inexistentes são descartados e a fórmula é a detectada pelo código', async () => {
  const r = await gerarGanchos({ assunto: 'Aluguel', claims }, { llmJson: llm([g('Aluguel sobe 9%: quanto sobra do seu salário?', 'contraintuitiva', ['zzz', 'a2'])]) });
  assert.deepStrictEqual(r.top[0].claim_ids, ['a2']);
  assert.strictEqual(r.top[0].formula, 'quanto_sobra');
  assert.strictEqual(r.top[0].formula_pedida, 'contraintuitiva');
});

test('sem fato sustentado: erro claro em vez de gancho inventado', async () => {
  await assert.rejects(() => gerarGanchos({ assunto: 'x', claims: [] }, { llmJson: llm([]) }), (e) => e.code === 'ENTRADA' && /Confira os fatos/.test(e.message));
});

test('o prompt entrega os fatos como dados, as fórmulas e os exemplos proibidos', async () => {
  let enviado = '';
  await gerarGanchos({ assunto: 'Aluguel', claims }, { llmJson: { ...llmReal, pedirJson: async (p) => { enviado = p.usuario; return { dados: { ganchos: [] }, llm: {} }; } } });
  assert.match(enviado, /<<<DADOS FATOS_CONFERIDOS>>>/);
  assert.match(enviado, /numero_grande = Número grande/);
  assert.match(enviado, /Seus R\$ 100 de 1994/);
});
