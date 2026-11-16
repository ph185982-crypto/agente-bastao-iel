// Teste de ponta a ponta com um Mercado Livre SIMULADO (servidor HTTP local) e o banco real.
// Exercita: renovação de token (refresh de uso único), coleta, snapshots, alertas, fila de aprovação,
// execução (simulada e real, inclusive variação), limite diário, auditoria e webhook.
// Uso: DATABASE_URL=... ENCRYPTION_KEY=... npx tsx tests/e2e/ml-simulado.ts
import http from "node:http";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const today = new Date();
const iso = (d: Date) => d.toISOString();
const state = {
  refreshUsed: new Set<string>(),
  refreshCalls: 0,
  items: {
    MLB100: { id: "MLB100", title: "Fone Bluetooth X", status: "active", sub_status: [], price: 199.9, currency_id: "BRL", available_quantity: 12, sold_quantity: 340, permalink: "https://x/100", thumbnail: "http://http2.mlstatic.com/D_100-I.jpg", secure_thumbnail: "https://http2.mlstatic.com/D_100-I.jpg", pictures: [{ secure_url: "https://http2.mlstatic.com/D_100-O.jpg" }, { secure_url: "javascript:alert(1)" }, { url: "http://http2.mlstatic.com/D_100b-O.jpg" }], listing_type_id: "gold_pro", variations: [] as any[] },
    MLB200: { id: "MLB200", title: "Camiseta Dry", status: "active", sub_status: [], price: 59.9, currency_id: "BRL", available_quantity: 5, sold_quantity: 80, permalink: "https://x/200", thumbnail: "http://http2.mlstatic.com/D_200-I.jpg", pictures: [], listing_type_id: "gold_special",
      variations: [
        { id: 9001, price: 59.9, available_quantity: 5, attribute_combinations: [{ name: "Cor", value_name: "Azul" }, { name: "Tamanho", value_name: "M" }], seller_custom_field: "AZ-M" },
        { id: 9002, price: 59.9, available_quantity: 0, attribute_combinations: [{ name: "Cor", value_name: "Azul" }, { name: "Tamanho", value_name: "G" }], seller_custom_field: "AZ-G" },
      ] },
    MLB300: { id: "MLB300", title: "Garrafa Térmica", status: "paused", sub_status: ["out_of_stock"], price: 89.9, currency_id: "BRL", available_quantity: 0, sold_quantity: 12, permalink: "https://x/300", thumbnail: null, listing_type_id: "gold_special", variations: [] },
  } as Record<string, any>,
  puts: [] as any[],
  answers: [] as any[],
};
const SELLER = "123456789";

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url!, "http://x");
  const p = u.pathname;
  let raw = "";
  for await (const c of req) raw += c;
  const auth = req.headers.authorization ?? "";
  if (p !== "/oauth/token" && auth !== "Bearer TOKEN-NOVO") return send(res, 401, { message: "invalid_token" });

  if (p === "/oauth/token") {
    const f = new URLSearchParams(raw);
    state.refreshCalls++;
    if (f.get("grant_type") !== "refresh_token") return send(res, 400, { error: "invalid_grant" });
    const rt = f.get("refresh_token")!;
    if (rt !== "REFRESH-ANTIGO" || state.refreshUsed.has(rt)) return send(res, 400, { error: "invalid_grant", message: "refresh já usado" });
    state.refreshUsed.add(rt);
    return send(res, 200, { access_token: "TOKEN-NOVO", token_type: "bearer", expires_in: 21600, scope: "offline_access read write", user_id: Number(SELLER), refresh_token: "REFRESH-NOVO" });
  }
  if (p === `/users/${SELLER}`) return send(res, 200, { id: Number(SELLER), nickname: "LOJA_SIMULADA", site_id: "MLB", seller_reputation: { level_id: "4_light_green", power_seller_status: "gold", metrics: { claims: { rate: 0.012 }, delayed_handling_time: { rate: 0.03 }, cancellations: { rate: 0.004 } } } });
  if (p === `/users/${SELLER}/items/search`) return send(res, 200, u.searchParams.get("scroll_id") ? { results: [] } : { results: Object.keys(state.items), scroll_id: "S1" });
  if (p === "/items") return send(res, 200, u.searchParams.get("ids")!.split(",").map((id) => ({ code: 200, body: state.items[id] })));
  if (p.startsWith("/items/") && req.method === "GET" && p !== "/items/visits") return send(res, 200, state.items[p.split("/")[2]]);
  if (p === "/items/visits") return send(res, 200, [{ item_id: u.searchParams.get("ids"), total_visits: 1500 }]);
  if (p === `/users/${SELLER}/items_visits`) return send(res, 200, { total_visits: 820 });
  if (p === "/orders/search") return send(res, 200, { results: [
    { id: 2000001, status: "paid", total_amount: 199.9, paid_amount: 199.9, currency_id: "BRL", order_items: [{ quantity: 1 }], date_created: iso(new Date(today.getTime() - 3600e3)), shipping: { id: 44 } },
    { id: 2000002, status: "paid", total_amount: 119.8, paid_amount: 119.8, currency_id: "BRL", order_items: [{ quantity: 2 }], date_created: iso(new Date(today.getTime() - 2 * 3600e3)) },
    { id: 2000003, status: "cancelled", total_amount: 59.9, currency_id: "BRL", order_items: [{ quantity: 1 }], date_created: iso(new Date(today.getTime() - 3 * 3600e3)) },
  ], paging: { total: 3 } });
  if (p === "/orders/2000099") return send(res, 200, { id: 2000099, status: "paid", total_amount: 89.9, currency_id: "BRL", order_items: [{ quantity: 1 }], date_created: iso(today) });
  if (p === "/questions/search") return send(res, 200, { questions: [{ id: 7001, item_id: "MLB100", text: "Funciona com iPhone?", status: "UNANSWERED", date_created: iso(new Date(today.getTime() - 20 * 3600e3)) }], total: 1 });
  if (p === "/questions/7001") return send(res, 200, { id: 7001, item_id: "MLB100", text: "Funciona com iPhone?", status: "UNANSWERED", date_created: iso(today) });
  if (p === "/advertising/advertisers") return send(res, 200, { advertisers: [{ advertiser_id: 555, site_id: "MLB" }] });
  if (p === "/advertising/MLB/advertisers/555/product_ads/campaigns/search") return send(res, 200, { results: [{ id: 31, name: "Campanha Fones", status: "active", budget: 50, strategy: "profitability", roas_target: 5, metrics: { cost: 120, total_amount: 180, roas: 1.5, clicks: 300, prints: 9000, acos: 66 } }], paging: { total: 1 } });
  if (p.startsWith("/items/") && req.method === "PUT") {
    const id = p.split("/")[2];
    const body = JSON.parse(raw);
    state.puts.push({ id, body });
    const it = state.items[id];
    if (body.price !== undefined) it.price = body.price;
    if (body.available_quantity !== undefined) it.available_quantity = body.available_quantity;
    if (body.variations) {
      if (body.variations.length !== it.variations.length) return send(res, 400, { message: "variações omitidas seriam removidas" });
      for (const v of body.variations) Object.assign(it.variations.find((x: any) => x.id === v.id), v);
    }
    return send(res, 200, it);
  }
  if (p === "/answers" && req.method === "POST") { state.answers.push(JSON.parse(raw)); return send(res, 200, { status: "ANSWERED", answer: { text: JSON.parse(raw).text } }); }
  send(res, 404, { message: `rota simulada inexistente: ${req.method} ${p}` });
});

