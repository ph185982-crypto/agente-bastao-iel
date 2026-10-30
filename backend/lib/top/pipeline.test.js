// Carrossel "top": do link ao "Para aprovar", com IA simulada. Confere fatos pelo trecho, números, júri e portões.
// node --test backend/lib/top/pipeline.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const arm = require('../armazem');
const T = require('./pipeline');
const K = require('./checagem');
const M = require('../../../static/contentModel');
const { ACCOUNT } = require('../account');

// Matéria FICTÍCIA de teste (números inventados para o teste, não são dados reais).
const MATERIA = 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026, segundo o relatório divulgado nesta segunda-feira. Em dezembro de 2022, o mesmo índice era de 71,7%. O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta. Analistas ouvidos pela reportagem dizem que o patamar é o maior em cinco anos e que a conta recai sobre quem empreende, com juros mais altos para pequenas empresas.';
const FATOS = { protagonista: 'Fulano de Tal', fatos: [
  { id: 'a', texto: 'O índice chegou a 82,9% em agosto de 2026.', trecho: 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026', tipo: 'fato' },
  { id: 'b', texto: 'Em dezembro de 2022 o índice era de 71,7%.', trecho: 'Em dezembro de 2022, o mesmo índice era de 71,7%.', tipo: 'fato' },
  { id: 'c', texto: 'O ministro afirmou que a alta é temporária.', trecho: 'O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta.', tipo: 'declaracao', quem: 'Fulano de Tal' },
  { id: 'd', texto: 'Inventado: o índice era 50% em 2010.', trecho: 'em 2010 o índice era de 50%', tipo: 'fato' },
] };
const ANGULO = { gatilhos: { contradicao: 3, bolso: 2, numero: 3, personagem: 2 }, tese: 'Quem promete meta e entrega o maior patamar em cinco anos deve explicação a quem paga juros.', por_que_mandaria: 'Olha a diferença entre o discurso e o número.', imagem: { pessoa_central: true } };
const roteiro = (extra = {}) => ({
  capas: [{ texto: 'Prometeu meta. Entregou o **maior patamar** em cinco anos.', mecanismo: 'contradicao' }, { texto: 'De 71,7% para 82,9%: quem paga essa conta?', mecanismo: 'antes_depois' }, { texto: 'O número que o discurso não mostra', mecanismo: 'ninguem_contou' }],
  telas: [
    { papel: 'gap', layout: 'rep_manchete', titulo: 'O discurso é de controle', texto: 'O ministro diz que a alta é temporária. Os números contam outra história.', fatos: ['c'] },
    { papel: 'prova', layout: 'rep_comparacao', titulo: 'Índice de exemplo', texto: 'Comparação entre dezembro de 2022 e agosto de 2026.', dados: { esquerda: { rotulo: 'DEZ/2022', valor: '71,7%', unidade: 'do total' }, direita: { rotulo: 'AGO/2026', valor: '82,9%', unidade: 'do total' }, faixa: { valor: 'O maior patamar em cinco anos.' }, tom: 'alerta' }, fatos: ['a', 'b'] },
    { papel: 'contradicao', layout: 'rep_manchete', titulo: 'Quem paga é o pequeno', texto: 'Segundo os analistas, os juros sobem primeiro para as pequenas empresas.', fatos: [] },
    { papel: 'leitura', layout: 'rep_manchete', titulo: 'Minha leitura', texto: 'Meta sem resultado é promessa. E promessa não paga boleto de ninguém.', destaque: 'Cobrar resultado não é torcida.', fatos: ['a'] },
  ],
  legenda: 'O índice saiu de 71,7% para 82,9%. O discurso fala em alta temporária; quem empreende sente nos juros. Segue para acompanhar os números do mandato.',
  hashtags: ['economia', 'juros', 'empreendedorismo'], cta_motivo: 'se você também cobra resultado', fechamento: { titulo: 'O resultado está nos números.', texto: 'Quem pede confiança precisa mostrar entrega, não discurso.' }, ...extra,
});
const JURI = { versoes: [{ indice: 0, notas: {}, nota: 8.6, defeito: 'capa 2 longa' }, { indice: 1, notas: {}, nota: 8.1, defeito: '' }], vencedora: 0, capas_escolhidas: [0, 1] };

function iaFalsa({ roteiros = [roteiro(), roteiro()], juri = JURI, angulo = ANGULO } = {}) {
  let r = 0; const chamadas = [];
  const pedirJson = async ({ sistema }) => {
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : 'roteiro';
    chamadas.push({ tipo, sistema });
    const dados = tipo === 'fatos' ? FATOS : tipo === 'angulo' ? angulo : tipo === 'juri' ? juri : roteiros[Math.min(r++, roteiros.length - 1)];
    return { dados: JSON.parse(JSON.stringify(dados)), llm: { provider: 'simulado' } };
  };
  return { pedirJson, chamadas };
}
const deps = async (ia) => ({
  ...ia, lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/materia', url_final: 'https://exemplo.test/materia', titulo: 'Índice de exemplo bate 82,9%', veiculo: 'Jornal Exemplo', publicada_em: '2026-10-27T12:00:00Z', texto: MATERIA, legivel: true }),
  fotoDe: async () => ({ dados: await sharp({ create: { width: 900, height: 1100, channels: 3, background: '#a77' } }).jpeg().toBuffer(), meta: { id: 'commons_teste', tipo: 'foto_real', autor: 'Fotógrafo Exemplo', licenca: 'CC BY 2.0', exige_credito: true, origem: 'https://commons.wikimedia.org/x' } }),
});
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const ler = async (id) => (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, id)).doc;

