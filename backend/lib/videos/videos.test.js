// Vídeos: do envio ao "Para aprovar" com armazém em memória, IA simulada e Blob sem rede.
// node --test backend/lib/videos/videos.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');
const arm = require('../armazem');
const M = require('../../../static/contentModel');
const G = require('../../../static/qualityGates');
const AI = require('../mentes/antiIA');
const { ACCOUNT } = require('../account');

const TOKEN_BLOB = 'vercel_blob_rw_TESTE1234_segredodetestequenaoerealmente';
const envAntes = { ...process.env };
let V; let P; let studio;
test.before(() => {
  delete process.env.VERCEL; delete process.env.GITHUB_DISPATCH_TOKEN; delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.APP_ACCESS_CODE; delete process.env.CRON_SECRET;
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN_BLOB;
  V = require('./index'); P = require('../publicador'); studio = require('../studio');
});
test.after(() => { for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); });

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const ler = async (id) => (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, id)).doc;
const blob = (id, nome) => ({ url: `https://abc.public.blob.vercel-storage.com/videos/${id}/${nome}`, pathname: `videos/${id}/${nome}` });
const TRANSCRICAO = { texto: 'Olha, eu abri a maquininha hoje e vi o que sobrou depois da taxa. O fornecedor liga, o boleto vence, e o governo quer mais uma fatia. Quem tem CNPJ sabe do que eu estou falando.', frases: [{ t0: 0, t1: 3.2, texto: 'Olha, eu abri a maquininha hoje' }] };
const RESULTADO = (id) => ({ ...blob(id, 'final.mp4'), poster_url: blob(id, 'poster.jpg').url, duracao_s: 48.2, tamanho: 12345678, cortes: 14, palavras: 120 });

// IA simulada: devolve as respostas na ordem e registra as chamadas.
function iaFalsa(respostas) {
  const chamadas = [];
  const ia = async (args) => { chamadas.push(args); const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)]; if (r instanceof Error) throw r; return { dados: JSON.parse(JSON.stringify(r)), llm: { provider: 'simulado' } }; };
  return { ia, chamadas };
}
const LEGENDA_BOA = { legenda: 'Abri a maquininha e vi o que sobrou. O boleto vence, o fornecedor liga e ainda querem mais uma fatia do que você produz. Manda esse vídeo pra quem tem CNPJ e acha que isso é normal.', hashtags: ['empreendedorismo', 'impostos', 'economia'] };
const LEGENDA_RUIM = { legenda: 'O problema não é a taxa, é o governo — que leva 27% de tudo. Quem paga a conta é você. Manda pra quem tem CNPJ.', hashtags: ['#economia', 'brasil', 'impostos'] };
const depsDe = (ia, extra = {}) => { const push = []; const dels = []; const fetches = []; return { deps: { ia, push: async (m) => { push.push(m); return { enviadas: 1 }; }, del: async (u) => { dels.push(u); }, fetch: async (url, opts) => { fetches.push({ url, opts }); return { status: 204 }; }, ...extra }, push, dels, fetches }; };

async function ateNaFila(deps) {
  const c = await V.criar({ titulo: 'Maquininha', estilo: 'beast', roteiro_texto: 'Roteiro lido no teleprompter.' });
  await V.registrarEnvio(c.id, { ...blob(c.id, 'bruto.mp4'), tamanho: 50 * 1048576, contentType: 'video/mp4' }, { deps });
  return c.id;
}

test('sem BLOB_READ_WRITE_TOKEN tudo falha claro (503) e nada é criado', async () => {
  novo(); delete process.env.BLOB_READ_WRITE_TOKEN;
  await assert.rejects(V.criar({ titulo: 'x' }), (e) => e.status === 503 && e.code === 'SEM_BLOB' && /Storage → Blob/.test(e.message));
  await assert.rejects(V.tokenDoWorker({ id: 'vd_x', pathname: 'videos/vd_x/a.mp4' }), (e) => e.status === 503);
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN_BLOB;
  assert.strictEqual((await V.listar()).length, 0);
});

