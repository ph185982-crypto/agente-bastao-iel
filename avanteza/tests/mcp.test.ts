// Conector do Claude (MCP em /api/mcp + OAuth em /api/oauth/*): descoberta, 503 sem AVANTEZA_MCP_SECRET, 401 com
// WWW-Authenticate, fluxo OAuth completo (registro → authorize com a sessão do dono → consentimento → código → token com PKCE
// → refresh), recusas (PKCE errado, redirect de fora, código vencido, membro/cliente, usuário desativado), tools/list e as
// ferramentas contra o banco de teste (auditoria com via "claude", validação de entrada, nada de segredo na saída).
// DB opcional: TEST_DATABASE_URL.
import "./_sem-timers-presos";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { ZodType } from "zod";
import { HAS_DB, resetSchema, closeDb, mkClient, mkData, mkUser } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import { signSession, verifySessionFull, type Session } from "../src/lib/session";
import { agora, assinar, redirectAceito, REDIRECTS_CLAUDE } from "../src/lib/mcp/oauth";
import { avaliarPedido } from "../src/lib/mcp/acesso";
import { reescritasMcp } from "../src/lib/mcp/reescritas";
import { ErroFerramenta, executarFerramenta, FERRAMENTAS, limpar, type Ator, type Deps } from "../src/lib/mcp/ferramentas";
import { criarProvedorFixture as financeiroFixture } from "../src/lib/financeiro/fixture";
import { criarProvedorFixture as entregasFixture } from "../src/lib/entregas/fixture";
import { notificar } from "../src/lib/notificacoes";
import type { AiProvider } from "../src/lib/ai/provider";
import type { ProvedorComercial } from "../src/lib/busca/comercial";
import * as authorize from "../src/app/api/oauth/authorize/route";
import * as register from "../src/app/api/oauth/register/route";
import * as token from "../src/app/api/oauth/token/route";
import * as recurso from "../src/app/api/oauth/metadata/recurso/route";
import * as servidor from "../src/app/api/oauth/metadata/servidor/route";
import * as mcp from "../src/app/api/mcp/route";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const SEGREDO = "segredo-do-conector-mcp-para-testes-123";
process.env.AVANTEZA_MCP_SECRET = SEGREDO;
process.env.SESSION_SECRET = "s".repeat(40);
process.env.ADMIN_EMAILS = "dono@avanteza.com.br,ex@avanteza.com.br";
const BASE = "https://app.avanteza.com.br";
const CALLBACK = REDIRECTS_CLAUDE[0];
const DONO = "dono@avanteza.com.br";
const HOJE = "2026-02-01";

const req = (path: string, init?: RequestInit) => new Request(BASE + path, init);
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const cookie = async (email: string, role: Session["role"] = "admin", extra: Parameters<typeof signSession>[4] = {}) =>
  `outro=1; avz_session=${await signSession(email, undefined, 3600, role, extra)}`;