test('fato só vale com trecho literal da matéria e números dentro do trecho', () => {
  const r = K.verificarFatos(FATOS.fatos, MATERIA);
  assert.deepStrictEqual(r.fatos.map((f) => f.id_ia), ['a', 'b', 'c']);
  assert.match(r.descartados[0].motivo, /não está no texto/);
  const solto = K.verificarFatos([{ id: 'x', texto: 'Chegou a 90%.', trecho: 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026' }], MATERIA);
  assert.match(solto.descartados[0].motivo, /número fora do trecho/);
});

test('do link ao "Para aprovar": versão vencedora, foto com crédito, arte de todos os slides e portões liberados', async () => {
  novo(); const ia = iaFalsa();
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: await deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const doc = await ler(c.id);
  assert.strictEqual(doc.status, 'em_revisao');
  const v = M.versaoAtiva(doc);
  assert.strictEqual(v.slides[0].layout, 'rep_capa');
  assert.match(v.slides[0].texto, /maior patamar/);
  assert.strictEqual(v.slides.length, 6);
  assert.ok(v.slides.every((s) => s.tema_visual === 'reportagem'));
  assert.strictEqual(doc.arte.renders.filter((x) => x.versao === v.id).length, v.slides.length);
  assert.ok(doc.arte.renders.find((x) => x.slide_id === 's1').elementos.includes('foto_bloco'));
  assert.match(v.legenda, /Foto: Fotógrafo Exemplo \(CC BY 2\.0\)/);
  assert.match(v.legenda, /Fonte: Jornal Exemplo/);
  assert.deepStrictEqual(ia.chamadas.map((x) => x.tipo), ['fatos', 'angulo', 'roteiro', 'roteiro', 'juri']);
  if (process.env.TOP_DUMP) for (const x of doc.arte.renders.filter((y) => y.versao === v.id)) require('fs').writeFileSync(`${process.env.TOP_DUMP}/${x.slide_id}.png`, (await arm.armazem().arquivos.obter(ACCOUNT.ig_id, x.blob_key)).dados);
  const g = require('../studio').prepararRevisao(doc);
  assert.deepStrictEqual(g.bloqueios.map((b) => `${b.id}: ${b.detalhe}`), []);
});

test('a voz vem dos posts reais mais compartilhados do Pedro', async () => {
  novo();
  await arm.armazem().config.salvar(ACCOUNT.ig_id, { meu_instagram: { posts: [
    { legenda: 'Cara, quem tem CNPJ sabe: boleto não espera discurso virar realidade. Eu quero menos imposto e mais liberdade pra trabalhar.', alcance: 1000, compartilhamentos: 90, da_ferramenta: false },
    { legenda: 'Post da ferramenta que não deve servir de exemplo de voz, com texto longo o bastante para entrar.', alcance: 1000, compartilhamentos: 999, da_ferramenta: true },
  ] } });
  const ia = iaFalsa(); const c = await T.criar({ url: 'https://exemplo.test/materia' });
  await T.executarTudo(c.id, { deps: await deps(ia) });
  const s = ia.chamadas.find((x) => x.tipo === 'roteiro').sistema;
  assert.match(s, /boleto não espera discurso/);
  assert.doesNotMatch(s, /não deve servir de exemplo/);
});

test('número inventado numa tela não passa: reescreve e, se insistir, fica abaixo da régua (não vai para aprovação)', async () => {
  novo();
  const base = roteiro();
  const ruim = { ...base, telas: base.telas.map((t, i) => (i === 0 ? { ...t, texto: 'O índice chegou a 95% e o ministro diz que é temporário.' } : t)) };
  const ia = iaFalsa({ roteiros: [ruim, ruim, ruim, ruim, ruim, ruim, ruim, ruim] });
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: await deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'abaixo_da_regua');
  assert.strictEqual((await ler(c.id)).status, 'arquivado');
  assert.match(r.conteudo.top.motivo, /95%/);
});

test('pauta que não passa no teste do grupo é descartada sem gastar roteiro', async () => {
  novo(); const ia = iaFalsa({ angulo: { ...ANGULO, gatilhos: { contradicao: 0, bolso: 1, numero: 1, personagem: 0 } } });
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: await deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'descartada');
  assert.ok(!ia.chamadas.some((x) => x.tipo === 'roteiro'));
});

test('júri abaixo da nota mínima pede mais uma rodada e depois desiste', async () => {
  novo(); const ia = iaFalsa({ juri: { versoes: [{ indice: 0, nota: 6, defeito: 'capa fraca' }, { indice: 1, nota: 5.5, defeito: '' }], capas_escolhidas: [0] } });
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: await deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'abaixo_da_regua');
  assert.match(r.conteudo.top.motivo, /júri deu \d/);
  assert.strictEqual(ia.chamadas.filter((x) => x.tipo === 'juri').length, 2);
});

