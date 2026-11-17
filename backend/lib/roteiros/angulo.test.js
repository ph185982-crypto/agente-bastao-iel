// Motor Magnético, fase 1: ângulo + laboratório de ganchos (só elimina; o resto é do modelo).
// node --test backend/lib/roteiros/angulo.test.js
const test = require('node:test');
const assert = require('node:assert');
const A = require('./angulo');
const R = require('./index');

const PAUTA = { texto: 'A margem de lucro do varejo caiu para 8% em 2025.', tema: 'Margem' };
const regras = { abertura: /^(oi|hoje (eu )?(vou|vamos)|você sabia)\b/i, politico: /\b(lula|bolsonaro|pt\b|elei[çc][aã]o)/i, numerosDe: (t) => new Set((String(t).match(/\d+/g) || [])), vicio: (t) => /\bjornada\b/i.test(t) };
const ANG = (ganchos, o = {}) => A.normalizarAngulo({ crenca: 'desconto ajuda a vender', virada: 'desconto ensina o cliente a esperar o preço cair', inimigo: 'o hábito do desconto', em_jogo: 'a margem', emocao: 'alivio', consciencia: 'sabe_do_problema', objecao: 'se eu não der, ele compra do vizinho', ganchos, ...o });

test('normalizar: emoção e consciência inválidas caem no padrão; tipo desconhecido vira null', () => {
  const a = A.normalizarAngulo({ emocao: 'euforia', consciencia: 'x', ganchos: [{ tipo: 'holograma', texto: 'Desconto ensina o cliente a esperar.' }, { tipo: 'erro', texto: '' }] });
  assert.strictEqual(a.emocao, null); assert.strictEqual(a.consciencia, 'sabe_do_problema');
  assert.strictEqual(a.ganchos.length, 1); assert.strictEqual(a.ganchos[0].tipo, null);
});

test('o código só elimina: longo, saudação, político, vício, número fora da pauta, sem ligação com a virada', () => {
  const a = ANG([
    { tipo: 'contraste', texto: 'Desconto ensina o cliente a esperar a sua próxima venda inteira sem pagar nada.' },     // 14 palavras
    { tipo: 'erro', texto: 'Hoje eu vou falar de desconto e cliente.' },
    { tipo: 'erro', texto: 'Desconto na eleição ensina o cliente.' },
    { tipo: 'cena', texto: 'Sua jornada de desconto ensina o cliente.' },
    { tipo: 'numero', texto: 'Desconto de 30% ensina o cliente a esperar.' },                                              // 30 não está na pauta
    { tipo: 'pergunta', texto: 'Você já viu o fornecedor sumir sem motivo?' },                                                  // nada em comum com a virada
    { tipo: 'numero', texto: 'Desconto de 8% ensina o cliente a esperar.' },                                                 // 8 está na pauta
  ]);
  const m = A.montar(a, { pauta: PAUTA, regras });
  assert.deepStrictEqual(m.ganchos.map((g) => g.texto), ['Desconto de 8% ensina o cliente a esperar.']);
  assert.strictEqual(m.gancho.tipo, 'numero'); assert.strictEqual(m.eliminados.length, 6);
});

test('ordem do modelo vale: o 1º que sobra é o gancho, os 2 seguintes são reservas; nenhum sobrando = sem gancho', () => {
  const a = ANG([{ tipo: 'erro', texto: 'Desconto ensina o cliente a esperar.' }, { tipo: 'contraste', texto: 'O cliente aprende a esperar o desconto.' }, { tipo: 'cena', texto: 'Você dá desconto, ele espera mais desconto.' }, { tipo: 'identidade', texto: 'Se você dá desconto, o cliente espera.' }]);
  const m = A.montar(a, { pauta: PAUTA, regras });
  assert.strictEqual(m.gancho.texto, 'Desconto ensina o cliente a esperar.'); assert.strictEqual(m.reservas.length, 2);
  const vazio = A.montar(ANG([{ tipo: 'erro', texto: 'Oi pessoal.' }]), { pauta: PAUTA, regras });
  assert.strictEqual(vazio.gancho, null); assert.strictEqual(A.blocoParaRoteirista(vazio), '');
});

