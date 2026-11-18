// Canais (painel de mídia e tráfego): Graph só GET, parsing, coletor, relatório, evolução, segurança do token e isolamento.
// A Meta real NUNCA é chamada: tudo usa fetch simulado ou a API em memória.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { criarApiGraph, criarGraph, esconderToken, GraphErro, janelas, testarConexao } from "../src/lib/channels/graph";
import { evolucao, relAnuncios, relInstagram, serieSeguidores, somar, type Linha } from "../src/lib/channels/report";
import { coletarCanal, coletarTodos, metricasDaLinha, mensagemSegura } from "../src/lib/channels/collect";
import { carregarCanaisDoCliente } from "../src/lib/channels/cliente";
import { classificar, carregarCanaisClientes } from "../src/lib/channels/dashboards";
import { canaisFixtureAtiva, criarApiFixture } from "../src/lib/channels/fixture";
import { lerCamposCanal } from "../src/lib/channels/form";
import { atualizarAgora, testarConexaoCanal } from "../src/lib/channels/servico";
import { desconectarCanal, gravarSnapshots, lerSnapshots, obterCanal, resolverToken, salvarCanal, marcarColeta } from "../src/lib/channels/store";
import { resolverPeriodo } from "../src/lib/dashboards/periodo";
import { RESULTADO_PADRAO, type CanaisApi, type InsightBruto } from "../src/lib/channels/types";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession } from "../src/lib/mapa/scope";
import { liveAllowedCompanies } from "../src/lib/mapa/repo";
import { rawQuery } from "../src/lib/db/client";
import { navFor, hasChannels } from "../src/lib/mapa/nav";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const TOKEN = "EAAB-token-falso-de-teste-1234567890-ZZ99";
const sem = async () => undefined;
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

interface Chamada { url: URL; init?: RequestInit }
/** Graph simulada: roteia por caminho. `rota` devolve o corpo (ou Response). */
function graphFalsa(rota: (u: URL, n: number) => unknown) {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    chamadas.push({ url: u, init });
    const r = rota(u, chamadas.length);
    return r instanceof Response ? r : json(r);
  }) as typeof fetch;
  const g = criarGraph({ token: TOKEN, fetchImpl, sleep: sem, pausaMs: 0, baseDelayMs: 1, maxDelayMs: 2 });
  return { g, api: criarApiGraph(g), chamadas };
}
const erroMeta = (code: number, message = "erro", status = 400) => json({ error: { code, message } }, status);

// ─── Graph: só GET, token só no cabeçalho ────────────────────────────────────

