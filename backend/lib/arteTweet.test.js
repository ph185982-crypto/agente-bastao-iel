// Capa do formato tweet: headline grande com destaque e foto de ponta a ponta; e a busca de foto da capa prefere gente.
// node --test backend/lib/arteTweet.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const T = require('./arteTweet');
const FS = require('./fotosStudio');

const foto = () => sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#a77' } }).jpeg().toBuffer();

test('capa: headline grande em negrito, foto sangrada até a borda de baixo, sem faixa branca', async () => {
  const r = await T.renderizar({ texto: 'O dólar caiu. Seu **juro** continua igual.' }, { indice: 1, total: 8 }, await foto());
  const m = r.metrics;
  assert.ok(m.elementos.includes('capa_tweet') && m.elementos.includes('foto_sangrada'));
  assert.ok(m.blocos[0].tam >= 80, `headline com ${m.blocos[0].tam}px`);
  assert.ok(m.cabe);
  assert.strictEqual(m.foto.largura, 1080);
  // a última linha de pixels é foto (não branco)
  const { data, info } = await sharp(r.png).extract({ left: 40, top: 1349, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] < 240 || data[1] < 240, `pixel ${[...data].slice(0, info.channels)}`);
});

test('capa sem foto: headline ainda maior, centralizada; slides seguintes mantêm o tweet normal', async () => {
  const r = await T.renderizar({ texto: 'Seu Pix caiu e **a venda subiu**.' }, { indice: 1, total: 8 }, null);
  assert.ok(r.metrics.blocos[0].tam >= 100);
  const s2 = await T.renderizar({ texto: 'Segundo slide.' }, { indice: 2, total: 8 }, null);
  assert.ok(!s2.metrics.elementos.includes('capa_tweet'));
});

test('busca de foto da capa: entre os resultados, prefere pessoa a prédio', async () => {
  process.env.PEXELS_API_KEY = process.env.PEXELS_API_KEY || 'teste';
  const fotos = [
    { id: 1, alt: 'Modern office building facade', src: { large2x: 'https://images.pexels.com/1.jpg' } },
    { id: 2, alt: 'Worried woman looking at a receipt', src: { large2x: 'https://images.pexels.com/2.jpg' } },
  ];
  const fetcher = async () => ({ ok: true, json: async () => ({ photos: fotos }) });
  const carregar = async () => ({ status: 200, corpo: await foto() });
  const r = await FS.buscarFoto('worried woman receipt', { fetcher, carregar, pessoa: true });
  assert.strictEqual(r.meta.id, 'pexels_2');
  const r2 = await FS.buscarFoto('x', { fetcher, carregar });
  assert.strictEqual(r2.meta.id, 'pexels_1', 'sem a opção, mantém a ordem da busca');
});

test('destaque com um asterisco só ("*Impõe*") vira destaque; ** e contas com * ficam como estão', () => {
  assert.strictEqual(T.destaque('*Impõe* R$ 41,9 bi'), '**Impõe** R$ 41,9 bi');
  assert.strictEqual(T.destaque('**ok** e *x*'), '**ok** e **x**');
  assert.strictEqual(T.destaque('3 * 4 * 5'), '3 * 4 * 5');
});
