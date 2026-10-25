// Conferência por leitura da imagem: número exato, palavra com tolerância de 1 letra, frase não verificável.
// node --test backend/lib/ocrConferencia.test.js
const test = require('node:test');
const assert = require('node:assert');
const { conferirTexto, normalizar, numeros, distanciaAte1 } = require('./ocrConferencia');

const png = Buffer.from('png-falso');
const ler = (texto) => ({ ocr: async () => texto });

test('normaliza acento, caixa, NBSP e espaços', () => {
  assert.strictEqual(normalizar('  R$ 126   BI  DE SUPERÁVIT '), 'r$ 126 bi de superavit');
  assert.strictEqual(normalizar('−R$ 52,3'), '-r$ 52,3');
});

test('extrai número com sinal, moeda e unidade colada; hífen de intervalo não vira sinal', () => {
  assert.deepStrictEqual(numeros(normalizar('+ R$ 126 BI')), ['+126 bi']);
  assert.deepStrictEqual(numeros(normalizar('− R$ 52,3 BI de déficit')), ['-52,3 bi']);
  assert.deepStrictEqual(numeros(normalizar('+172,9% em dois anos')), ['+172,9 %']);
  assert.deepStrictEqual(numeros(normalizar('198,7 mil pessoas')), ['198,7 mil']);
  assert.deepStrictEqual(numeros(normalizar('de 2022-2024 foram 2.273 pedidos.')), ['2022', '2024', '2.273']);
});

test('tudo certo: números e palavras presentes', async () => {
  const lido = 'CONTAS PÚBLICAS\n2022 REALIZADO  + R$ 126 BI DE SUPERÁVIT\n2026 PROJEÇÃO  − R$ 52,3 BI DE DÉFICIT';
  const r = await conferirTexto(png, ['Contas públicas', '+ R$ 126 bi', '− R$ 52,3 bi', 'superávit', 'déficit'], ler(lido));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.faltando, []);
  assert.match(r.lido, /CONTAS PÚBLICAS/);
});

test('dígito trocado falha, sem tolerância para número', async () => {
  const r = await conferirTexto(png, ['+172,9% em dois anos'], ler('+172,8% EM DOIS ANOS'));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.faltando, ['+172,9% em dois anos']);
  assert.deepStrictEqual(r.detalhes[0].numeros, ['+172,9 %']);
});

test('unidade trocada, sinal trocado e separador perdido também falham', async () => {
  assert.strictEqual((await conferirTexto(png, ['R$ 52,3 bi'], ler('R$ 52,3 MI'))).ok, false);
  assert.strictEqual((await conferirTexto(png, ['+ R$ 126 bi'], ler('− R$ 126 BI'))).ok, false);
  assert.strictEqual((await conferirTexto(png, ['2.273 pedidos'], ler('2273 PEDIDOS'))).ok, false);
});

test('palavra de 5+ letras tolera uma letra errada; duas, não', async () => {
  assert.strictEqual((await conferirTexto(png, ['Recuperação judicial'], ler('RECUPERACAO JUDICIAI'))).ok, true);
  assert.strictEqual((await conferirTexto(png, ['Recuperação judicial'], ler('RECUPERACAO JUDICAIL'))).ok, false);
  assert.ok(distanciaAte1('judicial', 'judicia'));
  assert.ok(!distanciaAte1('judicial', 'judicie1'));
});

test('palavra ausente aparece em detalhes', async () => {
  const r = await conferirTexto(png, ['Dívida pública'], ler('DÍVIDA'));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.detalhes[0].palavras, ['publica']);
});

test('frase só com palavras curtas não é cobrada: vai para nao_verificaveis', async () => {
  const r = await conferirTexto(png, ['O que é', '@pedro_destrava'], ler(''));
  assert.deepStrictEqual(r.nao_verificaveis, ['O que é']);
  assert.deepStrictEqual(r.faltando, ['@pedro_destrava']);
});

test('o OCR recebe o PNG; texto vazio com esperado falha', async () => {
  let recebido = null;
  const r = await conferirTexto(png, ['36 medidas'], { ocr: async (p) => { recebido = p; return ''; } });
  assert.strictEqual(recebido, png);
  assert.strictEqual(r.ok, false);
});

test('lista de esperados vazia passa', async () => {
  assert.strictEqual((await conferirTexto(png, [], ler('qualquer coisa'))).ok, true);
});
