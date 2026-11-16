// Motor de Entregas com Postgres local descartável (TEST_DATABASE_URL): semente, aplicação idempotente dos playbooks,
// ações rápidas, isolamento do Mapa (cliente não vê rotinas internas nem age em ação alheia), capturas e rotina diária.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import * as motor from "../src/lib/motor/repo";
import { ingestCaptura, hashCaptura } from "../src/lib/motor/capturas";
import { handleCaptura, chaveConfere } from "../src/lib/motor/capturas-api";
import { rotinaEntregas } from "../src/lib/motor/rotina";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession, type ClientScope } from "../src/lib/mapa/scope";
import * as mapa from "../src/lib/mapa/repo";
import type { AiProvider } from "../src/lib/ai/provider";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const SECRET = "s".repeat(40);
process.env.SESSION_SECRET = SECRET;
process.env.ADMIN_EMAILS = "admin@avanteza.com.br";
const HOJE = "2026-11-16";

class FakeAi implements AiProvider {
  readonly name = "falso";
  calls = 0;
  ctx = "";
  constructor(private out: unknown, private on = true) {}
  enabled() { return this.on; }
  async analyze(): Promise<any> { throw new Error("não usado"); }
  async extract<T>(_s: string, ctx: string, _schema: ZodType<T>) {
    this.calls++; this.ctx = ctx;
    return { output: this.out as T, provider: "falso", model: "falso-1", usage: {} };
  }
}
const ACOES = { resumo: "Combinados de ADS", acoes: [
  { titulo: "Enviar fotos novas da coleção", descricao: null, responsavel: "cliente", prazo: "2026-11-20" },
  { titulo: "Subir campanha da Black Friday", descricao: "Verba +20%", responsavel: "avanteza", prazo: null },
  { titulo: "Subir campanha da Black Friday", descricao: null, responsavel: "avanteza", prazo: null },
] };

let mkt = "", midia = "", outro = "", pedroId = "", anaId = "";
const count = async (sql: string, p: unknown[] = []) => Number((await rawQuery<{ n: number }>(sql, p))[0].n);
async function scopeOf(email: string, ids: string[], readOnly = false): Promise<ClientScope> {
  const sess = await verifySessionFull(await signSession(email, SECRET, 3600, "client", { clientIds: ids }), SECRET);
  if (readOnly) {
    const staff = await verifySessionFull(await signSession("admin@avanteza.com.br", SECRET, 3600, "admin"), SECRET);
    return scopeFromSession(staff, ids[0])!;
  }
  return scopeFromSession(sess, null, null, await mapa.liveAllowedCompanies(email))!;
}

before(async () => {
  if (skip) return;
  await resetSchema();
  mkt = await mkClient("Loja Marketplace", { slug: "loja", kind: "marketplace", start: null as any });
  midia = await mkClient("Barbearia Mídia", { slug: "barbearia", kind: "midia", start: "2026-11-02" });
  outro = await mkClient("Outra Empresa", { slug: "outra", kind: "marketplace", start: "2026-11-02" });
  await rawQuery("update avanteza.clients set start_date = null where id = $1", [mkt]);
  await rawQuery("insert into avanteza.admins (email, role, name, delivery_roles) values ('admin@avanteza.com.br','admin','Pedro',$1), ('ana@avanteza.com.br','member','Ana',$2)", [["gestor_conta"], ["marketplace"]]);
  pedroId = (await rawQuery<{ id: string }>("select id from avanteza.admins where email = 'admin@avanteza.com.br'"))[0].id;
  anaId = (await rawQuery<{ id: string }>("select id from avanteza.admins where email = 'ana@avanteza.com.br'"))[0].id;
  await mkUser("loja@cliente.com", mkt);
  await mkUser("outra@cliente.com", outro);
});
after(async () => { if (!skip) await closeDb(); });

