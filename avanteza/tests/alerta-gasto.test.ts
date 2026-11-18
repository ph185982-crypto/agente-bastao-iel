// Showman: anúncios ao vivo pelo Windsor (chave da agência WINDSOR_ADS_API_KEY), filtro de campanhas por NOME (“SHOW MAN”) e alerta de
// recarga em dois níveis (80% / 100%), um envio por nível por ciclo, reinício pelo botão “Recarga feita”, isolamento entre campanhas e
// clientes e coleta leve a cada 2 h. Fixtures com as linhas reais da conta 605261696580859 (Showman + campanhas “Destrava - SHOPEE” que
// NÃO podem entrar). O Windsor real e o Resend real NUNCA são chamados; as chaves abaixo são FALSAS.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { campanhaPassa, filtrarLinhasCampanhas, normalizarNome } from "../src/lib/channels/campanhas";
import { criarWindsorAds } from "../src/lib/channels/windsor-ads";
import { coletarCanal } from "../src/lib/channels/collect";
import { carregarCanaisDoCliente } from "../src/lib/channels/cliente";
import { lerCamposAnuncios } from "../src/lib/channels/form";
import { gravarSnapshots, lerSnapshots, obterCanal, resolverChaveWindsor, salvarAnuncios } from "../src/lib/channels/store";
import { resolverChaveWindsorAds, rotinaAnunciosLeve, windsorAdsPadrao } from "../src/lib/channels/servico";
import {
  assuntoAlerta, calcularGastoCiclo, emailAlertaHtml, gastoDoCiclo, historicoAlertasGasto, lerCamposAlerta, nivelDoGasto, reiniciarContagem,
  salvarAlertaGasto, somarGastoCiclo, verificarAlertasGasto,
} from "../src/lib/channels/alerta-gasto";
import { rawQuery } from "../src/lib/db/client";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession } from "../src/lib/mapa/scope";
import { liveAllowedCompanies } from "../src/lib/mapa/repo";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);
const CHAVE_ADS = "wk-FALSA-agencia-ads-0011223344";
const CHAVE_IG = "wk-FALSA-instagram-5566778899";
const CONTA = "605261696580859";
const RES = "actions_onsite_conversion_messaging_conversation_started_7d";
const HOJE = "2026-11-18";
const sem = async () => undefined;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

// ─── Linhas reais (conector facebook, conta “605261696580859, BRL”) ──────────
const FLORESTA = { id: "120252388371430661", nome: "SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km" };
const BASE = { id: "120252609606470661", nome: "SHOW MAN | BASE CLIENTES | Assinatura R$69,90 | WhatsApp" };
const SEMELHANTE = { id: "120252609607960661", nome: "SHOW MAN | SEMELHANTE 1% | Assinatura R$69,90 | WhatsApp" };
const GOIANIA = { id: "120250000000000001", nome: "Destrava - SHOPEE | Frio | PME | Goiânia + 50km" };
const BRASIL = { id: "120250000000000002", nome: "Destrava - SHOPEE | Frio | PME | Brasil inteiro" };
const linha = (c: { id: string; nome: string }, date: string, spend: number, res: number | null) => ({
  date, account_id: CONTA, account_name: `${CONTA}, BRL`, campaign_id: c.id, campaign: c.nome, ad_id: `${c.id}-ad`, ad_name: `Anúncio ${c.nome.slice(0, 20)}`,
  thumbnail_url: null, spend, impressions: Math.round(spend * 60), reach: Math.round(spend * 50), clicks: Math.round(spend), ctr: "1.6", cpc: "1.00", frequency: "1.2", [RES]: res,
});
const dias = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => `2026-11-${String(de + i).padStart(2, "0")}`);
// Floresta 3km: 02/11–18/11 = R$ 306,92 e 58 conversas; BASE CLIENTES = R$ 37,01 e 2; SEMELHANTE 1% = R$ 21,22 e 6 → R$ 365,15 e 66.
const LINHAS = [
  ...dias(2, 17).map((d) => linha(FLORESTA, d, 18, 3)), linha(FLORESTA, "2026-11-18", 18.92, 10),
  linha(BASE, "2026-11-15", 20, 1), linha(BASE, "2026-11-16", 17.01, 1),
  linha(SEMELHANTE, "2026-11-15", 10.22, 3), linha(SEMELHANTE, "2026-11-16", 11, 3),
  linha(GOIANIA, "2026-11-10", 150, 20), linha(GOIANIA, "2026-11-17", 80, 9), linha(BRASIL, "2026-11-12", 90, 4),
];

