// Operações administrativas do Mapa (lado da equipe). Quem chama (server actions) confere requireOwner() antes.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { adminDb } from "../db";
import { generatePlan, isDateStr, type ClientKind } from "./plan";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // sem 0/O/1/l/I
export function generatePassword(len = 16): string {
  const bytes = randomBytes(len * 2);
  let out = "";
  for (const b of bytes) {
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
    if (out.length === len) break;
  }
  return out;
}

/** Gera o plano padrão. Sem `regenerate`, recusa se o cliente já tem fases. Regenerar apaga só o que veio do plano (origem "plano"). */
export async function generatePlanFor(clientId: string, opts: { regenerate?: boolean; startDate?: string } = {}) {
  const db = adminDb();
  const { data: c } = await db.from("clients").select("id, kind, start_date").eq("id", clientId).maybeSingle();
  if (!c) throw new Error("Cliente não encontrado.");
  const start = opts.startDate ?? c.start_date;
  if (!start || !isDateStr(start)) throw new Error("Defina a data de início do plano do cliente antes de gerar.");
  const { data: existing } = await db.from("plan_phases").select("id").eq("client_id", clientId).limit(1);
  if ((existing ?? []).length && !opts.regenerate) throw new Error("Este cliente já tem plano. Use “Regenerar” para recriar (ações de reunião e manuais são mantidas).");
  const phases = generatePlan(c.kind as ClientKind, start);
  if (opts.regenerate) {
    await db.from("plan_actions").delete().eq("client_id", clientId).eq("origin", "plano");
    await db.from("plan_phases").delete().eq("client_id", clientId);
  }
  if (opts.startDate) await db.from("clients").update({ start_date: start }).eq("id", clientId);
  let actions = 0;
  for (const p of phases) {
    const { data: ph, error } = await db
      .from("plan_phases")
      .insert({ client_id: clientId, position: p.position, name: p.name, description: p.description, start_month: p.startMonth, end_month: p.endMonth, starts_on: p.startsOn, ends_on: p.endsOn })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const rows = p.actions.map((a) => ({
      client_id: clientId, phase_id: ph.id, title: a.title, description: a.description, owner: a.owner, due_date: a.dueDate, origin: "plano", position: a.position,
    }));
    const r = await db.from("plan_actions").insert(rows);
    if (r.error) throw new Error(r.error.message);
    actions += rows.length;
  }
  return { phases: phases.length, actions };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Cria o acesso de um usuário de cliente. Devolve a senha gerada UMA vez; só o hash é gravado.
 *  Com `includeGroup`, vincula também as outras empresas do mesmo grupo (mesmo titular). Nunca converte usuário da equipe. */
export async function createClientUser(clientId: string, email: string, name: string | null, opts: { includeGroup?: boolean } = {}) {
  const db = adminDb();
  email = email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("E-mail inválido.");
  const { data: c } = await db.from("clients").select("id, group_slug").eq("id", clientId).maybeSingle();
  if (!c) throw new Error("Cliente não encontrado.");
  const { data: prev } = await db.from("admins").select("email, role").eq("email", email).maybeSingle();
  if (prev) throw new Error(prev.role === "client" ? "Já existe um acesso com este e-mail. Use “Redefinir senha”." : "Este e-mail pertence à equipe Avanteza.");
  const password = generatePassword();
  const { error } = await db.from("admins").insert({ email, name: name || null, role: "client", client_id: clientId, apps: [], active: true, password_hash: await bcrypt.hash(password, 12) });
  if (error) throw new Error(error.message);
  await linkCompanies(email, clientId, Boolean(opts.includeGroup && c.group_slug), c.group_slug);
  return { email, password };
}

async function linkCompanies(email: string, clientId: string, withGroup: boolean, group: string | null) {
  const db = adminDb();
  const ids = [clientId];
  if (withGroup && group) {
    const { data: g } = await db.from("clients").select("id").eq("group_slug", group);
    ids.push(...(g ?? []).map((x: any) => x.id as string));
  }
  const rows = [...new Set(ids)].map((id) => ({ user_email: email, client_id: id }));
  await db.from("client_user_clients").upsert(rows, { onConflict: "user_email,client_id", ignoreDuplicates: true });
}

/** Redefine a senha (só de usuário de cliente). Devolve a nova senha UMA vez. */
export async function resetClientUserPassword(email: string) {
  email = email.trim().toLowerCase();
  const db = adminDb();
  const { data: u } = await db.from("admins").select("email, role").eq("email", email).maybeSingle();
  if (!u || u.role !== "client") throw new Error("Usuário de cliente não encontrado.");
  const password = generatePassword();
  await db.from("admins").update({ password_hash: await bcrypt.hash(password, 12) }).eq("email", email).eq("role", "client");
  return { email, password };
}

export async function setClientUserActive(email: string, active: boolean) {
  await adminDb().from("admins").update({ active }).eq("email", email.trim().toLowerCase()).eq("role", "client");
}

/** Vincula/desvincula uma empresa de um usuário de cliente (a principal não sai). */
export async function setCompanyLink(email: string, clientId: string, on: boolean) {
  const db = adminDb();
  email = email.trim().toLowerCase();
  const { data: u } = await db.from("admins").select("role, client_id").eq("email", email).maybeSingle();
  if (!u || u.role !== "client") throw new Error("Usuário de cliente não encontrado.");
  if (on) await db.from("client_user_clients").upsert({ user_email: email, client_id: clientId }, { onConflict: "user_email,client_id", ignoreDuplicates: true });
  else if (u.client_id !== clientId) await db.from("client_user_clients").delete().eq("user_email", email).eq("client_id", clientId);
}

export async function listClientUsers(clientId: string) {
  const db = adminDb();
  const { data: links } = await db.from("client_user_clients").select("user_email").eq("client_id", clientId);
  const emails = (links ?? []).map((l: any) => l.user_email as string);
  if (!emails.length) return [];
  const { data: users } = await db.from("admins").select("email, name, active, client_id").in("email", emails).eq("role", "client").order("email");
  const { data: all } = await db.from("client_user_clients").select("user_email, client_id").in("user_email", emails);
  return (users ?? []).map((u: any) => ({ ...u, companyIds: (all ?? []).filter((l: any) => l.user_email === u.email).map((l: any) => l.client_id as string) }));
}
