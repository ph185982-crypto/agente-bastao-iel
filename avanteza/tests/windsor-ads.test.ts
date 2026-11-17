// Anúncios pelo Windsor.ai (conector facebook) como SEGUNDA fonte de anúncios (ads_source = 'windsor'): requisição só GET, linhas reais do Showman,
// filtro por conta e campanha, miniaturas sanitizadas, erro no_accounts_configured em português, coleta com source 'windsor' e leitura do cliente.
// O Windsor real NUNCA é chamado (fetch simulado). A chave abaixo é FALSA.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { criarWindsorAds, campoResultado } from "../src/lib/channels/windsor-ads";
import { WINDSOR_HOST } from "../src/lib/channels/windsor";
import { coletarCanal } from "../src/lib/channels/collect";
import { atualizarAgora, testarConexaoWindsorAds } from "../src/lib/channels/servico";
import { carregarCanaisDoCliente } from "../src/lib/channels/cliente";
import { lerCamposAnuncios } from "../src/lib/channels/form";
import { lerSnapshots, obterCanal, salvarAnuncios } from "../src/lib/channels/store";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession } from "../src/lib/mapa/scope";
import { liveAllowedCompanies } from "../src/lib/mapa/repo";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const CHAVE = "wk-FALSA-ads-9f8e7d6c5b4a3210";
const CONTA = "605261696580859";
const CAMP = "120252388371430661";
const NOME_CAMP = "SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km";
const RES = "actions_onsite_conversion_messaging_conversation_started_7d";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);
const sem = async () => undefined;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const THUMB = (n: string) => `https://scontent.xx.fbcdn.net/v/t45/${n}.jpg`;

// Linhas no formato do conector facebook do Windsor (conta act_605261696580859; A1 em 3 dias = 249,64 / 16.927 / 310 / 48 conversas)
const dia = (date: string, ad: [string, string] | null, v: { spend: number; impressions: number; clicks: number; res: number | null; reach?: number }, extra: Record<string, unknown> = {}) => ({
  date, account_id: CONTA, account_name: "Showman Barbearia", campaign_id: CAMP, campaign: NOME_CAMP,
  ...(ad ? { ad_id: ad[0], ad_name: ad[1], thumbnail_url: ad[0] === "a1" ? THUMB("a1") : ad[0] === "a2" ? "javascript:alert(1)" : null } : {}),
  spend: v.spend, impressions: v.impressions, reach: v.reach ?? Math.round(v.impressions * 0.8), clicks: v.clicks, ctr: ((v.clicks / v.impressions) * 100).toFixed(2), cpc: (v.spend / v.clicks).toFixed(2), frequency: "1.25",
  [RES]: v.res, ...extra,
});
const A1 = ["a1", "A1 Estático Ilimitado R$69,90"] as [string, string];
const A2 = ["a2", "A2 Estático Corte + Barba"] as [string, string];
const A3 = ["a3", "A3 Estático Combo"] as [string, string];
const A1V = ["a1v", "A1V Vídeo Ilimitado"] as [string, string];
const A2V = ["a2v", "A2V Vídeo Corte"] as [string, string];
const A3V = ["a3v", "A3V Vídeo Combo"] as [string, string];
const LINHAS_AD = [
  dia("2026-11-10", A1, { spend: 100, impressions: 7000, clicks: 130, res: 20 }), dia("2026-11-11", A1, { spend: 80, impressions: 5927, clicks: 100, res: 16 }), dia("2026-11-12", A1, { spend: 69.64, impressions: 4000, clicks: 80, res: 12 }),
  dia("2026-11-10", A2, { spend: 40, impressions: 3000, clicks: 40, res: 5 }), dia("2026-11-11", A3, { spend: 35, impressions: 2500, clicks: 30, res: null }),
  dia("2026-11-11", A1V, { spend: 33, impressions: 2000, clicks: 25, res: 4 }), dia("2026-11-12", A2V, { spend: 20, impressions: 1500, clicks: 15, res: 2 }), dia("2026-11-12", A3V, { spend: 10, impressions: 900, clicks: 5, res: 0 }),
];
const LINHAS_CAMP = [
  dia("2026-11-10", null, { spend: 140, impressions: 10000, clicks: 170, res: 25 }), dia("2026-11-11", null, { spend: 148, impressions: 10427, clicks: 155, res: 20 }), dia("2026-11-12", null, { spend: 99.64, impressions: 6400, clicks: 100, res: 14 }),
];
const OUTRA_CONTA = dia("2026-11-10", null, { spend: 999, impressions: 99999, clicks: 999, res: 99 }, { account_id: "111222333", account_name: "Outra Conta", campaign_id: "999", campaign: "Outra" });
const OUTRA_CAMP = dia("2026-11-10", null, { spend: 500, impressions: 5000, clicks: 50, res: 7 }, { campaign_id: "777", campaign: "Campanha de outro objetivo" });

