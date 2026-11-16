import { redirect } from "next/navigation";
import { requireMapa } from "@/lib/mapa/auth";
import { getClient, marketplaceData } from "@/lib/mapa/repo";
import { hasMarketplaces } from "@/lib/mapa/nav";
import { addDays, spDate } from "@/lib/dates";
import { brl, int, dec, pct, ago, REPUTATION_LABEL } from "@/lib/format";
import { sumPeriod, variation } from "@/lib/mapa/metrics";
import { MARKETPLACE_LABEL } from "@/lib/marketplaces";
import { Bars } from "@/components/Bars";

export default async function Marketplaces() {
  const { scope } = await requireMapa();
  const client = await getClient(scope);
  if (!client || !hasMarketplaces(client.kind)) redirect("/mapa");
  const today = spDate();
  const d = await marketplaceData(scope, addDays(today, -60));
  const cur = sumPeriod(d.snapshots, addDays(today, -30), today);
  const prev = sumPeriod(d.snapshots, addDays(today, -60), addDays(today, -31));
  const dRev = variation(cur.revenue, prev.revenue);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const byDay = days.map((day) => ({ label: day.slice(8), value: d.snapshots.filter((s) => s.snapshot_date === day).reduce((t, s) => t + Number(s.revenue ?? 0), 0) }));
  const lastSnap = [...d.snapshots].reverse().find((s) => s.reputation_level);
  const problems = d.listings.filter((l) => l.status !== "active" || (l.available_quantity ?? 0) === 0);
  const name = (id: string) => d.accounts.find((a) => a.id === id)?.nickname ?? "conta";

  return (
    <>
      <div className="eyebrow">{client.name}</div>
      <h1>Marketplaces</h1>
      {d.accounts.length === 0 && <div className="card muted" style={{ marginTop: 12 }}>Nenhuma conta conectada ainda. Assim que a Avanteza conectar suas contas, vendas, anúncios e alertas aparecem aqui.</div>}

      <h2>Contas</h2>
      <div className="card">
        {d.accounts.length === 0 ? <p className="muted">Sem contas.</p> : (
          <ul className="list">
            {d.accounts.map((a) => (
              <li key={a.id}><div className="row"><div><strong>{a.nickname ?? "Conta"}</strong><div className="small muted">{MARKETPLACE_LABEL[a.marketplace as "mercadolivre"] ?? a.marketplace} · atualizada {ago(a.last_collected_at)}</div></div>
                <span className={`pill ${a.status === "active" ? "pill-ok" : "pill-sand"}`}>{a.status === "active" ? "Conectada" : "Reconexão pendente"}</span></div></li>
            ))}
          </ul>
        )}
      </div>

      {d.accounts.length > 0 && (
        <>
          <h2>Vendas e faturamento · 30 dias</h2>
          <div className="grid kpis">
            <div className="kpi"><div className="label">Faturamento</div><div className="value">{brl(cur.revenue)}</div><div className={`delta ${dRev !== null && dRev < 0 ? "down" : "up"}`}>{dRev === null ? "—" : `${pct(dRev)} vs. anteriores`}</div></div>
            <div className="kpi"><div className="label">Pedidos</div><div className="value">{int(cur.orders)}</div><div className="small muted">Ticket {cur.ticket ? brl(cur.ticket) : "—"}</div></div>
            <div className="kpi"><div className="label">ADS investido</div><div className="value">{brl(cur.adsCost)}</div><div className="small muted">ROAS {cur.roas ? dec(cur.roas) : "—"}</div></div>
            <div className="kpi"><div className="label">Reputação</div><div className="value" style={{ fontSize: 20 }}>{lastSnap ? REPUTATION_LABEL[lastSnap.reputation_level] ?? lastSnap.reputation_level : "—"}</div><div className="small muted">Visitas {int(cur.visits)}</div></div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Faturamento diário (14 dias)</h3>
            <div style={{ marginTop: 10 }}><Bars data={byDay} format={(v) => brl(v)} /></div>
          </div>
        </>
      )}

      <h2>Alertas abertos ({d.alerts.length})</h2>
      <div className="card">
        {d.alerts.length === 0 ? <p className="muted">Nenhum alerta aberto. Tudo certo por aqui.</p> : (
          <ul className="list">
            {d.alerts.map((a) => (
              <li key={a.id}><span className={`pill ${a.severity === "critical" ? "pill-orange" : "pill-sand"}`}>{a.severity === "critical" ? "Crítico" : a.severity === "warning" ? "Atenção" : "Info"}</span> <strong>{a.title}</strong><div className="small muted">{a.message} · {ago(a.created_at)}</div></li>
            ))}
          </ul>
        )}
      </div>

      <h2>Anúncios ({int(d.listings.length)})</h2>
      <div className="card">
        {d.listings.length === 0 ? <p className="muted">Nenhum anúncio coletado ainda.</p> : (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>{problems.length} pausado(s) ou sem estoque · ordenados por vendas</div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Anúncio</th><th>Conta</th><th>Status</th><th>Preço</th><th>Estoque</th><th>Vendidos</th></tr></thead>
              <tbody>
                {d.listings.slice(0, 40).map((l) => (
                  <tr key={l.account_id + l.external_id}>
                    <td>{l.permalink ? <a href={l.permalink} target="_blank" rel="noreferrer">{l.title}</a> : l.title}</td>
                    <td>{name(l.account_id)}</td>
                    <td><span className={`pill ${l.status === "active" ? "pill-ok" : "pill-sand"}`}>{l.status === "active" ? "Ativo" : l.status === "paused" ? "Pausado" : l.status}</span></td>
                    <td className="num">{brl(l.price)}</td>
                    <td className="num" style={(l.available_quantity ?? 0) === 0 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>{int(l.available_quantity)}</td>
                    <td className="num">{int(l.sold_quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </div>

      {d.campaigns.length > 0 && (
        <>
          <h2>Product Ads</h2>
          <div className="card table-wrap"><table className="t">
            <thead><tr><th>Campanha</th><th>Status</th><th>Verba/dia</th><th>Custo 7d</th><th>ROAS 7d</th><th>Meta</th></tr></thead>
            <tbody>{d.campaigns.map((c) => <tr key={c.account_id + c.external_id}><td>{c.name}</td><td>{c.status}</td><td className="num">{brl(c.budget)}</td><td className="num">{brl(c.metrics_7d?.cost)}</td><td className="num">{dec(c.metrics_7d?.roas)}</td><td className="num">{dec(c.roas_target)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
