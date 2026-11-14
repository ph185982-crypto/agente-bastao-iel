// Vídeo pronto → carrossel no nosso formato (sem IA), só quando o Pedro toca no botão.
// node --test backend/lib/videos/carrossel.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('../armazem');
const M = require('../../../static/contentModel');
const G = require('../../../static/qualityGates');
const { ACCOUNT } = require('../account');
const C = require('./carrossel');

const FRASES = [
  'Você não precisa de investidor milionário para criar uma marca gigante.',
  'Uma designer americana provou isso na prática.',
  'E o passo final dela é a maior lição pro seu negócio.',
  'Ela focou em duas coisas básicas: produto com acabamento impecável e preço que a cliente consegue pagar.',
  'Quem manda no seu estoque manda na sua empresa.',
  'Salva esse vídeo para lembrar disso.',
];

test('páginas: capa com o título, conteúdo em páginas curtas (1ª frase em negrito), sem a chamada falada, e "Siga @" no fim', () => {
  const p = C.paginasDoVideo({ titulo: 'Marca forte sem investidor', frases: FRASES });
  assert.strictEqual(p[0][0].texto, 'Marca forte sem investidor');
  assert.match(p[p.length - 1][0].texto, new RegExp(ACCOUNT.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const corpo = p.slice(1, -1).flat();
  assert.ok(corpo.every((x) => !/Salva esse vídeo/.test(x.texto)));
  for (const pg of p.slice(1, -1)) {
    assert.ok(pg[0].negrito);
    assert.ok(pg.map((x) => x.texto).join(' ').split(/\s+/).length <= C.PALAVRAS_PAGINA + 20);
  }
  assert.ok(p.length <= C.MAX_PAGINAS);
});

test('carrosselDoVideo: monta as páginas, cria o carrossel em "Aprovar" sem bloqueio de imagem e não repete', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true })); const a = arm.armazem();
  const v = M.novoConteudo({ titulo: 'Construa uma marca forte', formato: 'reels', origem: { tipo: 'video' } });
  v.id = 'vd_teste1';
  v.video = { estado: 'pronto', transcricao: { texto: FRASES.join(' '), frases: FRASES.map((t, i) => ({ t0: i, t1: i + 1, texto: t })) }, legenda_ig: { texto: 'Legenda do vídeo.', hashtags: ['#marca'] } };
  await a.conteudos.salvar(ACCOUNT.ig_id, v.id, v, 0);
  const paginas = [];
  const deps = {
    armazem: a,
    trocaTexto: { paginaTexto: async (pg, op) => { paginas.push({ pg, op }); return Buffer.from('jpg'); } },
    arte: { renderizarSlide: async () => ({ png: Buffer.from('png'), metrics: { cabe: true } }) },
    sharp: () => ({ flatten: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from('jpg') }) }) }),
  };
  const r = await C.carrosselDoVideo(v.id, { deps });
  assert.ok(r.id && r.paginas >= 3);
  assert.ok(paginas.every((p) => p.op.fundo === 'preto' && p.op.assinatura === ACCOUNT.handle));
  const c = (await a.conteudos.obter(ACCOUNT.ig_id, r.id)).doc;
  assert.strictEqual(c.formato, 'carrossel'); assert.strictEqual(c.status, 'em_revisao');
  const ver = M.versaoAtiva(c);
  assert.strictEqual(ver.slides.length, r.paginas);
  assert.match(ver.legenda, /Legenda do vídeo/);
  assert.strictEqual(c.arte.renders.length, r.paginas);
  const bl = G.avaliar(c, { conta: M.ACCOUNT_PIN }).bloqueios;
  assert.ok(!bl.some((b) => b.id === 'imagem_sem_origem'), JSON.stringify(bl.map((b) => b.id)));
  // tocar de novo devolve o mesmo carrossel
  const r2 = await C.carrosselDoVideo(v.id, { deps });
  assert.strictEqual(r2.id, r.id); assert.ok(r2.ja_existia);
});

test('carrosselDoVideo: vídeo que não está pronto ou quase sem fala não vira carrossel', async () => {
  arm._definir(Object.assign(arm.memoria(), { duravel: true })); const a = arm.armazem();
  const v = M.novoConteudo({ titulo: 'x', formato: 'reels' }); v.id = 'vd_teste2'; v.video = { estado: 'editando' };
  await a.conteudos.salvar(ACCOUNT.ig_id, v.id, v, 0);
  await assert.rejects(C.carrosselDoVideo(v.id, { deps: { armazem: a } }), (e) => e.code === 'NAO_PRONTO');
  v.video = { estado: 'pronto', transcricao: { frases: [{ texto: 'Oi.' }] } };
  await a.conteudos.salvar(ACCOUNT.ig_id, v.id, v, 1);
  await assert.rejects(C.carrosselDoVideo(v.id, { deps: { armazem: a } }), (e) => e.code === 'POUCO_TEXTO');
});