test('criar: conteúdo normal do app em formato reels, origem vídeo, campo video completo e estilo/opções normalizados', async () => {
  novo();
  const c = await V.criar({ titulo: 'Teste', estilo: 'inexistente', opcoes: { broll: false, musica: 'sim', punch_in: true } });
  assert.ok(c.id.startsWith('vd_'));
  assert.strictEqual(c.formato, 'reels'); assert.strictEqual(c.origem.tipo, 'video'); assert.strictEqual(c.status, 'rascunho');
  assert.strictEqual(c.video.estado, 'enviado'); assert.strictEqual(c.video.estilo, 'hormozi');
  assert.deepStrictEqual(c.video.opcoes, { broll: false, musica: false, punch_in: true, remover_pausas: true, remover_muletas: true });
  assert.deepStrictEqual(c.video.worker, { tentativas: 0, iniciado_em: null, concluido_em: null, run_url: null, erro: null });
  assert.strictEqual(c.conta.ig_id, ACCOUNT.ig_id);
  assert.strictEqual((await ler(c.id)).id, c.id, 'gravado no servidor');
});

test('enviado: só aceita arquivo em videos/<id>/ com URL https; vai para na_fila e dispara o worker quando há GITHUB_DISPATCH_TOKEN', async () => {
  novo(); const d = depsDe(iaFalsa([LEGENDA_BOA]).ia);
  const c = await V.criar({});
  await assert.rejects(V.registrarEnvio(c.id, { url: 'https://x/y.mp4', pathname: 'videos/outro/y.mp4' }), /videos\//);
  await assert.rejects(V.registrarEnvio(c.id, { url: 'http://inseguro/y.mp4', pathname: `videos/${c.id}/y.mp4` }), /https/);
  process.env.GITHUB_DISPATCH_TOKEN = 'ghp_teste';
  const r = await V.registrarEnvio(c.id, { ...blob(c.id, 'bruto.mp4'), tamanho: 1000, contentType: 'video/mp4' }, d);
  delete process.env.GITHUB_DISPATCH_TOKEN;
  assert.strictEqual(r.video.estado, 'na_fila'); assert.strictEqual(r.video.origem.pathname, `videos/${c.id}/bruto.mp4`);
  assert.strictEqual(d.fetches.length, 1);
  assert.match(d.fetches[0].url, /repos\/ph185982-crypto\/agente-bastao-iel\/dispatches$/);
  assert.strictEqual(JSON.parse(d.fetches[0].opts.body).event_type, 'video');
  assert.strictEqual(d.fetches[0].opts.headers.Authorization, 'Bearer ghp_teste');
  // repetir o mesmo envio (webhook + navegador) não muda nada nem dá erro
  const r2 = await V.registrarEnvio(c.id, { ...blob(c.id, 'bruto.mp4') }, d);
  assert.strictEqual(r2.video.estado, 'na_fila');
  // sem o token do GitHub: só registra
  const c2 = await V.criar({}); const d2 = depsDe(null);
  await V.registrarEnvio(c2.id, blob(c2.id, 'b.mp4'), d2); assert.strictEqual(d2.fetches.length, 0);
});

test('fila: proximoJob pega o mais antigo, marca editando com lease de 30 min e não entrega o mesmo job duas vezes', async () => {
  novo(); const d = depsDe(null);
  const a = await ateNaFila(d.deps); await new Promise((r) => setTimeout(r, 5)); const b = await ateNaFila(d.deps);
  const j1 = await V.proximoJob();
  assert.strictEqual(j1.id, a); assert.strictEqual(j1.estilo, 'beast'); assert.strictEqual(j1.roteiro_texto, 'Roteiro lido no teleprompter.'); assert.ok(j1.origem.url.startsWith('https://'));
  const doc = await ler(a);
  assert.strictEqual(doc.video.estado, 'editando'); assert.strictEqual(doc.video.worker.tentativas, 1);
  const lease = Date.parse(doc.video.worker.lease_ate) - Date.now();
  assert.ok(lease > 29 * 60000 && lease <= 30 * 60000, `lease de ~30 min (${lease} ms)`);
  const j2 = await V.proximoJob(); assert.strictEqual(j2.id, b);
  assert.strictEqual(await V.proximoJob(), null, 'fila vazia → null (rota devolve 204)');
  assert.strictEqual((await V.obter(a)).video.worker.lease_ate, undefined, 'o lease é interno: não sai no documento público');
});

test('resultado: legenda com vício é rejeitada e pedida de novo; versão de 1 slide reel + motion blob pronto; em_revisao; push para a aba de vídeos', async () => {
  novo(); const ia = iaFalsa([LEGENDA_RUIM, LEGENDA_BOA]); const d = depsDe(ia.ia);
  const id = await ateNaFila(d.deps); await V.proximoJob();
  const c = await V.registrarResultado(id, { resultado: RESULTADO(id), transcricao: TRANSCRICAO, log: ['whisper small', { msg: '14 cortes' }], run_url: 'https://github.com/x/actions/runs/1' }, d);
  assert.strictEqual(ia.chamadas.length, 2, 'a 1ª resposta tinha vícios: pediu de novo uma vez');
  assert.match(ia.chamadas[1].sistema, /REJEITADA.*reversão/s);
  assert.match(ia.chamadas[0].usuario, /<<<DADOS TRANSCRIÇÃO DO VÍDEO>>>/, 'transcrição entra como dado delimitado');
  assert.strictEqual(c.video.estado, 'pronto'); assert.strictEqual(c.status, 'em_revisao'); assert.strictEqual(c.studio.estado, 'pronto');
  assert.strictEqual(c.video.legenda_ig.texto, LEGENDA_BOA.legenda);
  assert.deepStrictEqual(c.video.legenda_ig.hashtags, ['#empreendedorismo', '#impostos', '#economia']);
  assert.strictEqual(AI.vicios(c.video.legenda_ig.texto).length, 0);
  const v = M.versaoAtiva(c);
  assert.strictEqual(c.copia.versoes.length, 1); assert.strictEqual(v.slides.length, 1); assert.strictEqual(v.slides[0].layout, 'reel'); assert.strictEqual(v.slides[0].texto, LEGENDA_BOA.legenda);
  assert.strictEqual(v.legenda, LEGENDA_BOA.legenda); assert.deepStrictEqual(v.hashtags, c.video.legenda_ig.hashtags);
  assert.deepStrictEqual({ ...c.motion, duracao_s: undefined, formato: undefined }, { engine: 'blob', estado: 'pronto', hash: v.hash, url: RESULTADO(id).url, poster: RESULTADO(id).poster_url, sandbox: false, duracao_s: undefined, formato: undefined });
  assert.strictEqual(c.video.transcricao.frases[0].t1, 3.2); assert.strictEqual(c.video.worker.run_url, 'https://github.com/x/actions/runs/1'); assert.strictEqual(c.video.worker.lease_ate, undefined);
  assert.ok(c.video.log.some((l) => /editor: 14 cortes/.test(l.msg)));
  assert.strictEqual(d.push.length, 1); assert.strictEqual(d.push[0].url, '/?tab=videos'); assert.match(d.push[0].corpo, /Vídeo pronto/);
  // segundo resultado para o mesmo vídeo não sobrescreve
  await assert.rejects(V.registrarResultado(id, { resultado: RESULTADO(id) }, d), (e) => e.code === 'JA_PRONTO');
  const lista = await V.listar();
  assert.strictEqual(lista.length, 1); assert.strictEqual(lista[0].poster, RESULTADO(id).poster_url); assert.strictEqual(lista[0].legenda, LEGENDA_BOA.legenda); assert.strictEqual(lista[0].hash, v.hash);
});

test('o vídeo pronto passa nos portões, é aprovável pelo studio e o publicador reconhece como REELS pronto', async () => {
  novo(); const d = depsDe(iaFalsa([LEGENDA_BOA]).ia);
  const id = await ateNaFila(d.deps); await V.proximoJob();
  const c = await V.registrarResultado(id, { resultado: RESULTADO(id), transcricao: TRANSCRICAO }, d);
  const g = G.avaliar(c, { conta: M.ACCOUNT_PIN });
  assert.deepStrictEqual(g.bloqueios.map((b) => b.id), [], 'nenhum bloqueio de revisão');
  const v = M.versaoAtiva(c);
  const aprovado = await studio.decidir(id, { acao: 'aprovar', hash: v.hash });
  assert.strictEqual(aprovado.status, 'aprovado'); assert.strictEqual(aprovado.revisao.hash_aprovado, v.hash);
  const reg = await P.carregarAprovado(id);
  assert.strictEqual(reg.c.formato, 'reels');
  const m = await P.conferirMidias(reg.c, reg.v, {});
  assert.deepStrictEqual(m, { slides: [], avisos: [] }, 'REELS: sem slides para renderizar, vídeo pronto');
  assert.strictEqual(reg.c.motion.url, RESULTADO(id).url);
  // aprovado não pode ser refeito nem o resultado trocado
  await assert.rejects(V.refazer(id, {}), (e) => e.code === 'APROVADO');
});

test('legenda: IA que insiste no vício tem o trecho removido com aviso; IA fora do ar gera legenda provisória da transcrição; sem número sem fonte', async () => {
  const ruimSempre = { legenda: 'Quem paga a conta é você. O custo subiu 27% em 2025 — e ninguém avisou. Esse é o jogo. Manda pra quem tem CNPJ.', hashtags: ['economia'] };
  const r = await V.gerarLegenda({ transcricao: TRANSCRICAO }, { ia: iaFalsa([ruimSempre, ruimSempre]).ia });
  assert.strictEqual(r.origem, 'ia_limpa'); assert.ok(r.avisos.length);
  assert.strictEqual(AI.vicios(r.texto).length, 0, r.texto);
  assert.strictEqual(M.extrairNumeros(r.texto).filter(M.exigeOrigem).length, 0);
  assert.match(r.texto, /Manda pra quem tem CNPJ/); assert.doesNotMatch(r.texto, /paga a conta|27%|—/);
  assert.strictEqual(r.hashtags.length, 3, 'completa as hashtags que faltaram');
  const semIa = await V.gerarLegenda({ transcricao: TRANSCRICAO }, { ia: iaFalsa([Object.assign(new Error('Nenhuma IA está configurada no servidor.'), { code: 'SEM_IA' })]).ia });
  assert.strictEqual(semIa.origem, 'transcricao'); assert.match(semIa.texto, /maquininha/); assert.match(semIa.texto, /Manda esse vídeo/); assert.match(semIa.avisos[0], /IA indisponível/);
  // citação, "segundo Fulano" e número também são motivo de rejeição
  assert.ok(V.problemasDaLegenda('Segundo Fulano, "a economia vai muito bem obrigado". Manda pra alguém.').some((p) => /aspas/.test(p)));
  assert.ok(V.problemasDaLegenda('Pagamos R$ 1.600 por mês. Manda pra alguém que precisa.').some((p) => /número sem fonte/.test(p)));
  assert.ok(V.problemasDaLegenda('Frase um. Frase dois sem pedido nenhum.').some((p) => /enviar/.test(p)));
});

test('erro: 1ª falha volta à fila, 2ª falha é erro final; refazer limpa e volta à fila com o estilo novo', async () => {
  novo(); const d = depsDe(null);
  const id = await ateNaFila(d.deps);
  await assert.rejects(V.registrarErro(id, { erro: 'cedo demais' }), (e) => e.code === 'ESTADO', 'sem job pego não há erro a registrar');
  await V.proximoJob();
  let c = await V.registrarErro(id, { erro: 'ffmpeg falhou', log: ['etapa 3'] });
  assert.strictEqual(c.video.estado, 'na_fila'); assert.strictEqual(c.video.worker.tentativas, 1); assert.strictEqual(c.video.worker.erro, 'ffmpeg falhou');
  const j = await V.proximoJob(); assert.strictEqual(j.id, id); assert.strictEqual(j.tentativa, 2);
  c = await V.registrarErro(id, { erro: 'ffmpeg falhou de novo' });
  assert.strictEqual(c.video.estado, 'erro'); assert.strictEqual(c.status, 'rascunho'); assert.strictEqual(c.studio.estado, 'erro'); assert.strictEqual(c.video.worker.tentativas, 2);
  assert.strictEqual(await V.proximoJob(), null, 'erro final não volta à fila sozinho');
  assert.strictEqual((await V.listar())[0].erro, 'ffmpeg falhou de novo');
  c = await V.refazer(id, { estilo: 'caixa', opcoes: { broll: false } }, d);
  assert.strictEqual(c.video.estado, 'na_fila'); assert.strictEqual(c.video.estilo, 'caixa'); assert.strictEqual(c.video.opcoes.broll, false); assert.strictEqual(c.video.worker.tentativas, 0); assert.strictEqual(c.motion, null);
  assert.strictEqual((await V.proximoJob()).estilo, 'caixa');
  // refazer com o editor trabalhando (lease vivo) é recusado
  await assert.rejects(V.refazer(id, {}), (e) => e.code === 'EM_ANDAMENTO');
});

test('lease vencido: o job volta à fila e é pego de novo; na terceira vez vira erro', async () => {
  novo(); const d = depsDe(null);
  const id = await ateNaFila(d.deps);
  await V.proximoJob();
  const vencer = async () => { const r = await arm.armazem().conteudos.obter(ACCOUNT.ig_id, id); r.doc.video.worker.lease_ate = new Date(Date.now() - 1000).toISOString(); await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, id, r.doc, r.rev); };
  await vencer();
  const j = await V.proximoJob();
  assert.strictEqual(j.id, id, 'lease vencido voltou à fila e foi pego de novo'); assert.strictEqual(j.tentativa, 2);
  assert.ok((await ler(id)).video.log.some((l) => /Lease vencido: voltou/.test(l.msg)));
  await vencer();
  assert.strictEqual(await V.proximoJob(), null);
  const c = await ler(id);
  assert.strictEqual(c.video.estado, 'erro'); assert.match(c.video.worker.erro, /não respondeu/);
  // o resultado que chega atrasado depois do erro final é recusado
  await assert.rejects(V.registrarResultado(id, { resultado: RESULTADO(id) }, d), (e) => e.code === 'ESTADO');
  // refazer depois do erro reabre
  assert.strictEqual((await V.refazer(id, {}, d)).video.estado, 'na_fila');
});

