// Relatório diário por cliente, em texto pronto para WhatsApp/e-mail. Números calculados aqui
// (nunca pela IA); a IA só contribui com resumo e diagnóstico.
import { addDays } from "../dates";
import { ACTION_LABEL } from "../executor/policy";

export interface ReportSnapshot {
  account_id: string;
  snapshot_date: string;
  orders_count: number | null;
  revenue: number | null;
  visits: number | null;
  ads_cost: number | null;
  ads_revenue: number | null;
  reputation_level: string | null;
  unanswered_questions: number | null;
  out_of_stock_listings: number | null;
  paused_listings: number | null;
}

export interface ReportData {
  clientName: string;
  today: string;
  snapshots: ReportSnapshot[];
  openAlerts: number;
  criticalAlerts: number;
  actions: { action_type: string; target_id: string; status: string; decided_by: string | null }[];
  aiSummary: string | null;
  aiDiagnosis: { tema: string; severidade: string; texto: string }[];
}

const REP: Record<string, string> = { "1_red": "vermelha", "2_orange": "laranja", "3_yellow": "amarela", "4_light_green": "verde-clara", "5_green": "verde" };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctTxt = (cur: number, prev: number) => {
  if (!prev) return "sem base de comparação";
  const p = ((cur - prev) / prev) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
};
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function buildReportText(r: ReportData): string {
  const y = addDays(r.today, -1);
  const sumDays = (from: string, to: string, k: keyof ReportSnapshot) =>
    r.snapshots.filter((s) => s.snapshot_date >= from && s.snapshot_date <= to).reduce((t, s) => t + Number(s[k] ?? 0), 0);

  const revY = sumDays(y, y, "revenue");
  const ordY = sumDays(y, y, "orders_count");
  const revLW = sumDays(addDays(y, -7), addDays(y, -7), "revenue");
  const rev7 = sumDays(addDays(r.today, -7), y, "revenue");
  const ord7 = sumDays(addDays(r.today, -7), y, "orders_count");
  const revP7 = sumDays(addDays(r.today, -14), addDays(r.today, -8), "revenue");
  const visY = sumDays(y, y, "visits");
  const adsCost = sumDays(y, y, "ads_cost");
  const adsRev = sumDays(y, y, "ads_revenue");
  const latest = r.snapshots.filter((s) => s.snapshot_date === r.today);
  const ref = latest.length ? latest : r.snapshots.filter((s) => s.snapshot_date === y);
  const rep = ref.map((s) => s.reputation_level).filter(Boolean).map((l) => REP[l!] ?? l);
  const questions = ref.reduce((t, s) => t + Number(s.unanswered_questions ?? 0), 0);
  const oos = ref.reduce((t, s) => t + Number(s.out_of_stock_listings ?? 0), 0);

  const lines: string[] = [];
  lines.push(`*Avanteza · Relatório diário*`);
  lines.push(`${r.clientName} — ${fmtDate(y)}`);
  lines.push("");
  lines.push(`*Vendas de ontem:* ${brl(revY)} em ${ordY} pedido(s) (${pctTxt(revY, revLW)} vs. mesmo dia da semana anterior)`);
  lines.push(`*Últimos 7 dias:* ${brl(rev7)} em ${ord7} pedido(s) (${pctTxt(rev7, revP7)} vs. 7 dias anteriores)`);
  if (visY) lines.push(`*Visitas ontem:* ${visY.toLocaleString("pt-BR")} · conversão ${((ordY / visY) * 100).toFixed(2)}%`);
  if (adsCost) lines.push(`*Product Ads ontem:* investimento ${brl(adsCost)}, receita ${brl(adsRev)}, ROAS ${(adsRev / adsCost).toFixed(2)}`);
  if (rep.length) lines.push(`*Reputação:* ${[...new Set(rep)].join(", ")}`);
  lines.push(`*Perguntas sem resposta:* ${questions} · *Anúncios sem estoque:* ${oos}`);
  lines.push(`*Alertas abertos:* ${r.openAlerts}${r.criticalAlerts ? ` (${r.criticalAlerts} crítico(s))` : ""}`);

  if (r.actions.length) {
    lines.push("");
    lines.push(`*Ações nas últimas 24 h:*`);
    for (const a of r.actions.slice(0, 10)) {
      const label = ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL] ?? a.action_type;
      const how = a.status === "simulated" ? "simulada" : a.decided_by === "auto" ? "automática" : "aprovada";
      lines.push(`• ${label} — ${a.target_id} (${how})`);
    }
  }
  if (r.aiSummary) {
    lines.push("");
    lines.push(`*Leitura da consultoria:*`);
    lines.push(r.aiSummary);
  }
  const crit = r.aiDiagnosis.filter((d) => d.severidade !== "info").slice(0, 4);
  if (crit.length) {
    lines.push("");
    lines.push(`*Pontos de atenção:*`);
    for (const d of crit) lines.push(`• ${d.tema}: ${d.texto}`);
  }
  return lines.join("\n");
}
