// Padrão de produção do @pedro_destrava aplicado ao motor: prompt, gates e problemas de forma.
// node --test backend/lib/padraoProducao.test.js
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');
const E = require('../../static/editorial');
const PB = require('../../static/viralPlaybook');
const llmReal = require('./llmJson');
const { gerarCopia, montarVersao } = require('./redacao');

const ids = (r) => [...r.bloqueios.map((b) => b.id), ...r.sugestoes.map((s) => s.id)];
const bloq = (c) => G.bloqueios(c, {}).map((b) => b.id);
const sug = (c) => G.sugestoes(c, {}).map((s) => s.id);

function conteudo(slides, extra = {}) {
  const c = M.novoConteudo({ titulo: 'FIXTURE: padrão de produção', origem: { tipo: 'link', url: 'https://exemplo.test/m' } });
  c.fonte_principal = { url: 'https://exemplo.test/m', titulo: 'Fixture', origem: 'Exemplo', texto: 'Texto da fonte.' };
  c.claims = [{ id: 'a1', texto: 'O governo anunciou a medida.', tipo: 'fato', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [] }];
  c.evidencias = [{ id: 'e1', tipo: 'primaria', trecho: 'O governo anunciou a medida.', origem: 'Fonte', relacao: 'sustenta' }];
  M.criarVersao(c, { estrutura: 'acontecimento', capa_escolhida: null, capas: [], slides, legenda: 'Segundo a fonte, o governo anunciou a medida.', legenda_claim_ids: ['a1'], cta: 'Segue o @pedro_destrava para ver o que cada decisão faz com o seu caixa.', hashtags: ['#economia', '#mei', '#politica'], ...extra }, { quem: 'teste' });
  return c;
}
const s = (n, funcao, texto, mais = {}) => ({ id: `s${n}`, funcao, layout: funcao === 'capa' ? 'capa_tipografica' : funcao === 'encerramento' ? 'encerramento' : funcao === 'prova' ? 'prova' : 'explicacao', texto, claim_ids: funcao === 'encerramento' ? [] : ['a1'], ...mais });

const SETE = () => [
  s(1, 'capa', 'Governo muda regra e o seu caixa sente'),
  s(2, 'contexto', 'Poucos reparam que a mudança mexe em outra conta.'),
  s(3, 'prova', 'O governo anunciou a medida em outubro.'),
  s(4, 'consequencia', 'Quem vende todo mês paga a diferença no fim.'),
  s(5, 'opiniao', 'Na minha leitura, isso pesa mais para quem empreende.'),
  s(6, 'explicacao', 'Por isso vale acompanhar o próximo passo da medida.'),
  s(7, 'encerramento', 'Segue o perfil.'),
];

test('prompt: o posicionamento, a estrutura e a frase proibida fazem parte da direção editorial', () => {
  assert.match(E.VOZ, /estratégia escondida por trás/);
  assert.match(E.VOZ, /responsabilidade fiscal/);
  assert.match(E.VOZ, /família/);
  assert.match(E.VOZ, /iniciativa privada/);
  assert.match(E.VOZ, /NUNCA autoriza inventar fato/, 'a voz continua subordinada aos fatos');
  const p = E.padraoParaPrompt();
  ['FACE', 'GAP', 'PROVA', 'CONTRADIÇÃO OU CONSEQUÊNCIA', 'LEITURA DO PEDRO', 'CTA'].forEach((e) => assert.ok(p.includes(e), e));
  assert.match(p, /de 6 a 7 slides/);
  assert.match(p, /25 a 45 palavras/);
  assert.match(p, /NUNCA use a expressão "pensar antes de reagir"/);
  assert.match(p, /Nunca invente manchete, depoimento, número ou documento/);
  assert.ok(!/QUANTIDADE/.test(E.padraoParaPrompt({ formato: 'estatico' })), 'post único não tem contagem de slides');
  assert.deepStrictEqual(E.ESTRUTURA_PADRAO.map((e) => e.etapa.split(' ')[0]), ['FACE', 'GAP', 'PROVA', 'CONTRADIÇÃO', 'LEITURA', 'CTA']);
  // toda função citada no padrão existe de verdade
  E.ESTRUTURA_PADRAO.flatMap((e) => e.funcoes).forEach((f) => assert.ok(E.FUNCOES_SLIDE[f], f));
});

