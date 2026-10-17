// Armazenamento no servidor e tarefas duráveis.
// Postgres real quando PICO_TEST_PG estiver definido (ex.: postgres://pico:...@127.0.0.1/pico_teste);
// sem ele, os testes de banco são pulados e o resto roda com o driver em memória.
// node --test backend/lib/armazem.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const A = require('./armazem');
const { ACCOUNT } = require('./account');

const CONTA = ACCOUNT.ig_id;
const doc = (id, extra = {}) => ({ schema: 1, id, titulo: 'FIXTURE teste', conta: { ig_id: CONTA, username: 'pedro_destrava' }, copia: { versao_ativa: 'v1', versoes: [{ id: 'v1', slides: [{ id: 's1', texto: 'R$ 140 mil', n: 0.1 + 0.2 }] }] }, updated_at: '2026-10-17T10:00:00.000Z', ...extra });

async function contrato(a) {
  await a.iniciar();
  const id = `c_${Date.now().toString(36)}`;
  const r1 = await a.conteudos.salvar(CONTA, id, doc(id), 0);
  assert.strictEqual(r1.rev, 1);
  const lido = await a.conteudos.obter(CONTA, id);
  assert.strictEqual(lido.hash, A.hashDoc(lido.doc), 'o que volta do banco tem o mesmo hash do que foi gravado');
  assert.strictEqual(lido.hash, A.hashDoc(doc(id)));
  // conflito: outro aparelho gravou antes
  await a.conteudos.salvar(CONTA, id, doc(id, { titulo: 'aparelho 1' }), 1);
  await assert.rejects(() => a.conteudos.salvar(CONTA, id, doc(id, { titulo: 'aparelho 2 desatualizado' }), 1), (e) => e.code === 'CONFLITO' && e.rev_atual === 2);
  assert.strictEqual((await a.conteudos.obter(CONTA, id)).doc.titulo, 'aparelho 1', 'nada foi sobrescrito');
  assert.ok((await a.conteudos.historico(CONTA, id)).some((h) => h.rev === 1), 'revisão anterior guardada');
  // outra conta não vê nem grava
  assert.strictEqual(await a.conteudos.obter('999', id), null);
  await assert.rejects(() => a.conteudos.salvar(CONTA, 'x1', { ...doc('x1'), conta: { ig_id: '999' } }, 0), (e) => e.code === 'CONTA');
  assert.ok((await a.conteudos.listar(CONTA)).some((x) => x.id === id && x.resumo.titulo === 'aparelho 1'));
  // arquivos
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const f = await a.arquivos.salvar(CONTA, `img:${id}`, png, 'image/png');
  const back = await a.arquivos.obter(CONTA, `img:${id}`);
  assert.ok(Buffer.from(back.dados).equals(png) && back.sha256 === f.sha256);
  // tarefas
  await a.jobs.iniciar(`copy:${id}`, 'copy', id);
  assert.strictEqual((await a.jobs.obter(`copy:${id}`)).estado, 'rodando');
  await a.jobs.concluir(`copy:${id}`, { versao: { ok: 1 } });
  const j = await a.jobs.obter(`copy:${id}`);
  assert.strictEqual(j.estado, 'concluido'); assert.deepStrictEqual(j.resultado, { versao: { ok: 1 } });
}

test('contrato do armazenamento: driver em memória', async () => { await contrato(A.memoria()); });

test('contrato do armazenamento: Postgres real', { skip: !process.env.PICO_TEST_PG && 'defina PICO_TEST_PG para rodar' }, async () => {
  const a = A.postgres({ url: process.env.PICO_TEST_PG });
  try { await contrato(a); } finally { await a.fechar(); }
});

// ── Rotas ─────────────────────────────────────────────────────────────────
async function servidor(arm) {
  A._definir(arm);
  for (const k of Object.keys(require.cache)) if (/routes[\\/](sync|content)\.js$/.test(k)) delete require.cache[k];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/sync', require('../routes/sync'));
  app.use('/api/jobs', require('../routes/sync').jobs);
  app.use('/api/content', require('../routes/content'));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chama = async (m, u, body, extra = {}) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, ...extra }); return { status: r.status, json: await r.json().catch(() => null) }; };
  return { srv, base, chama };
}

