// Testes do clonador de carrossel — rode com: node --test backend/lib/lerCarrossel.test.js
// As fixtures reproduzem o que a OCR devolve de um print de UMA tela de
// carrossel do Instagram. Só a separação e a remontagem são testadas: são
// funções puras, não precisam de imagem nem de rede.
const test = require('node:test');
const assert = require('node:assert');
const {
  separarTelaDeCarrossel, montarCarrosselDoPrint, ehChromeCarrossel, pareceCta,
} = require('./lerCarrossel');

const HANDLE = '@pedro_destrava';

const CAPA = `22:37
@fatosinesperados

Abastecer de noite rende mais?

A física explica em 8 telas
ARRASTA >>>
1/8`;

const CONTEUDO = `22:37

Dilatação térmica

Combustível ocupa mais espaço quando esquenta e menos quando
esfria. Como o posto vende por litro e não por massa, o mesmo
dinheiro compra quantidades diferentes conforme a temperatura.
3/8`;

// Tela sem linha em branco separando título de corpo — o caso difícil.
const COLADO = `22:37
O tanque não sabe a temperatura. A bomba mede volume, não massa, então a conta muda com o calor do dia.
5/8`;

const CTA_ORIGINAL = `22:37

Gostou?

Segue @fatosinesperados pra ver mais
Salva e compartilha com quem precisa
8/8`;

test('ehChromeCarrossel derruba contador, seta e relógio', () => {
  for (const lixo of ['1/8', '3 de 8', 'ARRASTA >>>', '→', '22:37', '•••']) {
    assert.ok(ehChromeCarrossel(lixo), `deixou passar: "${lixo}"`);
  }
  for (const bom of ['Dilatação térmica', 'Abastecer de noite rende mais?']) {
    assert.ok(!ehChromeCarrossel(bom), `descartou conteúdo: "${bom}"`);
  }
});

test('capa: título separado do subtítulo, sem o contador', () => {
  const r = separarTelaDeCarrossel(CAPA);
  assert.strictEqual(r.title, 'Abastecer de noite rende mais?');
  assert.ok(!/1\/8|ARRASTA|22:37|fatosinesperados/.test(r.title + r.body), `vazou interface: ${JSON.stringify(r)}`);
  assert.ok(r.body.includes('A física explica'), `corpo: ${r.body}`);
});

test('tela de conteúdo: título curto em cima, corpo remontado embaixo', () => {
  const r = separarTelaDeCarrossel(CONTEUDO);
  assert.strictEqual(r.title, 'Dilatação térmica');
  assert.ok(r.body.startsWith('Combustível ocupa mais espaço'), `corpo: ${r.body}`);
  // as quebras de linha da tela viram frase corrida
  assert.ok(r.body.includes('quando esfria'), 'quebra de linha virou quebra de frase');
  assert.ok(!/3\/8/.test(r.body), 'contador entrou no corpo');
  assert.strictEqual(r.ehCta, false);
});

test('tela colada: a primeira frase vira título, o resto vira corpo', () => {
  const r = separarTelaDeCarrossel(COLADO);
  assert.strictEqual(r.title, 'O tanque não sabe a temperatura.');
  assert.ok(r.body.startsWith('A bomba mede volume'), `corpo: ${r.body}`);
  assert.ok(r.title.split(/\s+/).length <= 12, 'título longo demais');
});

test('reconhece a tela de CTA do autor original', () => {
  assert.ok(pareceCta('Segue @fulano pra ver mais'), 'não reconheceu CTA');
  assert.ok(!pareceCta('Combustível ocupa mais espaço quando esquenta'), 'confundiu conteúdo com CTA');
  assert.strictEqual(separarTelaDeCarrossel(CTA_ORIGINAL).ehCta, true);
});