test("Graph: só GET, só graph.facebook.com v21.0, token no cabeçalho (nunca na URL), filtro de campanhas e janelas de 30 dias", async () => {
  const { api, chamadas } = graphFalsa((u) => (u.pathname.endsWith("/insights") ? { data: [{ campaign_id: "1", date_start: "2026-11-01", spend: "10" }] } : { data: [] }));
  await api.insightsDiarios({ contaId: "act_605261696580859", nivel: "campaign", de: "2026-08-20", ate: "2026-11-16", campanhas: ["120252388371430661"] });
  await api.insightsDiarios({ contaId: "act_605261696580859", nivel: "ad", de: "2026-11-01", ate: "2026-11-16", campanhas: [] });
  await api.anuncios({ contaId: "act_605261696580859", campanhas: ["120252388371430661"] });
  assert.ok(chamadas.length >= 5);
  for (const c of chamadas) {
    assert.equal((c.init?.method ?? "GET").toUpperCase(), "GET");
    assert.equal(c.url.hostname, "graph.facebook.com");
    assert.ok(c.url.pathname.startsWith("/v21.0/"));
    assert.ok(!c.url.href.includes(TOKEN), "token fora da URL");
    assert.equal((c.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.equal(c.init?.body, undefined);
  }
  const camp = chamadas[0].url;
  assert.equal(camp.searchParams.get("level"), "campaign");
  assert.equal(camp.searchParams.get("time_increment"), "1");
  assert.deepEqual(JSON.parse(camp.searchParams.get("filtering")!), [{ field: "campaign.id", operator: "IN", value: ["120252388371430661"] }]);
  for (const f of ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "frequency", "actions", "campaign_id"]) assert.ok(camp.searchParams.get("fields")!.split(",").includes(f), f);
  // 2026-08-20..2026-11-16 = 89 dias → 3 janelas de até 30 dias
  assert.equal(chamadas.filter((c) => c.url.pathname.endsWith("/insights") && c.url.searchParams.get("level") === "campaign").length, 3);
  const ad = chamadas.find((c) => c.url.searchParams.get("level") === "ad")!.url;
  assert.ok(ad.searchParams.get("fields")!.includes("ad_id"));
  assert.equal(ad.searchParams.get("filtering"), null);
  assert.deepEqual(janelas("2026-11-01", "2026-11-16"), [["2026-11-01", "2026-11-16"]]);
  assert.equal(janelas("2026-10-01", "2026-11-30").length, 3);
});

test("Graph: recusa conta inválida, paginação fora do host e nunca usa método diferente de GET", async () => {
  const { api, g } = graphFalsa((u) => (u.pathname.endsWith("/media") ? { data: [], paging: { next: "https://evil.example.com/x" } } : { data: [] }));
  await assert.rejects(api.insightsDiarios({ contaId: "act_1; drop", nivel: "campaign", de: "2026-11-01", ate: "2026-11-02", campanhas: [] }), GraphErro);
  await assert.rejects(g.paginar("123456/media"), /inesperado/);
  await assert.rejects(api.igPerfil("abc"), GraphErro);
});

test("Graph: retry em 429/5xx e em erro transitório/limite com HTTP 400; token inválido não tenta de novo", async () => {
  let n = 0;
  const a = graphFalsa(() => (++n < 3 ? new Response("{}", { status: 503 }) : { data: [] }));
  await a.api.insightsDiarios({ contaId: "act_123", nivel: "campaign", de: "2026-11-01", ate: "2026-11-02", campanhas: [] });
  assert.equal(n, 3);
  n = 0;
  const b = graphFalsa(() => (++n < 3 ? erroMeta(4, "limite") : { data: [] }));
  await b.api.insightsDiarios({ contaId: "act_123", nivel: "campaign", de: "2026-11-01", ate: "2026-11-02", campanhas: [] });
  assert.equal(n, 3);
  n = 0;
  const c = graphFalsa(() => { n++; return erroMeta(190, `Invalid OAuth access token ${TOKEN}`, 401); });
  await assert.rejects(c.api.igPerfil("1789"), (e: any) => e instanceof GraphErro && e.codigo === "token" && !e.message.includes(TOKEN) && !(e.detalhe ?? "").includes(TOKEN));
  assert.equal(n, 1);
});

test("criativos: tenta miniatura grande e cai para o campo simples quando a Meta recusa; URLs de imagem são sanitizadas", async () => {
  let n = 0;
  const { api, chamadas } = graphFalsa((u) => {
    n++;
    if (n === 1) return erroMeta(100, "Invalid fields");
    return { data: [
      { id: "11", name: "A1 | Estático", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "9", creative: { thumbnail_url: "https://scontent.xx.fbcdn.net/a.jpg", image_url: "javascript:alert(1)", video_id: "55" } },
      { id: "12", name: "A2", creative: { thumbnail_url: "//cdn.test/b.jpg" } },
    ] };
  });
  const r = await api.anuncios({ contaId: "act_123", campanhas: [] });
  assert.equal(chamadas.length, 2);
  assert.ok(chamadas[0].url.searchParams.get("fields")!.includes("thumbnail_width(400)"));
  assert.equal(r[0].thumb, "https://scontent.xx.fbcdn.net/a.jpg");
  assert.equal(r[0].imagem, null, "javascript: nunca vira imagem");
  assert.equal(r[0].videoId, "55");
  assert.equal(r[1].thumb, "https://cdn.test/b.jpg");
});

// ─── Instagram ───────────────────────────────────────────────────────────────

test("Instagram: total_value por dia, seguidores diários (end_time = fim do dia) e métrica indisponível vira 'indisponível' sem derrubar as outras", async () => {
  const { api, chamadas } = graphFalsa((u) => {
    const m = u.searchParams.get("metric") ?? "";
    if (m === "follower_count") return { data: [{ name: "follower_count", period: "day", values: [{ value: 3, end_time: "2026-11-11T08:00:00+0000" }, { value: -1, end_time: "2026-11-12T08:00:00+0000" }] }] };
    if (m.includes(",")) return erroMeta(100, "(#100) metric[1] must be one of the following values: reach, ...");
    if (m === "views") return erroMeta(100, "(#100) The views metric is not supported for this account");
    return { data: [{ name: m, period: "day", total_value: { value: m === "reach" ? 321 : 7 } }] };
  });
  const seg = await api.igSeguidoresDiarios("1784", "2026-11-01", "2026-11-15");
  assert.deepEqual(seg, { "2026-11-10": 3, "2026-11-11": -1 });
  const r = await api.igMetricasDia("1784", "2026-11-10", new Set());
  assert.equal(r.valores.reach, 321);
  assert.equal(r.valores.profile_views, 7);
  assert.deepEqual(r.indisponiveis, ["views"]);
  const dia = chamadas.find((c) => c.url.searchParams.get("metric_type"))!.url;
  assert.equal(dia.searchParams.get("period"), "day");
  assert.equal(dia.searchParams.get("metric_type"), "total_value");
  assert.equal(dia.searchParams.get("since"), "2026-11-10");
  assert.equal(dia.searchParams.get("until"), "2026-11-11");
  // métricas já conhecidas como indisponíveis não são pedidas de novo
  const antes = chamadas.length;
  const r2 = await api.igMetricasDia("1784", "2026-11-09", new Set(["views"]));
  assert.ok(!("views" in r2.valores));
  assert.ok(chamadas.slice(antes).every((c) => !(c.url.searchParams.get("metric") ?? "").split(",").includes("views")));
  // erro que NÃO é de métrica (limite/token) propaga
  const lim = graphFalsa(() => erroMeta(190, "token", 401));
  await assert.rejects(lim.api.igMetricasDia("1784", "2026-11-09", new Set()), GraphErro);
});

test("Instagram: mídias recentes com insights, fallback por métrica e permalink/thumbnail sanitizados", async () => {
  const { api } = graphFalsa((u) => {
    if (u.pathname.endsWith("/media")) return { data: [
      { id: "m1", media_type: "VIDEO", media_product_type: "REELS", caption: "x".repeat(300), permalink: "https://www.instagram.com/reel/a/", thumbnail_url: "https://cdn.test/t.jpg", timestamp: "2026-11-10T15:00:00+0000", like_count: 50, comments_count: 4 },
      { id: "m2", media_type: "IMAGE", permalink: "http://inseguro", media_url: "javascript:x", timestamp: "2026-11-08T15:00:00+0000", like_count: 9 },
      { id: "m3", media_type: "IMAGE", timestamp: "2025-01-01T00:00:00+0000" },
    ] };
    if (u.pathname.endsWith("/m1/insights")) return { data: [{ name: "reach", total_value: { value: 900 } }, { name: "saved", values: [{ value: 12 }] }, { name: "shares", total_value: { value: 3 } }, { name: "total_interactions", total_value: { value: 70 } }, { name: "views", total_value: { value: 1500 } }] };
    return erroMeta(100, "metric not supported");
  });
  const r = await api.igMidias("1784", "2026-10-01", 10, () => true);
  assert.equal(r.length, 2);
  assert.equal(r[0].alcance, 900); assert.equal(r[0].salvos, 12); assert.equal(r[0].views, 1500); assert.equal(r[0].legenda!.length, 160);
  assert.equal(r[1].permalink, null); assert.equal(r[1].thumb, null); assert.equal(r[1].alcance, null);
  assert.equal(r[1].likes, 9);
});

// ─── Teste de conexão ────────────────────────────────────────────────────────

test("teste de conexão: lista permissões que faltam, reconhece conta/Página/Instagram e jamais devolve o token", async () => {
  const { g, chamadas } = graphFalsa((u) => {
    const p = u.pathname.replace("/v21.0/", "");
    if (p === "me") return { id: "1", name: "avanteza-leitura" };
    if (p === "me/permissions") return { data: [{ permission: "ads_read", status: "granted" }, { permission: "read_insights", status: "granted" }, { permission: "instagram_basic", status: "granted" }, { permission: "pages_read_engagement", status: "declined" }] };
    if (p === "act_605261696580859") return { name: "Conta Avanteza", account_status: 1, currency: "BRL" };
    if (p === "act_605261696580859/insights") return { data: [] };
    if (p === "act_605261696580859/campaigns") return { data: [{ id: "120252388371430661", name: "SHOW MAN | Assinatura", effective_status: "ACTIVE" }] };
    if (p === "5550001") return { name: "Showman", instagram_business_account: { id: "1784", username: "showman" } };
    if (p === "1784") return { username: "showman", followers_count: 2480, media_count: 87 };
    if (p === "1784/insights") return erroMeta(10, "(#10) Application does not have permission for this action", 403);
    return erroMeta(100, "?");
  });
  const r = await testarConexao(g, { adAccountId: "act_605261696580859", campaignIds: ["120252388371430661"], igUserId: null, pageId: "5550001" });
  const por = (id: string) => r.verificacoes.find((v) => v.id === id)!;
  assert.equal(por("token").ok, true);
  assert.deepEqual(r.faltando, ["instagram_manage_insights", "pages_read_engagement"]);
  assert.equal(por("permissoes").ok, false);
  assert.match(por("conta").detalhe, /Conta Avanteza.*Ativa.*BRL/);
  assert.equal(por("campanhas").ok, true);
  assert.match(por("pagina").detalhe, /@showman \(ID 1784\)/);
  assert.equal(r.info.ig_sugerido, "1784");
  assert.equal(por("instagram").ok, true);
  assert.equal(por("ig_insights").ok, false);
  assert.match(por("ig_insights").detalhe, /instagram_manage_insights/);
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  for (const c of chamadas) assert.equal((c.init?.method ?? "GET").toUpperCase(), "GET");
});

test("teste de conexão: token inválido interrompe cedo; campanha não encontrada é apontada", async () => {
  const a = graphFalsa(() => erroMeta(190, "bad token", 401));
  const r = await testarConexao(a.g, { adAccountId: "act_1234", campaignIds: [], igUserId: null, pageId: null });
  assert.equal(r.ok, false); assert.equal(r.verificacoes.length, 1); assert.equal(r.faltando.length, 5);
  const b = graphFalsa((u) => {
    const p = u.pathname.replace("/v21.0/", "");
    if (p === "me") return { id: "1", name: "x" };
    if (p === "me/permissions") return { data: [] };
    if (p === "act_1234") return { name: "Conta", account_status: 2, currency: "USD" };
    if (p.endsWith("/campaigns")) return { data: [{ id: "1", name: "Outra", effective_status: "PAUSED" }] };
    return { data: [] };
  });
  const r2 = await testarConexao(b.g, { adAccountId: "act_1234", campaignIds: ["999"], igUserId: null, pageId: null });
  assert.equal(r2.verificacoes.find((v) => v.id === "campanhas")!.ok, false);
  assert.match(r2.verificacoes.find((v) => v.id === "campanhas")!.detalhe, /999/);
  assert.match(r2.verificacoes.find((v) => v.id === "conta")!.detalhe, /Desativada/);
});

test("esconderToken e mensagens de erro nunca carregam o token", () => {
  assert.ok(!esconderToken(`falha com ${TOKEN} e access_token=${TOKEN}&x=1 e Bearer ${TOKEN}`, TOKEN).includes(TOKEN));
  assert.ok(!mensagemSegura(new GraphErro(`erro ${TOKEN}`, "api"), TOKEN).includes(TOKEN));
  assert.equal(mensagemSegura(new Error(`vazou ${TOKEN}`), TOKEN), "Falha inesperada na coleta.");
});

test("formulário: normaliza act_, valida IDs e nunca aceita lixo", () => {
  const fd = (o: Record<string, string | undefined>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, v); return f; };
  const ok = lerCamposCanal(fd({ ad_account_id: " 605261696580859 ", campaign_ids: "120252388371430661, 120252388371430661", ig_user_id: "17841", page_id: "1000", token: `${TOKEN}  \n`, use_platform_token: "on" }));
  assert.ok("campos" in ok);
  if ("campos" in ok) {
    assert.equal(ok.campos.adAccountId, "act_605261696580859");
    assert.deepEqual(ok.campos.campaignIds, ["120252388371430661"]);
    assert.equal(ok.campos.token, TOKEN);
    assert.equal(ok.campos.usarTokenPlataforma, true);
    assert.equal(ok.campos.resultActionType, RESULTADO_PADRAO);
  }
  for (const ruim of [{ ad_account_id: "act_abc" }, { campaign_ids: "12,xx" }, { ig_user_id: "@showman" }, { page_id: "1; drop" }, { token: "curto" }, { result_action_type: "a b!" }]) assert.ok("erro" in lerCamposCanal(fd(ruim)), JSON.stringify(ruim));
});