test('"Segundo …" em várias telas é apontado pela checagem', () => {
  const r = K.checarRoteiro({ capa: 'Capa curta', telas: [
    { papel: 'gap', layout: 'rep_manchete', titulo: 'A', texto: 'Segundo a Agência X, algo.' },
    { papel: 'prova', layout: 'rep_numero', texto: 'Segundo a Agência X, outra coisa.', dados: { numero: { valor: '3' } }, fatos: ['f1'] },
    { papel: 'contradicao', layout: 'rep_manchete', titulo: 'B', texto: 'texto' },
    { papel: 'leitura', layout: 'rep_manchete', titulo: 'C', texto: 'texto' }], legenda: '' }, []);
  assert.ok(r.problemas.some((p) => /Segundo/.test(p)));
});

test('na legenda, a frase com número sem fonte (ou com data) sai e o carrossel segue', async () => {
  novo();
  const r0 = roteiro({ legenda: 'O índice chegou a 95% segundo boatos. O índice saiu de 71,7% para 82,9%. Matéria de 27/10/2026.' });
  const ia = iaFalsa({ roteiros: [r0, r0] });
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: await deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const v = M.versaoAtiva(await ler(c.id));
  assert.doesNotMatch(v.legenda, /95%/);
  assert.match(v.legenda, /71,7% para 82,9%/);
  assert.doesNotMatch(v.legenda, /27\/10/);
});

test('tela de número sem o número vira manchete em vez de derrubar a versão', async () => {
  const v = T.normalizarRoteiro({ capas: [{ texto: 'Capa' }], telas: [{ papel: 'prova', layout: 'rep_numero', titulo: 'Dados', texto: 'Texto', dados: null }, { papel: 'prova', layout: 'rep_numero', texto: 'X', dados: { numero: '239,4 bilhões', rotulo: 'Arrecadação' } }] });
  assert.strictEqual(v.telas[0].layout, 'rep_manchete');
  assert.deepStrictEqual(v.telas[1].dados, { numero: { valor: '239,4 bilhões', rotulo: 'Arrecadação' } });
});

test('paráfrase da IA é trocada pela frase real da matéria; número que não está na frase continua fora', () => {
  const r = K.verificarFatos([
    { id: 'p', texto: 'Em dezembro de 2022 o índice era 71,7%.', trecho: 'Em dezembro de 2022 o mesmo índice ficava em 71,7%' },
    { id: 'q', texto: 'O índice era 60% em 2022.', trecho: 'Em dezembro de 2022 o mesmo índice ficava em 60%' },
  ], MATERIA);
  assert.deepStrictEqual(r.fatos.map((f) => f.id_ia), ['p']);
  assert.strictEqual(r.fatos[0].trecho, 'Em dezembro de 2022, o mesmo índice era de 71,7%.');
});

