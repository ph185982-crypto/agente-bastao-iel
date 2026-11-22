// Banco de nomes: reportagem sob demanda para "Quem é ele?" e "Por trás da marca".
// node --test backend/lib/top/nomes.test.js
const test = require('node:test');
const assert = require('node:assert');
const N = require('./nomes');

const feeds = (itens) => ({ lerFeed: async () => ({ itens }) });
// matéria "<nome> investe R$ 20 milhões" para o nome da busca, qualquer que seja
const feedsPorNome = () => ({ lerFeed: async (feed) => { const q = decodeURIComponent(feed.url.split('q=')[1].split('&')[0]).replace(/"/g, ''); const nome = q.split(' investiu')[0]; return { itens: [{ titulo: `${nome} investe R$ 20 milhões em startup`, url: `https://x.test/${encodeURIComponent(nome)}`, publicada_em: '2026-11-10T00:00:00Z' }] }; } });

test('pontuar: nome no título, valor em dinheiro e verbo de negócio sobem; escândalo e morte descem', () => {
  const ok = N.pontuar({ titulo: 'Roger Federer investiu US$ 50 milhões em marca de tênis' }, 'Roger Federer');
  assert.ok(ok >= 5);
  assert.strictEqual(N.pontuar({ titulo: 'Tênis vence torneio em Paris' }, 'Roger Federer'), -1, 'sem o nome no título');
  assert.ok(N.pontuar({ titulo: 'Roger Federer é acusado em processo de US$ 5 milhões' }, 'Roger Federer') < 2);
});

test('proximoNome: pega a matéria com valor, marca o nome como tentado e respeita os 45 dias', async () => {
  const est = {}; const agora = Date.parse('2026-11-22T12:00:00Z');
  const deps = { feeds: feedsPorNome(), sortear: () => 0.5 };
  const r = await N.proximoNome('revelacao', est, { agora, deps });
  assert.ok(r && /^https:\/\/x\.test\//.test(r.url) && r.marca && /^n_/.test(r.id) && /investe R\$ 20 milhões/.test(r.titulo));
  assert.ok(est.nomes.revelacao[r.marca], 'nome marcado como tentado');
  // todos tentados agora há pouco: não sobra nenhum
  for (const n of N.PESSOAS) est.nomes.revelacao[n] = new Date(agora - 3600e3).toISOString();
  assert.strictEqual(await N.proximoNome('revelacao', est, { agora, deps }), null);
  // 46 dias depois volta
  assert.ok(await N.proximoNome('revelacao', est, { agora: agora + 46 * 86400e3, deps }));
});

test('proximoNome: nome sem matéria boa não trava (tenta os próximos e devolve null se nenhum serve)', async () => {
  const est = {};
  const r = await N.proximoNome('marca', est, { deps: { feeds: feeds([{ titulo: 'Notícia sem relação', url: 'https://x.test/z' }]), sortear: () => 0.5 } });
  assert.strictEqual(r, null);
  assert.strictEqual(Object.keys(est.nomes.marca).length, 6, 'tentou 6 marcas e parou');
});
