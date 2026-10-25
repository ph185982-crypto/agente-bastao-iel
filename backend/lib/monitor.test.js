// Monitor de notícias em alta: o que alerta, o que cria, o que NUNCA faz. node --test backend/lib/monitor.test.js
const test = require('node:test');
const assert = require('node:assert');
const A = require('./armazem');
const E = require('./estrategia');
const Mon = require('./monitor');

const AGORA = Date.parse('2026-10-25T15:00:00Z');
const h = (n) => new Date(AGORA - n * 3600000).toISOString();
const pauta = (id, titulo, veiculos, horas, extra = {}) => ({ id, titulo, resumo: 'r', veiculos, publicada_em: h(horas), fontes: [{ url: `https://x.test/${id}`, origem: veiculos[0], publicada_em: h(horas) }], prioridade: 70, mecanismo: 'numero_chocante', por_que_enviaria: 'manda', ...extra });
let arm; let criados; let kicks; let avisos;
test.beforeEach(async () => {
  arm = Object.assign(A.memoria(), { duravel: true }); A._definir(arm);
  criados = []; kicks = []; avisos = [];
});
const deps = (pautas, extra = {}) => ({
  agora: AGORA, temIA: () => true,
  descobrir: async () => ({ pautas, descartadas: [{ id: 'd' }], ia: { usada: true } }),
  criar: async (o) => { criados.push(o); return { id: `st_${criados.length}`, studio: { estado: 'gerando' } }; },
  kick: async (c) => { kicks.push(c.id); },
  notificar: async (o) => { avisos.push(o); return { enviadas: 1 }; },
  ...extra,
});
const ligar = (monitor = {}) => E.salvar({ monitor: { ativo: true, ...monitor } });

test('desligado por padrão: não lê nem cria nada, e diz por quê', async () => {
  const r = await Mon.tick({ deps: deps([pauta('a', 'Teto do MEI sobe', ['G1', 'Folha', 'UOL', 'CNN'], 2)]) });
  assert.strictEqual(r.executou, false);
  assert.match(r.motivo, /desligado/);
  assert.strictEqual(criados.length, 0);
  assert.strictEqual(avisos.length, 0);
  assert.strictEqual((await E.ler()).monitor.ativo, false);
});

test('em alta = vários veículos na janela: alerta, cria o roteiro (roteiro_primeiro) e manda UMA notificação', async () => {
  await ligar();
  const r = await Mon.tick({ deps: deps([
    pauta('a', 'Senado aprova teto do MEI de R$ 140 mil', ['G1', 'Folha', 'UOL', 'CNN'], 2),
    pauta('b', 'Aluguel sobe 9% em 12 meses', ['G1', 'Folha'], 1),            // só 2 veículos: não está em alta
    pauta('c', 'Imposto de importação muda de novo', ['G1', 'Folha', 'UOL'], 30), // fora da janela de 12 h
    pauta('d', 'Diesel sobe 5% nas bombas', ['G1', 'Folha', 'UOL'], 3),
  ]) });
  assert.strictEqual(r.executou, true);
  assert.deepStrictEqual(r.alertas.map((x) => x.titulo), ['Senado aprova teto do MEI de R$ 140 mil', 'Diesel sobe 5% nas bombas']);
  assert.strictEqual(criados.length, 2);
  assert.ok(criados.every((o) => o.roteiro_primeiro === true && o.formato === 'carrossel' && /^mon:p_|^mon:/.test(o.request_id)));
  assert.strictEqual(criados[0].url, 'https://x.test/a');
  assert.strictEqual(criados[0].monitor.veiculos, 4);
  assert.deepStrictEqual(kicks, ['st_1', 'st_2']);
  assert.strictEqual(avisos.length, 1, 'uma notificação por rodada, não uma por pauta');
  assert.match(avisos[0].corpo, /Em alta: Senado aprova teto do MEI/);
  assert.match(avisos[0].corpo, /4 veículos/);
  assert.match(avisos[0].corpo, /e mais 1/);
  assert.match(avisos[0].corpo, /montando o roteiro/);
});

