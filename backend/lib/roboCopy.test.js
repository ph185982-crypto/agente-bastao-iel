// Testes do robô de copy — rode com: node --test backend/lib/roboCopy.test.js
// Não precisa de chave de IA nem de rede: é tudo determinístico.
const test = require('node:test');
const assert = require('node:assert');
const { gerarCarrossel, nucleoDoTema, nucleoCurto, palavrasChave, FRAMEWORKS, MARCADOR } = require('./roboCopy');

const HANDLE = '@pedro_destrava';

test('nucleoDoTema tira o pronome interrogativo da frente', () => {
  assert.strictEqual(nucleoDoTema('como vender mais'), 'vender mais');
  assert.strictEqual(nucleoDoTema('o que é produtividade'), 'é produtividade');
  assert.strictEqual(nucleoDoTema('produtividade'), 'produtividade');
  assert.strictEqual(nucleoDoTema(''), 'esse assunto');
});

test('nucleoCurto nunca termina em preposição', () => {
  // O bug original gerava títulos como "O problema real de vender mais na"
  assert.strictEqual(nucleoCurto('vender mais na internet'), 'vender mais');
  assert.strictEqual(nucleoCurto('produtividade'), 'produtividade');
  for (const tema of ['dicas de venda no digital', 'foco na rotina de trabalho', 'ganhar dinheiro com o instagram']) {
    const curto = nucleoCurto(nucleoDoTema(tema));
    const ultima = curto.split(/\s+/).pop().toLowerCase();
    assert.ok(!['de', 'na', 'no', 'com', 'em', 'pra', 'para', 'do', 'da'].includes(ultima),
      `"${curto}" termina em preposição`);
  }
});

test('palavrasChave remove stopwords e acentos', () => {
  const p = palavrasChave('como não perder o foco na rotina');
  assert.ok(!p.includes('como'), 'stopword "como" vazou');
  assert.ok(!p.includes('nao'), 'stopword "não" vazou');
  assert.ok(p.includes('perder') || p.includes('foco'), 'perdeu as palavras úteis');
  assert.ok(p.every(w => /^[a-z0-9]+$/.test(w)), 'sobrou acento ou pontuação');
});

test('gera a quantidade de telas pedida, com capa e CTA nas pontas', () => {
  for (const n of [5, 6, 7, 8, 10]) {
    const c = gerarCarrossel({ topic: 'vender mais', slideCount: n, handle: HANDLE });
    assert.strictEqual(c.slides.length, n, `pediu ${n} telas`);
    assert.strictEqual(c.slides[0].kind, 'cover');
    assert.strictEqual(c.slides[c.slides.length - 1].kind, 'cta');
  }
});

test('slideCount fora do intervalo é ajustado para 5..10', () => {
  assert.strictEqual(gerarCarrossel({ topic: 'x', slideCount: 2 }).slides.length, 5);
  assert.strictEqual(gerarCarrossel({ topic: 'x', slideCount: 99 }).slides.length, 10);
  assert.strictEqual(gerarCarrossel({ topic: 'x', slideCount: 'abc' }).slides.length, 7);
});

test('telas de conteúdo são numeradas em sequência a partir de 01', () => {
  const c = gerarCarrossel({ topic: 'vender mais', slideCount: 7, handle: HANDLE });
  const nums = c.slides.filter(s => s.kind === 'content').map(s => s.number);
  assert.deepStrictEqual(nums, ['01', '02', '03', '04', '05']);
});

test('a ordem do framework é preservada — não pode embaralhar', () => {
  // O framework tem lógica sequencial: problema vem antes da solução.
  // Embaralhar (bug original) quebrava o encadeamento do carrossel.
  const c = gerarCarrossel({ topic: 'vender mais', slideCount: 8, handle: HANDLE, variante: 0 });
  const framework = Object.values(FRAMEWORKS).find(f => f.nome === c.framework);
  assert.ok(framework, 'framework retornado não existe no banco');

  const titulosGerados = c.slides.filter(s => s.kind === 'content').map(s => s.title);
  const titulosEsperados = framework.papeis
    .slice(0, titulosGerados.length)
    .map(p => p.titulo(nucleoCurto(nucleoDoTema('vender mais'))));
  assert.deepStrictEqual(titulosGerados, titulosEsperados, 'a ordem dos papéis mudou');
});

test('mesmo tema + mesma variante = mesmo resultado', () => {
  const a = gerarCarrossel({ topic: 'vender mais', slideCount: 6, handle: HANDLE, variante: 3 });
  const b = gerarCarrossel({ topic: 'vender mais', slideCount: 6, handle: HANDLE, variante: 3 });
  assert.deepStrictEqual(a, b);
});

