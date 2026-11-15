import Link from "next/link";
import { userDb } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { decide, executeApproved } from "@/app/actions";
import { dt, STATUS_LABEL } from "@/lib/format";
import { ACTION_LABEL } from "@/lib/executor/policy";

function Diff({ before, payload }: { before: any; payload: any }) {
  const keys = Object.keys(payload ?? {});
  return (
    <table className="t" style={{ marginTop: 8 }}>
      <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="small">{before?.[k] !== undefined ? String(before[k]) : before?.erro_leitura ? "(erro na leitura)" : "—"}</td>
            <td className="small"><strong>{String(payload[k])}</strong></td>
          </tr>
        ))}
        {keys.length === 0 && <tr><td colSpan={3} className="small">Sem campos (ex.: pausar/reativar). Estado atual: {before?.status ?? "—"}</td></tr>}
      </tbody>
    </table>
  );
}

export default async function Aprovacoes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = await userDb();
  const [{ data: pending }, { data: waiting }, { data: recent }] = await Promise.all([
    db.from("actions").select("*, clients(name)").eq("status", "proposed").order("created_at"),
    db.from("actions").select("*, clients(name)").eq("status", "approved").order("created_at"),
    db.from("actions").select("*, clients(name)").in("status", ["executed", "simulated", "failed", "rejected", "blocked"]).order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <>
      <Flash sp={sp} />
      <div className="page-head"><div><div className="eyebrow">Executor</div><h1>Fila de <span className="serif">aprovações</span></h1></div></div>

      <h2>Aguardando você ({(pending ?? []).length})</h2>
      {(pending ?? []).length === 0 && <div className="card empty">Nada para aprovar agora.</div>}
      {(pending ?? []).map((a: any) => (
        <div key={a.id} className="card">
          <div className="row">
            <div>
              <span className="pill pill-orange">{ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL] ?? a.action_type}</span>{" "}
              {a.dry_run && <span className="pill pill-sand">simulação</span>}
            </div>
            <span className="small muted">{dt(a.created_at)} · {a.source}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <Link href={`/clientes/${a.client_id}`}><strong>{a.clients?.name}</strong></Link> · <span className="mono">{a.target_id}</span>
            {a.before_state?.title && <div className="small muted">{a.before_state.title}</div>}
            {a.before_state?.text && <div className="small muted">Pergunta: “{a.before_state.text}”</div>}
          </div>
          {a.reason && <div className="small" style={{ marginTop: 6 }}><strong>Justificativa:</strong> {a.reason}</div>}
          <div className="table-wrap"><Diff before={a.before_state} payload={a.payload} /></div>
          <div className="btn-row full" style={{ marginTop: 12 }}>
            <form action={decide}>
              <input type="hidden" name="action_id" value={a.id} /><input type="hidden" name="decision" value="reject" />
              <Submit className="btn btn-danger" >Rejeitar</Submit>
            </form>
            <form action={decide}>
              <input type="hidden" name="action_id" value={a.id} /><input type="hidden" name="decision" value="approve" />
              <Submit className="btn btn-orange">Aprovar</Submit>
            </form>
          </div>
        </div>
      ))}

      {(waiting ?? []).length > 0 && (
        <>
          <h2>Aprovadas aguardando execução ({(waiting ?? []).length})</h2>
          <div className="card">
            <p className="small muted">Normalmente por causa da pausa geral. Serão executadas automaticamente quando a pausa for desligada.</p>
            <ul className="list">
              {(waiting ?? []).map((a: any) => (
                <li key={a.id} className="row">
                  <div><strong>{ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL]}</strong> · {a.clients?.name} · <span className="mono">{a.target_id}</span></div>
                  <form action={executeApproved}><input type="hidden" name="action_id" value={a.id} /><Submit className="btn btn-sm">Executar agora</Submit></form>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>Histórico recente</h2>
      <div className="card">
        {(recent ?? []).length === 0 && <div className="empty">Sem ações ainda.</div>}
        <ul className="list">
          {(recent ?? []).map((a: any) => (
            <li key={a.id}>
              <div className="row">
                <div><strong>{ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL] ?? a.action_type}</strong> · {a.clients?.name} · <span className="mono">{a.target_id}</span></div>
                <span className={`pill ${a.status === "executed" ? "pill-ok" : a.status === "failed" || a.status === "blocked" ? "pill-danger" : "pill-sand"}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
              </div>
              <div className="small muted">{dt(a.executed_at ?? a.decided_at ?? a.created_at)} · por {a.decided_by ?? "—"}{a.error ? ` · ${a.error}` : ""}</div>
            </li>
          ))}
        </ul>
        <Link href="/auditoria" className="small">Log de auditoria completo ›</Link>
      </div>
    </>
  );
}