// ─── Relatório (puro) ────────────────────────────────────────────────────────

const L = (kind: Linha["kind"], date: string, key: string, metrics: Record<string, unknown>): Linha => ({ kind, date, key, metrics });
const camp = (date: string, spend: number, results: number, extra: Record<string, unknown> = {}) => L("campaign_daily", date, "C1", { nome: "Camp 1", spend, impressions: spend * 100, clicks: Math.round(spend * 2), results, ...extra });
const ad = (date: string, id: string, spend: number, results: number, extra: Record<string, unknown> = {}) => L("ad_daily", date, id, { nome: `Anúncio ${id}`, campaign_id: "C1", spend, impressions: spend * 100, clicks: Math.round(spend * 2), results, ...extra });

test("somar: custo por resultado, CTR e CPC; zero resultados = sem custo por resultado (nada inventado)", () => {
  const t = somar([camp("2026-11-01", 50, 10), camp("2026-11-02", 50, 0)]);
  assert.equal(t.gasto, 100); assert.equal(t.resultados, 10); assert.equal(t.custoPorResultado, 10); assert.equal(t.ctr, 2); assert.equal(t.cpc, 0.5);
  assert.equal(somar([camp("2026-11-01", 50, 0)]).custoPorResultado, null);
  assert.equal(somar([]).gasto, 0);
});

