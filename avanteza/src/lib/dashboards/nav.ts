// Item "Dashboards": primeiro do menu para quem pode ver (administrador e revisor; revisor só lê). Clientes do Mapa nunca.
import type { Session } from "@/lib/session";
import { canAccess } from "@/lib/session";

export const ITEM_DASHBOARDS = { href: "/dashboards", label: "Dashboards", icon: "dashboard" } as const;
export const DESTINO_PADRAO_EQUIPE = "/dashboards";

export function podeVerDashboards(sess: Session | null): boolean {
  return canAccess(sess) && (sess!.role === "admin" || sess!.role === "reviewer");
}

/** Para onde o login leva quando não há `next`: administrador e revisor caem nos Dashboards; os demais na Central. */
export function destinoPadrao(role: string | undefined): string {
  return role === "admin" || role === "reviewer" ? DESTINO_PADRAO_EQUIPE : "/central";
}
