// Testes do Mapa com Postgres local descartável (TEST_DATABASE_URL). Sem a variável, são ignorados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser, mkData } from "./_mapa-fixtures";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession, type ClientScope } from "../src/lib/mapa/scope";
import * as repo from "../src/lib/mapa/repo";
import { adminDb } from "../src/lib/db";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const SECRET = "s".repeat(40);
process.env.SESSION_SECRET = SECRET;
process.env.ADMIN_EMAILS = "admin@avanteza.com.br";

let nicoletti = "", vulk = "", lumiere = "", plenitude = "", showman = "";
let dN: Awaited<ReturnType<typeof mkData>>, dV: typeof dN, dL: typeof dN, dP: typeof dN, dS: typeof dN;

async function scopeOf(email: string, ids: string[], selected?: string): Promise<ClientScope> {
  const sess = await verifySessionFull(await signSession(email, SECRET, 3600, "client", { clientIds: ids }), SECRET);
  const live = await repo.liveAllowedCompanies(email);
  return scopeFromSession(sess, null, selected ?? null, live)!;
}

before(async () => {
  if (skip) return;
  await resetSchema();
  nicoletti = await mkClient("Nicoletti Professional", { slug: "nicoletti" });
  vulk = await mkClient("Vulk Jeans", { slug: "vulk", group: "rodrigo" });
  lumiere = await mkClient("Lumiere", { slug: "lumiere", group: "rodrigo" });
  plenitude = await mkClient("Plenitude", { slug: "plenitude", group: "rodrigo" });
  showman = await mkClient("Showman", { slug: "showman", kind: "midia" });
  dN = await mkData(nicoletti, "NICO"); dV = await mkData(vulk, "VULK"); dL = await mkData(lumiere, "LUMI"); dP = await mkData(plenitude, "PLEN"); dS = await mkData(showman, "SHOW");
  await mkUser("nico@cliente.com", nicoletti);
  await mkUser("rodrigo@cliente.com", vulk, { extra: [lumiere, plenitude] });
  await mkUser("show@cliente.com", showman);
});
after(async () => { if (!skip) await closeDb(); });

test("schema: idempotente (aplicar 2x não falha) e papel client exige client_id", { skip }, async () => {
  const { readFileSync } = await import("node:fs");
  const { rawQuery } = await import("../src/lib/db/client");
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await assert.rejects(rawQuery("insert into avanteza.admins (email, role) values ('a@a.com','client')"));
  await assert.rejects(rawQuery("insert into avanteza.admins (email, role, client_id) values ('b@a.com','admin',$1)", [nicoletti]));
  await assert.rejects(rawQuery("insert into avanteza.plan_actions (client_id, title, status) values ($1,'x','invalida')", [nicoletti]));
});

test("isolamento: cliente A não lê NADA do cliente B (plano, ações, reuniões, arquivos, marketplaces, alertas)", { skip }, async () => {
  const s = await scopeOf("nico@cliente.com", [nicoletti]);
  assert.equal((await repo.getClient(s))?.name, "Nicoletti Professional");
  assert.deepEqual((await repo.listPhases(s)).map((p) => p.name), ["Fase NICO"]);
  assert.deepEqual((await repo.listActions(s)).map((a) => a.title).sort(), ["Ação Avanteza NICO", "Ação NICO"]);
  assert.deepEqual((await repo.listMeetings(s)).map((m) => m.title), ["Reunião NICO"]);
  assert.deepEqual((await repo.listFiles(s)).map((f) => f.title), ["Arquivo NICO"]);
  const m = await repo.marketplaceData(s, "2020-01-01");
  assert.deepEqual(m.accounts.map((a) => a.nickname), ["Loja NICO"]);
  assert.deepEqual(m.listings.map((l) => l.title), ["Anúncio NICO"]);
  assert.deepEqual(m.alerts.map((a) => a.title), ["Alerta NICO"]);
  assert.equal(m.snapshots.length, 1);
  // nada de outro cliente vaza em nenhuma resposta
  const all = JSON.stringify([await repo.listPhases(s), await repo.listActions(s), await repo.listMeetings(s), await repo.listFiles(s), m]);
  for (const t of ["VULK", "LUMI", "PLEN", "SHOW"]) assert.ok(!all.includes(t), `vazou ${t}`);
});

