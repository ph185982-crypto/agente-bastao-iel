import Link from "next/link";
import type { Metadata } from "next";
import { requireMapa } from "@/lib/mapa/auth";
import { getClient, listCompanies } from "@/lib/mapa/repo";
import { Logo } from "@/components/Logo";
import { MapaNav } from "@/components/mapa/MapaNav";
import { CompanySwitch } from "@/components/mapa/CompanySwitch";
import { navFor } from "@/lib/mapa/nav";
import { exitPreview } from "./actions";
import { logout } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mapa — Avanteza" };

export default async function MapaLayout({ children }: { children: React.ReactNode }) {
  const { scope } = await requireMapa();
  const [client, companies] = await Promise.all([getClient(scope), listCompanies(scope)]);
  const items = navFor(client?.kind ?? "marketplace");
  return (
    <>
      {scope.previewBy && (
        <div className="mapa-banner" role="status">
          <span>Visualizando como {client?.name} — somente leitura</span>
          <form action={exitPreview}><button className="btn">Sair da visualização</button></form>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
            <Link href="/mapa" style={{ textDecoration: "none" }}><Logo /></Link>
            <span className="pill pill-orange">Mapa</span>
          </div>
          <MapaNav items={items} />
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            {companies.length > 1 && !scope.previewBy && <CompanySwitch companies={companies} current={scope.clientId} />}
            {!scope.previewBy && <form action={logout}><button className="btn btn-sm btn-ghost" style={{ color: "var(--sand)", borderColor: "var(--navy-2)" }}>Sair</button></form>}
          </div>
        </div>
      </header>
      <main className="main">{children}</main>
      <MapaNav items={items} bottom />
    </>
  );
}
