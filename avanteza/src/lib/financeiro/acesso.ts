// Quem vê e quem escreve no Financeiro da Central.
//  - Empresa (Avanteza): administrador e revisor (só leitura) sempre; membro só com o aplicativo "financeiro" liberado.
//  - Escrita: só administrador (o revisor nunca escreve; o membro também não — o Financeiro mexe em dinheiro).
//  - Pessoal: SÓ o dono = administrador cujo e-mail consta em ADMIN_EMAILS. Revisor e membro nunca veem, nem por link direto.
//  - Cliente do Mapa: nunca (o middleware já o prende em /mapa).
import { canAccess, canUseApp, isAllowedAdmin, type Session } from "@/lib/session";

export type EscopoFin = "empresa" | "pessoal";

export function podeVerFinanceiro(sess: Session | null): boolean {
  if (!canAccess(sess) || sess!.role === "client") return false;
  return sess!.role === "admin" || sess!.role === "reviewer" || canUseApp(sess, "financeiro");
}

export function podeEscreverFinanceiro(sess: Session | null): boolean {
  return canAccess(sess) && sess!.role === "admin";
}

export function podeVerPessoal(sess: Session | null): boolean {
  return Boolean(sess && sess.role === "admin" && canAccess(sess) && isAllowedAdmin(sess.email));
}

export function podeVerEscopo(sess: Session | null, escopo: EscopoFin): boolean {
  return escopo === "pessoal" ? podeVerPessoal(sess) : podeVerFinanceiro(sess);
}

/** Regras de uma escrita pedida pela tela. Devolve a mensagem de recusa, ou null se pode. */
export function recusaDeEscrita(sess: Session | null, escopo: EscopoFin, op: string, soPessoal = false): string | null {
  if (!podeEscreverFinanceiro(sess)) return "Acesso somente leitura: só administradores alteram o Financeiro.";
  if (!podeVerEscopo(sess, escopo) || (soPessoal && !podeVerPessoal(sess))) return "Você não tem acesso a esta área.";
  // Reclassificar entre áreas mexe no Pessoal: só o dono.
  if (op.endsWith(".reclassificar") && !podeVerPessoal(sess)) return "Só o dono reclassifica entre Empresa e Pessoal.";
  return null;
}
