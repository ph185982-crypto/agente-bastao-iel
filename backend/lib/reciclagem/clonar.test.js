// Clone autorizado: autorização obrigatória, leitura da Graph, OCR, tradução (só IA gratuita), remontagem e portões.
// node --test backend/lib/reciclagem/clonar.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const arm = require('../armazem');
const C = require('./coletar');
const CL = require('./clonar');
const M = require('../../../static/contentModel');
const { ACCOUNT } = require('../account');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const ITEM = { id: 'rc_00aa11bb22cc33dd', rede: 'instagram', conta: { handle: 'codiesanchez', nome: 'Codie', pais: 'US', idioma: 'en' }, permalink: 'https://www.instagram.com/p/ABC/', publicado_em: new Date().toISOString(), tipo: 'carrossel', tema: 'caixa', tese: 'x', reciclado: [] };
const AUT = { autor: '@codiesanchez', canal: 'DM do Instagram', data: '2026-11-10', prova: 'Ela respondeu na DM: "pode traduzir e postar, só me marca".' };
const slideImg = (cor) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: cor } }).jpeg().toBuffer();

async function graphFalsa(n = 3) {
  const imgs = await Promise.all(Array.from({ length: n }, (_, i) => slideImg(['#a55', '#5a5', '#55a', '#aa5'][i % 4])));
  const urls = imgs.map((_, i) => `https://cdn.test/s${i}.jpg`);
  return {
    graph: async (m, id, { fields }) => { assert.match(fields, /business_discovery\.username\(codiesanchez\)/); return { business_discovery: { media: { data: [{ permalink: 'https://www.instagram.com/p/OUTRO/' }, { permalink: 'https://www.instagram.com/p/ABC/?igsh=x', caption: 'You lose 30% of profit. Follow @codiesanchez', media_type: 'CAROUSEL_ALBUM', children: { data: urls.map((u) => ({ media_type: 'IMAGE', media_url: u })) } }] } } }; },
    igId: 'ig1',
    fetch: async (u) => { const i = urls.indexOf(u); return { ok: i >= 0, status: i >= 0 ? 200 : 404, arrayBuffer: async () => imgs[i] }; },
  };
}
// OCR simulada: título grande no alto, corpo no meio, e o rodapé livre (vira foto).
const ocr = async () => ({ text: 'You lose 30% of profit\nSeparate your accounts today.', linhas: [{ texto: 'You lose 30% of profit', altura: 70, y0: 80, y1: 150, confianca: 90 }, { texto: 'Separate your accounts today.', altura: 30, y0: 190, y1: 225, confianca: 90 }] });
const TRAD = { slides: [{ i: 0, titulo: 'Você perde 30% do lucro', texto: 'Separe suas contas hoje.' }, { i: 1, titulo: 'Passo um', texto: 'Abra uma conta da empresa.' }, { i: 2, titulo: 'Passo dois', texto: 'Defina sua retirada.' }], legenda: 'Você perde 30% do lucro.' };

test('clona direto, sem registro; o crédito padrão vai na legenda; o registro opcional valida os campos', async () => {
  novo(); await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, ITEM);
  const c0 = await CL.iniciar(ITEM.id); assert.strictEqual(c0.clone.autorizacao.credito, 'Conteúdo original de @codiesanchez.');
  await assert.rejects(CL.autorizar(ITEM.id, { ...AUT, prova: 'ok' }), /prova/);
  await assert.rejects(CL.autorizar(ITEM.id, { ...AUT, canal: 'Telepatia' }), /onde a autorização/);
  await assert.rejects(CL.autorizar(ITEM.id, { ...AUT, data: '2099-01-01' }), /Data/);
  const a = await CL.autorizar(ITEM.id, AUT);
  assert.strictEqual(a.credito, 'Conteúdo original de @codiesanchez, traduzido e publicado com autorização.');
  assert.strictEqual((await C.obter(ITEM.id)).autorizacao.canal, 'DM do Instagram');
});

test('faixa sem texto: a maior área livre vira foto só se tiver 35% da altura', () => {
  assert.deepStrictEqual(CL.faixaSemTexto([{ y0: 80, y1: 150 }, { y0: 190, y1: 225 }], 1350), { y: 237, h: 1113 });
  assert.strictEqual(CL.faixaSemTexto([{ y0: 100, y1: 500 }, { y0: 520, y1: 900 }, { y0: 950, y1: 1300 }], 1350), null);
});

