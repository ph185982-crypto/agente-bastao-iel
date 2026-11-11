// Placar real: resultado por jeito de fazer, calibração das notas e pesos para a produção.
// node --test backend/lib/placar.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const P = require('./placar');
const Mentes = require('./mentes');
const { ACCOUNT } = require('./account');

const post = (id, extra = {}) => ({ id, tipo: 'carrossel', publicado_em: '2026-11-01T12:00:00Z', maduro: true, idade_h: 200, alcance: 1000, compartilhamentos: 10, salvamentos: 5, seguidores_ganhos: 2, da_ferramenta: false, content_id: null, ...extra });
const ficha = (id, extra = {}) => ({ content_id: id, linha: 'noticia', formato: 'tweet', redator: 'halbert', capa_de: 'juri', gancho: 'contradicao', nota_juri: 8, nota_painel: 5, ...extra });

test('ficha: lê do documento como o conteúdo foi feito (linha, formato, redator, capa, notas)', () => {
  const c = { id: 'c1', titulo: 'T', top: { origem: 'piloto', formato: 'ensaio', entrada: { modo: 'opiniao' }, mentes: { roteiro: 'ogilvy' }, escolha: { versao: 0, capas: [1], nota: 8.6 }, painel: { nota: 5.2 }, versoes: [{ capas: [{ mecanismo: 'numero' }, { mecanismo: 'mente:kennedy' }] }] } };
  assert.deepStrictEqual(P.fichaDe(c), { content_id: 'c1', titulo: 'T', linha: 'opiniao', origem: 'piloto', formato: 'ensaio', redator: 'ogilvy', capa_de: 'kennedy', gancho: null, estilo_video: null, nota_juri: 8.6, nota_painel: 5.2 });
  assert.strictEqual(P.fichaDe({ id: 'vd_1', video: { estilo: 'beast' }, origem: { tipo: 'video' } }).linha, 'video');
  assert.strictEqual(P.fichaDe(null), null);
});

test('placar: compara cada grupo com os posts do Pedro por envios por mil; grupo pequeno é só indício; imaturo fica de fora', () => {
  const posts = [
    post('m1', { compartilhamentos: 20 }), post('m2', { compartilhamentos: 30 }), post('m3', { compartilhamentos: 40 }), // do Pedro: mediana 30/mil
    ...[1, 2, 3].map((i) => post(`t${i}`, { da_ferramenta: true, content_id: `ct${i}`, compartilhamentos: 60 })),
    ...[1, 2, 3].map((i) => post(`r${i}`, { da_ferramenta: true, content_id: `cr${i}`, compartilhamentos: 15 })),
    post('e1', { da_ferramenta: true, content_id: 'ce1', compartilhamentos: 90 }),
    post('novo', { da_ferramenta: true, content_id: 'cn', maduro: false, compartilhamentos: 999 }),
    post('orfao', { da_ferramenta: true, content_id: 'sumiu', compartilhamentos: 1 }),
  ];
  const fichas = new Map([...[1, 2, 3].map((i) => [`ct${i}`, ficha(`ct${i}`, { formato: 'tweet' })]), ...[1, 2, 3].map((i) => [`cr${i}`, ficha(`cr${i}`, { formato: 'reportagem', redator: 'ogilvy' })]), ['ce1', ficha('ce1', { formato: 'ensaio' })]]);
  const pl = P.calcular(posts, fichas);
  assert.strictEqual(pl.seus.envios_mil, 30); assert.strictEqual(pl.seus.n, 3);
  assert.strictEqual(pl.ferramenta.n, 8); assert.strictEqual(pl.sem_ficha, 1);
  const f = Object.fromEntries(pl.por.formato.map((g) => [g.valor, g]));
  assert.strictEqual(f.tweet.envios_mil, 60); assert.strictEqual(f.tweet.contra_os_seus, 2); assert.strictEqual(f.tweet.amostra, 'suficiente');
  assert.strictEqual(f.reportagem.contra_os_seus, 0.5);
  assert.strictEqual(f.ensaio.amostra, 'pequena');
  // pesos: só grupos com 3+ posts; o ensaio (1 post, 90/mil) não entra em decisão
  assert.deepStrictEqual(pl.pesos.formato, { tweet: 0.8, reportagem: 0.2 });
  assert.strictEqual(pl.pesos.redator.halbert > pl.pesos.redator.ogilvy, true);
});

test('pesos: com menos de 2 grupos medidos não decide nada; sortear respeita 80/20 e devolve null sem pesos', () => {
  assert.strictEqual(P.pesos([{ valor: 'tweet', n: 5, envios_mil: 20 }, { valor: 'ensaio', n: 2, envios_mil: 90 }]), null);
  const op = ['tweet', 'reportagem', 'estatico', 'ensaio']; const w = { tweet: 0.8, reportagem: 0.2 };
  assert.strictEqual(P.sortear(op, null, 0.5), null);
  assert.strictEqual(P.sortear(op, w, 0), 'tweet');       // tweet: 0,8×0,8 + 0,05 = 0,69
  assert.strictEqual(P.sortear(op, w, 0.68), 'tweet');
  assert.strictEqual(P.sortear(op, w, 0.70), 'reportagem'); // reportagem: 0,8×0,2 + 0,05 = 0,21 → até 0,90
  assert.strictEqual(P.sortear(op, w, 0.92), 'estatico');   // exploração: 0,05 cada
  assert.strictEqual(P.sortear(op, w, 0.99), 'ensaio');
});