test("metricasDaLinha: resultado = action_type configurado; sem a ação, zero", () => {
  const l: InsightBruto = { spend: "12.5", impressions: "1000", clicks: "20", reach: "800", frequency: "1.25", actions: [{ action_type: RESULTADO_PADRAO, value: "3" }, { action_type: "link_click", value: "20" }] };
  const m = metricasDaLinha(l, RESULTADO_PADRAO, "x");
  assert.deepEqual([m.spend, m.results, m.ctr, m.cpc, m.frequency], [12.5, 3, 2, 0.63, 1.25]);
  assert.equal(metricasDaLinha(l, "lead", "x").results, 0);
  assert.equal(metricasDaLinha({}, RESULTADO_PADRAO, "x").ctr, null);
});

test("relAnuncios: variação vs. anterior, série diária, ranking só com gasto mínimo, ordem por resultados e selos melhor/pior", () => {
  const per = resolverPeriodo("7", "2026-11-16"); // 10/11..16/11; anterior 03/11..09/11
  const rows: Linha[] = [];
  for (let d = 3; d <= 16; d++) { const dia = `2026-11-${String(d).padStart(2, "0")}`; rows.push(camp(dia, 40, d >= 10 ? 8 : 4)); }
  for (const dia of ["2026-11-10", "2026-11-12"]) {
    rows.push(ad(dia, "A1", 20, 6), ad(dia, "A2", 15, 2), ad(dia, "A3", 1, 0), ad(dia, "A4", 25, 0, { effective_status: "PAUSED" }));
  }
  rows.push(ad("2026-11-12", "A5", 30, 3, { image: "javascript:alert(1)", thumb: "https://cdn.test/x.jpg" }));
  const r = relAnuncios(rows, per, []);
  assert.equal(r.atual.gasto, 280); assert.equal(r.atual.resultados, 56);
  assert.equal(r.anterior!.gasto, 280); assert.equal(r.anterior!.resultados, 28);
  assert.equal(r.serie.length, 7); assert.equal(r.serie[0].data, "2026-11-10");
  assert.equal(r.campanhas.length, 1);
  const rk = r.criativos;
  assert.equal(rk.minGasto, 30);
  assert.deepEqual(rk.ranking.map((c) => c.id), ["A1", "A2", "A5", "A4"], "A3 (R$ 2) fica de fora; ordem por resultados, depois custo");
  assert.equal(rk.foraDoRanking, 1); assert.equal(rk.totalAnuncios, 5);
  assert.equal(rk.ranking[0].selo, "melhor");
  assert.equal(rk.ranking.find((c) => c.id === "A4")!.selo, "pior", "gastou e não converteu");
  assert.equal(rk.ranking.find((c) => c.id === "A4")!.ativo, false);
  assert.equal(rk.ranking.find((c) => c.id === "A5")!.thumb, "https://cdn.test/x.jpg", "imagem insegura descartada, cai para a miniatura");
  // filtro de campanhas: outra campanha não aparece
  const f = relAnuncios(rows, per, ["OUTRA"]);
  assert.equal(f.atual.gasto, 0); assert.equal(f.criativos.ranking.length, 0);
  // um anúncio só: sem selos
  const um = relAnuncios([ad("2026-11-12", "A1", 50, 5)], per, []);
  assert.equal(um.criativos.ranking[0].selo, null);
  // sem dados no período
  assert.equal(relAnuncios([camp("2026-01-01", 10, 1)], per, []).temDadosNoPeriodo, false);
});

test("seguidores: usa o valor absoluto e reconstrói os dias anteriores pela variação líquida diária", () => {
  const rows = [L("ig_daily", "2026-11-16", "account", { followers: 1000, follower_net: 2 }), L("ig_daily", "2026-11-15", "account", { follower_net: 5 }), L("ig_daily", "2026-11-14", "account", { follower_net: -1 })];
  const s = serieSeguidores(rows, "2026-11-13", "2026-11-16");
  assert.deepEqual(s.map((x) => [x.data, x.valor]), [["2026-11-13", 994], ["2026-11-14", 993], ["2026-11-15", 998], ["2026-11-16", 1000]]);
  assert.deepEqual(serieSeguidores([], "2026-11-01", "2026-11-02"), []);
});

test("relInstagram: KPIs com variação, métrica ausente = indisponível (não zero), mídias ordenadas por interações", () => {
  const per = resolverPeriodo("7", "2026-11-16");
  const rows: Linha[] = [];
  for (let d = 3; d <= 16; d++) rows.push(L("ig_daily", `2026-11-${String(d).padStart(2, "0")}`, "account", { reach: d >= 10 ? 200 : 100, profile_views: 10 }));
  rows.push(L("ig_daily", "2026-11-16", "account", { followers: 500, indisponiveis: ["views"] }));
  rows.push(L("ig_media", "2026-11-10", "m1", { type: "VIDEO", product: "REELS", likes: 10, comments: 1, saved: 2, shares: 1, reach: 900, thumb: "https://cdn.test/a.jpg", permalink: "https://www.instagram.com/p/a/", timestamp: "2026-11-10T10:00:00Z" }));
  rows.push(L("ig_media", "2026-11-08", "m2", { type: "IMAGE", likes: 50, comments: 5, thumb: "javascript:x", timestamp: "2026-11-08T10:00:00Z" }));
  const r = relInstagram(rows, per);
  const k = (id: string) => r.kpis.find((x) => x.id === id)!;
  assert.equal(k("reach").atual, 1400); assert.equal(k("reach").anterior, 700); assert.equal(k("reach").variacao, 100);
  assert.equal(k("views").disponivel, false); assert.equal(k("views").atual, null);
  assert.equal(k("accounts_engaged").disponivel, false);
  assert.deepEqual(r.midias.map((m) => m.id), ["m2", "m1"]);
  assert.equal(r.midias[1].rotulo, "Reel"); assert.equal(r.midias[0].thumb, null); assert.equal(r.midias[1].permalink, "https://www.instagram.com/p/a/");
  assert.ok(r.indisponiveis.includes("Visualizações"));
  assert.equal(r.seguidores.atual, 500);
  assert.equal(relInstagram([], per).temDados, false);
});

