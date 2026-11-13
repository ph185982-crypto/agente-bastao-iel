// Executor com travas: proposta → aprovada → executada/simulada/falhou.
import { adminDb } from "../supabase/admin";
import { getValidAccessToken } from "../accounts";
import { getAdapter } from "../marketplaces";
import type { ActionType, AdsContext } from "../marketplaces/types";
import { spDate } from "../dates";
import { checkDailyLimit, limitField, resolvePolicy, validatePayload, type PolicyRow } from "./policy";

export interface ProposeInput {
  clientId: string;
  accountId: string;
  type: ActionType;
  targetId: string;
  payload: Record<string, unknown>;
  reason?: string;
  source?: "manual" | "regra" | "ia";
  actor: string;
  dryRun?: boolean;
}

async function audit(entry: {
  action_id?: string | null;
  client_id?: string | null;
  event: string;
  actor: string;
  before_state?: unknown;
  after_state?: unknown;
  details?: unknown;
}) {
  await adminDb().from("audit_log").insert(entry);
}

async function adsContext(accountId: string, siteId: string | null, advertiserId: string | null): Promise<AdsContext | null> {
  void accountId;
  return advertiserId ? { advertiserId, siteId: siteId ?? "MLB" } : null;
}

export async function proposeAction(input: ProposeInput) {
  const db = adminDb();
  const invalid = validatePayload(input.type, input.payload);
  if (invalid) throw new Error(invalid);

  const { data: policies } = await db.from("action_policies").select("*");
  const policy = resolvePolicy(input.type, input.clientId, (policies ?? []) as PolicyRow[]);

  let before: Record<string, unknown> | null = null;
  try {
    const { token, account } = await getValidAccessToken(input.accountId);
    const ctx = await adsContext(account.id, account.site_id, account.ads_advertiser_id);
    before = await getAdapter(account.marketplace).getStateForAction(token, input.type, input.targetId, ctx);
  } catch (err) {
    before = { erro_leitura: err instanceof Error ? err.message : String(err) };
  }

  // Fase 3: autonomia com teto diário por cliente — acima do teto, a ação volta a pedir aprovação.
  let mode = policy.mode;
  if (mode === "auto") {
    const { data: settings } = await db.from("settings").select("max_auto_actions_per_day").single();
    const cap = Number(settings?.max_auto_actions_per_day ?? 20);
    const { count } = await db
      .from("actions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", input.clientId)
      .eq("decided_by", "auto")
      .gte("created_at", `${spDate()}T00:00:00-03:00`);
    if ((count ?? 0) >= cap) mode = "approval";
  }
  const status = mode === "blocked" ? "blocked" : mode === "auto" ? "approved" : "proposed";
  const { data: action, error } = await db
    .from("actions")
    .insert({
      client_id: input.clientId,
      account_id: input.accountId,
      action_type: input.type,
      target_id: input.targetId,
      payload: input.payload,
      reason: input.reason ?? null,
      source: input.source ?? "manual",
      status,
      dry_run: input.dryRun ?? false,
      before_state: before,
      ...(mode === "auto" ? { decided_by: "auto", decided_at: new Date().toISOString() } : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await audit({
    action_id: action.id,
    client_id: input.clientId,
    event: status === "blocked" ? "blocked" : "proposed",
    actor: input.actor,
    before_state: before,
    details: { type: input.type, target: input.targetId, payload: input.payload, mode, policy_mode: policy.mode },
  });
  if (status === "approved") return executeAction(action.id, "auto");
  return action;
}

export async function decideAction(actionId: string, decision: "approve" | "reject", actor: string) {
  const db = adminDb();
  const { data: action } = await db
    .from("actions")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      decided_by: actor,
      decided_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .eq("status", "proposed")
    .select("*")
    .maybeSingle();
  if (!action) throw new Error("Ação não está mais aguardando decisão.");
  await audit({ action_id: actionId, client_id: action.client_id, event: decision === "approve" ? "approved" : "rejected", actor });
  if (decision === "approve") return executeAction(actionId, actor);
  return action;
}

export async function executeAction(actionId: string, actor: string) {
  const db = adminDb();
  const { data: settings } = await db.from("settings").select("*").single();
  if (settings?.global_pause) {
    // Fica aprovada na fila; será executada quando a pausa geral for desligada.
    const { data } = await db.from("actions").select("*").eq("id", actionId).single();
    return { ...data, note: "Pausa geral ativa: ação aguardando." };
  }

  const { data: action } = await db
    .from("actions")
    .update({ status: "executing" })
    .eq("id", actionId)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();
  if (!action) throw new Error("Ação não está aprovada (ou já foi executada).");

  const type = action.action_type as ActionType;
  const fail = async (message: string, before: unknown = action.before_state) => {
    const { data } = await db
      .from("actions")
      .update({ status: "failed", error: message, executed_at: new Date().toISOString() })
      .eq("id", actionId)
      .select("*")
      .single();
    await audit({ action_id: actionId, client_id: action.client_id, event: "failed", actor, before_state: before, details: { error: message } });
    return data;
  };

  try {
    const { token, account } = await getValidAccessToken(action.account_id);
    const ml = getAdapter(account.marketplace);
    const ctx = await adsContext(account.id, account.site_id, account.ads_advertiser_id);
    const before = await ml.getStateForAction(token, type, action.target_id, ctx);

    // Limites diários (preço/verba)
    const field = limitField(type);
    if (field) {
      const { data: policies } = await db.from("action_policies").select("*");
      const policy = resolvePolicy(type, action.client_id, (policies ?? []) as PolicyRow[]);
      const startOfDay = `${spDate()}T00:00:00-03:00`;
      const { data: todays } = await db
        .from("actions")
        .select("before_state, executed_at")
        .eq("account_id", action.account_id)
        .eq("action_type", type)
        .eq("target_id", action.target_id)
        .eq("status", "executed")
        .gte("executed_at", startOfDay)
        .order("executed_at", { ascending: true })
        .limit(1);
      const firstToday = todays?.[0]?.before_state?.[field];
      const violation = checkDailyLimit({
        type,
        maxPct: policy.max_change_pct_per_day,
        currentValue: Number(before[field] ?? 0) || null,
        newValue: Number(action.payload[field]),
        firstValueToday: firstToday !== undefined ? Number(firstToday) : null,
      });
      if (violation) return fail(`Bloqueado pelo limite: ${violation}`, before);
    }

    if (type === "update_price" && before.has_variations) {
      return fail("Anúncio com variações: alteração de preço por variação ainda não suportada.", before);
    }

    const simulate = Boolean(settings?.dry_run || action.dry_run);
    if (simulate) {
      const after = { ...before, ...action.payload, simulado: true };
      const { data } = await db
        .from("actions")
        .update({ status: "simulated", before_state: before, after_state: after, executed_at: new Date().toISOString() })
        .eq("id", actionId)
        .select("*")
        .single();
      await audit({ action_id: actionId, client_id: action.client_id, event: "simulated", actor, before_state: before, after_state: after });
      return data;
    }

    const after = await ml.executeAction(token, type, action.target_id, action.payload, ctx);
    const { data } = await db
      .from("actions")
      .update({ status: "executed", before_state: before, after_state: after, executed_at: new Date().toISOString(), error: null })
      .eq("id", actionId)
      .select("*")
      .single();
    await audit({ action_id: actionId, client_id: action.client_id, event: "executed", actor, before_state: before, after_state: after });
    return data;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Executa ações aprovadas pendentes (ex.: depois que a pausa geral é desligada). */
export async function runApprovedQueue(budgetMs = 40_000) {
  const db = adminDb();
  const started = Date.now();
  const { data: settings } = await db.from("settings").select("global_pause").single();
  if (settings?.global_pause) return { paused: true, executed: 0 };
  const { data } = await db.from("actions").select("id").eq("status", "approved").order("created_at").limit(50);
  let executed = 0;
  for (const a of data ?? []) {
    if (Date.now() - started > budgetMs) break;
    try {
      await executeAction(a.id, "fila");
      executed++;
    } catch {
      /* ação já tratada por outro processo */
    }
  }
  // Destrava ações presas em "executing" há mais de 15 min
  await db
    .from("actions")
    .update({ status: "failed", error: "Execução interrompida (timeout)." })
    .eq("status", "executing")
    .lt("decided_at", new Date(Date.now() - 15 * 60_000).toISOString());
  return { paused: false, executed };
}
