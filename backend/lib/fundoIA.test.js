// Fundo por IA (modo híbrido): desligado por padrão, sem texto, sem derrubar a produção.
// node --test backend/lib/fundoIA.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const arm = require('./armazem');
const F = require('./fundoIA');
const A = require('./arte');

const c = { id: 'c-fixture' }; const v = { id: 'v-fixture' };
const png = () => sharp({ create: { width: 400, height: 600, channels: 3, background: '#8899aa' } }).png().toBuffer();
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));

test('desligado (padrão): não chama a IA e não gera aviso', async () => {
  novo();
  let chamou = 0;
  const r = await F.gerar(c, v, { ligada: () => false, fundoComTeto: async () => { chamou++; } });
  assert.strictEqual(chamou, 0); assert.strictEqual(r.buffer, undefined); assert.strictEqual(r.aviso, null);
});

test('ligado: gera, confere que não tem texto, guarda e reaproveita sem cobrar de novo', async () => {
  novo();
  let chamadas = 0;
  const deps = { ligada: () => true, ocr: async () => '', fundoComTeto: async () => { chamadas++; return { png: await png(), custo_usd: 0.05, modelo: 'gpt-image-1.5' }; } };
  const a = await F.gerar(c, v, deps);
  assert.ok(Buffer.isBuffer(a.buffer)); assert.strictEqual(a.custo_usd, 0.05); assert.strictEqual(a.tentativas, 1);
  const b = await F.gerar(c, v, deps);
  assert.strictEqual(b.reaproveitado, true); assert.strictEqual(chamadas, 1);
});

test('fundo com letras ou números é recusado; duas vezes cai para o fundo por código, cobrando as duas', async () => {
  novo();
  let chamadas = 0;
  const r = await F.gerar(c, v, { ligada: () => true, ocr: async () => 'ECONOMIA 2026', fundoComTeto: async () => { chamadas++; return { png: await png(), custo_usd: 0.05, modelo: 'm' }; } });
  assert.strictEqual(chamadas, 2); assert.strictEqual(r.buffer, undefined); assert.match(r.aviso, /letras ou números/); assert.strictEqual(r.custo_usd, 0.1);
});

test('recusa, teto e falha viram aviso e nunca lançam', async () => {
  novo();
  for (const [code, re] of [['ImagemRecusada', /recusou/], ['ImagemTeto', /teto/], ['ImagemSemChave', /chave/], ['ImagemFalhou', /a tempo/]]) {
    const r = await F.gerar(c, v, { ligada: () => true, fundoComTeto: async () => { throw Object.assign(new Error('x'), { code }); } });
    assert.match(r.aviso, re); assert.match(r.aviso, /por código/);
  }
});

test('detecção de texto no fundo', () => {
  assert.strictEqual(F.temTexto(''), false);
  assert.strictEqual(F.temTexto('~ , .'), false);
  assert.strictEqual(F.temTexto('IMPOSTOS'), true);
  assert.strictEqual(F.temTexto('12'), true);
});

test('o tema aplica a textura como elemento e muda a imagem', async () => {
  const slide = { layout: 'rep_capa', tema_visual: 'reportagem', texto: 'Exemplo de capa' };
  const sem = await A.renderizarSlide(slide, { indice: 1, total: 7 });
  const com = await A.renderizarSlide(slide, { indice: 1, total: 7, fundo: await png() });
  assert.ok(com.metrics.elementos.includes('fundo_ia')); assert.ok(!sem.metrics.elementos.includes('fundo_ia'));
  assert.notStrictEqual(sem.png.toString('base64'), com.png.toString('base64'));
  assert.strictEqual(com.metrics.cabe, true);
});
