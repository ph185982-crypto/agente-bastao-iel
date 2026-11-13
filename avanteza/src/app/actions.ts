"use server";
// Server Actions do painel. Todas exigem administrador logado.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { userDb } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";
import { createAuthorizationLink } from "@/lib/oauth";
import { collectBatch } from "@/lib/collector";
import { runAlerts, ensureDefaultRules } from "@/lib/alerts/engine";
import { decideAction, executeAction, proposeAction } from "@/lib/executor/executor";
import { ACTION_TYPES } from "@/lib/executor/policy";
import type { ActionType } from "@/lib/marketplaces/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (fd: FormData, fallback: string) => {
  const r = str(fd, "back");
  return r.startsWith("/") ? r : fallback;
};
function flash(path: string, msg: string, kind: "ok" | "erro" = "ok"): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(msg)}`);
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function logout() {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/login");
}

// ───────────── Clientes e contas ─────────────
export async function createClient(fd: FormData) {
  await requireAdmin();
  const name = str(fd, "name");
  if (!name) flash("/clientes", "Informe o nome do cliente.", "erro");
  const db = await userDb();
  const { data, error } = await db
    .from("clients")
    .insert({
      name,
      contact_name: str(fd, "contact_name") || null,
      contact_email: str(fd, "contact_email") || null,
      contact_phone: str(fd, "contact_phone") || null,
      notes: str(fd, "notes") || null,
    })
    .select("id")
    .single();
  if (error) flash("/clientes", error.message, "erro");
  await ensureDefaultRules(data!.id);
  revalidatePath("/clientes");
  flash(`/clientes/${data!.id}`, "Cliente criado. Gere o link de autorização abaixo.");
}

export async function updateClient(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "client_id");
  const db = await userDb();
  const { error } = await db
    .from("clients")
    .update({
      name: str(fd, "name"),
      contact_name: str(fd, "contact_name") || null,
      contact_email: str(fd, "contact_email") || null,
      contact_phone: str(fd, "contact_phone") || null,
      notes: str(fd, "notes") || null,
      active: fd.get("active") === "on",
    })
    .eq("id", id);
  if (error) flash(`/clientes/${id}`, error.message, "erro");
  revalidatePath(`/clientes/${id}`);
  flash(`/clientes/${id}`, "Dados salvos.");
}

export async function generateAuthLink(clientId: string): Promise<{ url?: string; error?: string }> {
  await requireAdmin();
  try {
    const { url } = await createAuthorizationLink(clientId, "mercadolivre");
    return { url };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function collectNow(fd: FormData) {
  await requireAdmin();
  const accountId = str(fd, "account_id");
  const path = back(fd, "/clientes");
  let msg = "";
  try {
    const [r] = await collectBatch(50_000, accountId);
    if (!r) msg = "Conta não está ativa.";
    else if (!r.ok) flash(path, `Coleta falhou: ${r.error}`, "erro");
    else msg = `Coleta concluída: ${r.listings} anúncios, ${r.orders} pedidos, ${r.questions} perguntas, ${r.campaigns ?? 0} campanhas.${r.warnings.length ? " Avisos: " + r.warnings.join("; ") : ""}`;
    await runAlerts();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect
    flash(path, errMsg(e), "erro");
  }
  revalidatePath(path);
  flash(path, msg);
}

export async function disconnectAccount(fd: FormData) {
  const actor = await requireAdmin();
  const accountId = str(fd, "account_id");
  const path = back(fd, "/clientes");
  const db = adminDb();
  const { data } = await db
    .from("marketplace_accounts")
    .update({ status: "disabled", access_token_enc: null, refresh_token_enc: null, token_expires_at: null })
    .eq("id", accountId)
    .select("client_id, nickname")
    .single();
  await db.from("audit_log").insert({ client_id: data?.client_id, event: "account_disconnected", actor, details: { nickname: data?.nickname } });
  revalidatePath(path);
  flash(path, "Conta desconectada e tokens apagados.");
}

// ───────────── Regras de alerta e políticas ─────────────
export async function saveRule(fd: FormData) {
  await requireAdmin();
  const clientId = str(fd, "client_id");
  const ruleType = str(fd, "rule_type");
  const params: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("p_") && String(v).trim() !== "") params[k.slice(2)] = Number(v);
  }
  const db = await userDb();
  const { error } = await db.from("alert_rules").upsert(
    { client_id: clientId, rule_type: ruleType, enabled: fd.get("enabled") === "on", params, severity: str(fd, "severity") || "warning" },
    { onConflict: "client_id,rule_type" },
  );
  const path = `/clientes/${clientId}`;
  if (error) flash(path, error.message, "erro");
  revalidatePath(path);
  flash(path + "#regras", "Regra salva.");
}

export async function savePolicy(fd: FormData) {
  const actor = await requireAdmin();
  const clientId = str(fd, "client_id") || null;
  const type = str(fd, "action_type");
  const path = back(fd, "/configuracoes");
  if (!ACTION_TYPES.includes(type as ActionType)) flash(path, "Tipo de ação inválido.", "erro");
  const mode = str(fd, "mode");
  const maxRaw = str(fd, "max_change_pct_per_day");
  const db = adminDb();
  if (clientId && mode === "inherit") {
    await db.from("action_policies").delete().eq("client_id", clientId).eq("action_type", type);
  } else {
    if (!["auto", "approval", "blocked"].includes(mode)) flash(path, "Modo inválido.", "erro");
    let q = db.from("action_policies").select("id").eq("action_type", type);
    q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
    const { data: existing } = await q.maybeSingle();
    const row = { client_id: clientId, action_type: type, mode, max_change_pct_per_day: maxRaw === "" ? null : Number(maxRaw) };
    const { error } = existing
      ? await db.from("action_policies").update(row).eq("id", existing.id)
      : await db.from("action_policies").insert(row);
    if (error) flash(path, error.message, "erro");
  }
  await db.from("audit_log").insert({ client_id: clientId, event: "policy_changed", actor, details: { type, mode, max: maxRaw } });
  revalidatePath(path);
  flash(path, "Política salva.");
}

// ───────────── Configurações globais ─────────────
export async function saveSettings(fd: FormData) {
  const actor = await requireAdmin();
  const db = adminDb();
  const { data: before } = await db.from("settings").select("*").single();
  const after = {
    global_pause: fd.get("global_pause") === "on",
    dry_run: fd.get("dry_run") === "on",
    alert_email: str(fd, "alert_email") || null,
    updated_at: new Date().toISOString(),
  };
  await db.from("settings").update(after).eq("id", true);
  await db.from("audit_log").insert({ event: "settings_changed", actor, before_state: before, after_state: after });
  revalidatePath("/", "layout");
  flash("/configuracoes", "Configurações salvas.");
}

export async function togglePause(fd: FormData) {
  const actor = await requireAdmin();
  const db = adminDb();
  const pause = str(fd, "pause") === "1";
  await db.from("settings").update({ global_pause: pause, updated_at: new Date().toISOString() }).eq("id", true);
  await db.from("audit_log").insert({ event: pause ? "global_pause_on" : "global_pause_off", actor });
  revalidatePath("/", "layout");
  flash(back(fd, "/"), pause ? "Pausa geral ATIVADA." : "Pausa geral desativada.");
}

// ───────────── Ações (executor) ─────────────
export async function proposeManual(fd: FormData) {
  const actor = await requireAdmin();
  const clientId = str(fd, "client_id");
  const path = back(fd, `/clientes/${clientId}`);
  const type = str(fd, "action_type") as ActionType;
  const payload: Record<string, unknown> = {};
  const n = (k: string) => (str(fd, k) === "" ? undefined : Number(str(fd, k).replace(",", ".")));
  switch (type) {
    case "update_price": payload.price = n("price"); break;
    case "update_stock": payload.available_quantity = n("available_quantity"); break;
    case "update_listing":
      if (str(fd, "title")) payload.title = str(fd, "title");
      if (str(fd, "description")) payload.description = str(fd, "description");
      break;
    case "answer_question": payload.text = str(fd, "text"); break;
    case "update_ads_budget": payload.budget = n("budget"); break;
    case "update_ads_status": payload.status = str(fd, "status"); break;
    case "create_promotion":
      payload.deal_price = n("deal_price");
      payload.start_date = str(fd, "start_date") ? new Date(str(fd, "start_date")).toISOString() : undefined;
      payload.finish_date = str(fd, "finish_date") ? new Date(str(fd, "finish_date")).toISOString() : undefined;
      break;
  }
  let msg = "";
  try {
    const r = await proposeAction({
      clientId,
      accountId: str(fd, "account_id"),
      type,
      targetId: str(fd, "target_id"),
      payload,
      reason: str(fd, "reason") || undefined,
      source: "manual",
      actor,
      dryRun: fd.get("dry_run") === "on",
    });
    msg =
      r.status === "proposed" ? "Ação enviada para a fila de aprovação." :
      r.status === "blocked" ? "Ação bloqueada pela política deste tipo de ação." :
      `Ação ${r.status}.`;
  } catch (e) {
    flash(path, errMsg(e), "erro");
  }
  revalidatePath(path);
  revalidatePath("/aprovacoes");
  flash(path, msg);
}

export async function decide(fd: FormData) {
  const actor = await requireAdmin();
  const id = str(fd, "action_id");
  const decision = str(fd, "decision") === "approve" ? "approve" : "reject";
  const path = back(fd, "/aprovacoes");
  let msg = "";
  try {
    const r: any = await decideAction(id, decision, actor);
    msg =
      decision === "reject" ? "Ação rejeitada." :
      r?.note ? r.note :
      r?.status === "executed" ? "Aprovada e executada." :
      r?.status === "simulated" ? "Aprovada e simulada (modo simulação)." :
      r?.status === "failed" ? `Aprovada, mas falhou: ${r.error}` : `Status: ${r?.status}`;
  } catch (e) {
    flash(path, errMsg(e), "erro");
  }
  revalidatePath("/aprovacoes");
  revalidatePath("/", "layout");
  flash(path, msg);
}

export async function executeApproved(fd: FormData) {
  const actor = await requireAdmin();
  const path = back(fd, "/aprovacoes");
  let msg = "";
  try {
    const r: any = await executeAction(str(fd, "action_id"), actor);
    msg = r?.note ?? `Status: ${r?.status}`;
  } catch (e) {
    flash(path, errMsg(e), "erro");
  }
  revalidatePath(path);
  flash(path, msg);
}

// ───────────── Alertas ─────────────
export async function setAlertStatus(fd: FormData) {
  await requireAdmin();
  const status = str(fd, "status");
  const db = await userDb();
  await db
    .from("alerts")
    .update({ status, ...(status === "resolved" ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", str(fd, "alert_id"));
  revalidatePath("/alertas");
  revalidatePath("/", "layout");
  flash(back(fd, "/alertas"), status === "resolved" ? "Alerta resolvido." : "Alerta marcado como visto.");
}

export async function runAlertsNow(fd: FormData) {
  await requireAdmin();
  let msg = "";
  try {
    const r = await runAlerts();
    msg = `${r.created} alerta(s) novo(s), ${r.resolved} resolvido(s).`;
  } catch (e) {
    flash(back(fd, "/alertas"), errMsg(e), "erro");
  }
  revalidatePath("/alertas");
  flash(back(fd, "/alertas"), msg);
}
