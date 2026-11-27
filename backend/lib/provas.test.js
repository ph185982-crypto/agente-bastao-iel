// Provas do dia: ideias de vídeo que partem de prova de demanda; Reel de teste; plano de volume. Dados abaixo são FIXTURES.
// node --test backend/lib/provas.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('./provas');
const A = require('./raioXAnalise');
const R = require('./roteiros');
const arm = require('./armazem');
const { invokeRoute } = require('./invokeRoute');

const AGORA = Date.parse('2026-11-27T12:00:00Z'); const DIA = 86400000;
let seq = 0;
const post = (dias, o = {}) => ({ id: `m${++seq}`, tipo: 'carrossel', em: new Date(AGORA - dias * DIA).toISOString(), legenda: 'Por que a loja cobra mais caro no cartão de crédito', alcance: 4000, envios: 8, salvos: 4, seguidores: 0, comentarios: 1, ...o });
const analise = () => A.analisar({ agora: AGORA, conta: { perfil: { followers_count: 165000 } }, posts: [
  ...Array.from({ length: 14 }, (_, i) => post(6 + i * 2)),
  post(20, { id: 'forte', alcance: 60000, envios: 900, salvos: 300, seguidores: 80, legenda: 'A taxa escondida da maquininha que come o lucro da sua venda' }),
  post(22, { id: 'frase1', tipo: 'imagem', alcance: 50000, envios: 800, legenda: '“Frase famosa” — Autor', ficha: { tipo: 'frase' } }),
] });
const viral = (o = {}) => ({ id: 'v1', tese: 'Desconto ensina o cliente a esperar o preço cair', tema: 'desconto vicia cliente', vl: 6.2, tipo: 'reel', visualizacoes: 2100000, conta: { handle: 'contax', pais: 'US' }, publicado_em: new Date(AGORA - 2 * DIA).toISOString(), ponte_pedro: 'Lojista brasileiro vive de promoção', analise: { motivo: 'contraria o senso comum', angulo_pedro: 'quem ganha com o desconto' }, ...o });

test('vencedor próprio vira ideia com a prova; frase famosa e clone ficam de fora', () => {
  const v = P.dosVencedores(analise(), { agora: AGORA });
  assert.ok(v.some((x) => x.chave === 'pv:forte')); assert.ok(!v.some((x) => x.chave === 'pv:frase1'), 'frase famosa não é ideia do Pedro');
  const f = v.find((x) => x.chave === 'pv:forte');
  assert.match(f.evidencia, /alcance 60\.000 \(15× a sua mediana\)/); assert.match(f.pauta, /EPISÓDIO NOVO/); assert.ok(f.forca > 80);
});

test('viral do mercado: a prova é quantas vezes passou a mediana da própria conta; a origem não vai para o texto falado', () => {
  const [x] = P.dosVirais([viral(), viral({ id: 'fraco', vl: 1.2 }), viral({ id: 'sem', tese: null })], { agora: AGORA });
  assert.strictEqual(x.chave, 'rc:v1'); assert.match(x.evidencia, /Reel de @contax \(US\) há 2 dia\(s\): 6,2× a mediana da própria conta, 2\.100\.000 visualizações/);
  assert.match(x.pauta, /não cite a origem/); assert.strictEqual(P.dosVirais([viral({ vl: 1.2 })]).length, 0);
});

test('montar: ordena pela força, tira o que já virou roteiro e assunto repetido, e não deixa uma fonte dominar o topo', () => {
  const virais = Array.from({ length: 6 }, (_, i) => viral({ id: `v${i}`, vl: 9 - i, tese: `Tese número ${i} sobre assunto diferente ${'xyz'.repeat(i + 1)}`, tema: `assunto ${i} ${'abc'.repeat(i + 1)} diferente` }));
  const lista = P.montar({ analise: analise(), virais, perguntas: [{ n: 4, exemplo: 'Como calcular a margem do produto na Shopee?' }], aprovadas: [{ id: 'a1', texto: 'Pauta aprovada', origem: { tipo: 'estrategia_criativa' } }], usadas: new Set(['rc:v0']), agora: AGORA });
  assert.strictEqual(lista[0].fonte, 'aprovada'); assert.ok(!lista.some((x) => x.chave === 'rc:v0'));
  assert.ok(new Set(lista.slice(0, 5).map((x) => x.fonte)).size >= 3, 'o topo mistura fontes');
  assert.ok(lista.every((x) => x.rotulo_fonte && x.evidencia));
  assert.strictEqual(P.montar({}).length, 0, 'sem dado, nenhuma ideia é inventada');
});

