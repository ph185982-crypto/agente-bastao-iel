// Testes das regras da esteira semanal — rode com: node --test backend/lib/esteira.test.js
const test = require('node:test');
const assert = require('node:assert');
const core = require('../../static/esteiraCore');
const { _internals: q } = require('../routes/queue');

test('weekStart cai sempre na segunda-feira', () => {
  assert.strictEqual(core.weekStart('2026-10-16'), '2026-10-12'); // sexta
  assert.strictEqual(core.weekStart('2026-10-18'), '2026-10-12'); // domingo
  assert.strictEqual(core.weekStart('2026-10-12'), '2026-10-12'); // segunda
});

test('distribute: 5 itens vão pros 5 dias úteis, um por dia', () => {
  const items = ['carrossel', 'roteiro', 'carrossel', 'corte_tv', 'carrossel'].map((format, i) => ({ id: String(i), format }));
  const out = core.distribute(items, core.DEFAULT_CONFIG, '2026-10-12');
  const dias = out.map((i) => i.scheduled_date).sort();
  assert.deepStrictEqual(dias, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
});

test('distribute: evita o mesmo formato em dias seguidos quando dá', () => {
  const items = ['carrossel', 'carrossel', 'carrossel', 'roteiro', 'roteiro'].map((format, i) => ({ id: String(i), format }));
  const out = core.distribute(items, core.DEFAULT_CONFIG, '2026-10-12');
  const porDia = Object.fromEntries(out.map((i) => [i.scheduled_date, i.format]));
  const dias = core.weekDays('2026-10-12').slice(0, 5);
  for (let d = 1; d < dias.length; d++) {
    assert.notStrictEqual(porDia[dias[d]], porDia[dias[d - 1]], `${dias[d - 1]} e ${dias[d]} repetem formato`);
  }
});

test('distribute: respeita item já agendado e dias de postagem configurados', () => {
  const cfg = { ...core.DEFAULT_CONFIG, posting_days: [1, 3, 5] };
  const items = [
    { id: 'a', format: 'roteiro', scheduled_date: '2026-10-14' },
    { id: 'b', format: 'carrossel' },
    { id: 'c', format: 'carrossel' },
  ];
  const out = core.distribute(items, cfg, '2026-10-12');
  assert.strictEqual(out.find((i) => i.id === 'a').scheduled_date, '2026-10-14');
  for (const i of out.filter((x) => x.id !== 'a')) {
    assert.ok(['2026-10-12', '2026-10-16'].includes(i.scheduled_date), i.scheduled_date);
  }
});

test('suggestFormat: vídeo vira corte_tv; segredo vira carrossel arquivo', () => {
  assert.strictEqual(core.suggestFormat({ title: 'x', video_url: 'https://instagram.com/reel/a' }).format, 'corte_tv');
  const f = core.suggestFormat({ title: 'O lugar proibido que ninguém visita' });
  assert.deepStrictEqual(f, { format: 'carrossel', carousel_type: 'arquivo' });
});

test('legenda: separa hashtags, quebra parágrafo longo e põe crédito de terceiro', () => {
  const longo = 'Primeira frase bem comprida sobre o assunto do dia. '.repeat(5) + '#Negocios #vendas';
  const pack = q.buildCaptionPack(
    { format: 'corte_tv', pillar: 'negócios e vendas online', source_name: '@canalgrande', title: 't' },
    longo,
  );
  assert.ok(pack.caption.includes('\n'), 'sem quebra de linha');
  assert.ok(pack.caption.includes('Fonte: @canalgrande'));
  assert.ok(pack.hashtags.includes('#negocios'));
  assert.strictEqual(new Set(pack.hashtags).size, pack.hashtags.length, 'hashtag repetida');
  assert.strictEqual(pack.third_party, true);
});

test('legenda: pauta própria não ganha crédito nem aviso', () => {
  const pack = q.buildCaptionPack({ format: 'carrossel', source_name: 'Sugestão da IA', title: 't' }, 'Texto.');
  assert.strictEqual(pack.source_credit, '');
  assert.strictEqual(pack.third_party, false);
});

test('pilares viram no máximo 2 temas do content-finder', () => {
  const t = q.themesForPillars(core.DEFAULT_CONFIG.pillars);
  assert.ok(t.length > 0 && t.length <= 2);
});

test('roteiro do robô tem gancho, blocos e CTA', () => {
  const r = q.roteiroRobo({ title: 'Por que a Shopee cresce', summary: 'resumo' });
  const txt = q.roteiroTexto(r);
  assert.match(txt, /GANCHO/);
  assert.match(txt, /CTA/);
});

test('resumo de desempenho aponta o melhor formato', () => {
  const s = core.performanceSummary([
    { format: 'carrossel', pillar: 'a', metrics: { views: 100, likes: 10 } },
    { format: 'roteiro', pillar: 'b', metrics: { views: 5000, likes: 300 } },
  ]);
  assert.strictEqual(s.formatos[0].chave, 'roteiro');
});

test('distribute com fromDate não agenda em dia que já passou', () => {
  const out = core.distribute([{ id: 'a', format: 'carrossel' }, { id: 'b', format: 'roteiro' }], core.DEFAULT_CONFIG, '2026-10-12', '2026-10-15');
  for (const i of out) assert.ok(i.scheduled_date >= '2026-10-15', i.scheduled_date);
});

test('targetWeek: sexta usa a semana atual; sábado pula pra próxima', () => {
  assert.strictEqual(core.targetWeek(core.DEFAULT_CONFIG, '2026-10-16'), '2026-10-12');
  assert.strictEqual(core.targetWeek(core.DEFAULT_CONFIG, '2026-10-17'), '2026-10-19');
});
