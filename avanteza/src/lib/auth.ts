import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isAllowedAdmin, verifySession } from "./session";

/** Garante que há um administrador logado. Retorna o e-mail. */
export async function requireAdmin(): Promise<string> {
  const jar = await cookies();
  const email = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!email || !isAllowedAdmin(email)) redirect("/login");
  return email;
}
