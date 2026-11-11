// Formatos "estatico" (1–2 imagens + legenda longa) e "ensaio" (texto corrido em fundo escuro) do pipeline top, com IA simulada.
// node --test backend/lib/top/formatos.test.js   (TOP_DUMP=/pasta grava os PNGs dos slides)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sharp = require('sharp');
const arm = require('../armazem');
const T = require('./pipeline');
const K = require('./checagem');
const Pi = require('./piloto');
const AT = require('../arteTweet');
const M = require('../../../static/contentModel');
const { ACCOUNT } = require('../account');

// Matéria FICTÍCIA de teste (números inventados para o teste, não são dados reais).
const MATERIA = 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026, segundo o relatório divulgado nesta segunda-feira. Em dezembro de 2022, o mesmo índice era de 71,7%. O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta. Analistas ouvidos pela reportagem dizem que o patamar é o maior em cinco anos e que a conta recai sobre quem empreende, com juros mais altos para pequenas empresas.';
const FATOS = { protagonista: 'Fulano de Tal', fatos: [
  { id: 'a', texto: 'O índice chegou a 82,9% em agosto de 2026.', trecho: 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026', tipo: 'fato' },
  { id: 'b', texto: 'Em dezembro de 2022 o índice era de 71,7%.', trecho: 'Em dezembro de 2022, o mesmo índice era de 71,7%.', tipo: 'fato' },
  { id: 'c', texto: 'O ministro afirmou que a alta é temporária.', trecho: 'O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta.', tipo: 'declaracao', quem: 'Fulano de Tal' },
] };
const ANGULO = { gatilhos: { contradicao: 3, bolso: 2, numero: 3, personagem: 2, empreendedor: 3 }, tese: 'Quem promete meta e entrega o maior patamar em cinco anos deve explicação a quem financia estoque com juro alto.', por_que_mandaria: 'Olha a diferença entre a promessa e o número.', enviar_para: 'seu sócio', imagem: { pessoa_central: false, busca: 'worried shop owner reading bill' } };
const JURI = { versoes: [{ indice: 0, notas: {}, nota: 8.6, defeito: '' }, { indice: 1, notas: {}, nota: 8.1, defeito: '' }], vencedora: 0, capas_escolhidas: [0, 1] };
const SALA = { capas: [{ mente: 'halbert', texto: 'Se você tem CNPJ, olha esse **82,9%**.' }, { mente: 'hopkins', texto: 'Chegou a 99% e ninguém avisou.' }] };

// Legenda longa do post estático: 5 parágrafos, cena concreta, fatos, leitura, frase de ouro e pedido de envio. Sem vício de IA.
const LEGENDA = [
  'Você abre o extrato da maquininha numa terça de manhã e o número que importa já está lá: o juro do mês comeu a margem antes de você vender o primeiro produto.',
  'O índice de exemplo chegou a 82,9% em agosto de 2026. Em dezembro de 2022, era de 71,7%. O ministro Fulano de Tal afirmou que a alta é temporária e que a meta vai ser cumprida.',
  'Na minha leitura, quem promete meta e entrega o maior patamar em cinco anos deve explicação a quem financia estoque com juro alto. O governo do PT fala em controle; o dono de loja vê o crédito encarecer e o prazo do fornecedor encurtar.',
  'Meta sem resultado é promessa. E promessa não desconta boleto.',
  'Manda pra seu sócio. Marca quem ainda acha que isso não mexe com o caixa dele.',
];
const roteiroEstatico = (extra = {}) => ({
  capas: [{ texto: 'Prometeram meta. Entregaram o **maior patamar** em cinco anos.', mecanismo: 'contradicao' }, { texto: 'De 71,7% para 82,9%. Isso é normal?', mecanismo: 'numero' }],
  virar: { precisa: false, motivo: '', tela: null },
  legenda: LEGENDA, frase_de_ouro: 'Meta sem resultado é promessa. E promessa não desconta boleto.',
  hashtags: ['economia', 'juros', 'empresa'], cta_motivo: 'se você financia estoque com juro alto', ...extra,
});
// Ensaio: abertura + 4 blocos de 2 parágrafos + fechamento com a frase de ouro (≈ 800 caracteres no total).
const roteiroEnsaio = () => ({
  capas: [{ texto: 'Juntar dinheiro por anos para o **primeiro carro** era normal.', mecanismo: 'nostalgia' }, { texto: 'Quem produz aprendeu a refazer o preço em silêncio.', mecanismo: 'identidade' }],
  telas: [
    { papel: 'gap', paragrafos: ['Hoje o dono de loja abre a planilha e descobre que o juro do estoque cresceu mais que a venda.', 'Ele não reclama no grupo. Ele refaz o preço e segue.'], fatos: [] },
    { papel: 'prova', paragrafos: ['O índice de exemplo chegou a 82,9%. Em dezembro de 2022 estava em 71,7%.', 'O ministro Fulano de Tal afirmou que a alta é temporária.'], fatos: ['a', 'b', 'c'] },
    { papel: 'consequencia', paragrafos: ['Temporário, para quem financia mercadoria, é o prazo do fornecedor.', 'Cada ponto a mais no juro vira um produto a menos na prateleira.'], fatos: [] },
    { papel: 'leitura', paragrafos: ['Na minha leitura, o governo do PT trata a meta como promessa de campanha, e campanha não desconta boleto.', 'Quem produz paga antes de vender. Quem arrecada gasta antes de prestar conta.'], fatos: ['a'] },
  ],
  fechamento: { titulo: 'Meta sem resultado é promessa. Promessa não desconta boleto.', texto: 'Eu quero menos imposto e mais liberdade para quem acorda cedo e paga folha.' },
  cta_motivo: 'se você paga folha antes de receber', legenda: 'O índice saiu de 71,7% para 82,9%. Manda pra seu sócio.', hashtags: ['economia', 'juros', 'empresa'],
});

function iaFalsa({ roteiros, juri = JURI, angulo = ANGULO } = {}) {
  let r = 0; const chamadas = [];
  const pedirJson = async ({ sistema }) => {
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : /sala de redação/.test(sistema) ? 'sala' : /revisor de honestidade/.test(sistema) ? 'revisor' : 'roteiro';
    chamadas.push({ tipo, sistema });
    const dados = tipo === 'fatos' ? FATOS : tipo === 'angulo' ? angulo : tipo === 'juri' ? juri : tipo === 'sala' ? SALA : tipo === 'revisor' ? { capas: [] } : roteiros[Math.min(r++, roteiros.length - 1)];
    return { dados: JSON.parse(JSON.stringify(dados)), llm: { provider: 'simulado' } };
  };
  return { pedirJson, chamadas };
}
const deps = (ia) => ({
  ...ia, lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/materia', url_final: 'https://exemplo.test/materia', titulo: 'Índice de exemplo bate 82,9%', veiculo: 'Jornal Exemplo', publicada_em: '2026-10-27T12:00:00Z', texto: MATERIA, legivel: true }),
  fotoDe: async () => null,
  buscarFoto: async () => ({ dados: await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 120, g: 90, b: 70 } } }).jpeg().toBuffer(), meta: { id: 'pexels_cena', tipo: 'ilustrativa', autor: 'x', licenca: 'Pexels License', origem: 'https://www.pexels.com/photo/1' } }),
});
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const ler = async (id) => (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, id)).doc;
const DUMP = process.env.TOP_DUMP || null;
async function gravar(doc, prefixo) {
  if (!DUMP) return;
  fs.mkdirSync(DUMP, { recursive: true });
  const v = M.versaoAtiva(doc);
  for (const x of doc.arte.renders.filter((y) => y.versao === v.id)) fs.writeFileSync(`${DUMP}/${prefixo}-${x.slide_id}.jpg`, (await arm.armazem().arquivos.obter(ACCOUNT.ig_id, x.blob_key)).dados);
}
const pixel = async (png, left, top) => { const { data } = await sharp(png).extract({ left, top, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true }); return [...data].slice(0, 3); };
const temAmarelo = async (png) => { const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }); for (let i = 0; i < data.length; i += info.channels * 7) if (data[i] > 225 && data[i + 1] > 195 && data[i + 2] < 130) return true; return false; };