test('o CTA do autor original é trocado pelo nosso', () => {
  const telas = [CAPA, CONTEUDO, COLADO, CTA_ORIGINAL].map(separarTelaDeCarrossel);
  const c = montarCarrosselDoPrint({ telas, handle: HANDLE, tema: 'abastecer combustível', variante: 1 });

  assert.ok(c.ctaTrocado, 'não trocou o CTA');
  const ultima = c.slides[c.slides.length - 1];
  assert.strictEqual(ultima.kind, 'cta');
  assert.ok(ultima.body.includes(HANDLE), `CTA sem o nosso handle: ${ultima.body}`);
  const texto = JSON.stringify(c.slides);
  assert.ok(!/fatosinesperados/i.test(texto), 'o perfil de origem sobreviveu nas telas');
});

test('a estrutura sai no formato do nosso renderizador', () => {
  const telas = [CAPA, CONTEUDO, COLADO].map(separarTelaDeCarrossel);
  const c = montarCarrosselDoPrint({ telas, handle: HANDLE, tema: 'combustível', variante: 0 });

  assert.strictEqual(c.slides[0].kind, 'cover');
  assert.strictEqual(c.slides[c.slides.length - 1].kind, 'cta');
  const meio = c.slides.filter(s => s.kind === 'content');
  assert.deepStrictEqual(meio.map(s => s.number), ['01', '02']);
  for (const s of meio) {
    assert.ok(s.title && s.title.trim(), 'tela de conteúdo sem título');
    assert.ok(s.body && s.body.trim(), 'tela de conteúdo sem corpo');
  }
});

test('o texto das telas é preservado — o clone não reescreve', () => {
  const telas = [CAPA, CONTEUDO].map(separarTelaDeCarrossel);
  const c = montarCarrosselDoPrint({ telas, handle: HANDLE, tema: 'combustível' });
  assert.strictEqual(c.slides[0].title, 'Abastecer de noite rende mais?');
  const conteudo = c.slides.find(s => s.kind === 'content');
  assert.ok(conteudo.body.includes('Combustível ocupa mais espaço'), 'reescreveu o corpo');
});

