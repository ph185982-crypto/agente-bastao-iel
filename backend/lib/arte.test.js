// Arte: medição real, limites legíveis, ausência de selo, determinismo.
// node --test backend/lib/arte.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const sharp = require('sharp');
const A = require('./arte');

const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const CASOS = [
  { layout: 'capa_tipografica', rotulo: 'Economia', texto: 'O salário mínimo de **R$ 64,79** em julho de 1994 valeria **R$ 840** hoje' },
  { layout: 'explicacao', funcao: 'contexto', titulo: 'O que o IPCA mede', texto: 'O IPCA acompanha a variação de preços de uma cesta de produtos e serviços. **Não é o custo de vida de uma pessoa.**' },
  { layout: 'prova', texto: '“O salário mínimo era de R$ 64,79 em 1º de julho de 1994.”', fonte_linha: 'Fonte: Banco Central do Brasil, SGS 1619 · consultada em 17/10/2026' },
  { layout: 'comparacao', dados: { esquerda: { rotulo: 'jul/1994', valor: 'R$ 100', detalhe: 'valor nominal' }, direita: { rotulo: 'set/2026', valor: 'R$ 840,22', detalhe: 'corrigido pelo IPCA' } }, texto: 'Hoje seriam necessários cerca de **R$ 840**.', fonte_linha: 'IPCA, IBGE (SIDRA 1737)' },
  { layout: 'encerramento', texto: 'Quer entender o que a política faz com o seu bolso? **Salve** e **mande para alguém**.' },
];

test('todos os layouts saem em 1080x1350 e cabem', async () => {
  for (const [i, c] of CASOS.entries()) {
    const r = await A.renderizarSlide(c, { indice: i + 1, total: CASOS.length });
    const m = await sharp(r.png).metadata();
    assert.deepStrictEqual([m.width, m.height], [1080, 1350], c.layout);
    assert.strictEqual(r.metrics.cabe, true, `${c.layout}: ${JSON.stringify(r.metrics.problemas)}`);
  }
});

