// Diagnóstico do Raio-X: regras sobre números reais. Os posts abaixo são FIXTURES de teste.
// node --test backend/lib/raioXAnalise.test.js
const test = require('node:test');
const assert = require('node:assert');
const A = require('./raioXAnalise');

const AGORA = Date.parse('2026-11-27T12:00:00Z'); const DIA = 86400000;
let seq = 0;
const post = (dias, o = {}) => ({ id: `p${++seq}`, tipo: 'carrossel', em: new Date(AGORA - dias * DIA).toISOString(), legenda: 'Por que a loja cobra mais caro no cartão', alcance: 4000, views: 6000, curtidas: 80, comentarios: 1, envios: 8, salvos: 4, seguidores: 0, visitas: 6, ...o });
const conta = (o = {}) => ({ perfil: { followers_count: 165000 }, serie_30d: { follower_count: [['2026-11-20', 10], ['2026-11-21', 12]] }, janelas: [{ de: '2026-10-28', ate: '2026-11-27', m: { reach: { total: 100000, cortes: [{ por: 'follow_type', itens: [{ valor: 'FOLLOWER', n: 90000 }, { valor: 'NON_FOLLOWER', n: 10000 }] }] }, follows_and_unfollows: { total: null, cortes: [{ por: 'follow_type', itens: [{ valor: 'FOLLOWER', n: 900 }, { valor: 'NON_FOLLOWER', n: 1500 }] }] } } }], demografia: { follower_demographics: { age: [{ valor: '18-24', n: 60 }, { valor: '25-34', n: 40 }] } }, erros: [], ...o });

test('abertura da legenda: citação, pergunta, número, contraste, você, afirmação', () => {
  assert.strictEqual(A.ganchoDe('“O sucesso é a soma de pequenos esforços” — Robert Collier'), 'citacao');
  assert.strictEqual(A.ganchoDe('Você sabe quanto a Shopee cobra?'), 'pergunta');
  assert.strictEqual(A.ganchoDe('A Nutella fatura R$ 2 bilhões'), 'numero');
  assert.strictEqual(A.ganchoDe('Desconto não é estratégia'), 'contraste');
  assert.strictEqual(A.ganchoDe('O seu cliente compra pelo frete'), 'voce');
  assert.strictEqual(A.ganchoDe('A marca abriu lojas no interior'), 'afirmacao');
  assert.strictEqual(A.ganchoDe(''), 'sem_legenda');
});

test('achados: base que não vê, pouca descoberta, saldo negativo, alcance que não vira seguidor; cada um com o número', () => {
  const posts = Array.from({ length: 12 }, (_, i) => post(5 + i * 3));
  const a = A.analisar({ posts, conta: conta(), agora: AGORA });
  const t = a.achados.map((x) => x.titulo);
  assert.ok(t.includes('A sua base quase não vê o que você posta')); assert.strictEqual(a.geral.alcance_pct_da_base, 2.4);
  const desc = a.achados.find((x) => /não te segue/.test(x.titulo)); assert.match(desc.evidencia, /10% do alcance veio de não seguidores/);
  const saldo = a.achados.find((x) => /perdendo seguidores/.test(x.titulo)); assert.match(saldo.evidencia, /900 seguiram e 1\.500 saíram \(saldo -600\)/);
  const seg = a.achados.find((x) => /não vira seguidor/.test(x.titulo)); assert.match(seg.evidencia, /12 de 12 posts de feed não trouxeram nenhum seguidor/);
  assert.strictEqual(a.achados[0].gravidade, 'alta');
  assert.strictEqual(a.conta.janelas[0].saldo, -600); assert.strictEqual(a.demografia.seguidores.age[0].pct, 60);
});