test('variantes diferentes geram carrosséis diferentes', () => {
  const vistos = new Set();
  for (let v = 0; v < 8; v++) {
    const c = gerarCarrossel({ topic: 'vender mais', slideCount: 6, handle: HANDLE, variante: v });
    vistos.add(JSON.stringify(c.slides));
  }
  assert.ok(vistos.size > 1, 'todas as variantes saíram iguais');
});

test('o corpo das telas tem substância (>= 20 palavras, como manda o layout)', () => {
  for (const tema of ['vender mais', 'produtividade', 'como criar conteudo']) {
    for (let v = 0; v < 5; v++) {
      const c = gerarCarrossel({ topic: tema, slideCount: 8, handle: HANDLE, variante: v });
      for (const s of c.slides.filter(x => x.kind === 'content')) {
        const n = s.body.replace(MARCADOR, '').trim().split(/\s+/).length;
        assert.ok(n >= 20, `"${s.title}" tem só ${n} palavras: ${s.body}`);
      }
    }
  }
});

test('nenhum título corta no meio nem passa do limite visual', () => {
  for (const tema of ['como vender mais na internet', 'dicas de produtividade no trabalho', 'x']) {
    for (let v = 0; v < 5; v++) {
      const c = gerarCarrossel({ topic: tema, slideCount: 8, handle: HANDLE, variante: v });
      for (const s of c.slides) {
        assert.ok(s.title && s.title.trim(), 'título vazio');
        assert.ok(s.title.split(/\s+/).length <= 10, `título longo demais: "${s.title}"`);
        const ultima = s.title.split(/\s+/).pop().toLowerCase().replace(/[^a-zà-ú]/g, '');
        // "para" fica de fora: em "Onde quase todo mundo para" é o verbo parar,
        // não a preposição — a checagem por palavra isolada não distingue.
        assert.ok(!['de', 'na', 'no', 'com', 'em', 'pra', 'do', 'da', 'que'].includes(ultima),
          `título cortado no meio: "${s.title}"`);
      }
    }
  }
});

test('não usa emoji dentro das telas — o renderer não desenha emoji', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (let v = 0; v < 6; v++) {
    const c = gerarCarrossel({ topic: 'vender mais', slideCount: 9, handle: HANDLE, variante: v });
    for (const s of c.slides) {
      assert.ok(!emoji.test([s.title, s.subtitle, s.body].filter(Boolean).join(' ')),
        `emoji na tela: ${s.title}`);
    }
  }
});

test('a legenda leva emoji, o handle e no máximo 5 hashtags', () => {
  const c = gerarCarrossel({ topic: 'como vender mais na internet', slideCount: 6, handle: HANDLE });
  const tags = c.caption.match(/#[\wà-ú]+/gi) || [];
  assert.ok(tags.length >= 1 && tags.length <= 5, `${tags.length} hashtags`);
  assert.strictEqual(new Set(tags).size, tags.length, 'hashtag repetida');
  assert.ok(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c.caption), 'legenda sem emoji');
});

test('o CTA cita o handle informado', () => {
  const c = gerarCarrossel({ topic: 'vender mais', slideCount: 5, handle: '@outro_perfil' });
  const cta = c.slides[c.slides.length - 1];
  assert.ok(cta.body.includes('@outro_perfil'), `CTA sem o handle: ${cta.body}`);
});

test('marca onde entra o fato específico, e dá pra desligar', () => {
  const com = gerarCarrossel({ topic: 'vender mais', slideCount: 6, handle: HANDLE });
  assert.ok(com.slides.some(s => (s.body || '').includes(MARCADOR)), 'faltou o marcador');

  const sem = gerarCarrossel({ topic: 'vender mais', slideCount: 6, handle: HANDLE, marcadores: false });
  assert.ok(!sem.slides.some(s => (s.body || '').includes(MARCADOR)), 'marcador não foi desligado');
});

test('aguenta entrada vazia ou lixo sem quebrar', () => {
  for (const entrada of [{}, { topic: '' }, { topic: '   ' }, { topic: '!!!' }, { theme: 'ciência' }]) {
    const c = gerarCarrossel({ ...entrada, handle: HANDLE });
    assert.ok(c.slides.length >= 5, 'não gerou telas');
    assert.ok(c.caption.trim(), 'legenda vazia');
    assert.ok(c.slides.every(s => s.title && s.title.trim()), 'tela sem título');
  }
});