test("evolução: meses com período em andamento comparado aos MESMOS dias do mês anterior; semanas começam na segunda", () => {
  const rows: Linha[] = [];
  const add = (iso: string, gasto: number, res: number) => rows.push(camp(iso, gasto, res));
  for (let d = 1; d <= 30; d++) add(`2026-10-${String(d).padStart(2, "0")}`, 10, 1); // outubro: 300 / 30
  for (let d = 1; d <= 16; d++) add(`2026-11-${String(d).padStart(2, "0")}`, 20, 4); // novembro até o dia 16: 320 / 64
  const m = evolucao(rows, "mes", "2026-11-16", []);
  assert.deepEqual(m.map((x) => x.id), ["2026-10-01", "2026-11-01"]);
  assert.equal(m[0].rotulo, "out/26"); assert.equal(m[1].rotulo, "nov/26");
  assert.equal(m[1].parcial, true); assert.equal(m[0].parcial, false); assert.equal(m[0].inicioParcial, false);
  assert.equal(m[1].gasto, 320); assert.equal(m[1].resultados, 64); assert.equal(m[1].custoPorResultado, 5);
  assert.equal(m[1].anterior!.gasto, 160, "outubro, só os primeiros 16 dias");
  assert.equal(m[1].anterior!.resultados, 16);
  assert.equal(m[0].anterior, null);
  const w = evolucao(rows, "semana", "2026-11-16", []);
  assert.equal(w[0].id, "2026-09-28"); // 01/10/2026 é quinta; a semana começa na segunda 28/09
  assert.equal(w[0].inicioParcial, true);
  assert.equal(w[w.length - 1].id, "2026-11-16");
  assert.deepEqual(evolucao([], "mes", "2026-11-16", []), []);
});

// ─── Fixture ─────────────────────────────────────────────────────────────────

test("fixture: ignorada em produção (NODE_ENV e VERCEL_ENV); traz os 6 anúncios reais e dados determinísticos", async () => {
  assert.equal(canaisFixtureAtiva({ CHANNELS_FIXTURE: "1" } as any), true);
  assert.equal(canaisFixtureAtiva({ CHANNELS_FIXTURE: "1", NODE_ENV: "production" } as any), false);
  assert.equal(canaisFixtureAtiva({ CHANNELS_FIXTURE: "1", VERCEL_ENV: "production" } as any), false);
  assert.equal(canaisFixtureAtiva({} as any), false);
  const api = criarApiFixture("2026-11-16");
  const ads = await api.anuncios({ contaId: "act_1", campanhas: [] });
  assert.deepEqual(ads.map((a) => a.nome), ["A1 | Estático | Ilimitado R$69,90", "A2 | Estático | 4 motivos", "A3 | Estático | Barbearia do Floresta", "A1V | Vídeo | Ilimitado R$69,90", "A2V | Vídeo | 4 motivos", "A3V | Vídeo | Barbearia do Floresta"]);
  const a = await api.insightsDiarios({ contaId: "act_1", nivel: "ad", de: "2026-11-10", ate: "2026-11-11", campanhas: [] });
  const b = await api.insightsDiarios({ contaId: "act_1", nivel: "ad", de: "2026-11-10", ate: "2026-11-11", campanhas: [] });
  assert.deepEqual(a, b); assert.equal(a.length, 12);
});

// ─── Rotina: configuração do cron e da rota ──────────────────────────────────

test("cron: rota /api/cron/channels no vercel.json (1×/dia, no horário já agrupado) e job registrado, protegido pelo CRON_SECRET", () => {
  const v = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const c = v.crons.find((x: any) => x.path === "/api/cron/channels");
  assert.ok(c, "cron de canais");
  assert.match(c.schedule, /^3 10 \* \* \*$/);
  const rota = readFileSync(new URL("../src/app/api/cron/[job]/route.ts", import.meta.url), "utf8");
  assert.match(rota, /channels:\s*\(\)\s*=>\s*rotinaCanais/);
  assert.match(rota, /authorizeCron\(req\)/);
});

test("ações do admin: todas exigem requireOwner e nenhuma chamada de escrita à Meta existe em src/lib/channels", () => {
  const acoes = readFileSync(new URL("../src/app/(painel)/clientes/canais-actions.ts", import.meta.url), "utf8");
  const exportadas = [...acoes.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exportadas.sort(), ["atualizarAnunciosAgora", "atualizarGoogleAgoraAcao", "atualizarInstagramAgora", "desconectarAnuncios", "desconectarGoogleAcao", "desconectarInstagram", "reiniciarContagemAcao", "salvarAlertaGastoAcao", "salvarAnunciosMeta", "salvarGoogleCanal", "salvarInstagramCanal", "salvarTetoMetaAcao", "testarConexaoGoogleAcao", "testarConexaoMeta", "testarConexaoWindsorAcao", "testarConexaoWindsorAdsAcao"]);
  for (const nome of exportadas) {
    const corpo = acoes.slice(acoes.indexOf(`export async function ${nome}`)).split(/\nexport async function /)[0];
    assert.match(corpo, /await requireOwner\(\)/, nome);
  }
  for (const f of ["graph.ts", "windsor.ts", "windsor-gbp.ts", "gbp.ts", "collect.ts", "servico.ts", "store.ts"]) {
    const src = readFileSync(new URL(`../src/lib/channels/${f}`, import.meta.url), "utf8");
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(src), `${f}: só GET`);
  }
  // Escrita na Meta só existe no módulo de GESTÃO (conector do Claude, com travas próprias): src/lib/channels/meta-gestao.ts.
  const escritores = readdirSync(new URL("../src/lib/channels/", import.meta.url)).filter((f) => /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(readFileSync(new URL(`../src/lib/channels/${f}`, import.meta.url), "utf8")));
  assert.deepEqual(escritores, ["meta-gestao.ts"]);
  const graph = readFileSync(new URL("../src/lib/channels/graph.ts", import.meta.url), "utf8");
  assert.equal([...graph.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]).join(","), "GET");
});

test("menu: Canais só para tipos midia e ambos (marketplace nunca vê)", () => {
  assert.ok(!navFor("marketplace").some((i) => i.href === "/mapa/canais"));
  assert.ok(navFor("midia").some((i) => i.href === "/mapa/canais"));
  assert.ok(navFor("ambos").some((i) => i.href === "/mapa/canais"));
  assert.equal(hasChannels("marketplace"), false);
});

