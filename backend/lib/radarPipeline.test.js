// Radar de Negócios: pipeline diário completo (cron, pesquisa manual, retomada, falhas) com fontes e IA simuladas.
// node --test backend/lib/radarPipeline.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const sharp = require('sharp');
const A = require('./armazem');
const F = require('./radarFixtures');
const P = require('./radar/pipeline');
const store = require('./radar/store');
const Pacote = require('./radar/pacote');
const Aprend = require('./radar/aprendizado');
const C = require('./radar/config');

const novoBanco = () => A._definir(Object.assign(A.memoria(), { duravel: true }));
const mkDeps = (extra = {}) => { const __push = extra.__push || []; return { fetcher: F.fakeFetcher(), lerFonte: F.fakeLerFonte, pedirJson: F.fakePedirJson(), loja: false, semEspera: true, notificar: async (o) => { __push.push(o); return { enviadas: 1 }; }, ...extra, __push }; };
async function rodar(origem = 'manual', extra = {}) {
  const deps = mkDeps(extra); const { run } = await P.iniciar({ origem, deps });
  return { deps, run, r: await P.executarTudo(run.id, { deps }) };
}

test('pesquisa manual: executa o pipeline inteiro, acha 5 pautas, gera o carrossel do primeiro lugar e avisa no PWA', async () => {
  novoBanco();
  const push = []; const { r } = await rodar('manual', { __push: push });
  assert.ok(['concluida', 'concluida_com_avisos'].includes(r.run.estado), r.run.estado);
  const res = r.run.resultado;
  assert.strictEqual(res.top5.length, 5);
  assert.strictEqual(res.top5[0].nome, 'Lumen Pets'); assert.ok(res.top5[0].pontuacao >= 75);
  assert.ok(res.carrossel_id && res.carrossel_estado === 'aguardando_aprovacao', 'o carrossel vai para a fila de aprovação');
  assert.strictEqual(push.length, 1); assert.strictEqual(push[0].corpo, 'Uma nova ideia de negócio está pronta para você.'); assert.strictEqual(push[0].url, '/?tab=radar');
  const c = r.run.contadores; assert.ok(c.fontes_consultadas >= 5 && c.candidatos_encontrados >= 10 && c.verificados > 0 && c.pautas === 5);
  const ops = await store.listar('oportunidade');
  const status = Object.fromEntries(ops.map((o) => [o.nome, o.status]));
  assert.strictEqual(status['Lumen Pets'], 'carrossel_gerado');
  assert.strictEqual(status.VelhoNegocio, 'descartada'); assert.strictEqual(status.PiramideX, 'descartada');
  assert.ok(ops.filter((o) => o.status === 'pauta').length >= 3, 'as outras quatro viram pautas sugeridas');
  assert.match(ops.find((o) => o.nome === 'VelhoNegocio').descartada_motivo, /antiga|2009/i);
  assert.ok(ops.every((o) => o.status !== 'publicada'), 'nada publicado');
});