test('medição pela fonte real concorda com o que é desenhado', async () => {
  for (const [k, familia, peso, tam, txt] of [['display', 'Poppins ExtraBold', 800, 80, 'Salário mínimo'], ['corpo', 'PT Serif', 400, 50, 'O IPCA acompanha a variação']]) {
    const esperado = A.largura(k, txt, tam);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="200"><rect width="1400" height="200" fill="#fff"/><text x="40" y="130" font-family="'${familia}'" font-weight="${peso}" font-size="${tam}" fill="#000">${txt}</text></svg>`;
    const { info } = await sharp(Buffer.from(svg)).trim({ background: '#ffffff', threshold: 40 }).toBuffer({ resolveWithObject: true });
    assert.ok(Math.abs(info.width - esperado) <= esperado * 0.05 + 8, `${k}: medido ${esperado.toFixed(1)} x desenhado ${info.width}`);
  }
});

test('texto longo demais NÃO é espremido: marca cabe:false e não passa do tamanho mínimo', async () => {
  const r = await A.renderizarSlide({ layout: 'explicacao', funcao: 'contexto', texto: 'texto muito longo '.repeat(120) }, { indice: 2, total: 5 });
  assert.strictEqual(r.metrics.cabe, false);
  assert.ok(r.metrics.fonte_px >= A.MINIMO.corpo, `fonte ${r.metrics.fonte_px}`);
  assert.ok(r.metrics.problemas.length >= 1);
  const t = A.ajustar({ texto: 'palavra '.repeat(400), k: 'corpo', larg: 888, alt: 700, max: 56, min: 38, papel: 'corpo' });
  assert.strictEqual(t.cabe, false);
  assert.strictEqual(t.tam, 38);
});

test('texto normal fica dentro das margens (nenhum pixel de texto nas laterais)', async () => {
  for (const c of CASOS.filter((x) => x.layout !== 'encerramento')) {
    const r = await A.renderizarSlide(c, { indice: 3, total: 6 });
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    const bg = [data[0], data[1], data[2]];
    let fora = 0;
    for (let y = 0; y < info.height; y++) {
      for (const x of [...Array(60).keys(), ...Array.from({ length: 60 }, (_, i) => info.width - 1 - i)]) {
        const i = (y * info.width + x) * info.channels;
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30) fora += 1;
      }
    }
    assert.strictEqual(fora, 0, `${c.layout}: ${fora} pixels fora da margem de 60px`);
  }
});

test('nenhuma arte desenha selo de verificação (cor azul de selo ausente) e a marca é o @ certo', async () => {
  for (const c of CASOS) {
    const r = await A.renderizarSlide(c, { indice: 1, total: 3 });
    assert.ok(!r.metrics.elementos.some((e) => /selo|badge|verificad/i.test(e)));
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    let azulSelo = 0;
    for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i] - 0x1D) < 12 && Math.abs(data[i + 1] - 0x9B) < 12 && Math.abs(data[i + 2] - 0xF0) < 12) azulSelo += 1;
    assert.strictEqual(azulSelo, 0, `${c.layout}: pixels da cor do selo do Instagram (#1D9BF0)`);
  }
});

test('prova e comparação sem linha de fonte são marcadas como não-ok (fonte sempre visível)', async () => {
  const r = await A.renderizarSlide({ layout: 'prova', texto: 'Um dado qualquer da fonte oficial.' }, { indice: 2, total: 4 });
  assert.strictEqual(r.metrics.cabe, false);
  assert.ok(r.metrics.problemas.some((p) => /fonte/i.test(p)));
});

test('determinismo: mesma entrada, mesmo PNG', async () => {
  const a = await A.renderizarSlide(CASOS[0], { indice: 1, total: 5 });
  const b = await A.renderizarSlide(CASOS[0], { indice: 1, total: 5 });
  assert.strictEqual(hash(a.png), hash(b.png));
});

test('encerramento aprovado entra sem reconstrução; tamanho diferente é sinalizado', async () => {
  const exato = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#123456' } }).png().toBuffer();
  const r = await A.renderizarSlide({ layout: 'encerramento', texto: 'não usado' }, { arquivoEncerramento: exato });
  const { data } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
  assert.deepStrictEqual([data[0], data[1], data[2]], [0x12, 0x34, 0x56], 'pixel idêntico ao arquivo aprovado');
  assert.ok(r.metrics.elementos.includes('arquivo_aprovado') && !r.metrics.elementos.includes('arquivo_aprovado_redimensionado'));
  const torto = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#123456' } }).png().toBuffer();
  const r2 = await A.renderizarSlide({ layout: 'encerramento', texto: 'x' }, { arquivoEncerramento: torto });
  assert.ok(r2.metrics.elementos.includes('arquivo_aprovado_redimensionado'));
  const sem = await A.renderizarSlide({ layout: 'encerramento', texto: 'Segue e salva.' }, {});
  assert.ok(sem.metrics.elementos.includes('encerramento_tipografico'), 'sem arquivo aprovado o encerramento é tipográfico e sinalizado');
});

test('capa fotográfica sem imagem cai em tipografia, e com imagem do Pedro usa a imagem', async () => {
  const sem = await A.renderizarSlide({ layout: 'capa_foto', texto: 'Título sem imagem' }, { indice: 1, total: 4 });
  assert.ok(sem.metrics.elementos.includes('sem_imagem_usou_tipografica'));
  const img = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#556677' } }).jpeg().toBuffer();
  const com = await A.renderizarSlide({ layout: 'capa_foto', texto: 'Título com **imagem**' }, { indice: 1, total: 4, imagem: img });
  assert.ok(com.metrics.elementos.includes('imagem_do_pedro'));
  assert.strictEqual(com.metrics.cabe, true);
});

test('"R$" nunca fica sozinho no fim da linha', () => {
  const q = A.quebrar('Hoje o valor chega a **R$ 840,22** por mês em média', 'corpo', 50, 520);
  for (const l of q.linhas) assert.notStrictEqual(l[l.length - 1].t, 'R$');
});

test('número com unidade não se separa entre linhas ("R$ 140 mil", "2 milhões")', () => {
  const { palavras } = require('./arte');
  assert.deepStrictEqual(palavras('teto de **R$ 140 mil**.').map((p) => p.t), ['teto', 'de', 'R$ 140 mil', '.']);
  assert.deepStrictEqual(palavras('são 2 milhões de pessoas').map((p) => p.t), ['são', '2 milhões', 'de', 'pessoas']);
});

test('foto: ampliada demais é sinalizada; orientação da câmera respeitada; sem distorção', async () => {
  const sharp = require('sharp');
  const { renderizarSlide } = require('./arte');
  const pequena = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const r1 = await renderizarSlide({ layout: 'capa_foto', texto: 'Teste' }, { imagem: pequena });
  assert.ok(r1.metrics.elementos.includes('foto_baixa_resolucao'));
  assert.strictEqual(r1.metrics.foto.ampliacao, 4.22);
  const grande = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const r2 = await renderizarSlide({ layout: 'capa_foto', texto: 'Teste' }, { imagem: grande });
  assert.ok(!r2.metrics.elementos.includes('foto_baixa_resolucao'));
  // foto de celular "deitada" no arquivo, com EXIF dizendo para girar 90°
  const deitada = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#888' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const r3 = await renderizarSlide({ layout: 'capa_foto', texto: 'Teste' }, { imagem: deitada });
  assert.deepStrictEqual([r3.metrics.foto.largura, r3.metrics.foto.altura], [1200, 1600], 'lida já na orientação certa');
  const meta = await sharp(r3.png).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [1080, 1350]);
});