test("dashboards: conta já lida pela Meta da agência não é somada de novo; agência fora do ar = incerto", () => {
  const okMeta: any = { estado: "ok", dados: { contas: [{ id: "act_1", ok: true }, { id: "act_2", ok: false }] } };
  assert.equal(classificar("act_1", okMeta), "ja-na-agencia");
  assert.equal(classificar("act_2", okMeta), "somada", "conta que falhou na agência não entrou nos totais");
  assert.equal(classificar("act_9", okMeta), "somada");
  assert.equal(classificar("act_1", { estado: "indisponivel", codigo: "rede", motivo: "x" }), "incerto");
  assert.equal(classificar("act_1", { estado: "nao-configurado", motivo: "x" }), "somada");
});

// ─── Banco: token cifrado, coletor idempotente, isolamento ───────────────────

let showman = "", outro = "", mkt = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  showman = await mkClient("Showman", { slug: "showman", kind: "midia" });
  outro = await mkClient("Outra Mídia", { slug: "outra-midia", kind: "midia" });
  mkt = await mkClient("Loja Marketplace", { slug: "loja-mkt", kind: "marketplace" });
  await mkUser("show@cliente.com", showman);
  await mkUser("outra@cliente.com", outro);
  await mkUser("loja@cliente.com", mkt);
});
after(async () => { if (!skip) await closeDb(); });

const scopeDe = async (email: string, ids: string[]) => {
  const sess = await verifySessionFull(await signSession(email, process.env.SESSION_SECRET!, 3600, "client", { clientIds: ids }), process.env.SESSION_SECRET!);
  return scopeFromSession(sess, null, null, await liveAllowedCompanies(email))!;
};
const entrada = (o: Partial<Parameters<typeof salvarCanal>[1]> = {}) => ({ adAccountId: "act_605261696580859", campaignIds: ["120252388371430661"], igUserId: "17841400000000", pageId: "100200300", usarTokenPlataforma: false, token: TOKEN, ...o });

test("schema: tabelas de canais idempotentes, unicidade do snapshot e checks", { skip }, async () => {
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await assert.rejects(rawQuery("insert into avanteza.channel_snapshots (client_id, kind, date, key) values ($1,'invalido','2026-11-01','k')", [showman]));
  await assert.rejects(rawQuery("insert into avanteza.client_channels (client_id, provider) values ($1,'tiktok')", [showman]));
});

test("token: cifrado em repouso (AES-256-GCM), hint = 4 últimos caracteres, nunca devolvido pelas leituras; trocar sem token novo mantém o antigo", { skip }, async () => {
  const c = await salvarCanal(showman, entrada());
  assert.equal(c.tokenHint, TOKEN.slice(-4));
  assert.equal(c.temToken, true);
  assert.ok(!JSON.stringify(c).includes(TOKEN));
  assert.ok(!JSON.stringify(await obterCanal(showman)).includes(TOKEN));
  const [cru] = await rawQuery<{ token_enc: string }>("select token_enc from avanteza.client_channels where client_id = $1", [showman]);
  assert.match(cru.token_enc, /^v1:/);
  assert.ok(!cru.token_enc.includes(TOKEN));
  assert.equal((await resolverToken(showman))!.token, TOKEN);
  await salvarCanal(showman, entrada({ token: null, campaignIds: [] }));
  assert.equal((await resolverToken(showman))!.token, TOKEN, "sem token novo, mantém o salvo");
  assert.deepEqual((await obterCanal(showman))!.campaignIds, []);
  await salvarCanal(showman, entrada({ token: "OUTRO-TOKEN-bem-longo-9876543210-QQ" }));
  assert.equal((await obterCanal(showman))!.tokenHint, "OUTRO-TOKEN-bem-longo-9876543210-QQ".slice(-4));
});

test("token da plataforma: só vale se autorizado no canal e com META_ACCESS_TOKEN; desconectar apaga o token e mantém o histórico", { skip }, async () => {
  await salvarCanal(outro, entrada({ token: null, usarTokenPlataforma: false }));
  assert.equal(await resolverToken(outro, { META_ACCESS_TOKEN: "plat-token-123456789" } as any), null);
  await salvarCanal(outro, entrada({ token: null, usarTokenPlataforma: true }));
  assert.equal(await resolverToken(outro, {} as any), null, "sem a variável não há token");
  assert.deepEqual(await resolverToken(outro, { META_ACCESS_TOKEN: "plat-token-123456789" } as any), { token: "plat-token-123456789", origem: "plataforma" });
  await gravarSnapshots(outro, [{ kind: "campaign_daily", date: "2026-11-10", key: "C", metrics: { spend: 5 } }]);
  await desconectarCanal(outro);
  const c = (await obterCanal(outro))!;
  assert.equal(c.status, "desconectado"); assert.equal(c.temToken, false); assert.equal(c.tokenHint, null); assert.equal(c.usarTokenPlataforma, false);
  assert.equal(await resolverToken(outro, { META_ACCESS_TOKEN: "plat-token-123456789" } as any), null);
  assert.equal((await lerSnapshots(outro, ["campaign_daily"], "2026-11-01", "2026-11-30")).length, 1);
});

test("teste de conexão com token da plataforma diz claramente se ela enxerga a conta; sem token explica o que fazer", { skip }, async () => {
  const antes = process.env.META_ACCESS_TOKEN;
  const orig = globalThis.fetch;
  try {
    delete process.env.META_ACCESS_TOKEN;
    const sem_ = await testarConexaoCanal({ clientId: mkt, cfg: { adAccountId: "act_123456", campaignIds: [], igUserId: null, pageId: null }, usarTokenPlataforma: true });
    assert.equal(sem_.ok, false); assert.match(sem_.verificacoes[0].detalhe, /Nenhum token disponível/);
    process.env.META_ACCESS_TOKEN = "plataforma-token-falso-0000";
    const vistos: string[] = [];
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      vistos.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
      const p = new URL(String(url)).pathname.replace("/v21.0/", "");
      if (p === "me") return json({ id: "1", name: "app" });
      if (p === "me/permissions") return json({ data: [] });
      return erroMeta(100, "Unsupported get request. Object with ID 'act_123456' does not exist", 400);
    }) as typeof fetch;
    const r = await testarConexaoCanal({ clientId: mkt, cfg: { adAccountId: "act_123456", campaignIds: [], igUserId: null, pageId: null }, usarTokenPlataforma: true });
    assert.equal(r.origemToken, "plataforma");
    assert.match(r.verificacoes.find((v) => v.id === "conta")!.detalhe, /da plataforma \(META_ACCESS_TOKEN\) NÃO enxerga esta conta/);
    assert.ok(vistos.every((v) => v.startsWith("GET ")));
    assert.ok(!JSON.stringify(r).includes("plataforma-token-falso-0000"));
  } finally {
    globalThis.fetch = orig;
    if (antes === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = antes;
  }
});