test('ZIP completo no padrão novo: 7 PNG 1080×1350 na ordem, legenda, fontes e créditos, objeto estruturado', async () => {
  novoBanco(); const { r } = await rodar();
  const c = (await store.obter('carrossel', r.run.resultado.carrossel_id)).doc;
  assert.strictEqual(c.template, 'pedro_minimalista_estrategico_v1', 'a pesquisa diária gera no padrão novo');
  assert.strictEqual(c.estado, 'aguardando_aprovacao', JSON.stringify(c.validacao?.bloqueios)); assert.strictEqual(c.render.length, 7);
  const zip = await require('./radar/carrossel2').exportar(c.id); const itens = Pacote.lerZip(zip.zip); const nomes = itens.map((i) => i.nome);
  assert.deepStrictEqual(nomes.slice(0, 7), [1, 2, 3, 4, 5, 6, 7].map((i) => `slide-0${i}.png`), 'PNGs numerados na ordem de postagem');
  for (const n of ['legenda.txt', 'fontes-e-creditos.md', 'carrossel.json', 'ficha-de-fontes.json', 'LEIA-ME.txt']) assert.ok(nomes.includes(n), n);
  for (const it of itens.filter((x) => x.nome.endsWith('.png'))) { const m = await sharp(it.dados).metadata(); assert.deepStrictEqual([m.width, m.height, m.format], [1080, 1350, 'png']); }
  assert.ok(itens.find((x) => x.nome === 'legenda.txt').dados.toString().length <= 900);
  const obj = JSON.parse(itens.find((x) => x.nome === 'carrossel.json').dados.toString());
  assert.strictEqual(obj.template, 'pedro_minimalista_estrategico_v1'); assert.ok(obj.briefing && obj.ganchos.length === 3 && obj.telas.length === 7);
  obj.imagens.forEach((i) => assert.ok(i.origem && (i.origem.url_imagem || i.origem.declaracao) && i.licenca && i.permissao, 'toda imagem registra origem, licença e permissão'));
  obj.telas.forEach((t, i) => assert.strictEqual(t.png.sha256, c.render[i].sha256, 'o objeto aponta para o PNG exportado'));
  assert.ok(c.versoes.length >= 1 && c.copia.slides.length === 7 && c.serie === 'negocios');
  assert.ok(itens.find((x) => x.nome === 'fontes-e-creditos.md').dados.toString().includes('segundo a empresa'));
});

test('cron diário: uma execução por dia (a segunda chamada devolve a mesma), e respeita o interruptor', async () => {
  novoBanco(); const deps = mkDeps();
  const a = await P.iniciar({ origem: 'cron', deps }); const b = await P.iniciar({ origem: 'cron', deps });
  assert.strictEqual(a.run.id, b.run.id); assert.strictEqual(a.existente, false); assert.strictEqual(b.existente, true);
  assert.match(a.run.id, /^rd_\d{8}_cron$/);
  await store.salvarConfig({ ativo: false });
  const dia2 = await P.iniciar({ origem: 'cron', deps: { ...deps, agora: () => Date.now() + 86400000 * 2 } });
  assert.strictEqual(dia2.ignorada, true);
});

test('limites da pesquisa manual: reaproveita a em andamento e trava depois do limite diário', async () => {
  novoBanco(); const deps = mkDeps();
  const a = await P.iniciar({ origem: 'manual', deps }); const b = await P.iniciar({ origem: 'manual', deps });
  assert.strictEqual(a.run.id, b.run.id, 'não abre duas pesquisas ao mesmo tempo');
  await store.salvarConfig({ max_manuais_dia: 1 }); await P.executarTudo(a.run.id, { deps });
  await assert.rejects(() => P.iniciar({ origem: 'manual', deps }), (e) => e.code === 'LIMITE_DIARIO' && e.status === 429);
});

test('repetição de pauta: a segunda pesquisa não sugere de novo o que já foi sugerido ou usado', async () => {
  novoBanco(); const { r: r1 } = await rodar();
  assert.strictEqual(r1.run.resultado.top5[0].nome, 'Lumen Pets');
  const { r: r2 } = await rodar();
  assert.ok(!r2.run.resultado.top5.some((t) => t.nome === 'Lumen Pets'), 'Lumen Pets já virou carrossel');
  assert.ok(r2.run.contadores.ja_usados_removidos >= 5, `removidos: ${r2.run.contadores.ja_usados_removidos}`);
  assert.ok(!r2.run.resultado.top5.some((t) => r1.run.resultado.top5.some((u) => u.nome === t.nome && u.nome !== undefined)), 'nenhuma pauta repetida');
  assert.ok(r2.run.resultado.barrados.some((b) => /já/.test(b.motivo)));
  assert.strictEqual(r2.run.resultado.carrossel_id, undefined);
  assert.match(r2.run.resultado.sem_carrossel_motivo, /75|passou/);
});

