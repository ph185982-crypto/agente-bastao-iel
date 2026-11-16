// Operações → Calendário: entregas por dia, na semana ou no mês, com filtro por cliente e responsável.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { addDaysStr, addMonthsStr, isDateStr } from "@/lib/mapa/plan";
import { PageHeader } from "@/components/shell/GlassCard";
import { podeVerMotor } from "@/lib/motor/acesso";
import { acoesDoPeriodo, clientesAtivos, idDoUsuario, isUuid, listarEquipe, type AcaoMotor } from "@/lib/motor/repo";
import { agruparPorDia, diasDoCalendario, filtrar } from "@/lib/motor/fila";
import "@/components/motor/motor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendário — Operações — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const DOW = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MAX_MES = 3;

function Item({ a, hoje }: { a: AcaoMotor; hoje: string }) {
  const feita = a.status === "concluida";
  const cls = feita ? "feita" : a.status === "bloqueada" ? "parada" : a.due_date && a.due_date < hoje ? "atrasada" : "";
  return <span className={`it ${cls}`} title={`${a.client_name} · ${a.title}${a.assignee_name ? ` · ${a.assignee_name}` : ""}`}><b>{a.client_name}</b> {a.title}</span>;
}

export default async function Calendario({ searchParams }: { searchParams: Promise<SP> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const hoje = spDate();
  const modo = one(sp.modo) === "mes" ? "mes" : "semana";
  const data = isDateStr(one(sp.data)) ? one(sp.data) : hoje;
  const dias = diasDoCalendario(data, modo);
  const [meuId, equipe, clientes, acoes] = await Promise.all([idDoUsuario(sess.email), listarEquipe(), clientesAtivos(), acoesDoPeriodo(dias[0], dias.at(-1)!)]);
  const respParam = one(sp.resp) || "todos";
  const responsavel = respParam === "eu" ? meuId ?? "ninguem" : respParam === "todos" ? "" : respParam === "ninguem" || isUuid(respParam) ? respParam : "";
  const cliente = isUuid(one(sp.cli)) ? one(sp.cli) : "";
  const porDia = agruparPorDia(filtrar(acoes, { responsavel, cliente }), dias);
  const mesAtual = data.slice(0, 7);
  const passo = (n: number) => (modo === "semana" ? addDaysStr(data, 7 * n) : addMonthsStr(`${mesAtual}-01`, n));
  const href = (o: Record<string, string>) => {
    const q = new URLSearchParams({ modo, data, ...(one(sp.resp) && { resp: one(sp.resp) }), ...(cliente && { cli: cliente }), ...o });
    if (q.get("modo") === "semana") q.delete("modo");
    if (q.get("data") === hoje) q.delete("data");
    return `/operacoes/calendario${q.size ? `?${q}` : ""}`;
  };
  const titulo = modo === "semana"
    ? `${dias[0].split("-").reverse().slice(0, 2).join("/")} a ${dias[6].split("-").reverse().slice(0, 2).join("/")}`
    : new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mesAtual}-15T12:00:00Z`));
  const total = [...porDia.values()].reduce((s, l) => s + l.length, 0);

  return (
    <>
      <PageHeader eyebrow="Operações" title={<>Calen<span className="accent">dário</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>{total} entrega(s) no período.</p>
      </PageHeader>
      <nav className="tabs" aria-label="Visão">
        <Link href={href({ modo: "semana" })} aria-current={modo === "semana" ? "page" : undefined}>Semana</Link>
        <Link href={href({ modo: "mes" })} aria-current={modo === "mes" ? "page" : undefined}>Mês</Link>
      </nav>
      <div className="mt-cal-nav">
        <Link className="btn btn-sm btn-ghost" href={href({ data: passo(-1) })} aria-label="Período anterior">‹</Link>
        <Link className="btn btn-sm btn-ghost" href={href({ data: hoje })}>Hoje</Link>
        <Link className="btn btn-sm btn-ghost" href={href({ data: passo(1) })} aria-label="Próximo período">›</Link>
        <strong>{titulo}</strong>
      </div>
      <form className="mt-filtros" method="get" aria-label="Filtros">
        <input type="hidden" name="modo" value={modo} /><input type="hidden" name="data" value={data} />
        <div className="field"><label htmlFor="c-resp">Responsável</label>
          <select id="c-resp" name="resp" defaultValue={respParam}>
            <option value="todos">Toda a equipe</option>{meuId && <option value="eu">Eu</option>}<option value="ninguem">Sem responsável</option>
            {equipe.filter((u) => u.id !== meuId).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="c-cli">Cliente</label>
          <select id="c-cli" name="cli" defaultValue={cliente}><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <div className="btns"><button className="btn btn-sm">Filtrar</button></div>
      </form>

      <div className={`mt-cal ${modo}`} role="grid" aria-label={`Calendário: ${titulo}`}>
        {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {dias.map((d) => {
          const itens = porDia.get(d) ?? [];
          const mostrar = modo === "mes" ? itens.slice(0, MAX_MES) : itens;
          return (
            <div key={d} role="gridcell" className={`mt-dia ${d === hoje ? "hoje" : ""} ${modo === "mes" && d.slice(0, 7) !== mesAtual ? "fora" : ""}`}>
              <div className="d"><span>{Number(d.slice(8))}</span>{itens.length > 0 && <span>{itens.length}</span>}</div>
              {mostrar.map((a) => <Item key={a.id} a={a} hoje={hoje} />)}
              {itens.length > mostrar.length && <Link className="mais" href={href({ modo: "semana", data: d })}>+{itens.length - mostrar.length} mais</Link>}
            </div>
          );
        })}
      </div>

      {/* celular: lista por dia (só dias com entregas) */}
      <div className="mt-cal-lista">
        {dias.filter((d) => (porDia.get(d) ?? []).length > 0 && (modo === "semana" || d.slice(0, 7) === mesAtual)).map((d) => (
          <div key={d} className={`mt-dia ${d === hoje ? "hoje" : ""}`}>
            <div className="d"><span>{DOW[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]}, {d.split("-").reverse().slice(0, 2).join("/")}</span><span>{porDia.get(d)!.length}</span></div>
            {porDia.get(d)!.map((a) => <Item key={a.id} a={a} hoje={hoje} />)}
          </div>
        ))}
        {total === 0 && <div className="empty">Nenhuma entrega no período.</div>}
      </div>
    </>
  );
}