test('comparação com um lado sem número vira número gigante; sem número dos dois lados, manchete', () => {
  const v = T.normalizarRoteiro({ capas: [{ texto: 'Capa' }], telas: [
    { papel: 'prova', layout: 'rep_comparacao', titulo: 'Caixa', texto: 'x', dados: { esquerda: { rotulo: '2025', valor: 'Base' }, direita: { rotulo: '2026', valor: '+6,97%' } } },
    { papel: 'prova', layout: 'rep_comparacao', titulo: 'Caixa', texto: 'x', dados: { esquerda: { rotulo: 'a', valor: 'antes' }, direita: { rotulo: 'b', valor: 'depois' } } }] });
  assert.strictEqual(v.telas[0].layout, 'rep_numero');
  assert.strictEqual(v.telas[0].dados.numero.valor, '+6,97%');
  assert.strictEqual(v.telas[1].layout, 'rep_manchete');
});

test('referências internas e chamada repetida saem do texto', () => {
  const v = T.normalizarRoteiro({ capas: [{ texto: 'Capa' }], telas: [{ papel: 'prova', layout: 'rep_manchete', titulo: 'A', texto: 'O TCU definiu 11,3% (f1). Arredondado (f2, f3).' }], legenda: 'Texto [f1].', cta_motivo: 'Segue o @pedro_destrava se você cobra resultado' });
  assert.strictEqual(v.telas[0].texto, 'O TCU definiu 11,3%. Arredondado.');
  assert.strictEqual(v.legenda, 'Texto.');
  assert.strictEqual(v.cta_motivo, 'se você cobra resultado');
});

test('número da manchete conta como fato do veículo (não descarta a pauta por isso)', async () => {
  novo(); const ia = iaFalsa(); const d = await deps(ia);
  d.lerFonte = async () => ({ tipo: 'artigo', url: 'https://exemplo.test/m2', titulo: 'Órgão Fictício calcula taxa de 11,3% para 2027', veiculo: 'Jornal Exemplo', texto: MATERIA, legivel: true });
  const c = await T.criar({ url: 'https://exemplo.test/m2', titulo: 'x', origem: 'manual' });
  await T.passo(c.id, { deps: d, orcamentoMs: 15000 });
  const fatos = (await ler(c.id)).top.fatos;
  const m = fatos.find((f) => f.origem === 'manchete');
  assert.ok(m && m.valores.some((v) => M.igual(v, 11.3)));
  assert.deepStrictEqual(K.numerosSemFonte('A taxa vai a 11,3%.', fatos), []);
});

test('pauta só de número e personagem (sem bolso nem contradição) é descartada mesmo somando 5+', async () => {
  novo(); const ia = iaFalsa({ angulo: { ...ANGULO, gatilhos: { contradicao: 1, bolso: 1, numero: 3, personagem: 3 } } });
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: await deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'descartada');
  assert.match(r.conteudo.top.erros.at(-1).mensagem, /bolso nem contradição/);
});

test('reparar: carrossel pronto com afirmações trocadas por fora volta a passar nos portões, sem mudar a versão', async () => {
  novo(); const ia = iaFalsa();
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  await T.executarTudo(c.id, { deps: await deps(ia) });
  const antes = await ler(c.id); const versao = M.versaoAtiva(antes).hash;
  // simula a preparação antiga: troca as afirmações e deixa o estúdio em erro
  antes.claims = antes.claims.map((k, i) => ({ ...k, id: `a${i + 1}` })); antes.status = 'rascunho'; antes.studio = { estado: 'erro', erro: 'IA indisponível' };
  const reg = await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id); await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, antes, reg.rev);
  global.window = global.window || {}; const G = require('../../../static/qualityGates');
  const gate = (d) => { const cl = M.clone(d); cl.claims.forEach((k) => { k.revisao = { ...(k.revisao || {}), confirmada_por_pedro: true }; }); return G.avaliar(cl, { conta: M.ACCOUNT_PIN }).bloqueios.map((b) => b.id); };
  assert.ok(gate(await ler(c.id)).includes('numero_sem_origem'));
  await T.reparar(c.id);
  const depois = await ler(c.id);
  assert.deepStrictEqual(gate(depois).filter((b) => b === 'numero_sem_origem'), []);
  assert.strictEqual(M.versaoAtiva(depois).hash, versao);
  assert.deepStrictEqual([depois.status, depois.studio.estado], ['em_revisao', 'pronto']);
});

