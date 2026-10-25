// Triagem de pautas: níveis da IA, combinação e descarte pelo código. node --test backend/lib/pautas.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('./pautas');

const AGORA = Date.parse('2026-10-23T12:00:00Z');
const h = (n) => new Date(AGORA - n * 3600000).toISOString();
const pauta = (id, titulo, extra = {}) => ({ id, titulo, resumo: 'Resumo da notícia.', fontes: [{ url: 'https://x.test', origem: 'X' }], publicada_em: h(5), ...extra });
const nota = (o = {}) => ({ enviabilidade: 2, numero: 2, aderencia: 2, ponte_lojista: 1, mecanismo: 'numero_chocante', por_que_enviaria: 'Manda para o amigo MEI.', angulo_consumidor: 'g', angulo_lojista: 'espelho', partidario: false, direito_autoral: false, ligacao_com_perfil: 'forte', ...o });
const mapa = (o) => new Map(Object.entries(o));

test('prioridade combina os níveis com os pesos; máximo 100, mínimo 0', () => {
  const r = P.triar([pauta('a', 'Teto do MEI sobe para R$ 140 mil', { publicada_em: h(2) })], mapa({ a: nota({ enviabilidade: 3, numero: 3, aderencia: 3, ponte_lojista: 3 }) }), { agora: AGORA });
  assert.strictEqual(r.pautas[0].prioridade, 100);
  const baixa = P.triar([pauta('b', 'Imposto de 12% no cartão', { publicada_em: h(300) })], mapa({ b: nota({ enviabilidade: 0, numero: 1, aderencia: 1, ponte_lojista: 0 }) }), { agora: AGORA });
  assert.ok(baixa.pautas[0].prioridade >= 0 && baixa.pautas[0].prioridade < 25, String(baixa.pautas[0].prioridade));
  assert.strictEqual(P.SOMA_PESOS, 95);
});

test('frescor vem da data (código), não da IA; ordem decrescente por prioridade', () => {
  const r = P.triar(
    [pauta('velha', 'Salário mínimo de R$ 1.518', { publicada_em: h(200) }), pauta('nova', 'Salário mínimo de R$ 1.518 em debate', { publicada_em: h(3) })],
    mapa({ velha: nota(), nova: nota() }), { agora: AGORA });
  assert.deepStrictEqual(r.pautas.map((p) => p.id), ['nova', 'velha']);
  assert.strictEqual(r.pautas[0].criterios.frescor, 3);
  assert.strictEqual(r.pautas[1].criterios.frescor, 0);
});

test('nível fora da faixa ou texto vira número válido; a IA não cria número que a notícia não tem', () => {
  assert.strictEqual(P.nivel(9), 3); assert.strictEqual(P.nivel(-2), 0); assert.strictEqual(P.nivel('x'), 0); assert.strictEqual(P.nivel(1.6), 2);
  const r = P.triar([pauta('a', 'Governo discute mudança na regra do FGTS', { resumo: 'Sem valores definidos.' })], mapa({ a: nota({ numero: 3 }) }), { agora: AGORA });
  assert.strictEqual(r.pautas[0].criterios.numero, 1, 'sem dígito no título/resumo, o nível de número é limitado a 1');
});

test('descartes têm motivo: bloqueado, eleitoral (modo neutro), tema usado, fora do público, sem número, sem avaliação', () => {
  const log = [{ id: 'x', tema: 'Teto do MEI sobe para R$ 140 mil', origem: 'instagram', em: h(24 * 5) }];
  const pautas = [
    pauta('b', 'Bets proibidas: o que muda para quem aposta'),
    pauta('e', 'Candidato lidera pesquisa eleitoral em Minas'),
    pauta('u', 'Senado aprova o teto do MEI de R$ 140 mil'),
    pauta('f', 'Reunião do conselho de pesca marinha', { resumo: 'Sem relação alguma.' }),
    pauta('n', 'Governo discute mudança na regra do FGTS', { resumo: 'Sem valores.' }),
    pauta('s', 'Imposto de 12% no cartão de crédito'),
    pauta('ok', 'Aluguel sobe 9% em 12 meses'),
  ];
  const r = P.triar(pautas, mapa({ b: nota(), e: nota(), u: nota(), f: nota({ aderencia: 0 }), n: nota({ numero: 0 }), ok: nota() }), { estrategia: { temas_bloqueados: ['bets'] }, log, agora: AGORA });
  const m = Object.fromEntries(r.descartadas.map((d) => [d.id, d.motivo]));
  assert.deepStrictEqual(m, { b: 'tema_bloqueado', e: 'partidario', u: 'tema_usado', f: 'fora_do_publico', n: 'sem_numero', s: 'sem_avaliacao' });
  assert.match(r.descartadas.find((d) => d.id === 'u').detalhe, /há 5 dia/);
  assert.deepStrictEqual(r.pautas.map((p) => p.id), ['ok']);
});

test('modo político: neutro descarta ângulo partidário; "allowed" libera e só penaliza', () => {
  const p = [pauta('a', 'Lula e Bolsonaro trocam acusações sobre o Pix de R$ 5 mil')];
  const n = P.triar(p, mapa({ a: nota({ partidario: true }) }), { agora: AGORA });
  assert.strictEqual(n.pautas.length, 0);
  assert.strictEqual(n.descartadas[0].motivo, 'partidario');
  const l = P.triar(p, mapa({ a: nota({ partidario: true }) }), { estrategia: { modo_politico: 'allowed' }, agora: AGORA });
  assert.strictEqual(l.pautas.length, 1);
  assert.deepStrictEqual(l.pautas[0].penalidades.map((x) => x.tipo), ['partidario']);
  const sem = P.triar(p, mapa({ a: nota() }), { estrategia: { modo_politico: 'allowed' }, agora: AGORA });
  assert.ok(l.pautas[0].prioridade < sem.pautas[0].prioridade, 'a penalidade reduz a prioridade');
});

test('economia aplicada com ator político NÃO é descartada no modo neutro', () => {
  const r = P.triar([pauta('a', 'Governo anuncia Pix de R$ 5 mil para MEI investir')], mapa({ a: nota({ partidario: false }) }), { agora: AGORA });
  assert.strictEqual(r.pautas.length, 1);
});

test('sem IA: a lista segue como veio, sem prioridade inventada', () => {
  const r = P.triar([pauta('a', 'Aluguel sobe 9%')], null, { agora: AGORA });
  assert.strictEqual(r.pautas[0].prioridade, null);
  assert.strictEqual(r.pautas[0].criterios, null);
});

test('mecanismo inválido vira null; ângulo do lojista só existe com ponte; aviso diz que não prevê resultado', () => {
  const r = P.triar([pauta('a', 'Taxa de 12% em vendas online'), pauta('b', 'Taxa de 8% em vendas online')], mapa({ a: nota({ mecanismo: 'viral', ponte_lojista: 0 }), b: nota({ ponte_lojista: 2 }) }), { agora: AGORA });
  const a = r.pautas.find((p) => p.id === 'a'); const b = r.pautas.find((p) => p.id === 'b');
  assert.strictEqual(a.mecanismo, null);
  assert.strictEqual(a.angulo_lojista, '');
  assert.strictEqual(b.angulo_lojista, 'espelho');
  assert.match(r.aviso_prioridade, /não prevê/i);
});
