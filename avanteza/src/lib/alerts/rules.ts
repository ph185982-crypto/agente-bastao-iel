// Avaliadores puros das regras de alerta (sem I/O → testáveis).

export type RuleType =
  | "reputation_drop"
  | "listing_paused"
  | "out_of_stock"
  | "roas_below"
  | "unanswered_question"
  | "sales_drop";

export type Severity = "info" | "warning" | "critical";

export interface Rule {
  rule_type: RuleType;
  params: Record<string, any>;
  severity: Severity;
}

export interface Snapshot {
  snapshot_date: string;
  orders_count: number | null;
  revenue: number | null;
  reputation_level: string | null;
  claims_rate: number | null;
  ads_roas: number | null;
  ads_cost: number | null;
}

export interface ListingLite {
  external_id: string;
  title: string | null;
  status: string | null;
  sub_status: string[] | null;
  available_quantity: number | null;
}

export interface QuestionLite {
  external_id: string;
  item_id: string | null;
  text: string | null;
  status: string | null;
  date_created: string | null;
}

export interface CampaignLite {
  external_id: string;
  name: string | null;
  status: string | null;
  metrics_7d: { cost?: number | null; revenue?: number | null; roas?: number | null } | null;
}

export interface AccountContext {
  accountId: string;
  nickname: string;
  snapshots: Snapshot[]; // ordenados do mais antigo ao mais recente
  listings: ListingLite[];
  questions: QuestionLite[];
  campaigns: CampaignLite[];
  now: Date;
}

export interface AlertCandidate {
  dedupKey: string;
  title: string;
  message: string;
  severity: Severity;
  data?: Record<string, unknown>;
}

export const RULE_LABEL: Record<RuleType, string> = {
  reputation_drop: "Reputação caiu",
  listing_paused: "Anúncio pausado",
  out_of_stock: "Anúncio sem estoque",
  roas_below: "ROAS abaixo da meta",
  unanswered_question: "Pergunta sem resposta",
  sales_drop: "Vendas caindo",
};

export const DEFAULT_RULES: Rule[] = [
  { rule_type: "reputation_drop", params: { claims_rate_increase: 0.005 }, severity: "critical" },
  { rule_type: "listing_paused", params: {}, severity: "warning" },
  { rule_type: "out_of_stock", params: {}, severity: "warning" },
  { rule_type: "roas_below", params: { min_roas: 3, min_cost: 20 }, severity: "warning" },
  { rule_type: "unanswered_question", params: { hours: 12 }, severity: "warning" },
  { rule_type: "sales_drop", params: { drop_pct: 30, min_prev_orders: 5 }, severity: "warning" },
];