test("IDOR: ids de outro cliente (ação, reunião, arquivo, fase) retornam vazio; ids malformados não quebram", { skip }, async () => {
  const s = await scopeOf("nico@cliente.com", [nicoletti]);
  assert.equal(await repo.getAction(s, dV.action), null);
  assert.equal(await repo.getAction(s, dN.action).then((a) => a?.title), "Ação NICO");
  assert.equal(await repo.getMeeting(s, dV.meeting), null);
  assert.equal((await repo.getMeeting(s, dN.meeting))?.meeting.title, "Reunião NICO");
  assert.deepEqual(await repo.listActions(s, { phaseId: dV.phase }), []);
  assert.deepEqual(await repo.listActions(s, { phaseId: "x' or '1'='1" }), []);
  assert.equal(await repo.getAction(s, "1 or 1=1"), null);
  assert.equal(await repo.getMeeting(s, "../../etc/passwd"), null);
  // ações da reunião do outro cliente nunca aparecem, nem pelo id da reunião
  assert.equal((await repo.getMeeting(s, dN.meeting))!.actions.every((a) => a.title.includes("NICO")), true);
});

test("IDOR em escrita: cliente não altera ação de outro cliente nem ação da Avanteza do próprio cliente", { skip }, async () => {
  const s = await scopeOf("nico@cliente.com", [nicoletti]);
  assert.equal(await repo.updateOwnActionStatus(s, dV.action, "concluida"), false);
  assert.equal(await repo.updateOwnActionStatus(s, dN.action2, "concluida"), false, "ação da Avanteza não é do cliente");
  const { data: untouched } = await adminDb().from("plan_actions").select("status").in("id", [dV.action, dN.action2]);
  assert.ok((untouched ?? []).every((a: any) => a.status === "planejada"));
  assert.equal(await repo.updateOwnActionStatus(s, dN.action, "concluida"), true);
  assert.equal(await repo.updateOwnActionStatus(s, dN.action, "bloqueada" as any), false, "cliente não bloqueia");
  assert.equal((await repo.getAction(s, dN.action))?.status, "concluida");
});

test("visualização da equipe é somente leitura: escrita lança erro e não altera o banco", { skip }, async () => {
  const staff = await verifySessionFull(await signSession("admin@avanteza.com.br", SECRET), SECRET);
  const view = scopeFromSession(staff, nicoletti)!;
  assert.equal((await repo.getClient(view))?.name, "Nicoletti Professional");
  await assert.rejects(repo.updateOwnActionStatus(view, dN.action, "planejada"), /somente leitura/);
  await assert.rejects(repo.changeOwnPassword(view, "x", "uma-senha-longa-123"), /somente leitura/);
});

test("não vaza segredos: sem tokens de conta, transcrição, notas, instruções de IA nem arquivos ocultos", { skip }, async () => {
  const s = await scopeOf("nico@cliente.com", [nicoletti]);
  await adminDb().from("clients").update({ notes: "NOTA-INTERNA", ai_instructions: "INSTRUCAO-IA" }).eq("id", nicoletti);
  const dump = JSON.stringify([await repo.getClient(s), await repo.marketplaceData(s, "2020-01-01"), await repo.listMeetings(s), await repo.getMeeting(s, dN.meeting), await repo.listFiles(s)]);
  for (const t of ["TOKEN-SECRETO", "REFRESH-SECRETO", "SEGREDO-TRANSCRICAO", "NOTA-INTERNA", "INSTRUCAO-IA", "Oculto", "password"]) assert.ok(!dump.includes(t), `vazou ${t}`);
});

test("grupo: Rodrigo vê Vulk, Lumiere e Plenitude, e NUNCA Nicoletti nem Showman", { skip }, async () => {
  const ids = [vulk, lumiere, plenitude];
  const s = await scopeOf("rodrigo@cliente.com", ids);
  assert.equal(s.clientId, vulk);
  assert.deepEqual((await repo.listCompanies(s)).map((c) => c.name), ["Lumiere", "Plenitude", "Vulk Jeans"]);
  for (const [alvo, tag] of [[lumiere, "LUMI"], [plenitude, "PLEN"], [vulk, "VULK"]] as const) {
    const sc = await scopeOf("rodrigo@cliente.com", ids, alvo);
    assert.equal(sc.clientId, alvo);
    assert.deepEqual((await repo.listActions(sc)).map((a) => a.title).sort(), [`Ação Avanteza ${tag}`, `Ação ${tag}`]);
    const dump = JSON.stringify([await repo.listMeetings(sc), await repo.listFiles(sc), await repo.marketplaceData(sc, "2020-01-01")]);
    assert.ok(!dump.includes("NICO") && !dump.includes("SHOW"));
  }
  // seleção de empresa fora do grupo (cookie cru) é ignorada
  for (const fora of [nicoletti, showman, "x"]) assert.equal((await scopeOf("rodrigo@cliente.com", ids, fora)).clientId, vulk);
  // IDOR: com a empresa ativa Vulk, ids de Nicoletti e Showman continuam invisíveis
  const sv = await scopeOf("rodrigo@cliente.com", ids, vulk);
  assert.equal(await repo.getAction(sv, dN.action), null);
  assert.equal(await repo.getMeeting(sv, dS.meeting), null);
  assert.equal(await repo.getAction(sv, dL.action).then((a) => a), null, "mesmo grupo, empresa não ativa: só aparece ao trocar a empresa ativa");
  assert.equal(await repo.updateOwnActionStatus(sv, dN.action, "concluida"), false);
  assert.equal(await repo.updateOwnActionStatus(sv, dL.action, "concluida"), false);
});