/** API em memória com contadores, para o coletor. */
function apiMemoria(): CanaisApi & { chamadas: string[] } {
  const chamadas: string[] = [];
  const f = criarApiFixture("2026-11-16");
  const embrulha = <K extends keyof CanaisApi>(k: K) => (...a: any[]) => { chamadas.push(k); return (f[k] as any)(...a); };
  return {
    chamadas,
    testar: embrulha("testar") as any, insightsDiarios: embrulha("insightsDiarios") as any, anuncios: embrulha("anuncios") as any, igPerfil: embrulha("igPerfil") as any,
    igSeguidoresDiarios: embrulha("igSeguidoresDiarios") as any, igMetricasDia: embrulha("igMetricasDia") as any, igMidias: embrulha("igMidias") as any,
  };
}

test("coletor: grava campanhas, anúncios, Instagram e mídias; rodar de novo não duplica (upsert) e preserva campos antigos", { skip }, async () => {
  await salvarCanal(showman, entrada({ token: null, campaignIds: ["120252388371430661"] }));
  const canal = (await obterCanal(showman))!;
  const api = apiMemoria();
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) => { logs.push(a.join(" ")); };
  let r1, r2;
  try {
    r1 = await coletarCanal(canal, api, { hoje: "2026-11-16", dias: 90, maxMs: 120_000 }, TOKEN);
    const contar = async () => Number((await rawQuery<{ n: number }>("select count(*)::int n from avanteza.channel_snapshots where client_id = $1", [showman]))[0].n);
    const n1 = await contar();
    r2 = await coletarCanal((await obterCanal(showman))!, api, { hoje: "2026-11-16", dias: 90, maxMs: 120_000 }, TOKEN);
    assert.equal(await contar(), n1, "idempotente");
  } finally { Object.assign(console, orig); }
  assert.ok(r1.ok && r2.ok);
  assert.ok(!logs.join("\n").includes(TOKEN));
  const k = async (kind: any) => (await lerSnapshots(showman, [kind], "2026-08-01", "2026-11-16"));
  assert.equal((await k("campaign_daily")).length, 90);
  assert.equal((await k("ad_daily")).length, 90 * 6);
  assert.ok((await k("ig_daily")).length >= 89);
  assert.ok((await k("ig_media")).length >= 8);
  const hoje = (await k("ig_daily")).find((x) => x.date === "2026-11-16")!;
  assert.ok(hoje.metrics.followers > 2000, "seguidores do dia gravados");
  const umAd = (await k("ad_daily"))[0];
  assert.ok(umAd.metrics.nome && umAd.metrics.effective_status, "criativo/estado mesclados");
  const c = (await obterCanal(showman))!;
  assert.equal(c.status, "ativo"); assert.ok(c.lastSyncAt); assert.equal(c.lastError, null); assert.equal(c.info.ig_username, "showman.floresta");
  assert.ok(api.chamadas.filter((x) => x === "insightsDiarios").length >= 4);
});

test("coletor: falha numa parte não perde as outras; erro guardado sem token; tempo esgotado é parcial", { skip }, async () => {
  const base = apiMemoria();
  const quebrado: CanaisApi = { ...base, insightsDiarios: async () => { throw new GraphErro(`O token ${TOKEN} expirou`, "token"); } };
  const canal = (await obterCanal(showman))!;
  const r = await coletarCanal(canal, quebrado, { hoje: "2026-11-16", dias: 7, maxMs: 60_000 }, TOKEN);
  assert.equal(r.ok, true, "Instagram continuou");
  assert.ok(r.erro && !r.erro.includes(TOKEN));
  const c = (await obterCanal(showman))!;
  assert.ok(c.lastError && !c.lastError.includes(TOKEN));
  const tudoQuebra: CanaisApi = { ...base, insightsDiarios: async () => { throw new GraphErro("x", "token"); }, igPerfil: async () => { throw new GraphErro("x", "token"); }, igMetricasDia: async () => { throw new GraphErro("x", "token"); }, igMidias: async () => { throw new GraphErro("x", "token"); } };
  const r2 = await coletarCanal(canal, tudoQuebra, { hoje: "2026-11-16", dias: 7, maxMs: 60_000 }, TOKEN);
  assert.equal(r2.ok, false);
  assert.equal((await obterCanal(showman))!.status, "erro");
  let t = 0;
  const r3 = await coletarCanal(canal, base, { hoje: "2026-11-16", dias: 7, maxMs: 1000, agora: () => (t += 2000) }, null);
  assert.equal(r3.parcial, true);
});

test("coletarTodos: um canal por vez, pula sem credencial e respeita o tempo total", { skip }, async () => {
  await salvarCanal(mkt, entrada({ token: null, usarTokenPlataforma: false }));
  const api = apiMemoria();
  const visitados: string[] = [];
  const r = await coletarTodos({ maxMs: 300_000, incluirSemToken: true, apiPara: async (c) => { visitados.push(c.clientId); return c.clientId === mkt ? null : { api, token: null }; } });
  assert.ok(visitados.includes(showman) && visitados.includes(mkt));
  assert.ok(r.resultados.some((x: any) => x.clientId === mkt && x.pulado === "sem credencial"));
  assert.ok(r.resultados.some((x: any) => x.clientId === showman && x.ok === true));
  // sem incluirSemToken, o canal sem credencial nem entra
  const so = await coletarTodos({ maxMs: 300_000, apiPara: async () => ({ api, token: null }) });
  assert.ok(!so.resultados.some((x: any) => x.clientId === mkt));
  // tempo total esgotado: pula
  let t = 0;
  const esgot = await coletarTodos({ maxMs: 10_000, incluirSemToken: true, agora: () => (t += 20_000), apiPara: async () => ({ api, token: null }) });
  assert.ok(esgot.resultados.every((x: any) => x.pulado));
});

