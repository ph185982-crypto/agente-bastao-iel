// Testes da máquina viral — rode com: node --test backend/lib/viral.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const PB = require('../../static/viralPlaybook');
const { computeInsights, normalizePost, insightsParaPrompt } = require('./profileInsights');
const { render, wrap } = require('./viralRender');
const { normalizar, pickHook, nota, robo } = require('./viralWriter');

test('nota: post forte passa de 85, post fraco fica abaixo de 50', () => {
  const forte = PB.viralScore({
    template: 'antes_agora',
    hook: 'Seus R$ 100 de 1994 valem R$ 11,19 hoje.',
    slides: ['Em 1994, R$ 100 enchiam o tanque.', 'Em 2010, a gasolina custava R$ 2,57.', 'Hoje passa de R$ 6.', 'Lição. Manda pra alguém que guarda dinheiro parado.'].map((texto) => ({ texto })),
    caption: 'Não é você que gasta mais.\n\nManda pra alguém que precisa ver isso.',
    fontes: ['IBGE'],
  });
  const fraco = PB.viralScore({
    template: 'lista', hook: 'Descubra 5 dicas incríveis para você mudar sua vida financeira hoje mesmo de verdade',
    slides: [{ texto: 'x' }], caption: '#a #b #c #d #e', fontes: [],
  });
  assert.ok(forte.score >= 85, `forte=${forte.score}`);
  assert.ok(fraco.score < 50, `fraco=${fraco.score}`);
  assert.ok(fraco.checks.some((c) => !c.ok && /clichê/i.test(c.label)));
});

test('nota: número sem fonte perde ponto', () => {
  const base = { template: 'print', hook: 'R$ 100 viraram R$ 11.', slides: [{ texto: 'R$ 100 viraram R$ 11.' }], caption: 'Manda pra alguém.' };
  assert.ok(PB.viralScore({ ...base, fontes: ['BC'] }).score > PB.viralScore({ ...base, fontes: [] }).score);
});

test('leitura do perfil: acha o post campeão, o melhor formato e os padrões', () => {
  const mk = (pk, media_type, likes, caption, taken_at) => normalizePost({ pk, code: `c${pk}`, media_type, like_count: likes, comment_count: 0, caption: { text: caption }, taken_at, carousel_media_count: media_type === 8 ? 4 : undefined });
  const t = 1790000000;
  const posts = [
    mk(1, 8, 16000, 'Seus R$ 100 de 1994 valem R$ 11', t),
    mk(2, 8, 100, 'texto longo sobre política que ninguém leu até o fim porque não tinha gancho nenhum', t + 86400),
    mk(3, 1, 500, 'pense nisso', t + 2 * 86400),
    mk(4, 2, 80, 'vídeo genérico de motivação para empreendedores que querem crescer', t + 3 * 86400),
    mk(5, 1, 450, 'frase curta', t + 4 * 86400),
    mk(6, 2, 90, 'outro vídeo', t + 5 * 86400),
  ];
  const ins = computeInsights(posts, 100000, { agora: t + 30 * 86400 });
  assert.strictEqual(ins.top[0].gancho, 'Seus R$ 100 de 1994 valem R$ 11');
  assert.ok(ins.hipoteses.every((h) => h.suficiente === false), 'amostra de 6 posts não sustenta conclusão de formato');
  assert.ok(ins.por_formato.video.eng_mediana < ins.por_formato.imagem.eng_mediana);
  assert.ok(ins.top[0].vezes_mediana > 10);
  assert.match(insightsParaPrompt(ins), /POSTS COM MAIOR ENGAJAMENTO/);
});

test('quebra de linha mantém pontuação colada no destaque', () => {
  const linha = wrap('Hoje passa de **R$ 6**. E dobrou!', 40, 1000, 0.6)[0];
  const txt = linha.map((t, i) => (i && !t.glue ? ' ' : '') + t.t).join('').replace(/\u00A0/g, ' ');
  assert.strictEqual(txt, 'Hoje passa de R$ 6. E dobrou!');
});