test('retomada após interrupção: o processo "morre" (a gravação falha) em pontos diferentes e cada nova chamada continua dali, sem repetir', async () => {
  novoBanco(); const deps = mkDeps(); const { run } = await P.iniciar({ origem: 'manual', deps });
  const arm = A.armazem(); const original = arm.radar.salvar; const etapasVistas = [];
  for (const limite of [3, 6, 10, 16, 25, 40, 60, 90, 130]) {
    let n = 0; arm.radar.salvar = async (...a) => { n += 1; if (n > limite) throw new Error('o processo foi encerrado'); return original(...a); };
    const r = await P.avancar(run.id, { deps }); arm.radar.salvar = original;
    etapasVistas.push((await store.obter('execucao', run.id)).doc.etapa);
    await store.atualizar('execucao', run.id, (x) => { x.lease_ate = null; return x; });   // passou o tempo da trava do processo morto
    if (r.concluida) break;
  }
  const r = await P.executarTudo(run.id, { deps }); assert.ok(r.concluida, r.run.estado);
  assert.ok(etapasVistas.length >= 3 && new Set(etapasVistas).size >= 2, `interrompido em: ${etapasVistas.join(' > ')}`);
  assert.ok(r.run.resultado.carrossel_id);
  const gerados = (await store.listar('carrossel')).filter((c) => c.op_id === r.run.resultado.top5[0].id); assert.strictEqual(gerados.length, 1, 'o carrossel não é gerado duas vezes');
  assert.strictEqual(deps.__push.length, 1, 'e o aviso sai uma vez só');
  const ops = await store.listar('oportunidade'); assert.strictEqual(new Set(ops.map((o) => o.nome)).size, ops.length, 'nenhum negócio ficou duplicado');
});
test('IA instável no meio: erro temporário espera e retoma do mesmo ponto', async () => {
  novoBanco(); const deps = mkDeps(); const { run } = await P.iniciar({ origem: 'manual', deps });
  const llm = F.fakePedirJson(); let falhou = false;
  const depsInstavel = { ...deps, pedirJson: async (o) => { if (/Você avalia ideias/.test(o.sistema) && !falhou) { falhou = true; throw Object.assign(new Error('rate limit'), { status: 429 }); } return llm(o); } };
  const r1 = await P.avancar(run.id, { deps: { ...depsInstavel, semEspera: false } });
  assert.strictEqual(r1.concluida, false); assert.ok(r1.esperar_s > 0, 'pede para esperar antes de tentar de novo'); assert.strictEqual(r1.run.etapa, 'avaliar');
  const r2 = await P.executarTudo(run.id, { deps: depsInstavel }); assert.ok(r2.concluida && r2.run.resultado.carrossel_id);
  assert.ok(r2.run.erros.some((e) => e.etapa === 'avaliar'), 'a falha fica registrada');
});

test('lease expirada: outro processo assume uma execução abandonada', async () => {
  novoBanco(); const deps = mkDeps(); const { run } = await P.iniciar({ origem: 'manual', deps });
  const reg = await store.obter('execucao', run.id); reg.doc.lease_ate = new Date(Date.now() + 60000).toISOString();
  await store.salvar('execucao', run.id, reg.doc, reg.rev);
  const ocupada = await P.avancar(run.id, { deps }); assert.strictEqual(ocupada.ocupado, true);
  const reg2 = await store.obter('execucao', run.id); reg2.doc.lease_ate = new Date(Date.now() - 1000).toISOString(); reg2.doc.atualizado_em = new Date(Date.now() - 120000).toISOString();
  await store.salvar('execucao', run.id, reg2.doc, reg2.rev);
  assert.strictEqual((await P.pendentes()).length, 1, 'execução parada é encontrada para retomar');
  const r = await P.executarTudo(run.id, { deps }); assert.ok(r.concluida);
});

