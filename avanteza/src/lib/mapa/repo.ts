// Repositório do Mapa (lado do cliente). REGRA DE OURO: toda consulta filtra por scope.clientId,
// que só existe se vier da sessão (ver scope.ts). Nenhuma função recebe client_id de fora.
// Colunas são listadas uma a uma: tokens de contas, notas internas, instruções da IA e transcrições nunca saem daqui.
import bcrypt from "bcryptjs";
import { adminDb } from "../db";
import { rawQuery } from "../db/client";
import { assertScope, assertWritable, type ClientScope } from "./scope";
import type { ActionStatus } from "./progress";

const NONE = "00000000-0000-0000-0000-000000000000";
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function getClient(scope: ClientScope) {
  assertScope(scope);
  const { data } = await adminDb()
    .from("clients")
    .select("id, name, slug, kind, start_date, contact_name, contact_email, contact_phone, active")
    .eq("id", scope.clientId)
    .maybeSingle();
  return data as null | {
    id: string; name: string; slug: string | null; kind: "marketplace" | "midia" | "ambos"; start_date: string | null;
    contact_name: string | null; contact_email: string | null; contact_phone: string | null; active: boolean;
  };
}

const PHASE_COLS = "id, position, name, description, start_month, end_month, starts_on, ends_on";
// blocked_reason é o que a equipe espera do cliente (texto escrito para ele); notas internas nunca entram aqui.
const ACTION_COLS = "id, phase_id, title, description, status, owner, due_date, origin, meeting_id, position, completed_at, client_dependent, blocked_reason, evidence_url";

export async function listPhases(scope: ClientScope) {
  assertScope(scope);
  const { data } = await adminDb().from("plan_phases").select(PHASE_COLS).eq("client_id", scope.clientId).order("position");
  return (data ?? []) as any[];
}

export async function listActions(scope: ClientScope, f: { status?: string; owner?: string; phaseId?: string } = {}) {
  assertScope(scope);
  // Só o que é visível ao cliente e não foi dispensado (rotinas internas do Motor ficam de fora).
  let q = adminDb().from("plan_actions").select(ACTION_COLS).eq("client_id", scope.clientId).eq("visible_to_client", true).is("archived_at", null);
  if (f.status) q = q.eq("status", f.status);
  if (f.owner) q = q.eq("owner", f.owner);
  if (f.phaseId) q = q.eq("phase_id", isUuid(f.phaseId) ? f.phaseId : NONE);
  const { data } = await q.order("due_date", { ascending: true, nullsFirst: false }).order("position");
  return (data ?? []) as any[];
}

export async function getAction(scope: ClientScope, id: string) {
  assertScope(scope);
  if (!isUuid(id)) return null;
  const { data } = await adminDb().from("plan_actions").select(ACTION_COLS).eq("id", id).eq("client_id", scope.clientId).eq("visible_to_client", true).is("archived_at", null).maybeSingle();
  return data as any | null;
}

