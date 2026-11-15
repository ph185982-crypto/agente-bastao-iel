import Link from "next/link";
import { userDb } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { runAlertsNow, setAlertStatus } from "@/app/actions";
import { ago } from "@/lib/format";
import { RULE_LABEL, type RuleType } from "@/lib/alerts/rules";

export default async function Alertas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const view = sp.ver === "historico" ? "historico" : "abertos";
  const db = await userDb();
  let q = db.from("alerts").select("*, clients(name)").order("created_at", { ascending: false }).limit(200);
  q = view === "abertos" ? q.neq("status", "resolved") : q.eq("status", "resolved");
  const { data: alerts } = await q;
  const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const list = [...(alerts ?? [])].sort((a, b) => (view === "abertos" ? sevOrder[a.severity] - sevOrder[b.severity] : 0));
  return (
    <>
      <Flash sp={sp} />
      <div className="page-head">
        <div><div className="eyebrow">Monitoramento</div><h1>Alertas</h1></div>
        <form action={runAlertsNow}>
          <input type="hidden" name="back" value="/alertas" />
          <Submit className="btn btn-sm btn-ghost">Reavaliar agora</Submit>
        </form>
      </div>
      <div className="btn-row" style={{ margin: "12px 0" }}>
        <Link href="/alertas" className={`pill ${view === "abertos" ? "pill-navy" : "pill-outline"}`}>Abertos</Link>
        <Link href="/alertas?ver=historico" className={`pill ${view === "historico" ? "pill-navy" : "pill-outline"}`}>Resolvidos</Link>
      </div>
      <div className="card">
        {list.length === 0 && <div className="empty">Nenhum alerta {view === "abertos" ? "aberto" : "resolvido"}.</div>}
        <ul className="list">
          {list.map((a: any) => (
            <li key={a.id}>
              <div className="row">
                <div>
                  <span className={`pill ${a.severity === "critical" ? "pill-orange" : a.severity === "warning" ? "pill-sand" : "pill-outline"}`}>
                    {a.severity === "critical" ? "Crítico" : a.severity === "warning" ? "Atenção" : "Info"}
                  </span>{" "}
                  <span className="small muted">{a.clients?.name} · {RULE_LABEL[a.rule_type as RuleType] ?? a.rule_type} · {ago(a.created_at)}</span>
                  {a.status === "acknowledged" && <span className="pill pill-outline" style={{ marginLeft: 6 }}>visto</span>}
                </div>
              </div>
              <div style={{ marginTop: 4 }}><strong>{a.title}</strong></div>
              <div className="small muted">{a.message}</div>
              {a.notified_channels?.length > 0 && <div className="small muted">Notificado: {a.notified_channels.join(", ")}</div>}
              {view === "abertos" && (
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <Link className="btn btn-sm btn-ghost" href={`/clientes/${a.client_id}`}>Abrir cliente</Link>
                  {a.status === "open" && (
                    <form action={setAlertStatus}>
                      <input type="hidden" name="alert_id" value={a.id} /><input type="hidden" name="status" value="acknowledged" />
                      <Submit className="btn btn-sm btn-ghost">Marcar como visto</Submit>
                    </form>
                  )}
                  <form action={setAlertStatus}>
                    <input type="hidden" name="alert_id" value={a.id} /><input type="hidden" name="status" value="resolved" />
                    <Submit className="btn btn-sm">Resolver</Submit>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
