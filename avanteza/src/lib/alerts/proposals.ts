// Fase 3: ações propostas diretamente por regras (sem IA), sempre com justificativa numérica.
import type { ActionType } from "../marketplaces/types";
import type { AccountContext, AlertCandidate, Rule } from "./rules";

export interface RuleProposal {
  type: ActionType;
  targetId: string;
  payload: Record<string, unknown>;
  reason: string;
}

export function ruleProposal(rule: Rule, alert: AlertCandidate, ctx: AccountContext): RuleProposal | null {
  switch (rule.rule_type) {
    case "roas_below": {
      // Corta a verba da campanha em cut_pct (padrão 15%), arredondado a R$ 1.
      const id = String(alert.data?.campaign_id ?? "");
      const camp = ctx.campaigns.find((c) => c.external_id === id);
      const budget = Number(camp?.budget ?? 0);
      if (!camp || budget <= 0) return null;
      const cut = Math.min(Math.max(Number(rule.params.cut_pct ?? 15), 1), 50);
      const newBudget = Math.max(1, Math.round(budget * (1 - cut / 100)));
      if (newBudget >= budget) return null;
      return {
        type: "update_ads_budget",
        targetId: id,
        payload: { budget: newBudget },
        reason: `[Regra ROAS] ${alert.message} Reduzir verba de ${budget} para ${newBudget} (−${cut}%).`,
      };
    }
    case "out_of_stock":
    case "listing_paused":
    case "unanswered_question":
    case "reputation_drop":
    case "sales_drop":
      return null; // essas regras só alertam; respostas e ajustes vêm do agente de IA
  }
}