test("grupo: visão consolidada soma só as empresas do grupo", { skip }, async () => {
  const s = await scopeOf("rodrigo@cliente.com", [vulk, lumiere, plenitude]);
  const g = await repo.groupOverview(s, "2020-01-01");
  assert.deepEqual(g.map((x) => x.company.name).sort(), ["Lumiere", "Plenitude", "Vulk Jeans"]);
  assert.equal(g.reduce((t, x) => t + x.snapshots.length, 0), 3);
  assert.ok(!JSON.stringify(g).includes("Nicoletti"));
  // cliente de empresa única: lista de uma só (sem seletor)
  const n = await scopeOf("nico@cliente.com", [nicoletti]);
  assert.equal((await repo.listCompanies(n)).length, 1);
  assert.equal((await repo.groupOverview(n, "2020-01-01")).length, 1);
});

test("grupo: sessão antiga com empresa que perdeu o vínculo não a enxerga (checagem em tempo real)", { skip }, async () => {
  const { setCompanyLink } = await import("../src/lib/mapa/admin");
  await setCompanyLink("rodrigo@cliente.com", plenitude, false);
  const s = await scopeOf("rodrigo@cliente.com", [vulk, lumiere, plenitude], plenitude);
  assert.equal(s.clientId, vulk, "Plenitude foi retirada: a seleção cai na primeira");
  assert.ok(!s.allowedClientIds.includes(plenitude));
  await setCompanyLink("rodrigo@cliente.com", plenitude, true);
  // a empresa principal não sai
  await setCompanyLink("rodrigo@cliente.com", vulk, false);
  assert.ok((await scopeOf("rodrigo@cliente.com", [vulk])).allowedClientIds.includes(vulk));
  // desativar a empresa tira o acesso
  await adminDb().from("clients").update({ active: false }).eq("id", lumiere);
  assert.ok(!(await scopeOf("rodrigo@cliente.com", [vulk, lumiere, plenitude])).allowedClientIds.includes(lumiere));
  await adminDb().from("clients").update({ active: true }).eq("id", lumiere);
});

test("login de cliente: lista de empresas na sessão; usuário/cliente desativado não entra; senha errada não entra", { skip }, async () => {
  const { checkLogin } = await import("../src/lib/login");
  const ok = await checkLogin("Rodrigo@Cliente.com", "senha-de-teste-123", "1.1.1.1");
  assert.equal(ok.ok, true);
  assert.equal(ok.role, "client");
  assert.deepEqual([...ok.clientIds!].sort(), [vulk, lumiere, plenitude].sort());
  assert.equal(ok.clientId, vulk);
  assert.equal((await checkLogin("rodrigo@cliente.com", "errada", "1.1.1.2")).ok, false);
  await adminDb().from("admins").update({ active: false }).eq("email", "show@cliente.com");
  assert.equal((await checkLogin("show@cliente.com", "senha-de-teste-123", "1.1.1.3")).ok, false);
  await adminDb().from("admins").update({ active: true }).eq("email", "show@cliente.com");
  await adminDb().from("clients").update({ active: false }).eq("id", showman);
  assert.equal((await checkLogin("show@cliente.com", "senha-de-teste-123", "1.1.1.4")).ok, false, "cliente inativo");
  await adminDb().from("clients").update({ active: true }).eq("id", showman);
  assert.equal((await checkLogin("show@cliente.com", "senha-de-teste-123", "1.1.1.5")).ok, true);
  // desativado depois do login: o escopo some na hora
  await adminDb().from("admins").update({ active: false }).eq("email", "show@cliente.com");
  assert.deepEqual(await repo.liveAllowedCompanies("show@cliente.com"), []);
  await adminDb().from("admins").update({ active: true }).eq("email", "show@cliente.com");
});

