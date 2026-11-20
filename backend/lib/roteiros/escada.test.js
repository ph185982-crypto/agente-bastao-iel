const test = require('node:test');
const assert = require('node:assert');
const E = require('./escada');
const R = require('./index');

test('escada: começa na audiência geral e sobe sozinha pelas semanas', () => {
  delete process.env.ROTEIROS_DEGRAU;
  assert.strictEqual(E.degrauAtual(Date.parse('2026-11-21T12:00:00Z')), 1);
  assert.strictEqual(E.degrauAtual(Date.parse('2026-12-20T12:00:00Z')), 2);
  assert.strictEqual(E.degrauAtual(Date.parse('2027-01-10T12:00:00Z')), 3);
  assert.strictEqual(E.degrauAtual(Date.parse('2027-03-01T12:00:00Z')), 4);
  process.env.ROTEIROS_DEGRAU = '3'; assert.strictEqual(E.degrauAtual(Date.parse('2026-11-21T12:00:00Z')), 3); delete process.env.ROTEIROS_DEGRAU;
});

test('escada: roteirista e fiscais recebem o público do degrau, sem o público fixo de empresário', () => {
  const p = R.promptRoteirista({ formato: 'F1' });
  assert.match(p, /ESCADA DE POSICIONAMENTO: degrau \d de 4/);
  assert.doesNotMatch(p, /Público: dono de pequena empresa, MEI/);
  assert.match(R.promptFiscal('ambos'), /ESCADA DE POSICIONAMENTO/);
});
