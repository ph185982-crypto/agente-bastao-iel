// Testes do resolvedor do Facebook — rode com: node --test backend/lib/facebookDownloader.test.js
// Só as funções puras (interpretação de erro e de resposta) são testadas: elas
// não fazem rede, então os testes não dependem da API estar no ar.
const test = require('node:test');
const assert = require('node:assert');
const { interpretarErroHttp, interpretarResposta } = require('./facebookDownloader');

test('interpretarErroHttp: chave inválida (401/403) sai com mensagem específica', () => {
  const e = interpretarErroHttp({ response: { status: 403 } });
  assert.match(e.message, /chave.*recusada|RAPIDAPI_KEY_FACEBOOK/i);
  assert.strictEqual(e.isDownloadError, true);
});

test('interpretarErroHttp: cota/limite (429) explica renovar ou esperar', () => {
  const e = interpretarErroHttp({ response: { status: 429 } });
  assert.match(e.message, /pedidos demais|cota|renove/i);
});

test('interpretarErroHttp: timeout de rede vira mensagem de "demorou demais"', () => {
  const e = interpretarErroHttp({ code: 'ECONNABORTED', message: 'timeout of 25000ms exceeded' });
  assert.match(e.message, /demorou demais/i);
});

test('interpretarErroHttp: erro desconhecido não trava, sai com mensagem genérica', () => {
  const e = interpretarErroHttp({ message: 'network is down' });
  assert.ok(e.message.trim(), 'mensagem vazia');
  assert.strictEqual(e.isDownloadError, true);
});

test('interpretarResposta: sucesso via media[].hd_url devolve os campos certos', () => {
  // Formato real observado: vídeo público resolvido com sucesso.
  const r = interpretarResposta({
    success: true,
    title: 'How to share with just friends.',
    thumbnail: '',
    links: {
      'Download Low Quality': 'https://fbcdn.net/sd.mp4',
      'Download High Quality': 'https://fbcdn.net/hd.mp4',
    },
    media: [{ type: 'Video', sd_url: 'https://fbcdn.net/sd.mp4', hd_url: 'https://fbcdn.net/hd.mp4', width: 1920, height: 1080 }],
  });
  assert.strictEqual(r.videoUrl, 'https://fbcdn.net/hd.mp4');
  assert.strictEqual(r.width, 1920);
  assert.strictEqual(r.caption, 'How to share with just friends.');
});

test('interpretarResposta: sem media[], cai pro mapa "links"', () => {
  const r = interpretarResposta({
    success: true,
    links: { 'Download High Quality': 'https://fbcdn.net/hd.mp4' },
    media: [],
  });
  assert.strictEqual(r.videoUrl, 'https://fbcdn.net/hd.mp4');
});

test('interpretarResposta: success:false sem vídeo (link inválido/privado sem posts) lança erro', () => {
  // Formato real observado: link de reel inexistente/indisponível.
  assert.throws(
    () => interpretarResposta({ success: false, title: 'Facebook', links: {}, media: [] }),
    /Não encontrei vídeo/,
  );
});

test('interpretarResposta: campo "error" explícito (vídeo privado) sai com a causa real', () => {
  // Formato real observado pra fb.watch de vídeo privado.
  assert.throws(
    () => interpretarResposta({ success: false, error: 'Error: Video is private or not available right now.' }),
    /privado|not available/,
  );
});

test('interpretarResposta: aguenta resposta vazia sem quebrar feio', () => {
  assert.throws(() => interpretarResposta({}), /Não encontrei vídeo/);
  assert.throws(() => interpretarResposta(null), /Não encontrei vídeo/);
});
