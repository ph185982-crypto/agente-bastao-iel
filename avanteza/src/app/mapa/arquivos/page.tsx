import { requireMapa } from "@/lib/mapa/auth";
import { listFiles } from "@/lib/mapa/repo";
import { fmtDate } from "@/lib/mapa/progress";

const KIND: Record<string, string> = { contrato: "Contrato", relatorio: "Relatório", plano: "Plano", apresentacao: "Apresentação", planilha: "Planilha", outro: "Arquivo" };

export default async function Arquivos() {
  const { scope } = await requireMapa();
  const files = await listFiles(scope);
  return (
    <>
      <div className="eyebrow">Entregas</div>
      <h1>Arquivos</h1>
      <p className="muted small" style={{ marginTop: 4 }}>Contratos, relatórios e materiais entregues pela Avanteza.</p>
      <div className="card" style={{ marginTop: 12 }}>
        {files.length === 0 && <div className="empty">Nenhum arquivo entregue ainda.</div>}
        <ul className="list">
          {files.map((f) => (
            <li key={f.id}>
              <a href={f.url} target="_blank" rel="noreferrer" className="row" style={{ textDecoration: "none" }}>
                <div><strong>{f.title}</strong><div className="small muted">{KIND[f.kind ?? ""] ?? f.kind ?? "Arquivo"} · {fmtDate(f.file_date)}</div></div>
                <span className="btn btn-sm btn-ghost">Abrir</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