test('calibração: diz se a nota acompanha envios e salvos reais, e só com 10 pares', () => {
  const pares = (f) => Array.from({ length: 12 }, (_, i) => ({ nota: i, resultado: f(i) }));
  assert.strictEqual(P.calibrar(pares((i) => i * 2)).acerta, true);
  const errado = P.calibrar(pares((i) => 12 - i)); assert.strictEqual(errado.acerta, false); assert.match(errado.leitura, /NÃO acompanha/);
  const pouco = P.calibrar(pares((i) => i).slice(0, 5)); assert.strictEqual(pouco.acerta, null); assert.strictEqual(pouco.amostra, 'pequena');
});

test('coletar: guarda a foto, o placar e um ponto por dia na série de cada post recente; leitura parcial não troca o placar', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true })); const a = arm.armazem(); const agora = Date.parse('2026-11-11T10:00:00Z');
  const c = { id: 'c_x', titulo: 'X', schema: 1, status: 'publicado', top: { formato: 'tweet', origem: 'piloto', mentes: { roteiro: 'halbert' }, escolha: { versao: 0, capas: [0], nota: 8 }, versoes: [{ capas: [{ mecanismo: 'numero' }] }] } };
  a.conteudos.obter = async (conta, id) => (id === 'c_x' ? { doc: c, rev: 1 } : null);
  const posts = [post('p1', { publicado_em: '2026-11-05T12:00:00Z', da_ferramenta: true, content_id: 'c_x' }), post('velho', { publicado_em: '2026-09-01T12:00:00Z' })];
  const deps = { armazem: a, listarPublicacoes: async () => [{ estado: 'publicada', ig_media_id: 'p1', content_id: 'c_x' }], atualizar: async ({ daFerramenta }) => { assert.strictEqual(daFerramenta.get('p1'), 'c_x'); return { gerado_em: new Date(agora).toISOString(), parcial: false, posts }; } };
  const r = await P.coletar({ agora, deps });
  assert.strictEqual(r.pontos_gravados, 1, 'só o post com menos de 14 dias ganha ponto');
  assert.strictEqual(r.placar.por.formato[0].valor, 'tweet');
  const cfg = await a.config.obter(ACCOUNT.ig_id); assert.ok(cfg.meu_instagram.posts.length === 2); assert.strictEqual(cfg.meu_placar.ferramenta.n, 1);
  assert.strictEqual((await P.coletar({ agora: agora + 3600000, deps })).pontos_gravados, 0, 'no mesmo dia não repete o ponto');
  assert.strictEqual((await P.coletar({ agora: agora + 26 * 3600000, deps })).pontos_gravados, 1);
  assert.strictEqual((await a.radar.obter(ACCOUNT.ig_id, P.TIPO_SERIE, 'p1')).doc.pontos.length, 2);
  await P.coletar({ agora: agora + 50 * 3600000, deps: { ...deps, atualizar: async () => ({ gerado_em: 'x', parcial: true, posts: [] }) } });
  assert.strictEqual((await a.config.obter(ACCOUNT.ig_id)).meu_placar.ferramenta.n, 1, 'leitura parcial não apaga o placar bom');
});

test('redatores: sem pesos a dupla sai no rodízio de sempre; com pesos a dupla forte escreve mais vezes, e as outras continuam', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `c_${i}`);
  assert.deepStrictEqual(Mentes.parPara('c_1').map((m) => m.id), Mentes.parPara('c_1', null).map((m) => m.id));
  const conta = new Map(); for (const id of ids) { const k = Mentes.parPara(id, { halbert: 0.9, ogilvy: 0.1 }).map((m) => m.id).join('+'); conta.set(k, (conta.get(k) || 0) + 1); }
  const forte = [...conta.entries()].find(([k]) => k.includes('halbert'))[1]; const fraca = [...conta.entries()].find(([k]) => k.includes('ogilvy'))[1];
  assert.ok(forte > fraca, `a dupla do redator forte escreve mais (${forte} × ${fraca})`);
  assert.strictEqual(conta.size, Mentes.PARES.length, 'todas as duplas continuam escrevendo (exploração)');
});

test('post antigo da ferramenta sem registro de publicação é reconhecido pela assinatura da legenda e sai da base do Pedro', async () => {
  const MI = require('./meuInstagram');
  assert.ok(MI.ASSINATURA_FERRAMENTA.test('Texto do post.\n\nFonte: Agência Brasil (informações segundo a reportagem).\n\nFoto: Fulano (CC BY 2.0)'));
  assert.ok(!MI.ASSINATURA_FERRAMENTA.test('Hoje eu fui na fonte e vi a reportagem do jornal.'));
  const grafo = async (metodo, caminho, q) => {
    if (/\/media$/.test(caminho)) return { data: [
      { id: '1', caption: 'Dólar sobe.\n\nFonte: InfoMoney (informações segundo a reportagem).', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', timestamp: '2026-11-01T12:00:00+0000' },
      { id: '2', caption: 'Minha história com a maquininha.', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', timestamp: '2026-11-02T12:00:00+0000' }] };
    if (/\/insights$/.test(caminho)) return { data: (q.metric || '').split(',').map((name) => ({ name, values: [{ value: 100 }] })) };
    return { username: 'pedro_destrava', followers_count: 1, media_count: 2 };
  };
  const s = await MI.atualizar({ grafo, igId: 'ig', agora: Date.parse('2026-11-11T12:00:00Z') });
  const por = Object.fromEntries(s.posts.map((p) => [p.id, p]));
  assert.strictEqual(por['1'].da_ferramenta, true); assert.strictEqual(por['1'].reconhecido_pela_legenda, true); assert.strictEqual(por['1'].content_id, null);
  assert.strictEqual(por['2'].da_ferramenta, false);
});