interface Chamada { url: URL; init?: RequestInit }
function windsorFalso(rota?: (u: URL, f: string[]) => unknown, o: { contaId?: string | null; campaignIds?: string[] } = {}) {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    chamadas.push({ url: u, init });
    const f = (u.searchParams.get("fields") ?? "").split(",");
    const r = rota ? rota(u, f) : undefined;
    if (r instanceof Response) return r;
    if (r !== undefined) return json(r);
    if (u.pathname.endsWith("/fields")) return json(["date", "account_id", "account_name", "campaign_id", "campaign", "spend", "impressions", "reach", "clicks", "ctr", "cpc", "frequency", "ad_id", "ad_name", "status", "effective_status", "thumbnail_url", RES, "x1", "x2", "x3", "x4", "x5"]);
    const ad = f.includes("ad_id");
    if (ad && f.includes("status")) return json({ data: [A1, A2, A3, A1V, A2V, A3V].map(([id, nome], i) => ({ ad_id: id, ad_name: nome, campaign_id: CAMP, account_id: CONTA, status: "ACTIVE", effective_status: i === 1 ? "PAUSED" : "ACTIVE", thumbnail_url: id === "a2" ? "javascript:alert(1)" : THUMB(id) })) });
    const base = ad ? LINHAS_AD : LINHAS_CAMP;
    return json({ data: [...base, OUTRA_CONTA, OUTRA_CAMP].map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => f.includes(k)))) });
  }) as typeof fetch;
  const fonte = criarWindsorAds({ chave: CHAVE, contaId: o.contaId === undefined ? `act_${CONTA}` : o.contaId, campaignIds: o.campaignIds ?? [CAMP], fetchImpl, sleep: sem, baseDelayMs: 1, maxDelayMs: 2 });
  return { fonte, chamadas, fetchImpl };
}
const SEM_CONECTOR = { error: "no_accounts_configured: No accounts configured for connector facebook. Connect one at https://onboard.windsor.ai?datasource=facebook" };

test("campoResultado: action_type da Meta vira o campo actions_… do Windsor", () => {
  assert.equal(campoResultado("onsite_conversion.messaging_conversation_started_7d"), RES);
});

test("Windsor Ads: só GET em connectors.windsor.ai/facebook, campos reais e chave só na querystring", async () => {
  const { fonte, chamadas } = windsorFalso();
  await fonte.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "campaign", de: "2026-08-19", ate: "2026-11-16", campanhas: [CAMP] });
  await fonte.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "ad", de: "2026-08-19", ate: "2026-11-16", campanhas: [CAMP] });
  assert.equal(chamadas.length, 2);
  for (const c of chamadas) {
    assert.equal((c.init?.method ?? "GET").toUpperCase(), "GET");
    assert.equal(c.init?.body, undefined);
    assert.equal(c.url.hostname, WINDSOR_HOST);
    assert.equal(c.url.pathname, "/facebook");
    assert.equal(c.url.searchParams.get("api_key"), CHAVE);
    assert.equal(c.url.searchParams.get("date_from"), "2026-08-19");
    assert.ok(!JSON.stringify(c.init?.headers ?? {}).includes(CHAVE));
  }
  const camp = chamadas[0].url.searchParams.get("fields")!.split(",");
  for (const c of ["date", "account_id", "campaign_id", "campaign", "spend", "impressions", "reach", "clicks", "ctr", "cpc", RES]) assert.ok(camp.includes(c), c);
  assert.ok(!camp.includes("ad_id"));
  const ad = chamadas[1].url.searchParams.get("fields")!.split(",");
  for (const c of ["ad_id", "ad_name", "thumbnail_url"]) assert.ok(ad.includes(c), c);
});

