import Link from "next/link";
import { requireMapa } from "@/lib/mapa/auth";
import { listMeetings } from "@/lib/mapa/repo";
import { dt } from "@/lib/format";

export default async function Reunioes() {
  const { scope } = await requireMapa();
  const meetings = await listMeetings(scope);
  return (
    <>
      <div className="eyebrow">Histórico</div>
      <h1>Reuniões</h1>
      <div className="card" style={{ marginTop: 12 }}>
        {meetings.length === 0 && <div className="empty">Nenhuma reunião registrada ainda.</div>}
        <ul className="list">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link href={`/mapa/reunioes/${m.id}`} className="row" style={{ textDecoration: "none" }}>
                <div>
                  <strong>{m.title}</strong>
                  <div className="small muted">{dt(m.held_at)}{m.recording_url ? " · com gravação" : ""}</div>
                  {m.summary && <div className="small" style={{ marginTop: 2 }}>{m.summary.slice(0, 140)}{m.summary.length > 140 ? "…" : ""}</div>}
                </div>
                <span aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