test('DNA dos vencedores só entra no prompt com amostra; plano recomendado desliga a linha fraca e limita as outras a 1', () => {
  assert.strictEqual(P.dnaDosVencedores(null), ''); assert.strictEqual(P.dnaDosVencedores({ maduros: 5, padroes: { repetir: [{ texto: 'x' }], parar: [] } }), '');
  const d = P.dnaDosVencedores({ maduros: 30, padroes: { repetir: [{ texto: 'Pergunta: 5 de 9 entre os melhores' }], parar: [{ texto: 'Citação: 0 de 12' }] }, retencao: { pulou_3s_pct: 71, n_pulou: 8 }, geral: { coment_mil: 0.1 } });
  assert.match(d, /Funciona: Pergunta/); assert.match(d, /Não funciona: Citação/); assert.match(d, /71% das visualizações/); assert.match(d, /pergunta de escolha/);
  assert.match(R.promptRoteirista({ formato: 'F1', provas: d }), /NÚMEROS REAIS DESTE PERFIL/);
  const plano = P.planoRecomendado({ maduros: 40, achados: [{ mix: 'frase' }] }, { frase: 10, noticia: 0, marca: 15, revelacao: 15 });
  assert.deepStrictEqual(plano.mix, { frase: 0, noticia: 0, marca: 1, revelacao: 1 }); assert.strictEqual(plano.roteiros_dia, 3); assert.strictEqual(plano.com_dado, true);
  assert.deepStrictEqual(P.planoRecomendado(null, { frase: 2, noticia: 0, marca: 0, revelacao: 0 }).mix, { frase: 1, noticia: 0, marca: 0, revelacao: 0 });
});

test('motor de roteiros: vencedor próprio entra na frente das teses virais e a evidência vai para o cartão; prova escolhida não duplica', async () => {
  const fontes = await R.pautas({ est: {}, deps: { analiseRaioX: analise(), teses: async () => [viral()], historias: async () => [], pautasComunidade: async () => [] } });
  assert.strictEqual(fontes.tese[0].chave, 'pv:forte'); assert.strictEqual(fontes.tese[0].origem_pauta.fonte, 'seu_vencedor');
  const v = fontes.tese.find((t) => t.chave === 'rc:v1'); assert.match(v.origem_pauta.evidencia, /6,2× a mediana/);
  const escolhida = await R.pautas({ est: {}, deps: { analiseRaioX: null, teses: async () => [viral()], historias: async () => [], pautasComunidade: async () => [{ id: 'p9', texto: 'TESE…', ideia: 'desconto', origem: { tipo: 'prova', fonte: 'viral', evidencia: 'Reel de @contax', chave: 'rc:v1' } }] } });
  assert.deepStrictEqual(escolhida.tese.map((t) => t.chave), ['pc:p9']); assert.match(escolhida.tese[0].texto, /IDEIA ESCOLHIDA PELO PEDRO NAS PROVAS DO DIA/);
});

test('Reel de teste: o publicador manda trial_params só quando o vídeo está marcado como teste', () => {
  const src = require('fs').readFileSync(require.resolve('./publicador.js'), 'utf8');
  assert.match(src, /c\.video\?\.teste===true\?\{trial_params:JSON\.stringify\(\{graduation_strategy:'SS_PERFORMANCE'\}\)\}:\{share_to_feed:true\}/);
});

test('rotas: provas, escolher, pausar linha, plano (só com confirmação) e leitura guardada do Raio-X', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const Rt = require('../routes/crescimento');
  const p = await invokeRoute(Rt, 'GET', '/provas'); assert.ok(Array.isArray(p.ideias)); assert.strictEqual(p.tem_raio_x, false); assert.ok(p.plano.mix);
  await assert.rejects(invokeRoute(Rt, 'POST', '/provas/escolher', { chave: 'rc:nao-existe' }), (e) => e.status === 404);
  await assert.rejects(invokeRoute(Rt, 'POST', '/provas/plano', {}), (e) => e.status === 400);
  const ap = await invokeRoute(Rt, 'POST', '/provas/plano', { confirmar: true }); assert.strictEqual(ap.piloto.roteiros_dia, 3);
  await assert.rejects(invokeRoute(Rt, 'POST', '/provas/pausar-linha', { mix: 'xyz' }), (e) => e.status === 400);
  assert.deepStrictEqual(await invokeRoute(Rt, 'GET', '/raio-x/relatorio'), { vazio: true });
});