test("Windsor Ads: linhas reais do Showman — A1 = R$ 249,64, 16.927 impressões, 310 cliques, 48 conversas; filtra por conta e campanha", async () => {
  const { fonte } = windsorFalso();
  const camp = await fonte.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "campaign", de: "2026-08-19", ate: "2026-11-16", campanhas: [CAMP] });
  assert.equal(camp.length, 3, "outra conta e outra campanha ficam de fora");
  assert.ok(camp.every((x) => x.campaign_id === CAMP && x.campaign_name === NOME_CAMP));
  const ads = await fonte.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "ad", de: "2026-08-19", ate: "2026-11-16", campanhas: [CAMP] });
  const a1 = ads.filter((x) => x.ad_id === "a1");
  assert.equal(a1.length, 3);
  const soma = (k: "spend" | "impressions" | "clicks") => Math.round(a1.reduce((t, x) => t + Number(x[k]), 0) * 100) / 100;
  assert.equal(soma("spend"), 249.64); assert.equal(soma("impressions"), 16927); assert.equal(soma("clicks"), 310);
  assert.equal(a1.reduce((t, x) => t + Number(x.actions![0].value), 0), 48);
  assert.equal(a1[0].actions![0].action_type, "onsite_conversion.messaging_conversation_started_7d");
  assert.equal(new Set(ads.map((x) => x.ad_id)).size, 6);
  const a3 = ads.find((x) => x.ad_id === "a3")!;
  assert.equal(a3.actions, undefined, "null = sem ação (nada de zero inventado)");
});

test("Windsor Ads: criativos com miniatura sanitizada (javascript: nunca vira imagem), status e nome", async () => {
  const { fonte } = windsorFalso();
  await fonte.insightsDiarios({ contaId: CONTA, nivel: "ad", de: "2026-08-19", ate: "2026-11-16", campanhas: [CAMP] });
  const infos = await fonte.anuncios({ contaId: CONTA, campanhas: [CAMP] });
  assert.equal(infos.length, 6);
  const a1 = infos.find((a) => a.id === "a1")!;
  assert.equal(a1.nome, "A1 Estático Ilimitado R$69,90"); assert.equal(a1.thumb, THUMB("a1")); assert.equal(a1.statusEfetivo, "ACTIVE"); assert.equal(a1.campanhaId, CAMP);
  assert.equal(infos.find((a) => a.id === "a2")!.statusEfetivo, "PAUSED"); assert.equal(infos.find((a) => a.id === "a2")!.thumb, null);
  // sem a consulta de status: segue só com nome e miniatura válida
  const { fonte: f2 } = windsorFalso((_u, f) => (f.includes("status") ? json({ error: "unknown_field: effective_status" }, 400) : undefined));
  await f2.insightsDiarios({ contaId: CONTA, nivel: "ad", de: "2026-08-19", ate: "2026-11-16", campanhas: [CAMP] });
  const so = await f2.anuncios({ contaId: CONTA, campanhas: [CAMP] });
  assert.equal(so.find((a) => a.id === "a1")!.thumb, THUMB("a1")); assert.equal(so.find((a) => a.id === "a2")!.thumb, null); assert.equal(so[0].statusEfetivo, null);
});

test("Windsor Ads: várias contas sem conta informada são recusadas; conta desconhecida lista as disponíveis", async () => {
  const { fonte } = windsorFalso(undefined, { contaId: null, campaignIds: [] });
  await assert.rejects(() => fonte.insightsDiarios({ contaId: "", nivel: "campaign", de: "2026-11-01", ate: "2026-11-16", campanhas: [] }), (e: Error) => /2 contas de anúncios/.test(e.message) && !e.message.includes(CHAVE));
  const { fonte: f2 } = windsorFalso(undefined, { contaId: "act_42" });
  await assert.rejects(() => f2.insightsDiarios({ contaId: "act_42", nivel: "campaign", de: "2026-11-01", ate: "2026-11-16", campanhas: [] }), (e: Error) => /não enxerga a conta de anúncios 42/.test(e.message) && /605261696580859/.test(e.message));
});

test("Windsor Ads: no_accounts_configured vira mensagem clara em português e o teste marca 'semConector' (sem vazar a chave)", async () => {
  const { fonte } = windsorFalso(() => SEM_CONECTOR);
  await assert.rejects(() => fonte.insightsDiarios({ contaId: CONTA, nivel: "campaign", de: "2026-11-01", ate: "2026-11-16", campanhas: [] }), (e: Error) => /Conecte o Facebook Ads nesta conta do Windsor/.test(e.message) && /onboard\.windsor\.ai\?datasource=facebook/.test(e.message) && !e.message.includes(CHAVE));
  const r = await fonte.testar();
  assert.equal(r.ok, false); assert.equal(r.semConector, true);
  assert.match(r.verificacoes[0].detalhe, /Conecte o Facebook Ads nesta conta do Windsor/);
  assert.ok(!JSON.stringify(r).includes(CHAVE));
  const { fonte: f2 } = windsorFalso(() => json(SEM_CONECTOR, 400));
  assert.equal((await f2.testar()).semConector, true);
});

