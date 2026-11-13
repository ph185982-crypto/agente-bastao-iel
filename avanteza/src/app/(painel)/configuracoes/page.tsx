import { userDb } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { CopyButton } from "@/components/CopyButton";
import { saveSettings, savePolicy } from "@/app/actions";
import { ACTION_LABEL, ACTION_TYPES } from "@/lib/executor/policy";
import { appUrl, missingConfig } from "@/lib/env";
import { redirectUri } from "@/lib/oauth";
import { dt } from "@/lib/format";

export default async function Configuracoes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = await userDb();
  const [{ data: settings }, { data: policies }, { data: runs }] = await Promise.all([
    db.from("settings").select("*").maybeSingle(),
    db.from("action_policies").select("*").is("client_id", null),
    adminDb().from("job_runs").select("job, status, started_at, details").order("started_at", { ascending: false }).limit(12),
  ]);
  const missing = missingConfig();
  const optional = ["RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k]);
  const urls = [
    ["Redirect URI (callback OAuth)", redirectUri()],
    ["URL de notificações (webhook)", `${appUrl()}/api/webhooks/mercadolivre`],
  ];
  return (
    <>
      <Flash sp={sp} />
      <div className="page-head"><div><div className="eyebrow">Sistema</div><h1>Ajustes</h1></div></div>

      <h2>Travas globais</h2>
      <form action={saveSettings} className="card stack">
        <label className="check"><input type="checkbox" name="global_pause" defaultChecked={settings?.global_pause} /> Pausa geral (nenhuma escrita é executada)</label>
        <label className="check"><input type="checkbox" name="dry_run" defaultChecked={settings?.dry_run} /> Modo simulação global (dry-run): aprova e registra, mas não altera nada no marketplace</label>
        <div className="field"><label htmlFor="ae">E-mail para alertas</label><input id="ae" name="alert_email" type="email" defaultValue={settings?.alert_email ?? ""} placeholder="(usa ALERT_EMAIL_TO se vazio)" /></div>
        <Submit className="btn">Salvar</Submit>
      </form>

      <h2>Modos padrão por tipo de ação</h2>
      <div className="card">
        <p className="small muted">Padrão inicial: pedir aprovação para tudo. Cada cliente pode sobrescrever na própria página. Limites valem por anúncio/campanha, acumulados no dia.</p>
        <ul className="list">
          {ACTION_TYPES.map((t) => {
            const p = (policies ?? []).find((x) => x.action_type === t);
            const hasLimit = t === "update_price" || t === "update_ads_budget";
            return (
              <li key={t}>
                <form action={savePolicy} className="row">
                  <input type="hidden" name="action_type" value={t} />
                  <input type="hidden" name="back" value="/configuracoes" />
                  <strong style={{ minWidth: 180 }}>{ACTION_LABEL[t]}</strong>
                  <div className="btn-row">
                    <select name="mode" defaultValue={p?.mode ?? "approval"} style={{ width: 160 }}>
                      <option value="approval">Pedir aprovação</option>
                      <option value="auto">Automático</option>
                      <option value="blocked">Bloqueado</option>
                    </select>
                    {hasLimit && <input name="max_change_pct_per_day" placeholder="máx %/dia" defaultValue={p?.max_change_pct_per_day ?? ""} style={{ width: 110 }} inputMode="decimal" />}
                    <Submit className="btn btn-sm btn-ghost">Salvar</Submit>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      </div>

      <h2>DevCenter do Mercado Livre</h2>
      <div className="card stack">
        {urls.map(([label, url]) => (
          <div key={label} className="row">
            <div><div className="small muted">{label}</div><div className="mono">{url}</div></div>
            <CopyButton text={url} />
          </div>
        ))}
        <div className="small muted">Tópicos de notificação: orders_v2, questions, items, messages (opcionais: shipments, payments).</div>
      </div>

      <h2>Configuração do servidor</h2>
      <div className="card">
        {missing.length === 0 ? (
          <div className="notice ok">Todas as variáveis obrigatórias estão configuradas.</div>
        ) : (
          <div className="notice danger">Faltam na Vercel: <strong>{missing.join(", ")}</strong></div>
        )}
        {optional.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Opcionais ainda vazias: {optional.join(", ")}</p>}
      </div>

      <h2>Últimas rotinas</h2>
      <div className="card">
        {(runs ?? []).length === 0 && <div className="empty">Nenhuma execução registrada.</div>}
        <ul className="list">
          {(runs ?? []).map((r, i) => (
            <li key={i} className="row">
              <span><strong>{r.job}</strong> <span className="small muted">{dt(r.started_at)}</span></span>
              <span className={`pill ${r.status === "ok" ? "pill-ok" : r.status === "error" ? "pill-danger" : "pill-sand"}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
