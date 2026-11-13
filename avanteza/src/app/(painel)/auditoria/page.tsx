import { userDb } from "@/lib/supabase/server";
import { dt } from "@/lib/format";

const EVENT: Record<string, string> = {
  proposed: "Proposta", approved: "Aprovada", rejected: "Rejeitada", executed: "Executada", simulated: "Simulada",
  failed: "Falhou", blocked: "Bloqueada", settings_changed: "Ajustes alterados", policy_changed: "Política alterada",
  global_pause_on: "Pausa geral ligada", global_pause_off: "Pausa geral desligada", account_connected: "Conta conectada",
  account_disconnected: "Conta desconectada",
};

export default async function Auditoria() {
  const db = await userDb();
  const { data } = await db.from("audit_log").select("*, clients(name)").order("created_at", { ascending: false }).limit(200);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Rastreabilidade</div><h1>Log de auditoria</h1></div></div>
      <div className="card" style={{ marginTop: 12 }}>
        {(data ?? []).length === 0 && <div className="empty">Sem eventos.</div>}
        <ul className="timeline">
          {(data ?? []).map((e: any) => (
            <li key={e.id}>
              <strong>{EVENT[e.event] ?? e.event}</strong> <span className="small muted">{dt(e.created_at)} · {e.actor ?? "sistema"}{e.clients?.name ? ` · ${e.clients.name}` : ""}</span>
              {(e.before_state || e.after_state || e.details) && (
                <details>
                  <summary className="small">detalhes</summary>
                  <div className="grid two small" style={{ marginTop: 6 }}>
                    {e.before_state && <div><div className="muted">Antes</div><pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(e.before_state, null, 1)}</pre></div>}
                    {e.after_state && <div><div className="muted">Depois</div><pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(e.after_state, null, 1)}</pre></div>}
                    {e.details && <div><div className="muted">Detalhes</div><pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(e.details, null, 1)}</pre></div>}
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
