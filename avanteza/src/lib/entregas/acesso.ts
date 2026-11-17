// Quem vê e quem escreve no Funil de Entrega (Operações → Entregas).
//  - Ver: administrador e revisor sempre; membro só com o aplicativo "entregas" liberado em Usuários e acessos.
//  - Escrever: só administrador (revisor lê; membro lê). Cliente do Mapa nunca (o middleware o prende em /mapa).
import { canAccess, canUseApp, type Session } from "@/lib/session";

export function podeVerEntregas(sess: Session | null): boolean {
  if (!canAccess(sess) || sess!.role === "client") return false;
  return sess!.role === "admin" || sess!.role === "reviewer" || canUseApp(sess, "entregas");
}

export function podeEscreverEntregas(sess: Session | null): boolean {
  return canAccess(sess) && sess!.role === "admin";
}

/** Mensagem de recusa de uma escrita pedida pela tela, ou null se pode. */
export function recusaDeEscrita(sess: Session | null): string | null {
  if (!podeVerEntregas(sess)) return "Você não tem acesso ao Funil de Entrega.";
  if (!podeEscreverEntregas(sess)) return "Acesso somente leitura: só administradores alteram o Funil de Entrega.";
  return null;
}
