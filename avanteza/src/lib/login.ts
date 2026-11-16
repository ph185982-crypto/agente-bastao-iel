// Login do administrador: senha com bcrypt + limite de tentativas por IP.
import bcrypt from "bcryptjs";
import { adminDb } from "./db";
import { isAllowedAdmin, type Role } from "./session";

const MAX_FAILS = 8;
const WINDOW_MIN = 15;

export async function checkLogin(email: string, password: string, ip: string): Promise<{ ok: boolean; error?: string; role?: Role; apps?: string[]; name?: string; clientId?: string; clientIds?: string[] }> {
  const db = adminDb();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count } = await db.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("success", false).gte("created_at", since);
  if ((count ?? 0) >= MAX_FAILS) return { ok: false, error: `Muitas tentativas. Aguarde ${WINDOW_MIN} minutos.` };

  const normalized = email.trim().toLowerCase();
  const { data: admin } = await db.from("admins").select("email, password_hash, role, apps, name, active, client_id").eq("email", normalized).maybeSingle();
  // Compara sempre (mesmo sem usuário) para não revelar quais e-mails existem pelo tempo de resposta.
  const hash = admin?.password_hash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEeO6Ke5r9H7YxKc4Z6QnB7yYbH3QG0F9y2";
  const valid = await bcrypt.compare(password, hash);
  const role: Role = admin?.role === "reviewer" ? "reviewer" : admin?.role === "member" ? "member" : admin?.role === "client" ? "client" : "admin";
  let clientIds: string[] = [];
  let ok = Boolean(admin && valid && admin.active !== false && (role !== "admin" || isAllowedAdmin(normalized)));
  if (ok && role === "client") {
    // Cliente só entra se estiver ligado a um cliente ATIVO.
    clientIds = await activeCompanyIds(normalized, admin.client_id);
    ok = clientIds.length > 0;
  }
  await db.from("login_attempts").insert({ ip, email: normalized, success: ok });
  return ok ? { ok, role, apps: admin.apps ?? [], name: admin.name ?? "", ...(role === "client" ? { clientId: clientIds[0], clientIds } : {}) } : { ok: false, error: "E-mail ou senha inválidos." };
}

/** Empresas ATIVAS que o usuário do cliente pode ver: a principal + vínculos do grupo. A principal vem primeiro. */
export async function activeCompanyIds(email: string, primary: string | null): Promise<string[]> {
  const db = adminDb();
  const { data: links } = await db.from("client_user_clients").select("client_id").eq("user_email", email);
  const ids = [...new Set([...(primary ? [primary] : []), ...(links ?? []).map((l: any) => l.client_id as string)])];
  if (!ids.length) return [];
  const { data: cs } = await db.from("clients").select("id, active").in("id", ids);
  const active = new Set((cs ?? []).filter((c: any) => c.active !== false).map((c: any) => c.id));
  return ids.filter((i) => active.has(i));
}

export async function setPassword(email: string, password: string) {
  if (password.length < 10) throw new Error("A senha precisa ter pelo menos 10 caracteres.");
  const hash = await bcrypt.hash(password, 12);
  const { error } = await adminDb().from("admins").update({ password_hash: hash }).eq("email", email.toLowerCase());
  if (error) throw new Error(error.message);
}
