// Porta de entrada do Mapa no servidor: lê cookies, valida e devolve o escopo (ou redireciona).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, VIEW_COOKIE, canAccess, verifySessionFull, verifyViewToken, type Session } from "../session";
import { scopeFromSession, type ClientScope } from "./scope";
import { liveAllowedCompanies } from "./repo";

export const COMPANY_COOKIE = "avz_company";

export interface MapaContext {
  scope: ClientScope;
  session: Session;
}

export async function requireMapa(): Promise<MapaContext> {
  const jar = await cookies();
  const sess = await verifySessionFull(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!sess || !canAccess(sess)) redirect("/login");
  let scope: ClientScope | null;
  if (sess.role === "client") {
    const live = await liveAllowedCompanies(sess.email);
    scope = scopeFromSession(sess, null, jar.get(COMPANY_COOKIE)?.value ?? null, live);
    if (!scope) redirect(`/login?erro=${encodeURIComponent("Acesso desativado. Fale com a Avanteza.")}`);
  } else {
    const viewClient = await verifyViewToken(jar.get(VIEW_COOKIE)?.value, sess.email).catch(() => null);
    scope = scopeFromSession(sess, viewClient);
    if (!scope) redirect("/clientes");
  }
  return { scope, session: sess };
}