test("schema: novas tabelas e colunas, idempotente, recurrence_key única por cliente, origem aceita playbook/captura/ia", { skip }, async () => {
  const { readFileSync } = await import("node:fs");
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  for (const t of ["service_catalog", "playbooks", "playbook_tasks", "client_services", "delivery_runs", "capturas", "client_health"]) {
    assert.equal(await count("select count(*)::int n from information_schema.tables where table_schema = 'avanteza' and table_name = $1", [t]), 1, t);
  }
  await rawQuery("insert into avanteza.plan_actions (client_id, title, origin, recurrence_key) values ($1,'x','playbook','k1')", [outro]);
  await assert.rejects(rawQuery("insert into avanteza.plan_actions (client_id, title, origin, recurrence_key) values ($1,'x','playbook','k1')", [outro]));
  await rawQuery("insert into avanteza.plan_actions (client_id, title, origin, recurrence_key) values ($1,'x','captura','k1')", [mkt]); // outro cliente: pode
  await assert.rejects(rawQuery("insert into avanteza.plan_actions (client_id, title, origin) values ($1,'x','invalida')", [mkt]));
  await rawQuery("delete from avanteza.plan_actions");
  assert.equal(await count("select count(*)::int n from avanteza.admins where id is null"), 0, "toda a equipe tem id");
});

test("semente do catálogo: cria tudo na 1ª vez, nada na 2ª, e não desfaz a edição do admin", { skip }, async () => {
  const r1 = await motor.semearCatalogo();
  assert.equal(r1.servicos, 4);
  assert.ok(r1.tarefas >= 30, `tarefas: ${r1.tarefas}`);
  await rawQuery("update avanteza.playbook_tasks set title = 'Relatório da semana (editado)' where slug = 'relatorio-semanal'");
  const r2 = await motor.semearCatalogo();
  assert.deepEqual(r2, { servicos: 0, playbooks: 0, tarefas: 0 });
  assert.equal(await count("select count(*)::int n from avanteza.playbook_tasks where title = 'Relatório da semana (editado)'"), 1);
});

test("prévia não grava nada", { skip }, async () => {
  const antes = await count("select count(*)::int n from avanteza.plan_actions");
  const p = await motor.aplicarPlaybooks(mkt, { hoje: HOJE, actor: "teste", previa: true });
  assert.ok(p.plano.criar.length > 10);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions"), antes);
  assert.equal(await count("select count(*)::int n from avanteza.client_services"), 0);
});

test("aplicar playbooks: cria serviços pelo tipo, o plano de 12 meses e as ações nas fases; 2ª vez não duplica nada", { skip }, async () => {
  const r1 = await motor.aplicarPlaybooks(mkt, { hoje: HOJE, actor: "teste" });
  assert.equal(r1.servicosCriados, 2, "marketplace → Onboarding + Marketplace");
  assert.equal(r1.planoCriado, true);
  const svcs = (await motor.servicosDoCliente(mkt)).map((s) => s.service_slug).sort();
  assert.deepEqual(svcs, ["marketplace", "onboarding"]);
  assert.equal(await count("select count(*)::int n from avanteza.plan_phases where client_id = $1", [mkt]), 4);
  const total1 = await count("select count(*)::int n from avanteza.plan_actions where client_id = $1", [mkt]);
  const geradas = await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and origin = 'playbook'", [mkt]);
  assert.ok(geradas > 15, `geradas: ${geradas}`);
  // a tarefa "kickoff" foi vinculada à ação do plano de 12 meses, não duplicada
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and title = 'Reunião de kickoff e alinhamento de metas'", [mkt]), 1);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and title = 'Reunião de kickoff e alinhamento de metas' and recurrence_key is not null", [mkt]), 1);
  // fases certas e responsáveis pelo papel
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and origin = 'playbook' and phase_id is null", [mkt]), 0);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and role = 'marketplace' and assignee_id = $2", [mkt, anaId]) > 0, true);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and role = 'gestor_conta' and origin = 'playbook' and assignee_id = $2", [mkt, pedroId]) > 0, true);
  // tarefas internas não ficam visíveis ao cliente
  assert.ok(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1 and not visible_to_client", [mkt]) > 0);

  const r2 = await motor.aplicarPlaybooks(mkt, { hoje: HOJE, actor: "teste" });
  assert.equal(r2.gravado!.criadas + r2.gravado!.vinculadas + r2.gravado!.atualizadas + r2.gravado!.arquivadas, 0);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1", [mkt]), total1);
  const todos = await motor.gerarParaTodos(HOJE);
  assert.equal(todos.criadas, 0, "rotina depois da aplicação também não duplica");
  assert.equal(await count("select count(*)::int n from avanteza.delivery_runs where client_id = $1", [mkt]), 1);
});

