import type { Metadata } from "next";
import { requireDashboards } from "@/lib/auth";
import { EquipeShell } from "@/components/shell/EquipeShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboards — Avanteza" };

export default async function DashboardsLayout({ children }: { children: React.ReactNode }) {
  const sess = await requireDashboards();
  return (
    <EquipeShell
      sess={sess}
      homeHref="/dashboards"
      banner={sess.role === "reviewer" ? <div className="banner" role="status">Acesso de revisão — somente leitura.</div> : undefined}
    >
      {children}
    </EquipeShell>
  );
}