test('estático: 1 slide (capa com headline + foto de gente) e legenda longa que passa no anti-IA e nos portões; publica como IMAGE', async () => {
  novo(); const ia = iaFalsa({ roteiros: [roteiroEstatico(), roteiroEstatico()] });
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'estatico' });
  assert.strictEqual(c.formato, 'estatico');
  const r = await T.executarTudo(c.id, { deps: deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  assert.strictEqual(doc.top.formato, 'estatico'); assert.strictEqual(v.formato, 'estatico');
  assert.strictEqual(v.slides.length, 1, 'sem "virar": uma imagem só');
  assert.deepStrictEqual([v.slides[0].funcao, v.slides[0].layout, v.slides[0].tema_visual], ['capa', 'tweet', 'tweet']);
  assert.strictEqual(v.slides[0].imagem_id, 'pexels_cena', 'a capa leva a foto de gente, como no tweet');
  const corpo = v.legenda.split('\n\nFonte:')[0];
  assert.ok(corpo.length >= 600 && corpo.length <= 1500, `legenda com ${corpo.length} caracteres`);
  assert.strictEqual(K.paragrafosDe(corpo).length, 5);
  assert.match(v.legenda, /Manda pra seu sócio/); assert.match(v.legenda, /Fonte: Jornal Exemplo/);
  assert.strictEqual(require('../mentes/antiIA').vicios(corpo).length, 0);
  const rd = doc.arte.renders.find((x) => x.versao === v.id && x.slide_id === 's1');
  assert.ok(rd.metrics.cabe && rd.elementos.includes('capa_tweet') && rd.elementos.includes('post_unico') && rd.elementos.includes('foto_sangrada'));
  assert.ok(ia.chamadas.some((x) => x.tipo === 'roteiro' && /POSTS ESTÁTICOS/.test(x.sistema)), 'usou o prompt do estático');
  assert.ok(ia.chamadas.some((x) => x.tipo === 'juri' && /júri editorial/.test(x.sistema)), 'passou pelo júri');
  assert.ok(ia.chamadas.some((x) => x.tipo === 'sala'), 'passou pela sala de capas');
  assert.deepStrictEqual(require('../studio').prepararRevisao(doc).bloqueios.map((b) => `${b.id}: ${b.detalhe}`), []);
  // o publicador decide IMAGE × carrossel pelo número de slides
  assert.strictEqual(v.slides.length === 1 ? 'IMAGE' : 'CAROUSEL', 'IMAGE');
  await gravar(doc, 'estatico');
});