test("senha: cliente troca a própria senha (atual correta, mínimo 10); não mexe em outro usuário", { skip }, async () => {
  const s = await scopeOf("nico@cliente.com", [nicoletti]);
  assert.equal((await repo.changeOwnPassword(s, "errada", "nova-senha-muito-boa")).ok, false);
  assert.equal((await repo.changeOwnPassword(s, "senha-de-teste-123", "curta")).ok, false);
  assert.equal((await repo.changeOwnPassword(s, "senha-de-teste-123", "nova-senha-muito-boa")).ok, true);
  const { checkLogin } = await import("../src/lib/login");
  assert.equal((await checkLogin("nico@cliente.com", "nova-senha-muito-boa", "2.2.2.2")).ok, true);
  assert.equal((await checkLogin("show@cliente.com", "senha-de-teste-123", "2.2.2.3")).ok, true, "outro usuário intacto");
});

test("acesso admin: cria usuário (senha só no retorno), não converte equipe, redefine só cliente, vincula o grupo", { skip }, async () => {
  const a = await import("../src/lib/mapa/admin");
  const r = await a.createClientUser(lumiere, "Novo@Cliente.com", "Novo", { includeGroup: true });
  assert.equal(r.email, "novo@cliente.com");
  assert.ok(r.password.length >= 16 && !/[0O1lI]/.test(r.password));
  const [row] = await (await import("../src/lib/db/client")).rawQuery<any>("select password_hash, role, client_id from avanteza.admins where email = $1", ["novo@cliente.com"]);
  assert.equal(row.role, "client"); assert.ok(row.password_hash.startsWith("$2")); assert.ok(!JSON.stringify(row).includes(r.password));
  const users = await a.listClientUsers(plenitude);
  assert.ok(users.some((u: any) => u.email === "novo@cliente.com"), "grupo vinculado");
  await assert.rejects(a.createClientUser(lumiere, "novo@cliente.com", null), /Já existe/);
  await adminDb().from("admins").insert({ email: "equipe@avanteza.com.br", role: "member", apps: [] });
  await assert.rejects(a.createClientUser(lumiere, "equipe@avanteza.com.br", null), /equipe/);
  await assert.rejects(a.resetClientUserPassword("equipe@avanteza.com.br"), /não encontrado/);
  await assert.rejects(a.resetClientUserPassword("admin@avanteza.com.br"), /não encontrado/);
  const r2 = await a.resetClientUserPassword("novo@cliente.com");
  assert.notEqual(r2.password, r.password);
  const { checkLogin } = await import("../src/lib/login");
  assert.equal((await checkLogin("novo@cliente.com", r.password, "3.3.3.1")).ok, false);
  assert.equal((await checkLogin("novo@cliente.com", r2.password, "3.3.3.2")).ok, true);
  const login = await checkLogin("novo@cliente.com", r2.password, "3.3.3.3");
  assert.equal(login.clientIds!.length, 3);
});

test("plano: 'Gerar plano' grava fases e ações, recusa duplicar e regenera preservando reunião/manual", { skip }, async () => {
  const { generatePlanFor } = await import("../src/lib/mapa/admin");
  const c = await mkClient("Plano Teste", { slug: "plano-teste", kind: "ambos", start: "2026-03-10" });
  const r = await generatePlanFor(c);
  assert.equal(r.phases, 4); assert.ok(r.actions > 20);
  await assert.rejects(generatePlanFor(c), /já tem plano/);
  await adminDb().from("plan_actions").insert({ client_id: c, title: "Manual", origin: "manual" });
  const r2 = await generatePlanFor(c, { regenerate: true });
  assert.equal(r2.actions, r.actions);
  const { data: acts } = await adminDb().from("plan_actions").select("origin").eq("client_id", c);
  assert.equal((acts ?? []).filter((a: any) => a.origin === "manual").length, 1);
  assert.equal((acts ?? []).length, r.actions + 1);
  const semInicio = await mkClient("Sem Início", { slug: "sem-inicio" });
  await adminDb().from("clients").update({ start_date: null }).eq("id", semInicio);
  await assert.rejects(generatePlanFor(semInicio), /data de início/);
});
