// Publicação no Instagram contra uma Graph API SIMULADA (nada vai para a Meta de verdade).
// node --test backend/lib/publicador.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const sharp = require('sharp');
const A = require('./armazem');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');
const { ACCOUNT } = require('./account');

const TOKEN_FALSO = 'TOKEN_FALSO_DE_TESTE_123';

const { graphFalsa: criarGraphFalsa } = require('./graphFalsa');

// ── Conteúdo aprovado (fixture identificada) ──────────────────────────────
function conteudoAprovado({ slidesExtras = 0, legenda } = {}) {
  const c = M.novoConteudo({ titulo: 'FIXTURE publicação', origem: { tipo: 'link', url: 'https://exemplo.test/m' } });
  c.fonte_principal = { url: 'https://exemplo.test/m', titulo: 'Salário mínimo em 1994', origem: 'Exemplo', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79 segundo o Banco Central.' };
  c.claims = [{ id: 'a1', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79.', tipo: 'fato', natureza: 'dado', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [{ valor: 64.79, unidade: 'BRL' }], revisao: {} }];
  c.evidencias = [{ id: 'e1', tipo: 'primaria', autoridade: 'primaria', correspondencia: 'integral', trecho: 'Salário mínimo jul/1994: 64,79', origem: 'BCB SGS 1619', relacao: 'sustenta', titulo: 'x', consultada_em: '2026-10-17T10:00:00Z' }];
  const slides = [
    { id: 's1', layout: 'capa_tipografica', funcao: 'capa', texto: 'Em julho de 1994 o salário mínimo era **R$ 64,79**.', claim_ids: ['a1'] },
    { id: 's2', layout: 'prova', funcao: 'prova', texto: 'O valor vem do **Banco Central**.', fonte_linha: 'Fonte: BCB SGS 1619 · consultada em 17/10/2026', claim_ids: ['a1'] },
    ...Array.from({ length: slidesExtras }, (_, i) => ({ id: `x${i}`, layout: 'explicacao', funcao: 'explicacao', texto: `Slide extra ${String.fromCharCode(97 + i)}.`, claim_ids: [] })),
  ];
  M.criarVersao(c, { estrutura: 'antes_depois', capa_escolhida: 'k1', capas: [{ id: 'k1', foco: 'acontecimento', texto: slides[0].texto, claim_ids: ['a1'] }], slides, legenda: legenda ?? 'O salário mínimo em julho de 1994 era de R$ 64,79. Fonte: Banco Central.', cta: 'Siga para mais.', hashtags: ['#economia'], legenda_claim_ids: ['a1'] }, { quem: 'ia', rotulo: 'v' });
  const v = M.versaoAtiva(c);
  c.arte.renders = v.slides.map((s) => ({ slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), metrics: { cabe: true }, elementos: [] }));
  c.auditoria_textos = {};
  M.aprovar(c, G.avaliar(c, { conta: M.ACCOUNT_PIN }));
  return c;
}

let graph; let arm; let appPublica; let basePublica; let P; let envAntes;
async function monta({ conteudo = conteudoAprovado(), encerramento = false } = {}) {
  arm = Object.assign(A.memoria(), { duravel: true });
  A._definir(arm);
  await arm.conteudos.salvar(ACCOUNT.ig_id, conteudo.id, conteudo, 0);
  if (encerramento) await arm.arquivos.salvar(ACCOUNT.ig_id, 'upload:encerramento', await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#0A1B33' } }).png().toBuffer(), 'image/png');
  return conteudo;
}

test.before(async () => {
  envAntes = { ...process.env };
  graph = criarGraphFalsa(TOKEN_FALSO, ACCOUNT);
  await new Promise((r) => graph.srv.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { META_GRAPH_BASE: `http://127.0.0.1:${graph.srv.address().port}`, META_PAGE_ACCESS_TOKEN: TOKEN_FALSO, META_IG_USER_ID: ACCOUNT.meta_ig_id, META_PAGE_ID: '123', PUBLISH_SECRET: 'segredo-de-teste-publicacao', META_APP_ID: '1', META_APP_SECRET: 'segredo-app-teste' });
  delete process.env.VERCEL;
  for (const k of Object.keys(require.cache)) if (/backend[\\/](lib[\\/](meta|publicador)|routes[\\/]publish)\.js$/.test(k)) delete require.cache[k];
  P = require('./publicador');
  const app = express();
  app.use('/api/publico', require('../routes/publish').publico);
  await new Promise((r) => { appPublica = app.listen(0, '127.0.0.1', r); });
  basePublica = `http://127.0.0.1:${appPublica.address().port}`;
});
test.after(() => { graph.srv.close(); appPublica.close(); for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });
const zera = () => { graph.est.chamadas.length = 0; graph.est.containers = {}; graph.est.publicados = []; graph.est.midias = []; graph.est.statusSeq = ['IN_PROGRESS', 'FINISHED']; graph.est.publishFalha = null; graph.est.tokenInvalido = false; graph.est.username = 'pedro_destrava'; graph.est.id = ACCOUNT.meta_ig_id; graph.est.quota = { usado: 2, total: 100 }; };
const chamou = (re) => graph.est.chamadas.filter((c) => re.test(`${c.metodo} ${c.caminho}`));

test('carrossel: cria filhos e pai, espera o processamento e só então publica uma vez; a Meta consegue baixar JPEG 1080×1350', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado({ slidesExtras: 1 }), encerramento: true });
  const r1 = await P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica });
  assert.strictEqual(r1.estado, 'aguardando_processamento');
  assert.strictEqual(r1.tipo, 'CAROUSEL');
  const filhos = chamou(/POST .*\/media$/).filter((x) => x.params.is_carousel_item === 'true');
  const pai = chamou(/POST .*\/media$/).find((x) => x.params.media_type === 'CAROUSEL');
  assert.strictEqual(filhos.length, 3);
  assert.strictEqual(pai.params.children.split(',').length, 3);
  assert.match(pai.params.caption, /Banco Central/);
  assert.ok(!chamou(/media_publish/).length, 'ainda não publicou');
  // segredos: token em todas as chamadas, nunca na legenda; appsecret_proof presente
  assert.ok(graph.est.chamadas.every((x) => x.params.access_token === TOKEN_FALSO || x.caminho === 'debug_token'));
  assert.ok(chamou(/POST/).every((x) => x.params.appsecret_proof && !JSON.stringify(x.params).includes('segredo-app-teste')));
  // a Meta baixa cada URL: precisa ser JPEG 1080×1350
  for (const f of filhos) {
    const resp = await fetch(f.params.image_url);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.headers.get('content-type'), 'image/jpeg');
    const meta = await sharp(Buffer.from(await resp.arrayBuffer())).metadata();
    assert.deepStrictEqual([meta.format, meta.width, meta.height], ['jpeg', 1080, 1350]);
  }
  const s1 = await P.avancar(c.id);
  assert.strictEqual(s1.estado, 'aguardando_processamento', 'IN_PROGRESS: ainda não publica');
  const s2 = await P.avancar(c.id);
  assert.strictEqual(s2.estado, 'publicada');
  assert.strictEqual(s2.ig_media_id, 'media_1');
  assert.match(s2.permalink, /instagram\.com\/p\//);
  assert.strictEqual(chamou(/media_publish/).length, 1);
  const s3 = await P.avancar(c.id);
  assert.strictEqual(s3.estado, 'publicada');
  assert.strictEqual(chamou(/media_publish/).length, 1, 'consultar de novo não republica');
});