test("mídia: Tráfego + Mídias + Onboarding; dia seguinte só acrescenta recorrências novas", { skip }, async () => {
  await motor.aplicarPlaybooks(midia, { hoje: HOJE, actor: "teste" });
  assert.deepEqual((await motor.servicosDoCliente(midia)).map((s) => s.service_slug).sort(), ["midias-sociais", "onboarding", "trafego"]);
  const antes = await count("select count(*)::int n from avanteza.plan_actions where client_id = $1", [midia]);
  const r = await motor.aplicarPlaybooks(midia, { hoje: "2026-11-17", actor: "teste" });
  const depois = await count("select count(*)::int n from avanteza.plan_actions where client_id = $1", [midia]);
  assert.equal(depois - antes, r.gravado!.criadas);
  assert.ok(r.gravado!.criadas <= 3, `um dia a mais cria poucas: ${r.gravado!.criadas}`);
});

test("ações rápidas: concluir com evidência, bloquear exige motivo, adiar protege da regeneração, reatribuir só para a equipe", { skip }, async () => {
  const [a, b, c] = await rawQuery<{ id: string; due_date: string }>("select id, due_date from avanteza.plan_actions where client_id = $1 and origin = 'playbook' and status = 'planejada' order by due_date limit 3", [mkt]);
  assert.deepEqual(await motor.acaoRapida("ana@avanteza.com.br", a.id, { tipo: "concluir", evidencia: "javascript:alert(1)" }), { ok: false, erro: "Evidência: use um link http(s)." });
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", a.id, { tipo: "concluir", evidencia: "https://drive.google.com/x" })).ok, true);
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", b.id, { tipo: "bloquear", motivo: "" })).ok, false);
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", b.id, { tipo: "bloquear", motivo: "Esperando o acesso ao Mercado Livre" })).ok, true);
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", c.id, { tipo: "adiar", para: "2026-12-31" })).ok, true);
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", c.id, { tipo: "reatribuir", para: "00000000-0000-0000-0000-000000000000" })).ok, false);
  const [cli] = await rawQuery<{ id: string }>("select id from avanteza.admins where role = 'client' limit 1");
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", c.id, { tipo: "reatribuir", para: cli.id })).ok, false, "cliente nunca vira responsável");
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", c.id, { tipo: "reatribuir", para: pedroId })).ok, true);
  assert.equal((await motor.acaoRapida("ana@avanteza.com.br", c.id, { tipo: "desfazer_ia" })).ok, false, "só IA pode ser desfeita");
  await motor.aplicarPlaybooks(mkt, { hoje: HOJE, actor: "teste" });
  const [rc] = await rawQuery<any>("select due_date, sla_due, assignee_id, edited_at from avanteza.plan_actions where id = $1", [c.id]);
  assert.equal(rc.due_date, "2026-12-31", "regeneração não desfaz o adiamento");
  assert.equal(rc.sla_due, c.due_date, "SLA original preservado");
  assert.equal(rc.assignee_id, pedroId);
  const [rb] = await rawQuery<any>("select status, blocked_reason, client_dependent from avanteza.plan_actions where id = $1", [b.id]);
  assert.deepEqual(rb, { status: "bloqueada", blocked_reason: "Esperando o acesso ao Mercado Livre", client_dependent: true });
  assert.ok(await count("select count(*)::int n from avanteza.audit_log where event like 'motor_%'") >= 4);
});