test('clone de ponta a ponta: mesma quantidade de slides, texto traduzido, foto recortada, crédito na legenda, só IA gratuita, portões ok', async () => {
  novo(); await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, ITEM);
  await CL.autorizar(ITEM.id, AUT);
  const g = await graphFalsa(3); const pedidos = [];
  const pedirJson = async (a) => { pedidos.push(a); return { dados: TRAD }; };
  const c = await CL.iniciar(ITEM.id);
  let r; for (let k = 0; k < 6; k++) { r = await CL.passo(c.id, { deps: { ...g, ocr, pedirJson } }); if (r.concluido) break; }
  assert.strictEqual(r.estado, 'concluido', JSON.stringify(r)); assert.strictEqual(r.slides, 3); assert.strictEqual(r.aviso, null);
  assert.strictEqual(pedidos.length, 1, 'uma chamada de IA por post'); assert.strictEqual(pedidos[0].pago, 'nunca', 'só IA gratuita');
  assert.match(pedidos[0].usuario, /You lose 30% of profit/);
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id)).doc; const v = M.versaoAtiva(doc);
  assert.strictEqual(v.slides.length, 3); assert.strictEqual(v.slides[0].texto, 'Você perde 30% do lucro Separe suas contas hoje.');
  assert.strictEqual(v.slides[1].texto, '**Passo um** Abra uma conta da empresa.');
  assert.ok(v.slides.every((s) => s.imagem_id && s.tema_visual === 'tweet'));
  assert.match(v.legenda, /Conteúdo original de @codiesanchez, traduzido e publicado com autorização\.$/);
  assert.strictEqual(doc.status, 'em_revisao'); assert.strictEqual(doc.studio.estado, 'pronto');
  assert.strictEqual(doc.arte.renders.length, 3);
  assert.deepStrictEqual(doc.claims.map((k) => k.id), ['k1', 'kL'], 'os números do slide 1 e da legenda ficam ligados ao original');
  assert.match(doc.evidencias[0].trecho, /30% of profit/);
  const arquivos = (await arm.armazem().arquivos.listar(ACCOUNT.ig_id)).map((f) => f.chave);
  assert.ok(!arquivos.some((k) => k.startsWith('clone_orig:')), 'o original baixado não fica guardado');
  assert.strictEqual((await C.obter(ITEM.id)).reciclado[0].formato, 'clone');
});

test('reel e post fora dos 50 recentes: erro claro, sem gastar IA', async () => {
  novo(); await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, tipo: 'reel' });
  await CL.autorizar(ITEM.id, AUT); const c = await CL.iniciar(ITEM.id); let ia = 0;
  const r = await CL.passo(c.id, { deps: { ...(await graphFalsa()), ocr, pedirJson: async () => { ia++; return { dados: TRAD }; } } });
  assert.strictEqual(r.estado, 'erro'); assert.match(r.motivo, /reel ainda não/); assert.strictEqual(ia, 0);
  novo(); await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, permalink: 'https://www.instagram.com/p/SUMIU/' });
  await CL.autorizar(ITEM.id, AUT); const c2 = await CL.iniciar(ITEM.id);
  const r2 = await CL.passo(c2.id, { deps: { ...(await graphFalsa()), ocr, pedirJson: async () => ({ dados: TRAD }) } });
  assert.strictEqual(r2.estado, 'erro'); assert.match(r2.motivo, /50 mais recentes/);
});

test('IA gratuita sem cota: o clone espera (não vira erro) e segue quando a cota volta', async () => {
  novo(); await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, ITEM); await CL.autorizar(ITEM.id, AUT);
  const g = await graphFalsa(3); const c = await CL.iniciar(ITEM.id);
  const sem = async () => { throw Object.assign(new Error('429 Rate limit reached'), { status: 429 }); };
  let r; for (let k = 0; k < 4; k++) r = await CL.passo(c.id, { deps: { ...g, ocr, pedirJson: sem } });
  assert.strictEqual(r.estado, 'em_andamento'); assert.strictEqual(r.etapa, 'traduzir'); assert.strictEqual(r.erro.codigo, 'COTA_IA');
  for (let k = 0; k < 4 && !r.concluido; k++) r = await CL.passo(c.id, { deps: { ...g, ocr, pedirJson: async () => ({ dados: TRAD }) } });
  assert.strictEqual(r.estado, 'concluido');
});

test('copiar usa as imagens já guardadas na coleta (sem chamar a Graph) e a lista só mostra carrossel e imagem', async () => {
  novo();
  const imgs = await Promise.all([slideImg('#a55'), slideImg('#5a5')]);
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, midias: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'], legenda: 'You lose 30% of profit.' });
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, 'rc_11aa11bb22cc33dd', { ...ITEM, id: 'rc_11aa11bb22cc33dd', permalink: 'https://www.instagram.com/reel/R/', tipo: 'reel', vl: 9 });
  const lista = await C.listar({ soImagens: true, dias: 7 });
  assert.deepStrictEqual(lista.itens.map((i) => i.tipo), ['carrossel'], 'reel fora da lista');
  let graphChamada = false;
  const deps = { graph: async () => { graphChamada = true; return {}; }, fetch: async (u) => ({ ok: true, status: 200, arrayBuffer: async () => imgs[u.endsWith('a.jpg') ? 0 : 1] }), ocr, pedirJson: async () => ({ dados: { slides: [{ i: 0, titulo: 'Você perde 30% do lucro', texto: '' }, { i: 1, titulo: 'Passo um', texto: 'Separe as contas.' }], legenda: 'Você perde 30% do lucro.' } }) };
  const c = await CL.iniciar(ITEM.id); let r; for (let k = 0; k < 6; k++) { r = await CL.passo(c.id, { deps }); if (r.concluido) break; }
  assert.strictEqual(r.estado, 'concluido', JSON.stringify(r)); assert.strictEqual(r.slides, 2); assert.strictEqual(graphChamada, false);
});