test('imagem única (1 slide): um container com image_url e legenda', async () => {
  zera();
  const c0 = conteudoAprovado();
  // um slide só
  const unico = M.novoConteudo({ titulo: 'FIXTURE único', origem: { tipo: 'texto' } });
  Object.assign(unico, { fonte_principal: c0.fonte_principal, claims: c0.claims, evidencias: c0.evidencias });
  const s = M.versaoAtiva(c0).slides[0];
  M.criarVersao(unico, { capa_escolhida: 'k1', capas: [{ id: 'k1', foco: 'acontecimento', texto: s.texto, claim_ids: ['a1'] }], slides: [{ ...s }], legenda: 'O salário mínimo era de R$ 64,79 em 1994.', cta: '', hashtags: [], legenda_claim_ids: ['a1'] });
  const v = M.versaoAtiva(unico);
  unico.arte.renders = [{ slide_id: v.slides[0].id, versao: v.id, texto_hash: M.hashRender(v.slides[0]), metrics: { cabe: true }, elementos: [] }];
  M.aprovar(unico, G.avaliar(unico, { conta: M.ACCOUNT_PIN }));
  await monta({ conteudo: unico });
  const r = await P.iniciar(unico.id, { hash: unico.revisao.hash_aprovado, base: basePublica });
  assert.strictEqual(r.tipo, 'IMAGE');
  assert.strictEqual(chamou(/POST .*\/media$/).length, 1);
  assert.ok(chamou(/POST .*\/media$/)[0].params.image_url.endsWith('.jpg'));
});