test('nunca pede carrossel nem publicação: só cria roteiro em preparação', async () => {
  await ligar();
  await Mon.tick({ deps: deps([pauta('a', 'Senado aprova teto do MEI', ['G1', 'Folha', 'UOL'], 2)]) });
  assert.ok(criados.every((o) => o.roteiro_primeiro === true), 'sempre com a pausa para aprovar o roteiro');
  assert.strictEqual((await arm.publicacoes.listar(require('./account').ACCOUNT.ig_id)).length, 0);
});

test('não avisa duas vezes do mesmo assunto (mesmo id ou mesmo tema em outras palavras)', async () => {
  await ligar({ intervalo_min: 15 });
  const p1 = pauta('a', 'Senado aprova teto do MEI de R$ 140 mil', ['G1', 'Folha', 'UOL'], 2);
  await Mon.tick({ deps: deps([p1]) });
  const outra = pauta('z', 'Teto do MEI de R$ 140 mil é aprovado pelo Senado', ['G1', 'Folha', 'UOL'], 1);
  const r2 = await Mon.tick({ forcar: true, deps: deps([p1, outra]) });
  assert.strictEqual(r2.alertas.length, 0);
  assert.strictEqual(criados.length, 1);
  assert.strictEqual(avisos.length, 1, 'sem alerta novo, sem notificação');
});

test('teto diário de roteiros: passou do limite, avisa que está em alta mas não cria', async () => {
  await ligar({ max_roteiros_dia: 1 });
  const r = await Mon.tick({ deps: deps([pauta('a', 'Senado aprova teto do MEI', ['G1', 'Folha', 'UOL'], 2, { prioridade: 90 }), pauta('b', 'Diesel sobe 5% nas bombas', ['G1', 'Folha', 'UOL'], 3, { prioridade: 80 })]) });
  assert.strictEqual(criados.length, 1);
  assert.strictEqual(r.alertas.find((x) => /Diesel/.test(x.titulo)).roteiro, false);
  assert.match(r.alertas.find((x) => /Diesel/.test(x.titulo)).motivo_sem_roteiro, /Teto de 1 roteiros/);
  assert.doesNotMatch(avisos[0].corpo, /undefined/);
  assert.strictEqual((await Mon.estado({ agora: AGORA })).roteiros_hoje, 1);
});

test('sem chave de IA: avisa que está em alta mas não tenta montar roteiro', async () => {
  await ligar();
  const r = await Mon.tick({ deps: deps([pauta('a', 'Senado aprova teto do MEI', ['G1', 'Folha', 'UOL'], 2)], { temIA: () => false }) });
  assert.strictEqual(criados.length, 0);
  assert.match(r.alertas[0].motivo_sem_roteiro, /chave de IA/);
  assert.doesNotMatch(avisos[0].corpo, /montando/);
});

test('limiar de prioridade, política e tema usado vêm da triagem; o monitor só respeita o limiar', async () => {
  await ligar({ limiar_prioridade: 60 });
  await Mon.tick({ deps: deps([pauta('a', 'Senado aprova teto do MEI', ['G1', 'Folha', 'UOL'], 2, { prioridade: 40 }), pauta('b', 'Diesel sobe 5% nas bombas', ['G1', 'Folha', 'UOL'], 2, { prioridade: 65 })]) });
  assert.deepStrictEqual(criados.map((o) => o.titulo), ['Diesel sobe 5% nas bombas']);
});

test('intervalo entre rodadas e trava de rodada simultânea; "forcar" ignora o intervalo', async () => {
  await ligar({ intervalo_min: 30 });
  const d = deps([]);
  assert.strictEqual((await Mon.tick({ deps: d })).executou, true);
  const logo = await Mon.tick({ deps: { ...d, agora: AGORA + 5 * 60000 } });
  assert.strictEqual(logo.executou, false);
  assert.match(logo.motivo, /menos de 30 minutos/);
  assert.strictEqual((await Mon.tick({ forcar: true, deps: { ...d, agora: AGORA + 5 * 60000 } })).executou, true);
  assert.strictEqual((await Mon.tick({ deps: { ...d, agora: AGORA + 40 * 60000 } })).executou, true);
});

