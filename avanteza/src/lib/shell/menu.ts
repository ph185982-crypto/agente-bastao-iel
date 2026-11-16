// Menu lateral da equipe, por departamentos. Usado por todas as telas internas (Dashboards, Marketplaces,
// departamentos, Financeiro, Central, Usuários). O cliente do Mapa tem o menu próprio e nunca passa por aqui.
import type { NavGroup } from "@/components/shell/AppShell";
import type { Session } from "@/lib/session";
import { ITEM_DASHBOARDS, podeVerDashboards } from "@/lib/dashboards/nav";
import { departamentosVisiveis } from "./departamentos";

/** Itens do menu a partir dos módulos: no Financeiro, o menu mostra só a entrada e o Pessoal (o resto são abas da própria tela). */
export function menuEquipe(sess: Session, extra: NavGroup[] = []): NavGroup[] {
  const groups: NavGroup[] = [
    { items: [...(podeVerDashboards(sess) ? [{ ...ITEM_DASHBOARDS, label: "Visão geral" }] : []), { href: "/central", label: "Todas as ferramentas", icon: "grid", exact: true }] },
  ];
  for (const d of departamentosVisiveis(sess)) {
    const itens = d.id === "financeiro" ? d.modulos.filter((m) => m.id === "fin-visao" || m.id === "fin-pessoal") : d.modulos;
    groups.push({
      label: d.nome,
      href: d.href,
      items: itens.map((m) => ({
        href: m.href,
        label: m.id === "fin-visao" ? "Financeiro da empresa" : m.nome,
        icon: m.icon,
        ext: m.externo,
        // /financeiro e /financeiro/pessoal: o da empresa só fica ativo fora do Pessoal
        exact: m.id === "fin-visao" ? false : undefined,
        ...(m.id === "marketplaces" || m.id === "hoje" ? { exact: true } : {}),
      })),
    });
  }
  const sistema: NavGroup = { label: "Sistema", items: [{ href: "/configuracoes", label: "Ajustes", icon: "settings" }, ...(sess.role === "admin" ? [{ href: "/usuarios", label: "Usuários e acessos", icon: "users" }] : [])] };
  // "Ajustes" é do painel de Marketplaces (admin/revisor/membro com o app); some para quem não usa.
  const podeAjustes = sess.role === "admin" || sess.role === "reviewer" || sess.apps.includes("marketplaces");
  groups.push(...extra, { ...sistema, items: sistema.items.filter((i) => i.href !== "/configuracoes" || podeAjustes) });
  return groups.filter((g) => g.items.length > 0);
}