test('critério de aprovação: as 7 perguntas, e o que o código não confere fica marcado', () => {
  assert.strictEqual(E.CRITERIO_APROVACAO.length, 7);
  assert.deepStrictEqual(E.CRITERIO_APROVACAO.filter((x) => !x.codigo).map((x) => x.id), ['capa_faz_parar', 'humana_legivel']);
});

test('copy: o prompt enviado à IA carrega o padrão de produção e a base de 6 a 7 slides', async () => {
  const chamadas = [];
  const llm = { ...llmReal, pedirJson: async (p) => { chamadas.push(p.usuario); return { dados: { capas: [], slides: [], legenda: '', cta: '' }, llm: { provider: 'teste', model: 'falso' } }; } };
  const fonte = { titulo: 'Fixture', veiculo: 'X', texto: 'Texto.' };
  const claims = [{ id: 'a1', texto: 'O governo anunciou a medida.', tipo: 'fato', central: true, estado: 'sustentada', valores: [], evidencias: ['e1'], revisao: {} }];
  await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias: [{ id: 'e1', origem: 'X', relacao: 'sustenta' }] }, { llmJson: llm });
  assert.match(chamadas[0], /PADRÃO DE PRODUÇÃO DO PERFIL/);
  assert.match(chamadas[0], /FACE[\s\S]*GAP[\s\S]*PROVA[\s\S]*LEITURA DO PEDRO[\s\S]*CTA/);
  assert.match(chamadas[0], /Base de 6 a 7 slides contando o encerramento fixo/);
  assert.match(chamadas[0], /pensar antes de reagir/);
});

test('gate: "pensar antes de reagir" bloqueia em slide, legenda, CTA e nas variações', () => {
  assert.ok(!bloq(conteudo(SETE())).includes('frase_proibida'), 'texto limpo passa');
  const noSlide = SETE(); noSlide[5].texto = 'O recado é pensar antes de reagir a cada notícia.';
  const b1 = G.bloqueios(conteudo(noSlide), {}).find((b) => b.id === 'frase_proibida');
  assert.ok(b1, 'no slide'); assert.strictEqual(b1.eixo, 'redacao'); assert.strictEqual(b1.onde.indice, 6);
  assert.ok(bloq(conteudo(SETE(), { legenda: 'Hoje: Pensar antes de reagir faz diferença.' })).includes('frase_proibida'), 'na legenda');
  assert.ok(bloq(conteudo(SETE(), { cta: 'Pense antes de reagir e segue o @pedro_destrava.' })).includes('frase_proibida'), 'no CTA');
  const gerundio = SETE(); gerundio[3].texto = 'Pensando antes de reagir, o MEI economiza.';
  assert.ok(bloq(conteudo(gerundio)).includes('frase_proibida'), 'gerúndio');
  const comAcento = SETE(); comAcento[3].texto = 'PENSAR ANTES DE REAGIR é o conselho.';
  assert.ok(bloq(conteudo(comAcento)).includes('frase_proibida'), 'caixa alta');
  assert.strictEqual(G.avaliar(conteudo(noSlide)).resumo.redacao, 'bloqueada');
  const ok = SETE(); ok[3].texto = 'Antes de reagir ao anúncio, veja a conta.';
  assert.ok(!bloq(conteudo(ok)).includes('frase_proibida'), 'frase parecida mas diferente não é bloqueada');
});

test('o playbook de viralização também trata a expressão como clichê', () => {
  assert.ok(PB.CLICHES.includes('pensar antes de reagir'));
  assert.match(PB.resumoParaPrompt(), /pensar antes de reagir/);
});

test('sugestões: carrossel completo de 7 telas na ordem do padrão não recebe avisos de estrutura', () => {
  const r = sug(conteudo(SETE()));
  ['poucos_slides', 'muitos_slides', 'sem_leitura_do_pedro', 'sem_prova', 'penultimo_nao_fecha', 'segundo_repete_capa', 'legenda_longa'].forEach((x) => assert.ok(!r.includes(x), x));
});

test('sugestões: carrossel curto, sem prova nem posição, avisa (sem bloquear)', () => {
  const c = conteudo([s(1, 'capa', 'Governo muda regra e o seu caixa sente'), s(2, 'contexto', 'Poucos reparam que a mudança mexe em outra conta.'), s(3, 'encerramento', 'Segue o perfil.')]);
  const r = sug(c);
  ['poucos_slides', 'sem_leitura_do_pedro', 'sem_prova'].forEach((x) => assert.ok(r.includes(x), x));
  assert.ok(!bloq(c).includes('poucos_slides'), 'é só sugestão');
  const longo = SETE(); for (let i = 0; i < 4; i++) longo.splice(5, 0, s(20 + i, 'explicacao', `Detalhe novo número ${i} sobre a medida e seus efeitos.`));
  assert.ok(sug(conteudo(longo)).includes('muitos_slides'), '11 telas passam da base');
});