/** O cliente só atualiza o andamento das ações que são dele (owner = cliente) e do próprio cliente. */
export async function updateOwnActionStatus(scope: ClientScope, id: string, status: ActionStatus): Promise<boolean> {
  assertWritable(scope);
  if (!isUuid(id) || !["planejada", "em_execucao", "concluida"].includes(status)) return false;
  const { data } = await adminDb()
    .from("plan_actions")
    .update({ status, completed_at: status === "concluida" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", scope.clientId)
    .eq("owner", "cliente")
    .eq("visible_to_client", true)
    .is("archived_at", null)
    .select("id");
  return (data ?? []).length === 1;
}

/**
 * "Feito" do cliente numa pendência dele (só da empresa ativa do escopo, só ações visíveis e não dispensadas):
 *  - ação do cliente (owner = cliente): vira concluída, com o link de evidência se houver;
 *  - ação da Avanteza parada esperando o cliente (bloqueada): volta para a fila da equipe (planejada), com o link.
 * Nunca mexe em ação de outro cliente nem em ação da Avanteza que não está esperando o cliente.
 */
export async function resolverPendencia(scope: ClientScope, id: string, link: string | null): Promise<boolean> {
  assertWritable(scope);
  if (!isUuid(id)) return false;
  if (link && !(/^https?:\/\/\S+$/i.test(link) && link.length <= 2000)) return false;
  const r = await rawQuery(
    `update avanteza.plan_actions set
       status = case when owner = 'cliente' then 'concluida' else 'planejada' end,
       completed_at = case when owner = 'cliente' then now() else completed_at end,
       blocked_reason = case when owner = 'cliente' then blocked_reason else null end,
       blocked_at = case when owner = 'cliente' then blocked_at else null end,
       evidence_url = coalesce($3, evidence_url), updated_at = now()
     where id = $1 and client_id = $2 and visible_to_client and archived_at is null and status <> 'concluida'
       and (owner = 'cliente' or status = 'bloqueada')
     returning id`,
    [id, scope.clientId, link || null],
  );
  if (r.length === 1) {
    await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('mapa_pendencia_resolvida', $1, $2, $3)", [scope.userEmail, scope.clientId, JSON.stringify({ id, link: Boolean(link) })]);
  }
  return r.length === 1;
}

export async function listMeetings(scope: ClientScope) {
  assertScope(scope);
  const { data } = await adminDb()
    .from("meetings")
    .select("id, title, held_at, recording_url, transcript_url, summary, decisions, status")
    .eq("client_id", scope.clientId)
    .order("held_at", { ascending: false });
  return (data ?? []) as any[];
}

export async function getMeeting(scope: ClientScope, id: string) {
  assertScope(scope);
  if (!isUuid(id)) return null;
  const { data: meeting } = await adminDb()
    .from("meetings")
    .select("id, title, held_at, recording_url, transcript_url, summary, decisions, status")
    .eq("id", id)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (!meeting) return null;
  const { data: actions } = await adminDb().from("plan_actions").select(ACTION_COLS).eq("meeting_id", id).eq("client_id", scope.clientId).eq("visible_to_client", true).is("archived_at", null).order("position");
  return { meeting: meeting as any, actions: (actions ?? []) as any[] };
}

export async function listFiles(scope: ClientScope) {
  assertScope(scope);
  const { data } = await adminDb()
    .from("client_files")
    .select("id, title, url, kind, file_date, created_at")
    .eq("client_id", scope.clientId)
    .eq("visible", true)
    .order("file_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as any[];
}

/** Dados de marketplaces do cliente: contas (sem tokens), snapshots, anúncios, campanhas e alertas abertos. */
export async function marketplaceData(scope: ClientScope, sinceDate: string) {
  assertScope(scope);
  const db = adminDb();
  const { data: accounts } = await db
    .from("marketplace_accounts")
    .select("id, marketplace, nickname, status, last_collected_at")
    .eq("client_id", scope.clientId)
    .order("created_at");
  const ids = (accounts ?? []).map((a: any) => a.id);
  const accIds = ids.length ? ids : [NONE];
  const [snaps, listings, campaigns, alerts] = await Promise.all([
    db.from("daily_snapshots")
      .select("account_id, snapshot_date, revenue, orders_count, units_sold, visits, ads_cost, ads_revenue, reputation_level, active_listings, paused_listings, out_of_stock_listings, unanswered_questions")
      .in("account_id", accIds)
      .gte("snapshot_date", sinceDate)
      .order("snapshot_date"),
    db.from("listings")
      .select("account_id, external_id, title, status, price, available_quantity, sold_quantity, visits_30d, permalink, thumbnail")
      .in("account_id", accIds)
      .order("sold_quantity", { ascending: false })
      .limit(200),
    db.from("ads_campaigns").select("account_id, external_id, name, status, budget, roas_target, metrics_7d").in("account_id", accIds).order("name"),
    db.from("alerts").select("id, severity, title, message, created_at").eq("client_id", scope.clientId).eq("status", "open").order("created_at", { ascending: false }).limit(30),
  ]);
  return {
    accounts: (accounts ?? []) as any[],
    snapshots: (snaps.data ?? []) as any[],
    listings: (listings.data ?? []) as any[],
    campaigns: (campaigns.data ?? []) as any[],
    alerts: (alerts.data ?? []) as any[],
  };
}

/** Troca de senha do PRÓPRIO usuário do cliente (a linha de admins precisa pertencer ao cliente do escopo). */
export async function changeOwnPassword(scope: ClientScope, current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  assertWritable(scope);
  if (next.length < 10) return { ok: false, error: "A nova senha precisa ter pelo menos 10 caracteres." };
  const db = adminDb();
  const { data: u } = await db.from("admins").select("email, password_hash, active").eq("email", scope.userEmail).eq("role", "client").maybeSingle();
  if (!u || u.active === false || !u.password_hash || !(await bcrypt.compare(current, u.password_hash))) return { ok: false, error: "Senha atual incorreta." };
  const hash = await bcrypt.hash(next, 12);
  await db.from("admins").update({ password_hash: hash }).eq("email", scope.userEmail).eq("role", "client");
  return { ok: true };
}

/** Empresas do grupo (id, nome) para o seletor e a visão consolidada. Só as da lista do escopo. */
export async function listCompanies(scope: ClientScope) {
  assertScope(scope);
  const { data } = await adminDb().from("clients").select("id, name, kind").in("id", [...scope.allowedClientIds]).eq("active", true).order("name");
  return (data ?? []) as { id: string; name: string; kind: string }[];
}

/** Visão consolidada (opcional): faturamento e pedidos por empresa do grupo, filtrando SEMPRE pela lista do escopo. */
export async function groupOverview(scope: ClientScope, sinceDate: string) {
  assertScope(scope);
  const db = adminDb();
  const companies = await listCompanies(scope);
  const ids = companies.map((c) => c.id);
  const { data: accounts } = await db.from("marketplace_accounts").select("id, client_id").in("client_id", ids.length ? ids : [NONE]);
  const accIds = (accounts ?? []).map((a: any) => a.id);
  const { data: snaps } = await db
    .from("daily_snapshots")
    .select("account_id, snapshot_date, revenue, orders_count, units_sold, visits, ads_cost, ads_revenue")
    .in("account_id", accIds.length ? accIds : [NONE])
    .gte("snapshot_date", sinceDate);
  const owner = new Map((accounts ?? []).map((a: any) => [a.id, a.client_id as string]));
  return companies.map((c) => ({
    company: c,
    snapshots: (snaps ?? []).filter((s: any) => owner.get(s.account_id) === c.id) as any[],
  }));
}

/** Empresas que o usuário do cliente ainda pode ver AGORA (usuário ativo + empresas ativas). Conferido a cada acesso. */
export async function liveAllowedCompanies(email: string): Promise<string[]> {
  const db = adminDb();
  const { data: u } = await db.from("admins").select("active, client_id").eq("email", email).eq("role", "client").maybeSingle();
  if (!u || u.active === false) return [];
  const { activeCompanyIds } = await import("../login");
  return activeCompanyIds(email, u.client_id);
}