/** `porData` = respeita date_from/date_to (a coleta leve depende disso); desligado, independe do relógio (teste de conexão usa “hoje” real). */
function windsorFalso(extra: typeof LINHAS = [], porData = true) {
  const chamadas: URL[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    chamadas.push(u);
    const f = (u.searchParams.get("fields") ?? "").split(",");
    const de = porData ? u.searchParams.get("date_from") ?? "0000" : "0000", ate = porData ? u.searchParams.get("date_to") ?? "9999" : "9999";
    const base = [...LINHAS, ...extra].filter((l) => l.date >= de && l.date <= ate);
    return json({ data: base.map((l) => Object.fromEntries(Object.entries({ ...l, status: "ACTIVE", effective_status: "ACTIVE" }).filter(([k]) => f.includes(k)))) });
  }) as typeof fetch;
  const fonte = (o: { nome?: string | null; ids?: string[] } = {}) => criarWindsorAds({ chave: CHAVE_ADS, contaId: `act_${CONTA}`, campaignIds: o.ids ?? [], campaignNameFilter: o.nome === undefined ? "SHOW MAN" : o.nome, fetchImpl, sleep: sem, baseDelayMs: 1, maxDelayMs: 2 });
  return { fonte, chamadas };
}

// ─── Puros ───────────────────────────────────────────────────────────────────

test("filtro por nome: contém, sem caixa e sem acento; Destrava fica de fora; ids e nome valem juntos", () => {
  const f = { campaignIds: [], campaignNameFilter: "show man" };
  for (const c of [FLORESTA, BASE, SEMELHANTE]) assert.ok(campanhaPassa(c.id, c.nome, f), c.nome);
  for (const c of [GOIANIA, BRASIL]) assert.ok(!campanhaPassa(c.id, c.nome, f), c.nome);
  assert.equal(normalizarNome("  GOIÂNIA  +  50km "), "goiania + 50km");
  assert.ok(campanhaPassa(GOIANIA.id, GOIANIA.nome, { campaignIds: [], campaignNameFilter: "goiania" }));
  assert.ok(!campanhaPassa(BASE.id, BASE.nome, { campaignIds: [FLORESTA.id], campaignNameFilter: "SHOW MAN" }), "ids e nome: os dois precisam passar");
  assert.ok(campanhaPassa("x", "qualquer", { campaignIds: [], campaignNameFilter: null }), "sem filtro, tudo passa");
  const rows = [
    { kind: "campaign_daily", key: FLORESTA.id, metrics: { nome: FLORESTA.nome } }, { kind: "campaign_daily", key: GOIANIA.id, metrics: { nome: GOIANIA.nome } },
    { kind: "ad_daily", key: "a", metrics: { campaign_id: GOIANIA.id, campaign_name: GOIANIA.nome } }, { kind: "ad_daily", key: "b", metrics: { campaign_id: FLORESTA.id } },
    { kind: "ig_daily", key: "account", metrics: {} },
  ];
  assert.deepEqual(filtrarLinhasCampanhas(rows, f).map((r) => r.key), [FLORESTA.id, "b", "account"]);
});

test("níveis do alerta: abaixo de 80% nada; 80% = aviso; 100% = limite; soma só desde o início do ciclo", () => {
  assert.equal(nivelDoGasto(319.99, 400, 80), null);
  assert.equal(nivelDoGasto(320, 400, 80), "aviso");
  assert.equal(nivelDoGasto(365.15, 400, 80), "aviso");
  assert.equal(nivelDoGasto(400, 400, 80), "limite");
  const rows = LINHAS.map((l) => ({ kind: "campaign_daily", date: l.date, key: l.campaign_id, metrics: { nome: l.campaign, spend: l.spend, results: l[RES] ?? 0 } }));
  const f = { campaignIds: [], campaignNameFilter: "SHOW MAN" };
  assert.deepEqual(somarGastoCiclo(rows, f, "2026-11-01", HOJE), { gasto: 365.15, conversas: 66 });
  assert.deepEqual(somarGastoCiclo(rows, { campaignIds: [], campaignNameFilter: null }, "2026-11-01", HOJE), { gasto: 685.15, conversas: 99 }, "sem filtro somaria o Destrava (por isso o filtro)");
  assert.deepEqual(somarGastoCiclo(rows, f, "2026-11-16", HOJE), { gasto: 18 + 18 + 18.92 + 17.01 + 11, conversas: 3 + 3 + 10 + 1 + 3 });
  const g = calcularGastoCiclo(rows, f, { limite: 400, avisoPct: 80, desde: "2026-11-01", emails: [] }, HOJE);
  assert.equal(g.pct, 91.3); assert.equal(g.restante, 34.85); assert.equal(g.custoPorConversa, 5.53); assert.equal(g.nivel, "aviso");
});

