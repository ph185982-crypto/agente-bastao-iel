import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMapa } from "@/lib/mapa/auth";
import { getMeeting } from "@/lib/mapa/repo";
import { dt } from "@/lib/format";
import { OWNER_LABEL, STATUS_LABEL, fmtDate } from "@/lib/mapa/progress";

export default async function Reuniao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { scope } = await requireMapa();
  const r = await getMeeting(scope, id); // filtrada pelo cliente da sessão: id de outro cliente = 404
  if (!r) notFound();
  const { meeting: m, actions } = r;
  const decisions: string[] = Array.isArray(m.decisions) ? m.decisions : [];
  return (
    <>
      <div className="eyebrow"><Link href="/mapa/reunioes" style={{ textDecoration: "none" }}>Reuniões</Link> / {dt(m.held_at)}</div>
      <h1>{m.title}</h1>
      <div className="btn-row" style={{ marginTop: 12 }}>
        {m.recording_url && <a className="btn btn-orange" href={m.recording_url} target="_blank" rel="noreferrer">Assistir à gravação</a>}
        {m.transcript_url && <a className="btn btn-ghost" href={m.transcript_url} target="_blank" rel="noreferrer">Abrir transcrição</a>}
      </div>
      <h2>Resumo</h2>
      <div className="card">{m.summary ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.summary}</p> : <p className="muted" style={{ margin: 0 }}>O resumo desta reunião ainda está sendo preparado.</p>}</div>
      <h2>Decisões</h2>
      <div className="card">{decisions.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nenhuma decisão registrada.</p> : <ul className="list">{decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>}</div>
      <h2>Ações combinadas</h2>
      <div className="card">
        {actions.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nenhuma ação registrada para esta reunião.</p> : (
          <ul className="list">{actions.map((a) => (
            <li key={a.id}><div className="row"><strong>{a.title}</strong><span className="pill pill-outline">{STATUS_LABEL[a.status as keyof typeof STATUS_LABEL]}</span></div>
              <div className="small muted">{OWNER_LABEL[a.owner as "cliente"]}{a.due_date ? ` · prazo ${fmtDate(a.due_date)}` : ""}</div></li>
          ))}</ul>
        )}
        <Link href="/mapa/plano" className="small">Ver no plano ›</Link>
      </div>
    </>
  );
}
