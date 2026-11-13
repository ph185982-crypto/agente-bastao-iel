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

test('post só de foto (a leitura só acha ruído): cada slide sai com a imagem original inteira, sem texto', async () => {
  novo();
  const imgs = await Promise.all([slideImg('#a55'), slideImg('#5a5')]);
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, midias: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'], legenda: 'É isso aí 🏁' });
  const ruido = async () => ({ text: 'ASP ; - Y. $', linhas: [{ texto: 'ASP ; - Y. $', altura: 30, y0: 100, y1: 130, confianca: 45 }] });
  const deps = { fetch: async (u) => ({ ok: true, status: 200, arrayBuffer: async () => imgs[u.endsWith('a.jpg') ? 0 : 1] }), ocr: ruido, pedirJson: async () => ({ dados: { slides: [{ i: 0, titulo: '', texto: '' }, { i: 1, titulo: '', texto: '' }], legenda: 'É isso aí 🏁' } }) };
  const c = await CL.iniciar(ITEM.id); let r; for (let k = 0; k < 6; k++) { r = await CL.passo(c.id, { deps }); if (r.concluido) break; }
  assert.strictEqual(r.estado, 'concluido', JSON.stringify(r)); assert.strictEqual(r.aviso, null);
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id)).doc; const v = M.versaoAtiva(doc);
  assert.deepStrictEqual(v.slides.map((s) => s.layout), ['foto_inteira', 'foto_inteira']);
  assert.ok(v.slides.every((s) => /_inteira$/.test(s.imagem_id)));
  assert.strictEqual(doc.titulo, 'Cópia de @codiesanchez: caixa');
  const png = (await require('../arte').renderizarSlide(v.slides[0], { imagem: imgs[0] })).png;
  const m = await sharp(png).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350]);
});

test('cópia fiel: o texto é trocado no lugar, em cima da imagem original (sem tweet), e a tradução vem por trecho', async () => {
  novo();
  // Fundo branco com um "desenho" laranja e um título preto no alto.
  const base = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect x="100" y="120" width="880" height="70" fill="#111"/><circle cx="540" cy="800" r="200" fill="#e8812f"/></svg>'), top: 0, left: 0 }]).jpeg().toBuffer();
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, tipo: 'imagem', midias: ['https://cdn.test/a.jpg'], legenda: 'Getting good at something.' });
  const ocrFiel = async () => ({ text: 'Getting good at something:', linhas: [{ texto: 'Getting good at something:', altura: 70, y0: 120, y1: 190, confianca: 95 }], trechos: [{ texto: 'Getting good at something:', x0: 100, y0: 120, x1: 980, y1: 190, altura_linha: 70, confianca: 95, n_linhas: 1 }] });
  const pedidos = [];
  const deps = { fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => base }), ocr: ocrFiel, pedirJson: async (a) => { pedidos.push(a); return { dados: { blocos: [{ id: '0.0', texto: 'Ficando bom em algo:' }], legenda: 'Ficando bom em algo.' } }; } };
  const c = await CL.iniciar(ITEM.id); let r; for (let k = 0; k < 6; k++) { r = await CL.passo(c.id, { deps }); if (r.concluido) break; }
  assert.strictEqual(r.estado, 'concluido', JSON.stringify(r));
  assert.match(pedidos[0].usuario, /\[0\.0\] Getting good at something:/); assert.strictEqual(pedidos[0].pago, 'nunca');
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id)).doc; const v = M.versaoAtiva(doc);
  assert.strictEqual(v.slides[0].layout, 'foto_inteira'); assert.match(v.slides[0].imagem_id, /_pt$/);
  assert.strictEqual(doc.titulo, 'Ficando bom em algo:');
  const img = await arm.armazem().arquivos.obter(ACCOUNT.ig_id, `img:${v.slides[0].imagem_id}`);
  const { data, info } = await sharp(Buffer.from(img.dados)).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  assert.deepStrictEqual([info.width, info.height], [1080, 1350]);
  assert.ok(px(540, 800)[0] > 200 && px(540, 800)[2] < 100, 'o desenho laranja continua lá');
  assert.ok(px(970, 130).every((c0) => c0 > 200), 'o fim do retângulo preto original foi apagado (tradução mais curta)');
});

