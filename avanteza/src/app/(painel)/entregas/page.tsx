// Painel de entregas pendentes: ações abertas de todos os clientes, por cliente e prazo (só leitura).
import Link from "next/link";
import { userDb } from "@/lib/db";
import { spDate } from "@/lib/dates";
import { fmtDate, isOverdue, OWNER_LABEL, STATUS_LABEL } from "@/lib/mapa/progress";

export default async function Entregas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = await userDb();
  const today = spDate();
  const resp = sp.resp === "cliente" || sp.resp === "avanteza" ? sp.resp : "";
  const [{ data: clients }, { data: actions }] = await Promise.all([
    db.from("clients").select("id, name, kind").eq("active", true).order("name"),
    db.from("plan_actions").select("id, client_id, title, status, owner, due_date, origin").neq("status", "concluida").order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  const open = (actions ?? []).filter((a) => !resp || a.owner === resp);
  const late = open.filter((a) => isOverdue(a, today));
  const groups = (clients ?? []).map((c) => ({ c, items: open.filter((a) => a.client_id === c.id) })).filter((g) => g.items.length);
  const chip = (label: string, v: string) => <Link className="chip" aria-current={resp === v} href={v ? `/entregas?resp=${v}` : "/entregas"}>{label}</Link>;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Mapa</div><h1>Entregas pendentes</h1></div></div>
      <div className="grid kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="label">Ações abertas</div><div className="value">{open.length}</div></div>
        <div className="kpi"><div className="label">Atrasadas</div><div className="value" style={late.length ? { color: "var(--danger)" } : undefined}>{late.length}</div></div>
        <div className="kpi"><div className="label">Com a Avanteza</div><div className="value">{open.filter((a) => a.owner === "avanteza").length}</div></div>
        <div className="kpi"><div className="label">Com o cliente</div><div className="value">{open.filter((a) => a.owner === "cliente").length}</div></div>
      </div>
      <div className="chips">{chip("Todas", "")}{chip("Avanteza", "avanteza")}{chip("Cliente", "cliente")}</div>
      {groups.length === 0 && <div className="card empty">Nenhuma ação em aberto.</div>}
      {groups.map(({ c, items }) => (
        <section key={c.id} className="card">
          <div className="row"><Link href={`/clientes/${c.id}?aba=plano`}><h3>{c.name}</h3></Link><span className="small muted">{items.length} em aberto{items.filter((a) => isOverdue(a, today)).length ? ` · ${items.filter((a) => isOverdue(a, today)).length} atrasada(s)` : ""}</span></div>
          <ul className="list">
            {items.slice(0, 12).map((a) => (
              <li key={a.id}><div className="row"><span>{a.title}</span><span className="pill pill-outline">{STATUS_LABEL[a.status as keyof typeof STATUS_LABEL]}</span></div>
                <div className="small"><span className="muted">{OWNER_LABEL[a.owner as "cliente"]}</span><span className={isOverdue(a, today) ? "late" : "muted"}> · {a.due_date ? `${isOverdue(a, today) ? "atrasada, " : "prazo "}${fmtDate(a.due_date)}` : "sem prazo"}</span></div></li>
            ))}
          </ul>
          {items.length > 12 && <Link href={`/clientes/${c.id}?aba=plano`} className="small">Ver as {items.length} ações ›</Link>}
        </section>
      ))}
    </>
  );
}
