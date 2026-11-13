import Link from "next/link";
import { notFound } from "next/navigation";
import { userDb } from "@/lib/supabase/server";
import { addDays, spDate } from "@/lib/dates";
import { brl, int, pct, dec, dt, ago, REPUTATION_LABEL, STATUS_LABEL } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { Bars } from "@/components/Bars";
import { AuthLinkBox } from "@/components/AuthLinkBox";
import { ProposeForm } from "@/components/ProposeForm";
import { collectNow, disconnectAccount, saveRule, savePolicy, updateClient, runAgentNow } from "@/app/actions";
import { CopyButton } from "@/components/CopyButton";
import { enabledMarketplaces, MARKETPLACE_LABEL } from "@/lib/marketplaces";
import { RULE_LABEL, DEFAULT_RULES, type RuleType } from "@/lib/alerts/rules";
import { ACTION_LABEL, ACTION_TYPES } from "@/lib/executor/policy";

const PARAM_FIELDS: Record<RuleType, { key: string; label: string }[]> = {
  reputation_drop: [{ key: "claims_rate_increase", label: "Aumento de reclamações (ex.: 0.005 = 0,5 p.p.)" }],
  listing_paused: [],
  out_of_stock: [],
  roas_below: [{ key: "min_roas", label: "ROAS mínimo (7 dias)" }, { key: "min_cost", label: "Custo mínimo para avaliar (R$)" }, { key: "cut_pct", label: "Corte de verba proposto (%)" }],
  unanswered_question: [{ key: "hours", label: "Horas sem resposta" }],
  sales_drop: [{ key: "drop_pct", label: "Queda máxima (%) vs. semana anterior" }, { key: "min_prev_orders", label: "Pedidos mínimos na semana anterior" }],
};

