// Dashboards: visão executiva da Avanteza. Comercial e financeiro vêm do Vendedor IA; marketing, da Meta Marketing API.
// Cada fonte é independente: se uma estiver fora do ar, a página mostra o aviso daquele bloco e segue com o resto.
import Link from "next/link";
import { requireDashboards } from "@/lib/auth";
import { carregarDashboards } from "@/lib/dashboards";
import { ROTULO_PERIODO, PERIODOS, parsePeriodo, ddmm } from "@/lib/dashboards/periodo";
import { carregarCanaisClientes } from "@/lib/channels/dashboards";
import { PageHeader } from "@/components/shell/GlassCard";
import { SecaoComercial, SecaoFinanceiro, SecaoPrevistos, SecaoMarketing, SecaoCanaisClientes, StatusFontes } from "@/components/dashboards/Secoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Dashboards({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireDashboards();
  const sp = await searchParams;
  const id = parsePeriodo(sp.periodo);
  const d = await carregarDashboards(id);
  const { atual, anterior } = d.periodo;
  // Canais dos clientes: falha de banco nunca derruba a página (o bloco só some).
  const canais = d.fixture ? null : await carregarCanaisClientes(atual, d.meta).catch(() => null);
  return (
    <>
      <PageHeader eyebrow="Central Avanteza" title={<>Dash<span className="accent">boards</span></>}>
        <p className="muted small" style={{ marginTop: 6 }}>
          {ddmm(atual.de)} a {ddmm(atual.ate)} ({atual.dias} {atual.dias === 1 ? "dia" : "dias"}) · variações comparam com {ddmm(anterior.de)} a {ddmm(anterior.ate)}.
        </p>
      </PageHeader>
      <nav className="tabs periodo" aria-label="Período">
        {PERIODOS.map((p) => (
          <Link key={p} href={p === "30" ? "/dashboards" : `/dashboards?periodo=${p}`} aria-current={p === id ? "page" : undefined}>{ROTULO_PERIODO[p]}</Link>
        ))}
      </nav>
      {d.fixture && <div className="notice" role="note" style={{ margin: "10px 0" }}><b>Dados simulados</b> (DASHBOARDS_FIXTURE, só desenvolvimento). Nada aqui é real.</div>}
      <StatusFontes d={d} />
      <SecaoComercial d={d} />
      <SecaoFinanceiro d={d} />
      <SecaoPrevistos d={d} />
      <SecaoMarketing d={d} />
      <SecaoCanaisClientes c={canais} />
    </>
  );
}