test('duplo toque: duas chamadas simultâneas criam UM container e publicam UM post', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  const [a, b] = await Promise.all([P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica })]);
  assert.ok(a && b);
  assert.strictEqual(chamou(/POST .*\/media$/).filter((x) => x.params.media_type === 'CAROUSEL' || x.params.image_url && !x.params.is_carousel_item).length, 1, 'um container pai');
  graph.est.statusSeq = ['FINISHED'];
  await Promise.all([P.avancar(c.id), P.avancar(c.id), P.avancar(c.id)]);
  assert.strictEqual(chamou(/media_publish/).length, 1, 'três consultas simultâneas, um media_publish');
  assert.strictEqual(graph.est.publicados.length, 1);
});

test('só publica a versão aprovada: não aprovado, hash diferente, edição depois da aprovação, bloqueio de revisão', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  await assert.rejects(() => P.iniciar(c.id, { hash: 'hash-de-outra-versao', base: basePublica }), (e) => e.code === 'VERSAO_DIFERENTE');
  // edita depois de aprovar → aprovação cai
  const editado = JSON.parse(JSON.stringify(c)); M.editarSlide(editado, 's2', { texto: 'O valor vem do **Banco Central do Brasil**.' });
  await monta({ conteudo: editado, encerramento: true });
  await assert.rejects(() => P.iniciar(c.id, { base: basePublica }), (e) => e.code === 'NAO_APROVADO');
  // afirmação central vira "contradita" depois da aprovação no servidor
  const c2 = conteudoAprovado(); c2.claims[0].estado = 'contradita';
  await monta({ conteudo: c2, encerramento: true });
  await assert.rejects(() => P.iniciar(c2.id, { hash: c2.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'BLOQUEIOS');
  assert.strictEqual(chamou(/POST/).length, 0, 'nada foi enviado à Meta em nenhum desses casos');
});

test('pausar publicações, limite diário e cota da Meta barram antes de enviar', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  await arm.config.salvar(ACCOUNT.ig_id, { publish_paused: true });
  await assert.rejects(() => P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'PAUSADO');
  await arm.config.salvar(ACCOUNT.ig_id, { publish_paused: false, daily_publish_cap: 1 });
  await arm.publicacoes.iniciar(ACCOUNT.ig_id, 'outro_conteudo', 'instagram', {});
  await assert.rejects(() => P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'LIMITE_DIARIO' && /1\/1/.test(e.message));
  await arm.config.salvar(ACCOUNT.ig_id, { daily_publish_cap: 10 });
  graph.est.quota = { usado: 100, total: 100 };
  await assert.rejects(() => P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'COTA_META');
  assert.strictEqual(chamou(/POST .*\/media/).length, 0);
});

test('conta errada: token que aponta para outro perfil não publica nada', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  graph.est.username = 'pedrodestrava'; graph.est.id = '999';
  await assert.rejects(() => P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'CONTA_ERRADA' && /pedrodestrava/.test(e.message));
  assert.strictEqual(chamou(/POST/).length, 0);
  const s = await P.saude();
  assert.strictEqual(s.conta.ok, false);
});