export function reputationScore(level: string | null): number | null {
  if (!level) return null;
  const n = parseInt(level, 10);
  return Number.isFinite(n) ? n : null;
}

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function evaluateRule(rule: Rule, ctx: AccountContext): AlertCandidate[] {
  const p = rule.params ?? {};
  const key = (suffix: string) => `${ctx.accountId}:${rule.rule_type}:${suffix}`;
  const snaps = ctx.snapshots;
  const last = snaps[snaps.length - 1];

  switch (rule.rule_type) {
    case "reputation_drop": {
      if (snaps.length < 2 || !last) return [];
      const prev = [...snaps].reverse().find((s) => s.snapshot_date < last.snapshot_date && s.reputation_level);
      if (!prev) return [];
      const out: AlertCandidate[] = [];
      const a = reputationScore(prev.reputation_level);
      const b = reputationScore(last.reputation_level);
      if (a !== null && b !== null && b < a) {
        out.push({
          dedupKey: key(`level:${last.reputation_level}`),
          title: `${ctx.nickname}: reputação caiu`,
          message: `Nível passou de ${prev.reputation_level} para ${last.reputation_level}.`,
          severity: rule.severity,
          data: { from: prev.reputation_level, to: last.reputation_level },
        });
      }
      const inc = Number(p.claims_rate_increase ?? 0.005);
      if (prev.claims_rate !== null && last.claims_rate !== null && last.claims_rate - prev.claims_rate >= inc) {
        out.push({
          dedupKey: key(`claims:${last.snapshot_date}`),
          title: `${ctx.nickname}: reclamações subiram`,
          message: `Taxa de reclamações de ${(prev.claims_rate * 100).toFixed(2)}% para ${(last.claims_rate * 100).toFixed(2)}%.`,
          severity: rule.severity,
        });
      }
      return out;
    }
    case "listing_paused":
      return ctx.listings
        .filter((l) => l.status === "paused" && !(l.sub_status ?? []).includes("out_of_stock"))
        .map((l) => ({
          dedupKey: key(l.external_id),
          title: `${ctx.nickname}: anúncio pausado`,
          message: `${l.external_id} — ${l.title ?? ""}${l.sub_status?.length ? ` (${l.sub_status.join(", ")})` : ""}`,
          severity: rule.severity,
          data: { item_id: l.external_id },
        }));
    case "out_of_stock":
      return ctx.listings
        .filter(
          (l) =>
            (l.status === "active" || l.status === "paused") &&
            ((l.available_quantity ?? 1) === 0 || (l.sub_status ?? []).includes("out_of_stock")),
        )
        .map((l) => ({
          dedupKey: key(l.external_id),
          title: `${ctx.nickname}: sem estoque`,
          message: `${l.external_id} — ${l.title ?? ""}`,
          severity: rule.severity,
          data: { item_id: l.external_id },
        }));
    case "roas_below": {
      const min = Number(p.min_roas ?? 3);
      const minCost = Number(p.min_cost ?? 0);
      return ctx.campaigns
        .filter((c) => c.status === "active" && c.metrics_7d)
        .filter((c) => {
          const cost = Number(c.metrics_7d?.cost ?? 0);
          if (cost < minCost || cost <= 0) return false;
          const roas = c.metrics_7d?.roas ?? (Number(c.metrics_7d?.revenue ?? 0) / cost);
          return roas < min;
        })
        .map((c) => {
          const cost = Number(c.metrics_7d?.cost ?? 0);
          const roas = c.metrics_7d?.roas ?? Number(c.metrics_7d?.revenue ?? 0) / cost;
          return {
            dedupKey: key(c.external_id),
            title: `${ctx.nickname}: ROAS ${roas.toFixed(2)} < meta ${min}`,
            message: `Campanha "${c.name ?? c.external_id}" nos últimos 7 dias: custo ${fmtBRL(cost)}, ROAS ${roas.toFixed(2)}.`,
            severity: rule.severity,
            data: { campaign_id: c.external_id, roas, cost },
          };
        });
    }
    case "unanswered_question": {
      const hours = Number(p.hours ?? 12);
      return ctx.questions
        .filter((q) => q.status === "UNANSWERED" && q.date_created)
        .filter((q) => ctx.now.getTime() - new Date(q.date_created!).getTime() > hours * 3600_000)
        .map((q) => ({
          dedupKey: key(q.external_id),
          title: `${ctx.nickname}: pergunta sem resposta há mais de ${hours}h`,
          message: `${q.item_id ?? ""}: "${(q.text ?? "").slice(0, 160)}"`,
          severity: rule.severity,
          data: { question_id: q.external_id, item_id: q.item_id },
        }));
    }
    case "sales_drop": {
      const dropPct = Number(p.drop_pct ?? 30);
      const minPrev = Number(p.min_prev_orders ?? 5);
      // Só dias fechados: exclui o último snapshot (hoje, parcial)
      const closed = snaps.slice(0, -1);
      if (closed.length < 14) return [];
      const cur = closed.slice(-7).reduce((s, x) => s + (x.orders_count ?? 0), 0);
      const prev = closed.slice(-14, -7).reduce((s, x) => s + (x.orders_count ?? 0), 0);
      if (prev < minPrev) return [];
      const change = ((cur - prev) / prev) * 100;
      if (change > -dropPct) return [];
      const end = closed[closed.length - 1].snapshot_date;
      return [
        {
          dedupKey: key(`week:${end}`),
          title: `${ctx.nickname}: vendas ${change.toFixed(0)}% na semana`,
          message: `Últimos 7 dias: ${cur} pedidos; 7 dias anteriores: ${prev}.`,
          severity: rule.severity,
          data: { current: cur, previous: prev, change_pct: change },
        },
      ];
    }
  }
}