test('estático com "virar": 2 slides (capa + prova com a chamada); legenda com vício é reprovada e reescrita', async () => {
  novo();
  const viciado = roteiroEstatico({ legenda: [...LEGENDA.slice(0, 2), 'O problema não é o juro. O problema é quem paga a conta no fim do mês.', ...LEGENDA.slice(3)] });
  const comVirar = roteiroEstatico({ virar: { precisa: true, motivo: 'a headline pede o número', tela: { papel: 'prova', texto: 'De 71,7% em dezembro de 2022 para 82,9% em agosto de 2026.', fatos: ['a', 'b'] } } });
  const ia = iaFalsa({ roteiros: [viciado, viciado, comVirar, comVirar] });
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'estatico' });
  const r = await T.executarTudo(c.id, { deps: deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const top = r.conteudo.top;
  assert.ok(top.versoes[top.escolha.versao].checagem.ok, 'venceu a versão limpa');
  const reescrita = ia.chamadas.filter((x) => x.tipo === 'roteiro');
  assert.ok(reescrita.length >= 3 && /Legenda com cara de IA/.test(reescrita[2].sistema), 'a reescrita recebeu a legenda apontada');
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  assert.strictEqual(v.slides.length, 2);
  assert.strictEqual(v.slides[1].funcao, 'prova'); assert.strictEqual(v.slides[1].cta, 'Manda pra seu sócio.');
  assert.ok(v.slides[1].claim_ids.length >= 2, 'a prova liga aos fatos');
  assert.ok(doc.arte.renders.filter((x) => x.versao === v.id).every((x) => x.metrics.cabe));
  assert.deepStrictEqual(require('../studio').prepararRevisao(doc).bloqueios.map((b) => b.id), []);
  await gravar(doc, 'estatico2');
});

