import { redirect } from "next/navigation";
import { requireMapa } from "@/lib/mapa/auth";
import { getClient } from "@/lib/mapa/repo";
import { hasChannels } from "@/lib/mapa/nav";
import { addDays, spDate } from "@/lib/dates";
import { brl, int, dec } from "@/lib/format";
import { CHANNELS, CHANNEL_LABEL, getTrafficProvider, totalsOf } from "@/lib/mapa/traffic";

export default async function Canais() {
  const { scope } = await requireMapa();
  const client = await getClient(scope);
  if (!client || !hasChannels(client.kind)) redirect("/mapa");
  const today = spDate();
  const provider = getTrafficProvider();
  const connected = await provider.isConnected(scope.clientId);
  const summary = connected ? await provider.summary(scope.clientId, { from: addDays(today, -30), to: today }) : null;

  return (
    <>
      <div className="eyebrow">{client.name}</div>
      <h1>Canais</h1>
      <p className="muted small" style={{ marginTop: 4 }}>Instagram, Meta Ads, Google Ads e Facebook: investimento, faturamento e retorno por canal.</p>
      {!summary ? (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Conectando fontes de dados</h3>
          <p className="muted" style={{ margin: "6px 0 0" }}>Estamos ligando suas contas de anúncios e redes. Quando a conexão terminar, os números de cada canal aparecem aqui automaticamente. Não é preciso fazer nada agora.</p>
          <ul className="list" style={{ marginTop: 12 }}>
            {CHANNELS.map((c) => <li key={c}><div className="row"><strong>{CHANNEL_LABEL[c]}</strong><span className="pill pill-outline">Aguardando conexão</span></div></li>)}
          </ul>
        </div>
      ) : (
        (() => {
          const t = totalsOf(summary);
          return (
            <>
              <h2>Total · 30 dias</h2>
              <div className="grid kpis">
                <div className="kpi"><div className="label">Investimento</div><div className="value">{brl(t.spend)}</div></div>
                <div className="kpi"><div className="label">Faturamento atribuído</div><div className="value">{brl(t.revenue)}</div></div>
                <div className="kpi"><div className="label">ROAS</div><div className="value">{t.roas ? dec(t.roas) : "—"}</div></div>
                <div className="kpi"><div className="label">Conversões</div><div className="value">{int(t.conversions)}</div><div className="small muted">CPA {t.cpa ? brl(t.cpa) : "—"}</div></div>
              </div>
              <h2>Por canal</h2>
              <div className="card table-wrap"><table className="t">
                <thead><tr><th>Canal</th><th>Investimento</th><th>Faturamento</th><th>ROAS</th><th>Conversões</th><th>Cliques</th></tr></thead>
                <tbody>{summary.channels.map((c) => <tr key={c.channel}><td>{CHANNEL_LABEL[c.channel]}</td><td className="num">{brl(c.spend)}</td><td className="num">{brl(c.revenue)}</td><td className="num">{c.spend > 0 ? dec(c.revenue / c.spend) : "—"}</td><td className="num">{int(c.conversions)}</td><td className="num">{int(c.clicks)}</td></tr>)}</tbody>
              </table></div>
            </>
          );
        })()
      )}
    </>
  );
}
