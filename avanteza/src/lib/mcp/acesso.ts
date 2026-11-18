// Quem pode usar o conector do Claude: SÓ administrador (dono) — papel "admin", ativo no cadastro e em ADMIN_EMAILS.
// Membro, revisor e cliente do Mapa são recusados no consentimento, na troca do código, no refresh e em toda chamada MCP
// (a conferência no banco roda a cada requisição: desativar o usuário corta o acesso do Claude na hora).
import { adminDb } from "@/lib/db";
import { SESSION_COOKIE, canAccess, isAllowedAdmin, verifySessionFull, type Session } from "@/lib/session";
import { formularioConfere, lerParams, queryDosParams, tokenDoFormulario, validarPedido, type ParamsAutorizacao } from "./oauth";

/** Usuário ainda válido para o MCP (consulta o cadastro; nunca lê password_hash). Devolve a sessão equivalente, ou null. */
export async function usuarioDoMcp(email: string | null | undefined): Promise<Session | null> {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  const { data } = await adminDb().from("admins").select("email, name, role, active").eq("email", e).maybeSingle();
  if (!data || data.active === false || data.role !== "admin" || !isAllowedAdmin(e)) return null;
  return { email: e, role: "admin", apps: [], name: data.name ?? "" };
}

/** Lê o cookie de sessão direto do header (as rotas são testáveis com Request puro). */
export function cookieDaSessao(req: Request): string | undefined {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m?.[1];
}

export async function sessaoDoPedido(req: Request): Promise<Session | null> {
  return verifySessionFull(cookieDaSessao(req)).catch(() => null);
}

export const ehDono = (s: Session | null): boolean => Boolean(s && s.role === "admin" && canAccess(s));

export type Avaliacao =
  | { tipo: "invalido"; erro: string }
  | { tipo: "login"; destino: string }
  | { tipo: "recusado"; motivo: string; email: string }
  | { tipo: "consentir"; email: string; nomeCliente: string; form: string; params: ParamsAutorizacao };

/** Decide o que a tela de consentimento mostra para este pedido e esta sessão. */
export async function avaliarPedido(get: (k: string) => unknown, sess: Session | null): Promise<Avaliacao> {
  const params = lerParams(get);
  const v = validarPedido(params);
  if ("erro" in v) return { tipo: "invalido", erro: v.erro };
  if (!sess || !canAccess(sess)) return { tipo: "login", destino: `/login?next=${encodeURIComponent(`/api/oauth/authorize?${queryDosParams(params)}`)}` };
  if (!ehDono(sess)) {
    return { tipo: "recusado", email: sess.email, motivo: "Só administradores da Avanteza podem conectar o Claude. Peça a um administrador para fazer a conexão." };
  }
  if (!(await usuarioDoMcp(sess.email))) return { tipo: "recusado", email: sess.email, motivo: "Seu usuário não está ativo como administrador." };
  return { tipo: "consentir", email: sess.email, nomeCliente: v.nomeCliente, form: tokenDoFormulario(sess.email, params), params };
}

export { formularioConfere };
