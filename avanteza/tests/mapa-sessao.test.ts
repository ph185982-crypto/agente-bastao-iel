// Isolamento e papéis SEM banco: sessão, escopo, middleware (caminhos) e autorização da rota de reuniões.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signSession, verifySessionFull, canAccess, canUseApp, isMapaPath, signViewToken, verifyViewToken, canPreviewClients, isClientSession,
} from "../src/lib/session";
import { scopeFromSession, assertScope, assertWritable } from "../src/lib/mapa/scope";
import { navFor } from "../src/lib/mapa/nav";
import { authorizeIngest } from "../src/lib/mapa/reunioes-api";

const SECRET = "s".repeat(40);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
process.env.ADMIN_EMAILS = "admin@avanteza.com.br";
process.env.SESSION_SECRET = SECRET;
process.env.CRON_SECRET = "cron-secret-de-teste-0123456789";

const clientTok = (ids: string[], email = "rodrigo@cliente.com") => signSession(email, SECRET, 3600, "client", { clientIds: ids });

test("sessão de cliente carrega a lista de empresas e nunca vira admin", async () => {
  const s = await verifySessionFull(await clientTok([A, B]), SECRET);
  assert.equal(s?.role, "client");
  assert.deepEqual(s?.clientIds, [A, B]);
  assert.equal(s?.clientId, A);
  assert.ok(isClientSession(s));
  assert.ok(canAccess(s));
  for (const app of ["marketplaces", "crm", "vendas", "contratos", "conteudo"]) assert.equal(canUseApp(s, app), false, app);
  assert.equal(canPreviewClients(s), false);
  // cliente sem empresa não existe
  await assert.rejects(signSession("x@y.com", SECRET, 3600, "client", {}));
});

test("papel desconhecido, 'client' sem empresa e token adulterado são recusados (sem escalar para admin)", async () => {
  const forge = async (body: object) => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const payload = enc(body);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
    return `${payload}.${sig}`;
  };
  const x = Math.floor(Date.now() / 1000) + 600;
  assert.equal(await verifySessionFull(await forge({ e: "a@b.c", x, r: "superuser" }), SECRET), null);
  assert.equal(await verifySessionFull(await forge({ e: "a@b.c", x, r: "client" }), SECRET), null);
  assert.equal(await verifySessionFull(await forge({ e: "a@b.c", x, r: "client", c: [] }), SECRET), null);
  assert.equal((await verifySessionFull(await forge({ e: "admin@avanteza.com.br", x }), SECRET))?.role, "admin"); // token antigo sem papel
  // trocar o papel no token sem a chave quebra a assinatura
  const tok = await clientTok([A]);
  const [p, sig] = tok.split(".");
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), r: "admin" })).toString("base64url");
  assert.equal(await verifySessionFull(`${evil}.${sig}`, SECRET), null);
  // adicionar uma empresa à lista também quebra
  const more = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), c: [A, B] })).toString("base64url");
  assert.equal(await verifySessionFull(`${more}.${sig}`, SECRET), null);
});

test("revisor, membro e cliente não escalam: nenhum deles é 'owner' do Mapa", async () => {
  for (const role of ["reviewer", "member"] as const) {
    const s = await verifySessionFull(await signSession(`${role}@avanteza.com.br`, SECRET, 3600, role, { apps: ["marketplaces"] }), SECRET);
    assert.notEqual(s?.role, "admin");
    // sem visualização assinada, não há escopo de cliente
    assert.equal(scopeFromSession(s, null), null);
  }
  // admin só aparece como admin se estiver em ADMIN_EMAILS
  const outsider = await verifySessionFull(await signSession("intruso@x.com", SECRET, 3600, "admin"), SECRET);
  assert.equal(canAccess(outsider), false);
});

test("escopo: cliente usa a lista da SESSÃO; seleção crua fora da lista cai na primeira empresa", async () => {
  const s = await verifySessionFull(await clientTok([A, B]), SECRET);
  assert.equal(scopeFromSession(s, null, B)?.clientId, B);
  assert.equal(scopeFromSession(s, null, C)?.clientId, A, "empresa de fora do grupo não é aceita");
  assert.equal(scopeFromSession(s, null, "' or 1=1 --")?.clientId, A);
  assert.equal(scopeFromSession(s, null, null)?.clientId, A);
  // visualização assinada é IGNORADA para cliente
  assert.equal(scopeFromSession(s, C)?.clientId, A);
  assert.deepEqual([...scopeFromSession(s, C)!.allowedClientIds], [A, B]);
  // a checagem em tempo real só pode REDUZIR a lista
  assert.deepEqual([...scopeFromSession(s, null, null, [B, C])!.allowedClientIds], [B]);
  assert.equal(scopeFromSession(s, null, null, [])?.clientId, undefined);
  assert.equal(scopeFromSession(s, null, null, [C]), null);
});

