// Tema "reportagem": layouts, medição, recorte e regras de honestidade.
// node --test backend/lib/arteReportagem.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const sharp = require('sharp');
const A = require('./arte');
const R = require('./arteReportagem');

const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
// Recorte SINTÉTICO (silhueta com transparência): nada a ver com pessoa real.
const recorteSintetico = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><ellipse cx="300" cy="260" rx="170" ry="210" fill="#bbb"/><path d="M40 800 C40 560 170 500 300 500 C430 500 560 560 560 800Z" fill="#333"/></svg>')).png().toBuffer();

const CASOS = [
  { layout: 'rep_capa', tema_visual: 'reportagem', texto: 'Exemplo de **título** curto e forte para a capa', subtitulo: 'Subtítulo de exemplo.' },
  { layout: 'rep_comparacao', titulo: 'Exemplo', subtitulo: 'Indicador de exemplo no período.', dados: { tom: 'alerta', esquerda: { rotulo: 'ANO 1', valor: '10 mil', unidade: 'itens' }, direita: { rotulo: 'ANO 2', valor: '20 mil', unidade: 'itens' }, faixa: { valor: '+100%', texto: 'no período' } }, texto: 'Nota de exemplo sobre o dado.', fonte_linha: 'Fonte: Órgão de exemplo' },
  { layout: 'rep_numero', dados: { numero: { valor: '12', rotulo: 'Exemplo' } }, texto: 'Itens de exemplo no período citado.', apoio: 'Texto de apoio de exemplo para o número.', fonte_linha: 'Fonte: Órgão de exemplo' },
  { layout: 'rep_manchete', titulo: 'Manchete de exemplo.', texto: 'Parágrafo de apoio de exemplo para a manchete.', destaque: 'Frase em destaque de exemplo.', cta: 'Segue o perfil', cta_apoio: 'Se você também quer entender.' },
];

test('os quatro layouts saem em 1080x1350, cabem e declaram o tema', async () => {
  const rec = await recorteSintetico();
  for (const [i, c] of CASOS.entries()) {
    const r = await A.renderizarSlide(c, { indice: i + 1, total: CASOS.length, imagem: rec });
    const m = await sharp(r.png).metadata();
    assert.deepStrictEqual([m.width, m.height], [1080, 1350], c.layout);
    assert.strictEqual(r.metrics.cabe, true, `${c.layout}: ${JSON.stringify(r.metrics.problemas)}`);
    assert.strictEqual(r.metrics.tema, 'reportagem');
    assert.ok(r.metrics.elementos.includes('tema_reportagem'));
  }
});

test('sem recorte a arte sai só com a forma e avisa; nunca inventa rosto', async () => {
  const r = await A.renderizarSlide(CASOS[0], { indice: 1, total: 7 });
  assert.ok(r.metrics.elementos.includes('sem_recorte'));
  assert.strictEqual(r.metrics.cabe, true);
});

test('recorte sem transparência é recusado (não vira retângulo de foto)', async () => {
  const semAlpha = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const r = await A.renderizarSlide(CASOS[0], { indice: 1, total: 7, imagem: semAlpha });
  assert.ok(r.metrics.elementos.includes('recorte_sem_transparencia'));
  assert.ok(r.metrics.elementos.includes('sem_recorte'));
});

test('o recorte entra em preto e branco', async () => {
  const colorido = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#ff0000"/></svg>')).png().toBuffer();
  const p = await R.prepararRecorte(await sharp(colorido).ensureAlpha().png().toBuffer(), { x: 0, y: 0, w: 400, h: 500 });
  const { data, info } = await sharp(p.input).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) { assert.ok(Math.abs(data[i] - data[i + 1]) <= 2 && Math.abs(data[i + 1] - data[i + 2]) <= 2, 'pixel colorido no recorte'); }
});

test('prova ou comparação sem linha de fonte bloqueia', async () => {
  const sem = { ...CASOS[1], fonte_linha: null };
  const r = await A.renderizarSlide(sem, { indice: 2, total: 7 });
  assert.strictEqual(r.metrics.cabe, false);
  assert.ok(r.metrics.problemas.some((p) => /fonte/i.test(p)));
});

test('texto que não cabe nem no mínimo bloqueia, não é espremido', async () => {
  const gigante = { ...CASOS[3], titulo: 'Palavra '.repeat(80) };
  const r = await A.renderizarSlide(gigante, { indice: 7, total: 7 });
  assert.strictEqual(r.metrics.cabe, false);
});

test('mesma entrada, mesmo PNG', async () => {
  const rec = await recorteSintetico();
  const a = await A.renderizarSlide(CASOS[1], { indice: 2, total: 7, imagem: rec });
  const b = await A.renderizarSlide(CASOS[1], { indice: 2, total: 7, imagem: rec });
  assert.strictEqual(hash(a.png), hash(b.png));
});

test('layouts da identidade são mapeados para o tema quando tema_visual = reportagem', async () => {
  assert.strictEqual(R.escolher({ layout: 'capa_tipografica' }), 'rep_capa');
  assert.strictEqual(R.escolher({ layout: 'comparacao', dados: { esquerda: {}, direita: {} } }), 'rep_comparacao');
  assert.strictEqual(R.escolher({ layout: 'explicacao' }), 'rep_manchete');
  assert.strictEqual(R.escolher({ layout: 'prova', dados: { numero: { valor: '1' } } }), 'rep_numero');
  const r = await A.renderizarSlide({ layout: 'capa_tipografica', texto: 'Capa de exemplo', tema_visual: 'reportagem' }, { indice: 1, total: 7 });
  assert.strictEqual(r.metrics.tema, 'reportagem');
});

test('o arquivo aprovado do encerramento continua valendo no tema novo', async () => {
  const arquivo = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#123456' } }).png().toBuffer();
  const r = await A.renderizarSlide({ layout: 'encerramento', texto: 'x', tema_visual: 'reportagem' }, { indice: 7, total: 7, arquivoEncerramento: arquivo });
  assert.ok(r.metrics.elementos.includes('arquivo_aprovado'));
});

test('a identidade Avanteza continua igual quando o tema não é pedido', async () => {
  const r = await A.renderizarSlide({ layout: 'capa_tipografica', texto: 'Capa de exemplo' }, { indice: 1, total: 7 });
  assert.notStrictEqual(r.metrics.tema, 'reportagem');
});
