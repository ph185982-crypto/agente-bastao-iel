// Dashboards: períodos, Meta (provedor injetável, fetch simulado, retry, cache), Vendedor IA (zod, timeout), CAC, fixture e acesso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverPeriodo, parsePeriodo, variacaoPct, listarDias } from "../src/lib/dashboards/periodo";
import { criarProvedorMeta, carregarMeta, parseLinha, somarInsights, roas, custoPorLead, MetaErro, type MetaProvider, type LinhaBruta, type ConsultaInsights } from "../src/lib/dashboards/meta";
import { comCache, type CacheStore } from "../src/lib/dashboards/cache";
import { criarProvedorVendedoria, metricasSchema, VendedoriaErro } from "../src/lib/dashboards/vendedoria";
import { calcularCac, carregarDashboards, type Fonte } from "../src/lib/dashboards";
import { fixtureAtiva, vendedoriaFixture, metaFixture } from "../src/lib/dashboards/fixtures";
import { podeVerDashboards, destinoPadrao } from "../src/lib/dashboards/nav";
import { isMapaPath, type Session } from "../src/lib/session";
import { SIDEBAR_INIT_SCRIPT, SIDEBAR_KEY } from "../src/lib/theme";

const TOKEN_FALSO = "token-falso-de-teste";
const sem = async () => undefined;
const json = (corpo: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...h } });

test("períodos: 7/30/90 terminam hoje; mês vai do dia 1º a hoje; anterior tem o mesmo tamanho", () => {
  const p30 = resolverPeriodo("30", "2026-11-16");
  assert.deepEqual([p30.atual.de, p30.atual.ate, p30.atual.dias], ["2026-10-18", "2026-11-16", 30]);
  assert.deepEqual([p30.anterior.de, p30.anterior.ate, p30.anterior.dias], ["2026-09-18", "2026-10-17", 30]);
  const mes = resolverPeriodo("mes", "2026-11-16");
  assert.deepEqual([mes.atual.de, mes.atual.dias, mes.anterior.ate, mes.anterior.dias], ["2026-11-01", 16, "2026-10-31", 16]);
  assert.equal(resolverPeriodo("7", "2026-03-02").atual.de, "2026-02-24");
  assert.equal(parsePeriodo("lixo"), "30");
  assert.equal(parsePeriodo(["90"]), "90");
  assert.equal(listarDias("2026-02-27", "2026-03-01").length, 3);
  assert.equal(variacaoPct(110, 100), 10);
  assert.equal(variacaoPct(5, 0), null);
  assert.equal(variacaoPct(0, 0), 0);
  assert.equal(variacaoPct(null, 3), null);
});

