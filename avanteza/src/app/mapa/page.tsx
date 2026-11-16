import Link from "next/link";
import { requireMapa } from "@/lib/mapa/auth";
import { getClient, listActions, listPhases, marketplaceData, groupOverview } from "@/lib/mapa/repo";
import { addDays, spDate } from "@/lib/dates";
import { brl, int, dec, pct } from "@/lib/format";
import { sumPeriod, variation } from "@/lib/mapa/metrics";
import { planSummary, phaseState, PHASE_STATE_LABEL, nextMilestones, isOverdue, fmtDate, OWNER_LABEL, STATUS_LABEL } from "@/lib/mapa/progress";
import { getTrafficProvider, totalsOf } from "@/lib/mapa/traffic";
import { hasChannels, hasMarketplaces } from "@/lib/mapa/nav";

export default async function Inicio() {
  const { scope } = await requireMapa();
  const today = spDate();
  const client = await getClient(scope);
  if (!client) return <div className="empty">Cliente não encontrado.</div>;
  const [phases, actions, mkt, group] = await Promise.all([
    listPhases(scope),
    listActions(scope),
    hasMarketplaces(client.kind) ? marketplaceData(scope, addDays(today, -60)) : null,
    scope.allowedClientIds.length > 1 ? groupOverview(scope, addDays(today, -30)) : null,
  ]);
  const traffic = hasChannels(client.kind) ? getTrafficProvider() : null;
  const tSummary = traffic && (await traffic.isConnected(scope.clientId)) ? await traffic.summary(scope.clientId, { from: addDays(today, -30), to: today }) : null;

  const sum = planSummary(actions, today);
  const m = nextMilestones(phases, actions, today);
  const cur = mkt ? sumPeriod(mkt.snapshots, addDays(today, -30), today) : null;
  const prev = mkt ? sumPeriod(mkt.snapshots, addDays(today, -60), addDays(today, -31)) : null;
  const dRev = cur && prev ? variation(cur.revenue, prev.revenue) : null;
  const pending = (owner: "cliente" | "avanteza") => actions.filter((a) => a.owner === owner && a.status !== "concluida").slice(0, 5);
  const first = (client.contact_name || client.name).split(" ")[0];

  return (
    <>
      <div className="eyebrow">{client.name}</div>
      <h1>Olá, <span className="accent">{first}</span></h1>
      <p className="muted" style={{ marginTop: 4 }}>Seu mapa de 12 meses com a Avanteza: onde estamos, o que vem agora e o que depende de cada um.</p>

      {cur && (
        <>
          <h2>Marketplaces · últimos 30 dias</h2>
          {mkt!.accounts.length === 0 ? (
            <div className="card muted">Nenhuma conta de marketplace conectada ainda. Assim que conectarmos, os números aparecem aqui.</div>
          ) : (
            <div className="grid kpis">
              <div className="kpi"><div className="label">Faturamento</div><div className="value">{brl(cur.revenue)}</div><div className={`delta ${dRev !== null && dRev < 0 ? "down" : "up"}`}>{dRev === null ? "sem base de comparação" : `${pct(dRev)} vs. 30 dias anteriores`}</div></div>
              <div className="kpi"><div className="label">Pedidos</div><div className="value">{int(cur.orders)}</div><div className="small muted">Ticket médio {cur.ticket ? brl(cur.ticket) : "—"}</div></div>
              <div className="kpi"><div className="label">Investimento em ADS</div><div className="value">{brl(cur.adsCost)}</div><div className="small muted">Receita de ADS {brl(cur.adsRevenue)}</div></div>
              <div className="kpi"><div className="label">ROAS</div><div className="value">{cur.roas ? dec(cur.roas) : "—"}</div><div className="small muted">retorno por R$ investido</div></div>
            </div>
          )}
        </>
      )}

      {traffic && (
        <>
          <h2>Tráfego e mídias · últimos 30 dias</h2>
          {tSummary ? (
            (() => {
              const t = totalsOf(tSummary);
              return (
                <div className="grid kpis">
                  <div className="kpi"><div className="label">Investimento</div><div className="value">{brl(t.spend)}</div></div>
                  <div className="kpi"><div className="label">Faturamento atribuído</div><div className="value">{brl(t.revenue)}</div></div>
                  <div className="kpi"><div className="label">ROAS</div><div className="value">{t.roas ? dec(t.roas) : "—"}</div></div>
                  <div className="kpi"><div className="label">Conversões</div><div className="value">{int(t.conversions)}</div><div className="small muted">CPA {t.cpa ? brl(t.cpa) : "—"}</div></div>
                </div>
              );
            })()
          ) : (
            <div className="card"><strong>Conectando fontes de dados</strong><p className="small muted" style={{ margin: "4px 0 0" }}>Estamos ligando suas contas de anúncios. Os números de investimento, faturamento e ROAS aparecem aqui assim que a conexão terminar. <Link href="/mapa/canais">Ver canais ›</Link></p></div>
          )}
        </>
      )}

      {group && (
        <>
          <h2>Seu grupo · 30 dias</h2>
          <div className="card table-wrap">
            <table className="t">
              <thead><tr><th>Empresa</th><th>Faturamento</th><th>Pedidos</th></tr></thead>
              <tbody>
                {group.map((g) => {
                  const s = sumPeriod(g.snapshots, addDays(today, -30), today);
                  return <tr key={g.company.id}><td>{g.company.name}</td><td className="num">{brl(s.revenue)}</td><td className="num">{int(s.orders)}</td></tr>;
                })}
                {(() => {
                  const all = sumPeriod(group.flatMap((g) => g.snapshots), addDays(today, -30), today);
                  return <tr><td><strong>Total</strong></td><td className="num"><strong>{brl(all.revenue)}</strong></td><td className="num"><strong>{int(all.orders)}</strong></td></tr>;
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Plano de 12 meses</h2>
      {phases.length === 0 ? (
        <div className="card muted">Seu plano de 12 meses está sendo preparado pela equipe. Em breve ele aparece aqui.</div>
      ) : (
        <>
          <div className="card">
            <div className="row"><strong>{sum.pct}% do plano concluído</strong><span className="small muted">{sum.done} de {sum.total} ações{sum.overdue ? ` · ${sum.overdue} atrasada(s)` : ""}</span></div>
            <div className="progress" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={sum.pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${sum.pct}%` }} /></div>
          </div>
          <div style={{ marginTop: 10 }}>
            {phases.map((p) => {
              const st = phaseState(p, actions, today);
              const mine = actions.filter((a) => a.phase_id === p.id);
              const s = planSummary(mine, today);
              return (
                <div key={p.id} className={`phase ${st === "concluida" ? "done" : st === "em_execucao" ? "now" : "future"}`}>
                  <div className="row">
                    <div><div className="small muted">Fase {p.position} · meses {p.start_month}–{p.end_month}</div><h3>{p.name}</h3></div>
                    <span className={`pill ${st === "concluida" ? "pill-ok" : st === "em_execucao" ? "pill-orange" : "pill-outline"}`}>{PHASE_STATE_LABEL[st]}</span>
                  </div>
                  <div className="small muted" style={{ margin: "4px 0 8px" }}>{fmtDate(p.starts_on)} a {fmtDate(p.ends_on)} · {s.done}/{s.total} ações</div>
                  <div className="progress thin"><span style={{ width: `${s.pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          <h2>Próximos marcos</h2>
          <div className="card">
            <ul className="list">
              {m.nextPhase && <li><strong>Início da próxima fase: {m.nextPhase.name}</strong><div className="small muted">{fmtDate(m.nextPhase.date)}</div></li>}
              {m.actions.map((a) => <li key={a.label}>{a.label}<div className={`small ${a.overdue ? "late" : "muted"}`}>{a.overdue ? "Atrasada · " : "Prazo "}{fmtDate(a.date)}</div></li>)}
              {!m.nextPhase && m.actions.length === 0 && <li className="muted">Nenhum marco pendente.</li>}
            </ul>
          </div>
        </>
      )}

      <h2>Próximas ações</h2>
      <div className="grid two">
        {(["cliente", "avanteza"] as const).map((o) => (
          <div className="card" key={o} style={{ marginTop: 0 }}>
            <div className="row"><h3>{o === "cliente" ? "Com você" : "Com a Avanteza"}</h3><Link className="small" href={`/mapa/plano?resp=${o}&status=abertas`}>Ver todas ›</Link></div>
            {pending(o).length === 0 ? <p className="muted small">Nada pendente por aqui.</p> : (
              <ul className="list">
                {pending(o).map((a) => (
                  <li key={a.id}>{a.title}<div className={`small ${isOverdue(a, today) ? "late" : "muted"}`}>{STATUS_LABEL[a.status as keyof typeof STATUS_LABEL]} · {OWNER_LABEL[a.owner as "cliente"]} · {a.due_date ? `${isOverdue(a, today) ? "atrasada, " : "prazo "}${fmtDate(a.due_date)}` : "sem prazo"}</div></li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