test('sem armazenamento configurado: rotas dizem claramente que a cópia está só no navegador', async () => {
  const { srv, chama } = await servidor(null);
  try {
    const st = await chama('GET', '/api/sync/status');
    assert.strictEqual(st.json.configurado, false);
    assert.match(st.json.aviso, /única cópia está neste navegador/);
    assert.strictEqual((await chama('GET', '/api/sync/conteudos')).status, 503);
  } finally { srv.close(); }
});

test('rotas: conflito vira 409; arquivo com tipo falso é recusado', async () => {
  const { srv, chama } = await servidor(A.memoria());
  try {
    assert.strictEqual((await chama('PUT', '/api/sync/conteudos/c1', { doc: doc('c1'), base_rev: 0 })).status, 200);
    const c = await chama('PUT', '/api/sync/conteudos/c1', { doc: doc('c1'), base_rev: 0 });
    assert.strictEqual(c.status, 409); assert.strictEqual(c.json.rev_atual, 1);
    const falso = await chama('PUT', '/api/sync/arquivos/foto1', { tipo: 'image/png', base64: Buffer.from('<script>alert(1)</script>').toString('base64') });
    assert.strictEqual(falso.status, 400); assert.match(falso.json.error, /não corresponde/);
    const svg = await chama('PUT', '/api/sync/arquivos/foto2', { tipo: 'image/svg+xml', base64: 'PHN2Zz4=' });
    assert.strictEqual(svg.status, 400);
    assert.strictEqual((await chama('PUT', '/api/sync/conteudos/..%2Fx', { doc: doc('../x'), base_rev: 0 })).status, 400);
  } finally { srv.close(); }
});

test('tarefa durável: aba fechada no meio da redação → o servidor termina e o resultado é recuperado sem refazer', async () => {
  const arm = A.memoria();
  const llmJson = require('./llmJson');
  const original = llmJson.pedirJson;
  const antes = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'chave-falsa-de-teste';
  let chamadas = 0;
  llmJson.pedirJson = async () => { chamadas += 1; await new Promise((r) => setTimeout(r, 600)); return { dados: { assunto: 'Teste', tese: 'Tese', objetivo: 'autoridade', fatos_disponiveis: [] }, llm: { provider: 'teste', model: 'falso' } }; };
  const { srv, base, chama } = await servidor(arm);
  try {
    const corpo = { request_id: 'aba-fechada-1', conteudo_id: 'c9', fonte: { titulo: 'x', texto: 'x'.repeat(300) }, claims: [], evidencias: [] };
    const ctl = new AbortController();
    const pedido = fetch(`${base}/api/content/briefing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: ctl.signal }).catch((e) => e.name);
    await new Promise((r) => setTimeout(r, 150));
    ctl.abort(); // "fechou a aba"
    assert.strictEqual(await pedido, 'AbortError');
    const durante = await chama('GET', '/api/jobs/briefing:aba-fechada-1');
    assert.strictEqual(durante.json.estado, 'rodando');
    await new Promise((r) => setTimeout(r, 900));
    const depois = await chama('GET', '/api/jobs/briefing:aba-fechada-1');
    assert.strictEqual(depois.json.estado, 'concluido', 'o servidor terminou mesmo com a aba fechada');
    assert.strictEqual(depois.json.resultado.briefing.assunto, 'Teste');
    // reabrir e pedir de novo com o mesmo request_id: devolve o gravado, sem nova chamada de IA
    const de_novo = await chama('POST', '/api/content/briefing', corpo);
    assert.strictEqual(de_novo.json.reaproveitado, true);
    assert.strictEqual(chamadas, 1, 'a IA foi chamada uma única vez');
    // pedido duplicado enquanto ainda roda: 202 (em andamento), não uma segunda chamada
    await arm.jobs.iniciar('copy:dup-1', 'copy', 'c9');
    const dup = await chama('POST', '/api/content/copy', { ...corpo, request_id: 'dup-1', briefing: {} });
    assert.strictEqual(dup.status, 202);
  } finally {
    srv.close(); llmJson.pedirJson = original;
    if (antes === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = antes;
  }
});