test('linha da ferramenta abaixo do perfil vira achado com a vaga do piloto; linha forte aparece entre os melhores', () => {
  const fora = Array.from({ length: 10 }, (_, i) => post(5 + i * 2, { alcance: 8000, envios: 60, salvos: 20, seguidores: 4 }));
  const frases = Array.from({ length: 8 }, (_, i) => post(6 + i * 2, { tipo: 'imagem', alcance: 1500, envios: 1, salvos: 1, legenda: '“Frase famosa” — Autor', ficha: { tipo: 'frase' } }));
  const a = A.analisar({ posts: [...fora, ...frases], conta: conta(), agora: AGORA });
  const fr = a.linhas.find((l) => l.id === 'frase');
  assert.strictEqual(fr.n, 8); assert.ok(fr.envios_x <= 0.6); assert.strictEqual(fr.n_melhores, 0);
  const ach = a.achados.find((x) => /Frase famosa/.test(x.titulo)); assert.strictEqual(ach.mix, 'frase'); assert.match(ach.fazer, /Pausar esta linha/);
  assert.ok(a.padroes.parar.some((p) => /Frase famosa|Citação/.test(p.texto)));
  assert.strictEqual(a.melhores[0].linha, 'fora');
});

test('volume: posts no mesmo dia comparados por faixa; muitos no dia com alcance 30% menor vira achado', () => {
  const sozinhos = Array.from({ length: 6 }, (_, i) => post(40 + i * 2, { alcance: 9000 }));
  const lote = []; for (let d = 0; d < 2; d++) for (let k = 0; k < 8; k++) lote.push(post(10 + d + k * 0.01, { alcance: 2000 }));
  const a = A.analisar({ posts: [...sozinhos, ...lote], conta: conta(), agora: AGORA });
  const v = Object.fromEntries(a.volume.map((x) => [x.faixa, x]));
  assert.strictEqual(v['1 post no dia'].alcance, 9000); assert.strictEqual(v['7 ou mais no dia'].alcance, 2000); assert.strictEqual(v['7 ou mais no dia'].n, 16);
  assert.ok(a.achados.some((x) => /mesmo dia derruba/.test(x.titulo)));
});

test('post com menos de 72 h e post sem métrica ficam fora das contas (nunca viram zero); pouco vídeo e Reel que perde em 3 s aparecem', () => {
  const posts = [...Array.from({ length: 11 }, (_, i) => post(4 + i)), post(1, { alcance: 50 }), post(9, { alcance: null }),
    ...Array.from({ length: 5 }, (_, i) => post(35 + i * 3, { tipo: 'reel', alcance: 12000, envios: 200, tempo_medio_ms: 3000, pulou_3s_pct: 72, seguidores: null }))];
  const a = A.analisar({ posts, conta: null, agora: AGORA });
  assert.strictEqual(a.total_lidos, 18); assert.strictEqual(a.maduros, 16);
  assert.ok(a.achados.some((x) => /sem métrica/i.test(x.titulo)));
  assert.ok(a.achados.some((x) => /antes de 3 segundos/.test(x.titulo) && /72%/.test(x.evidencia)));
  assert.ok(a.achados.some((x) => /Quase não tem vídeo/.test(x.titulo)));
  assert.strictEqual(a.seguidores, null); assert.ok(!a.achados.some((x) => /base quase não vê/.test(x.titulo)), 'sem número de seguidores não afirma nada sobre a base');
});

test('texto para colar: traz achados, linhas, volume, conta, melhores e a lista de posts, sem identificador de mídia nem link', () => {
  const posts = Array.from({ length: 8 }, (_, i) => post(5 + i * 3, { link: 'https://www.instagram.com/p/SEGREDO/' }));
  const a = A.analisar({ posts, conta: conta(), agora: AGORA });
  const t = A.texto(a, posts);
  for (const s of ['RAIO-X', 'ACHADOS:', 'LINHAS', 'VOLUME NO DIA', 'CONTA 2026-10-28', 'MELHORES:', 'TODOS (data']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('SEGREDO') && !/\bp\d+\b/.test(t));
  assert.ok(A.texto(a, posts, { completo: false }).length < t.length);
});
