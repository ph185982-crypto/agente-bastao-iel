// Growth Dashboard, Diagnóstico e DNA Editorial. Os posts abaixo são FIXTURES de teste (nunca aparecem em produção).
// node --test backend/lib/crescimento.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('./crescimento');
const Dna = require('./dnaEditorial');
const arm = require('./armazem');
const { invokeRoute } = require('./invokeRoute');

const AGORA = Date.parse('2026-11-20T12:00:00Z'); const DIA = 86400000;
let seq = 0;
const post = (diasAtras, o = {}) => ({ id: `p${++seq}`, tipo: 'reel', publicado_em: new Date(AGORA - diasAtras * DIA).toISOString(), maduro: true, alcance: 10000, compartilhamentos: 50, salvamentos: 30, visualizacoes: 15000, legenda: 'Como a loja ganha dinheiro com o preço', ...o });

test('painel: KPIs reais, medianas e comparação com o período anterior; o que a Meta não entrega fica indisponível com o motivo', () => {
  const posts = [...Array.from({ length: 6 }, (_, i) => post(2 + i * 3, { compartilhamentos: 100, curtidas: 400, comentarios: 10, tempo_medio_s: 12, duracao_s: 30, assistido_pct: 40 })),
    ...Array.from({ length: 6 }, (_, i) => post(32 + i * 3, { compartilhamentos: 50 }))];
  const p = C.painel({ posts, agora: AGORA, dias: 30, seguidores: 165000 });
  const k = (id) => p.kpis.find((x) => x.id === id);
  assert.strictEqual(k('seguidores_atuais').valor, 165000);
  assert.strictEqual(k('envios_mil').valor, 10); assert.strictEqual(k('envios_mil').anterior, 5); assert.strictEqual(k('envios_mil').variacao_pct, 100);
  assert.strictEqual(k('curtidas_mil').valor, 40); assert.strictEqual(k('comentarios').valor, 60);
  assert.strictEqual(k('tempo_medio_s').valor, 12); assert.strictEqual(k('retencao_pct').valor, 40);
  for (const id of ['seguidores_perdidos', 'conclusao', 'cliques', 'diagnosticos', 'conversoes']) { assert.strictEqual(k(id).disponivel, false, id); assert.ok(k(id).motivo, id); }
  assert.strictEqual(k('seguidores_novos').disponivel, false, 'sem série diária da Meta não inventa');
  assert.strictEqual(p.posts.maduros, 6); assert.ok(p.anterior.comparavel);
});

test('painel: post com menos de 72 h não entra; sem amostra o painel diz que faltam posts e não recomenda nada', () => {
  const posts = [post(1, { maduro: false }), post(5), post(9)];
  const p = C.painel({ posts, agora: AGORA, dias: 30 });
  assert.strictEqual(p.posts.maduros, 2); assert.strictEqual(p.posts.ainda_acumulando, 1);
  assert.match(p.decisao.aprendizado, /preciso de 5/); assert.deepStrictEqual(p.decisao.funciona, []);
  assert.strictEqual(p.decisao.dados_suficientes, false);
  const vazio = C.painel({ posts: [], agora: AGORA });
  assert.match(vazio.decisao.aprendizado, /Sem posts maduros/); assert.match(vazio.decisao.proxima_acao, /Atualize os números/);
});

test('painel: tema com resultado ≥ 1,3× a mediana geral e amostra suficiente vira aprendizado, oportunidade e próxima ação', () => {
  const ia = Array.from({ length: 5 }, (_, i) => post(2 + i, { legenda: 'O que o ChatGPT faz com a sua loja', compartilhamentos: 200, salvamentos: 100 }));
  const resto = Array.from({ length: 15 }, (_, i) => post(3 + i, { legenda: 'Curiosidade sobre a origem do pão', compartilhamentos: 40, salvamentos: 20 }));
  const p = C.painel({ posts: [...ia, ...resto], agora: AGORA, dias: 30 });
  assert.ok(p.decisao.funciona.some((t) => /Inteligência artificial/.test(t)));
  assert.match(p.decisao.aprendizado, /Inteligência artificial/); assert.match(p.decisao.aprendizado, /indício a testar/);
  assert.match(p.decisao.oportunidade, /25% dos posts/); assert.match(p.decisao.proxima_acao, /série de 3 posts/);
});

