// Regras puras do executor: modos, limites diários e validação de payload.
import type { ActionType } from "../marketplaces/types";

export type Mode = "auto" | "approval" | "blocked";

export const ACTION_LABEL: Record<ActionType, string> = {
  update_price: "Alterar preço",
  update_stock: "Alterar estoque",
  pause_listing: "Pausar anúncio",
  activate_listing: "Reativar anúncio",
  update_listing: "Editar anúncio (título/descrição)",
  answer_question: "Responder pergunta",
  update_ads_budget: "Alterar verba de Ads",
  update_ads_status: "Ligar/pausar campanha de Ads",
  create_promotion: "Criar promoção",
};

export const ACTION_TYPES = Object.keys(ACTION_LABEL) as ActionType[];

export interface PolicyRow {
  client_id: string | null;
  action_type: string;
  mode: Mode;
  max_change_pct_per_day: number | null;
}

/** Política do cliente sobrescreve a global; sem nada configurado, pede aprovação. */
export function resolvePolicy(type: ActionType, clientId: string, rows: PolicyRow[]): PolicyRow {
  return (
    rows.find((r) => r.action_type === type && r.client_id === clientId) ??
    rows.find((r) => r.action_type === type && r.client_id === null) ?? {
      client_id: null,
      action_type: type,
      mode: "approval",
      max_change_pct_per_day: null,
    }
  );
}

export function validatePayload(type: ActionType, payload: Record<string, unknown>): string | null {
  const pos = (k: string) => typeof payload[k] === "number" && Number.isFinite(payload[k]) && (payload[k] as number) > 0;
  switch (type) {
    case "update_price":
      return pos("price") ? null : "Informe um preço válido (> 0).";
    case "update_stock":
      return typeof payload.available_quantity === "number" && payload.available_quantity >= 0 && Number.isInteger(payload.available_quantity)
        ? null
        : "Informe um estoque inteiro (>= 0).";
    case "pause_listing":
    case "activate_listing":
      return null;
    case "update_listing":
      if (typeof payload.title !== "string" && typeof payload.description !== "string") return "Informe título ou descrição.";
      if (typeof payload.title === "string" && (payload.title.length < 3 || payload.title.length > 60)) return "Título deve ter entre 3 e 60 caracteres.";
      return null;
    case "answer_question":
      return typeof payload.text === "string" && payload.text.trim().length >= 2 && payload.text.length <= 2000
        ? null
        : "Resposta deve ter entre 2 e 2000 caracteres.";
    case "update_ads_budget":
      return pos("budget") ? null : "Informe uma verba válida (> 0).";
    case "update_ads_status":
      return payload.status === "active" || payload.status === "paused" ? null : "Status deve ser active ou paused.";
    case "create_promotion":
      return pos("deal_price") && typeof payload.start_date === "string" && typeof payload.finish_date === "string"
        ? null
        : "Informe preço promocional, início e fim.";
  }
}

/**
 * Limite de variação diária (preço e verba). Compara o novo valor com o valor de referência do dia
 * (o "antes" da primeira ação executada hoje no mesmo alvo; se não houver, o valor atual).
 */
export function checkDailyLimit(params: {
  type: ActionType;
  maxPct: number | null;
  currentValue: number | null;
  newValue: number;
  firstValueToday: number | null;
}): string | null {
  const { type, maxPct, currentValue, newValue, firstValueToday } = params;
  if (!["update_price", "update_ads_budget"].includes(type)) return null;
  if (maxPct === null || maxPct === undefined) return null;
  const base = firstValueToday ?? currentValue;
  if (!base || base <= 0) return null;
  const change = (Math.abs(newValue - base) / base) * 100;
  if (change > maxPct + 1e-9) {
    return `Variação de ${change.toFixed(1)}% no dia excede o limite de ${maxPct}% (referência ${base}).`;
  }
  return null;
}

export function limitField(type: ActionType): "price" | "budget" | null {
  return type === "update_price" ? "price" : type === "update_ads_budget" ? "budget" : null;
}