test("Meta: só GET na Graph v21.0, token no cabeçalho (nunca na URL), campos e time_range corretos, paginação", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const u = new URL(String(url));
    if (u.searchParams.get("after")) return json({ data: [{ id: "act_2", name: "Conta 2", account_status: 2, currency: "BRL" }] });
    if (u.pathname.endsWith("/me/adaccounts")) return json({ data: [{ id: "act_1", name: "Conta 1", account_status: 1, currency: "BRL" }], paging: { next: `https://graph.facebook.com/v21.0/me/adaccounts?after=x` } });
    return json({ data: [{ spend: "10.5", impressions: "1000" }] });
  }) as typeof fetch;
  const p = criarProvedorMeta({ token: TOKEN_FALSO, fetchImpl, sleep: sem });
  const contas = await p.listarContas();
  assert.deepEqual(contas.map((c) => [c.id, c.status]), [["act_1", 1], ["act_2", 2]]);
  await p.insights({ contaId: "act_1", de: "2026-11-01", ate: "2026-11-10", nivel: "campaign" });
  await p.insights({ contaId: "act_1", de: "2026-11-01", ate: "2026-11-10", nivel: "account", diario: true });
  for (const c of chamadas) {
    assert.equal((c.init?.method ?? "GET").toUpperCase(), "GET");
    assert.equal(new URL(c.url).hostname, "graph.facebook.com");
    assert.ok(c.url.includes("/v21.0/"));
    assert.ok(!c.url.includes(TOKEN_FALSO), "token fora da URL");
    assert.equal((c.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN_FALSO}`);
  }
  const camp = new URL(chamadas[chamadas.length - 2].url);
  assert.equal(camp.searchParams.get("level"), "campaign");
  for (const f of ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "actions", "action_values", "campaign_name"]) assert.ok(camp.searchParams.get("fields")!.split(",").includes(f), f);
  assert.deepEqual(JSON.parse(camp.searchParams.get("time_range")!), { since: "2026-11-01", until: "2026-11-10" });
  const dia = new URL(chamadas[chamadas.length - 1].url);
  assert.equal(dia.searchParams.get("time_increment"), "1");
  await assert.rejects(p.insights({ contaId: "act_1/../me", de: "2026-11-01", ate: "2026-11-02", nivel: "account" }), MetaErro);
});

test("Meta: retry com backoff em 429, 5xx e nos erros transitórios/limite que vêm com HTTP 400; token inválido não repete", async () => {
  let n = 0; const esperas: number[] = [];
  const sleep = async (ms: number) => { esperas.push(ms); };
  const seq = (respostas: Response[]) => (async () => respostas[Math.min(n++, respostas.length - 1)].clone()) as typeof fetch;
  let p = criarProvedorMeta({ token: TOKEN_FALSO, sleep, fetchImpl: seq([json({ error: { message: "x", code: 4 } }, 429), json({ data: [] })]) });
  assert.deepEqual(await p.listarContas(), []);
  assert.ok(esperas.length >= 1);
  n = 0; esperas.length = 0;
  p = criarProvedorMeta({ token: TOKEN_FALSO, sleep, fetchImpl: seq([json({ error: { code: 17, message: "limite" } }, 400), json({ error: { code: 2, is_transient: true } }, 500), json({ data: [{ id: "act_9" }] })]) });
  assert.equal((await p.listarContas())[0].id, "act_9");
  assert.ok(esperas.length >= 2);
  n = 0;
  p = criarProvedorMeta({ token: TOKEN_FALSO, sleep, fetchImpl: seq([json({ error: { code: 190, message: "Error validating access token" } }, 401)]) });
  await assert.rejects(p.listarContas(), (e: unknown) => e instanceof MetaErro && e.codigo === "token" && !String(e.message).includes(TOKEN_FALSO));
  assert.equal(n, 1, "token inválido não é repetido");
  n = 0;
  p = criarProvedorMeta({ token: TOKEN_FALSO, sleep, tentativas: 2, fetchImpl: seq([json({ error: { code: 613, message: "limite" } }, 400)]) });
  await assert.rejects(p.listarContas(), (e: unknown) => e instanceof MetaErro && e.codigo === "limite");
  assert.equal(n, 3, "1 + 2 tentativas");
  n = 0;
  p = criarProvedorMeta({ token: TOKEN_FALSO, sleep, fetchImpl: seq([json({ error: { code: 200, message: "perm" } }, 403)]) });
  await assert.rejects(p.listarContas(), (e: unknown) => e instanceof MetaErro && e.codigo === "permissao");
});

test("Meta: leads sem dupla contagem, conversas à parte, compras/ROAS, CTR e CPC recalculados", () => {
  const i = parseLinha({ spend: "200", impressions: "10000", clicks: "250", reach: "8000", actions: [
    { action_type: "lead", value: "10" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "10" },
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "20" }, { action_type: "purchase", value: "2" },
  ], action_values: [{ action_type: "purchase", value: "1000" }] });
  assert.equal(i.leads, 10); assert.equal(i.conversas, 20); assert.equal(i.compras, 2);
  assert.equal(i.ctr, 2.5); assert.equal(i.cpc, 0.8);
  assert.equal(roas(i), 5); assert.equal(custoPorLead(i), 6.67);
  assert.equal(roas(parseLinha({ spend: "10", actions: [] })), null, "sem valor de conversão não há ROAS");
  const s = somarInsights([i, i]);
  assert.equal(s.gasto, 400); assert.equal(s.ctr, 2.5);
});

function provFalso(porConta: Record<string, (q: ConsultaInsights) => LinhaBruta[] | Error>, contas = Object.keys(porConta).map((id) => ({ id, nome: id, moeda: "BRL", status: 1 }))): MetaProvider {
  return {
    async listarContas() { return contas; },
    async insights(q) { const r = porConta[q.contaId](q); if (r instanceof Error) throw r; return r; },
  };
}
const linha = (spend: string, extra: Partial<LinhaBruta> = {}): LinhaBruta => ({ spend, impressions: "1000", clicks: "20", reach: "800", actions: [{ action_type: "lead", value: "2" }], ...extra });

test("Meta: várias contas agregadas, conta desativada/sem dados e conta com erro não derrubam as demais", async () => {
  const prov = provFalso({
    act_1: (q) => q.nivel === "campaign" ? [linha("60", { campaign_id: "c1", campaign_name: "Camp A" })] : q.diario ? [linha("30", { date_start: "2026-11-01" }), linha("30", { date_start: "2026-11-02" })] : [linha("60")],
    act_2: () => [], // desativada, sem dados
    act_3: () => new MetaErro("Erro", "api"),
  });
  const r = await carregarMeta(prov, { de: "2026-11-01", ate: "2026-11-02" }, { de: "2026-10-30", ate: "2026-10-31" });
  assert.equal(r.atual?.gasto, 60);
  assert.equal(r.contas.length, 3);
  assert.equal(r.contas.find((c) => c.id === "act_2")?.semDados, true);
  assert.equal(r.contas.find((c) => c.id === "act_3")?.ok, false);
  assert.equal(r.serie.length, 2);
  assert.equal(r.serie[0].gasto, 30);
  assert.equal(r.campanhas[0].nome, "Camp A");
  assert.equal(r.semDados, false);
  assert.ok(r.avisos.some((a) => a.includes("act_3")));
  // tudo vazio = "sem dados", não erro
  const vazio = await carregarMeta(provFalso({ act_1: () => [] }), { de: "2026-11-01", ate: "2026-11-02" }, { de: "2026-10-30", ate: "2026-10-31" });
  assert.equal(vazio.semDados, true);
  // todas falham por token = erro da fonte
  await assert.rejects(carregarMeta(provFalso({ act_1: () => new MetaErro("t", "token") }), { de: "2026-11-01", ate: "2026-11-02" }, { de: "2026-10-30", ate: "2026-10-31" }), (e: unknown) => e instanceof MetaErro && e.codigo === "token");
  // moeda diferente fica fora da soma
  const m = await carregarMeta(provFalso({ a: () => [linha("100")], b: () => [linha("500")] }, [{ id: "a", nome: "A", moeda: "BRL", status: 1 }, { id: "b", nome: "B", moeda: "USD", status: 1 }]), { de: "2026-11-01", ate: "2026-11-02" }, { de: "2026-10-30", ate: "2026-10-31" });
  assert.equal(m.moeda, "USD");
  assert.equal(m.atual?.gasto, 500);
  assert.equal(m.contas.find((c) => c.id === "a")?.somada, false);
});

test("cache: respeita o TTL, guarda e, se a fonte falhar, devolve o último valor como desatualizado", async () => {
  const mem = new Map<string, { valor: unknown; em: number }>();
  const store: CacheStore = { async get(k) { return mem.get(k) ?? null; }, async set(k, valor, em) { mem.set(k, { valor, em }); } };
  let t = 1_000; let chamadas = 0;
  const calc = async () => { chamadas++; return { n: chamadas }; };
  assert.deepEqual((await comCache(store, "k", 900_000, calc, () => t)).valor, { n: 1 });
  t += 60_000;
  const r2 = await comCache(store, "k", 900_000, calc, () => t);
  assert.deepEqual([r2.valor, r2.desatualizado, chamadas], [{ n: 1 }, false, 1]);
  t += 16 * 60_000;
  assert.deepEqual((await comCache(store, "k", 900_000, calc, () => t)).valor, { n: 2 });
  t += 16 * 60_000;
  const r4 = await comCache(store, "k", 900_000, async () => { throw new Error("fora"); }, () => t);
  assert.deepEqual([r4.valor, r4.desatualizado], [{ n: 2 }, true]);
  await assert.rejects(comCache(store, "novo", 1000, async () => { throw new Error("fora"); }, () => t), /fora/);
});

test("Vendedor IA: o fixture obedece ao contrato (zod); 401, 503, formato errado, timeout e retry em 5xx", async () => {
  const dados = await vendedoriaFixture("1").metricas({ de: "2026-11-01", ate: "2026-11-10" });
  assert.ok(metricasSchema.safeParse(dados).success);
  assert.equal(dados.atual.series.length, 10);
  const vazio = await vendedoriaFixture("vazio").metricas({ de: "2026-11-01", ate: "2026-11-10" });
  assert.ok(metricasSchema.safeParse(vazio).success);

  const urls: string[] = []; const auth: string[] = [];
  const ok = (async (u: string, init?: RequestInit) => { urls.push(u); auth.push((init?.headers as Record<string, string>).Authorization); return json(dados); }) as unknown as typeof fetch;
  const p = criarProvedorVendedoria({ chave: "chave-falsa", baseUrl: "https://vend.example/", fetchImpl: ok, sleep: sem });
  assert.equal((await p.metricas({ de: "2026-11-01", ate: "2026-11-10" })).versao, 1);
  assert.equal(urls[0], "https://vend.example/api/integracoes/avanteza/metricas?from=2026-11-01&to=2026-11-10");
  assert.equal(auth[0], "Bearer chave-falsa");

  const com = (f: (n: number) => Response | Promise<Response>) => { let n = 0; return criarProvedorVendedoria({ chave: "x", fetchImpl: (async () => f(n++)) as unknown as typeof fetch, sleep: sem, timeoutMs: 50 }); };
  const cod = (e: unknown) => (e instanceof VendedoriaErro ? e.codigo : "?");
  await assert.rejects(com(() => json({}, 401)).metricas({ de: "a", ate: "b" }), (e) => cod(e) === "nao-autorizado");
  await assert.rejects(com(() => json({}, 503)).metricas({ de: "a", ate: "b" }), (e) => cod(e) === "http");
  await assert.rejects(com(() => json({ versao: 2 })).metricas({ de: "a", ate: "b" }), (e) => cod(e) === "formato");
  assert.equal((await com((n) => (n === 0 ? json({}, 502) : json(dados))).metricas({ de: "a", ate: "b" })).versao, 1, "5xx tenta de novo");
  await assert.rejects(com((n) => { void n; return new Response("x", { status: 500 }); }).metricas({ de: "a", ate: "b" }), (e) => cod(e) === "http");
  const lento = criarProvedorVendedoria({ chave: "x", timeoutMs: 20, tentativas: 0, sleep: sem, fetchImpl: ((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as unknown as typeof fetch });
  await assert.rejects(lento.metricas({ de: "a", ate: "b" }), (e) => cod(e) === "timeout");
});

test("CAC = investimento Meta ÷ novos clientes; '—' com explicação quando falta dado", async () => {
  const vend = await vendedoriaFixture("1").metricas({ de: "2026-11-01", ate: "2026-11-30" });
  const meta = await carregarMeta(metaFixture("1"), { de: "2026-11-01", ate: "2026-11-30" }, { de: "2026-10-02", ate: "2026-10-31" });
  const f = <T,>(dados: T): Fonte<T> => ({ estado: "ok", dados, desatualizado: false, geradoEm: 0 });
  const c = calcularCac(f(meta), f(vend));
  assert.equal(c.valor, Math.round((meta.atual!.gasto / vend.atual.leads.ganhos) * 100) / 100);
  assert.equal(c.motivo, null);
  const zero = { ...vend, atual: { ...vend.atual, leads: { ...vend.atual.leads, ganhos: 0 } } };
  assert.match(calcularCac(f(meta), f(zero)).motivo ?? "", /Nenhum cliente novo/);
  assert.equal(calcularCac(f(meta), f(zero)).valor, null);
  assert.match(calcularCac({ estado: "indisponivel", codigo: "x", motivo: "m" }, f(vend)).motivo ?? "", /investimento da Meta/);
  assert.match(calcularCac(f(meta), { estado: "indisponivel", codigo: "x", motivo: "m" }).motivo ?? "", /Vendedor IA/);
});

test("orquestração: uma fonte fora do ar não derruba a outra; sem variáveis vira 'não configurado'; cache não é usado pelo fixture", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const d = await carregarDashboards("30", { env }, "2026-11-16");
  assert.equal(d.vendas.estado, "nao-configurado");
  assert.equal(d.meta.estado, "nao-configurado");
  assert.equal(d.cac.valor, null);
  const d2 = await carregarDashboards("7", {
    env,
    vendedoria: () => ({ metricas: async () => { throw new VendedoriaErro("Fora do ar.", "timeout"); } }),
    meta: () => metaFixture("1"),
    cache: { get: async () => null, set: async () => undefined },
  }, "2026-11-16");
  assert.equal(d2.vendas.estado, "indisponivel");
  assert.equal(d2.meta.estado, "ok");
  const d3 = await carregarDashboards("30", { env: { NODE_ENV: "development", DASHBOARDS_FIXTURE: "erro" } as unknown as NodeJS.ProcessEnv }, "2026-11-16");
  assert.equal(d3.vendas.estado, "indisponivel");
  assert.equal(d3.meta.estado, "indisponivel");
  assert.equal(d3.fixture, true);
});

test("fixture só fora de produção", () => {
  const e = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  assert.equal(fixtureAtiva(e({ NODE_ENV: "development", DASHBOARDS_FIXTURE: "1" })), "1");
  assert.equal(fixtureAtiva(e({ NODE_ENV: "production", DASHBOARDS_FIXTURE: "1" })), null);
  assert.equal(fixtureAtiva(e({ NODE_ENV: "development", VERCEL_ENV: "production", DASHBOARDS_FIXTURE: "1" })), null);
  assert.equal(fixtureAtiva(e({ NODE_ENV: "development", DASHBOARDS_FIXTURE: "talvez" })), null);
  assert.equal(fixtureAtiva(e({ NODE_ENV: "development" })), null);
});

test("acesso: admin e revisor veem (revisor só lê); membro e cliente não; login leva a /dashboards; cliente nunca entra", () => {
  process.env.ADMIN_EMAILS = "dono@x.com";
  const s = (role: Session["role"], email = "dono@x.com"): Session => ({ email, role, apps: ["marketplaces"], name: "", ...(role === "client" ? { clientId: "c", clientIds: ["c"] } : {}) });
  assert.equal(podeVerDashboards(s("admin")), true);
  assert.equal(podeVerDashboards(s("admin", "outro@x.com")), false, "admin fora de ADMIN_EMAILS");
  assert.equal(podeVerDashboards(s("reviewer", "r@x.com")), true);
  assert.equal(podeVerDashboards(s("member", "m@x.com")), false);
  assert.equal(podeVerDashboards(s("client", "c@x.com")), false);
  assert.equal(podeVerDashboards(null), false);
  assert.equal(isMapaPath("/dashboards"), false, "o middleware barra cliente em /dashboards");
  assert.equal(destinoPadrao("admin"), "/dashboards");
  assert.equal(destinoPadrao("reviewer"), "/dashboards");
  assert.equal(destinoPadrao("member"), "/operacoes", "a equipe cai em Hoje");
  assert.equal(destinoPadrao("client"), "/central");
  assert.match(readFileSync("src/app/actions.ts", "utf8"), /destinoPadrao\(r\.role\)/);
  assert.match(readFileSync("src/app/dashboards/layout.tsx", "utf8"), /requireDashboards/);
  assert.match(readFileSync("src/app/dashboards/page.tsx", "utf8"), /requireDashboards/);
  // Todas as telas da equipe usam o menu por departamentos (menuEquipe), cujo primeiro item é "Visão geral" (Dashboards)
  for (const f of ["src/components/Shell.tsx", "src/app/central/page.tsx", "src/app/usuarios/page.tsx", "src/app/dashboards/layout.tsx"]) assert.match(readFileSync(f, "utf8"), /EquipeShell/, f);
  assert.match(readFileSync("src/lib/shell/menu.ts", "utf8"), /\.\.\.\(podeVerDashboards\(sess\) \? \[\{ \.\.\.ITEM_DASHBOARDS, label: "Visão geral" \}\] : \[\]\), \{ href: "\/central"/, "Visão geral (Dashboards) é o primeiro item");
});

test("somente leitura e sem segredos: nenhum método de escrita na Meta e nenhum token no código", () => {
  const meta = readFileSync("src/lib/dashboards/meta.ts", "utf8");
  assert.doesNotMatch(meta, /method:\s*"(POST|PUT|PATCH|DELETE)"/i);
  assert.match(meta, /method: "GET"/);
  for (const f of ["src/lib/dashboards/meta.ts", "src/lib/dashboards/vendedoria.ts", "src/lib/dashboards/fixtures.ts", ".env.example", "README.md", "docs/dashboards.md"]) {
    let src = ""; try { src = readFileSync(f, "utf8"); } catch { continue; }
    assert.doesNotMatch(src, /EAA[A-Za-z0-9]{20,}/, `${f}: parece token da Meta`);
  }
});

test("menu recolhido: script antes da pintura (localStorage > cookie), tolera falhas e só marca 'collapsed'", () => {
  const run = (store: Record<string, string> | "throw", cookie: string) => {
    const attrs: Record<string, string> = {};
    const d = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, cookie };
    const ls = store === "throw" ? { getItem() { throw new Error("bloqueado"); } } : { getItem: (k: string) => store[k] ?? null };
    new Function("document", "localStorage", SIDEBAR_INIT_SCRIPT)(d, ls);
    return attrs["data-sidebar"];
  };
  assert.equal(run({ [SIDEBAR_KEY]: "collapsed" }, ""), "collapsed");
  assert.equal(run({}, `${SIDEBAR_KEY}=collapsed`), "collapsed", "cookie quando não há localStorage");
  assert.equal(run("throw", `a=1; ${SIDEBAR_KEY}=collapsed`), "collapsed");
  assert.equal(run({ [SIDEBAR_KEY]: "expanded" }, `${SIDEBAR_KEY}=collapsed`), undefined, "a escolha de expandir vence o cookie");
  assert.equal(run({}, ""), undefined);
  assert.equal(run({ [SIDEBAR_KEY]: "lixo" }, ""), undefined);
  const shell = readFileSync("src/components/shell/AppShell.tsx", "utf8");
  assert.match(shell, /try \{ localStorage\.setItem/);
  assert.match(shell, /document\.cookie/);
  assert.match(shell, /aria-pressed=\{recolhido\}/);
  assert.match(shell, /title=\{recolhido \? i\.label : undefined\}/);
  assert.match(readFileSync("src/app/layout.tsx", "utf8"), /SIDEBAR_INIT_SCRIPT/);
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /--sidebar-w: 72px/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*data-sidebar="collapsed"/);
  assert.match(css, /transition: margin-left/);
});