test('render: cada modelo gera PNG 1080x1350 e o número certo de telas', async () => {
  const casos = [
    ['antes_agora', { slides: [{ texto: 'Em 1994 **R$ 100**' }, { texto: 'Hoje **R$ 11**' }, { texto: 'Cesta **dobrou**' }], licao: 'Lição', cta: 'Manda pra alguém.' }, 4],
    ['print', { frases: ['Uma frase **forte**.', 'Outra frase.'] }, 2],
    ['noticia', { manchete: 'Recusada por **70 famílias**', rotulo: 'história real' }, 1],
    ['lista', { titulo: '**4** erros', subtitulo: 's', itens: [1, 2, 3, 4].map((n) => ({ titulo: `Erro ${n}`, texto: 'caso real' })), licao: 'L', cta: 'C' }, 4],
  ];
  for (const [tpl, c, n] of casos) {
    const bufs = await render(tpl, c);
    assert.strictEqual(bufs.length, n, tpl);
    const m = await sharp(bufs[0]).metadata();
    assert.deepStrictEqual([m.width, m.height], [1080, 1350], tpl);
  }
});

test('redator: escolhe o gancho com número e coloca na capa', () => {
  const h = pickHook([
    { tipo: 'x', texto: 'Descubra o segredo incrível da inflação' },
    { tipo: 'copia', texto: 'Seus R$ 100 de 1994 valem R$ 11,19 hoje.' }, // exemplo do playbook: proibido
    { tipo: 'numero_choque', texto: 'Seus R$ 50 de 2000 compram metade hoje.' },
  ], 'antes_agora');
  assert.match(h.texto, /R\$ 50/);
  const c = normalizar('antes_agora', {
    ganchos: [{ tipo: 'numero_choque', texto: 'Seus **R$ 100** de 1995 compram um terço hoje.' }],
    slides: [{ texto: 'Em 1994 a gasolina…', foto: 'gas' }, { texto: 'Em 2000…' }, { texto: 'Hoje…' }],
    licao: 'l', caption: 'c', fontes: ['IBGE'],
  });
  assert.match(c.slides[0].texto, /R\$ 100/);
  assert.ok(nota('antes_agora', c).score > 0);
});

test('robô sem IA não inventa número: vira Print com a pauta', () => {
  const r = robo({ title: 'Promoção quase nunca é desconto', summary: 'Preço sobe antes da Black Friday.' }, 'antes_agora');
  assert.strictEqual(r.template, 'print');
  assert.ok(r.conteudo.frases.length >= 1);
});

test('R$ nunca fica sozinho no fim da linha', () => {
  const linhas = wrap('A conta de luz hoje chega a **R$ 150** por mês', 60, 560, 0.6);
  for (const l of linhas) assert.notStrictEqual(l[l.length - 1].t, 'R$');
});

test('nenhum gerador desenha selo de verificado para uma conta não verificada', () => {
  const fs = require('fs');
  const path = require('path');
  const { ACCOUNT } = require('./account');
  assert.strictEqual(ACCOUNT.verified, false);
  const tv = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tvCuts.js'), 'utf8');
  const ve = fs.readFileSync(path.join(__dirname, '..', 'routes', 'videoEditor.js'), 'utf8');
  const vr = fs.readFileSync(path.join(__dirname, 'viralRender.js'), 'utf8');
  // toda chamada de desenho do selo precisa estar condicionada à conta verificada
  const chamadasTv = [...tv.matchAll(/\$\{([^}]*)viralBadgeSvg\(/g)].map((m) => m[1]);
  assert.ok(chamadasTv.length && chamadasTv.every((pre) => /ACCOUNT\.verified \?/.test(pre)), 'cortes de TV');
  assert.match(ve, /const PROFILE_VERIFIED = ACCOUNT\.verified === true;/, 'editor de vídeo não liga o selo por variável de ambiente');
  assert.ok(!/1D9BF0/.test(vr), 'template Print sem o círculo azul');
});