test('Graph API usa ID próprio sem trocar a identidade dos dados salvos', async () => {
  zera();
  const c = await monta();
  const s = await P.saude();
  assert.strictEqual(s.conta.ok, true);
  assert.strictEqual(s.conta.id, ACCOUNT.meta_ig_id);
  assert.notStrictEqual(ACCOUNT.meta_ig_id, ACCOUNT.ig_id);
  assert.strictEqual(c.conta.ig_id, ACCOUNT.ig_id);
  graph.est.id = ACCOUNT.ig_id;
  await assert.rejects(() => P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'CONTA_ERRADA');
  assert.strictEqual(chamou(/POST/).length, 0, 'mesmo username não autoriza um ID diferente');
});

test('ID interno configurado como ID Graph bloqueia antes de criar mídia', async () => {
  zera();
  const c = await monta();
  const anterior = process.env.META_IG_USER_ID;
  try {
    process.env.META_IG_USER_ID = ACCOUNT.ig_id;
    await assert.rejects(() => P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'CONTA_ERRADA');
    assert.strictEqual(graph.est.chamadas.length, 0);
  } finally { process.env.META_IG_USER_ID = anterior; }
});

test('token inválido (190): item não vira erro definitivo e a saúde pede para reconectar', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  await P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica });
  graph.est.tokenInvalido = true;
  const r = await P.avancar(c.id);
  assert.strictEqual(r.estado, 'aguardando_processamento', 'o container continua valendo por 24 h');
  assert.strictEqual(r.reconectar, true);
  assert.match(r.aviso_temporario, /Reconecte/);
  const s = await P.saude();
  assert.strictEqual(s.reconectar, true);
  graph.est.tokenInvalido = false; graph.est.statusSeq = ['FINISHED'];
  assert.strictEqual((await P.avancar(c.id)).estado, 'publicada', 'depois de reconectar, a mesma publicação segue');
  assert.strictEqual(chamou(/media_publish/).length, 1);
});

test('resposta do media_publish perdida: reconcilia pelo post recente e NÃO publica de novo', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  await P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica });
  graph.est.statusSeq = ['FINISHED'];
  graph.est.publishDeixaCair = true;       // a Meta publica, mas a conexão cai antes da resposta
  const r = await P.avancar(c.id);
  assert.strictEqual(r.estado, 'publicando_final');
  // envelhece o estado para além do prazo de reconciliação
  const p = await arm.publicacoes.obter(ACCOUNT.ig_id, c.id, 'instagram');
  p.atualizada_em = new Date(Date.now() - 120000).toISOString();
  arm.publicacoes.atualizar = ((orig) => async (...a) => orig(...a))(arm.publicacoes.atualizar);
  const mem = (await arm.publicacoes.listar(ACCOUNT.ig_id)).length; assert.ok(mem >= 1);
  // força a idade pelo próprio armazenamento
  await arm.publicacoes.atualizar(ACCOUNT.ig_id, c.id, 'instagram', ['publicando_final'], 'publicando_final', {});
  const interno = (await arm.publicacoes.listar(ACCOUNT.ig_id)).find((x) => x.content_id === c.id);
  assert.ok(interno);
  // acesso à estrutura em memória não é exposto: simula passagem de tempo trocando Date.now
  const agora = Date.now; Date.now = () => agora() + 120000;
  try {
    const r2 = await P.avancar(c.id);
    assert.strictEqual(r2.estado, 'publicada', JSON.stringify(r2));
    assert.strictEqual(r2.ig_media_id, 'media_1');
    assert.strictEqual(graph.est.publicados.length, 1, 'a Meta recebeu um único media_publish');
  } finally { Date.now = agora; }
});

test('erros da Meta viram mensagem em português com o original guardado; "tentar de novo" recria o container', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  await P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica });
  graph.est.statusSeq = ['ERROR'];
  const r = await P.avancar(c.id);
  assert.strictEqual(r.estado, 'erro');
  assert.match(r.erro.amigavel, /não conseguiu processar/);
  graph.est.statusSeq = ['FINISHED'];
  const de_novo = await P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica });
  assert.strictEqual(de_novo.estado, 'aguardando_processamento');
  assert.strictEqual((await P.avancar(c.id)).estado, 'publicada');
  const { interpretarErro } = require('./meta');
  const e = interpretarErro({ response: { status: 400, data: { error: { code: 100, error_subcode: 2207026, message: 'Unsupported format access_token=EAAB123abc' } } } });
  assert.strictEqual(e.tipo, 'midia');
  assert.ok(!/EAAB123abc/.test(e.mensagem_original), 'token não vaza na mensagem');
});