test('refazer um vídeo pronto cria uma versão nova (a antiga fica) e o publicador deixa de reconhecer o vídeo até a nova edição', async () => {
  novo(); const d = depsDe(iaFalsa([LEGENDA_BOA]).ia);
  const id = await ateNaFila(d.deps); await V.proximoJob();
  await V.registrarResultado(id, { resultado: RESULTADO(id), transcricao: TRANSCRICAO }, d);
  const c = await V.refazer(id, { estilo: 'hormozi' }, d);
  assert.strictEqual(c.motion, null); assert.strictEqual(c.copia.versoes.length, 1); assert.strictEqual(c.status, 'rascunho');
  await V.proximoJob();
  const c2 = await V.registrarResultado(id, { resultado: { ...RESULTADO(id), url: blob(id, 'final-2.mp4').url, pathname: blob(id, 'final-2.mp4').pathname }, transcricao: TRANSCRICAO }, d);
  assert.strictEqual(c2.copia.versoes.length, 2); assert.strictEqual(M.versaoAtiva(c2).id, 'v2'); assert.strictEqual(c2.motion.hash, M.versaoAtiva(c2).hash); assert.match(c2.motion.url, /final-2\.mp4/);
});

test('apagar: arquiva e apaga os três blobs com o token do servidor; some da lista', async () => {
  novo(); const d = depsDe(iaFalsa([LEGENDA_BOA]).ia);
  const id = await ateNaFila(d.deps); await V.proximoJob();
  await V.registrarResultado(id, { resultado: RESULTADO(id), transcricao: TRANSCRICAO }, d);
  const r = await V.apagar(id, d);
  assert.deepStrictEqual(r, { id, arquivado: true, blobs_apagados: 3 });
  assert.deepStrictEqual(d.dels[0].sort(), [blob(id, 'bruto.mp4').url, RESULTADO(id).url, RESULTADO(id).poster_url].sort());
  const c = await ler(id); assert.strictEqual(c.status, 'arquivado'); assert.strictEqual(c.motion, null);
  assert.strictEqual((await V.listar()).length, 0);
  await assert.rejects(V.registrarEnvio(id, blob(id, 'x.mp4')), (e) => e.code === 'ARQUIVADO');
  // falha ao apagar no Blob não impede arquivar
  const id2 = await ateNaFila(d.deps);
  const r2 = await V.apagar(id2, { deps: { del: async () => { throw new Error('rede'); } } });
  assert.strictEqual(r2.blobs_apagados, 0); assert.strictEqual((await ler(id2)).status, 'arquivado');
});