test('erro da IA: sem chave a execução para com mensagem clara; IA instável não derruba a pesquisa', async () => {
  novoBanco();
  const sem = await rodar('manual', { pedirJson: async () => { throw Object.assign(new Error('Nenhuma IA'), { code: 'SEM_IA' }); } });
  assert.strictEqual(sem.r.run.estado, 'erro'); assert.match(sem.r.run.erro_final.mensagem, /chave de IA/);
  novoBanco();
  const copiaRuim = await rodar('manual', { pedirJson: Object.assign(async (o) => (/Pedro Destrava — Minimalista/.test(o.sistema) ? { llm: {}, dados: { telas: [] } } : F.fakePedirJson()(o)), {}) });
  assert.ok(['concluida', 'concluida_com_avisos'].includes(copiaRuim.r.run.estado));
  assert.strictEqual(copiaRuim.r.run.resultado.carrossel_id, undefined); assert.ok(copiaRuim.r.run.resultado.carrossel_erro);
  assert.strictEqual(copiaRuim.r.run.resultado.top5.length, 5, 'as pautas continuam salvas');
  assert.match(copiaRuim.r.run.resultado.notificacao, /pautas|Radar/);
  assert.ok((await store.listar('carrossel')).every((c) => c.estado === 'erro'), 'carrossel com erro não entra na fila');
});

test('falha de banco: a chamada não explode, devolve o erro e a execução retoma quando o banco volta', async () => {
  novoBanco(); const deps = mkDeps(); const { run } = await P.iniciar({ origem: 'manual', deps });
  const arm = A.armazem(); const original = arm.radar.salvar; let falhas = 0;
  arm.radar.salvar = async (...a) => { if (a[1] === 'coleta' || a[1] === 'oportunidade') { falhas += 1; throw new Error('connection terminated'); } return original(...a); };
  const r1 = await P.avancar(run.id, { deps }); assert.ok(falhas > 0);
  assert.strictEqual(r1.concluida, false);
  arm.radar.salvar = original;
  const r2 = await P.executarTudo(run.id, { deps }); assert.ok(r2.concluida, r2.run.estado);
  assert.ok(r2.run.resultado.carrossel_id);
  novoBanco(); A._definir(null);
  await assert.rejects(() => P.iniciar({ origem: 'manual', deps }), (e) => e.code === 'SEM_BANCO' || /banco/i.test(e.message));
});

test('sem fontes respondendo: erro explícito depois das tentativas (nenhum dado inventado)', async () => {
  novoBanco(); const todas = { ...F.fakeFetcher() }; void todas;
  const { r } = await rodar('manual', { fetcher: async () => { throw Object.assign(new Error('rede fora'), { code: 'ENOTFOUND' }); } });
  assert.strictEqual(r.run.estado, 'erro'); assert.ok(r.run.erros.length >= 1); assert.strictEqual((await store.listar('oportunidade')).length, 0);
});