async function registrar(uris: unknown[] = [CALLBACK]) {
  return register.POST(req("/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: uris, client_name: "Claude" }) }));
}
function paramsAut(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "estado-xyz", ...extra });
}
async function consentir(params: URLSearchParams, ck: string, decisao = "permitir", form?: string) {
  const sess = await verifySessionFull(ck.split("avz_session=")[1]);
  const a = await avaliarPedido((k) => params.get(k), sess);
  const fd = new FormData();
  for (const [k, v] of params) fd.set(k, v);
  fd.set("form", form ?? (a.tipo === "consentir" ? a.form : "x"));
  fd.set("decisao", decisao);
  return { a, res: await authorize.POST(req("/api/oauth/authorize", { method: "POST", headers: { cookie: ck }, body: fd })) };
}
async function trocar(body: Record<string, string>) {
  return token.POST(req("/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
}
/** Chama o /api/mcp (JSON-RPC) e devolve a resposta (JSON ou o primeiro evento SSE). */
async function rpc(bearer: string | null, method: string, params: Record<string, unknown> = {}) {
  const res = await mcp.POST(req("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const txt = await res.text();
  const corpo = txt.startsWith("{") ? JSON.parse(txt) : JSON.parse(txt.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return { status: res.status, corpo, res };
}
async function fluxoCompleto(email = DONO) {
  const cid = (await (await registrar()).json()).client_id as string;
  const { verifier, challenge } = pkce();
  const params = paramsAut(cid, challenge);
  const { res } = await consentir(params, await cookie(email));
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const tk = await (await trocar({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: cid })).json();
  return { cid, tk };
}

// ─── Sem banco ───────────────────────────────────────────────────────────────

test("metadados: recurso e servidor apontam para a origem pública; reescritas /.well-known", async () => {
  const r = await (await recurso.GET(req("/.well-known/oauth-protected-resource/api/mcp", { headers: { "x-forwarded-host": "app.avanteza.com.br", "x-forwarded-proto": "https" } }))).json();
  assert.deepEqual(r.resource, `${BASE}/api/mcp`);
  assert.deepEqual(r.authorization_servers, [BASE]);
  const s = await (await servidor.GET(req("/.well-known/oauth-authorization-server"))).json();
  assert.equal(s.issuer, BASE);
  assert.equal(s.authorization_endpoint, `${BASE}/api/oauth/authorize`);
  assert.equal(s.token_endpoint, `${BASE}/api/oauth/token`);
  assert.equal(s.registration_endpoint, `${BASE}/api/oauth/register`);
  assert.deepEqual(s.code_challenge_methods_supported, ["S256"]);
  const rw = reescritasMcp();
  assert.ok(rw.some((x) => x.source === "/.well-known/oauth-protected-resource/:path*" && x.destination === "/api/oauth/metadata/recurso"));
  assert.ok(rw.some((x) => x.source === "/.well-known/oauth-authorization-server" && x.destination === "/api/oauth/metadata/servidor"));
});

test("sem AVANTEZA_MCP_SECRET: todas as rotas OAuth/MCP respondem 503", async () => {
  delete process.env.AVANTEZA_MCP_SECRET;
  try {
    assert.equal((await recurso.GET(req("/x"))).status, 503);
    assert.equal((await servidor.GET(req("/x"))).status, 503);
    assert.equal((await registrar()).status, 503);
    assert.equal((await authorize.GET(req("/api/oauth/authorize?client_id=x"))).status, 503);
    assert.equal((await authorize.POST(req("/api/oauth/authorize", { method: "POST", body: new FormData() }))).status, 503);
    assert.equal((await trocar({ grant_type: "refresh_token", refresh_token: "x" })).status, 503);
    assert.equal((await rpc("qualquer", "tools/list")).status, 503);
  } finally {
    process.env.AVANTEZA_MCP_SECRET = SEGREDO;
  }
});

test("MCP sem token ou com token ruim: 401 com WWW-Authenticate apontando para os metadados", async () => {
  for (const b of [null, "lixo", assinar({ t: "refresh", exp: agora() + 60, cid: "c", sub: DONO }), assinar({ t: "access", exp: agora() - 1, cid: "c", sub: DONO })]) {
    const r = await rpc(b, "tools/list");
    assert.equal(r.status, 401, `token ${String(b).slice(0, 12)}`);
    assert.match(r.res.headers.get("www-authenticate")!, /^Bearer resource_metadata="https:\/\/app\.avanteza\.com\.br\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  }
});

test("registro: só os callbacks do Claude e localhost; qualquer outro redirect é recusado", async () => {
  assert.equal(redirectAceito("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(redirectAceito("https://claude.com/api/mcp/auth_callback"), true);
  assert.equal(redirectAceito("http://localhost:6274/oauth/callback"), true);
  assert.equal(redirectAceito("http://127.0.0.1:33418/callback"), true);
  for (const ruim of ["https://evil.com/cb", "https://claude.ai/outra", "https://claude.ai.evil.com/api/mcp/auth_callback", "http://claude.ai/api/mcp/auth_callback", "https://localhost/cb", "javascript:alert(1)"]) {
    assert.equal(redirectAceito(ruim), false, ruim);
  }
  const ok = await registrar([CALLBACK, "http://localhost:6274/oauth/callback"]);
  assert.equal(ok.status, 201);
  assert.ok((await ok.json()).client_id);
  assert.equal((await registrar([CALLBACK, "https://evil.com/cb"])).status, 400, "um redirect de fora derruba o registro todo");
  assert.equal((await registrar([])).status, 400);
});

test("authorize: sem sessão vai para o login com next=<o próprio authorize>; pedido inválido é 400", async () => {
  const cid = (await (await registrar()).json()).client_id;
  const { challenge } = pkce();
  const p = paramsAut(cid, challenge);
  const r = await authorize.GET(req(`/api/oauth/authorize?${p}`));
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location")!, BASE);
  assert.equal(loc.pathname, "/login");
  const next = loc.searchParams.get("next")!;
  assert.ok(next.startsWith("/api/oauth/authorize?"));
  assert.equal(new URLSearchParams(next.split("?")[1]).get("code_challenge"), challenge);
  // redirect_uri não registrado, sem PKCE, client_id forjado
  assert.equal((await authorize.GET(req(`/api/oauth/authorize?${paramsAut(cid, challenge, { redirect_uri: "https://evil.com/cb" })}`))).status, 400);
  assert.equal((await authorize.GET(req(`/api/oauth/authorize?${paramsAut(cid, challenge, { code_challenge_method: "plain" })}`))).status, 400);
  assert.equal((await authorize.GET(req(`/api/oauth/authorize?${paramsAut(cid + "x", challenge)}`))).status, 400);
  // membro/cliente: a tela recusa (sem consultar o banco)
  const membro = await verifySessionFull(await signSession("m@avanteza.com.br", undefined, 60, "member"));
  const a = await avaliarPedido((k) => p.get(k), membro);
  assert.equal(a.tipo, "recusado");
  const cli = await verifySessionFull(await signSession("c@cliente.com", undefined, 60, "client", { clientIds: ["00000000-0000-0000-0000-000000000001"] }));
  assert.equal((await avaliarPedido((k) => p.get(k), cli)).tipo, "recusado");
  // admin fora de ADMIN_EMAILS não é sessão válida → login
  const intruso = await verifySessionFull(await signSession("intruso@x.com", undefined, 60, "admin"));
  assert.equal((await avaliarPedido((k) => p.get(k), intruso)).tipo, "login");
});

test("tools/list registra todas as ferramentas (e nenhuma de exclusão)", () => {
  const nomes = FERRAMENTAS.map((f) => f.nome).sort();
  assert.deepEqual(nomes, [
    "atualizar_coleta_canal", "atualizar_tarefa", "buscar", "canais_do_cliente", "comercial_buscar", "criar_tarefa", "entregas", "financeiro_resumo",
    "lancamentos", "lancar_financeiro", "listar_clientes", "notificacoes", "plano_do_cliente", "registrar_combinado", "registrar_reuniao", "reunioes_do_cliente",
    "tarefas_hoje", "ver_cliente",
  ]);
  assert.ok(!nomes.some((n) => /exclu|apag|delet|senha|acesso/.test(n)));
  assert.deepEqual(limpar({ a: 1, password_hash: "x", nested: [{ access_token_enc: "y", token: "z", ok: true }], api_key: "k", segredo_enc: "s" }), { a: 1, nested: [{ ok: true }] });
});

// ─── Com banco ───────────────────────────────────────────────────────────────

let C1 = "", C2 = "";
let dados: Awaited<ReturnType<typeof mkData>>, dadosP: Awaited<ReturnType<typeof mkData>>;
const dono: Ator = { email: DONO, sessao: { email: DONO, role: "admin", apps: [], name: "Dono" } };
const membro: Ator = { email: "m@avanteza.com.br", sessao: { email: "m@avanteza.com.br", role: "member", apps: [], name: "Membro" } };

class FakeAi implements AiProvider {
  readonly name = "falso";
  constructor(private out: unknown) {}
  enabled() { return true; }
  async analyze(): Promise<any> { throw new Error("não usado"); }
  async extract<T>(_s: string, _ctx: string, _schema: ZodType<T>) { return { output: this.out as T, provider: "falso", model: "falso-1", usage: {} } as any; }
}
const semIa = { name: "off", enabled: () => false, analyze: async () => { throw new Error("x"); }, extract: async () => { throw new Error("x"); } } as unknown as AiProvider;
const comercialFalso: ProvedorComercial = { buscar: async () => ({ ok: true, grupos: { oportunidades: [{ id: "oportunidades:1", titulo: "Showman — Marketplace", href: "/comercial/oportunidades/1", ext: true }], contatos: [], contratos: [] } }) };
const deps = (extra: Deps = {}): Deps => ({ hoje: HOJE, ia: semIa, comercial: comercialFalso, financeiro: financeiroFixture("1", HOJE), entregas: entregasFixture("1"), ...extra });
const auditoria = (event: string) => rawQuery<{ actor: string; client_id: string | null; details: any }>("select actor, client_id, details from avanteza.audit_log where event = $1 order by created_at desc", [event]);
const saidas: unknown[] = [];
const rodar = async (nome: string, args: unknown, d: Deps = deps(), ator = dono) => { const r = await executarFerramenta(nome, ator, args, d); saidas.push(r); return r as any; };

before(async () => {
  if (!HAS_DB) return;
  await resetSchema();
  C1 = await mkClient("Ótica Showman", { start: "2026-01-15" });
  C2 = await mkClient("Padaria Pão Bom");
  dados = await mkData(C1, "S");
  dadosP = await mkData(C2, "P");
  await mkUser("cliente@showman.com", C1);
  await rawQuery("insert into avanteza.admins (email, role, name, password_hash, active) values ($1,'admin','Dono','$2b$04$hashquenaodevesair',true), ('m@avanteza.com.br','member','Membro','$2b$04$x',true), ('ex@avanteza.com.br','admin','Ex',null,true)", [DONO]);
});
after(async () => { if (HAS_DB) await closeDb(); });

test("OAuth completo: registro → authorize (dono) → Permitir → código → token (PKCE) → MCP → refresh", { skip }, async () => {
  const cid = (await (await registrar()).json()).client_id;
  const { verifier, challenge } = pkce();
  const p = paramsAut(cid, challenge);
  const ck = await cookie(DONO);
  const g = await authorize.GET(req(`/api/oauth/authorize?${p}`, { headers: { cookie: ck } }));
  assert.equal(g.status, 302);
  assert.ok(g.headers.get("location")!.startsWith("/oauth/autorizar?"), "com sessão: tela de consentimento");
  const { a, res } = await consentir(p, ck);
  assert.equal(a.tipo, "consentir");
  assert.equal(res.status, 303);
  const volta = new URL(res.headers.get("location")!);
  assert.equal(`${volta.origin}${volta.pathname}`, CALLBACK);
  assert.equal(volta.searchParams.get("state"), "estado-xyz");
  const code = volta.searchParams.get("code")!;
  assert.ok(code);
  // PKCE errado / redirect diferente / client diferente
  assert.equal((await trocar({ grant_type: "authorization_code", code, code_verifier: pkce().verifier, redirect_uri: CALLBACK, client_id: cid })).status, 400);
  assert.equal((await trocar({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: "http://localhost:1/cb", client_id: cid })).status, 400);
  const tk = await (await trocar({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: cid })).json();
  assert.ok(tk.access_token && tk.refresh_token);
  assert.equal(tk.token_type, "Bearer");
  assert.equal(tk.expires_in, 30 * 24 * 3600);
  const lista = await rpc(tk.access_token, "tools/list");
  assert.equal(lista.status, 200);
  const nomes = lista.corpo.result.tools.map((t: any) => t.name);
  for (const f of FERRAMENTAS) assert.ok(nomes.includes(f.nome), f.nome);
  assert.equal(lista.corpo.result.tools.find((t: any) => t.name === "criar_tarefa").annotations.readOnlyHint, false);
  const chamada = await rpc(tk.access_token, "tools/call", { name: "listar_clientes", arguments: {} });
  const out = JSON.parse(chamada.corpo.result.content[0].text);
  assert.ok(out.clientes.some((c: any) => c.nome === "Ótica Showman"));
  const viaMcp = await rpc(tk.access_token, "tools/call", { name: "criar_tarefa", arguments: { cliente: C2, titulo: "Criada pelo MCP" } });
  assert.equal(JSON.parse(viaMcp.corpo.result.content[0].text).ok, true);
  const [criada] = await auditoria("plan_action_created");
  assert.equal(criada.actor, DONO, "ator = e-mail do token");
  assert.equal(criada.client_id, C2);
  const ruim = await rpc(tk.access_token, "tools/call", { name: "criar_tarefa", arguments: { cliente: C1, titulo: "x", prazo: "amanhã" } });
  assert.equal(ruim.corpo.result.isError, true, "entrada inválida vira erro da ferramenta");
  const novo = await (await trocar({ grant_type: "refresh_token", refresh_token: tk.refresh_token, client_id: cid })).json();
  assert.ok(novo.access_token);
  assert.equal((await rpc(novo.access_token, "tools/list")).status, 200);
  const [aud] = await auditoria("mcp_conector_autorizado");
  assert.equal(aud.actor, DONO);
  assert.equal(aud.details.via, "claude");
});

test("recusas: Negar, código vencido, form de outra sessão, membro/cliente no POST, usuário desativado", { skip }, async () => {
  const cid = (await (await registrar()).json()).client_id;
  const { verifier, challenge } = pkce();
  const p = paramsAut(cid, challenge);
  const negar = (await consentir(p, await cookie(DONO), "negar")).res;
  assert.equal(negar.status, 303);
  const u = new URL(negar.headers.get("location")!);
  assert.equal(u.searchParams.get("error"), "access_denied");
  assert.equal(u.searchParams.get("code"), null);
  // código vencido
  const vencido = assinar({ t: "code", exp: agora() - 1, cid, uri: CALLBACK, ch: challenge, sub: DONO });
  assert.equal((await trocar({ grant_type: "authorization_code", code: vencido, code_verifier: verifier, redirect_uri: CALLBACK, client_id: cid })).status, 400);
  // form token do dono usado com a sessão de outro administrador
  const formDono = (await avaliarPedido((k) => p.get(k), await verifySessionFull((await cookie(DONO)).split("avz_session=")[1]))) as any;
  assert.equal((await consentir(p, await cookie("ex@avanteza.com.br"), "permitir", formDono.form)).res.status, 403);
  // membro e cliente nunca recebem código
  assert.equal((await consentir(p, await cookie("m@avanteza.com.br", "member"))).res.status, 403);
  assert.equal((await consentir(p, await cookie("cliente@showman.com", "client", { clientIds: [C1] }))).res.status, 403);
  assert.equal((await consentir(p, "")).res.status, 403, "sem sessão");
  // desativado: o token deixa de valer na hora; troca e refresh recusados
  const { cid: cid2, tk } = await fluxoCompleto("ex@avanteza.com.br");
  assert.equal((await rpc(tk.access_token, "tools/list")).status, 200);
  await rawQuery("update avanteza.admins set active = false where email = 'ex@avanteza.com.br'");
  assert.equal((await rpc(tk.access_token, "tools/list")).status, 401);
  assert.equal((await trocar({ grant_type: "refresh_token", refresh_token: tk.refresh_token, client_id: cid2 })).status, 400);
  const pend = paramsAut(cid2, challenge);
  assert.equal((await avaliarPedido((k) => pend.get(k), await verifySessionFull((await cookie("ex@avanteza.com.br")).split("avz_session=")[1]))).tipo, "recusado");
  // membro com token forjado (assinado, mas papel errado no banco) → 401
  const forjado = assinar({ t: "access", exp: agora() + 60, cid: cid2, sub: "m@avanteza.com.br" });
  assert.equal((await rpc(forjado, "tools/list")).status, 401);
  const cliente = assinar({ t: "access", exp: agora() + 60, cid: cid2, sub: "cliente@showman.com" });
  assert.equal((await rpc(cliente, "tools/list")).status, 401);
});

test("leitura: buscar, clientes, ficha, fila de hoje, plano, reuniões, canais, notificações", { skip }, async () => {
  const b = await rodar("buscar", { q: "showman" });
  assert.ok(b.grupos.some((g: any) => g.grupo === "Clientes" && g.itens.some((i: any) => i.titulo === "Ótica Showman")));
  assert.ok(b.grupos.some((g: any) => g.grupo === "Oportunidades"));

  const l = await rodar("listar_clientes", {});
  assert.equal(l.total, 2);
  assert.ok(["verde", "amarelo", "vermelho"].includes(l.clientes[0].saude.nivel));

  const v = await rodar("ver_cliente", { cliente: "otica showman" });
  assert.equal(v.cliente.id, C1);
  assert.ok("contato" in v.cliente && Array.isArray(v.servicos) && v.saude);
  await assert.rejects(executarFerramenta("ver_cliente", dono, { cliente: "inexistente" }, deps()), ErroFerramenta);
  await rawQuery("insert into avanteza.clients (name, slug) values ('Ótica Showman Filial', 'filial')");
  await assert.rejects(executarFerramenta("ver_cliente", dono, { cliente: "showman" }, deps()), /Mais de um cliente/);
  assert.equal((await rodar("ver_cliente", { cliente: "Ótica Showman" })).cliente.id, C1, "nome exato vence o parcial");

  const h = await rodar("tarefas_hoje", { cliente: C1 });
  assert.equal(h.hoje, HOJE);
  assert.ok(h.esperando_cliente.some((a: any) => a.titulo === "Ação S"), "ação do cliente fica em 'esperando o cliente'");
  assert.ok(h.semana.some((a: any) => a.titulo === "Ação Avanteza S"));
  assert.ok(![...h.atrasadas, ...h.semana, ...h.esperando_cliente].some((a: any) => a.cliente_id === C2));
  assert.equal((await rodar("tarefas_hoje", { responsavel: "ninguem" })).contadores.semana >= 1, true);
  await assert.rejects(executarFerramenta("tarefas_hoje", dono, { responsavel: "naoexiste@x.com" }, deps()), ErroFerramenta);

  const p = await rodar("plano_do_cliente", { cliente: C1 });
  assert.equal(p.fases.length, 1);
  assert.equal(p.fases[0].acoes.length, 2);

  const r = await rodar("reunioes_do_cliente", { cliente: C1 });
  assert.equal(r.reunioes[0].titulo, "Reunião S");
  const det = await rodar("reunioes_do_cliente", { cliente: C1, reuniao_id: dados.meeting });
  assert.equal(det.resumo, "Resumo S");
  assert.equal(det.acoes.length, 1);

  const c = await rodar("canais_do_cliente", { cliente: C1, periodo: "7" });
  assert.equal(c.estado.anuncios, null);
  assert.equal(c.anuncios, null);
  await assert.rejects(executarFerramenta("canais_do_cliente", dono, { cliente: C1, periodo: "15" }, deps()), /Entrada inválida/);

  await notificar({ tipo: "contrato", titulo: "Contrato assinado: Showman", para: "admin", segredo: null });
  const n = await rodar("notificacoes", {});
  assert.ok(n.itens.some((i: any) => i.titulo === "Contrato assinado: Showman"));
});

test("leitura: financeiro, lançamentos, comercial e entregas pelos provedores (fixture)", { skip }, async () => {
  const f = await rodar("financeiro_resumo", { mes: "2026-02" });
  assert.equal(typeof f.receitas, "number");
  assert.ok(f.contas_a_pagar);
  const l = await rodar("lancamentos", { mes: "2026-02", tipo: "despesa" });
  assert.ok(l.itens.every((t: any) => t.tipo === "despesa"));
  await assert.rejects(executarFerramenta("lancamentos", membro, {}, deps()), /acesso/);
  const cb = await rodar("comercial_buscar", { q: "showman" });
  assert.equal(cb.oportunidades[0].titulo, "Showman — Marketplace");
  const fora = await rodar("comercial_buscar", { q: "showman" }, deps({ comercial: { buscar: async () => ({ ok: false, motivo: "timeout" }) } }));
  assert.deepEqual(fora, { indisponivel: true, motivo: "timeout" });
  const e = await rodar("entregas", {});
  assert.ok(e.indicadores && Array.isArray(e.entregas));
  if (e.entregas[0]) assert.ok((await rodar("entregas", { entrega_id: e.entregas[0].id })).cartoes);
});

test("ação: criar e atualizar tarefa (auditoria via claude, validação, papel)", { skip }, async () => {
  const t = await rodar("criar_tarefa", { cliente: C1, titulo: "Revisar fotos do catálogo", prazo: "2026-02-03", responsavel_email: DONO, prioridade: 1 });
  assert.ok(t.ok && t.id);
  const [row] = await rawQuery<any>("select title, origin, priority, assignee_id, client_id, due_date::text d from avanteza.plan_actions where id = $1", [t.id]);
  assert.equal(row.origin, "manual");
  assert.equal(row.priority, 1);
  assert.equal(row.client_id, C1);
  assert.equal(row.d, "2026-02-03");
  assert.ok(row.assignee_id);
  const [a1] = await auditoria("plan_action_created");
  assert.equal(a1.actor, DONO);
  assert.equal(a1.client_id, C1);
  assert.equal(a1.details.via, "claude");
  await assert.rejects(executarFerramenta("criar_tarefa", dono, { cliente: C1, titulo: "x", prazo: "31/02/2026" }, deps()), /Entrada inválida/);
  await assert.rejects(executarFerramenta("criar_tarefa", dono, { cliente: C1, titulo: "" }, deps()), /Entrada inválida/);
  await assert.rejects(executarFerramenta("criar_tarefa", dono, { cliente: C1, titulo: "x", fase_id: dadosP.phase }, deps()), /Fase de outro cliente/);
  await assert.rejects(executarFerramenta("criar_tarefa", membro, { cliente: C1, titulo: "x" }, deps()), /administradores/, "criar ação no plano é só do administrador (requireOwner)");

  await rodar("atualizar_tarefa", { id: t.id, operacao: "reagendar", nova_data: "2026-02-10" });
  await rodar("atualizar_tarefa", { id: t.id, operacao: "bloquear", motivo: "Cliente enviar as fotos" });
  await rodar("atualizar_tarefa", { id: t.id, operacao: "desbloquear" });
  await rodar("atualizar_tarefa", { id: t.id, operacao: "mudar_responsavel", responsavel_email: "ninguem" });
  await rodar("atualizar_tarefa", { id: t.id, operacao: "concluir", evidencia: "https://drive.google.com/x" });
  const [fim] = await rawQuery<any>("select status, due_date::text d, evidence_url, assignee_id from avanteza.plan_actions where id = $1", [t.id]);
  assert.equal(fim.status, "concluida");
  assert.equal(fim.d, "2026-02-10");
  assert.equal(fim.evidence_url, "https://drive.google.com/x");
  assert.equal(fim.assignee_id, null);
  for (const ev of ["motor_adiar", "motor_bloquear", "motor_desbloquear", "motor_reatribuir", "motor_concluir"]) {
    const [x] = await auditoria(ev);
    assert.equal(x.details.via, "claude", ev);
    assert.equal(x.actor, DONO);
  }
  await assert.rejects(executarFerramenta("atualizar_tarefa", dono, { id: t.id, operacao: "reagendar" }, deps()), /nova_data/);
  await assert.rejects(executarFerramenta("atualizar_tarefa", dono, { id: dados.action, operacao: "bloquear", motivo: "x" }, deps()), /cliente precisa/);
  await assert.rejects(executarFerramenta("atualizar_tarefa", dono, { id: "nao-e-uuid", operacao: "concluir" }, deps()), /Entrada inválida/);
  await assert.rejects(executarFerramenta("atualizar_tarefa", dono, { id: t.id, operacao: "excluir" }, deps()), /Entrada inválida/, "não existe exclusão");
});

test("ação: registrar combinado (captura 'claude') e reunião (com e sem IA)", { skip }, async () => {
  const ia = new FakeAi({ resumo: "Combinados", acoes: [{ titulo: "Enviar logo em alta", descricao: null, responsavel: "cliente", prazo: "2026-02-05" }] });
  const c = await rodar("registrar_combinado", { cliente: C1, texto: "Cliente: mando o logo em alta até quinta." }, deps({ ia }));
  assert.equal(c.status, "processada");
  assert.equal(c.acoes_criadas.length, 1);
  const [cap] = await rawQuery<any>("select origem from avanteza.capturas where id = $1", [c.captura_id]);
  assert.equal(cap.origem, "claude");
  const [ac] = await auditoria("captura_registrada");
  assert.equal(ac.details.via, "claude");
  assert.equal(ac.actor, DONO);
  const dup = await rodar("registrar_combinado", { cliente: C1, texto: "Cliente: mando o logo em alta até quinta." }, deps({ ia }));
  assert.equal(dup.duplicada, true);
  assert.equal((await rodar("registrar_combinado", { cliente: C1, texto: "Outra conversa sem IA ligada" })).status, "sem_ia");
  await assert.rejects(executarFerramenta("registrar_combinado", dono, { cliente: C1, texto: "" }, deps()), /Entrada inválida/);

  const r = await rodar("registrar_reuniao", { cliente: C1, titulo: "Alinhamento fevereiro", data: "2026-02-01", resumo: "Revisamos as campanhas.", decisoes: ["Aumentar verba"], acoes: [{ titulo: "Subir campanha nova", de_quem: "avanteza", prazo: "2026-02-05" }] });
  assert.equal(r.status, "manual");
  assert.equal(r.acoes_criadas, 1);
  const [m] = await rawQuery<any>("select status, summary from avanteza.meetings where id = $1", [r.reuniao_id]);
  assert.equal(m.status, "manual");
  const so = await rodar("registrar_reuniao", { cliente: C1, titulo: "Só registro", data: "2026-02-02" });
  assert.equal(so.status, "aguardando_analise");
  const comIa = await rodar("registrar_reuniao", { cliente: C1, titulo: "Com IA", data: "2026-02-03", transcricao: "texto da reunião" }, deps({ ia: new FakeAi({ resumo: "R", decisoes: [], acoes: [] }) }));
  assert.equal(comIa.status, "analisada");
  const evs = await auditoria("meeting_ingested");
  assert.equal(evs.length, 3);
  assert.ok(evs.every((e) => e.details.via === "claude" && e.actor === DONO));
  await assert.rejects(executarFerramenta("registrar_reuniao", dono, { cliente: C1, titulo: "x", data: "2026-02-01", link_gravacao: "ftp://x" }, deps()), /Entrada inválida/);
  await assert.rejects(executarFerramenta("registrar_reuniao", membro, { cliente: C1, titulo: "x", data: "2026-02-01" }, deps()), /administradores/);
});

test("ação: lançar no financeiro e atualizar coleta do canal (sem valores na auditoria)", { skip }, async () => {
  const fin = financeiroFixture("1", HOJE);
  const l = await rodar("lancar_financeiro", { tipo: "despesa", valor: 123.45, descricao: "Ferramenta de e-mail", categoria: "Software", data: "2026-02-01" }, deps({ financeiro: fin }));
  assert.ok(l.ok && l.id);
  const lista = await fin.transacoes("empresa", { mes: "2026-02", texto: "Ferramenta de e-mail" });
  assert.ok(lista.transacoes.some((t) => t.id === l.id && t.valor === 123.45));
  const [a] = await auditoria("financeiro_lancamento_criar");
  assert.deepEqual(a.details, { escopo: "empresa", entidade: "lancamento", id: l.id, via: "claude" });
  const conta = await rodar("lancar_financeiro", { natureza: "conta_a_pagar", tipo: "despesa", valor: 99, descricao: "Aluguel", categoria: "Escritório", data: "2026-02-10" }, deps({ financeiro: fin }));
  assert.ok(conta.id);
  assert.equal((await auditoria("financeiro_conta_criar"))[0].details.via, "claude");
  await assert.rejects(executarFerramenta("lancar_financeiro", dono, { natureza: "conta_a_pagar", tipo: "receita", valor: 1, descricao: "x", categoria: "y", data: "2026-02-10" }, deps({ financeiro: fin })), /sempre despesa/);
  await assert.rejects(executarFerramenta("lancar_financeiro", dono, { tipo: "despesa", valor: -5, descricao: "x", categoria: "y" }, deps({ financeiro: fin })), /Entrada inválida/);
  await assert.rejects(executarFerramenta("lancar_financeiro", membro, { tipo: "despesa", valor: 5, descricao: "x", categoria: "y" }, deps({ financeiro: fin })), /somente leitura/);

  const chamadas: string[] = [];
  const co = await rodar("atualizar_coleta_canal", { cliente: C1, fonte: "ads" }, deps({ coletar: async (id, fonte) => { chamadas.push(`${id}:${fonte}`); return { ok: true, mensagem: "Coleta concluída.", resultado: { linhas: { campaign_daily: 3 } } }; } }));
  assert.deepEqual(chamadas, [`${C1}:ads`]);
  assert.equal(co.ok, true);
  const gg = await rodar("atualizar_coleta_canal", { cliente: C1, fonte: "google" }, deps({ coletarGoogle: async () => ({ ok: false, mensagem: "Google não configurado." }) }));
  assert.equal(gg.ok, false);
  const evs = await auditoria("channel_sync_now");
  assert.equal(evs.length, 2);
  assert.ok(evs.every((e) => e.details.via === "claude" && e.client_id === C1));
});

test("saídas: nunca levam hash de senha, token, transcrição ou campo cifrado", { skip }, async () => {
  assert.ok(saidas.length > 15);
  const tudo = JSON.stringify(saidas);
  for (const proibido of ["password_hash", "hashquenaodevesair", "TOKEN-SECRETO", "REFRESH-SECRETO", "access_token", "_enc", "SEGREDO-TRANSCRICAO", "transcript_text", "segredo", "secret"]) {
    assert.ok(!tudo.includes(proibido), proibido);
  }
});
