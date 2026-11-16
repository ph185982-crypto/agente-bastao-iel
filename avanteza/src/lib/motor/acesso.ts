// Quem vê e quem mexe no Motor de Entregas (Operações → Hoje, Carteira, Calendário, Playbooks).
//  - Ver: toda a equipe (administrador, revisor e membro). Cliente do Mapa nunca (o middleware o prende em /mapa).
//  - Trabalhar nas ações (concluir, bloquear, reatribuir, adiar, evidência): administrador e membro. Revisor só lê.
//  - Editar playbooks, serviços do cliente e aplicar playbooks: só administrador.
import { canAccess, type Session } from "@/lib/session";

export function podeVerMotor(sess: Session | null): boolean {
  return canAccess(sess) && (sess!.role === "admin" || sess!.role === "reviewer" || sess!.role === "member");
}
export function podeTrabalharMotor(sess: Session | null): boolean {
  return canAccess(sess) && (sess!.role === "admin" || sess!.role === "member");
}
export function podeEditarPlaybooks(sess: Session | null): boolean {
  return canAccess(sess) && sess!.role === "admin";
}
