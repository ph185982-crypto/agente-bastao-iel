// Testes do resolvedor socialkit.dev — rode com: node --test backend/lib/socialkit.test.js
// Só as funções puras (interpretação de erro e de resposta) são testadas: elas
// não fazem rede, então os testes não dependem da API estar no ar.
const test = require('node:test');
const assert = require('node:assert');
const { interpretarErroHttp, interpretarResposta } = require('./socialkit');

test('interpretarErroHttp: chave inválida (401) sai com mensagem específica', () => {
  const e = interpretarErroHttp({ response: { status: 401, data: { message: 'Access key is missing' } } });
  assert.match(e.message, /chave.*recusada|SOCIALKIT_API_KEY/i);
  assert.strictEqual(e.isDownloadError, true);
});

test('interpretarErroHttp: cota estourada (429) não confunde com chave inválida', () => {
  const e = interpretarErroHttp({ response: { status: 429, data: {} } });
  assert.match(e.message, /pedidos demais|espere/i);
});

test('interpretarErroHttp: sem crédito (402) explica que precisa renovar', () => {
  const e = interpretarErroHttp({ response: { status: 402, data: {} } });
  assert.match(e.message, /cota.*acabou|renovar/i);
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

test('interpretarResposta: sucesso com vídeo devolve os campos certos', () => {
  const r = interpretarResposta({
    success: true,
    data: {
      videoUrl: 'https://cdninstagram.com/video.mp4',
      thumbnail: 'https://cdninstagram.com/thumb.jpg',
      duration: '0:27',
      description: 'legenda do post',
      author: 'fulano',
    },
  });
  assert.strictEqual(r.videoUrl, 'https://cdninstagram.com/video.mp4');
  assert.strictEqual(r.durationSec, 27);
  assert.strictEqual(r.author, 'fulano');
});

test('interpretarResposta: duração em minutos e segundos soma certo', () => {
  const r = interpretarResposta({
    success: true,
    data: { videoUrl: 'https://x.mp4', duration: '1:15' },
  });
  assert.strictEqual(r.durationSec, 75);
});

test('interpretarResposta: success:false lança com a mensagem da API', () => {
  assert.throws(
    () => interpretarResposta({ success: false, message: 'Invalid Access key' }),
    /Invalid Access key/,
  );
});

test('interpretarResposta: success:true mas com campos vazios (link inválido/privado) lança erro', () => {
  // Esta é a particularidade da API: HTTP 200 + success:true, mas sem vídeo —
  // não pode ser tratado como sucesso só porque o campo "success" está true.
  assert.throws(
    () => interpretarResposta({
      success: true,
      data: { videoUrl: '', isVideo: false, contentType: 'reel' },
    }),
    /Não encontrei vídeo/,
  );
});

test('interpretarResposta: post de foto (não-vídeo) explica a causa real', () => {
  assert.throws(
    () => interpretarResposta({
      success: true,
      data: { videoUrl: '', isVideo: false, contentType: 'post' },
    }),
    /não é um vídeo|post de foto/,
  );
});

test('interpretarResposta: aguenta resposta vazia ou sem data sem quebrar feio', () => {
  assert.throws(() => interpretarResposta({}), /Não consegui processar/);
  assert.throws(() => interpretarResposta(null), /Não consegui processar/);
  assert.throws(() => interpretarResposta({ success: true }), /Não encontrei vídeo/);
});