test("e-mail do alerta: português, curto, identidade Avanteza, gasto, limite, conversas e link para o Mapa", () => {
  const g = { desde: "2026-11-01", ate: HOJE, limite: 400, avisoPct: 80, gasto: 365.15, conversas: 66, custoPorConversa: 5.53, pct: 91.3, restante: 34.85, nivel: "aviso" as const };
  const html = emailAlertaHtml("Showman", "aviso", g);
  for (const t of ["avanteza", "O saldo dos anúncios está acabando", "R$ 365,15", "R$ 400,00", "66", "R$ 5,53", "/mapa/canais", "Ver no Mapa", "01/11"]) assert.ok(html.includes(t), t);
  assert.equal(assuntoAlerta("Showman", "aviso", g), "Showman: saldo dos anúncios acabando (R$ 365,15 de R$ 400,00)");
  assert.match(assuntoAlerta("Showman", "limite", { ...g, gasto: 401.2 }), /faça a recarga/);
  assert.ok(emailAlertaHtml("Showman", "limite", g).includes("Hora de recarregar"));
  assert.ok(!emailAlertaHtml("A <b>x</b>", "aviso", g).includes("<b>x</b>"), "nome escapado");
});

test("formulários: filtro por nome nos anúncios e campos do alerta validados", () => {
  const fd = new FormData();
  fd.set("ads_source", "windsor"); fd.set("ad_account_id", CONTA); fd.set("campaign_name_filter", "  SHOW   MAN ");
  const a = lerCamposAnuncios(fd);
  assert.ok("campos" in a); assert.equal(a.campos.campaignNameFilter, "SHOW MAN"); assert.deepEqual(a.campos.campaignIds, []);
  const al = new FormData();
  al.set("limite", "400,00"); al.set("aviso_pct", "80"); al.set("desde", "2026-11-01"); al.set("emails", "PauloHenriquePH.ph23@gmail.com; paulohenriqueph.ph23@gmail.com");
  const r = lerCamposAlerta(al);
  assert.deepEqual(r, { campos: { limite: 400, avisoPct: 80, desde: "2026-11-01", emails: ["paulohenriqueph.ph23@gmail.com"] } });
  al.set("aviso_pct", "100"); assert.ok("erro" in lerCamposAlerta(al));
  al.set("aviso_pct", "80"); al.set("emails", "sem-arroba"); assert.ok("erro" in lerCamposAlerta(al));
  al.set("emails", ""); al.set("limite", "-5"); assert.ok("erro" in lerCamposAlerta(al));
  const d = new FormData(); d.set("desligar", "1"); assert.deepEqual(lerCamposAlerta(d), { campos: null });
});

test("Windsor Ads com as linhas reais: só as 3 campanhas SHOW MAN (R$ 365,15, 66 conversas); Destrava nunca entra; datas sempre explícitas", async () => {
  const { fonte, chamadas } = windsorFalso();
  const f = fonte();
  const camp = await f.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "campaign", de: "2026-11-01", ate: HOJE, campanhas: [] });
  assert.deepEqual([...new Set(camp.map((c) => c.campaign_id))].sort(), [FLORESTA.id, BASE.id, SEMELHANTE.id].sort());
  assert.equal(Math.round(camp.reduce((t, x) => t + Number(x.spend), 0) * 100) / 100, 365.15);
  assert.equal(camp.reduce((t, x) => t + Number(x.actions?.[0]?.value ?? 0), 0), 66);
  const ads = await f.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "ad", de: "2026-11-01", ate: HOJE, campanhas: [] });
  assert.ok(ads.every((x) => !/Destrava/.test(x.campaign_name ?? "")));
  await f.anuncios({ contaId: `act_${CONTA}`, campanhas: [] });
  const t = await windsorFalso([], false).fonte().testar();
  const det = t.verificacoes.find((v) => v.id === "campanhas")!.detalhe;
  assert.ok(det.startsWith("3 campanha(s) com “SHOW MAN” no nome") && det.includes("2 campanha(s) de outros projetos"), det);
  assert.equal(t.info.gasto, 365.15, "gasto do teste só das campanhas filtradas");
  for (const u of chamadas) { assert.equal(u.searchParams.get("date_preset"), null, u.toString()); assert.ok(u.searchParams.get("date_from")); }
});