test("Mapa: cliente vê só as ações visíveis do próprio plano; rotinas internas e dispensadas ficam de fora", { skip }, async () => {
  const s = await scopeOf("loja@cliente.com", [mkt]);
  const lista = await mapa.listActions(s);
  const internas = await rawQuery<{ id: string; title: string }>("select id, title from avanteza.plan_actions where client_id = $1 and not visible_to_client", [mkt]);
  assert.ok(internas.length > 0);
  for (const i of internas) {
    assert.ok(!lista.some((a) => a.id === i.id), `interna vazou: ${i.title}`);
    assert.equal(await mapa.getAction(s, i.id), null);
  }
  const [vis] = await rawQuery<{ id: string }>("select id from avanteza.plan_actions where client_id = $1 and visible_to_client and status = 'planejada' and owner = 'avanteza' limit 1", [mkt]);
  await motor.acaoRapida("admin@avanteza.com.br", vis.id, { tipo: "dispensar" });
  assert.ok(!(await mapa.listActions(s)).some((a) => a.id === vis.id), "dispensada some do Mapa");
  assert.ok(!JSON.stringify(lista).includes("assignee"), "responsável interno não sai para o cliente");
});

test("Mapa: 'feito' do cliente só nas pendências dele (IDOR entre clientes, ação da Avanteza, visualização somente leitura)", { skip }, async () => {
  const s = await scopeOf("loja@cliente.com", [mkt]);
  const [minha] = await rawQuery<{ id: string }>("select id from avanteza.plan_actions where client_id = $1 and owner = 'cliente' and visible_to_client and status <> 'concluida' limit 1", [mkt]);
  const [daAvz] = await rawQuery<{ id: string }>("select id from avanteza.plan_actions where client_id = $1 and owner = 'avanteza' and status = 'planejada' and visible_to_client limit 1", [mkt]);
  const [bloq] = await rawQuery<{ id: string }>("select id from avanteza.plan_actions where client_id = $1 and owner = 'avanteza' and status = 'planejada' and visible_to_client and id <> $2 limit 1", [mkt, daAvz.id]);
  await motor.acaoRapida("ana@avanteza.com.br", bloq.id, { tipo: "bloquear", motivo: "Falta a planilha de custos" });
  await motor.aplicarPlaybooks(outro, { hoje: HOJE, actor: "teste" });
  const [alheia] = await rawQuery<{ id: string }>("select id from avanteza.plan_actions where client_id = $1 and owner = 'cliente' and status <> 'concluida' limit 1", [outro]);

  assert.equal(await mapa.resolverPendencia(s, alheia.id, null), false, "IDOR: ação de outro cliente");
  assert.equal((await rawQuery<any>("select status from avanteza.plan_actions where id = $1", [alheia.id]))[0].status, "planejada");
  assert.equal(await mapa.resolverPendencia(s, daAvz.id, null), false, "ação da Avanteza que não espera o cliente");
  assert.equal(await mapa.resolverPendencia(s, minha.id, "ftp://x"), false, "link inválido");
  assert.equal(await mapa.resolverPendencia(s, "1 or 1=1", null), false);
  assert.equal(await mapa.resolverPendencia(s, minha.id, "https://drive.google.com/planilha"), true);
  assert.deepEqual((await rawQuery<any>("select status, evidence_url from avanteza.plan_actions where id = $1", [minha.id]))[0], { status: "concluida", evidence_url: "https://drive.google.com/planilha" });
  // bloqueada esperando o cliente → volta para a fila da equipe
  assert.equal(await mapa.resolverPendencia(s, bloq.id, null), true);
  assert.deepEqual((await rawQuery<any>("select status, blocked_reason from avanteza.plan_actions where id = $1", [bloq.id]))[0], { status: "planejada", blocked_reason: null });
  // visualização da equipe ("Ver como cliente") nunca escreve
  const ro = await scopeOf("loja@cliente.com", [mkt], true);
  await assert.rejects(mapa.resolverPendencia(ro, minha.id, null), /somente leitura/);
  // escopo forjado (não emitido pela sessão) é recusado
  await assert.rejects(mapa.resolverPendencia({ clientId: mkt, allowedClientIds: [mkt], readOnly: false, userEmail: "x" } as ClientScope, minha.id, null), /Escopo/);
});