test("escopo: não pode ser forjado (só scopeFromSession emite) e a visualização é somente leitura", async () => {
  const forged = { clientId: A, allowedClientIds: [A], readOnly: false, userEmail: "x" };
  assert.throws(() => assertScope(forged as any), /inválido/);
  const staff = await verifySessionFull(await signSession("admin@avanteza.com.br", SECRET), SECRET);
  assert.equal(scopeFromSession(staff, null), null);
  assert.equal(scopeFromSession(staff, "não-é-uuid"), null);
  const view = scopeFromSession(staff, A)!;
  assert.equal(view.readOnly, true);
  assert.equal(view.previewBy, "admin@avanteza.com.br");
  assert.throws(() => assertWritable(view), /somente leitura/);
  assert.deepEqual([...view.allowedClientIds], [A]);
});

test("cookie 'Ver como cliente': ligado ao e-mail da equipe, ao cliente e ao prazo", async () => {
  const t = await signViewToken("admin@avanteza.com.br", A, SECRET);
  assert.equal(await verifyViewToken(t, "admin@avanteza.com.br", SECRET), A);
  assert.equal(await verifyViewToken(t, "outro@avanteza.com.br", SECRET), null, "token de outro usuário");
  assert.equal(await verifyViewToken(await signViewToken("admin@avanteza.com.br", A, SECRET, -5), "admin@avanteza.com.br", SECRET), null);
  const [p, sig] = t.split(".");
  const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), c: B })).toString("base64url");
  assert.equal(await verifyViewToken(`${swapped}.${sig}`, "admin@avanteza.com.br", SECRET), null);
  // o token de sessão NÃO serve como token de visualização (e vice-versa)
  assert.equal(await verifyViewToken(await signSession("admin@avanteza.com.br", SECRET), "admin@avanteza.com.br", SECRET), null);
  assert.equal(await verifySessionFull(t, SECRET), null);
});

test("middleware: cliente só enxerga /mapa; rotas admin ficam fora", () => {
  for (const ok of ["/mapa", "/mapa/plano", "/mapa/reunioes/abc"]) assert.ok(isMapaPath(ok), ok);
  for (const no of ["/", "/central", "/clientes", "/clientes/x", "/usuarios", "/configuracoes", "/aprovacoes", "/entregas", "/sso/authorize", "/api/cron/tick", "/mapas", "/mapa-x", "//mapa/x", "/api/mapa/reunioes"]) assert.ok(!isMapaPath(no), no);
});

test("menu por tipo: marketplace, mídia e ambos (união)", () => {
  const labels = (k: string) => navFor(k).map((i) => i.label);
  assert.deepEqual(labels("marketplace"), ["Início", "Plano", "Marketplaces", "Reuniões", "Arquivos", "Conta"]);
  assert.deepEqual(labels("midia"), ["Início", "Plano", "Canais", "Reuniões", "Arquivos", "Conta"]);
  assert.deepEqual(labels("ambos"), ["Início", "Plano", "Marketplaces", "Canais", "Reuniões", "Arquivos", "Conta"]);
});

test("POST /api/mapa/reunioes: só CRON_SECRET ou administrador (cliente, revisor e anônimo são recusados)", async () => {
  const req = (headers: Record<string, string>) => new Request("http://x/api/mapa/reunioes", { method: "POST", headers });
  assert.equal(await authorizeIngest(req({})), false);
  assert.equal(await authorizeIngest(req({ authorization: "Bearer errado" })), false);
  assert.equal(await authorizeIngest(req({ authorization: `Bearer ${process.env.CRON_SECRET}` })), true);
  const cookie = async (role: any, extra: any = {}, email = "u@x.com") => ({ cookie: `avz_session=${await signSession(email, SECRET, 3600, role, extra)}` });
  assert.equal(await authorizeIngest(req(await cookie("client", { clientIds: [A] }))), false);
  assert.equal(await authorizeIngest(req(await cookie("reviewer", {}, "r@avanteza.com.br"))), false);
  assert.equal(await authorizeIngest(req(await cookie("member", { apps: ["marketplaces"] }, "m@avanteza.com.br"))), false);
  assert.equal(await authorizeIngest(req(await cookie("admin", {}, "intruso@x.com"))), false);
  assert.equal(await authorizeIngest(req(await cookie("admin", {}, "admin@avanteza.com.br"))), true);
  // cliente com cookie E bearer errado continua recusado
  assert.equal(await authorizeIngest(req({ ...(await cookie("admin", {}, "admin@avanteza.com.br")), authorization: "Bearer errado" })), false);
});