test("chaves: anúncios usam WINDSOR_ADS_API_KEY (fallback só sem ela); o Instagram nunca usa a chave da agência", { skip }, async () => {
  const antes = { ads: process.env.WINDSOR_ADS_API_KEY, ig: process.env.WINDSOR_API_KEY };
  try {
    const c = await mkClient("Chaves", { slug: "chaves", kind: "midia" });
    await salvarAnuncios(c, { adAccountId: `act_${CONTA}`, campaignIds: [], campaignNameFilter: "SHOW MAN", usarTokenPlataforma: false, adsSource: "windsor" });
    delete process.env.WINDSOR_ADS_API_KEY; delete process.env.WINDSOR_API_KEY;
    assert.equal(await resolverChaveWindsorAds(c), null);
    process.env.WINDSOR_API_KEY = CHAVE_IG;
    assert.deepEqual(await resolverChaveWindsorAds(c), { chave: CHAVE_IG, origem: "plataforma" }, "sem a chave da agência, cai na atual");
    process.env.WINDSOR_ADS_API_KEY = CHAVE_ADS;
    assert.deepEqual(await resolverChaveWindsorAds(c), { chave: CHAVE_ADS, origem: "anuncios" });
    assert.deepEqual(await resolverChaveWindsor(c), { chave: CHAVE_IG, origem: "plataforma" }, "Instagram continua com WINDSOR_API_KEY");
    delete process.env.WINDSOR_API_KEY;
    assert.equal(await resolverChaveWindsor(c), null, "Instagram nunca cai na chave dos anúncios");
    // A fábrica dos anúncios usa a chave da agência na URL (e nada mais).
    const orig = globalThis.fetch; const urls: URL[] = [];
    globalThis.fetch = (async (u: string | URL | Request) => { urls.push(new URL(String(u))); return json({ data: [] }); }) as typeof fetch;
    try {
      const fab = await windsorAdsPadrao((await obterCanal(c))!);
      await fab!.api.insightsDiarios({ contaId: `act_${CONTA}`, nivel: "campaign", de: "2026-11-16", ate: HOJE, campanhas: [] });
    } finally { globalThis.fetch = orig; }
    assert.equal(urls[0].searchParams.get("api_key"), CHAVE_ADS);
  } finally {
    if (antes.ads === undefined) delete process.env.WINDSOR_ADS_API_KEY; else process.env.WINDSOR_ADS_API_KEY = antes.ads;
    if (antes.ig === undefined) delete process.env.WINDSOR_API_KEY; else process.env.WINDSOR_API_KEY = antes.ig;
  }
});

// ─── Banco ───────────────────────────────────────────────────────────────────

let showman = "", outro = "";
const enviados: Array<{ to: string[]; cc?: string[]; subject: string; html: string }> = [];
const enviarOk = async (m: { to: string[]; cc?: string[]; subject: string; html: string }) => { enviados.push(m); return true; };
const deps = { enviar: enviarOk, copia: ["dono@avanteza.com.br"] };
const scopeDe = async (email: string, ids: string[]) => {
  const sess = await verifySessionFull(await signSession(email, process.env.SESSION_SECRET!, 3600, "client", { clientIds: ids }), process.env.SESSION_SECRET!);
  return scopeFromSession(sess, null, null, await liveAllowedCompanies(email))!;
};
const gravarCamp = (clientId: string, c: { id: string; nome: string }, date: string, spend: number, results: number) =>
  gravarSnapshots(clientId, [{ kind: "campaign_daily", date, key: c.id, metrics: { nome: c.nome, spend, impressions: 100, reach: 80, clicks: 5, ctr: 5, cpc: 1, frequency: 1, results } }], "windsor");

