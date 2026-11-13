import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt, safeEqual } from "../src/lib/crypto";
import { fetchJson, backoffDelay, ApiError, redactUrl } from "../src/lib/http";
import { evaluateRule, reputationScore, type AccountContext, type Snapshot } from "../src/lib/alerts/rules";
import { checkDailyLimit, resolvePolicy, validatePayload } from "../src/lib/executor/policy";
import { resourceId } from "../src/lib/webhooks";
import { summarizeOrdersByDay } from "../src/lib/collector";
import { addDays, spDate } from "../src/lib/dates";

const KEY = randomBytes(32).toString("base64");

test("AES-256-GCM: cifra e decifra; IV aleatório; adulteração falha", () => {
  const a = encrypt("APP_USR-token", KEY);
  const b = encrypt("APP_USR-token", KEY);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, KEY), "APP_USR-token");
  const parts = a.split(":");
  const ct = Buffer.from(parts[3], "base64");
  ct[0] ^= 1;
  parts[3] = ct.toString("base64");
  assert.throws(() => decrypt(parts.join(":"), KEY));
  assert.throws(() => decrypt(a, randomBytes(32).toString("base64")));
  assert.throws(() => encrypt("x", "curta"));
});

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("fetchJson: tenta de novo em 429/500 e respeita retry-after", async () => {
  let calls = 0;
  const delays: number[] = [];
  const fake = (async () => {
    calls++;
    if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "2" } });
    if (calls === 2) return new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  }) as typeof fetch;
  const r = await fetchJson<{ ok: number }>("https://x.test/a", {}, { fetchImpl: fake, sleep: async (ms) => { delays.push(ms); } });
  assert.equal(r.ok, 1);
  assert.equal(calls, 3);
  assert.equal(delays[0], 2000);
});

test("fetchJson: não repete 400 e lança ApiError sem vazar segredo na URL", async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response(JSON.stringify({ message: "invalid_grant" }), { status: 400 }); }) as typeof fetch;
  await assert.rejects(
    fetchJson("https://x.test/t?client_secret=SEGREDO", {}, { fetchImpl: fake, sleep: async () => {} }),
    (e: unknown) => e instanceof ApiError && e.status === 400 && !e.url.includes("SEGREDO") && e.message === "invalid_grant",
  );
  assert.equal(calls, 1);
  assert.ok(!redactUrl("https://a.b/?access_token=xyz").includes("xyz"));
  assert.ok(backoffDelay(3, 500, 8000) <= 8000);
});

function ctx(partial: Partial<AccountContext>): AccountContext {
  return { accountId: "acc", nickname: "LOJA", snapshots: [], listings: [], questions: [], campaigns: [], now: new Date("2026-11-13T15:00:00Z"), ...partial };
}
const snap = (d: string, o: Partial<Snapshot> = {}): Snapshot => ({ snapshot_date: d, orders_count: 10, revenue: 1000, reputation_level: "5_green", claims_rate: 0.01, ads_roas: null, ads_cost: null, ...o });

test("regra: reputação caiu", () => {
  assert.equal(reputationScore("4_light_green"), 4);
  const out = evaluateRule({ rule_type: "reputation_drop", params: {}, severity: "critical" }, ctx({ snapshots: [snap("2026-11-12"), snap("2026-11-13", { reputation_level: "4_light_green" })] }));
  assert.equal(out.length, 1);
  assert.match(out[0].title, /reputação caiu/);
  const none = evaluateRule({ rule_type: "reputation_drop", params: {}, severity: "critical" }, ctx({ snapshots: [snap("2026-11-12"), snap("2026-11-13")] }));
  assert.equal(none.length, 0);
});

test("regra: pausado e sem estoque", () => {
  const listings = [
    { external_id: "MLB1", title: "A", status: "paused", sub_status: [], available_quantity: 3 },
    { external_id: "MLB2", title: "B", status: "paused", sub_status: ["out_of_stock"], available_quantity: 0 },
    { external_id: "MLB3", title: "C", status: "active", sub_status: [], available_quantity: 5 },
  ];
  const paused = evaluateRule({ rule_type: "listing_paused", params: {}, severity: "warning" }, ctx({ listings }));
  assert.deepEqual(paused.map((p) => p.data?.item_id), ["MLB1"]);
  const oos = evaluateRule({ rule_type: "out_of_stock", params: {}, severity: "warning" }, ctx({ listings }));
  assert.deepEqual(oos.map((p) => p.data?.item_id), ["MLB2"]);
});

