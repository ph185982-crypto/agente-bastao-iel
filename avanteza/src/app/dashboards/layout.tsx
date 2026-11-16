import type { Metadata } from "next";
import { requireDashboards } from "@/lib/auth";
import { AppShell, type NavGroup } from "@/components/shell/AppShell";
import { SairButton } from "@/components/shell/SairButton";
import { ITEM_DASHBOARDS } from "@/lib/dashboards/nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboards — Avanteza" };

export default async function DashboardsLayout({ children }: { children: React.ReactNode }) {
  const sess = await requireDashboards();
  const groups: NavGroup[] = [
    { items: [ITEM_DASHBOARDS, { href: "/central", label: "Todas as ferramentas", icon: "grid", exact: true }] },
    {
      label: "Operação",
      items: [
        { href: "/", label: "Marketplaces", icon: "store", exact: true },
        ...(sess.role === "admin" ? [{ href: "/usuarios", label: "Usuários e acessos", icon: "users" }] : []),
      ],
    },
  ];
  return (
    <AppShell
      groups={groups}
      homeHref="/dashboards"
      banner={sess.role === "reviewer" ? <div className="banner" role="status">Acesso de revisão — somente leitura.</div> : undefined}
      bottom={
        <>
          <div className="sb-who" title={sess.email}>{sess.name || sess.email}</div>
          <SairButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