before(async () => {
  if (skip) return;
  await resetSchema();
  showman = await mkClient("Showman", { slug: "showman", kind: "midia" });
  outro = await mkClient("Outra Mídia", { slug: "outra-midia", kind: "midia" });
  await mkUser("show@cliente.com", showman);
});
after(async () => { if (!skip) await closeDb(); });

test("schema: colunas do filtro/alerta e spend_alerts idempotentes; checks de limite e percentual", { skip }, async () => {
  await rawQuery((await import("node:fs")).readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await salvarAnuncios(outro, { adAccountId: "act_111", campaignIds: [], usarTokenPlataforma: false, adsSource: "windsor" });
  await assert.rejects(rawQuery("update avanteza.client_channels set spend_alert_warn_pct = 100 where client_id = $1", [outro]));
  await assert.rejects(rawQuery("update avanteza.client_channels set spend_alert_limit = 0 where client_id = $1", [outro]));
});

test("coleta do Showman: grava só as campanhas SHOW MAN; Mapa mostra “Total gasto até agora” R$ 365,15 / 66 conversas e nada do Destrava", { skip }, async () => {
  await salvarAnuncios(showman, { adAccountId: `act_${CONTA}`, campaignIds: [], campaignNameFilter: "SHOW MAN", usarTokenPlataforma: false, adsSource: "windsor" });
  await salvarAlertaGasto(showman, { limite: 400, avisoPct: 80, desde: "2026-11-01", emails: ["paulohenriqueph.ph23@gmail.com"] });
  const { fonte } = windsorFalso();
  const r = await coletarCanal((await obterCanal(showman))!, null, { hoje: HOJE, dias: 90, maxMs: 60_000, fontes: ["ads"] }, null, null, { api: fonte(), chave: CHAVE_ADS });
  assert.ok(r.ok, r.erro ?? "");
  const snaps = await lerSnapshots(showman, ["campaign_daily", "ad_daily"], "2026-08-01", HOJE, "windsor");
  assert.ok(snaps.length > 0);
  assert.ok(snaps.every((s) => !/Destrava/.test(String(s.metrics.nome ?? s.metrics.campaign_name ?? ""))), "nada do Destrava gravado");
  const g = await gastoDoCiclo(await obterCanal(showman), HOJE);
  assert.deepEqual({ gasto: g!.gasto, conversas: g!.conversas, nivel: g!.nivel }, { gasto: 365.15, conversas: 66, nivel: "aviso" });
  // Dado antigo de outro projeto na mesma conta (ex.: gravado antes do filtro): nunca entra no painel nem no alerta.
  await gravarCamp(showman, GOIANIA, "2026-11-11", 500, 30);
  assert.equal((await gastoDoCiclo(await obterCanal(showman), HOJE))!.gasto, 365.15);
  const d = await carregarCanaisDoCliente(await scopeDe("show@cliente.com", [showman]), "30", HOJE);
  assert.equal(d.gastoCiclo?.gasto, 365.15); assert.equal(d.gastoCiclo?.limite, 400);
  assert.equal(d.anuncios!.atual.gasto, 365.15);
  assert.deepEqual(d.anuncios!.campanhas.map((c) => c.nome).sort(), [BASE.nome, FLORESTA.nome, SEMELHANTE.nome].sort());
  assert.ok(!JSON.stringify(d).includes("Destrava") && !JSON.stringify(d).includes(CONTA));
});

test("alerta: 80% sai UMA vez (cliente + cópia ao dono, sino e auditoria); 2ª rodada não envia; 100% sai uma vez ao cruzar R$ 400", { skip }, async () => {
  enviados.length = 0;
  const r1 = await verificarAlertasGasto(HOJE, deps);
  assert.equal(r1.emails, 1); assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].to, ["paulohenriqueph.ph23@gmail.com"]); assert.deepEqual(enviados[0].cc, ["dono@avanteza.com.br"]);
  assert.match(enviados[0].subject, /Showman: saldo dos anúncios acabando \(R\$ 365,15 de R\$ 400,00\)/);
  assert.ok(!enviados[0].html.includes("Outra Mídia"));
  const [n] = await rawQuery<{ titulo: string; link: string }>("select titulo, link from avanteza.notificacoes where tipo = 'alerta_gasto' and client_id = $1", [showman]);
  assert.match(n.titulo, /saldo acabando/); assert.equal(n.link, `/clientes/${showman}?aba=canais`);
  assert.equal((await rawQuery("select 1 from avanteza.audit_log where event = 'spend_alert' and client_id = $1", [showman])).length, 1);
  const r2 = await verificarAlertasGasto(HOJE, deps);
  assert.equal(r2.novos, 0); assert.equal(enviados.length, 1, "idempotente: o mesmo nível não sai de novo no ciclo");
  await gravarCamp(showman, BASE, "2026-11-18", 40, 2); // 405,15 ≥ 400
  const r3 = await verificarAlertasGasto(HOJE, deps);
  assert.equal(r3.emails, 1); assert.equal(enviados.length, 2); assert.match(enviados[1].subject, /faça a recarga/);
  await verificarAlertasGasto(HOJE, deps);
  assert.equal(enviados.length, 2);
  const h = await historicoAlertasGasto(showman);
  assert.deepEqual(h.map((x) => [x.nivel, x.email_status, x.ciclo]).sort(), [["aviso", "enviado", "2026-11-01"], ["limite", "enviado", "2026-11-01"]]);
});