test('troca de texto: ignora ruído do desenho e encaixa a tradução na caixa', () => {
  const TT = require('./trocaTexto');
  assert.strictEqual(TT.ehTexto({ texto: 'Reality', confianca: 95, x0: 1, x1: 50, y0: 1, y1: 20 }), true);
  assert.strictEqual(TT.ehTexto({ texto: 'À x rá ::', confianca: 23, x0: 1, x1: 50, y0: 1, y1: 20 }), false);
  assert.strictEqual(TT.ehTexto({ texto: '1,000 misses', confianca: 84, x0: 1, x1: 50, y0: 1, y1: 20 }), true);
  const d = TT.diagramar({ x0: 100, x1: 980, y0: 120, y1: 190, altura_linha: 70 }, 'Ficando bom em algo:', { width: 1080, height: 1350 });
  assert.strictEqual(d.linhas.length, 1); assert.strictEqual(d.centrado, true);
});

test('cópia com IA que enxerga: usa o texto conferido na imagem (não o da OCR) e apaga a assinatura do autor', async () => {
  novo();
  const base = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect x="200" y="300" width="200" height="40" fill="#111"/><rect x="40" y="1150" width="1000" height="4" fill="#111"/><circle cx="540" cy="1240" r="40" fill="#963"/><rect x="480" y="1290" width="120" height="20" fill="#111"/></svg>'), top: 0, left: 0 }]).jpeg().toBuffer();
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, tipo: 'imagem', midias: ['https://cdn.test/a.jpg'], legenda: 'Follow @codiesanchez for more.' });
  // A OCR leu errado ("4 shot"); a IA de visão confere ("1 shot").
  const ocrErrada = async () => ({ text: '4 shot', linhas: [{ texto: '4 shot', altura: 40, y0: 300, y1: 340, confianca: 91 }], trechos: [{ texto: '4 shot', x0: 200, y0: 300, x1: 400, y1: 340, altura_linha: 40, confianca: 91, n_linhas: 1 }] });
  const chamadas = [];
  // A IA não dá posição: só o texto certo, a tradução e a região da assinatura (a posição vem da OCR e da própria imagem).
  const visao = async (o) => { chamadas.push(o); return { provedor: 'teste', dados: { textos: [{ original: '1 shot', traducao: '1 arremesso' }],
    assinaturas: [{ texto: '@codiesanchez', posicao: 'base-centro' }], legenda: 'Siga @codiesanchez para mais.' } }; };
  const deps = { fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => base }), ocr: ocrErrada, visao };
  const c = await CL.iniciar(ITEM.id); let r; for (let k = 0; k < 6; k++) { r = await CL.passo(c.id, { deps }); if (r.concluido) break; }
  assert.strictEqual(r.estado, 'concluido', JSON.stringify(r));
  assert.strictEqual(chamadas.length, 1); assert.strictEqual(chamadas[0].handle, 'codiesanchez');
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id)).doc; const v = M.versaoAtiva(doc);
  assert.strictEqual(doc.titulo, '1 arremesso');
  assert.ok(!/codiesanchez.*para mais/i.test(v.legenda), 'o @ do autor sai da legenda traduzida');
  const img = await arm.armazem().arquivos.obter(ACCOUNT.ig_id, `img:${v.slides[0].imagem_id}`);
  const { data, info } = await sharp(Buffer.from(img.dados)).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  assert.ok(px(540, 1240).every((c0) => c0 > 220), 'o logo/rosto do autor foi apagado');
  assert.ok(px(540, 1300).every((c0) => c0 > 220), 'o @ do autor foi apagado');
  assert.ok(px(540, 1152).every((c0) => c0 < 80), 'a linha da moldura continua');
});