test('legenda acima de 2.200 caracteres, hashtags demais e @ errado bloqueiam (nada é cortado em silêncio)', async () => {
  zera();
  const longa = conteudoAprovado({ legenda: `O salário mínimo em julho de 1994 era de R$ 64,79. ${'texto '.repeat(400)}` });
  await monta({ conteudo: longa, encerramento: true });
  await assert.rejects(() => P.iniciar(longa.id, { hash: longa.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'LEGENDA_LONGA');
  assert.throws(() => P.conferirLegenda(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')), (e) => e.code === 'HASHTAGS_DEMAIS');
  assert.throws(() => P.conferirLegenda('Siga @pedrodestrava hoje'), (e) => e.code === 'HANDLE_ERRADO');
  assert.strictEqual(chamou(/POST/).length, 0);
});

test('carrossel com mais de 20 slides: corta nos 20 primeiros e AVISA', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado({ slidesExtras: 22 }), encerramento: true });
  const r = await P.iniciar(c.id, { hash: c.revisao.hash_aprovado, base: basePublica });
  assert.strictEqual(chamou(/POST .*\/media$/).filter((x) => x.params.is_carousel_item === 'true').length, 20);
  assert.ok(r.avisos.some((a) => /20/.test(a)));
});

test('encerramento provisório e foto ausente impedem publicar, a não ser que o Pedro permita', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: false });
  const semEnc = conteudoAprovado();
  // adiciona um slide de encerramento aprovado
  M.editarSlide(semEnc, 's2', {}); // nova versão
  const v = M.versaoAtiva(semEnc);
  const dados = JSON.parse(JSON.stringify(v)); dados.slides.push({ id: 'enc', layout: 'encerramento', funcao: 'encerramento', texto: 'Siga para mais.', claim_ids: [] });
  M.criarVersao(semEnc, dados);
  const v2 = M.versaoAtiva(semEnc);
  semEnc.arte.renders = v2.slides.map((s) => ({ slide_id: s.id, versao: v2.id, texto_hash: M.hashRender(s), metrics: { cabe: true }, elementos: [] }));
  M.aprovar(semEnc, G.avaliar(semEnc, { conta: M.ACCOUNT_PIN }));
  await monta({ conteudo: semEnc, encerramento: false });
  await assert.rejects(() => P.iniciar(semEnc.id, { hash: semEnc.revisao.hash_aprovado, base: basePublica }), (e) => e.code === 'ENCERRAMENTO_PROVISORIO');
  await arm.config.salvar(ACCOUNT.ig_id, { permitir_encerramento_provisorio: true });
  const r = await P.iniciar(semEnc.id, { hash: semEnc.revisao.hash_aprovado, base: basePublica });
  assert.strictEqual(r.estado, 'aguardando_processamento');
  void c;
});

test('encerramento do carrossel top (tema reportagem) publica sem a arte original: é o slide desenhado que o Pedro aprovou', async () => {
  zera();
  const rep = conteudoAprovado();
  M.editarSlide(rep, 's2', {});
  const dados = JSON.parse(JSON.stringify(M.versaoAtiva(rep))); dados.slides.push({ id: 'enc', layout: 'encerramento', funcao: 'encerramento', tema_visual: 'reportagem', titulo: 'O resultado está nos números.', texto: 'Siga para mais.', claim_ids: [] });
  M.criarVersao(rep, dados);
  const v = M.versaoAtiva(rep);
  rep.arte.renders = v.slides.map((s) => ({ slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), metrics: { cabe: true }, elementos: [] }));
  M.aprovar(rep, G.avaliar(rep, { conta: M.ACCOUNT_PIN }));
  await monta({ conteudo: rep, encerramento: false });
  const r = await P.iniciar(rep.id, { hash: rep.revisao.hash_aprovado, base: basePublica });
  assert.strictEqual(r.estado, 'aguardando_processamento');
});