test('ensaio: 5 slides escuros sem foto; abertura maior no 1º, frase de ouro em amarelo e pedido de envio no último; portões liberados', async () => {
  novo(); const ia = iaFalsa({ roteiros: [roteiroEnsaio(), roteiroEnsaio()] });
  let fotos = 0; const d = deps(ia); d.buscarFoto = async () => { fotos++; throw new Error('não deve buscar foto'); };
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'ensaio' });
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  assert.strictEqual(doc.top.formato, 'ensaio'); assert.strictEqual(fotos, 0);
  assert.ok(v.slides.length >= 5 && v.slides.length <= 7, `${v.slides.length} slides`);
  assert.ok(v.slides.every((s) => s.layout === 'ensaio' && s.tema_visual === 'ensaio' && !s.imagem_id));
  assert.match(v.slides[0].titulo, /primeiro carro/); assert.match(v.slides[0].texto, /planilha/);
  assert.strictEqual(v.slides.at(-1).funcao, 'encerramento'); assert.match(v.slides.at(-1).titulo, /Meta sem resultado/); assert.strictEqual(v.slides.at(-1).cta, 'Manda pra seu sócio.');
  assert.ok(ia.chamadas.some((x) => x.tipo === 'roteiro' && /formato "ensaio"/.test(x.sistema)), 'usou o prompt do ensaio');
  const renders = doc.arte.renders.filter((x) => x.versao === v.id);
  assert.strictEqual(renders.length, v.slides.length);
  assert.ok(renders.every((x) => x.metrics.cabe && x.metrics.tema === 'ensaio' && x.elementos.includes('ensaio') && x.elementos.includes('fundo_escuro')));
  assert.ok(renders.every((x) => (x.metrics.blocos.find((b) => b.nome === 'paragrafos')?.tam ?? 54) >= 54), 'corpo em Inter 54–64 px');
  assert.deepStrictEqual(require('../studio').prepararRevisao(doc).bloqueios.map((b) => `${b.id}: ${b.detalhe}`), []);
  await gravar(doc, 'ensaio');
});

test('arte do ensaio: fundo escuro no canto, abertura em negrito maior, último slide com a frase de ouro em amarelo', async () => {
  const s1 = { funcao: 'capa', layout: 'ensaio', tema_visual: 'ensaio', titulo: 'Juntar dinheiro por anos para o **primeiro carro** era normal.', texto: 'Hoje o dono de loja abre a planilha e descobre que o juro do estoque cresceu mais que a venda.\n\nEle não reclama no grupo. Ele refaz o preço e segue.' };
  const r1 = await AT.renderizar(s1, { indice: 1, total: 5 }, null);
  assert.ok(r1.metrics.cabe && r1.metrics.elementos.includes('ensaio') && r1.metrics.elementos.includes('capa_ensaio'));
  const [r, g, b] = await pixel(r1.png, 8, 8); assert.ok(r < 20 && g < 20 && b < 20, `canto ${[r, g, b]}`);
  const ab = r1.metrics.blocos.find((x) => x.nome === 'abertura'); const ps = r1.metrics.blocos.find((x) => x.nome === 'paragrafos');
  assert.ok(ab.tam > ps.tam && ps.tam >= 54 && ps.tam <= 64, `abertura ${ab.tam}px, corpo ${ps.tam}px`);
  const fim = { funcao: 'encerramento', layout: 'ensaio', tema_visual: 'ensaio', titulo: 'Meta sem resultado é promessa. Promessa não desconta boleto.', texto: 'Eu quero menos imposto e mais liberdade para quem acorda cedo e paga folha.', cta: 'Manda pra seu sócio.', cta_apoio: 'Segue o @pedro_destrava se você paga folha antes de receber.' };
  const r5 = await AT.renderizar(fim, { indice: 5, total: 5 }, null);
  assert.ok(r5.metrics.cabe && r5.metrics.elementos.includes('fechamento_ensaio'));
  assert.ok(r5.metrics.blocos.some((x) => x.nome === 'frase_de_ouro') && r5.metrics.blocos.some((x) => x.nome === 'cta_manda'));
  assert.ok(await temAmarelo(r5.png), 'frase de ouro em amarelo');
  // slide do meio sem título: só os parágrafos e a seta
  const r3 = await AT.renderizar({ funcao: 'prova', layout: 'ensaio', tema_visual: 'ensaio', texto: 'O índice chegou a **82,9%**. Em dezembro de 2022 estava em 71,7%.\n\nO ministro afirmou que a alta é temporária.' }, { indice: 3, total: 5 }, null);
  assert.ok(r3.metrics.cabe && !r3.metrics.blocos.some((x) => x.nome === 'abertura'));
  if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(`${DUMP}/arte-ensaio-s1.png`, r1.png); fs.writeFileSync(`${DUMP}/arte-ensaio-s3.png`, r3.png); fs.writeFileSync(`${DUMP}/arte-ensaio-s5.png`, r5.png); }
});