test('legenda lida do print entra inteira, com o nosso fecho', () => {
  const telas = [CAPA, CONTEUDO].map(separarTelaDeCarrossel);
  const legendaOriginal = 'A diferença entre abastecer de dia ou à noite está ligada à dilatação térmica.';
  const c = montarCarrosselDoPrint({ telas, handle: HANDLE, tema: 'combustível', caption: legendaOriginal, variante: 2 });

  assert.ok(c.caption.startsWith(legendaOriginal), 'não aproveitou a legenda lida');
  assert.ok(c.caption.includes(HANDLE), 'legenda sem o nosso handle');
  assert.ok(/#\w+/.test(c.caption), 'legenda sem hashtags');
});

test('sem legenda lida, o robô escreve uma', () => {
  const telas = [CAPA, CONTEUDO].map(separarTelaDeCarrossel);
  const c = montarCarrosselDoPrint({ telas, handle: HANDLE, tema: 'combustível', variante: 3 });
  assert.ok(c.caption.trim(), 'legenda vazia');
  assert.ok(c.caption.includes(HANDLE), 'legenda sem o nosso handle');
});

// ── Separação pela altura da letra ────────────────────────────────────────────
// Alturas medidas de um print real: título 63px, corpo 38px, interface 16-31px.
const LINHAS_REAIS = {
  text: 'ignorado quando há linhas',
  linhas: [
    { texto: '22:37', altura: 28 },
    { texto: 'Ofatosinesperados', altura: 31 },
    { texto: 'o o ” o', altura: 16 },
    { texto: 'Dilatação térmica', altura: 63 },
    { texto: 'Combustível ocupa mais espaço quando', altura: 39 },
    { texto: 'esquenta e menos quando esfria. Como o', altura: 38 },
    { texto: 'posto vende por litro e não por massa.', altura: 38 },
    { texto: '1/4 ARRASTA >>>', altura: 30 },
  ],
};

test('a altura da letra separa título de corpo mesmo sem linha em branco', () => {
  const r = separarTelaDeCarrossel(LINHAS_REAIS);
  assert.strictEqual(r.title, 'Dilatação térmica');
  assert.ok(r.body.startsWith('Combustível ocupa mais espaço'), `corpo: ${r.body}`);
  assert.ok(r.body.includes('quando esquenta'), 'quebra de linha virou quebra de frase');
});

test('lixo da OCR e interface não entram no título nem no corpo', () => {
  const r = separarTelaDeCarrossel(LINHAS_REAIS);
  const tudo = `${r.title} ${r.body}`;
  assert.ok(!/22:37/.test(tudo), 'relógio vazou');
  assert.ok(!/fatosinesperados/i.test(tudo), 'marca d\'água vazou');
  assert.ok(!/”/.test(tudo), 'ruído da OCR vazou');
  assert.ok(!/1\/4|ARRASTA|>>>/.test(tudo), 'contador ou seta vazou');
});

test('contador e seta são arrancados de dentro da linha, não só da linha inteira', () => {
  // "1/4    ARRASTA >>>" vem numa linha só, com o texto entre eles nas pontas
  const r = separarTelaDeCarrossel({
    linhas: [
      { texto: 'O tanque é subterrâneo', altura: 60 },
      { texto: 'A diferença real é de centavos.', altura: 38 },
      { texto: '3/4 ARRASTA >>>', altura: 29 },
    ],
  });
  assert.strictEqual(r.title, 'O tanque é subterrâneo');
  assert.strictEqual(r.body, 'A diferença real é de centavos.');
});

test('tela sem título destacado cai na heurística de texto, sem quebrar', () => {
  const r = separarTelaDeCarrossel({
    text: 'Tudo do mesmo tamanho aqui. Segunda frase do corpo.',
    linhas: [
      { texto: 'Tudo do mesmo tamanho aqui.', altura: 40 },
      { texto: 'Segunda frase do corpo.', altura: 40 },
    ],
  });
  assert.ok(r.title.trim(), 'ficou sem título');
  assert.ok(r.title.split(/\s+/).length <= 12, 'título longo demais');
});

test('a foto lida em cada tela chega até o slide correspondente', () => {
  const telas = [
    { ...separarTelaDeCarrossel(CAPA), foto: 'data:image/jpeg;base64,CAPA_FOTO' },
    { ...separarTelaDeCarrossel(CONTEUDO), foto: 'data:image/jpeg;base64,TELA2_FOTO' },
    { ...separarTelaDeCarrossel(COLADO), foto: null }, // sem foto de verdade nesta
  ];
  const c = montarCarrosselDoPrint({ telas, handle: HANDLE, tema: 'combustível' });

  assert.strictEqual(c.slides[0].kind, 'cover');
  assert.strictEqual(c.slides[0].foto, 'data:image/jpeg;base64,CAPA_FOTO');

  const conteudo = c.slides.filter(s => s.kind === 'content');
  assert.strictEqual(conteudo[0].foto, 'data:image/jpeg;base64,TELA2_FOTO');
  assert.strictEqual(conteudo[1].foto, null);

  // o CTA é sempre o nosso template — nunca carrega foto do post original
  assert.ok(!c.slides[c.slides.length - 1].foto, 'CTA não deveria ter foto');
});

test('aguenta print ilegível e lista vazia sem quebrar', () => {
  for (const entrada of ['', '   ', '22:37\n1/8', '!!!']) {
    const r = separarTelaDeCarrossel(entrada);
    assert.strictEqual(typeof r.title, 'string');
    assert.strictEqual(typeof r.body, 'string');
  }
  assert.strictEqual(montarCarrosselDoPrint({ telas: [] }), null);
  assert.strictEqual(montarCarrosselDoPrint({ telas: [{ title: '', body: '' }] }), null);
});
