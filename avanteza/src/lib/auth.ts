import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, canAccess, verifySessionFull, type Role } from "./session";

export async function currentSession(): Promise<{ email: string; role: Role } | null> {
  const jar = await cookies();
  const sess = await verifySessionFull(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  return canAccess(sess) ? sess : null;
}

/** Garante que há alguém logado (administrador ou revisor). Retorna o e-mail. */
export async function requireAdmin(): Promise<string> {
  const sess = await currentSession();
  if (!sess) redirect("/login");
  return sess.email;
}

/** Ações que alteram dados ou contas: bloqueadas para o perfil de revisão (somente leitura). */
export async function requireWriter(): Promise<string> {
  const sess = await currentSession();
  if (!sess) redirect("/login");
  if (sess.role !== "admin") redirect(`/?erro=${encodeURIComponent("Acesso de revisão: somente leitura. Esta ação é restrita aos administradores.")}`);
  return sess.email;
}
