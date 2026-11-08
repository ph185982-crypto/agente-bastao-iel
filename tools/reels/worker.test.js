// Testes das partes puras do worker (sem rede). Rode: node --test tools/reels/worker.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathnames, montarResultado, limparErro } = require('./worker.js');

test('pathnames ficam dentro de videos/<id>/', () => {
  assert.deepEqual(pathnames('c_123'), { final: 'videos/c_123/final.mp4', poster: 'videos/c_123/poster.jpg' });
});

test('montarResultado junta o resultado.json com as URLs do Blob', () => {
  const json = { duracao_s: 24.5, cortes: 7, palavras: 52, estilo: 'hormozi', transcricao: { texto: 'oi', frases: [] }, avisos: ['x'], tempos_s: { render: 15 } };
  const r = montarResultado(json, { url: 'https://b/final-abc.mp4', pathname: 'videos/c_1/final-abc.mp4' }, { url: 'https://b/p.jpg', pathname: 'videos/c_1/poster-x.jpg' }, 1234);
  assert.equal(r.resultado.url, 'https://b/final-abc.mp4');
  assert.equal(r.resultado.poster_url, 'https://b/p.jpg');
  assert.equal(r.resultado.tamanho, 1234);
  assert.equal(r.resultado.cortes, 7);
  assert.equal(r.resultado.palavras, 52);
  assert.deepEqual(r.transcricao, { texto: 'oi', frases: [] });
  assert.ok(r.resultado.editado_em);
  assert.equal(r.resultado.transcricao, undefined); // a transcrição vai separada, como a rota espera
});

test('limparErro esconde tokens', () => {
  const t = limparErro(new Error('falhou com Bearer abc.def e vercel_blob_client_XYZ123'));
  assert.ok(!t.includes('abc.def'));
  assert.ok(!t.includes('XYZ123'));
});