test("Windsor Ads: teste de conexão mostra conta, campanhas, anúncios, gasto e resultados lidos; campanha inexistente falha", async () => {
  const { fonte } = windsorFalso();
  const r = await fonte.testar();
  assert.equal(r.ok, true, JSON.stringify(r.verificacoes));
  assert.ok(r.info.contas.some((c) => c.id === CONTA && c.nome === "Showman Barbearia"));
  assert.deepEqual(r.info.campanhas.map((c) => c.id).sort(), [CAMP, "777"], "lista todas as campanhas da conta para o admin escolher");
  assert.equal(r.info.anuncios, 6);
  assert.equal(r.info.gasto, 387.64); assert.equal(r.info.resultados, 59);
  assert.ok(r.info.comMiniatura >= 1);
  assert.ok(r.verificacoes.some((v) => v.id === "campos" && v.ok === true));
  const { fonte: f2 } = windsorFalso(undefined, { campaignIds: ["555"] });
  const r2 = await f2.testar();
  assert.equal(r2.ok, false); assert.match(r2.verificacoes.find((v) => v.id === "campanhas")!.detalhe, /555/);
  const t = await testarConexaoWindsorAds({ clientId: "x", contaId: CONTA, campaignIds: [], fonte });
  assert.equal(t.origemChave, "nenhuma");
});

test("formulário: ads_source 'windsor' exige a conta, aceita sem token e nunca guarda token da Meta", () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  assert.ok("erro" in lerCamposAnuncios(fd({ ads_source: "windsor" })));
  const r = lerCamposAnuncios(fd({ ads_source: "windsor", ad_account_id: "act_605261696580859", campaign_ids: CAMP, token: "EAAB-token-qualquer-1234567890-abcdef" }));
  assert.ok("campos" in r);
  if ("campos" in r) { assert.equal(r.campos.adsSource, "windsor"); assert.equal(r.campos.adAccountId, `act_${CONTA}`); assert.equal(r.campos.token, null); }
  assert.ok("erro" in lerCamposAnuncios(fd({ ads_source: "outra" })));
});

test("esquema e telas: check ads_source aceita windsor; Início usa as marcas e o bloco só para clientes com canais", () => {
  assert.match(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"), /ads_source in \('meta','windsor','none'\)/);
  const inicio = readFileSync(new URL("../src/components/canais/InicioMidia.tsx", import.meta.url), "utf8");
  assert.match(inicio, /marca="meta"/); assert.match(inicio, /marca="instagram"/);
  assert.match(readFileSync(new URL("../src/app/mapa/page.tsx", import.meta.url), "utf8"), /hasChannels\(client\.kind\) \? await carregarCanaisDoCliente/);
});

// ─── Banco ───────────────────────────────────────────────────────────────────

let c1 = "", c2 = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  c1 = await mkClient("Showman Ads Windsor", { slug: "showman-aw", kind: "midia" });
  c2 = await mkClient("Sem conector", { slug: "sem-conector", kind: "midia" });
  await mkUser("aw1@cliente.com", c1); await mkUser("aw2@cliente.com", c2);
});
after(async () => { if (!skip) await closeDb(); });
const scopeDe = async (email: string, ids: string[]) => {
  const sess = await verifySessionFull(await signSession(email, process.env.SESSION_SECRET!, 3600, "client", { clientIds: ids }), process.env.SESSION_SECRET!);
  return scopeFromSession(sess, null, null, await liveAllowedCompanies(email))!;
};
const OPC = { hoje: "2026-11-16", dias: 90, maxMs: 120_000, fontes: ["ads" as const] };

