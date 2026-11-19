// Regras puras do executor: modos, limites diários e validação de payload.
import type { ActionType } from "../marketplaces/types";
import { safeImageUrl } from "../marketplaces/images";

const fotosOk = (xs: unknown[]) => xs.length >= 1 && xs.length <= 10 && xs.every((x) => safeImageUrl(x) === x);

const ID_FOTO_ML = /^[0-9A-Za-z_-]{3,80}$/;
/** Foto do corpo do POST /items: { source: URL https válida } ou { id: foto já enviada ao ML (upload) }. */
const fotoItemOk = (p: any) => (p && typeof p === "object" && typeof p.source === "string" ? safeImageUrl(p.source) === p.source : typeof p?.id === "string" && ID_FOTO_ML.test(p.id));

/**
 * create_listing: payload = { item: <corpo do POST /items>, description? }. Três formatos:
 * clássico (title + variations), User Products (family_name, sem title e sem variations) e catálogo (catalog_listing).
 */
function validarCriacao(payload: Record<string, unknown>): string | null {
  const it = payload.item as Record<string, any> | undefined;
  if (!it || typeof it !== "object") return "Anúncio sem dados.";
  const catalogo = it.catalog_listing === true;
  const up = it.family_name !== undefined;
  if (up) {
    if (typeof it.family_name !== "string" || it.family_name.trim().length < 3 || it.family_name.length > 120) return "family_name deve ter entre 3 e 120 caracteres.";
    if (it.title !== undefined) return "No modelo User Products não se envia título (o Mercado Livre gera a partir do family_name).";
    if (it.variations !== undefined) return "No modelo User Products não há variações: cada cor/tamanho é um anúncio.";
  } else if (it.title !== undefined || !catalogo) {
    if (typeof it.title !== "string" || it.title.trim().length < 3 || it.title.length > 60) return "Título deve ter entre 3 e 60 caracteres.";
  }
  if (catalogo && (typeof it.catalog_product_id !== "string" || !/^MLB\d{1,15}$/.test(it.catalog_product_id))) return "Anúncio de catálogo precisa de catalog_product_id válido (ex.: MLB12345).";
  if (typeof it.category_id !== "string" || !/^MLB\d{1,12}$/.test(it.category_id)) return "Categoria inválida (ex.: MLB1055).";
  if (!(typeof it.price === "number" && Number.isFinite(it.price) && it.price > 0)) return "Informe um preço válido (> 0).";
  if (!(Number.isInteger(it.available_quantity) && it.available_quantity >= 1)) return "Estoque inicial precisa ser inteiro (>= 1).";
  if (!["new", "used"].includes(it.condition)) return "Condição deve ser new (novo) ou used (usado).";
  if (!["gold_special", "gold_pro"].includes(it.listing_type_id)) return "Tipo de anúncio deve ser clássico ou premium.";
  const fotos: unknown[] = Array.isArray(it.pictures) ? it.pictures : [];
  if (fotos.length > 10 || (!catalogo && fotos.length < 1) || !fotos.every(fotoItemOk)) return "Fotos: de 1 a 10 (URL https válida ou id de foto do ML).";
  if (it.variations !== undefined) {
    if (!Array.isArray(it.variations) || it.variations.length > 100) return "Variações inválidas.";
    for (const v of it.variations) {
      if (!Array.isArray(v.attribute_combinations) || !v.attribute_combinations.length) return "Cada variação precisa de atributos (ex.: COLOR, SIZE).";
      if (!(typeof v.price === "number" && v.price > 0) || !(Number.isInteger(v.available_quantity) && v.available_quantity >= 0)) return "Cada variação precisa de preço (> 0) e estoque inteiro.";
    }
  }
  if (payload.description !== undefined && (typeof payload.description !== "string" || payload.description.length > 50_000)) return "Descrição: até 50.000 caracteres.";
  return null;
}

export type Mode = "auto" | "approval" | "blocked";

export const ACTION_LABEL: Record<ActionType, string> = {
  update_price: "Alterar preço",
  update_stock: "Alterar estoque",
  pause_listing: "Pausar anúncio",
  activate_listing: "Reativar anúncio",
  update_listing: "Editar anúncio (título/descrição/fotos)",
  answer_question: "Responder pergunta",
  update_ads_budget: "Alterar verba de Ads",
  update_ads_status: "Ligar/pausar campanha de Ads",
  create_promotion: "Criar promoção",
  create_listing: "Criar anúncio",
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
  if (payload.variation_id !== undefined && payload.variation_id !== null && !/^[0-9A-Za-z_-]{1,40}$/.test(String(payload.variation_id))) {
    return "ID de variação inválido.";
  }
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
      if (typeof payload.title !== "string" && typeof payload.description !== "string" && !Array.isArray(payload.pictures)) return "Informe título, descrição ou fotos.";
      if (typeof payload.title === "string" && (payload.title.length < 3 || payload.title.length > 60)) return "Título deve ter entre 3 e 60 caracteres.";
      if (typeof payload.description === "string" && payload.description.length > 50_000) return "Descrição: até 50.000 caracteres.";
      if (Array.isArray(payload.pictures) && !fotosOk(payload.pictures)) return "Fotos: de 1 a 10 URLs https válidas.";
      return null;
    case "create_listing":
      return validarCriacao(payload);
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