test("“Recarga feita — reiniciar contagem”: novo ciclo a partir de hoje rearma os dois níveis; pular direto a 100% envia só um e-mail", { skip }, async () => {
  enviados.length = 0;
  assert.deepEqual(await reiniciarContagem(showman, HOJE), { antes: "2026-11-01" });
  const g = await gastoDoCiclo(await obterCanal(showman), HOJE);
  assert.equal(g!.desde, HOJE); assert.equal(g!.nivel, null, "R$ 18,92 + 40 = 58,92 hoje: abaixo de 80%");
  assert.equal((await verificarAlertasGasto(HOJE, deps)).novos, 0);
  await gravarCamp(showman, SEMELHANTE, HOJE, 400, 10); // pula direto para > 100% no ciclo novo
  const r = await verificarAlertasGasto(HOJE, deps);
  assert.equal(r.novos, 2); assert.equal(enviados.length, 1, "um e-mail só (o de 100%)"); assert.match(enviados[0].subject, /faça a recarga/);
  const ciclo = (await historicoAlertasGasto(showman)).filter((x) => x.ciclo === HOJE);
  assert.deepEqual(ciclo.map((x) => [x.nivel, x.email_status]).sort(), [["aviso", "coberto"], ["limite", "enviado"]]);
});

test("sem e-mail configurado: registra pendência e avisa no sino, sem quebrar; falha no envio também vira pendência", { skip }, async () => {
  const c = await mkClient("Sem Email", { slug: "sem-email", kind: "midia" });
  await salvarAnuncios(c, { adAccountId: "act_222", campaignIds: [], usarTokenPlataforma: false, adsSource: "windsor" });
  await salvarAlertaGasto(c, { limite: 100, avisoPct: 80, desde: "2026-11-01", emails: ["cliente@sem-email.com"] });
  await gravarCamp(c, { id: "c1", nome: "Campanha" }, "2026-11-10", 85, 4);
  const r = await verificarAlertasGasto(HOJE, { clientId: c, copia: [], enviar: async () => false });
  assert.equal(r.semConfiguracao, 1);
  assert.equal((await historicoAlertasGasto(c))[0].email_status, "sem_configuracao");
  const [n] = await rawQuery<{ corpo: string }>("select corpo from avanteza.notificacoes where client_id = $1 and tipo = 'alerta_gasto'", [c]);
  assert.match(n.corpo, /pendência/);
  await gravarCamp(c, { id: "c1", nome: "Campanha" }, "2026-11-11", 30, 1);
  const r2 = await verificarAlertasGasto(HOJE, { clientId: c, copia: [], enviar: async () => { throw new Error("Resend fora"); } });
  assert.equal(r2.falhas, 1);
  assert.equal((await historicoAlertasGasto(c)).find((x) => x.nivel === "limite")!.email_status, "falhou");
});

