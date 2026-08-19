// Testes do robô de copy de Reels — rode com: node --test backend/lib/roboReel.test.js
// Não precisa de chave de IA nem de rede: é tudo determinístico.
const test = require('node:test');
const assert = require('node:assert');
const { gerarCopyReel, limparGancho, limitarGancho, MARCADOR_REEL } = require('./roboReel');

const HANDLE = '@pedro_destrava';
const EMOJI = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

test('limparGancho tira emoji, hashtag e aspas — o gancho vai queimado na imagem', () => {
  assert.strictEqual(limparGancho('"Vender mais" 🚀 #vendas'), 'Vender mais');
  assert.strictEqual(limparGancho('Foco na rotina.'), 'Foco na rotina');
  assert.strictEqual(limparGancho(''), '');
});

test('limitarGancho corta no limite sem deixar conector solto no fim', () => {
  assert.strictEqual(limitarGancho('a b c d e', 3), 'a b c');
  // cortar em 4 deixaria "o erro que trava de" → o conector tem que cair
  assert.strictEqual(limitarGancho('o erro que trava de vender', 5), 'o erro que trava');
  assert.strictEqual(limitarGancho('curto', 12), 'curto');
});

test('o gancho respeita as regras do layout: <= 12 palavras, sem emoji/hashtag/aspas', () => {
  for (const tema of ['vender mais na internet', 'como ter foco na rotina', 'produtividade', 'x']) {
    for (let v = 0; v < 6; v++) {
      const { headline } = gerarCopyReel({ tema, handle: HANDLE, variante: v });
      assert.ok(headline.trim(), `gancho vazio para "${tema}"`);
      assert.ok(headline.split(/\s+/).length <= 12, `gancho longo demais: "${headline}"`);
      assert.ok(!EMOJI.test(headline), `emoji no gancho: "${headline}"`);
      assert.ok(!/[#"'“”]/.test(headline), `pontuação proibida no gancho: "${headline}"`);
    }
  }
});

test('gancho escrito pelo autor é mantido, não reescrito', () => {
  const meu = 'Isso aqui destrava suas vendas hoje';
  const { headline } = gerarCopyReel({ tema: 'vendas', headline: meu, handle: HANDLE });
  assert.strictEqual(headline, meu);
});

test('gancho do autor entra limpo mesmo vindo com emoji e aspas', () => {
  const { headline } = gerarCopyReel({ tema: 'vendas', headline: '"Pare de fazer isso" 🔥', handle: HANDLE });
  assert.strictEqual(headline, 'Pare de fazer isso');
});

test('a legenda tem CTA de seguir com o handle — é obrigatório', () => {
  for (let v = 0; v < 6; v++) {
    const { caption } = gerarCopyReel({ tema: 'vender mais', handle: '@outro_perfil', variante: v });
    assert.ok(caption.includes('@outro_perfil'), `legenda sem o handle: ${caption}`);
    assert.ok(/segue/i.test(caption), 'legenda sem CTA de seguir');
  }
});

test('a legenda leva emoji com moderação e no máximo 5 hashtags, sem repetir', () => {
  const { caption } = gerarCopyReel({ tema: 'como vender mais na internet', handle: HANDLE });
  const tags = caption.match(/#[\wà-ú]+/gi) || [];
  assert.ok(tags.length >= 3 && tags.length <= 5, `${tags.length} hashtags`);
  assert.strictEqual(new Set(tags).size, tags.length, 'hashtag repetida');

  const emojis = caption.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
  assert.ok(emojis.length >= 1 && emojis.length <= 4, `${emojis.length} emoji na legenda`);
});

test('a legenda tem corpo de verdade — abertura, contexto e aplicação', () => {
  const { caption } = gerarCopyReel({ tema: 'produtividade', handle: HANDLE });
  const paragrafos = caption.split('\n').filter(l => l.trim());
  assert.ok(paragrafos.length >= 4, `só ${paragrafos.length} blocos na legenda`);
  const semTags = caption.replace(/#[\wà-ú]+/gi, '').trim();
  assert.ok(semTags.split(/\s+/).length >= 60, 'legenda curta demais para dar contexto');
});

test('marca onde entra o fato do vídeo, e dá pra desligar', () => {
  const com = gerarCopyReel({ tema: 'vender mais', handle: HANDLE });
  assert.ok(com.caption.includes(MARCADOR_REEL), 'faltou o marcador');

  const sem = gerarCopyReel({ tema: 'vender mais', handle: HANDLE, marcadores: false });
  assert.ok(!sem.caption.includes(MARCADOR_REEL), 'marcador não foi desligado');
});

test('o marcador nunca aparece no gancho — ele vai queimado no vídeo', () => {
  for (let v = 0; v < 8; v++) {
    const { headline } = gerarCopyReel({ tema: 'vender mais', handle: HANDLE, variante: v });
    assert.ok(!headline.includes(MARCADOR_REEL), 'marcador vazou pro gancho');
    assert.ok(!headline.includes('['), `colchete no gancho: "${headline}"`);
  }
});

test('mesmo tema + mesma variante = mesmo resultado', () => {
  const a = gerarCopyReel({ tema: 'vender mais', handle: HANDLE, variante: 3 });
  const b = gerarCopyReel({ tema: 'vender mais', handle: HANDLE, variante: 3 });
  assert.deepStrictEqual(a, b);
});

test('variantes diferentes geram copies diferentes', () => {
  const vistos = new Set();
  for (let v = 0; v < 8; v++) {
    vistos.add(JSON.stringify(gerarCopyReel({ tema: 'vender mais', handle: HANDLE, variante: v })));
  }
  assert.ok(vistos.size > 1, 'todas as variantes saíram iguais');
});

test('só com o gancho, sem tema, ainda escreve uma legenda coerente', () => {
  const { headline, caption } = gerarCopyReel({ headline: 'O erro que trava suas vendas', handle: HANDLE });
  assert.strictEqual(headline, 'O erro que trava suas vendas');
  assert.ok(caption.trim(), 'legenda vazia');
  assert.ok(caption.includes(HANDLE), 'legenda sem o handle');
});

test('tema gigante (uma transcrição inteira) não vaza pra legenda', () => {
  const transcricao = 'entao galera hoje eu vou falar sobre uma coisa que mudou completamente ' +
    'a forma como eu vendo no digital e eu tenho certeza que isso vai te ajudar tambem '.repeat(6);
  const { headline, caption } = gerarCopyReel({ tema: transcricao, handle: HANDLE });
  assert.ok(headline.split(/\s+/).length <= 12, `gancho longo demais: "${headline}"`);
  const semTags = caption.replace(/#[\wà-ú]+/gi, '');
  assert.ok(semTags.split(/\s+/).length < 200, 'a transcrição vazou pra legenda');
  assert.ok(!caption.includes('tenho certeza que isso vai te ajudar'), 'trecho cru da transcrição na legenda');
});

test('aguenta entrada vazia ou lixo sem quebrar', () => {
  for (const entrada of [{}, { tema: '' }, { tema: '   ' }, { tema: '!!!' }, { tema: '#'.repeat(50) }]) {
    const c = gerarCopyReel({ ...entrada, handle: HANDLE });
    assert.ok(c.headline.trim(), `gancho vazio para ${JSON.stringify(entrada)}`);
    assert.ok(c.caption.trim(), 'legenda vazia');
    assert.ok(c.caption.includes(HANDLE), 'legenda sem o handle');
    assert.ok(!EMOJI.test(c.headline), 'emoji no gancho');
  }
});