test('slides só com texto e imagem: sem avatar, sem nome e sem @ no topo em capa, miolo e ensaio', async () => {
  // O topo esquerdo (onde ficavam o avatar redondo e o nome) é fundo liso em todos os layouts.
  const liso = async (png, fundo) => { for (const [x, y] of [[90, 100], [126, 138], [220, 125], [300, 165]]) { const [r, g, b] = await pixel(png, x, y); assert.ok(Math.abs(r - fundo[0]) < 6 && Math.abs(g - fundo[1]) < 6 && Math.abs(b - fundo[2]) < 6, `pixel ${x},${y} = ${[r, g, b]}`); } };
  // textos curtos e centralizados, para o topo ficar livre de letra
  const miolo = await AT.renderizar({ funcao: 'explicacao', layout: 'tweet', tema_visual: 'tweet', texto: 'Uma frase só.' }, { indice: 2, total: 5 }, null);
  await liso(miolo.png, [255, 255, 255]);
  const ensaio = await AT.renderizar({ funcao: 'explicacao', layout: 'ensaio', tema_visual: 'ensaio', texto: 'Um parágrafo curto.' }, { indice: 3, total: 5 }, null);
  await liso(ensaio.png, [11, 11, 12]);
  const fecho = await AT.renderizar({ funcao: 'encerramento', layout: 'tweet', tema_visual: 'tweet', titulo: 'Fim.', texto: 'Curto.', cta: 'Manda pra seu sócio.', cta_apoio: 'Segue o @pedro_destrava.' }, { indice: 5, total: 5 }, null);
  await liso(fecho.png, [255, 255, 255]);
});

test('arte do post único: capa com headline e foto mesmo com 1 slide só, sem seta; texto que não cabe no ensaio é marcado', async () => {
  const foto = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#a77' } }).jpeg().toBuffer();
  const r = await AT.renderizar({ funcao: 'capa', layout: 'tweet', tema_visual: 'tweet', texto: 'Prometeram meta. Entregaram o **maior patamar** em cinco anos.' }, { indice: 1, total: 1 }, foto);
  assert.ok(r.metrics.elementos.includes('capa_tweet') && r.metrics.elementos.includes('post_unico') && r.metrics.elementos.includes('foto_sangrada'));
  // sem seta: o canto inferior direito é foto, não o círculo branco
  const [pr, pg, pb] = await pixel(r.png, 1080 - 72 - 45, 1350 - 93); assert.ok(pr < 240 || pg < 240 || pb < 240, `canto ${[pr, pg, pb]}`);
  if (DUMP) fs.writeFileSync(`${DUMP}/arte-estatico-s1.png`, r.png);
  const longo = await AT.renderizar({ funcao: 'prova', layout: 'ensaio', tema_visual: 'ensaio', texto: Array.from({ length: 5 }, () => 'Uma frase comprida que se repete para encher o slide além do que o tamanho mínimo legível de cinquenta e quatro pixels permite caber na tela.').join('\n\n') }, { indice: 2, total: 5 }, null);
  assert.strictEqual(longo.metrics.cabe, false);
});