test("capturas: IA falsa cria ações direto (selo IA, sem duplicar título); reenvio não duplica; sem chave fica sem_ia", { skip }, async () => {
  const ai = new FakeAi(ACOES);
  const r = await ingestCaptura({ origem: "whatsapp_max", clientId: mkt, autor: "Pedro", texto: "Combinamos: vocês mandam as fotos até sexta e a gente sobe a campanha." }, { provider: ai, hoje: HOJE });
  assert.equal(r.status, "processada");
  assert.equal(r.acoesCriadas, 2);
  assert.match(ai.ctx, /<conversa>/);
  const rows = await rawQuery<any>("select title, owner, due_date, origin, ai_generated, captura_id, client_dependent from avanteza.plan_actions where captura_id = $1 order by title", [r.capturaId]);
  assert.deepEqual(rows.map((x) => [x.title, x.owner, x.due_date, x.origin, x.ai_generated]), [
    ["Enviar fotos novas da coleção", "cliente", "2026-11-20", "captura", true],
    ["Subir campanha da Black Friday", "avanteza", "2026-11-19", "captura", true],
  ]);
  const dup = await ingestCaptura({ origem: "whatsapp_max", clientId: mkt, autor: " pedro ", texto: "Combinamos:  vocês mandam as fotos até sexta e a gente sobe a campanha." }, { provider: ai, hoje: HOJE });
  assert.equal(dup.duplicada, true);
  assert.equal(ai.calls, 1);
  const off = await ingestCaptura({ origem: "manual", clientId: mkt, texto: "Lembrar de revisar preços" }, { provider: new FakeAi(ACOES, false), hoje: HOJE });
  assert.equal(off.status, "sem_ia");
  // desfazer a ação da IA tira da captura também
  const [ia] = await rawQuery<{ id: string }>("select id from avanteza.plan_actions where captura_id = $1 limit 1", [r.capturaId]);
  assert.equal((await motor.acaoRapida("admin@avanteza.com.br", ia.id, { tipo: "desfazer_ia" })).ok, true);
  assert.equal((await rawQuery<any>("select array_length(acoes_geradas, 1) n from avanteza.capturas where id = $1", [r.capturaId]))[0].n, 1);
  assert.notEqual(hashCaptura({ clientId: mkt, origem: "manual", texto: "a" }), hashCaptura({ clientId: outro, origem: "manual", texto: "a" }));
  await assert.rejects(ingestCaptura({ origem: "manual", clientId: mkt, texto: "  " } as any, { provider: ai }));
});

