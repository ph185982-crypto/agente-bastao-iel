import { redirect } from "next/navigation";
import { userDb } from "./supabase/server";
import { adminEmails } from "./env";

/** Garante que há um administrador logado. Retorna o e-mail. */
export async function requireAdmin(): Promise<string> {
  const db = await userDb();
  const { data } = await db.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email || !adminEmails().includes(email)) redirect("/login");
  return email;
}
