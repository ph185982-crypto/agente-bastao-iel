import type { Metadata } from "next";
import { requireMapa } from "@/lib/mapa/auth";
import { getClient, listCompanies } from "@/lib/mapa/repo";
import { contarParaAprovar } from "@/lib/mapa/aprovacoes";
import { AppShell, type NavGroup } from "@/components/shell/AppShell";
import { CompanySwitch } from "@/components/mapa/CompanySwitch";
import { navFor } from "@/lib/mapa/nav";
import { exitPreview } from "./actions";
import { SairButton } from "@/components/shell/SairButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mapa — Avanteza" };

const ICON: Record<string, string> = {
  "/mapa": "home", "/mapa/plano": "flag", "/mapa/marketplaces": "store", "/mapa/canais": "signal",
  "/mapa/reunioes": "calendar", "/mapa/arquivos": "folder", "/mapa/conta": "user", "/mapa/aprovacoes": "check", "/mapa/relatorios": "doc",
};

export default async function MapaLayout({ children }: { children: React.ReactNode }) {
  const { scope } = await requireMapa();
  const [client, companies, paraAprovar] = await Promise.all([getClient(scope), listCompanies(scope), contarParaAprovar(scope)]);
  const items = navFor(client?.kind ?? "marketplace").map((i) => ({ ...i, icon: ICON[i.href] ?? "grid", exact: i.href === "/mapa", ...(i.href === "/mapa/aprovacoes" && paraAprovar ? { badge: paraAprovar } : {}) }));
  const groups: NavGroup[] = [{ label: client?.name ? `Mapa · ${client.name}` : "Mapa", items }];
  return (
    <AppShell
      groups={groups}
      tag="Mapa"
      homeHref="/mapa"
      top={companies.length > 1 && !scope.previewBy ? <CompanySwitch companies={companies} current={scope.clientId} /> : undefined}
      banner={
        scope.previewBy ? (
          <div className="banner orange banner-row" role="status">
            <span>Visualizando como {client?.name} — somente leitura</span>
            <form action={exitPreview}><button className="btn">Sair da visualização</button></form>
          </div>
        ) : undefined
      }
      bottom={!scope.previewBy ? <SairButton /> : undefined}
    >
      {children}
    </AppShell>
  );
}