// ── Rotas: express só com o router (sem o exigeAcesso global, que é do server.js) ──
let srv; let base; let quem = 0;
const assina = (corpo) => crypto.createHmac('sha256', TOKEN_BLOB).update(corpo).digest('hex');
const chamar = (metodo, caminho, corpo, headers = {}) => fetch(`${base}${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${(quem++ % 200) + 1}`, ...headers }, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
test.before(async () => {
  const app = express(); app.use(express.json({ limit: '2mb' })); app.use('/api/videos', require('../../routes/videos'));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${srv.address().port}/api/videos`;
});
test.after(() => { srv?.close(); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });

test('rotas: criar → enviado → worker pega (204 quando vazio) → token restrito → resultado → lista e documento', async () => {
  novo(); process.env.PUBLIC_BASE_URL = 'https://app.teste';
  let r = await chamar('POST', '/', { titulo: 'Pela rota', estilo: 'caixa' }); assert.strictEqual(r.status, 201);
  const { id, prefixo_blob } = await r.json(); assert.strictEqual(prefixo_blob, `videos/${id}/`);
  r = await chamar('GET', '/worker/proximo'); assert.strictEqual(r.status, 204, 'ainda sem arquivo: nada na fila');
  r = await chamar('POST', `/${id}/enviado`, { ...blob(id, 'bruto.mov'), tamanho: 100, contentType: 'video/quicktime' }); assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).estado, 'na_fila');
  r = await chamar('POST', `/${id}/enviado`, { url: 'https://x/y', pathname: 'videos/outro/y' }); assert.strictEqual(r.status, 400);
  r = await chamar('GET', '/worker/proximo'); assert.strictEqual(r.status, 200); const job = await r.json(); assert.strictEqual(job.id, id); assert.strictEqual(job.estilo, 'caixa');
  r = await chamar('POST', '/worker/token', { id, pathname: `videos/${id}/final.mp4`, contentType: 'video/mp4' }); assert.strictEqual(r.status, 200);
  const { clientToken } = await r.json();
  assert.ok(clientToken.startsWith('vercel_blob_client_TESTE1234_'), 'client token do mesmo store, nunca o token de leitura/escrita');
  assert.ok(!clientToken.includes(TOKEN_BLOB.split('_').pop()));
  const payload = require('@vercel/blob/client').getPayloadFromClientToken(clientToken);
  assert.strictEqual(payload.pathname, `videos/${id}/final.mp4`); assert.strictEqual(payload.maximumSizeInBytes, 600 * 1024 * 1024); assert.deepStrictEqual(payload.allowedContentTypes, V.TIPOS_PERMITIDOS);
  assert.ok(payload.validUntil - Date.now() <= 3600 * 1000 && payload.validUntil - Date.now() > 3500 * 1000, 'válido por 1 h');
  r = await chamar('POST', '/worker/token', { id, pathname: 'videos/outro/final.mp4' }); assert.strictEqual(r.status, 400);
  r = await chamar('POST', '/worker/token', { id: 'vd_nao_existe', pathname: 'videos/vd_nao_existe/final.mp4' }); assert.strictEqual(r.status, 404);
  // resultado sem IA configurada: legenda provisória, mas o vídeo fica pronto
  r = await chamar('POST', '/worker/resultado', { id, resultado: RESULTADO(id), transcricao: TRANSCRICAO, log: ['ok'] }); assert.strictEqual(r.status, 200, JSON.stringify(await r.clone().json()));
  const pronto = await r.json(); assert.strictEqual(pronto.estado, 'pronto'); assert.ok(pronto.legenda); assert.ok(pronto.hash);
  r = await chamar('GET', '/'); const { videos } = await r.json(); assert.strictEqual(videos.length, 1); assert.strictEqual(videos[0].id, id);
  r = await chamar('GET', `/${id}`); const doc = await r.json(); assert.strictEqual(doc.motion.engine, 'blob'); assert.strictEqual(doc.video.worker.lease_ate, undefined); assert.strictEqual(doc.copia.versoes.length, 1);
  r = await chamar('GET', '/vd_nada'); assert.strictEqual(r.status, 404);
  r = await chamar('POST', `/${id}/refazer`, { estilo: 'beast' }); assert.strictEqual((await r.json()).estado, 'na_fila');
  r = await chamar('GET', '/worker/proximo'); assert.strictEqual((await r.json()).estilo, 'beast');
  r = await chamar('POST', '/worker/erro', { id, erro: 'sem áudio' }); assert.strictEqual((await r.json()).estado, 'na_fila');
  r = await chamar('DELETE', `/${id}`); assert.strictEqual(r.status, 200);
  // o módulo tenta o `del` real sem rede: a falha vira log, o vídeo fica arquivado mesmo assim
  assert.strictEqual((await ler(id)).status, 'arquivado');
});

test('rota /blob: gera client token só para videos/<id>/ de um vídeo existente; recebe o aviso assinado de upload concluído', async () => {
  novo(); process.env.PUBLIC_BASE_URL = 'https://app.teste';
  const { id } = await (await chamar('POST', '/', {})).json();
  const pedir = (pathname, clientPayload, headers) => chamar('POST', '/blob', { type: 'blob.generate-client-token', payload: { pathname, multipart: true, clientPayload } }, headers);
  let r = await pedir(`videos/${id}/bruto.mp4`, JSON.stringify({ id, papel: 'origem' })); assert.strictEqual(r.status, 200, JSON.stringify(await r.clone().json()));
  const { clientToken, type } = await r.json(); assert.strictEqual(type, 'blob.generate-client-token');
  const payload = require('@vercel/blob/client').getPayloadFromClientToken(clientToken);
  assert.strictEqual(payload.addRandomSuffix, true); assert.strictEqual(payload.onUploadCompleted.callbackUrl, 'https://app.teste/api/videos/blob'); assert.deepStrictEqual(JSON.parse(payload.onUploadCompleted.tokenPayload), { id, papel: 'origem' });
  r = await pedir(`videos/outro/bruto.mp4`, JSON.stringify({ id })); assert.strictEqual(r.status, 400);
  r = await pedir(`videos/${id}/bruto.mp4`, null); assert.strictEqual(r.status, 400, 'sem clientPayload com o id');
  r = await pedir(`videos/vd_nao/bruto.mp4`, JSON.stringify({ id: 'vd_nao' })); assert.strictEqual(r.status, 404);
  r = await chamar('POST', '/blob', { type: 'outro' }); assert.strictEqual(r.status, 400);
  // app protegido: sem sessão nem CRON_SECRET, não há token; com o CRON_SECRET do worker, há
  process.env.APP_ACCESS_CODE = 'codigo-de-teste-longo'; process.env.CRON_SECRET = 'segredo-cron-teste';
  r = await pedir(`videos/${id}/bruto.mp4`, JSON.stringify({ id })); assert.strictEqual(r.status, 401);
  r = await pedir(`videos/${id}/bruto.mp4`, JSON.stringify({ id }), { Authorization: 'Bearer segredo-cron-teste' }); assert.strictEqual(r.status, 200);
  r = await pedir(`videos/${id}/bruto.mp4`, JSON.stringify({ id }), { Authorization: 'Bearer errado' }); assert.strictEqual(r.status, 401);
  delete process.env.APP_ACCESS_CODE; delete process.env.CRON_SECRET;
  // upload concluído: a Vercel assina o corpo com o token do servidor; sem assinatura é recusado
  const evento = JSON.stringify({ type: 'blob.upload-completed', payload: { blob: { ...blob(id, 'bruto-abc123.mp4'), contentType: 'video/mp4', downloadUrl: '' }, tokenPayload: JSON.stringify({ id, papel: 'origem' }) } });
  r = await chamar('POST', '/blob', evento); assert.strictEqual(r.status, 400); assert.match((await r.json()).error, /signature/i);
  r = await chamar('POST', '/blob', evento, { 'x-vercel-signature': assina(evento) }); assert.strictEqual(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.strictEqual((await ler(id)).video.estado, 'na_fila', 'o webhook registrou a origem');
  r = await chamar('POST', '/blob', evento, { 'x-vercel-signature': assina(evento) }); assert.strictEqual(r.status, 200, 'webhook repetido não quebra');
  // sem Blob ligado, a rota avisa
  delete process.env.BLOB_READ_WRITE_TOKEN;
  r = await pedir(`videos/${id}/bruto.mp4`, JSON.stringify({ id })); assert.strictEqual(r.status, 503); assert.strictEqual((await r.json()).code, 'SEM_BLOB');
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN_BLOB;
});

test('acesso: as rotas do worker e /blob estão em ROTAS_CRON do access.js', () => {
  const fonte = require('fs').readFileSync(require.resolve('../access'), 'utf8');
  const linha = fonte.split('\n').find((l) => l.startsWith('const ROTAS_CRON'));
  const lista = eval(linha.replace('const ROTAS_CRON = ', '').replace(/;$/, '')); // eslint-disable-line no-eval
  for (const p of ['/api/videos/worker/proximo', '/api/videos/worker/token', '/api/videos/worker/resultado', '/api/videos/worker/erro', '/api/videos/blob']) assert.ok(lista.some((r) => r.test(p)), p);
  assert.ok(!lista.some((r) => r.test('/api/videos')), 'criar/listar continuam só com a sessão do app');
  assert.ok(!lista.some((r) => r.test('/api/videos/vd_x/refazer')));
});

test('sinal de fila: marca um arquivo no Blob a cada vídeo na fila e a URL pública vem do token (sem banco)', async () => {
  const V2 = require('./index');
  const antes = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_AbC123xyz_segredo';
  try {
    assert.strictEqual(V2.urlDoSinal(), 'https://abc123xyz.public.blob.vercel-storage.com/fila/sinal.json');
    const chamadas = [];
    const ok = await V2.marcarFila('vd_1', { put: async (nome, corpo, opts) => { chamadas.push({ nome, corpo, opts }); } });
    assert.strictEqual(ok, true);
    assert.strictEqual(chamadas[0].nome, 'fila/sinal.json');
    assert.strictEqual(chamadas[0].opts.allowOverwrite, true);
    assert.ok(JSON.parse(chamadas[0].corpo).ts > 0);
    assert.strictEqual(await V2.marcarFila('vd_1', { put: async () => { throw new Error('blob fora'); } }), false, 'falha no sinal nunca derruba o envio');
  } finally { if (antes === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = antes; }
});

test('erro 53000 do Neon vira mensagem em português', () => {
  const B = require('../bancoErro');
  const e = B.traduzir(Object.assign(new Error('Your account or project has exceeded the quota. Upgrade your plan to increase limits.'), { code: '53000' }));
  assert.strictEqual(e.status, 503); assert.match(e.message, /Neon/); assert.strictEqual(e.code, 'BANCO_COTA');
  const outro = new Error('x'); assert.strictEqual(B.traduzir(outro), outro);
});

test('faxina: o bruto sai do Blob 7 dias depois de pronto; antes disso fica; refazer sem bruto explica o motivo', async () => {
  novo(); const d = depsDe(iaFalsa([LEGENDA_BOA]).ia);
  const id = await ateNaFila(d.deps); await V.proximoJob();
  await V.registrarResultado(id, { resultado: RESULTADO(id), transcricao: TRANSCRICAO }, d);
  const pronto = Date.parse((await ler(id)).video.worker.concluido_em);
  const cedo = await V.faxina({ agora: pronto + 3 * 86400000, deps: d.deps });
  assert.strictEqual(cedo.apagados, 0); assert.ok((await ler(id)).video.origem.url);
  const tarde = await V.faxina({ agora: pronto + 8 * 86400000, deps: d.deps });
  assert.strictEqual(tarde.apagados, 1); assert.deepStrictEqual(tarde.videos, [id]);
  assert.deepStrictEqual(d.dels[d.dels.length - 1], [blob(id, 'bruto.mp4').url]);
  const c = await ler(id); assert.strictEqual(c.video.origem.url, null); assert.ok(c.video.origem.apagada_em);
  assert.ok(c.video.resultado.url, 'o vídeo editado continua'); assert.ok(c.motion?.url);
  await assert.rejects(V.refazer(id, { estilo: 'caixa' }, d), /já foi apagado/);
  // Blob fora do ar: nada muda no documento (tenta de novo no dia seguinte)
  novo(); const id2 = await ateNaFila(d.deps); await V.proximoJob();
  await V.registrarResultado(id2, { resultado: RESULTADO(id2), transcricao: TRANSCRICAO }, d);
  const f = await V.faxina({ agora: Date.now() + 9 * 86400000, deps: { del: async () => { throw new Error('rede'); } } });
  assert.strictEqual(f.apagados, 0); assert.ok((await ler(id2)).video.origem.url);
});

test('alertas de operação: banco acima de 70%, acesso ao Instagram vencendo ou caído, piloto que ficou parado', () => {
  const AL = require('../alertas'); const agora = Date.parse('2026-11-11T12:00:00Z');
  assert.deepStrictEqual(AL.avaliar({ espaco: { banco: 100 * 1048576 }, saude: { token: { valido: true, expira_em: '2027-01-01T00:00:00Z' } }, ultimaRodadaEm: '2026-11-11T11:30:00Z', agora }), []);
  assert.match(AL.avaliar({ espaco: { banco: 400 * 1048576 }, agora })[0], /78% do limite/);
  assert.match(AL.avaliar({ saude: { token: { valido: true, expira_em: '2026-11-14T12:00:00Z' } }, agora })[0], /vence em 3 dias/);
  assert.match(AL.avaliar({ saude: { reconectar: true, token: { valido: false } }, agora })[0], /acesso ao Instagram caiu/);
  assert.match(AL.avaliar({ saude: { token: { valido: true, expira_em: 'nunca (token sem expiração informada)' } }, ultimaRodadaEm: '2026-11-11T05:00:00Z', agora })[0], /7 h sem rodar/);
});

test('alertas: conferir mede, junta as frases num push só e nunca lança', async () => {
  const AL = require('../alertas'); const push = [];
  const r = await AL.conferir({ agora: Date.parse('2026-11-11T12:00:00Z'), deps: { armazem: { arquivos: { espaco: async () => ({ banco: 450 * 1048576 }) } }, saude: async () => ({ reconectar: true }), notificar: async (o) => { push.push(o); } } });
  assert.strictEqual(r.frases.length, 2); assert.strictEqual(push.length, 1); assert.match(push[0].corpo, /Banco de dados em 88%.*acesso ao Instagram caiu/);
  const ok = await AL.conferir({ deps: { armazem: { arquivos: { espaco: async () => { throw new Error('x'); } } }, saude: async () => { throw new Error('y'); }, notificar: async () => { throw new Error('z'); } } });
  assert.deepStrictEqual(ok.frases, []);
});