test('sugestões: o segundo slide não pode retomar a capa com outras palavras', () => {
  const rep = SETE(); rep[1].texto = 'Governo muda regra e o seu caixa sente o impacto.';
  assert.ok(sug(conteudo(rep)).includes('segundo_repete_capa'));
  assert.ok(!sug(conteudo(SETE())).includes('segundo_repete_capa'));
});

test('sugestões: o último slide antes do encerramento precisa fechar o raciocínio', () => {
  const lista = SETE(); lista[5] = s(6, 'prova', 'Outro dado solto sobre a medida do governo.');
  assert.ok(sug(conteudo(lista)).includes('penultimo_nao_fecha'));
});

test('sugestões: legenda longa e carrossel de um post único não recebem avisos de estrutura', () => {
  assert.ok(sug(conteudo(SETE(), { legenda: 'x '.repeat(400) })).includes('legenda_longa'));
  const unico = conteudo([s(1, 'capa', 'Governo muda regra e o seu caixa sente')], { formato: 'estatico' });
  const r = sug(unico);
  ['poucos_slides', 'sem_prova', 'sem_leitura_do_pedro'].forEach((x) => assert.ok(!r.includes(x), x));
});

test('forma: a redação devolve problema quando usa a frase proibida ou repete a capa no segundo slide', () => {
  const claims = [{ id: 'a1', texto: 'O governo anunciou a medida.', tipo: 'fato', estado: 'sustentada' }];
  const base = (slides, extra = {}) => ({ capas: [], slides, legenda: 'Segundo a fonte, o governo anunciou.', legenda_claim_ids: ['a1'], cta: 'Segue o @pedro_destrava para ver o que muda no seu caixa', ...extra });
  const normal = montarVersao({ dados: base([{ funcao: 'capa', texto: 'Governo muda regra e o seu caixa sente', claim_ids: ['a1'] }, { funcao: 'contexto', texto: 'Poucos reparam na outra conta.', claim_ids: ['a1'] }, { funcao: 'prova', texto: 'O governo anunciou a medida.', claim_ids: ['a1'] }]), claims, evidencias: [], formato: 'carrossel' });
  assert.ok(!normal.problemas.some((p) => /pensar antes de reagir|repete a capa/.test(p)));
  const ruim = montarVersao({ dados: base([{ funcao: 'capa', texto: 'Governo muda regra e o seu caixa sente', claim_ids: ['a1'] }, { funcao: 'contexto', texto: 'Governo muda regra e o seu caixa sente mais.', claim_ids: ['a1'] }, { funcao: 'prova', texto: 'Hora de pensar antes de reagir.', claim_ids: ['a1'] }]), claims, evidencias: [], formato: 'carrossel' });
  assert.ok(ruim.problemas.some((p) => /“pensar antes de reagir”/.test(p)), 'frase proibida');
  assert.ok(ruim.problemas.some((p) => /segundo slide repete a capa/.test(p)), 'segundo slide');
});

test('o encerramento fixo continua sendo o último slide e não entra como tela da IA', () => {
  const claims = [{ id: 'a1', texto: 'O governo anunciou a medida.', tipo: 'fato', estado: 'sustentada' }];
  const r = montarVersao({ dados: { capas: [], slides: [{ funcao: 'capa', texto: 'Governo muda regra', claim_ids: ['a1'] }, { funcao: 'prova', texto: 'O governo anunciou a medida.', claim_ids: ['a1'] }, { funcao: 'encerramento', texto: 'Eu comecei o Pedro Destrava por isso', claim_ids: [] }], legenda: '', cta: 'Segue o @pedro_destrava para ver o que muda no seu caixa' }, claims, evidencias: [], formato: 'carrossel' });
  const f = r.versao.slides.map((x) => x.funcao);
  assert.strictEqual(f.filter((x) => x === 'encerramento').length, 1);
  assert.strictEqual(f[f.length - 1], 'encerramento');
  assert.match(r.versao.slides.at(-1).texto, /^Segue o @pedro_destrava/, 'o texto do fecho vem do campo cta, não da IA');
});