test("coleta de anúncios pelo Windsor: grava campaign_daily e ad_daily com source 'windsor' (nada como Meta), idempotente, e o cliente enxerga os números", { skip }, async () => {
  await salvarAnuncios(c1, { adAccountId: `act_${CONTA}`, campaignIds: [CAMP], usarTokenPlataforma: false, token: null, adsSource: "windsor" });
  const { fonte } = windsorFalso();
  const canal = (await obterCanal(c1))!;
  assert.equal(canal.adsSource, "windsor");
  const r1 = await coletarCanal(canal, null, OPC, null, null, { api: fonte, chave: CHAVE });
  assert.ok(r1.ok && r1.ads!.origem === "windsor", JSON.stringify(r1.ads));
  const n = async () => (await lerSnapshots(c1, ["campaign_daily", "ad_daily"], "2026-01-01", "2026-12-31", "windsor")).length;
  const n1 = await n();
  assert.equal(n1, 3 + 8);
  await coletarCanal((await obterCanal(c1))!, null, OPC, null, null, { api: fonte, chave: CHAVE });
  assert.equal(await n(), n1, "idempotente");
  assert.equal((await lerSnapshots(c1, ["campaign_daily", "ad_daily"], "2026-01-01", "2026-12-31", "meta")).length, 0);
  const a1 = (await lerSnapshots(c1, ["ad_daily"], "2026-11-10", "2026-11-12", "windsor")).find((x) => x.key === "a1" && String(x.date).includes("2026-11-10"))!;
  assert.equal(a1.metrics.results, 20); assert.equal(a1.metrics.thumb, THUMB("a1")); assert.equal(a1.metrics.effective_status, "ACTIVE");
  const c = (await obterCanal(c1))!;
  assert.ok(c.lastSyncAt); assert.equal(c.lastError, null);
  const d = await carregarCanaisDoCliente(await scopeDe("aw1@cliente.com", [c1]), "30", "2026-11-16");
  assert.equal(d.estado.fonteAnuncios, "windsor"); assert.equal(d.estado.anunciosConectado, true);
  assert.equal(d.anuncios!.atual.gasto, 387.64); assert.equal(d.anuncios!.atual.resultados, 59);
  const top = d.anuncios!.criativos.ranking[0];
  assert.equal(top.nome, "A1 Estático Ilimitado R$69,90"); assert.equal(top.gasto, 249.64); assert.equal(top.resultados, 48); assert.equal(top.impressoes, 16927); assert.equal(top.cliques, 310);
  assert.ok(!JSON.stringify(d).includes(CONTA) && !JSON.stringify(d).includes(CAMP) && !JSON.stringify(d).includes(CHAVE), "nenhum ID de conta/campanha/chave sai para a tela");
});

test("sem o conector Facebook Ads no Windsor: coleta falha com mensagem clara, o cliente segue em 'Conectando anúncios' e nada é gravado", { skip }, async () => {
  await salvarAnuncios(c2, { adAccountId: `act_${CONTA}`, campaignIds: [], usarTokenPlataforma: false, token: null, adsSource: "windsor" });
  const { fonte } = windsorFalso(() => SEM_CONECTOR);
  const r = await atualizarAgora(c2, { fonte: "ads", windsorAds: async () => ({ api: fonte, chave: CHAVE }) });
  assert.equal(r.ok, false); assert.match(r.mensagem, /Conecte o Facebook Ads nesta conta do Windsor/); assert.ok(!r.mensagem.includes(CHAVE));
  const c = (await obterCanal(c2))!;
  assert.equal(c.lastSyncAt, null); assert.match(c.lastError ?? "", /Facebook Ads/); assert.ok(!(c.lastError ?? "").includes(CHAVE));
  const d = await carregarCanaisDoCliente(await scopeDe("aw2@cliente.com", [c2]), "30", "2026-11-16");
  assert.equal(d.estado.anuncios, true); assert.equal(d.estado.anunciosConectado, false); assert.equal(d.anuncios, null);
  assert.equal((await lerSnapshots(c2, ["campaign_daily", "ad_daily"], "2026-01-01", "2026-12-31")).length, 0);
});

test("trocar a fonte dos anúncios (Meta ↔ Windsor) zera a última coleta: dados de uma fonte não passam como da outra", { skip }, async () => {
  assert.ok((await obterCanal(c1))!.lastSyncAt);
  await salvarAnuncios(c1, { adAccountId: `act_${CONTA}`, campaignIds: [CAMP], usarTokenPlataforma: false, token: null, adsSource: "meta" });
  assert.equal((await obterCanal(c1))!.lastSyncAt, null);
  const d = await carregarCanaisDoCliente(await scopeDe("aw1@cliente.com", [c1]), "30", "2026-11-16");
  assert.equal(d.estado.anunciosConectado, false);
  await salvarAnuncios(c1, { adAccountId: `act_${CONTA}`, campaignIds: [CAMP], usarTokenPlataforma: false, token: null, adsSource: "windsor" });
});
