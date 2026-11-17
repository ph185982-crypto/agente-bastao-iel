import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMapa } from "@/lib/mapa/auth";
import { obterRelatorio } from "@/lib/mapa/relatorios";
import { fmtPeriodo } from "@/lib/relatorios/semana";
import { RelatorioView } from "@/components/relatorios/RelatorioView";

export const dynamic = "force-dynamic";

export default async function Relatorio({ params }: { params: Promise<{ id: string }> }) {
  const { scope } = await requireMapa();
  const { id } = await params;
  const r = await obterRelatorio(scope, id);
  if (!r) notFound();
  return (
    <>
      <div className="eyebrow"><Link href="/mapa/relatorios" style={{ textDecoration: "none" }}>Relatórios</Link> / semanal</div>
      <div className="page-head">
        <h1>Semana de {fmtPeriodo(r.semana, r.periodo_fim)}</h1>
        <a className="btn btn-sm btn-orange" href={`/mapa/relatorios/${r.id}/pdf`} target="_blank" rel="noopener">Baixar PDF</a>
      </div>
      <RelatorioView dados={r.dados} abertura={r.abertura} destaques={r.destaques ?? []} />
    </>
  );
}
