// Google · Perfil da Empresa (terceira fonte, Windsor.ai google_my_business): consultas separadas por grupo, parse das particularidades
// reais (estrelas em palavra, "None", valor 0 = oculto), números reais do Showman, histórico de avaliações acumulado por id,
// independência das outras fontes, isolamento por sessão e segredo fora de qualquer saída. O Windsor real NUNCA é chamado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { HAS_DB, TEST_URL, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { criarWindsorGbp, estrelasGbp, textoGbp, MSG_SEM_GBP, type FonteGoogleApi } from "../src/lib/channels/windsor-gbp";
import { fetchGbpFixture, criarGoogleFixture, respostaGbpFixture, GBP_REAL_30D, LOCAL_SHOWMAN, avaliacoesFixture } from "../src/lib/channels/fixture-gbp";
import { coletarGoogle, coletarGoogleTodos, mesesEntre } from "../src/lib/channels/gbp";
import { relGoogle, primeiroNome } from "../src/lib/channels/gbp-report";
import { linkGoogleSeguro } from "../src/lib/channels/links";
import { lerCamposGoogle } from "../src/lib/channels/form";
import { atualizarGoogleAgora, testarConexaoGoogle } from "../src/lib/channels/servico";
import { carregarCanaisDoCliente } from "../src/lib/channels/cliente";
import { coletarCanal } from "../src/lib/channels/collect";
import { criarApiFixture } from "../src/lib/channels/fixture";
import { desconectarGoogle, gravarSnapshots, lerSnapshots, marcarColeta, obterCanal, salvarAnuncios, salvarGoogle, salvarInstagram } from "../src/lib/channels/store";
import { resolverPeriodo } from "../src/lib/dashboards/periodo";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession } from "../src/lib/mapa/scope";
import { liveAllowedCompanies } from "../src/lib/mapa/repo";
import { rawQuery } from "../src/lib/db/client";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const HOJE = "2026-11-18";
const CHAVE = "wk-FALSA-google-1a2b3c4d5e6f7788";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const sem = async () => undefined;

/** Fonte real (parser de verdade) com o fetch falso das linhas do Showman. */
function fonteShowman(o: { local?: string | null; rota?: (u: URL, f: string[]) => unknown; hoje?: string } = {}) {
  const base = fetchGbpFixture(o.hoje ?? HOJE);
  const chamadas: URL[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    chamadas.push(u);
    assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
    const r = o.rota?.(u, (u.searchParams.get("fields") ?? "").split(","));
    if (r !== undefined) return r instanceof Response ? r : json(r);
    return base.fetchImpl(url, init);
  }) as typeof fetch;
  return { fonte: criarWindsorGbp({ chave: CHAVE, local: o.local === undefined ? LOCAL_SHOWMAN : o.local, fetchImpl, sleep: sem, baseDelayMs: 1, maxDelayMs: 2 }), chamadas };
}
const soma = (xs: Array<{ metrics: Record<string, any> }>, k: string) => xs.reduce((t, x) => t + (x.metrics[k] ?? 0), 0);

test("Google: só GET em connectors.windsor.ai/google_my_business, UMA consulta por grupo de campos, datas explícitas e api_key só na querystring", async () => {
  const { fonte, chamadas } = fonteShowman();
  await fonte.diario("2026-10-20", "2026-11-17");
  await fonte.avaliacoes("2026-10-20", HOJE);
  await fonte.palavras("2026-11-01", HOJE);
  await fonte.local(HOJE);
  const dados = chamadas.filter((u) => !u.pathname.endsWith("/fields"));
  assert.ok(dados.length >= 5);
  for (const u of chamadas) {
    assert.equal(u.hostname, "connectors.windsor.ai");
    assert.match(u.pathname, /^\/google_my_business(\/fields)?$/);
    assert.equal(u.searchParams.get("api_key"), CHAVE);
  }
  for (const u of dados) {
    assert.ok(u.searchParams.get("date_from") && u.searchParams.get("date_to"), "datas explícitas");
    assert.equal(u.searchParams.get("date_preset"), null);
    const f = u.searchParams.get("fields")!.split(",");
    const grupos = [f.some((x) => x.startsWith("impressions_")), f.includes("review_id"), f.includes("review_total_count"), f.includes("search_keyword"), f.includes("location_metadata_maps_uri")];
    assert.equal(grupos.filter(Boolean).length <= 1, true, `grupos misturados: ${f.join(",")}`);
  }
  const pal = dados.find((u) => u.searchParams.get("fields")!.includes("search_keyword"))!;
  assert.equal(pal.searchParams.get("date_from"), "2026-11-01");
  assert.equal(pal.searchParams.get("date_to"), HOJE);
});