test("API /api/capturas: 503 sem chave, 401 chave errada, 415, 400, 404, 409 ambíguo, 201 criada, 200 duplicada", { skip }, async () => {
  const req = (body: unknown, auth?: string, ct = "application/json") =>
    new Request("http://x/api/capturas", { method: "POST", headers: { "content-type": ct, ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const ok = { clienteSlug: "barbearia", origem: "whatsapp_max", autor: "Max", texto: "Cliente pediu para pausar a campanha de domingo." };
  delete process.env.AVANTEZA_CAPTURE_KEY;
  assert.equal((await handleCaptura(req(ok, "x"))).status, 503);
  process.env.AVANTEZA_CAPTURE_KEY = "chave-de-captura-de-teste-0123456789";
  assert.equal((await handleCaptura(req(ok))).status, 401);
  assert.equal((await handleCaptura(req(ok, "chave-errada"))).status, 401);
  assert.equal((await handleCaptura(req(ok, "chave-de-captura-de-teste-012345678"))).status, 401, "prefixo da chave não passa");
  const K = process.env.AVANTEZA_CAPTURE_KEY;
  assert.equal((await handleCaptura(req(ok, K, "text/plain"))).status, 415);
  assert.equal((await handleCaptura(req("{x", K))).status, 400);
  assert.equal((await handleCaptura(req({ ...ok, origem: "sms" }, K))).status, 400);
  assert.equal((await handleCaptura(req({ origem: "manual", texto: "x" }, K))).status, 400, "sem cliente");
  assert.equal((await handleCaptura(req({ ...ok, clienteSlug: "nao-existe" }, K))).status, 404);
  await mkClient("Barbearia Centro", { slug: "barb-centro", kind: "midia" });
  const amb = await handleCaptura(req({ origem: "manual", clienteNome: "barbearia", texto: "x" }, K));
  assert.equal(amb.status, 409);
  assert.deepEqual((await amb.json()).candidatos.sort(), ["Barbearia Centro", "Barbearia Mídia"]);
  const ai = new FakeAi({ resumo: null, acoes: [{ titulo: "Pausar a campanha de domingo", descricao: null, responsavel: "avanteza", prazo: null }] });
  const r = await handleCaptura(req({ ...ok, clienteNome: "barbearia midia", clienteSlug: undefined }, K), { provider: ai, hoje: HOJE });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.acoesCriadas, 1);
  assert.equal((await handleCaptura(req({ ...ok, clienteNome: "barbearia midia", clienteSlug: undefined }, K), { provider: ai, hoje: HOJE })).status, 200);
  assert.equal(chaveConfere("abc", "abc"), true);
  assert.equal(chaveConfere("abd", "abc"), false);
});

test("carteira: semáforo com motivos a partir das ações, reuniões e canais; rotina gera, grava saúde e manda e-mails", { skip }, async () => {
  await rawQuery("insert into avanteza.client_channels (client_id, status, last_error) values ($1,'desconectado','token expirado')", [midia]);
  const cart = await motor.carteira(HOJE);
  const m = cart.find((c) => c.id === midia)!;
  assert.equal(m.saude.nivel, "vermelho");
  assert.ok(m.saude.motivos.some((x) => /desconectado/.test(x)));
  assert.ok(m.servicos.includes("Tráfego pago"));

  const enviados: { to: string; subject: string; html: string }[] = [];
  const r = await rotinaEntregas("2026-11-25", { enviar: async (to, subject, html) => { enviados.push({ to, subject, html }); return true; } });
  assert.equal(r.geracao.erros.length, 0);
  assert.ok(r.geracao.criadas > 0, "nova janela traz recorrências novas");
  assert.equal(r.saude.vermelho >= 1, true);
  assert.ok(enviados.some((e) => e.to === "ana@avanteza.com.br" && /atrasada/.test(e.subject)), "resumo matinal da Ana");
  assert.ok(enviados.every((e) => !/<script/i.test(e.html)));
  assert.equal(await count("select count(*)::int n from avanteza.client_health where day = '2026-11-25'"), cart.length);
  // de novo no mesmo dia: não duplica ações nem saúde
  const r2 = await rotinaEntregas("2026-11-25", { enviar: async () => false });
  assert.equal(r2.geracao.criadas, 0);
  assert.equal(r2.emails.semConfiguracao, true, "sem e-mail configurado: registra e segue");
  assert.equal(await count("select count(*)::int n from avanteza.client_health where day = '2026-11-25'"), cart.length);
});