// ── Rotas HTTP ──────────────────────────────────────────────────────────────────────────
async function servidor() {
  novoBanco(); global.__RADAR_DEPS__ = mkDeps(); process.env.TESTE_RADAR = '1'; process.env.GROQ_API_KEY = 'falsa';
  delete require.cache[require.resolve('../routes/radar')];
  const app = express(); app.use(express.json()); app.use('/api/radar', require('../routes/radar'));
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/radar`;
  const req = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) }; };
  return { srv, req, fechar: () => { srv.close(); delete global.__RADAR_DEPS__; delete process.env.TESTE_RADAR; } };
}
test('API: cron roda o pipeline, estado mostra os números, oportunidades filtram, ZIP baixa, aprovar não publica', async () => {
  const s = await servidor();
  try {
    const cron = await s.req('GET', '/cron'); assert.strictEqual(cron.status, 200); assert.ok(cron.json.concluida, JSON.stringify(cron.json));
    const cron2 = await s.req('GET', '/cron'); assert.strictEqual(cron2.json.existente, true);
    const est = (await s.req('GET', '/estado')).json;
    assert.strictEqual(est.proxima_pesquisa.slice(11, 16), '10:00'); assert.strictEqual(est.agenda.horario_brasilia, '07:00'); assert.strictEqual(est.publicacao_automatica, false);
    assert.ok(est.metricas.fontes_consultadas > 0 && est.metricas.oportunidades_encontradas > 0 && est.metricas.aprovadas >= 1 && est.metricas.descartadas >= 1);
    assert.ok(est.ultima_pesquisa && est.fila_aprovacao === 1 && est.nova_ideia === true);
    assert.ok(est.fontes_configuradas.some((f) => f.nome === 'Indie Hackers' && !f.ativa && f.motivo_inativa));
    const lista = (await s.req('GET', '/oportunidades')).json.oportunidades; assert.ok(lista.length >= 5);
    const primeira = lista[0]; assert.strictEqual(primeira.nome, 'Lumen Pets');
    for (const campo of ['nome', 'pais', 'categoria', 'resumo', 'como_ganha_dinheiro', 'prova_demanda', 'investimento_para_testar', 'adaptacao_brasil', 'pontuacao', 'fontes', 'imagem', 'encontrada_em']) assert.ok(campo in primeira, campo);
    assert.strictEqual(primeira.prova_demanda.confirmada, true); assert.ok(primeira.fontes.length >= 2);
    const filtrada = (await s.req('GET', '/oportunidades?filtro=saas')).json.oportunidades; assert.ok(filtrada.every((o) => o.categoria === 'saas'));
    assert.ok((await s.req('GET', '/oportunidades?filtro=baixo_investimento')).json.oportunidades.every((o) => o.investimento_para_testar.nivel === 'baixo'));
    const img = await s.req('GET', `/oportunidades/${primeira.id}/imagem`); assert.strictEqual(img.status, 200); assert.ok(img.headers.get('content-type').startsWith('image/'));
    const cs = (await s.req('GET', '/carrosseis')).json.carrosseis; assert.strictEqual(cs.length, 1); const c = cs[0];
    assert.strictEqual(c.slides.length, 7); assert.strictEqual(c.estado, 'aguardando_aprovacao');
    const slide = await s.req('GET', `/carrosseis/${c.id}/slide/3`); assert.strictEqual(slide.status, 200); assert.strictEqual((await sharp(slide.buf).metadata()).width, 1080);
    const zip = await s.req('GET', `/carrosseis/${c.id}/zip`); assert.strictEqual(zip.status, 200); assert.strictEqual(zip.headers.get('content-type'), 'application/zip'); assert.match(zip.headers.get('content-disposition'), /\.zip/); assert.strictEqual(Pacote.lerZip(zip.buf).length, 12);
    const ap = await s.req('POST', `/carrosseis/${c.id}/decisao`, { acao: 'aprovar' }); assert.strictEqual(ap.json.estado, 'aprovado');
    assert.strictEqual((await s.req('GET', '/estado')).json.fila_aprovacao, 0);
    assert.strictEqual((await s.req('POST', `/oportunidades/${primeira.id}/acao`, { acao: 'nada' })).status, 400);
    assert.strictEqual((await s.req('GET', '/carrosseis/../../x/zip')).status >= 400, true);
  } finally { s.fechar(); }
});
test('API: ações da oportunidade (salvar, descartar, editar, usar, Reels) e nova pesquisa manual', async () => {
  const s = await servidor();
  try {
    await s.req('GET', '/cron');
    const lista = (await s.req('GET', '/oportunidades')).json.oportunidades; const alvo = lista.find((o) => o.nome !== 'Lumen Pets');
    assert.strictEqual((await s.req('POST', `/oportunidades/${alvo.id}/acao`, { acao: 'salvar_pauta' })).json.status, 'salva');
    const ed = await s.req('POST', `/oportunidades/${alvo.id}/acao`, { acao: 'editar', campos: { resumo: 'Resumo novo editado por mim.', nome: 'Nome Novo' } }); assert.strictEqual(ed.json.resumo, 'Resumo novo editado por mim.'); assert.ok(ed.json.decisoes.some((d) => d.acao === 'editar' && d.antes));
    assert.strictEqual((await s.req('POST', `/oportunidades/${alvo.id}/acao`, { acao: 'marcar_usada' })).json.status, 'usada');
    assert.strictEqual((await s.req('POST', `/oportunidades/${alvo.id}/acao`, { acao: 'descartar', motivo: 'não curti' })).json.status, 'descartada_usuario');
    const desc = (await s.req('GET', '/oportunidades?status=descartadas')).json.oportunidades; assert.ok(desc.some((o) => o.id === alvo.id && /não curti/.test(o.descartada_motivo)));
    const naoVerif = lista.find((o) => !o.elegivel_carrossel);
    if (naoVerif) { const g = await s.req('POST', `/oportunidades/${naoVerif.id}/acao`, { acao: 'gerar_carrossel' }); assert.strictEqual(g.status, 422); assert.match(g.json.error, /verificad|número/i); }
    const lumen = lista.find((o) => o.nome === 'Lumen Pets');
    const reels = await s.req('POST', `/oportunidades/${lumen.id}/acao`, { acao: 'gerar_reels' }); assert.strictEqual(reels.status, 200); assert.ok(reels.json.reels.blocos.length >= 3);
    const det = (await s.req('GET', `/oportunidades/${lumen.id}`)).json; assert.ok(det.reels && det.verificacao.claims.length > 0 && det.criterios);
    const rep = await s.req('POST', `/oportunidades/${lumen.id}/acao`, { acao: 'gerar_carrossel' }); assert.strictEqual(rep.json.existente, true);
    const pesq = await s.req('POST', '/pesquisar'); assert.strictEqual(pesq.status, 202); assert.ok(pesq.json.run_id);
    let passo; for (let i = 0; i < 6; i++) { passo = await s.req('POST', `/execucoes/${pesq.json.run_id}/passo`); if (passo.json.concluida) break; }
    assert.ok(passo.json.concluida, JSON.stringify(passo.json).slice(0, 300));
  } finally { s.fechar(); }
});
test('aprendizado: publicado + métricas por categoria; curtida nunca vira seguidor; vazio não vira zero', async () => {
  const s = await servidor();
  try {
    await s.req('GET', '/cron'); const c = (await s.req('GET', '/carrosseis')).json.carrosseis[0];
    assert.strictEqual((await s.req('POST', `/carrosseis/${c.id}/metricas`, { metricas: { alcance: 100 } })).status, 409, 'antes de publicar não há métrica');
    const pub = await s.req('POST', `/carrosseis/${c.id}/decisao`, { acao: 'publicado', publicado_em: '2026-10-26T13:30:00Z', link: 'https://www.instagram.com/p/abc/', metricas: { visualizacoes: 5000, alcance: 4200, curtidas: 300, comentarios: 20, compartilhamentos: 80, salvamentos: 120, visitas_perfil: 150 } });
    assert.strictEqual(pub.json.estado, 'publicado'); assert.strictEqual(pub.json.publicacao.hora_brt, 10);
    assert.strictEqual(pub.json.metricas.seguidores_ganhos, undefined, 'seguidores não informados continuam ausentes (não viram 0)');
    assert.strictEqual((await s.req('POST', `/carrosseis/${c.id}/decisao`, { acao: 'publicado', link: 'http://evil.com' })).status, 400);
    const painel = (await s.req('GET', '/aprendizado')).json; assert.strictEqual(painel.posts_medidos, 1);
    assert.strictEqual(painel.categorias[0].seguidores_ganhos_total, null); assert.strictEqual(painel.lideres.mais_seguidores, null, 'sem seguidores informados não há líder de seguidores');
    assert.ok(painel.lideres.maior_alcance && painel.categorias[0].amostra === 'pequena');
    await s.req('POST', `/carrosseis/${c.id}/metricas`, { metricas: { seguidores_ganhos: 35 } });
    const p2 = (await s.req('GET', '/aprendizado')).json; assert.strictEqual(p2.categorias[0].seguidores_ganhos_total, 35); assert.ok(p2.lideres.mais_seguidores);
    assert.strictEqual(p2.categorias[0].seguidores_por_mil_alcancados, Math.round(35 / 4200 * 1000 * 10) / 10);
    assert.throws(() => Aprend.validarMetricas({ alcance: -1 }));
    assert.throws(() => Aprend.validarMetricas({ retencao_pct: 140 }));
  } finally { s.fechar(); }
});
test('notificação do PWA: payload com a frase combinada e destino /?tab=radar (service worker abre a aba)', async () => {
  novoBanco(); const push = require('./push'); process.env.VAPID_PUBLIC_KEY = 'a'; process.env.VAPID_PRIVATE_KEY = 'b';
  const enviados = [];
  await A.armazem().config.salvar(require('./account').ACCOUNT.ig_id, { push_subs: [{ endpoint: 'https://push.exemplo/1', keys: { p256dh: 'x', auth: 'y' } }] });
  const r = await push.notificar({ corpo: P.MSG_NOTIFICACAO, url: '/?tab=radar', tag: 'radar-nova-ideia', n: 1 }, { sender: async (sub, payload) => { enviados.push(JSON.parse(payload)); } });
  assert.strictEqual(r.enviadas, 1); assert.deepStrictEqual([enviados[0].corpo, enviados[0].url, enviados[0].tag], ['Uma nova ideia de negócio está pronta para você.', '/?tab=radar', 'radar-nova-ideia']);
  const sw = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'static', 'sw.js'), 'utf8');
  assert.match(sw, /tab=radar/); assert.match(sw, /abrir-aba/);
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
});

test('nova versão depois de uma copy que esgotou as tentativas recomeça na versão seguinte', async () => {
  const s = await servidor();
  try {
    await s.req('GET', '/cron');
    const op = (await s.req('GET', '/oportunidades')).json.oportunidades.find((o) => o.nome === 'Lumen Pets');
    const idV2 = `cr_${op.id.replace(/^op_/, '')}_v2`;
    await store.salvar('carrossel', idV2, { op_id: op.id, versao: 2, estado: 'erro', etapa: 'copy', copia_tentativas: 11, feedback_copia: 'x', historico: [], criado_em: new Date().toISOString() }, 0);
    const r = await s.req('POST', `/oportunidades/${op.id}/acao`, { acao: 'gerar_carrossel', serie: 'ideias', nova_versao: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.strictEqual(r.json.carrossel.versao, 3); assert.strictEqual(r.json.carrossel.estado, 'aguardando_aprovacao');
    assert.strictEqual((await store.obter('carrossel', idV2)).doc.estado, 'substituido');
  } finally { s.fechar(); }
});

test('nova versão nunca reutiliza o número de uma versão existente (mesmo se uma versão com erro ficou fora da lista)', async () => {
  const s = await servidor();
  try {
    await s.req('GET', '/cron');
    const op = (await s.req('GET', '/oportunidades')).json.oportunidades.find((o) => o.nome === 'Lumen Pets');
    const a = await s.req('POST', `/oportunidades/${op.id}/acao`, { acao: 'gerar_carrossel', serie: 'ideias', nova_versao: true }); assert.strictEqual(a.json.carrossel.versao, 2);
    await store.salvar('carrossel', `cr_${op.id.replace(/^op_/, '')}_v3`, { op_id: op.id, versao: 3, estado: 'erro', copia_tentativas: 11, historico: [] }, 0);
    const b = await s.req('POST', `/oportunidades/${op.id}/acao`, { acao: 'gerar_carrossel', serie: 'ideias', nova_versao: true }); assert.strictEqual(b.json.carrossel.versao, 4, 'a v3 com erro foi substituída e a nova é a v4');
    const c = await s.req('POST', `/oportunidades/${op.id}/acao`, { acao: 'gerar_carrossel', serie: 'ideias', nova_versao: true }); assert.strictEqual(c.json.carrossel.versao, 5);
  } finally { s.fechar(); }
});