test("Google: números reais do Showman em 30 dias — 177 visualizações (68/15/68/26), 69 rotas, 7 ligações, 6 cliques no site", async () => {
  const { fonte } = fonteShowman();
  const dias = await fonte.diario("2026-10-20", "2026-11-17");
  assert.equal(soma(dias, "maps_mobile"), 68); assert.equal(soma(dias, "maps_desktop"), 15);
  assert.equal(soma(dias, "search_mobile"), 68); assert.equal(soma(dias, "search_desktop"), 26);
  assert.equal(soma(dias, "maps_mobile") + soma(dias, "maps_desktop") + soma(dias, "search_mobile") + soma(dias, "search_desktop"), 177);
  assert.equal(soma(dias, "directions"), 69); assert.equal(soma(dias, "calls"), 7); assert.equal(soma(dias, "website"), 6);
  assert.ok(dias.every((d) => d.date >= "2026-10-20" && d.date <= "2026-11-17"));
});

test("Google: avaliações — estrela em palavra (FIVE→5), 'None' = sem texto/sem resposta, id preservado; 13 no período; nota 4,9 de 137", async () => {
  assert.equal(estrelasGbp("FIVE"), 5); assert.equal(estrelasGbp("four"), 4); assert.equal(estrelasGbp("STAR_RATING_UNSPECIFIED"), null); assert.equal(estrelasGbp("3"), 3);
  assert.equal(textoGbp("None"), null); assert.equal(textoGbp("  none "), null); assert.equal(textoGbp(""), null); assert.equal(textoGbp("Ótimo"), "Ótimo");
  const { fonte } = fonteShowman();
  const av = await fonte.avaliacoes("2026-10-20", HOJE);
  assert.equal(av.length, GBP_REAL_30D.avaliacoes);
  assert.ok(av.every((a) => a.id.startsWith("AbFvOq-fixture-")));
  assert.equal(av.filter((a) => a.metrics.stars === 5).length, 12);
  assert.equal(av.filter((a) => a.metrics.reply == null).length, 3, "sem resposta = None");
  assert.ok(av.some((a) => a.metrics.comment == null), "comentário None vira null");
  assert.ok(!av.some((a) => a.metrics.comment === "None" || a.metrics.reply === "None"));
  const l = await fonte.local(HOJE);
  assert.equal(l.rating_avg, 4.9); assert.equal(l.rating_count, 137);
  assert.equal(l.title, LOCAL_SHOWMAN); assert.equal(l.category, "Barbearia"); assert.equal(l.neighborhood, "Floresta"); assert.equal(l.city, "Goiânia");
});