test('ângulo repetido: mesmo inimigo + mesma emoção nos últimos 7; indignação só 1 em 3', () => {
  const a = ANG([], { inimigo: 'o hábito do desconto', emocao: 'alivio' });
  assert.strictEqual(A.repetido(a, [{ inimigo: 'hábito de dar desconto', emocao: 'alivio' }]), true);
  assert.strictEqual(A.repetido(a, [{ inimigo: 'hábito de dar desconto', emocao: 'medo_de_perder' }]), false);
  assert.strictEqual(A.repetido(a, []), false);
  const ind = ANG([], { inimigo: 'a nota fiscal', emocao: 'indignacao' });
  assert.strictEqual(A.repetido(ind, [{ inimigo: 'taxa', emocao: 'indignacao' }, { inimigo: 'multa', emocao: 'indignacao' }]), true);
  assert.strictEqual(A.repetido(ind, [{ inimigo: 'taxa', emocao: 'indignacao' }, { inimigo: 'multa', emocao: 'alivio' }]), false);
});

test('bloco do roteirista traz gancho palavra por palavra, objeção e as regras novas; etiquetas guardam o tipo do gancho', () => {
  const m = A.montar(ANG([{ tipo: 'erro', texto: 'Desconto ensina o cliente a esperar.' }]), { pauta: PAUTA, regras });
  const b = A.blocoParaRoteirista(m);
  assert.match(b, /GANCHO ESCOLHIDO \(use palavra por palavra[^"]*"Desconto ensina o cliente a esperar\."/);
  assert.match(b, /se eu não der, ele compra do vizinho/); assert.match(b, /frase de print/); assert.match(b, /CTA de até 6 palavras/);
  assert.deepStrictEqual(A.etiquetas(m), { tipo_gancho: 'erro', emocao: 'alivio', inimigo: 'o hábito do desconto', consciencia: 'sabe_do_problema', reservas: [] });
  assert.strictEqual(A.etiquetas(null), null);
});

test('prompt do roteirista leva o ângulo; prompt da banca tem os três papéis e pede a frase mais fraca com reescrita', () => {
  const m = A.montar(ANG([{ tipo: 'erro', texto: 'Desconto ensina o cliente a esperar.' }]), { pauta: PAUTA, regras });
  assert.match(R.promptRoteirista({ formato: 'F1', angulo: m }), /ÂNGULO DESTE ROTEIRO/);
  assert.doesNotMatch(R.promptRoteirista({ formato: 'F1' }), /ÂNGULO DESTE ROTEIRO/);
  const f = R.promptFiscal('ambos');
  assert.match(f, /COPYWRITER DE RESPOSTA DIRETA/); assert.match(f, /DIRETOR DE RETENÇÃO/); assert.match(f, /TOM E MARCA/); assert.match(f, /frase MAIS FRACA/);
});

test('fiscal do código: com ângulo, payoff sem nenhuma palavra do gancho perde nota; CTA longo demais também', () => {
  const base = { gancho: 'Desconto ensina o cliente a esperar.', tela_gancho: 'DESCONTO ENSINA', blocos: [{ fala: 'a', tela: 'x' }, { fala: 'b', tela: 'y' }], payoff: 'Segure o preço e entregue mais valor.', cta: 'Manda.', visual: 'v', foreshadow: 'f' };
  const sem = R.fiscalCodigo(base, { texto: '' }, { laco: true });
  assert.ok(sem.problemas.some((p) => p.criterio === 12), 'payoff não volta ao gancho');
  assert.ok(!R.fiscalCodigo(base, { texto: '' }, { laco: false }).problemas.some((p) => p.criterio === 12), 'sem ângulo a regra não vale');
  assert.ok(!R.fiscalCodigo({ ...base, payoff: 'Assim o cliente não aprende a esperar o desconto.' }, { texto: '' }, { laco: true }).problemas.some((p) => p.criterio === 12));
  const longo = R.fiscalCodigo({ ...base, cta: 'Manda esse vídeo agora mesmo para todo mundo que você conhece e que vive dando desconto.' }, { texto: '' });
  assert.ok(longo.problemas.some((p) => p.criterio === 13));
});