test('mídia pública: token adulterado, vencido, de outra versão ou sem PUBLISH_SECRET → recusado', async () => {
  zera();
  const c = await monta({ conteudo: conteudoAprovado(), encerramento: true });
  const meta = require('./meta');
  const ok = meta.assinarMidia({ conteudo: c.id, hash: c.revisao.hash_aprovado, indice: 0 });
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${ok}.jpg`)).status, 200);
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${ok.slice(0, -3)}abc.jpg`)).status, 403, 'adulterado');
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${meta.assinarMidia({ conteudo: c.id, hash: c.revisao.hash_aprovado, indice: 0, ttlS: -10 })}.jpg`)).status, 403, 'vencido');
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${meta.assinarMidia({ conteudo: c.id, hash: 'outro-hash', indice: 0 })}.jpg`)).status, 409, 'versão diferente da aprovada');
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${meta.assinarMidia({ conteudo: 'outro', hash: c.revisao.hash_aprovado, indice: 0 })}.jpg`)).status, 404);
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${meta.assinarMidia({ conteudo: c.id, hash: c.revisao.hash_aprovado, indice: 99 })}.jpg`)).status, 404);
  const segredo = process.env.PUBLISH_SECRET; delete process.env.PUBLISH_SECRET;
  assert.strictEqual((await fetch(`${basePublica}/api/publico/midia/${ok}.jpg`)).status, 403, 'sem segredo no servidor nada é entregue');
  process.env.PUBLISH_SECRET = segredo;
});

test('saúde: token, validade, cota e conta; sem configuração diz o que falta', async () => {
  zera();
  await monta({});
  const s = await P.saude();
  assert.strictEqual(s.configurado, true);
  assert.strictEqual(s.conta.ok, true); assert.strictEqual(s.conta.username, 'pedro_destrava');
  assert.strictEqual(s.token.valido, true); assert.match(s.token.expira_em, /^20\d\d-/);
  assert.deepStrictEqual([s.cota.usado, s.cota.total], [2, 100]);
  assert.ok(!JSON.stringify(s).includes(TOKEN_FALSO) && !JSON.stringify(s).includes('segredo-app-teste'), 'nenhum segredo na resposta');
  const t = process.env.META_PAGE_ACCESS_TOKEN; delete process.env.META_PAGE_ACCESS_TOKEN;
  const vazio = await P.saude();
  assert.strictEqual(vazio.configurado, false); assert.deepStrictEqual(vazio.faltando, ['META_PAGE_ACCESS_TOKEN']);
  process.env.META_PAGE_ACCESS_TOKEN = t;
});

test('sem banco de dados no servidor não publica (a cópia só no navegador não basta)', async () => {
  A._definir(A.memoria());
  await assert.rejects(() => P.iniciar('qualquer', { base: basePublica }), (e) => e.code === 'SEM_ARMAZEM');
});

test('Reel aprovado cria vídeo REELS e uma única publicação; prévia de sandbox não publica', async () => {
  zera();
  const c=conteudoAprovado();c.formato='reels';c.motion={estado:'pronto',hash:M.versaoAtiva(c).hash,url:'https://exemplo.test/reel-fixture.mp4',sandbox:false};
  await monta({conteudo:c});
  const p=await P.iniciar(c.id,{hash:c.revisao.hash_aprovado,base:basePublica});assert.strictEqual(p.tipo,'REELS');
  const pedidos=chamou(/POST .*\/media$/);assert.strictEqual(pedidos.length,1);assert.strictEqual(pedidos[0].params.media_type,'REELS');assert.strictEqual(pedidos[0].params.video_url,c.motion.url);
  await P.avancar(c.id);await P.avancar(c.id);await P.avancar(c.id);assert.strictEqual(graph.est.publicados.length,1);
  c.id+='sandbox';c.motion.sandbox=true;await monta({conteudo:c});await assert.rejects(P.iniciar(c.id,{base:basePublica}),(e)=>e.code==='VIDEO_TESTE');
});