test("Google: buscas — 'barbeiro' 35; valor 0 = oculto pelo Google (null, nunca zero); uma consulta por mês", async () => {
  const { fonte } = fonteShowman();
  const p = await fonte.palavras("2026-11-01", HOJE);
  assert.equal(p.find((x) => x.palavra === "barbeiro")?.valor, 35);
  const ocultas = p.filter((x) => x.valor == null).map((x) => x.palavra);
  assert.deepEqual(ocultas.sort(), ["barbearia floresta", "corte de cabelo masculino"]);
  assert.deepEqual(mesesEntre("2026-08-21", HOJE), ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"]);
  assert.deepEqual(mesesEntre("2025-12-15", "2026-01-02"), ["2025-12-01", "2026-01-01"]);
});

test("Google: local — sem filtro e com dois locais é erro claro (nunca mistura); filtro não casa = erro com os nomes; filtro casa sem caixa/acento", async () => {
  const dois = (u: URL, f: string[]) => {
    const linhas = respostaGbpFixture(HOJE, f, u.searchParams.get("date_from")!, u.searchParams.get("date_to")!);
    const outro = respostaGbpFixture(HOJE, f, u.searchParams.get("date_from")!, u.searchParams.get("date_to")!, "OUTRA BARBEARIA");
    return { data: [...linhas, ...outro] };
  };
  await assert.rejects(fonteShowman({ local: null, rota: dois }).fonte.diario("2026-10-20", "2026-11-17"), (e: any) => e.codigo === "varias_contas" && /OUTRA BARBEARIA/.test(e.message) && /SHOW MAN BARBEARIA/.test(e.message));
  await assert.rejects(fonteShowman({ local: "Barbearia Inexistente", rota: dois }).fonte.diario("2026-10-20", "2026-11-17"), (e: any) => e.codigo === "conta" && /Locais encontrados/.test(e.message));
  const dias = await fonteShowman({ local: "show man barbearia", rota: dois }).fonte.diario("2026-10-20", "2026-11-17");
  assert.equal(soma(dias, "directions"), 69, "só o local escolhido (não somou o outro)");
  // um só local e sem filtro: usa o único
  assert.equal(soma(await fonteShowman({ local: null }).fonte.diario("2026-10-20", "2026-11-17"), "calls"), 7);
});

test("Google: chave recusada e Perfil da Empresa não conectado viram mensagens claras em português, sem a chave", async () => {
  const r401 = fonteShowman({ rota: () => json({ error: `Invalid api_key ${CHAVE}` }, 401) });
  await assert.rejects(r401.fonte.diario("2026-11-01", "2026-11-17"), (e: any) => e.codigo === "chave" && !e.message.includes(CHAVE));
  const semConta = fonteShowman({ rota: () => json({ error: "no_accounts_configured" }) });
  await assert.rejects(semConta.fonte.avaliacoes("2026-11-01", HOJE), (e: any) => e.message === MSG_SEM_GBP);
  const t = await semConta.fonte.testar(HOJE);
  assert.equal(t.ok, false);
  assert.ok(t.verificacoes.some((v) => v.ok === false && v.detalhe === MSG_SEM_GBP));
  assert.ok(!JSON.stringify(t).includes(CHAVE));
});

test("Google: teste de conexão mostra local, dias, visualizações, avaliações, nota e buscas", async () => {
  const t = await fonteShowman().fonte.testar(HOJE);
  assert.equal(t.ok, true, JSON.stringify(t.verificacoes));
  assert.equal(t.info.local, LOCAL_SHOWMAN);
  assert.equal(t.info.nota, 4.9); assert.equal(t.info.totalAvaliacoes, 137);
  assert.ok(t.verificacoes.find((v) => v.id === "diario")!.detalhe.includes("rotas"));
  const errado = await fonteShowman({ local: "Outro Lugar" }).fonte.testar(HOJE);
  assert.equal(errado.ok, false);
  assert.match(errado.verificacoes.find((v) => v.id === "local")!.detalhe, /SHOW MAN BARBEARIA/);
});

test("links do Google: só https de google.com (e subdomínios), maps.app.goo.gl e g.page", () => {
  for (const ok of ["https://maps.google.com/maps?cid=1", "https://www.google.com/maps/place/x", "https://search.google.com/local/writereview?placeid=X", "https://maps.app.goo.gl/abc", "https://g.page/r/xyz/review"]) assert.ok(linkGoogleSeguro(ok), ok);
  for (const ruim of ["http://maps.google.com/x", "https://google.com.evil.com/x", "https://evilgoogle.com/x", "javascript:alert(1)", "https://user:pw@maps.google.com/", "https://maps.google.com:8443/", "https://goo.gl/x", "https://g.page.evil.io/x", 42, null]) assert.equal(linkGoogleSeguro(ruim), null, String(ruim));
});

test("relatório: primeiro nome só, nada de id; buscas do mês mais recente com o anterior; superfícies com %", () => {
  assert.equal(primeiroNome("João Pedro Silva"), "João"); assert.equal(primeiroNome("  "), "Cliente do Google"); assert.equal(primeiroNome(null), "Cliente do Google");
  const linhas = [
    ...respostaGbpFixture(HOJE, ["date", "impressions_mobile_maps", "impressions_desktop_maps", "impressions_mobile_search", "impressions_desktop_search", "direction_requests", "call_clicks", "website_clicks"], "2026-08-01", HOJE)
      .map((r: any) => ({ kind: "gbp_daily" as const, date: r.date, key: "local", metrics: { maps_mobile: r.impressions_mobile_maps, maps_desktop: r.impressions_desktop_maps, search_mobile: r.impressions_mobile_search, search_desktop: r.impressions_desktop_search, directions: r.direction_requests, calls: r.call_clicks, website: r.website_clicks } })),
    ...avaliacoesFixture(HOJE).map((r) => ({ kind: "gbp_review" as const, date: r.review_create_time.slice(0, 10), key: r.review_id, metrics: { stars: estrelasGbp(r.review_star_rating), reviewer: r.review_reviewer, comment: textoGbp(r.review_comment), reply: textoGbp(r.review_reply_comment), created_at: r.review_create_time } })),
    { kind: "gbp_keyword" as const, date: "2026-11-01", key: "barbeiro", metrics: { value: 35 } }, { kind: "gbp_keyword" as const, date: "2026-11-01", key: "barbearia floresta", metrics: { value: null } },
    { kind: "gbp_keyword" as const, date: "2026-10-01", key: "barbeiro", metrics: { value: 31 } },
    { kind: "gbp_profile" as const, date: HOJE, key: "local", metrics: { title: LOCAL_SHOWMAN, rating_avg: 4.9, rating_count: 137, maps_uri: "https://maps.google.com/maps?cid=1", review_uri: "javascript:alert(1)" } },
  ];
  const g = relGoogle(linhas, resolverPeriodo("30", HOJE));
  assert.equal(g.visualizacoes.atual, 177); assert.equal(g.rotas.atual, 69); assert.equal(g.ligacoes.atual, 7); assert.equal(g.site.atual, 6);
  assert.equal(g.maps.atual, 83); assert.equal(g.pesquisa.atual, 94);
  assert.deepEqual(g.superficies.map((s) => s.valor), [68, 15, 68, 26]);
  assert.ok(g.visualizacoes.variacao != null && g.visualizacoes.variacao > 0);
  assert.equal(g.conversas, null, "sem conversas no perfil: sem cartão");
  assert.equal(g.nota.media, 4.9); assert.equal(g.nota.total, 137); assert.equal(g.nota.noPeriodo, 13); assert.equal(g.nota.semResposta, 3);
  assert.deepEqual(g.nota.porEstrela, [0, 0, 0, 1, 12]);
  assert.equal(g.buscas.mes, "2026-11-01"); assert.equal(g.buscas.parcial, true);
  assert.deepEqual(g.buscas.itens[0], { termo: "barbeiro", valor: 35, anterior: 31 });
  assert.equal(g.buscas.itens.find((i) => i.termo === "barbearia floresta")?.valor, null);
  assert.equal(g.local?.mapsUrl, "https://maps.google.com/maps?cid=1"); assert.equal(g.local?.avaliarUrl, null);
  const txt = JSON.stringify(g);
  assert.ok(!/AbFvOq|Andrade|Souza|Lima\b/.test(txt), "nem id de avaliação nem sobrenome");
  assert.ok(g.avaliacoes.every((r) => /^r\d+$/.test(r.id) && !r.autor.includes(" ")));
});

test("formulário do Google: fonte e nome do local validados", () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  assert.deepEqual(lerCamposGoogle(fd({ gbp_source: "windsor", gbp_location_name: "  SHOW MAN   BARBEARIA " })), { campos: { gbpSource: "windsor", gbpLocationName: "SHOW MAN BARBEARIA" } });
  assert.deepEqual(lerCamposGoogle(fd({ gbp_source: "none", gbp_location_name: "x" })), { campos: { gbpSource: "none", gbpLocationName: null } });
  assert.ok("erro" in lerCamposGoogle(fd({ gbp_source: "meta" })));
  assert.ok("erro" in lerCamposGoogle(fd({ gbp_location_name: "<script>" })));
});