test('painel: seguidores novos vêm da série diária da Meta só quando o período cabe nos 30 dias', () => {
  const serie = { follower_count: Array.from({ length: 30 }, (_, i) => ({ fim: new Date(AGORA - (29 - i) * DIA).toISOString(), valor: 10 })) };
  const p7 = C.painel({ posts: [], serie, agora: AGORA, dias: 7 });
  const k7 = p7.kpis.find((x) => x.id === 'seguidores_novos');
  assert.strictEqual(k7.valor, 70); assert.strictEqual(k7.anterior, 70);
  const k90 = C.painel({ posts: [], serie, agora: AGORA, dias: 90 }).kpis.find((x) => x.id === 'seguidores_novos');
  assert.strictEqual(k90.disponivel, false); assert.match(k90.motivo, /30 dias/);
});

test('diagnóstico: sem as datas da transição não escolhe por conta própria; com datas separa A, B e C e só compara com amostra suficiente', () => {
  assert.strictEqual(C.diagnostico({ posts: [post(10)], transicao: {} , agora: AGORA }).configurado, false);
  const A = Array.from({ length: 6 }, (_, i) => post(100 + i, { compartilhamentos: 20 }));
  const B = Array.from({ length: 3 }, (_, i) => post(60 + i, { compartilhamentos: 40 }));
  const Cc = Array.from({ length: 6 }, (_, i) => post(5 + i, { compartilhamentos: 80, legenda: 'Quanto a Shopee cobra de taxa por venda' }));
  const d = C.diagnostico({ posts: [...A, ...B, ...Cc], transicao: { inicio_b: '2026-09-01', inicio_c: '2026-11-01' }, pilares: Dna.PADRAO.pilares, agora: AGORA });
  assert.strictEqual(d.configurado, true);
  assert.strictEqual(d.periodos.A.n, 6); assert.strictEqual(d.periodos.B.n, 3); assert.strictEqual(d.periodos.C.n, 6);
  assert.strictEqual(d.periodos.B.amostra, 'indicio');
  assert.strictEqual(d.comparacoes.envios_mil.razao, 4);
  assert.ok(d.relatorio.forcas.some((t) => /envios por mil/.test(t)));
  assert.ok(d.relatorio.plano_30_dias.length >= 1);
  const pequeno = C.diagnostico({ posts: [...A.slice(0, 2), ...Cc.slice(0, 2)], transicao: { inicio_b: '2026-09-01', inicio_c: '2026-11-01' }, agora: AGORA });
  assert.strictEqual(pequeno.comparacoes.envios_mil, null); assert.ok(pequeno.relatorio.fraquezas.some((t) => /não é confiável/.test(t)));
});

test('juntarPosts: a foto recente vence o arquivo e o arquivo estende além dos 90 dias', () => {
  const j = C.juntarPosts([{ id: 'a', publicado_em: '2026-11-10T00:00:00Z', alcance: 2 }], [{ id: 'a', publicado_em: '2026-11-10T00:00:00Z', alcance: 1 }, { id: 'b', publicado_em: '2026-01-01T00:00:00Z', alcance: 3 }]);
  assert.deepStrictEqual(j.map((p) => [p.id, p.alcance]), [['a', 2], ['b', 3]]);
});