test('checagem por formato: estático exige legenda longa com pedido de envio e capa curta; ensaio exige 4–6 blocos e frase de ouro', () => {
  const curta = K.checarRoteiro({ capa: 'Capa curta', telas: [], legenda: 'Curta demais.' }, [], { formato: 'estatico' });
  assert.ok(curta.problemas.some((p) => /legenda tem 13 caracteres/.test(p)) && curta.problemas.some((p) => /mandar ou marcar/.test(p)));
  const longa = K.checarRoteiro({ capa: 'Uma capa com onze palavras que passa do limite do estático', telas: [], legenda: LEGENDA.join('\n\n') }, [{ valores: [82.9, 71.7, 2026, 2022] }], { formato: 'estatico' });
  assert.deepStrictEqual(longa.problemas.filter((p) => /Capa ausente ou longa/.test(p)).length, 1);
  const okE = K.checarRoteiro({ capa: 'Capa de sete palavras que cabe', telas: [], legenda: LEGENDA.join('\n\n') }, [{ valores: [82.9, 71.7, 2026, 2022] }], { formato: 'estatico' });
  assert.deepStrictEqual(okE.problemas, []);
  const e = T.normalizarRoteiro(roteiroEnsaio(), 'ensaio');
  assert.strictEqual(e.formato, 'ensaio'); assert.strictEqual(e.telas.length, 4); assert.ok(e.telas.every((t) => t.layout === 'ensaio' && K.paragrafosDe(t.texto).length === 2));
  const okN = K.checarRoteiro({ ...e, capa: e.capas[0].texto }, [{ valores: [82.9, 71.7, 2022] }], { formato: 'ensaio' });
  assert.deepStrictEqual(okN.problemas, []);
  const semOuro = K.checarRoteiro({ ...e, capa: e.capas[0].texto, telas: e.telas.slice(0, 2), fechamento: { titulo: '', texto: '' } }, [{ valores: [82.9, 71.7, 2022] }], { formato: 'ensaio' });
  assert.ok(semOuro.problemas.some((p) => /2 blocos/.test(p)) && semOuro.problemas.some((p) => /frase de ouro/.test(p)));
  // estático: legenda em lista vira parágrafos; "virar" sem necessidade não gera tela
  const n = T.normalizarRoteiro(roteiroEstatico(), 'estatico');
  assert.strictEqual(n.telas.length, 0); assert.strictEqual(K.paragrafosDe(n.legenda).length, 5); assert.ok(n.capas.every((k) => K.palavras(k.texto) <= 10));
});

test('piloto: formato_padrao aceita estatico, ensaio e alterna; alterna roda tweet → ensaio → estatico', async () => {
  novo();
  for (const f of ['estatico', 'ensaio', 'alterna']) assert.deepStrictEqual(Pi.validar({ formato_padrao: f }), { formato_padrao: f });
  assert.throws(() => Pi.validar({ formato_padrao: 'carta' }), /formato_padrao deve ser/);
  assert.deepStrictEqual([undefined, 'tweet', 'ensaio', 'estatico', 'reportagem'].map(Pi.proximoDoRodizio), ['tweet', 'ensaio', 'estatico', 'tweet', 'tweet']);
  await Pi.salvarConfig({ formato_padrao: 'alterna' });
  const criados = []; const SP = (dia, hhmm) => Date.parse(`${dia}T${hhmm}:00-03:00`);
  const d = { descobrir: async () => ({ pautas: [{ id: `p${criados.length}`, titulo: `Pauta ${criados.length}`, prioridade: 90, fontes: [{ url: `https://agenciabrasil.ebc.com.br/${criados.length}` }] }] }), criar: async (o) => { criados.push(o); return { id: `c_${criados.length}` }; } };
  await Pi.rodada({ agora: SP('2026-10-29', '06:00'), deps: d });
  // marca o anterior como pronto para o piloto abrir a próxima pauta
  for (let i = 0; i < 3; i++) { const est = (await arm.armazem().config.obter(ACCOUNT.ig_id)).piloto_estado; est.criados.forEach((x) => { x.estado = 'concluida'; }); est.fila = []; est.fila_em = null; await arm.armazem().config.salvar(ACCOUNT.ig_id, { piloto_estado: est }); await Pi.rodada({ agora: SP('2026-10-29', `0${7 + i}:00`), deps: d }); }
  assert.deepStrictEqual(criados.map((x) => x.formato), ['tweet', 'ensaio', 'estatico', 'tweet']);
});