// ─── Banco ───────────────────────────────────────────────────────────────────

let g1 = "", g2 = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  g1 = await mkClient("Showman Google", { slug: "showman", kind: "midia" });
  g2 = await mkClient("Outra Google", { slug: "outra-g", kind: "midia" });
  await mkUser("g1@cliente.com", g1);
  await mkUser("g2@cliente.com", g2);
});
after(async () => { if (!skip) await closeDb(); });

const scopeDe = async (email: string, ids: string[]) => {
  const sess = await verifySessionFull(await signSession(email, process.env.SESSION_SECRET!, 3600, "client", { clientIds: ids }), process.env.SESSION_SECRET!);
  return scopeFromSession(sess, null, null, await liveAllowedCompanies(email))!;
};

test("schema: colunas gbp_* e kinds gbp_* existem; reaplicar é idempotente e não apaga a configuração", { skip }, async () => {
  await salvarGoogle(g2, { gbpSource: "windsor", gbpLocationName: "OUTRA" });
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const c = await obterCanal(g2);
  assert.equal(c?.gbpSource, "windsor"); assert.equal(c?.gbpLocationName, "OUTRA");
  for (const kind of ["gbp_daily", "gbp_review", "gbp_keyword", "gbp_profile"]) await gravarSnapshots(g2, [{ kind: kind as any, date: "2026-01-01", key: "k", metrics: {} }], "windsor");
  await assert.rejects(rawQuery("update avanteza.client_channels set gbp_source = 'meta' where client_id = $1", [g2]));
  await rawQuery("delete from avanteza.channel_snapshots where client_id = $1", [g2]);
  await desconectarGoogle(g2);
  assert.equal((await obterCanal(g2))?.gbpSource, "none");
});

