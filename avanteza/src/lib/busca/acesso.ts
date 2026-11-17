// Quem busca o quê na busca global. Só a equipe: cliente do Mapa nunca (nem pela rota, nem pela paleta).
//  - Clientes: quem abre a ficha do cliente (/clientes = aplicativo Marketplaces: admin, revisor ou membro com o app).
//  - Ações/entregas do Motor e Aprovações: quem vê o Motor (admin, revisor, membro).
//  - Comercial (oportunidades, contatos, contratos): quem usa o Vendedor IA (admin ou membro com "vendas"; revisor não).
//  - Ações rápidas que escrevem: nunca para o revisor (somente leitura).
import { canAccess, canUseApp, type Session } from "@/lib/session";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import type { GrupoId } from "./tipos";

export function podeBuscar(sess: Session | null): sess is Session {
  return canAccess(sess) && sess!.role !== "client";
}

/** Grupos que vêm do servidor (banco local e Comercial) que esta sessão pode ver. */
export function gruposPermitidos(sess: Session | null): Set<GrupoId> {
  const g = new Set<GrupoId>();
  if (!podeBuscar(sess)) return g;
  if (canUseApp(sess, "marketplaces")) g.add("clientes");
  if (podeVerMotor(sess)) { g.add("acoes"); g.add("aprovacoes"); }
  if (canUseApp(sess, "vendas")) { g.add("oportunidades"); g.add("contatos"); g.add("contratos"); }
  return g;
}

/** Abre a ficha do cliente (/clientes/{id})? Quem não abre vai para a fila do Motor. */
export const abreFichaCliente = (sess: Session | null) => canUseApp(sess, "marketplaces");
export const podeAcoesDeEscrita = (sess: Session | null) => podeBuscar(sess) && sess.role === "admin";
export const podeImportarConversa = (sess: Session | null) => podeTrabalharMotor(sess);
