import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProposals } from "../src/lib/ai/agent";
import { toExecutorPayload, AgentOutputSchema, type ProposedAction } from "../src/lib/ai/schema";
import { buildReportText } from "../src/lib/ai/report";
import { ruleProposal } from "../src/lib/alerts/proposals";
import { shopeeSign, ShopeeAdapter } from "../src/lib/marketplaces/shopee/adapter";
import { validatePayload } from "../src/lib/executor/policy";

const base = (o: Partial<ProposedAction>): ProposedAction => ({
  tipo: "update_price", conta_id: "acc1", alvo: "MLB1", justificativa: "x", prioridade: "media",
  preco: null, estoque: null, titulo: null, descricao: null, resposta: null, verba: null,
  status_campanha: null, preco_promocional: null, inicio: null, fim: null, ...o,
});

test("IA: só passam ações com IDs reais, sem duplicata nem tipo bloqueado", () => {
  const valid = {
    accounts: new Set(["acc1"]), listings: new Set(["MLB1", "MLB2"]), questions: new Set(["q1"]),
    campaigns: new Set(["c1"]), pending: new Set(["update_stock:MLB2"]), blocked: new Set(["create_promotion"]),
  };
  const { ok, dropped } = filterProposals([
    base({ preco: 99 }),
    base({ preco: 98 }), // duplicada
    base({ alvo: "MLB999", preco: 10 }), // alvo inventado
    base({ conta_id: "outra", alvo: "MLB1", tipo: "pause_listing" }),
    base({ tipo: "update_stock", alvo: "MLB2", estoque: 5 }), // já na fila
    base({ tipo: "answer_question", alvo: "q1", resposta: "Olá! Sim, temos." }),
    base({ tipo: "create_promotion", alvo: "MLB1" }),
    base({ tipo: "update_ads_budget", alvo: "MLB1", verba: 10 }), // campanha inexistente
  ], valid);
  assert.deepEqual(ok.map((a) => `${a.tipo}:${a.alvo}`), ["update_price:MLB1", "answer_question:q1"]);
  assert.equal(dropped.length, 6);
});

test("IA: payload do executor válido para cada tipo", () => {
  assert.deepEqual(toExecutorPayload(base({ preco: 120.5 })), { price: 120.5 });
  assert.equal(validatePayload("update_price", toExecutorPayload(base({ preco: 120.5 }))), null);
  assert.equal(validatePayload("answer_question", toExecutorPayload(base({ tipo: "answer_question", resposta: "Temos sim!" }))), null);
  assert.deepEqual(toExecutorPayload(base({ tipo: "update_listing", titulo: "Novo título" })), { title: "Novo título" });
  assert.ok(AgentOutputSchema.safeParse({ resumo: "ok", diagnostico: [], acoes: [base({ preco: 1 })] }).success);
  assert.ok(!AgentOutputSchema.safeParse({ resumo: "ok", diagnostico: [], acoes: [{ tipo: "apagar_tudo" }] }).success);
});

test("Relatório diário: números corretos e seções", () => {
  const snap = (d: string, rev: number, ord: number, extra = {}) => ({
    account_id: "a", snapshot_date: d, orders_count: ord, revenue: rev, visits: 1000, ads_cost: 50, ads_revenue: 400,
    reputation_level: "5_green", unanswered_questions: 2, out_of_stock_listings: 1, paused_listings: 0, ...extra,
  });
  const txt = buildReportText({
    clientName: "Loja X", today: "2026-11-13",
    snapshots: [snap("2026-11-12", 2000, 20), snap("2026-11-05", 1000, 10), snap("2026-11-13", 300, 3)],
    openAlerts: 3, criticalAlerts: 1,
    actions: [{ action_type: "update_price", target_id: "MLB1", status: "executed", decided_by: "auto" }],
    aiSummary: "Semana forte.", aiDiagnosis: [{ tema: "Estoque", severidade: "atencao", texto: "1 anúncio zerado" }],
  });
  assert.match(txt, /Loja X — 12\/11/);
  assert.match(txt, /R\$\s?2\.000,00 em 20 pedido\(s\) \(\+100% vs\. mesmo dia/);
  assert.match(txt, /conversão 2\.00%/);
  assert.match(txt, /ROAS 8\.00/);
  assert.match(txt, /Reputação:\* verde/);
  assert.match(txt, /Alterar preço — MLB1 \(automática\)/);
  assert.match(txt, /Semana forte\./);
  assert.match(txt, /Estoque: 1 anúncio zerado/);
});

test("Regra ROAS propõe corte de verba limitado", () => {
  const p = ruleProposal(
    { rule_type: "roas_below", params: { cut_pct: 20 }, severity: "warning" },
    { dedupKey: "k", title: "t", message: "ROAS 1.5", severity: "warning", data: { campaign_id: "c1" } },
    { accountId: "a", nickname: "n", snapshots: [], listings: [], questions: [], now: new Date(),
      campaigns: [{ external_id: "c1", name: "C", status: "active", budget: 100, metrics_7d: { cost: 100, revenue: 150 } }] },
  );
  assert.deepEqual(p?.payload, { budget: 80 });
  assert.equal(p?.type, "update_ads_budget");
  assert.equal(ruleProposal({ rule_type: "out_of_stock", params: {}, severity: "warning" }, { dedupKey: "k", title: "", message: "", severity: "warning" }, { accountId: "a", nickname: "n", snapshots: [], listings: [], questions: [], campaigns: [], now: new Date() }), null);
});

test("Shopee: assinatura HMAC-SHA256 e URL de autorização com state", () => {
  const s1 = shopeeSign("chave", [123, "/api/v2/shop/auth_partner", 1700000000]);
  assert.match(s1, /^[0-9a-f]{64}$/);
  assert.equal(s1, shopeeSign("chave", ["123/api/v2/shop/auth_partner1700000000"]));
  process.env.SHOPEE_PARTNER_ID = "123";
  process.env.SHOPEE_PARTNER_KEY = "chave";
  const url = new URL(new ShopeeAdapter().buildAuthorizationUrl({ state: "ST4TE", redirectUri: "https://app.avanteza.com.br/api/auth/shopee/callback" }));
  assert.equal(url.pathname, "/api/v2/shop/auth_partner");
  assert.equal(url.searchParams.get("partner_id"), "123");
  assert.equal(new URL(url.searchParams.get("redirect")!).searchParams.get("state"), "ST4TE");
  const t = url.searchParams.get("timestamp")!;
  assert.equal(url.searchParams.get("sign"), shopeeSign("chave", ["123", "/api/v2/shop/auth_partner", t]));
});