test("atualizarAgora: backfill de 90 dias com a API injetada; sem credencial devolve instrução", { skip }, async () => {
  const api = apiMemoria();
  const r = await atualizarAgora(showman, { meta: async () => ({ api, token: null }) });
  assert.equal(r.ok, true); assert.match(r.mensagem, /registros gravados/);
  assert.equal((await atualizarAgora(showman, { meta: async () => null })).ok, false);
  assert.equal((await atualizarAgora("00000000-0000-0000-0000-000000000000", { meta: async () => null })).ok, false);
});

test("isolamento (IDOR): cada cliente só vê os próprios canais; saída nunca traz token, hint, conta, Página ou Instagram", { skip }, async () => {
  // dados distintos para o "outro" cliente (reconectado)
  await salvarCanal(outro, entrada({ campaignIds: [], adAccountId: "act_999000111", igUserId: "17841999999999", pageId: "777888999", token: "TOKEN-DO-OUTRO-CLIENTE-000111222333" }));
  await marcarColeta(outro, { ok: true });
  await gravarSnapshots(outro, [
    { kind: "campaign_daily", date: "2026-11-15", key: "CO", metrics: { nome: "CAMPANHA SECRETA DO OUTRO", spend: 777, impressions: 1000, clicks: 10, results: 3 } },
    { kind: "ad_daily", date: "2026-11-15", key: "AO", metrics: { nome: "ANUNCIO SECRETO DO OUTRO", campaign_id: "CO", spend: 777, results: 3 } },
    { kind: "ig_media", date: "2026-11-14", key: "MO", metrics: { type: "IMAGE", caption: "LEGENDA SECRETA DO OUTRO", timestamp: "2026-11-14T10:00:00Z", likes: 1 } },
  ]);
  const sShow = await scopeDe("show@cliente.com", [showman]);
  const sOutro = await scopeDe("outra@cliente.com", [outro]);
  const a = await carregarCanaisDoCliente(sShow, "90", "2026-11-16");
  const b = await carregarCanaisDoCliente(sOutro, "90", "2026-11-16");
  const ta = JSON.stringify(a), tb = JSON.stringify(b);
  assert.ok(a.anuncios!.atual.gasto > 0);
  for (const proprio of ["120252388371430661", "6900000000", "act_605261696580859"]) assert.ok(!ta.includes(proprio), `IDs externos não saem: ${proprio}`);
  for (const secreto of ["SECRETA DO OUTRO", "act_999000111", "17841999999999", "777888999", "TOKEN-DO-OUTRO", "000111222333"]) assert.ok(!ta.includes(secreto), `A não vê ${secreto}`);
  assert.ok(tb.includes("CAMPANHA SECRETA DO OUTRO"));
  for (const secreto of ["act_605261696580859", "17841400000000", "100200300", TOKEN, TOKEN.slice(-4), "120252388371430661", "A1 | Estático"]) assert.ok(!tb.includes(secreto), `B não vê ${secreto}`);
  for (const t of [ta, tb]) {
    assert.ok(!/token|act_\d|ad_account|page_id|ig_user/i.test(t.replace(/"(spark|tokens?)"/g, "")), "sem campos internos");
  }
  // escopo forjado é recusado
  await assert.rejects(carregarCanaisDoCliente({ clientId: showman, allowedClientIds: [showman], readOnly: false, userEmail: "x@x" } as any, "30"), /Escopo/);
});

test("estados vazios: sem canal ou sem coleta nada é inventado; cliente de marketplace sem canal", { skip }, async () => {
  const sMkt = await scopeDe("loja@cliente.com", [mkt]);
  const d = await carregarCanaisDoCliente(sMkt, "30", "2026-11-16");
  assert.equal(d.estado.conectado, false); assert.equal(d.anuncios, null); assert.equal(d.instagram, null); assert.equal(d.evolucao, null);
  const novo = await mkClient("Sem Coleta", { slug: "sem-coleta", kind: "midia" });
  await mkUser("sem@cliente.com", novo);
  await salvarCanal(novo, entrada({ token: null }));
  const d2 = await carregarCanaisDoCliente(await scopeDe("sem@cliente.com", [novo]), "30", "2026-11-16");
  assert.equal(d2.estado.conectado, false); assert.equal(d2.estado.cadastrado, true); assert.equal(d2.anuncios, null);
});

test("cliente com canal sem Instagram: relatório de Instagram ausente (tela mostra 'Instagram não conectado')", { skip }, async () => {
  const c = await mkClient("So Anuncios", { slug: "so-anuncios", kind: "midia" });
  await mkUser("soads@cliente.com", c);
  await salvarCanal(c, entrada({ igUserId: null, pageId: null, token: null, campaignIds: [] }));
  await marcarColeta(c, { ok: true });
  await gravarSnapshots(c, [{ kind: "campaign_daily", date: "2026-11-15", key: "C", metrics: { nome: "C", spend: 10, impressions: 100, clicks: 2, results: 1 } }]);
  const d = await carregarCanaisDoCliente(await scopeDe("soads@cliente.com", [c]), "30", "2026-11-16");
  assert.equal(d.estado.instagram, false); assert.equal(d.instagram, null); assert.equal(d.anuncios!.atual.gasto, 10);
});

test("Dashboards: subtotal de canais de clientes sem dupla contagem e sem dados quebrando", { skip }, async () => {
  const per = resolverPeriodo("90", "2026-11-16").atual;
  const metaOk: any = { estado: "ok", dados: { contas: [{ id: "act_605261696580859", ok: true }] } };
  const d = await carregarCanaisClientes(per, metaOk);
  const sh = d.linhas.find((l) => l.cliente === "Showman")!;
  assert.equal(sh.situacao, "ja-na-agencia");
  assert.ok(sh.gasto > 0);
  const o = d.linhas.find((l) => l.cliente === "Outra Mídia")!;
  assert.equal(o.situacao, "somada"); assert.equal(o.gasto, 782, "777 do dia 15 + 5 do histórico preservado");
  const livre = await carregarCanaisClientes(per, { estado: "nao-configurado", motivo: "x" });
  assert.ok(livre.gastoSomado >= sh.gasto && livre.linhas.every((l) => l.situacao === "somada"));
  const incerto = await carregarCanaisClientes(per, { estado: "indisponivel", codigo: "rede", motivo: "x" });
  assert.equal(incerto.gastoSomado, 0);
});
