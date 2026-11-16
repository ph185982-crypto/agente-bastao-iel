import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlan, planTemplate, addMonthsStr, addDaysStr, isDateStr, PHASES } from "../src/lib/mapa/plan";
import { planSummary, phaseState, nextMilestones, isOverdue } from "../src/lib/mapa/progress";
import { sumPeriod, variation } from "../src/lib/mapa/metrics";
import { totalsOf } from "../src/lib/mapa/traffic";

test("plano: 4 fases com os meses combinados", () => {
  assert.deepEqual(PHASES.map((p) => [p.name, p.startMonth, p.endMonth]), [
    ["Diagnóstico e base", 1, 2], ["Estruturação", 3, 4], ["Aceleração", 5, 8], ["Escala", 9, 12],
  ]);
  for (const kind of ["marketplace", "midia", "ambos"] as const) {
    const plan = generatePlan(kind, "2026-01-15");
    assert.equal(plan.length, 4);
    for (const p of plan) assert.ok(p.actions.length >= 4, `${kind} fase ${p.position}`);
  }
});

test("plano: datas a partir do início (fases contíguas e prazos dentro da fase)", () => {
  const plan = generatePlan("marketplace", "2026-01-15");
  assert.equal(plan[0].startsOn, "2026-01-15");
  assert.equal(plan[0].endsOn, "2026-03-14");
  assert.equal(plan[1].startsOn, "2026-03-15");
  assert.equal(plan[3].endsOn, "2027-01-14");
  for (let i = 1; i < 4; i++) assert.equal(plan[i].startsOn, addDaysStr(plan[i - 1].endsOn, 1));
  for (const p of plan) for (const a of p.actions) {
    assert.ok(a.dueDate >= p.startsOn && a.dueDate <= p.endsOn, `${a.title}: ${a.dueDate} fora de ${p.startsOn}..${p.endsOn}`);
    assert.ok(a.dueMonth >= p.startMonth && a.dueMonth <= p.endMonth);
  }
});

test("plano: fim de mês preservado (31/jan + 1 mês = 28/fev) e ano bissexto", () => {
  assert.equal(addMonthsStr("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsStr("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsStr("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonthsStr("2026-12-15", 12), "2027-12-15");
  assert.ok(!isDateStr("2026-02-30") && !isDateStr("26-01-01") && isDateStr("2026-02-28"));
});

test("plano: marketplace e mídia têm ações diferentes e concretas; 'ambos' é a união", () => {
  const titles = (k: "marketplace" | "midia" | "ambos") => planTemplate(k).flatMap((p) => p.actions.map((a) => a.title));
  const mk = titles("marketplace").join(" | "), md = titles("midia").join(" | ");
  for (const w of ["catálogo", "preços", "ADS", "promoç", "reputação", "logística", "Shopee", "TikTok Shop"]) assert.match(mk, new RegExp(w, "i"), w);
  for (const w of ["rastreamento", "pixels", "campanhas", "criativos", "testes", "verba", "remarketing", "Escalar", "novos canais"]) assert.match(md, new RegExp(w, "i"), w);
  assert.doesNotMatch(md, /Shopee/);
  assert.doesNotMatch(mk, /pixel/i);
  assert.equal(titles("ambos").length, titles("marketplace").length + titles("midia").length);
  // responsáveis dos dois lados
  const owners = new Set(planTemplate("marketplace").flatMap((p) => p.actions.map((a) => a.owner)));
  assert.deepEqual([...owners].sort(), ["avanteza", "cliente"]);
});

test("plano: função pura (mesma entrada, mesma saída) e rejeita entradas inválidas", () => {
  assert.deepEqual(generatePlan("midia", "2026-05-01"), generatePlan("midia", "2026-05-01"));
  assert.throws(() => generatePlan("midia", "2026-13-01"), /inválida/);
  assert.throws(() => generatePlan("x" as any, "2026-05-01"), /inválido/);
});

test("progresso: resumo, estado das fases e marcos", () => {
  const today = "2026-03-01";
  const acts = [
    { id: "1", title: "a", status: "concluida" as const, owner: "avanteza" as const, due_date: "2026-01-10", phase_id: "p1" },
    { id: "2", title: "b", status: "planejada" as const, owner: "cliente" as const, due_date: "2026-02-10", phase_id: "p1" },
    { id: "3", title: "c", status: "planejada" as const, owner: "cliente" as const, due_date: "2026-04-10", phase_id: "p2" },
  ];
  const phases = [
    { id: "p1", position: 1, name: "F1", starts_on: "2026-01-01", ends_on: "2026-02-28" },
    { id: "p2", position: 2, name: "F2", starts_on: "2026-03-01", ends_on: "2026-04-30" },
    { id: "p3", position: 3, name: "F3", starts_on: "2026-05-01", ends_on: "2026-08-31" },
  ];
  assert.deepEqual(planSummary(acts, today), { total: 3, done: 1, open: 2, overdue: 1, blocked: 0, pct: 33 });
  assert.ok(isOverdue(acts[1], today) && !isOverdue(acts[0], today));
  assert.equal(phaseState(phases[0], acts, today), "em_execucao");
  assert.equal(phaseState(phases[2], acts, today), "futura");
  assert.equal(phaseState(phases[0], [{ ...acts[0], phase_id: "p1" }], today), "concluida");
  const m = nextMilestones(phases, acts, today);
  assert.equal(m.nextPhase?.name, "F3");
  assert.equal(m.actions[0].label, "b");
  assert.ok(m.actions[0].overdue);
});

test("indicadores de marketplace e de tráfego", () => {
  const rows = [
    { snapshot_date: "2026-02-01", revenue: 1000, orders_count: 10, units_sold: 12, visits: 100, ads_cost: 100, ads_revenue: 500 },
    { snapshot_date: "2026-02-02", revenue: 500, orders_count: 5, units_sold: 5, visits: 50, ads_cost: 0, ads_revenue: 0 },
    { snapshot_date: "2026-01-01", revenue: 9999, orders_count: 1, units_sold: 1, visits: 1, ads_cost: 1, ads_revenue: 1 },
  ];
  const s = sumPeriod(rows, "2026-02-01", "2026-02-28");
  assert.equal(s.revenue, 1500); assert.equal(s.orders, 15); assert.equal(s.ticket, 100); assert.equal(s.roas, 5);
  assert.equal(variation(150, 100), 50); assert.equal(variation(1, 0), null);
  const t = totalsOf({ from: "a", to: "b", channels: [{ channel: "meta", spend: 100, revenue: 400, conversions: 10, clicks: 1, impressions: 1 }, { channel: "google", spend: 100, revenue: 200, conversions: 10, clicks: 1, impressions: 1 }] });
  assert.equal(t.roas, 3); assert.equal(t.cpa, 10);
});
