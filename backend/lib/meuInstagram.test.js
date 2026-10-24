// Meu Instagram: leitura e análise sem inventar número. Sem rede: a Graph é simulada por função.
// node --test backend/lib/meuInstagram.test.js
const test = require('node:test');
const assert = require('node:assert');
const MI = require('./meuInstagram');

const AGORA = Date.parse('2026-10-23T12:00:00Z');
const horas = (h) => new Date(AGORA - h * 3600000).toISOString();
const erroMeta = (tipo, code = 100) => Object.assign(new Error('x'), { meta: { tipo, code, amigavel: `erro ${tipo}` } });

const post = (o) => ({ id: `m${Math.random()}`, tipo: 'carrossel', maduro: true, alcance: 1000, compartilhamentos: 10, salvamentos: 5, interacoes: 30, visitas_ao_perfil: 4, seguidores_ganhos: 0, da_ferramenta: false, legenda: '', ...o });

test('tipos: story fica de fora; Reels vem como product_type REELS', () => {
  assert.strictEqual(MI.tipoDe({ media_type: 'VIDEO', media_product_type: 'REELS' }), 'reel');
  assert.strictEqual(MI.tipoDe({ media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' }), 'carrossel');
  assert.strictEqual(MI.tipoDe({ media_type: 'IMAGE', media_product_type: 'FEED' }), 'imagem');
  assert.strictEqual(MI.tipoDe({ media_type: 'IMAGE', media_product_type: 'STORY' }), null);
});

test('valores: lê values[0].value e total_value; métrica vazia vira null, nunca zero', () => {
  const v = MI.lerValores({ data: [{ name: 'reach', values: [{ value: 120 }] }, { name: 'saved', total_value: { value: 3 } }, { name: 'shares', values: [] }, { name: 'follows', values: [{ value: 0 }] }] });
  assert.deepStrictEqual(v, { reach: 120, saved: 3, shares: null, follows: 0 });
});

test('insights: se a Meta recusa seguidor/visitas para o tipo, cai no conjunto básico e registra o que faltou', async () => {
  const pedidos = [];
  const grafo = async (_m, caminho, params) => {
    pedidos.push(params.metric);
    if (params.metric.includes('follows')) throw erroMeta('outro');
    return { data: [{ name: 'reach', values: [{ value: 500 }] }, { name: 'shares', values: [{ value: 7 }] }] };
  };
  const r = await MI.insightsDe({ id: 'm1', tipo: 'carrossel' }, grafo);
  assert.strictEqual(r.valores.reach, 500);
  assert.ok(r.indisponiveis.includes('follows') && r.indisponiveis.includes('profile_visits') && r.indisponiveis.includes('saved'));
  assert.strictEqual(pedidos.length, 2);
});

test('insights: token ou permissão recusados não ficam tentando métricas menores', async () => {
  let chamadas = 0;
  const r = await MI.insightsDe({ id: 'm1', tipo: 'imagem' }, async () => { chamadas++; throw erroMeta('permissao', 10); });
  assert.strictEqual(chamadas, 1);
  assert.ok(r.erro && r.erro.tipo === 'permissao');
  assert.strictEqual(r.valores.reach, undefined);
});

test('análise: envios por mil e mediana (não média); ausência não vira zero', () => {
  const posts = [
    post({ alcance: 2000, compartilhamentos: 20 }), post({ alcance: 4000, compartilhamentos: 8 }), post({ alcance: 1000, compartilhamentos: 30 }),
    post({ alcance: 3000, compartilhamentos: null }), post({ alcance: 500000, compartilhamentos: 10000 }),
  ];
  const a = MI.analisar(posts);
  const g = a.por_tipo.carrossel;
  assert.strictEqual(g.n, 5);
  assert.strictEqual(g.alcance_mediana, 3000);                       // a mediana ignora o post de 500 mil
  assert.strictEqual(g.compartilhamentos_por_mil_mediana, 15);       // por mil: 10, 2, 30, 20 (o null fica de fora) → mediana 15
});

test('análise: mediana de envios por mil dos posts com dado (null fica de fora)', () => {
  const posts = [10, 20, 30, 40, 50].map((s) => post({ alcance: 1000, compartilhamentos: s }));
  posts.push(post({ alcance: 1000, compartilhamentos: null }));
  const g = MI.analisar(posts).por_tipo.carrossel;
  assert.strictEqual(g.compartilhamentos_por_mil_mediana, 30);
  assert.strictEqual(g.amostra, 'suficiente');
});

test('análise: grupo com menos de 5 posts é "amostra pequena" e não gera comparação', () => {
  const posts = [...Array(6).keys()].map(() => post({ tipo: 'carrossel', compartilhamentos: 5 }))
    .concat([...Array(3).keys()].map(() => post({ tipo: 'reel', compartilhamentos: 90, seguidores_ganhos: null, visitas_ao_perfil: null })));
  const a = MI.analisar(posts);
  assert.strictEqual(a.por_tipo.reel.amostra, 'pequena');
  assert.strictEqual(a.comparacoes.length, 1);
  assert.ok(/Sem comparação/.test(a.comparacoes[0].leitura));
  assert.ok(!/vencedor/i.test(JSON.stringify(a)), 'nenhum texto declara vencedor');
  assert.strictEqual(a.por_tipo.reel.n_com_seguidores, 0);
  assert.strictEqual(a.por_tipo.reel.seguidores_ganhos_total, null, 'Reels: sem dado, não zero');
});

test('análise: com os dois lados suficientes só fala em "indício"', () => {
  const posts = [...Array(6).keys()].map(() => post({ tipo: 'carrossel', alcance: 1000, compartilhamentos: 4 }))
    .concat([...Array(6).keys()].map(() => post({ tipo: 'imagem', alcance: 1000, compartilhamentos: 12 })));
  const c = MI.analisar(posts).comparacoes[0];
  assert.strictEqual(c.razao, 3);
  assert.ok(/Indício/.test(c.leitura) && !/vencedor|melhor formato/i.test(c.leitura));
  const iguais = MI.analisar([...Array(6).keys()].map(() => post({ tipo: 'carrossel' })).concat([...Array(6).keys()].map(() => post({ tipo: 'imagem' })))).comparacoes[0];
  assert.ok(/Sem diferença clara/.test(iguais.leitura));
});

test('análise: posts novos (menos de 72 h) e sem alcance ficam fora das comparações e são contados à parte', () => {
  const posts = [post({}), post({}), post({ maduro: false, alcance: 999999 }), post({ alcance: null })];
  const a = MI.analisar(posts);
  assert.strictEqual(a.n_comparaveis, 2);
  assert.strictEqual(a.n_imaturos, 1);
  assert.strictEqual(a.n_sem_dados, 1);
  assert.ok(a.observacoes.some((o) => /menos de 72 h/.test(o)) && a.observacoes.some((o) => /não são tratados como zero/.test(o)));
});

test('análise: concentração de seguidores e posts fora da curva aparecem como observação', () => {
  const posts = [...Array(8).keys()].map(() => post({ alcance: 1000, seguidores_ganhos: 0 }));
  posts.push(post({ alcance: 600000, seguidores_ganhos: 260 }), post({ alcance: 50000, seguidores_ganhos: 190 }));
  const a = MI.analisar(posts);
  assert.strictEqual(a.concentracao_seguidores.total, 450);
  assert.strictEqual(a.concentracao_seguidores.pct_top2, 100);
  assert.strictEqual(a.concentracao_seguidores.posts_sem_seguidor, 8);
  assert.strictEqual(a.fora_da_curva.length, 2);
  assert.ok(a.observacoes.some((o) => /trouxeram 100%/.test(o)));
});

test('análise: separa o que a ferramenta publicou do resto, só com amostra suficiente', () => {
  const posts = [...Array(3).keys()].map(() => post({ da_ferramenta: true })).concat([...Array(7).keys()].map(() => post({})));
  const o = MI.analisar(posts).por_origem;
  assert.strictEqual(o.ferramenta.amostra, 'pequena');
  assert.strictEqual(o.fora.amostra, 'suficiente');
});

test('atualizar: lê conta, pagina, respeita a janela, ignora story e marca o que veio da ferramenta', async () => {
  const chamadas = [];
  const midias = [
    { id: 'a', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', permalink: 'p/a', timestamp: horas(10), caption: 'Primeiro' },
    { id: 's', media_type: 'IMAGE', media_product_type: 'STORY', timestamp: horas(20) },
    { id: 'b', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'p/b', timestamp: horas(200) },
    { id: 'velho', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: horas(24 * 200) },
  ];
  const grafo = async (_m, caminho, params) => {
    chamadas.push(caminho);
    if (caminho === 'IG') return { username: 'pedro_destrava', followers_count: 166772, media_count: 78 };
    if (caminho === 'IG/media') return params.after ? { data: midias.slice(2), paging: {} } : { data: midias.slice(0, 2), paging: { cursors: { after: 'X' }, next: 'url' } };
    if (caminho === 'IG/insights') return { data: [{ name: 'reach', values: [{ value: 1000, end_time: '2026-10-22T07:00:00+0000' }] }, { name: 'follower_count', values: [{ value: 40, end_time: '2026-10-22T07:00:00+0000' }] }] };
    if (caminho.endsWith('/insights')) return { data: [{ name: 'reach', values: [{ value: caminho.startsWith('a') ? 800 : 500 }] }, { name: 'shares', values: [{ value: 8 }] }, { name: 'saved', values: [{ value: 4 }] }, { name: 'total_interactions', values: [{ value: 30 }] }, { name: 'views', values: [{ value: 1200 }] }] };
    throw new Error(`rota não simulada ${caminho}`);
  };
  const s = await MI.atualizar({ grafo, igId: 'IG', agora: AGORA, dias: 90, daFerramenta: new Map([['a', 'conteudo-1']]) });
  assert.strictEqual(s.conta.seguidores, 166772);
  assert.deepStrictEqual(s.posts.map((p) => p.id), ['a', 'b'], 'story e post fora da janela ficam de fora');
  assert.strictEqual(s.posts[0].da_ferramenta, true);
  assert.strictEqual(s.posts[0].content_id, 'conteudo-1');
  assert.strictEqual(s.posts[0].maduro, false, 'post de 10 h ainda não é comparável');
  assert.strictEqual(s.posts[1].maduro, true);
  assert.strictEqual(s.posts[1].tipo, 'reel');
  assert.strictEqual(s.posts[0].compartilhamentos, 8);
  assert.strictEqual(s.posts[0].seguidores_ganhos, null, 'não veio da Meta: null, não zero');
  assert.ok(s.posts[0].sem_dados.includes('follows'));
  assert.strictEqual(s.serie_conta.follower_count[0].valor, 40);
  assert.strictEqual(s.parcial, false);
});

test('atualizar: sem permissão nas métricas, avisa qual permissão falta em vez de mostrar zeros', async () => {
  const grafo = async (_m, caminho) => {
    if (caminho === 'IG') return { username: 'pedro_destrava', followers_count: 10 };
    if (caminho === 'IG/media') return { data: [{ id: 'a', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: horas(300) }] };
    throw erroMeta('permissao', 10);
  };
  const s = await MI.atualizar({ grafo, igId: 'IG', agora: AGORA });
  assert.ok(s.avisos.some((a) => /instagram_manage_insights/.test(a)));
  assert.strictEqual(s.posts[0].alcance, null);
  assert.ok(s.posts[0].erro_meta);
  assert.strictEqual(s.serie_conta, null);
});

test('atualizar: estouro de tempo devolve o que já leu e marca como parcial', async () => {
  const grafo = async (_m, caminho) => {
    if (caminho === 'IG') return { username: 'x', followers_count: 1 };
    if (caminho === 'IG/media') return { data: [{ id: 'a', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: horas(300) }] };
    return { data: [] };
  };
  const s = await MI.atualizar({ grafo, igId: 'IG', agora: AGORA, orcamentoMs: -1 });
  assert.strictEqual(s.parcial, true);
  assert.ok(s.avisos.some((a) => /interrompida/.test(a)));
});