test("isolamento: gasto de outro cliente ou de campanha fora do filtro nunca dispara o alerta de ninguém", { skip }, async () => {
  enviados.length = 0;
  const a = await mkClient("Cliente A", { slug: "cliente-a", kind: "midia" });
  const b = await mkClient("Cliente B", { slug: "cliente-b", kind: "midia" });
  // A: filtro “SHOW MAN”, limite 1000, só gasto do Destrava (fora do filtro) = R$ 5.000 → nada.
  await salvarAnuncios(a, { adAccountId: `act_${CONTA}`, campaignIds: [], campaignNameFilter: "SHOW MAN", usarTokenPlataforma: false, adsSource: "windsor" });
  await salvarAlertaGasto(a, { limite: 1000, avisoPct: 80, desde: "2026-11-01", emails: ["a@a.com"] });
  await gravarCamp(a, GOIANIA, "2026-11-10", 5000, 100);
  // B: sem alerta, gasto enorme → não afeta A. Fonte errada (meta) com gasto alto em A → não conta (só a fonte do canal).
  await salvarAnuncios(b, { adAccountId: "act_333", campaignIds: [], usarTokenPlataforma: false, adsSource: "windsor" });
  await gravarCamp(b, FLORESTA, "2026-11-10", 9999, 1);
  await gravarSnapshots(a, [{ kind: "campaign_daily", date: "2026-11-10", key: FLORESTA.id, metrics: { nome: FLORESTA.nome, spend: 2000, results: 1 } }], "meta");
  const r = await verificarAlertasGasto(HOJE, { ...deps, clientId: a });
  assert.equal(r.novos, 0); assert.equal(enviados.length, 0);
  assert.equal((await gastoDoCiclo(await obterCanal(a), HOJE))!.gasto, 0);
  assert.equal(await gastoDoCiclo(await obterCanal(b), HOJE), null, "sem alerta configurado");
  // Rodada geral: ninguém recebe e-mail de outro cliente.
  await verificarAlertasGasto(HOJE, deps);
  for (const m of enviados) assert.ok(!m.to.includes("a@a.com"), "A nunca é avisado pelo gasto alheio");
});

test("coleta leve (a cada 2 h): só campanhas dos últimos 3 dias nos canais com alerta e já coletados; depois checa os alertas", { skip }, async () => {
  const c = await mkClient("Leve", { slug: "leve", kind: "midia" });
  await salvarAnuncios(c, { adAccountId: `act_${CONTA}`, campaignIds: [], campaignNameFilter: "SHOW MAN", usarTokenPlataforma: false, adsSource: "windsor" });
  await salvarAlertaGasto(c, { limite: 400, avisoPct: 80, desde: "2026-11-01", emails: ["leve@cliente.com"] });
  const { fonte, chamadas } = windsorFalso();
  const fab = async (canal: { clientId: string }) => (canal.clientId === c ? { api: fonte(), chave: CHAVE_ADS } : null);
  const r0 = await rotinaAnunciosLeve({ hoje: HOJE, windsorAds: fab, deps: { ...deps, clientId: c } });
  assert.equal(r0.coleta.find((x) => x.clientId === c)?.pulado, "aguardando a primeira coleta completa");
  assert.equal(chamadas.length, 0);
  await rawQuery("update avanteza.client_channels set last_sync_at = now() where client_id = $1", [c]);
  enviados.length = 0;
  const r = await rotinaAnunciosLeve({ hoje: HOJE, windsorAds: fab, deps: { ...deps, clientId: c } });
  assert.equal(r.coleta.find((x) => x.clientId === c)?.ok, true);
  assert.ok(chamadas.length >= 1 && chamadas.every((u) => u.searchParams.get("date_from") === "2026-11-16" && u.searchParams.get("date_to") === HOJE && !u.searchParams.get("fields")!.includes("ad_id")));
  assert.equal((await lerSnapshots(c, ["ad_daily"], "2026-11-01", HOJE, "windsor")).length, 0, "leve não busca anúncios");
  const g = await gastoDoCiclo(await obterCanal(c), HOJE);
  assert.equal(g!.gasto, 18 + 18 + 18.92 + 17.01 + 11, "só os 3 últimos dias foram coletados neste canal");
  assert.equal(r.alertas.canais, 1);
});

test("seed do Showman: recusa banco remoto sem --permitir-remoto", () => {
  const p = spawnSync(process.execPath, ["db/seed-canais-showman.mjs"], { cwd: new URL("..", import.meta.url), env: { ...process.env, DATABASE_URL: "postgres://u:p@ep-exemplo.neon.tech/neondb" }, encoding: "utf8" });
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /Recusado: DATABASE_URL não é um Postgres local/);
});