test("coleta do Google: grava gbp_* com source 'windsor', idempotente, avaliações acumulam por id e a resposta posterior atualiza a mesma linha", { skip }, async () => {
  await salvarGoogle(g1, { gbpSource: "windsor", gbpLocationName: LOCAL_SHOWMAN });
  const canal = (await obterCanal(g1))!;
  const r = await coletarGoogle(canal, fonteShowman().fonte, CHAVE, { hoje: HOJE, dias: 90, maxMs: 60_000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.erro, null);
  assert.ok((r.linhas.gbp_daily ?? 0) >= 85 && r.linhas.gbp_review === 22 && (r.linhas.gbp_keyword ?? 0) > 0 && r.linhas.gbp_profile === 1);
  const contar = async () => (await rawQuery<{ kind: string; n: number }>("select kind, count(*)::int as n from avanteza.channel_snapshots where client_id = $1 group by kind order by kind", [g1]));
  const antes = await contar();
  await coletarGoogle(canal, fonteShowman().fonte, CHAVE, { hoje: HOJE, dias: 90, maxMs: 60_000 });
  assert.deepEqual(await contar(), antes, "idempotente");
  const fontes = await rawQuery<{ source: string }>("select distinct source from avanteza.channel_snapshots where client_id = $1", [g1]);
  assert.deepEqual(fontes.map((x) => x.source), ["windsor"]);
  // Dia seguinte, janela curta: o Windsor só devolve as avaliações recentes; as antigas continuam guardadas. Uma ganhou resposta.
  const respondida = (u: URL, f: string[]) => {
    if (!f.includes("review_id")) return undefined;
    const base = respostaGbpFixture(HOJE, f, u.searchParams.get("date_from")!, u.searchParams.get("date_to")!);
    return { data: base.map((x: any) => (x.review_id === "AbFvOq-fixture-001" ? { ...x, review_reply_comment: "Obrigado, Lucas!" } : x)) };
  };
  const r2 = await coletarGoogle((await obterCanal(g1))!, fonteShowman({ rota: respondida, hoje: "2026-11-19" }).fonte, CHAVE, { hoje: "2026-11-19", dias: 14, diasAvaliacoes: 10, maxMs: 60_000 });
  assert.equal(r2.ok, true);
  assert.ok((r2.linhas.gbp_review ?? 0) < 22, "janela curta trouxe poucas");
  const revs = await lerSnapshots(g1, ["gbp_review"], "2020-01-01", "2026-12-31", "windsor");
  assert.equal(revs.length, 22, "histórico acumulado");
  assert.equal(revs.find((x) => x.key === "AbFvOq-fixture-001")?.metrics.reply, "Obrigado, Lucas!");
  const c = (await obterCanal(g1))!;
  assert.ok(c.gbpLastSyncAt); assert.equal(c.gbpLastError, null); assert.equal(c.info.gbp_local, LOCAL_SHOWMAN);
});

test("independência: falha do Google não mexe em anúncios/Instagram, e falha deles não mexe no Google; erro sem a chave", { skip }, async () => {
  const outro = await mkClient("Indep Google", { slug: "indep-g", kind: "midia" });
  await salvarAnuncios(outro, { adAccountId: "act_605261696580859", campaignIds: [], usarTokenPlataforma: false, adsSource: "meta" });
  await salvarInstagram(outro, { igSource: "windsor", windsorAccountName: "x" });
  await salvarGoogle(outro, { gbpSource: "windsor", gbpLocationName: LOCAL_SHOWMAN });
  await marcarColeta(outro, { ok: true }, "ads");
  await marcarColeta(outro, { ok: true }, "instagram");
  const quebrado = fonteShowman({ rota: () => json({ error: `Invalid api_key ${CHAVE}` }, 401) });
  const r = await coletarGoogle((await obterCanal(outro))!, quebrado.fonte, CHAVE, { hoje: HOJE, dias: 7, maxMs: 30_000 });
  assert.equal(r.ok, false);
  let c = (await obterCanal(outro))!;
  assert.ok(c.gbpLastError && !c.gbpLastError.includes(CHAVE));
  assert.equal(c.lastError, null); assert.equal(c.igLastError, null); assert.equal(c.status, "ativo");
  // anúncios falham → Google intacto
  const meta = criarApiFixture(HOJE);
  meta.insightsDiarios = async () => { throw new Error("boom"); };
  await coletarCanal(c, meta, { hoje: HOJE, dias: 7, maxMs: 30_000, fontes: ["ads"] }, "tok");
  await coletarGoogle((await obterCanal(outro))!, fonteShowman().fonte, CHAVE, { hoje: HOJE, dias: 30, maxMs: 30_000 });
  c = (await obterCanal(outro))!;
  assert.ok(c.lastError); assert.equal(c.gbpLastError, null); assert.ok(c.gbpLastSyncAt);
  // Google parcial: uma parte falha, o resto é gravado
  const parcial = fonteShowman({ rota: (_u, f) => (f.includes("review_id") ? json({ error: "boom" }, 500) : undefined) });
  const rp = await coletarGoogle((await obterCanal(outro))!, parcial.fonte, CHAVE, { hoje: HOJE, dias: 7, maxMs: 30_000 });
  assert.equal(rp.ok, true); assert.match(rp.erro ?? "", /avaliações/);
});

test("Mapa: aba Google com os números reais (30 d), nota 4,9 de 137, 13 avaliações, 'barbeiro' 35; Evolução com Google; nada de id/nome completo", { skip }, async () => {
  // a coleta "do dia seguinte" do teste anterior gravou 18/11; volta ao estado de hoje (só o diário: as avaliações acumuladas ficam)
  await rawQuery("delete from avanteza.channel_snapshots where client_id = $1 and kind = 'gbp_daily'", [g1]);
  await coletarGoogle((await obterCanal(g1))!, fonteShowman().fonte, CHAVE, { hoje: HOJE, dias: 90, maxMs: 60_000 });
  const d = await carregarCanaisDoCliente(await scopeDe("g1@cliente.com", [g1]), "30", HOJE);
  assert.equal(d.estado.google, true); assert.equal(d.estado.googleConectado, true); assert.equal(d.estado.conectado, true);
  const g = d.google!;
  assert.equal(g.visualizacoes.atual, 177); assert.equal(g.rotas.atual, 69); assert.equal(g.ligacoes.atual, 7); assert.equal(g.site.atual, 6);
  assert.deepEqual(g.superficies.map((s) => s.valor), [GBP_REAL_30D.maps_mobile, GBP_REAL_30D.maps_desktop, GBP_REAL_30D.search_mobile, GBP_REAL_30D.search_desktop]);
  assert.equal(g.nota.media, 4.9); assert.equal(g.nota.total, 137); assert.equal(g.nota.noPeriodo, 13);
  assert.equal(g.buscas.itens.find((i) => i.termo === "barbeiro")?.valor, 35);
  assert.equal(g.local?.titulo, LOCAL_SHOWMAN); assert.match(g.local?.mapsUrl ?? "", /^https:\/\/maps\.google\.com\//);
  const nov = d.evolucao!.mes.find((m) => m.id === "2026-11-01")!;
  assert.ok(nov.google && nov.google.visualizacoes > 0 && nov.google.nota != null);
  const txt = JSON.stringify(d);
  assert.ok(!/AbFvOq|Andrade|Souza|wk-FALSA|gbp_location|windsor_key/.test(txt));
  assert.equal(d.anuncios, null, "anúncios não configurados continuam vazios");
});

test("isolamento (IDOR): o Google de um cliente nunca aparece para outro; escopo inválido é recusado", { skip }, async () => {
  await salvarGoogle(g2, { gbpSource: "windsor", gbpLocationName: "OUTRA" });
  await rawQuery("update avanteza.client_channels set gbp_last_sync_at = now() where client_id = $1", [g2]);
  await gravarSnapshots(g2, [
    { kind: "gbp_review", date: "2026-11-10", key: "SEGREDO-ID", metrics: { stars: 1, reviewer: "Fulano Secreto", comment: "COMENTARIO SECRETO", reply: null, created_at: "2026-11-10T10:00:00Z" } },
    { kind: "gbp_daily", date: "2026-11-10", key: "local", metrics: { directions: 4242 } },
  ], "windsor");
  const d1 = JSON.stringify(await carregarCanaisDoCliente(await scopeDe("g1@cliente.com", [g1]), "30", HOJE));
  const d2 = await carregarCanaisDoCliente(await scopeDe("g2@cliente.com", [g2]), "30", HOJE);
  for (const s of ["COMENTARIO SECRETO", "4242", "Fulano", "SEGREDO-ID"]) assert.ok(!d1.includes(s), s);
  assert.ok(JSON.stringify(d2).includes("COMENTARIO SECRETO"));
  assert.ok(!JSON.stringify(d2).includes("SEGREDO-ID") && !JSON.stringify(d2).includes("Secreto"));
  assert.equal(d2.google?.rotas.atual, 4242);
  await assert.rejects(carregarCanaisDoCliente({ clientId: g2, allowedClientIds: [g2], readOnly: false, userEmail: "x@x" } as any, "30"), /Escopo/);
});

test("serviço: Atualizar Google agora (90 dias), teste de conexão e rotina diária com a fábrica; sem config ou sem chave = mensagem clara", { skip }, async () => {
  const fabrica = async () => ({ fonte: fonteShowman().fonte as FonteGoogleApi, chave: CHAVE });
  const r = await atualizarGoogleAgora(g1, { fonte: fabrica, hoje: HOJE });
  assert.equal(r.ok, true, r.mensagem); assert.match(r.mensagem, /avaliação/);
  assert.ok(!r.mensagem.includes(CHAVE));
  const semCfg = await mkClient("Sem Google", { slug: "sem-g", kind: "midia" });
  assert.equal((await atualizarGoogleAgora(semCfg, { fonte: fabrica })).ok, false);
  await salvarGoogle(semCfg, { gbpSource: "windsor", gbpLocationName: null });
  const semChave = await atualizarGoogleAgora(semCfg, { fonte: async () => null });
  assert.equal(semChave.ok, false); assert.match(semChave.mensagem, /WINDSOR_API_KEY/);
  const t = await testarConexaoGoogle({ clientId: g1, local: LOCAL_SHOWMAN, fonte: criarGoogleFixture(HOJE), hoje: HOJE });
  assert.equal(t.ok, true);
  const rot = await coletarGoogleTodos({ maxMs: 60_000, hoje: HOJE, fontePara: async (c) => (c.clientId === semCfg ? null : fabrica()) });
  assert.ok(rot.canais >= 2);
  assert.ok(rot.resultados.some((x: any) => x.clientId === semCfg && x.pulado));
  assert.match((await obterCanal(semCfg))!.gbpLastError ?? "", /chave/);
});

test("seed do Showman: liga o Google (windsor, 'SHOW MAN BARBEARIA') mantendo anúncios, Instagram, alerta e status; rodar de novo não muda nada", { skip }, async () => {
  const roda = () => execFileSync(process.execPath, ["db/seed-canais-showman.mjs"], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, DATABASE_URL: TEST_URL }, encoding: "utf8" });
  await rawQuery("update avanteza.client_channels set gbp_source = 'none', gbp_location_name = null where client_id = $1", [g1]);
  const out = roda();
  assert.match(out, /Google=windsor/);
  const c = (await obterCanal(g1))!;
  assert.equal(c.gbpSource, "windsor"); assert.equal(c.gbpLocationName, LOCAL_SHOWMAN);
  assert.equal(c.adsSource, "windsor"); assert.equal(c.igSource, "windsor"); assert.equal(c.campaignNameFilter, "SHOW MAN"); assert.equal(c.alertaGasto?.limite, 400);
  const sync = c.gbpLastSyncAt;
  roda();
  assert.equal((await obterCanal(g1))!.gbpLastSyncAt, sync, "mesmo local: mantém a última coleta");
});