export default async function Cliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = await userDb();
  const { data: client } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();

  const today = spDate();
  const { data: accounts } = await db.from("marketplace_accounts").select("*").eq("client_id", id).order("created_at");
  const accIds = (accounts ?? []).map((a) => a.id);
  const activeAccs = (accounts ?? []).filter((a) => a.status === "active");
  const none = ["00000000-0000-0000-0000-000000000000"];
  const ids = accIds.length ? accIds : none;

  const [snaps, listings, questions, campaigns, rules, policies, actions, alerts, report] = await Promise.all([
    db.from("daily_snapshots").select("*").in("account_id", ids).gte("snapshot_date", addDays(today, -14)).order("snapshot_date"),
    db.from("listings").select("account_id, external_id, title, status, sub_status, price, available_quantity, sold_quantity, visits_30d, permalink").in("account_id", ids).order("sold_quantity", { ascending: false }).limit(300),
    db.from("questions").select("*").in("account_id", ids).eq("status", "UNANSWERED").order("date_created").limit(50),
    db.from("ads_campaigns").select("*").in("account_id", ids).order("name"),
    db.from("alert_rules").select("*").eq("client_id", id),
    db.from("action_policies").select("*").or(`client_id.is.null,client_id.eq.${id}`),
    db.from("actions").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
    db.from("alerts").select("*").eq("client_id", id).eq("status", "open").order("created_at", { ascending: false }).limit(20),
    db.from("ai_reports").select("*").eq("client_id", id).order("report_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // KPIs agregados (todas as contas do cliente)
  const S = snaps.data ?? [];
  const days = Array.from({ length: 15 }, (_, i) => addDays(today, i - 14));
  const byDay = days.map((d) => {
    const rows = S.filter((s) => s.snapshot_date === d);
    return {
      d,
      revenue: rows.reduce((t, s) => t + Number(s.revenue ?? 0), 0),
      orders: rows.reduce((t, s) => t + Number(s.orders_count ?? 0), 0),
      adsCost: rows.reduce((t, s) => t + Number(s.ads_cost ?? 0), 0),
      adsRev: rows.reduce((t, s) => t + Number(s.ads_revenue ?? 0), 0),
      visits: rows.reduce((t, s) => t + Number(s.visits ?? 0), 0),
    };
  });
  const cur = byDay.slice(7, 14); // 7 dias fechados (até ontem)
  const prev = byDay.slice(0, 7); // 7 dias anteriores
  const sum = (arr: typeof byDay, k: "revenue" | "orders" | "adsCost" | "adsRev" | "visits") => arr.reduce((t, x) => t + x[k], 0);
  const rev7 = sum(cur, "revenue");
  const revPrev = sum(prev, "revenue");
  const orders7 = sum(cur, "orders");
  const adsCost7 = sum(cur, "adsCost");
  const adsRev7 = sum(cur, "adsRev");
  const visits7 = sum(cur, "visits");
  const latest = S.filter((s) => s.snapshot_date === today);
  const rep = latest[0]?.reputation_level ?? null;

  const L = listings.data ?? [];
  const problemListings = L.filter((l) => l.status !== "active" || (l.available_quantity ?? 0) === 0);
  const rulesMap = new Map((rules.data ?? []).map((r) => [r.rule_type, r]));
  const P = policies.data ?? [];
  const accName = (aid: string) => (accounts ?? []).find((a) => a.id === aid)?.nickname ?? "conta";
  const back = `/clientes/${id}`;

  return (
    <>
      <Flash sp={sp} />
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/clientes" style={{ textDecoration: "none" }}>Clientes</Link> / {client.active ? "ativo" : "inativo"}</div>
          <h1>{client.name}</h1>
        </div>
        <div className="btn-row">
          <a href="#acoes" className="btn btn-sm btn-ghost">Propor ação</a>
          <a href="#regras" className="btn btn-sm btn-ghost">Regras</a>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="label">Vendas 7d</div><div className="value">{brl(rev7)}</div><div className={`delta ${rev7 >= revPrev ? "up" : "down"}`}>{revPrev ? pct(((rev7 - revPrev) / revPrev) * 100) : "—"}</div></div>
        <div className="kpi"><div className="label">Pedidos 7d</div><div className="value">{int(orders7)}</div><div className="small muted">Ticket {orders7 ? brl(rev7 / orders7) : "—"}</div></div>
        <div className="kpi"><div className="label">Ads 7d</div><div className="value">{adsCost7 ? dec(adsRev7 / adsCost7) : "—"}</div><div className="small muted">ROAS · custo {brl(adsCost7)}</div></div>
        <div className="kpi"><div className="label">Reputação</div><div className="value" style={{ fontSize: 20 }}>{rep ? REPUTATION_LABEL[rep] ?? rep : "—"}</div><div className="small muted">Visitas 7d {int(visits7)}</div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row"><h3>Faturamento diário (14 dias)</h3><span className="small muted">hoje em laranja (parcial)</span></div>
        <div style={{ marginTop: 10 }}>
          <Bars data={byDay.slice(1).map((x) => ({ label: x.d.slice(8), value: x.revenue }))} format={(v) => brl(v)} />
        </div>
      </div>

      {/* Contas */}
      <h2>Contas conectadas</h2>
      <div className="card">
        {(accounts ?? []).length === 0 && <p className="muted">Nenhuma conta conectada. Gere o link e envie ao cliente.</p>}
        <ul className="list">
          {(accounts ?? []).map((a) => (
            <li key={a.id}>
              <div className="row">
                <div>
                  <strong>{a.nickname ?? a.external_user_id}</strong>{" "}
                  <span className={`pill ${a.status === "active" ? "pill-ok" : "pill-danger"}`}>{a.status === "active" ? "Ativa" : a.status === "disabled" ? "Desconectada" : "Reautorizar"}</span>
                  <div className="small muted">{MARKETPLACE_LABEL[a.marketplace as "mercadolivre" | "shopee"] ?? a.marketplace} · ID {a.external_user_id} · token até {dt(a.token_expires_at)} · coleta {ago(a.last_collected_at)}</div>
                  {a.last_error && <div className="small down">{a.last_error}</div>}
                </div>
                {a.status === "active" && (
                  <div className="btn-row">
                    <form action={collectNow}>
                      <input type="hidden" name="account_id" value={a.id} />
                      <input type="hidden" name="back" value={back} />
                      <Submit className="btn btn-sm">Coletar agora</Submit>
                    </form>
                    <form action={disconnectAccount}>
                      <input type="hidden" name="account_id" value={a.id} />
                      <input type="hidden" name="back" value={back} />
                      <Submit className="btn btn-sm btn-danger" confirm="Desconectar esta conta e apagar os tokens?">Desconectar</Submit>
                    </form>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <AuthLinkBox clientId={id} clientName={client.name} marketplaces={enabledMarketplaces()} />
        </div>
      </div>

      {/* Alertas */}
      {(alerts.data ?? []).length > 0 && (
        <>
          <h2>Alertas abertos</h2>
          <div className="card">
            <ul className="list">
              {(alerts.data ?? []).map((al) => (
                <li key={al.id}>
                  <span className={`pill ${al.severity === "critical" ? "pill-orange" : "pill-sand"}`}>{al.severity === "critical" ? "Crítico" : al.severity === "warning" ? "Atenção" : "Info"}</span>{" "}
                  <strong>{al.title}</strong>
                  <div className="small muted">{al.message} · {ago(al.created_at)}</div>
                </li>
              ))}
            </ul>
            <Link href="/alertas" className="small">Ver todos os alertas ›</Link>
          </div>
        </>
      )}

      {/* Agente de IA e relatório diário */}
      <h2>Análise do dia</h2>
      <div className="card">
        {report.data ? (
          <>
            <div className="row">
              <span className="small muted">Relatório de {report.data.report_date.split("-").reverse().join("/")}{report.data.proposed_count ? ` · ${report.data.proposed_count} ação(ões) proposta(s)` : ""}</span>
              <CopyButton text={report.data.report_text ?? ""} label="Copiar relatório" />
            </div>
            {report.data.summary && <p style={{ marginTop: 8 }}>{report.data.summary}</p>}
            {report.data.error && <p className="small muted">{report.data.error}</p>}
            <Link href="/relatorios" className="small">Ver relatório completo ›</Link>
          </>
        ) : (
          <p className="muted">Ainda sem relatório. A rotina roda todo dia às 7h–8h (Brasília).</p>
        )}
        {activeAccs.length > 0 && (
          <form action={runAgentNow} style={{ marginTop: 10 }}>
            <input type="hidden" name="client_id" value={id} />
            <input type="hidden" name="back" value={back} />
            <Submit className="btn btn-sm">Gerar análise agora</Submit>
          </form>
        )}
      </div>

      {/* Perguntas */}
      <h2>Perguntas sem resposta ({(questions.data ?? []).length})</h2>
      <div className="card">
        {(questions.data ?? []).length === 0 && <p className="muted">Nenhuma pergunta pendente.</p>}
        <ul className="list">
          {(questions.data ?? []).map((q) => (
            <li key={q.external_id}>
              <div className="small muted">{accName(q.account_id)} · {q.item_id} · {ago(q.date_created)}</div>
              <div>“{q.text}”</div>
              <details style={{ marginTop: 6 }}>
                <summary className="small">Propor resposta</summary>
                <div style={{ marginTop: 8 }}>
                  <ProposeForm clientId={id} accounts={activeAccs} defaults={{ type: "answer_question", target: q.external_id, accountId: q.account_id }} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>

      {/* Anúncios com problema */}
      <h2>Anúncios ({int(L.length)})</h2>
      <div className="card">
        <div className="small muted" style={{ marginBottom: 8 }}>{problemListings.length} pausados/sem estoque · ordenados por vendas</div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Anúncio</th><th>Status</th><th>Preço</th><th>Estoque</th><th>Vendidos</th><th>Visitas 30d</th></tr></thead>
            <tbody>
              {[...problemListings, ...L.filter((l) => !problemListings.includes(l))].slice(0, 60).map((l) => (
                <tr key={l.account_id + l.external_id}>
                  <td>{l.permalink ? <a href={l.permalink} target="_blank" rel="noreferrer">{l.title}</a> : l.title}<div className="small muted mono">{l.external_id}</div></td>
                  <td><span className={`pill ${l.status === "active" ? "pill-ok" : "pill-sand"}`}>{l.status}</span>{(l.sub_status ?? []).length > 0 && <div className="small muted">{(l.sub_status ?? []).join(", ")}</div>}</td>
                  <td className="num">{brl(l.price)}</td>
                  <td className="num" style={(l.available_quantity ?? 0) === 0 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>{int(l.available_quantity)}</td>
                  <td className="num">{int(l.sold_quantity)}</td>
                  <td className="num">{int(l.visits_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Ads */}
      <h2>Product Ads</h2>
      <div className="card">
        {(campaigns.data ?? []).length === 0 && <p className="muted">Sem campanhas coletadas (a conta pode não usar Product Ads).</p>}
        {(campaigns.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Campanha</th><th>Status</th><th>Verba</th><th>Custo 7d</th><th>Cliques 7d</th><th>ROAS 7d</th><th>Meta</th></tr></thead>
              <tbody>
                {(campaigns.data ?? []).map((c) => (
                  <tr key={c.account_id + c.external_id}>
                    <td>{c.name}<div className="small muted mono">{c.external_id}</div></td>
                    <td>{c.status}</td>
                    <td className="num">{brl(c.budget)}</td>
                    <td className="num">{brl(c.metrics_7d?.cost)}</td>
                    <td className="num">{int(c.metrics_7d?.clicks)}</td>
                    <td className="num">{dec(c.metrics_7d?.roas)}</td>
                    <td className="num">{dec(c.roas_target)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ações */}
      <h2 id="acoes">Propor ação</h2>
      <div className="card">
        {activeAccs.length === 0 ? <p className="muted">Conecte uma conta para propor ações.</p> : <ProposeForm clientId={id} accounts={activeAccs} />}
      </div>
      {(actions.data ?? []).length > 0 && (
        <div className="card">
          <h3>Últimas ações</h3>
          <ul className="list">
            {(actions.data ?? []).map((a) => (
              <li key={a.id}>
                <div className="row">
                  <div><strong>{ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL] ?? a.action_type}</strong> <span className="mono">{a.target_id}</span></div>
                  <span className="pill pill-outline">{STATUS_LABEL[a.status] ?? a.status}</span>
                </div>
                <div className="small muted">{dt(a.created_at)} · {a.source}{a.error ? ` · ${a.error}` : ""}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Regras de alerta */}
      <h2 id="regras">Regras de alerta</h2>
      <div className="grid two">
        {DEFAULT_RULES.map((def) => {
          const r = rulesMap.get(def.rule_type) ?? { ...def, enabled: false };
          return (
            <form key={def.rule_type} action={saveRule} className="card stack" style={{ marginTop: 0 }}>
              <input type="hidden" name="client_id" value={id} />
              <input type="hidden" name="rule_type" value={def.rule_type} />
              <label className="check"><input type="checkbox" name="enabled" defaultChecked={r.enabled} /> {RULE_LABEL[def.rule_type]}</label>
              {PARAM_FIELDS[def.rule_type].map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input name={`p_${f.key}`} inputMode="decimal" defaultValue={String((r.params as Record<string, unknown>)?.[f.key] ?? def.params[f.key] ?? "")} />
                </div>
              ))}
              {def.rule_type === "roas_below" && (
                <label className="check small"><input type="checkbox" name="propose_action" defaultChecked={Boolean((r as { propose_action?: boolean }).propose_action)} /> Propor corte de verba automaticamente</label>
              )}
              <div className="field">
                <label>Severidade</label>
                <select name="severity" defaultValue={r.severity}>
                  <option value="info">Info</option><option value="warning">Atenção</option><option value="critical">Crítico</option>
                </select>
              </div>
              <Submit className="btn btn-sm">Salvar</Submit>
            </form>
          );
        })}
      </div>

      {/* Modos por tipo de ação (sobrescrevem o padrão global) */}
      <h2>Modos de execução deste cliente</h2>
      <div className="card">
        <p className="small muted">“Herdar” usa o padrão global definido em Ajustes.</p>
        <ul className="list">
          {ACTION_TYPES.map((t) => {
            const own = P.find((p) => p.client_id === id && p.action_type === t);
            const glob = P.find((p) => p.client_id === null && p.action_type === t);
            const hasLimit = t === "update_price" || t === "update_ads_budget";
            return (
              <li key={t}>
                <form action={savePolicy} className="row">
                  <input type="hidden" name="client_id" value={id} />
                  <input type="hidden" name="action_type" value={t} />
                  <input type="hidden" name="back" value={back} />
                  <div style={{ minWidth: 180 }}><strong>{ACTION_LABEL[t]}</strong><div className="small muted">Global: {glob?.mode ?? "approval"}{glob?.max_change_pct_per_day != null ? ` · máx ${glob.max_change_pct_per_day}%/dia` : ""}</div></div>
                  <div className="btn-row">
                    <select name="mode" defaultValue={own?.mode ?? "inherit"} style={{ width: 150 }}>
                      <option value="inherit">Herdar</option>
                      <option value="approval">Pedir aprovação</option>
                      <option value="auto">Automático</option>
                      <option value="blocked">Bloqueado</option>
                    </select>
                    {hasLimit && <input name="max_change_pct_per_day" placeholder="máx %/dia" defaultValue={own?.max_change_pct_per_day ?? ""} style={{ width: 110 }} inputMode="decimal" />}
                    <Submit className="btn btn-sm btn-ghost">Salvar</Submit>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Dados do cliente */}
      <h2>Dados do cliente</h2>
      <form action={updateClient} className="card stack">
        <input type="hidden" name="client_id" value={id} />
        <div className="field"><label>Nome</label><input name="name" defaultValue={client.name} required /></div>
        <div className="grid two">
          <div className="field"><label>Contato</label><input name="contact_name" defaultValue={client.contact_name ?? ""} /></div>
          <div className="field"><label>WhatsApp</label><input name="contact_phone" defaultValue={client.contact_phone ?? ""} /></div>
        </div>
        <div className="field"><label>E-mail</label><input name="contact_email" type="email" defaultValue={client.contact_email ?? ""} /></div>
        <div className="field"><label>Observações</label><textarea name="notes" defaultValue={client.notes ?? ""} /></div>
        <div className="field"><label>Instruções para a IA (contexto do negócio, margens, o que evitar)</label><textarea name="ai_instructions" defaultValue={client.ai_instructions ?? ""} placeholder="Ex.: margem mínima de 18%; não baixar preço da linha premium; tom formal nas respostas." /></div>
        <label className="check"><input type="checkbox" name="ai_enabled" defaultChecked={client.ai_enabled !== false} /> Agente de IA ativo para este cliente</label>
        <label className="check"><input type="checkbox" name="active" defaultChecked={client.active} /> Cliente ativo</label>
        <Submit className="btn btn-sm">Salvar dados</Submit>
      </form>
    </>
  );
}
