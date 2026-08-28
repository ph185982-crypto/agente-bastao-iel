// Testes do leitor de título queimado — rode com: node --test backend/lib/lerTituloQueimado.test.js
const test = require('node:test');
const assert = require('node:assert');
const { calcularBandas, montarCandidato, ehLixoDeVideo } = require('./lerTituloQueimado');

// ── calcularBandas ────────────────────────────────────────────────────────────

test('calcularBandas: banda no topo quando o vídeo começa mais abaixo', () => {
  const b = calcularBandas(1000, { cropY: 300, cropH: 700 });
  assert.deepStrictEqual(b, [{ top: 0, height: 300, posicao: 'topo' }]);
});

test('calcularBandas: banda na base quando o vídeo termina antes do fim', () => {
  const b = calcularBandas(1000, { cropY: 0, cropH: 800 });
  assert.deepStrictEqual(b, [{ top: 800, height: 200, posicao: 'base' }]);
});

test('calcularBandas: as duas bandas quando o vídeo está encaixotado no meio', () => {
  const b = calcularBandas(1000, { cropY: 250, cropH: 500 });
  assert.deepStrictEqual(b, [
    { top: 0, height: 250, posicao: 'topo' },
    { top: 750, height: 250, posicao: 'base' },
  ]);
});

test('calcularBandas: vídeo ocupando o frame inteiro não gera banda nenhuma', () => {
  assert.deepStrictEqual(calcularBandas(1000, { cropY: 0, cropH: 1000 }), []);
});

test('calcularBandas: banda minúscula (barra de status) é ignorada', () => {
  // 1% da altura — bem menor que o mínimo de 3%
  const b = calcularBandas(1000, { cropY: 10, cropH: 990 });
  assert.deepStrictEqual(b, []);
});

test('calcularBandas: sem região de conteúdo (movimento não detectou nada), não há banda', () => {
  assert.deepStrictEqual(calcularBandas(1000, null), []);
  assert.deepStrictEqual(calcularBandas(0, { cropY: 0, cropH: 0 }), []);
});

// ── ehLixoDeVideo ──────────────────────────────────────────────────────────────

test('ehLixoDeVideo reconhece marca d\'água, hashtag solta e contador', () => {
  for (const lixo of ['@fatosinesperados', '©perfil_x', '#viral', '3/8', '22:37', 'Seguir', 'GIF']) {
    assert.ok(ehLixoDeVideo(lixo), `deixou passar: "${lixo}"`);
  }
});

test('ehLixoDeVideo não descarta frase de título de verdade', () => {
  for (const bom of [
    'Mais de 4 milhões de aposentados foram vítimas das fraudes',
    'Tralli: "Que explicação o senhor dá?"',
    'Nós já devolvemos 3,5 bilhões',
  ]) {
    assert.ok(!ehLixoDeVideo(bom), `descartou título de verdade: "${bom}"`);
  }
});

// ── montarCandidato ────────────────────────────────────────────────────────────

test('montarCandidato junta as linhas úteis da banda numa frase só', () => {
  const linhas = [
    { texto: 'Tralli: "Mais de 4 milhões de aposentados' },
    { texto: 'foram vítimas das fraudes.' },
  ];
  assert.strictEqual(
    montarCandidato(linhas),
    'Tralli: "Mais de 4 milhões de aposentados foram vítimas das fraudes.',
  );
});

test('montarCandidato tira a marca d\'água e o contador de dentro da banda', () => {
  const linhas = [
    { texto: '22:37' },
    { texto: '@norteouu' },
    { texto: 'Que explicação o senhor dá?' },
    { texto: '1/1' },
  ];
  assert.strictEqual(montarCandidato(linhas), 'Que explicação o senhor dá?');
});

test('montarCandidato devolve vazio quando a banda só tinha lixo', () => {
  const linhas = [{ texto: '22:37' }, { texto: 'Seguir' }];
  assert.strictEqual(montarCandidato(linhas), '');
});

test('montarCandidato aguenta lista vazia ou undefined sem quebrar', () => {
  assert.strictEqual(montarCandidato([]), '');
  assert.strictEqual(montarCandidato(undefined), '');
});