test('DNA editorial: padrão traz posicionamento, promessa e pilares; valida soma dos pilares, datas e proibidas; banco só guarda o que o Pedro escreve', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const d = await Dna.ler();
  assert.match(d.promessa, /quem ganha, quem paga/); assert.strictEqual(d.pilares.reduce((s, p) => s + p.pct, 0), 100); assert.strictEqual(d.series.length, 5);
  assert.throws(() => Dna.validar({ pilares: [{ id: 'a', nome: 'A', pct: 60 }, { id: 'b', nome: 'B', pct: 60 }] }), /somar 100/);
  assert.throws(() => Dna.validar({ transicao: { inicio_b: '2026-11-01', inicio_c: '2026-10-01' } }), /depois/);
  assert.throws(() => Dna.validar({ transicao: { inicio_b: 'ontem' } }), /AAAA-MM-DD/);
  const s = await Dna.salvar({ transicao: { inicio_b: '2026-09-01', inicio_c: '2026-11-01' }, expressoes_proibidas: ['Você sabia', 'sinergia'] });
  assert.deepStrictEqual(s.transicao, { inicio_b: '2026-09-01', inicio_c: '2026-11-01' });
  assert.strictEqual((await Dna.ler()).expressoes_proibidas[1], 'sinergia');
  await assert.rejects(Dna.adicionarAoBanco({ tipo: 'opiniao', texto: 'curto' }), /20 caracteres/);
  const { item } = await Dna.adicionarAoBanco({ tipo: 'opiniao', texto: 'Eu acho que desconto vicia o cliente e destrói a margem da loja.' });
  assert.match(Dna.blocoParaPrompt(await Dna.ler()), /Opinião: Eu acho que desconto vicia/);
  assert.match(Dna.blocoParaPrompt(Dna.PADRAO), /Não invente opinião nem experiência pessoal/);
  await Dna.apagarDoBanco(item.id); assert.strictEqual((await Dna.ler()).banco.length, 0);
  const rx = Dna.regexProibidas(await Dna.ler());
  assert.ok(rx.test('Você sabia que o preço sobe?')); assert.ok(rx.test('Isso é pura sinergia.')); assert.ok(!rx.test('Eu sabia que ia subir'));
});

test('rotas: painel e diagnóstico respondem sem banco de dados e o DNA grava e lê', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const R = require('../routes/crescimento');
  const p = await invokeRoute(R, 'GET', '/painel?dias=7'); assert.strictEqual(p.periodo.dias, 7); assert.strictEqual(p.vazio, true);
  const d = await invokeRoute(R, 'GET', '/diagnostico'); assert.strictEqual(d.configurado, false);
  const g = await invokeRoute(R, 'PUT', '/dna', { transicao: { inicio_b: '2026-09-01', inicio_c: '2026-11-01' } }); assert.strictEqual(g.transicao.inicio_c, '2026-11-01');
  await assert.rejects(invokeRoute(R, 'PUT', '/dna', { transicao: { inicio_b: 'x' } }), (e) => e.status === 400);
});

test('DNA entra no motor de roteiros: prompt do roteirista e do ângulo levam o DNA e o fiscal barra as expressões proibidas', () => {
  const R = require('./roteiros');
  const Ang = require('./roteiros/angulo');
  const dna = { ...Dna.PADRAO, banco: [{ id: 'x', tipo: 'opiniao', texto: 'Eu acho que desconto vicia o cliente.', criado_em: '' }] };
  assert.match(R.promptRoteirista({ formato: 'F1', dna }), /DNA EDITORIAL DO PEDRO[\s\S]*quem ganha, quem paga[\s\S]*Opinião: Eu acho que desconto vicia/);
  assert.match(Ang.promptAngulo({ pauta: { texto: 'x' }, formato: 'F1', formatoNome: 'Mito', estrutura: 'e', dna }), /DNA EDITORIAL DO PEDRO/);
  assert.doesNotMatch(R.promptRoteirista({ formato: 'F1' }), /DNA EDITORIAL DO PEDRO/);
  const r = { gancho: 'Todo desconto sai do seu lucro.', tela_gancho: 'DESCONTO SAI DO LUCRO', blocos: [{ fala: 'Nos dias de hoje o cliente espera desconto sempre.', tela: 'x' }, { fala: 'Outra frase.', tela: 'y' }], payoff: 'Segure o preço.', cta: 'Manda.', visual: 'v', foreshadow: 'f' };
  const f = R.fiscalCodigo(r, { texto: '' }, { dna });
  assert.ok(f.problemas.some((p) => p.criterio === 15 && /DNA Editorial/.test(p.motivo)));
  assert.ok(!R.fiscalCodigo({ ...r, blocos: [{ fala: 'O cliente espera desconto sempre.', tela: 'x' }, r.blocos[1]] }, { texto: '' }, { dna }).problemas.some((p) => /DNA Editorial/.test(p.motivo)));
});