test('carrossel que não passa nos portões de publicação (ex.: texto não cabe) não vai para "Para aprovar"', async () => {
  novo(); const ia = iaFalsa(); const d = await deps(ia);
  d.arte = { renderizarSlide: async () => ({ png: Buffer.from('png'), metrics: { cabe: false, elementos: [] } }) };
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'abaixo_da_regua');
  assert.match(r.conteudo.top.motivo || r.conteudo.top.erros.at(-1).mensagem, /portões de publicação/);
  assert.notStrictEqual((await ler(c.id)).status, 'em_revisao');
});

test('consertos sem IA: declaração ganha "Segundo …", legenda perde número solto, fonte sem data e texto longo é encurtado', async () => {
  novo();
  const r0 = roteiro();
  r0.telas[0] = { papel: 'gap', layout: 'rep_manchete', titulo: 'O discurso é de controle', texto: 'A alta é temporária e a meta será cumprida. Os números contam outra história.', fatos: ['c'] };
  r0.legenda = 'O índice saiu de 71,7% para 82,9%. A votação será no dia 29. Segue para acompanhar.';
  const ia = iaFalsa({ roteiros: [r0, r0] }); const d = await deps(ia);
  const arteReal = require('../arte'); let chamadas = 0;
  d.arte = { renderizarSlide: async (s, o) => { chamadas++; const r = await arteReal.renderizarSlide(s, o); if (/[.!?]\s+\S/.test(String(s.texto || '')) && s.layout === 'rep_manchete') r.metrics = { ...r.metrics, cabe: false }; return r; } };
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const v = M.versaoAtiva(await ler(c.id));
  assert.match(v.slides[1].texto, /^Segundo Fulano de Tal: /);
  assert.doesNotMatch(v.legenda, /dia 29/); assert.match(v.legenda, /71,7% para 82,9%/);
  assert.ok(v.slides.every((s) => !/\d{1,2}\/\d{1,2}\/\d{4}/.test(s.fonte_linha || '')));
  assert.ok(r.conteudo.top.encurtado, 'encurtou os slides longos');
  assert.ok(v.slides.filter((s) => s.layout === 'rep_manchete').every((s) => !/[.!?]\s+\S/.test(String(s.texto))), 'ficou uma frase por slide longo');
});

test('cota da IA esgotada (429) não descarta o carrossel: espera e retoma depois', async () => {
  novo(); const ia = iaFalsa(); let falhar = true;
  const pedirJson = async (args) => { if (falhar) throw Object.assign(new Error('429 Rate limit reached for model on tokens per day (TPD): Limit 500000'), { status: 429 }); return ia.pedirJson(args); };
  const d = { ...(await deps(ia)), pedirJson };
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r1 = await T.passo(c.id, { deps: d, orcamentoMs: 15000 });
  assert.strictEqual(r1.conteudo.top.estado, 'em_andamento');
  assert.ok(Date.parse(r1.conteudo.top.adiar_ate) > Date.now() + 50 * 60000, 'cota do dia: espera ~1 h');
  assert.ok((await T.passo(c.id, { deps: d })).adiado, 'antes do horário não tenta de novo');
  const doc = await ler(c.id); doc.top.adiar_ate = new Date(Date.now() - 1000).toISOString();
  const reg = await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id); await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, doc, reg.rev);
  falhar = false;
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida');
});

test('foto de lugar: nunca retrato de alguém nem foto histórica', () => {
  const F = require('./fotos');
  const item = (title, w = 1600, h = 1000) => ({ title: `File:${title}`, imageinfo: [{ width: w, height: h }] });
  assert.ok(F.pontuarLugar(item('Plenário do Senado Federal vista geral.jpg'), 'Plenário do Senado Federal') > 0);
  assert.strictEqual(F.pontuarLugar(item('Senadora Fulana discursa no Plenário do Senado Federal.jpg'), 'Plenário do Senado Federal'), -1);
  assert.strictEqual(F.pontuarLugar(item('Porto de Santos, 1870.jpg'), 'Porto de Santos'), -1);
  assert.strictEqual(F.pontuarLugar(item('Senado Federal do Brasil Plenário do Senado (14786000717).jpg'), 'Plenário do Senado Federal'), -1);
  assert.ok(F.pontuarLugar(item('Congresso Nacional, Brasília-DF, Brasil.jpg'), 'Congresso Nacional Brasília') > 0);
});