test("regra: ROAS abaixo da meta", () => {
  const campaigns = [
    { external_id: "1", name: "Boa", status: "active", metrics_7d: { cost: 100, revenue: 800, roas: 8 } },
    { external_id: "2", name: "Ruim", status: "active", metrics_7d: { cost: 100, revenue: 150, roas: null } },
    { external_id: "3", name: "Pouco gasto", status: "active", metrics_7d: { cost: 5, revenue: 0, roas: 0 } },
  ];
  const out = evaluateRule({ rule_type: "roas_below", params: { min_roas: 3, min_cost: 20 }, severity: "warning" }, ctx({ campaigns }));
  assert.deepEqual(out.map((o) => o.data?.campaign_id), ["2"]);
});

test("regra: pergunta sem resposta há X horas", () => {
  const questions = [
    { external_id: "q1", item_id: "MLB1", text: "Tem azul?", status: "UNANSWERED", date_created: "2026-11-12T10:00:00Z" },
    { external_id: "q2", item_id: "MLB1", text: "Entrega?", status: "UNANSWERED", date_created: "2026-11-13T12:00:00Z" },
  ];
  const out = evaluateRule({ rule_type: "unanswered_question", params: { hours: 12 }, severity: "warning" }, ctx({ questions }));
  assert.deepEqual(out.map((o) => o.data?.question_id), ["q1"]);
});

test("regra: vendas caindo vs. semana anterior", () => {
  const days = Array.from({ length: 15 }, (_, i) => addDays("2026-11-13", i - 14));
  const snaps = days.map((d, i) => snap(d, { orders_count: i < 7 ? 10 : 5 }));
  const out = evaluateRule({ rule_type: "sales_drop", params: { drop_pct: 30, min_prev_orders: 5 }, severity: "warning" }, ctx({ snapshots: snaps }));
  assert.equal(out.length, 1);
  assert.equal(out[0].data?.change_pct, -50);
  const stable = days.map((d) => snap(d));
  assert.equal(evaluateRule({ rule_type: "sales_drop", params: { drop_pct: 30 }, severity: "warning" }, ctx({ snapshots: stable })).length, 0);
});

test("executor: política do cliente sobrescreve a global; padrão é aprovação", () => {
  const rows = [
    { client_id: null, action_type: "update_price", mode: "approval" as const, max_change_pct_per_day: 10 },
    { client_id: "c1", action_type: "update_price", mode: "auto" as const, max_change_pct_per_day: 5 },
  ];
  assert.equal(resolvePolicy("update_price", "c1", rows).mode, "auto");
  assert.equal(resolvePolicy("update_price", "c2", rows).mode, "approval");
  assert.equal(resolvePolicy("answer_question", "c1", rows).mode, "approval");
});

test("executor: limite de variação diária usa a referência do primeiro valor do dia", () => {
  assert.equal(checkDailyLimit({ type: "update_price", maxPct: 10, currentValue: 100, newValue: 109, firstValueToday: null }), null);
  assert.match(checkDailyLimit({ type: "update_price", maxPct: 10, currentValue: 100, newValue: 115, firstValueToday: null })!, /excede/);
  // já subiu de 100 para 108 hoje; subir para 112 dá 12% acumulado
  assert.match(checkDailyLimit({ type: "update_price", maxPct: 10, currentValue: 108, newValue: 112, firstValueToday: 100 })!, /12\.0%/);
  assert.equal(checkDailyLimit({ type: "update_stock", maxPct: 1, currentValue: 1, newValue: 100, firstValueToday: null }), null);
});

test("executor: validação de payload", () => {
  assert.equal(validatePayload("update_price", { price: 10 }), null);
  assert.ok(validatePayload("update_price", { price: -1 }));
  assert.ok(validatePayload("update_stock", { available_quantity: 1.5 }));
  assert.ok(validatePayload("update_listing", { title: "x".repeat(61) }));
  assert.equal(validatePayload("answer_question", { text: "Olá, temos sim!" }), null);
});

test("webhook: id do recurso e resumo de pedidos por dia", () => {
  assert.equal(resourceId("/orders/2000001"), "2000001");
  assert.equal(resourceId("/questions/123?x=1"), "123");
  assert.equal(resourceId("/items/MLB123"), "MLB123");
  assert.equal(resourceId("/x"), null);
  const day = spDate(new Date("2026-11-13T15:00:00Z"));
  const s = summarizeOrdersByDay([
    { externalId: "1", status: "paid", totalAmount: 100, paidAmount: 100, currencyId: "BRL", units: 2, dateCreated: "2026-11-13T15:00:00Z", dateClosed: null, shippingId: null, raw: null },
    { externalId: "2", status: "cancelled", totalAmount: 50, paidAmount: 0, currencyId: "BRL", units: 1, dateCreated: "2026-11-13T15:00:00Z", dateClosed: null, shippingId: null, raw: null },
  ]);
  assert.deepEqual(s[day], { count: 1, units: 2, revenue: 100 });
});
