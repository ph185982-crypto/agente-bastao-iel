// Mapa → Relatórios: relatório semanal publicado (o mais recente aberto) e o histórico das semanas anteriores.
import Link from "next/link";
import { requireMapa } from "@/lib/mapa/auth";
import { listarRelatorios } from "@/lib/mapa/relatorios";
import { fmtPeriodo } from "@/lib/relatorios/semana";
import "@/components/aprovacoes/aprovacoes.css";

export const dynamic = "force-dynamic";

export default async function Relatorios() {
  const { scope } = await requireMapa();
  const lista = await listarRelatorios(scope);
  const [ultimo, ...anteriores] = lista;
  return (
    <>
      <div className="eyebrow">Relatórios</div>
      <h1>Relatório <span className="accent">semanal</span></h1>
      <p className="muted" style={{ marginTop: 4 }}>Toda segunda-feira: números da semana, o que entregamos, o que vem e o que depende de você.</p>
      {!ultimo ? (
        <div className="empty" style={{ marginTop: 16 }}>O primeiro relatório chega na próxima segunda-feira.</div>
      ) : (
        <>
          <h2>Mais recente</h2>
          <Link href={`/mapa/relatorios/${ultimo.id}`} className="ap-item pendente">
            <div className="ap-main">
              <div className="tit">Semana de {fmtPeriodo(ultimo.semana, ultimo.periodo_fim)}</div>
              <div className="small" style={{ marginTop: 6 }}>{ultimo.abertura.slice(0, 220)}{ultimo.abertura.length > 220 ? "…" : ""}</div>
            </div>
            <div className="lado"><span className="pill pill-orange">Novo</span><span className="small muted">Abrir ›</span></div>
          </Link>
          {anteriores.length > 0 && (
            <>
              <h2>Semanas anteriores</h2>
              <div className="ap-lista">
                {anteriores.map((r) => (
                  <div key={r.id} className="ap-item">
                    <div className="ap-main"><Link href={`/mapa/relatorios/${r.id}`} className="tit" style={{ textDecoration: "none" }}>Semana de {fmtPeriodo(r.semana, r.periodo_fim)}</Link></div>
                    <div className="lado"><a className="small" href={`/mapa/relatorios/${r.id}/pdf`} target="_blank" rel="noopener">PDF ↗</a></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