test('formato tweet: capa = 1º tweet, uma frase por slide, fechamento com chamada; arte no tema tweet e portões liberados', async () => {
  novo();
  const rt = () => ({
    capas: [{ texto: 'Prometeram meta. Entregaram o **maior patamar** em cinco anos.', mecanismo: 'contradicao' }, { texto: 'De 71,7% para 82,9%. Isso é normal?', mecanismo: 'numero' }],
    telas: [
      { papel: 'gap', texto: 'Ouvir o ministro dizer que a alta é temporária é normal…', imagem_busca: null, fatos: ['c'] },
      { papel: 'prova', texto: 'Ver o índice sair de 71,7% para 82,9% também virou normal…', imagem_busca: 'brazilian money inflation', fatos: ['a', 'b'] },
      { papel: 'consequencia', texto: 'Pagar juros maiores porque o governo não cumpre a meta é normal…', imagem_busca: null, fatos: [] },
      { papel: 'leitura', texto: 'Na minha leitura, meta sem resultado é promessa. E promessa não paga boleto.', imagem_busca: null, fatos: ['a'] },
    ],
    legenda: 'O índice saiu de 71,7% para 82,9%. O discurso fala em alta temporária. Você acha normal?', hashtags: ['economia', 'juros', 'governo'], cta_motivo: 'se você também cobra resultado',
    fechamento: { titulo: 'Sabe o que não é normal?', texto: 'Cobrar resultado de quem prometeu e entregou o pior patamar em cinco anos.' },
  });
  const ia = iaFalsa({ roteiros: [rt(), rt()], angulo: { ...ANGULO, formato: 'tweet' } });
  const d = await deps(ia); let fotos = 0;
  d.buscarFoto = async () => { fotos++; return { dados: await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#7a5' } }).jpeg().toBuffer(), meta: { id: `pexels_${fotos}`, tipo: 'ilustrativa', autor: 'x', licenca: 'Pexels License', origem: 'https://www.pexels.com/photo/1' } }; };
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'tweet' });
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  assert.strictEqual(doc.top.formato, 'tweet');
  assert.ok(v.slides.every((s) => s.layout === 'tweet' && s.tema_visual === 'tweet'));
  assert.strictEqual(v.slides[0].funcao, 'capa'); assert.strictEqual(v.slides.at(-1).funcao, 'encerramento');
  assert.match(v.slides.at(-1).titulo, /não é normal/);
  assert.match(v.slides[2].imagem_id, /^pexels_/, 'o tweet que pediu foto recebeu a foto'); assert.ok(!v.slides[1].imagem_id && !v.slides[3].imagem_id, 'os outros ficam só com a frase');
  assert.ok(doc.arte.renders.filter((x) => x.versao === v.id).every((x) => x.metrics.cabe && x.metrics.tema === 'tweet'));
  assert.ok(ia.chamadas.some((x) => x.tipo === 'roteiro' && /formato "tweet"/.test(x.sistema)), 'usou o prompt do formato tweet');
});

test('IA premium ligada mas a chamada caiu no gratuito: espera (não escreve com modelo fraco) e explica se é falta de crédito', async () => {
  novo(); const ia = iaFalsa();
  const d = { ...(await deps(ia)), premiumLigado: () => true, modeloForte: () => false, ultimoErro: () => ({ status: 429, code: 'credit_balance_exhausted', mensagem: 'You have no credits remaining.' }) };
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-teste';
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  const r = await T.passo(c.id, { deps: d, orcamentoMs: 15000 });
  assert.strictEqual(r.conteudo.top.estado, 'em_andamento');
  assert.strictEqual(r.conteudo.top.etapa, 'angulo', 'parou na 1ª etapa criativa');
  assert.ok(r.conteudo.top.sem_credito && Date.parse(r.conteudo.top.adiar_ate) > Date.now() + 50 * 60000);
  assert.match(r.conteudo.top.erros.at(-1).mensagem, /sem créditos/);
  assert.ok(r.conteudo.top.ia.some((x) => x.etapa === 'fatos' && x.provider === 'simulado'), 'registrou qual IA escreveu');
});
