// Temas usados e estratégia: sem repetir assunto em 21 dias, contando posts antigos do Instagram.
// node --test backend/lib/temas.test.js
const test = require('node:test');
const assert = require('node:assert');
const A = require('./armazem');
const T = require('./temas');
const S = require('./estrategia');

const AGORA = Date.parse('2026-10-23T12:00:00Z');
const dia = (n) => new Date(AGORA - n * 86400000).toISOString();

test('mesmo assunto com palavras diferentes é reconhecido; assuntos diferentes não', () => {
  assert.ok(T.mesmoTema('Câmara aprova teto do MEI de R$ 140 mil', 'Aumentar o teto do MEI é um avanço'));
  assert.ok(T.mesmoTema('Fim da escala 6x1: o que muda no seu bolso', 'Reduzir a jornada de trabalho e o fim da escala 6x1'));
  assert.ok(T.mesmoTema('Petrobras pode subir o diesel em até 50%', 'Diesel: Petrobras avalia reajuste'));
  assert.ok(!T.mesmoTema('Selic cai para 13,75%', 'Teto do MEI sobe para R$ 140 mil'));
  assert.ok(!T.mesmoTema('Mercado Livre muda tarifas para vendedores', 'Shopee muda comissão para vendedores'), 'verbo genérico não faz tema');
  assert.ok(!T.mesmoTema('', 'qualquer coisa aqui'));
});

test('janela de dias: dentro bloqueia, fora libera; informa há quantos dias', () => {
  const log = [{ id: 'a', tema: 'Teto do MEI sobe para R$ 140 mil', origem: 'instagram', em: dia(10) }, { id: 'b', tema: 'Fim da escala 6x1 em debate', origem: 'ferramenta', em: dia(40) }];
  const r = T.repetido('Senado aprova o teto do MEI', log, { dias: 21, agora: AGORA });
  assert.ok(r && r.ha_dias === 10 && r.origem === 'instagram');
  assert.strictEqual(T.repetido('Escala 6x1 volta à pauta', log, { dias: 21, agora: AGORA }), null, 'há 40 dias já pode voltar');
  assert.ok(T.repetido('Escala 6x1 volta à pauta', log, { dias: 60, agora: AGORA }), 'com janela maior, bloqueia');
});

test('registro idempotente; posts do Instagram viram temas e a ferramenta é marcada', async () => {
  const arm = Object.assign(A.memoria(), { duravel: true });
  A._definir(arm);
  await T.registrar('Teto do MEI sobe para R$ 140 mil', { origem: 'ferramenta', id: 'c1', em: dia(1) });
  await T.registrar('Teto do MEI sobe para R$ 140 mil', { origem: 'ferramenta', id: 'c1', em: dia(1) });
  assert.strictEqual((await T.ler()).length, 1);
  await T.semearDoInstagram([
    { id: 'm1', legenda: 'Prometer folga com o dinheiro dos outros é fácil. Quero ver explicar a conta.', publicado_em: dia(12), da_ferramenta: false },
    { id: 'm2', legenda: 'curto', publicado_em: dia(3) },
    { id: 'm3', legenda: 'Diesel pode subir 50% se os subsídios acabarem. Salve este post.', publicado_em: dia(2), da_ferramenta: true },
  ]);
  let log = await T.ler();
  assert.strictEqual(log.length, 3, 'legenda curta demais não vira tema');
  assert.strictEqual(log.find((e) => e.id === 'ig:m3').origem, 'ferramenta');
  await T.semearDoInstagram([{ id: 'm1', legenda: 'Prometer folga com o dinheiro dos outros é fácil. Quero ver explicar a conta.', publicado_em: dia(12) }]);
  log = await T.ler();
  assert.strictEqual(log.filter((e) => e.id.startsWith('ig:')).length, 1, 'semear de novo substitui, não duplica');
  assert.ok(log.some((e) => e.id === 'c1'), 'o que a ferramenta registrou não é apagado');
});

test('sem banco: nada quebra e nada é inventado', async () => {
  A._definir(A.memoria());
  assert.deepStrictEqual(await T.ler(), []);
  assert.strictEqual(await T.registrar('Qualquer tema longo o bastante', {}), false);
});

test('estratégia: padrão neutro, validação estrita e persistência', async () => {
  const arm = Object.assign(A.memoria(), { duravel: true });
  A._definir(arm);
  const p = await S.ler();
  assert.deepStrictEqual([p.modo_politico, p.dias_sem_repetir, p.min_posts_por_grupo, p.temas_bloqueados.length], ['allowed', 21, 5, 0]);
  const n = await S.salvar({ modo_politico: 'allowed', temas_bloqueados: ['  Bets ', 'bets', 'ab', 'Crime'], dias_sem_repetir: 14 });
  assert.strictEqual(n.modo_politico, 'allowed');
  assert.deepStrictEqual(n.temas_bloqueados, ['bets', 'crime'], 'normaliza, remove repetidos e itens curtos demais');
  assert.strictEqual((await S.ler()).dias_sem_repetir, 14);
  for (const ruim of [{ modo_politico: 'qualquer' }, { dias_sem_repetir: 0 }, { dias_sem_repetir: 91 }, { min_posts_por_grupo: 2 }, { temas_bloqueados: 'x' }]) {
    await assert.rejects(() => S.salvar(ruim), (e) => e.status === 400, JSON.stringify(ruim));
  }
  assert.strictEqual((await S.ler()).modo_politico, 'allowed', 'entrada inválida não altera o que já estava salvo');
});
