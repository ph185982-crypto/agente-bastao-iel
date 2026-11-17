import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, canAccess, canUseApp, verifySessionFull, type Session } from "./session";
import { podeVerDashboards } from "./dashboards/nav";

export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const sess = await verifySessionFull(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  return canAccess(sess) ? sess : null;
}

/** Qualquer usuário logado (para a Central e o login único). */
export async function requireUser(): Promise<Session> {
  const sess = await currentSession();
  if (!sess) redirect("/login");
  return sess;
}

/** Painel de marketplaces: administrador, revisor ou membro com o módulo liberado. Retorna o e-mail. */
export async function requireAdmin(): Promise<string> {
  const sess = await requireUser();
  if (!canUseApp(sess, "marketplaces")) redirect("/central");
  return sess.email;
}

/** Ações que alteram dados ou contas: bloqueadas para o perfil de revisão (somente leitura). */
export async function requireWriter(): Promise<string> {
  const sess = await requireUser();
  if (!canUseApp(sess, "marketplaces")) redirect("/central");
  if (sess.role === "reviewer") redirect(`/?erro=${encodeURIComponent("Acesso de revisão: somente leitura. Esta ação é restrita aos administradores.")}`);
  return sess.email;
}

/** Só administradores (donos): usuários, permissões e ajustes globais. */
export async function requireOwner(): Promise<string> {
  const sess = await requireUser();
  if (sess.role !== "admin") redirect(`/central?erro=${encodeURIComponent("Restrito aos administradores.")}`);
  return sess.email;
}

/** Painel Dashboards: administrador e revisor (somente leitura). Os demais voltam para a Central. */
export async function requireDashboards(): Promise<Session> {
  const sess = await requireUser();
  if (!podeVerDashboards(sess)) redirect("/central");
  return sess;
}