(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  process.env.ML_API_BASE = `http://127.0.0.1:${port}`;
  process.env.ML_CLIENT_ID = "6409718634983655";
  process.env.ML_CLIENT_SECRET = "segredo-simulado";
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

  const { db } = await import("../../src/lib/db/client");
  const { encrypt, decrypt } = await import("../../src/lib/crypto");
  const { ensureDefaultRules, runAlerts } = await import("../../src/lib/alerts/engine");
  const { collectBatch } = await import("../../src/lib/collector");
  const { proposeAction, decideAction } = await import("../../src/lib/executor/executor");
  const { processWebhookQueue } = await import("../../src/lib/webhooks");
  const ok = (r: any, m: string) => { if (r.error) throw new Error(`${m}: ${r.error.message}`); return r.data; };
  const step = (m: string) => console.log("✓", m);

  const { data: settingsBefore } = await db.from("settings").select("*").single();
  const c = ok(await db.from("clients").insert({ name: "E2E SIMULADO" }).select("id").single(), "cliente");
  try {
    await ensureDefaultRules(c.id);
    const acc = ok(await db.from("marketplace_accounts").insert({
      client_id: c.id, marketplace: "mercadolivre", external_user_id: SELLER, nickname: "x",
      access_token_enc: encrypt("TOKEN-VELHO"), refresh_token_enc: encrypt("REFRESH-ANTIGO"),
      token_expires_at: iso(new Date(Date.now() + 10 * 60e3)), // vence em 10 min → precisa renovar
    }).select("id").single(), "conta");

    // 1) Coleta (renova o token antes)
    const [r] = await collectBatch(50_000, acc.id);
    assert.ok(r?.ok, `coleta falhou: ${r?.error}`);
    assert.equal(r.listings, 3); assert.equal(r.orders, 3); assert.equal(r.questions, 1); assert.equal(r.campaigns, 1);
    const a1 = ok(await db.from("marketplace_accounts").select("*").eq("id", acc.id).single(), "conta2");
    assert.equal(decrypt(a1.refresh_token_enc), "REFRESH-NOVO", "refresh token novo precisa ser salvo");
    assert.equal(a1.nickname, "LOJA_SIMULADA");
    step("token renovado (refresh de uso único salvo) e coleta de 3 anúncios, 3 pedidos, 1 pergunta, 1 campanha");

    const snap = ok(await db.from("daily_snapshots").select("*").eq("account_id", acc.id).order("snapshot_date", { ascending: false }).limit(1).single(), "snap");
    assert.equal(snap.orders_count, 2, "pedido cancelado não conta"); assert.equal(snap.revenue, 319.7); assert.equal(snap.reputation_level, "4_light_green");
    const l200 = ok(await db.from("listings").select("variations").eq("account_id", acc.id).eq("external_id", "MLB200").single(), "l200");
    assert.equal(l200.variations.length, 2); assert.equal(l200.variations[1].name, "Azul / G");
    step("snapshot diário (R$ 319,70 em 2 pedidos, cancelado fora) e variações salvas");
    // fotos: vêm no mesmo multiget; http vira https, URL inválida é descartada, sem foto fica nulo
    const imgs = ok(await db.from("listings").select("external_id, thumbnail, image_urls").eq("account_id", acc.id), "fotos");
    const img = (id: string) => imgs.find((x: any) => x.external_id === id);
    assert.equal(img("MLB100").thumbnail, "https://http2.mlstatic.com/D_100-I.jpg");
    assert.deepEqual(img("MLB100").image_urls, ["https://http2.mlstatic.com/D_100-O.jpg", "https://http2.mlstatic.com/D_100b-O.jpg"]);
    assert.equal(img("MLB200").thumbnail, "https://http2.mlstatic.com/D_200-I.jpg"); assert.equal(img("MLB200").image_urls, null);
    assert.equal(img("MLB300").thumbnail, null);
    step("fotos dos anúncios salvas (https, URL inválida descartada, sem foto = nulo)");

    // 2) Alertas
    const al = await runAlerts();
    const alerts = ok(await db.from("alerts").select("rule_type").eq("client_id", c.id), "alertas");
    const types = alerts.map((x: any) => x.rule_type).sort();
    for (const t of ["out_of_stock", "roas_below", "unanswered_question"]) assert.ok(types.includes(t), `faltou alerta ${t}`);
    step(`alertas: ${types.join(", ")} (novos: ${al.created})`);

    // 3) Ações: simulação global ligada → só simula
    const a = await proposeAction({ clientId: c.id, accountId: acc.id, type: "update_price", targetId: "MLB100", payload: { price: 209.9 }, reason: "teste", actor: "e2e" });
    assert.equal(a.status, "proposed");
    await db.from("settings").update({ dry_run: true, global_pause: false }).eq("id", true);
    const sim = await decideAction(a.id, "approve", "e2e");
    assert.equal(sim.status, "simulated"); assert.equal(state.puts.length, 0, "simulação não pode chamar o ML");
    step("aprovação em modo simulação: nada enviado ao Mercado Livre");

    // 4) Execução real (simulação desligada só durante o teste)
    await db.from("settings").update({ dry_run: false }).eq("id", true);
    const b = await proposeAction({ clientId: c.id, accountId: acc.id, type: "update_price", targetId: "MLB100", payload: { price: 215 }, reason: "teste", actor: "e2e" });
    const ex = await decideAction(b.id, "approve", "e2e");
    assert.equal(ex.status, "executed", ex.error); assert.equal(state.items.MLB100.price, 215);
    step("preço executado de verdade no ML simulado (199,90 → 215,00), dentro do limite de 10%");

    const big = await proposeAction({ clientId: c.id, accountId: acc.id, type: "update_price", targetId: "MLB100", payload: { price: 240 }, reason: "teste", actor: "e2e" });
    const blk = await decideAction(big.id, "approve", "e2e");
    assert.equal(blk.status, "failed"); assert.match(blk.error, /limite/);
    step("limite diário bloqueou 199,90 → 240,00 (+20% no dia)");

    const v = await proposeAction({ clientId: c.id, accountId: acc.id, type: "update_stock", targetId: "MLB200", payload: { available_quantity: 8, variation_id: "9002" }, reason: "repor G", actor: "e2e" });
    const vex = await decideAction(v.id, "approve", "e2e");
    assert.equal(vex.status, "executed", vex.error);
    assert.equal(state.items.MLB200.variations[1].available_quantity, 8); assert.equal(state.items.MLB200.variations[0].available_quantity, 5);
    step("estoque da variação Azul/G = 8 sem mexer na Azul/M (todas as variações enviadas)");

    const q = await proposeAction({ clientId: c.id, accountId: acc.id, type: "answer_question", targetId: "7001", payload: { text: "Sim, funciona com iPhone via Bluetooth 5.0." }, reason: "teste", actor: "e2e" });
    const qex = await decideAction(q.id, "approve", "e2e");
    assert.equal(qex.status, "executed", qex.error); assert.equal(state.answers[0].question_id, 7001);
    step("resposta de pergunta enviada");

    const audit = ok(await db.from("audit_log").select("event").eq("client_id", c.id), "audit");
    assert.ok(audit.filter((x: any) => x.event === "executed").length >= 3);
    step(`auditoria com ${audit.length} eventos (antes/depois gravados)`);

    // 5) Webhook de pedido
    ok(await db.from("webhook_events").insert({ marketplace: "mercadolivre", topic: "orders_v2", resource: "/orders/2000099", external_user_id: SELLER, payload: { teste: true } }), "webhook");
    const w = await processWebhookQueue(20_000, 10);
    const o = ok(await db.from("orders").select("*").eq("account_id", acc.id).eq("external_id", "2000099").maybeSingle(), "pedido webhook");
    assert.ok(o, `webhook não gravou o pedido (${JSON.stringify(w)})`);
    step("notificação de pedido processada pela fila");

    console.log("\nE2E SIMULADO: TUDO OK");
  } finally {
    await db.from("settings").update({ dry_run: settingsBefore.dry_run, global_pause: settingsBefore.global_pause }).eq("id", true);
    await db.from("webhook_events").delete().eq("external_user_id", SELLER);
    await db.from("audit_log").delete().eq("client_id", c.id);
    await db.from("clients").delete().eq("id", c.id);
    server.close();
  }
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
