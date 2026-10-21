// Facebook opcional + esqueleto do LinkedIn, contra a Graph simulada. node --test backend/lib/publishersFb.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const A = require('./armazem');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');
const { ACCOUNT } = require('./account');
const { graphFalsa } = require('./graphFalsa');

const TOKEN = 'TOKEN_FALSO_FB';
let graph; let envAntes; let arm; let PUB; let conteudo;

function aprovado(extras = 0) {
  const c = M.novoConteudo({ titulo: 'FIXTURE facebook', origem: { tipo: 'texto' } });
  c.fonte_principal = { url: 'https://exemplo.test/m', titulo: 't', origem: 'Exemplo', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79 segundo o Banco Central.' };
  c.claims = [{ id: 'a1', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79.', tipo: 'fato', natureza: 'dado', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [{ valor: 64.79, unidade: 'BRL' }], revisao: {} }];
  c.evidencias = [{ id: 'e1', tipo: 'primaria', autoridade: 'primaria', correspondencia: 'integral', trecho: 'Salário mínimo jul/1994: 64,79', origem: 'BCB', relacao: 'sustenta', titulo: 'x', consultada_em: '2026-10-17T10:00:00Z' }];
  const slides = [{ id: 's1', layout: 'capa_tipografica', funcao: 'capa', texto: 'Em julho de 1994 o salário mínimo era **R$ 64,79**.', claim_ids: ['a1'] },
    ...Array.from({ length: extras }, (_, i) => ({ id: `x${i}`, layout: 'explicacao', funcao: 'explicacao', texto: `Slide extra ${String.fromCharCode(97 + i)}.`, claim_ids: [] }))];
  M.criarVersao(c, { capa_escolhida: 'k1', capas: [{ id: 'k1', foco: 'acontecimento', texto: slides[0].texto, claim_ids: ['a1'] }], slides, legenda: 'O salário mínimo em 1994 era de R$ 64,79.', cta: 'Siga.', hashtags: [], legenda_claim_ids: ['a1'] });
  const v = M.versaoAtiva(c);
  c.arte.renders = v.slides.map((s) => ({ slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), metrics: { cabe: true }, elementos: [] }));
  M.aprovar(c, G.avaliar(c, { conta: M.ACCOUNT_PIN }));
  return c;
}

test.before(async () => {
  envAntes = { ...process.env };
  graph = graphFalsa(TOKEN, ACCOUNT);
  await new Promise((r) => graph.srv.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { META_GRAPH_BASE: `http://127.0.0.1:${graph.srv.address().port}`, META_PAGE_ACCESS_TOKEN: TOKEN, META_IG_USER_ID: ACCOUNT.ig_id, META_PAGE_ID: '777', PUBLISH_SECRET: 'segredo-fb-teste' });
  delete process.env.VERCEL;
  for (const k of Object.keys(require.cache)) if (/backend[\\/](lib[\\/](meta|publicador|publishers[\\/].*)|routes[\\/]publish)\.js$/.test(k)) delete require.cache[k];
  PUB = require('./publishers');
});
test.after(() => { graph.srv.close(); for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });
async function monta(c) {
  arm = Object.assign(A.memoria(), { duravel: true }); A._definir(arm);
  await arm.conteudos.salvar(ACCOUNT.ig_id, c.id, c, 0);
  await arm.arquivos.salvar(ACCOUNT.ig_id, 'upload:encerramento', await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#0A1B33' } }).png().toBuffer(), 'image/png');
  graph.est.fotos = []; graph.est.feeds = []; graph.est.fbFalha = null;
}

test('Facebook vem DESLIGADO por padrão e não faz nenhuma chamada', async () => {
  conteudo = aprovado(); await monta(conteudo);
  assert.strictEqual(await PUB.facebook.canPublish(conteudo.id), false);
  await assert.rejects(() => PUB.facebook.publish(conteudo.id, { hash: conteudo.revisao.hash_aprovado, base: 'http://x' }), (e) => e.code === 'FACEBOOK_DESLIGADO');
  assert.strictEqual(graph.est.fotos.length, 0);
});

test('ligado: 1 imagem vai em /photos; várias imagens sobem sem publicar e saem juntas em /feed; repetir não duplica', async () => {
  const um = aprovado(); await monta(um);
  await arm.config.salvar(ACCOUNT.ig_id, { publishers: { facebook: true } });
  const r1 = await PUB.facebook.publish(um.id, { hash: um.revisao.hash_aprovado, base: 'http://127.0.0.1:1' });
  assert.strictEqual(r1.estado, 'publicada'); assert.match(r1.permalink, /facebook\.com\/777_photo_1/);
  assert.strictEqual(graph.est.fotos.length, 1);
  assert.match(graph.est.fotos[0].url, /\/api\/publico\/midia\/.+\.jpg$/); assert.match(graph.est.fotos[0].caption, /salário mínimo/);
  await PUB.facebook.publish(um.id, { hash: um.revisao.hash_aprovado, base: 'http://127.0.0.1:1' });
  assert.strictEqual(graph.est.fotos.length, 1, 'segunda chamada não publica de novo');

  const varios = aprovado(2); await monta(varios);
  await arm.config.salvar(ACCOUNT.ig_id, { publishers: { facebook: true } });
  const [a, b] = await Promise.all([PUB.facebook.publish(varios.id, { hash: varios.revisao.hash_aprovado, base: 'http://127.0.0.1:1' }), PUB.facebook.publish(varios.id, { hash: varios.revisao.hash_aprovado, base: 'http://127.0.0.1:1' })]);
  assert.ok(a && b);
  assert.strictEqual(graph.est.fotos.length, 3); assert.ok(graph.est.fotos.every((f) => f.published === 'false'));
  assert.strictEqual(graph.est.feeds.length, 1, 'um único post, mesmo com duas chamadas simultâneas');
  assert.strictEqual(JSON.parse(graph.est.feeds[0].attached_media).length, 3);
});

test('mesmas regras de aprovação e pausa; erro da Meta vira mensagem e permite tentar de novo', async () => {
  const c = aprovado(); await monta(c);
  await arm.config.salvar(ACCOUNT.ig_id, { publishers: { facebook: true }, publish_paused: true });
  await assert.rejects(() => PUB.facebook.publish(c.id, { hash: c.revisao.hash_aprovado, base: 'http://x' }), (e) => e.code === 'PAUSADO');
  await arm.config.salvar(ACCOUNT.ig_id, { publish_paused: false });
  await assert.rejects(() => PUB.facebook.publish(c.id, { hash: 'outro', base: 'http://x' }), (e) => e.code === 'VERSAO_DIFERENTE');
  graph.est.fbFalha = { message: '(#200) Requires pages_manage_posts permission', code: 200 };
  const r = await PUB.facebook.publish(c.id, { hash: c.revisao.hash_aprovado, base: 'http://x' });
  assert.strictEqual(r.estado, 'erro'); assert.match(r.erro.amigavel, /permissão/);
  graph.est.fbFalha = null;
  assert.strictEqual((await PUB.facebook.publish(c.id, { hash: c.revisao.hash_aprovado, base: 'http://x' })).estado, 'publicada');
});

test('LinkedIn: só o esqueleto — não publica e diz que não está implementado', async () => {
  assert.strictEqual(await PUB.linkedin.canPublish('x'), false);
  await assert.rejects(() => PUB.linkedin.publish('x'), (e) => e.code === 'NAO_IMPLEMENTADO' && e.status === 501);
  assert.deepStrictEqual(Object.keys(PUB.PUBLICADORES).sort(), ['facebook', 'instagram', 'linkedin']);
});
