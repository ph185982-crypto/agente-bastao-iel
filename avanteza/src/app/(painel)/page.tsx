import Link from "next/link";
import { userDb } from "@/lib/db";
import { addDays, spDate } from "@/lib/dates";
import { brl, int, pct, dec, REPUTATION_LABEL, ago, STATUS_LABEL } from "@/lib/format";
import { ACTION_LABEL } from "@/lib/executor/policy";
import { Flash } from "@/components/Flash";
import { togglePause } from "@/app/actions";
import { Submit } from "@/components/Submit";

type Snap = { account_id: string; snapshot_date: string; orders_count: number; revenue: number; reputation_level: string | null; ads_cost: number | null; ads_revenue: number | null; unanswered_questions: number | null; out_of_stock_listings: number | null };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = await userDb();
  const today = spDate();
  const from = addDays(today, -14);
  const [clients, accounts, snaps, alerts, approvals, settings] = await Promise.all([
    db.from("clients").select("id, name, active").eq("active", true).order("name"),
    db.from("marketplace_accounts").select("id, client_id, nickname, status, last_collected_at, last_error"),
    db.from("daily_snapshots").select("account_id, snapshot_date, orders_count, revenue, reputation_level, ads_cost, ads_revenue, unanswered_questions, out_of_stock_listings").gte("snapshot_date", from),
    db.from("alerts").select("client_id, severity").eq("status", "open"),
    db.from("actions").select("client_id").eq("status", "proposed"),
    db.from("settings").select("global_pause").maybeSingle(),
  ]);
  const { data: autoDone } = await db
    .from("actions")
    .select("id, action_type, target_id, status, client_id, clients(name)")
    .eq("decided_by", "auto")
    .in("status", ["executed", "simulated", "failed"])
    .gte("executed_at", new Date(Date.now() - 86400_000).toISOString())
    .order("executed_at", { ascending: false })
    .limit(20);
  const S = (snaps.data ?? []) as Snap[];
  const sumRange = (accIds: string[], a: string, b: string, k: "revenue" | "orders_count") =>
    S.filter((s) => accIds.includes(s.account_id) && s.snapshot_date >= a && s.snapshot_date <= b).reduce((t, s) => t + Number(s[k] ?? 0), 0);

  const yest = addDays(today, -1);
  const cur7 = [addDays(today, -7), yest] as const;
  const prev7 = [addDays(today, -14), addDays(today, -8)] as const;
  const allAcc = (accounts.data ?? []).map((a) => a.id);
  const revCur = sumRange(allAcc, ...cur7, "revenue");
  const revPrev = sumRange(allAcc, ...prev7, "revenue");
  const ordToday = sumRange(allAcc, today, today, "orders_count");
  const revToday = sumRange(allAcc, today, today, "revenue");

  return (
    <>
      <Flash sp={sp} />
      <div className="page-head">
        <div>
          <div className="eyebrow">Painel Nexo</div>
          <h1>Visão <span className="serif">geral</span></h1>
        </div>
        <form action={togglePause}>
          <input type="hidden" name="pause" value={settings.data?.global_pause ? "0" : "1"} />
          <input type="hidden" name="back" value="/" />
          <Submit className={settings.data?.global_pause ? "btn btn-orange" : "btn btn-danger"} confirm={settings.data?.global_pause ? undefined : "Ativar a pausa geral? Nenhuma ação de escrita será executada."}>
            {settings.data?.global_pause ? "Retomar execuções" : "Pausa geral"}
          </Submit>
        </form>
      </div>

      <div className="grid kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="label">Vendas hoje</div><div className="value">{brl(revToday)}</div><div className="small muted">{int(ordToday)} pedidos</div></div>
        <div className="kpi"><div className="label">Vendas 7 dias</div><div className="value">{brl(revCur)}</div><div className={`delta ${revCur >= revPrev ? "up" : "down"}`}>{revPrev ? pct(((revCur - revPrev) / revPrev) * 100) : "—"} vs. semana anterior</div></div>
        <Link href="/aprovacoes" className="kpi" style={{ textDecoration: "none" }}><div className="label">Aprovações</div><div className="value">{int(approvals.data?.length ?? 0)}</div><div className="small muted">aguardando você</div></Link>
        <Link href="/alertas" className="kpi" style={{ textDecoration: "none" }}><div className="label">Alertas abertos</div><div className="value">{int(alerts.data?.length ?? 0)}</div><div className="small muted">{(alerts.data ?? []).filter((a) => a.severity === "critical").length} críticos</div></Link>
      </div>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <Link href="/relatorios" className="btn btn-sm btn-ghost">Relatórios do dia</Link>
        <Link href="/auditoria" className="btn btn-sm btn-ghost">Auditoria</Link>
      </div>

      {(autoDone ?? []).length > 0 && (
        <>
          <h2>Feito automaticamente (24 h)</h2>
          <div className="card">
            <ul className="list">
              {(autoDone ?? []).map((a: any) => (
                <li key={a.id} className="row">
                  <span><strong>{ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL] ?? a.action_type}</strong> · {a.clients?.name} · <span className="mono">{a.target_id}</span></span>
                  <span className={`pill ${a.status === "executed" ? "pill-ok" : a.status === "failed" ? "pill-danger" : "pill-sand"}`}>{STATUS_LABEL[a.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>Clientes</h2>
      {(clients.data ?? []).length === 0 && (
        <div className="card empty">Nenhum cliente ainda. <Link href="/clientes">Cadastrar o primeiro</Link>.</div>
      )}
      <div className="grid two">
        {(clients.data ?? []).map((c) => {
          const accs = (accounts.data ?? []).filter((a) => a.client_id === c.id);
          const ids = accs.map((a) => a.id);
          const rc = sumRange(ids, ...cur7, "revenue");
          const rp = sumRange(ids, ...prev7, "revenue");
          const lastSnap = S.filter((s) => ids.includes(s.account_id) && s.snapshot_date === today);
          const adsCost = S.filter((s) => ids.includes(s.account_id) && s.snapshot_date >= cur7[0] && s.snapshot_date <= cur7[1]).reduce((t, s) => t + Number(s.ads_cost ?? 0), 0);
          const adsRev = S.filter((s) => ids.includes(s.account_id) && s.snapshot_date >= cur7[0] && s.snapshot_date <= cur7[1]).reduce((t, s) => t + Number(s.ads_revenue ?? 0), 0);
          const nAlerts = (alerts.data ?? []).filter((a) => a.client_id === c.id).length;
          const nAppr = (approvals.data ?? []).filter((a) => a.client_id === c.id).length;
          const rep = lastSnap[0]?.reputation_level;
          const problem = accs.find((a) => a.status !== "active" || a.last_error);
          return (
            <Link key={c.id} href={`/clientes/${c.id}`} className="card" style={{ textDecoration: "none", display: "block", marginTop: 0 }}>
              <div className="row">
                <h3>{c.name}</h3>
                <div className="btn-row">
                  {nAppr > 0 && <span className="pill pill-orange">{nAppr} aprov.</span>}
                  {nAlerts > 0 && <span className="pill pill-navy">{nAlerts} alertas</span>}
                  {accs.length === 0 && <span className="pill pill-sand">Sem conta conectada</span>}
                </div>
              </div>
              <div className="grid kpis" style={{ marginTop: 10, gap: 8 }}>
                <div><div className="small muted">7 dias</div><strong>{brl(rc)}</strong> <span className={`small ${rc >= rp ? "up" : "down"}`}>{rp ? pct(((rc - rp) / rp) * 100, 0) : ""}</span></div>
                <div><div className="small muted">Reputação</div><strong>{rep ? REPUTATION_LABEL[rep] ?? rep : "—"}</strong></div>
                <div><div className="small muted">ROAS 7d</div><strong>{adsCost > 0 ? dec(adsRev / adsCost) : "—"}</strong></div>
                <div><div className="small muted">Coleta</div><strong className="small">{ago(accs.map((a) => a.last_collected_at).sort().reverse()[0])}</strong></div>
              </div>
              {problem && <div className="small down" style={{ marginTop: 8 }}>⚠ {problem.status !== "active" ? "Conta precisa de nova autorização" : problem.last_error}</div>}
            </Link>
          );
        })}
      </div>
    </>
  );
}
