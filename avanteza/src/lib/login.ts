// Login do administrador: senha com bcrypt + limite de tentativas por IP.
import bcrypt from "bcryptjs";
import { adminDb } from "./db";
import { isAllowedAdmin } from "./session";

const MAX_FAILS = 8;
const WINDOW_MIN = 15;

export async function checkLogin(email: string, password: string, ip: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminDb();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count } = await db.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("success", false).gte("created_at", since);
  if ((count ?? 0) >= MAX_FAILS) return { ok: false, error: `Muitas tentativas. Aguarde ${WINDOW_MIN} minutos.` };

  const normalized = email.trim().toLowerCase();
  const { data: admin } = await db.from("admins").select("email, password_hash").eq("email", normalized).maybeSingle();
  // Compara sempre (mesmo sem usuário) para não revelar quais e-mails existem pelo tempo de resposta.
  const hash = admin?.password_hash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEeO6Ke5r9H7YxKc4Z6QnB7yYbH3QG0F9y2";
  const valid = await bcrypt.compare(password, hash);
  const ok = Boolean(admin && valid && isAllowedAdmin(normalized));
  await db.from("login_attempts").insert({ ip, email: normalized, success: ok });
  return ok ? { ok } : { ok: false, error: "E-mail ou senha inválidos." };
}

export async function setPassword(email: string, password: string) {
  if (password.length < 10) throw new Error("A senha precisa ter pelo menos 10 caracteres.");
  const hash = await bcrypt.hash(password, 12);
  const { error } = await adminDb().from("admins").update({ password_hash: hash }).eq("email", email.toLowerCase());
  if (error) throw new Error(error.message);
}