test('falha no meio não derruba nem trava: erro registrado, a trava é liberada e o próximo ciclo roda', async () => {
  await ligar();
  const r = await Mon.tick({ deps: deps([], { descobrir: async () => { throw new Error('feeds fora do ar'); } }) });
  assert.match(r.erros[0], /feeds fora do ar/);
  const est = await Mon.estado();
  assert.ok(est.ultimo_tick);
  assert.match(est.ultimo_resultado.erros[0], /feeds fora do ar/);
  const de_novo = await Mon.tick({ forcar: true, deps: deps([]) });
  assert.strictEqual(de_novo.executou, true);
});

test('erro ao criar um roteiro (ex.: limite do estúdio) não impede os demais nem a notificação', async () => {
  await ligar();
  let n = 0;
  const r = await Mon.tick({ deps: deps([pauta('a', 'Senado aprova teto do MEI', ['G1', 'Folha', 'UOL'], 2, { prioridade: 90 }), pauta('b', 'Diesel sobe 5% nas bombas', ['G1', 'Folha', 'UOL'], 2, { prioridade: 80 })], { criar: async (o) => { if (++n === 1) throw Object.assign(new Error('Já há cinco conteúdos em preparação.'), { status: 429 }); return { id: 'st_ok' }; } }) });
  assert.strictEqual(r.alertas[0].roteiro, false);
  assert.match(r.alertas[0].motivo_sem_roteiro, /cinco conteúdos/);
  assert.strictEqual(r.alertas[1].roteiro, true);
  assert.strictEqual(avisos.length, 1);
});

test('sem banco de dados o monitor não roda (não teria como lembrar o que já avisou)', async () => {
  A._definir(A.memoria());
  const r = await Mon.tick({ forcar: true, deps: deps([]) });
  assert.strictEqual(r.executou, false);
  assert.match(r.motivo, /banco de dados/);
});

test('configuração do monitor: valida faixas e preserva o resto ao salvar parcialmente', async () => {
  await E.salvar({ monitor: { ativo: true, min_veiculos: 4 } });
  const c = await E.ler();
  assert.deepStrictEqual([c.monitor.ativo, c.monitor.min_veiculos, c.monitor.janela_horas, c.monitor.max_roteiros_dia], [true, 4, 12, 3]);
  for (const ruim of [{ min_veiculos: 1 }, { janela_horas: 100 }, { limiar_prioridade: 101 }, { max_roteiros_dia: -1 }, { ativo: 'sim' }, { intervalo_min: 5 }]) {
    await assert.rejects(() => E.salvar({ monitor: ruim }), (e) => e.status === 400, JSON.stringify(ruim));
  }
  assert.strictEqual((await E.ler()).monitor.min_veiculos, 4, 'entrada inválida não altera o que estava salvo');
});

test('emAlta: conta veículos distintos e a idade da notícia mais nova', () => {
  const cfg = { min_veiculos: 3, janela_horas: 12 };
  const a = Mon.emAlta(pauta('a', 't', ['G1', 'G1', 'Folha', 'UOL'], 2), cfg, AGORA);
  assert.deepStrictEqual([a.n, a.horas, a.em_alta], [3, 2, true]);
  assert.strictEqual(Mon.emAlta(pauta('b', 't', ['G1', 'G1', 'G1'], 2), cfg, AGORA).em_alta, false, 'repetir o mesmo veículo não conta');
  assert.strictEqual(Mon.emAlta(pauta('c', 't', ['G1', 'Folha', 'UOL'], 20), cfg, AGORA).em_alta, false);
  assert.strictEqual(Mon.emAlta({ veiculos: ['G1', 'Folha', 'UOL'], fontes: [] }, cfg, AGORA).em_alta, false, 'sem data não há como dizer que é recente');
});
