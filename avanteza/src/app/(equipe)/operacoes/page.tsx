// Operações → Hoje: a fila de trabalho da equipe. O que fazer hoje, para quem e até quando, sem depender de memória.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canUseApp } from "@/lib/session";
import { spDate } from "@/lib/dates";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { AcaoCard } from "@/components/motor/AcaoCard";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import { acoesDaFila, clientesAtivos, idDoUsuario, isUuid, listarEquipe } from "@/lib/motor/repo";
import { filtrar, montarFila, type FiltroFila } from "@/lib/motor/fila";
import { ROTULO_DEPARTAMENTO, type Departamento } from "@/lib/motor/tipos";
import { contarPendentes } from "@/lib/aprovacoes/equipe";
import { rawQuery } from "@/lib/db/client";
import "@/components/motor/motor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hoje — Operações — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
/** Itens visíveis por grupo; o resto fica em "Mostrar mais" (a tela continua curta mesmo com a fila da equipe toda). */
const LIMITE = 8;

export default async function Hoje({ searchParams }: { searchParams: Promise<SP> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const hoje = spDate();
  const [meuId, equipe, clientes, { acoes, concluidasHoje }, aprov, [rasc]] = await Promise.all([
    idDoUsuario(sess.email), listarEquipe(), clientesAtivos(), acoesDaFila(hoje), contarPendentes(),
    rawQuery<{ n: number }>("select count(*)::int n from avanteza.relatorios_semanais where status = 'rascunho'"),
  ]);
  // Padrão: o membro vê a própria fila; o administrador e o revisor veem a de todos.
  const respParam = one(sp.resp) || (sess.role === "member" && meuId ? "eu" : "todos");
  const responsavel = respParam === "eu" ? meuId ?? "ninguem" : respParam === "todos" ? "" : respParam === "ninguem" || isUuid(respParam) ? respParam : "";
  const cliente = isUuid(one(sp.cli)) ? one(sp.cli) : "";
  const dep: Departamento | "" = one(sp.dep) === "operacoes" || one(sp.dep) === "marketing" ? (one(sp.dep) as Departamento) : "";
  const filtro: FiltroFila = { responsavel, cliente, departamento: dep };
  const fila = montarFila(filtrar(acoes, filtro), hoje, filtrar(concluidasHoje, filtro).length);
  const pode = podeTrabalharMotor(sess);
  const linkCliente = canUseApp(sess, "marketplaces");
  const q = new URLSearchParams({ ...(one(sp.resp) && { resp: one(sp.resp) }), ...(cliente && { cli: cliente }), ...(dep && { dep }) });
  const back = `/operacoes${q.size ? `?${q}` : ""}`;
  const dataLonga = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${hoje}T12:00:00Z`));
  const total = fila.contadores.atrasadas + fila.contadores.hoje + fila.contadores.semana + fila.contadores.bloqueadas;

  const Secao = ({ id, titulo, itens, vazio }: { id: string; titulo: string; itens: typeof fila.hoje; vazio?: string }) =>
    itens.length === 0 && !vazio ? null : (
      <section className="mt-sec" id={id} aria-label={titulo}>
        <h2>{titulo} <span className="n">{itens.length}</span></h2>
        {itens.length === 0 ? <div className="empty">{vazio}</div> : (
          <>
            <div className="mt-lista">{itens.slice(0, LIMITE).map((a) => <AcaoCard key={a.id} a={a} hoje={hoje} equipe={equipe} back={back} pode={pode} linkCliente={linkCliente} />)}</div>
            {itens.length > LIMITE && (
              <details className="mt-mais"><summary>Mostrar mais {itens.length - LIMITE}</summary>
                <div className="mt-lista">{itens.slice(LIMITE).map((a) => <AcaoCard key={a.id} a={a} hoje={hoje} equipe={equipe} back={back} pode={pode} linkCliente={linkCliente} />)}</div>
              </details>
            )}
          </>
        )}
      </section>
    );

  return (
    <>
      <Flash sp={sp} />
      <PageHeader eyebrow="Operações" title={<>Ho<span className="accent">je</span></>}>
        <p className="muted" style={{ marginTop: 6, textTransform: "none" }}>{dataLonga.charAt(0).toUpperCase() + dataLonga.slice(1)} · o que fazer, para quem e até quando.</p>
      </PageHeader>

      <div className="mt-kpis" role="list" aria-label="Contadores">
        <a role="listitem" href="#atrasadas" className={`kpi ${fila.contadores.atrasadas ? "alerta" : ""}`}><div className="label">Atrasadas</div><div className="value">{fila.contadores.atrasadas}</div></a>
        <a role="listitem" href="#hoje" className={`kpi ${fila.contadores.hoje ? "atencao" : ""}`}><div className="label">Para hoje</div><div className="value">{fila.contadores.hoje}</div></a>
        <a role="listitem" href="#semana" className="kpi"><div className="label">Próximos 7 dias</div><div className="value">{fila.contadores.semana}</div></a>
        <a role="listitem" href="#cliente" className="kpi"><div className="label">Com o cliente</div><div className="value">{fila.contadores.bloqueadas}</div></a>
        <div role="listitem" className={`kpi ${fila.contadores.concluidasHoje ? "feito" : ""}`}><div className="label">Concluídas hoje</div><div className="value">{fila.contadores.concluidasHoje}</div></div>
      </div>

      {(aprov.pendentes > 0 || aprov.ajustes > 0 || (rasc?.n ?? 0) > 0) && (
        <p className="small" style={{ margin: "10px 0 0" }}>
          <Link href="/operacoes/aprovacoes">Aprovações: {aprov.pendentes} com o cliente{aprov.ajustes ? `, ${aprov.ajustes} ajuste(s) pedido(s)` : ""}</Link>
          {(rasc?.n ?? 0) > 0 && <> · <Link href="/operacoes/relatorios">{rasc.n} relatório(s) semanal(is) para revisar</Link></>}
        </p>
      )}

      <form className="mt-filtros card" method="get" aria-label="Filtros" style={{ padding: 14 }}>
        <div className="field"><label htmlFor="f-resp">Responsável</label>
          <select id="f-resp" name="resp" defaultValue={respParam}>
            {meuId && <option value="eu">Eu</option>}
            <option value="todos">Toda a equipe</option>
            <option value="ninguem">Sem responsável</option>
            {equipe.filter((u) => u.id !== meuId).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="f-cli">Cliente</label>
          <select id="f-cli" name="cli" defaultValue={cliente}><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="f-dep">Departamento</label>
          <select id="f-dep" name="dep" defaultValue={dep}><option value="">Todos</option>{(Object.keys(ROTULO_DEPARTAMENTO) as Departamento[]).map((k) => <option key={k} value={k}>{ROTULO_DEPARTAMENTO[k]}</option>)}</select>
        </div>
        <div className="btns"><button className="btn btn-sm">Filtrar</button>{q.size > 0 && <Link className="btn btn-sm btn-ghost" href="/operacoes">Limpar</Link>}</div>
      </form>

      {!pode && <div className="notice" role="note" style={{ marginTop: 12 }}>Acesso de revisão: você vê a fila, mas não altera as ações.</div>}
      {total === 0 && (
        <div className="empty" style={{ marginTop: 18 }}>
          Nada pendente com esses filtros. {respParam === "eu" ? <Link href="/operacoes?resp=todos">Ver a fila de toda a equipe</Link> : null}
        </div>
      )}
      <Secao id="atrasadas" titulo="Atrasadas" itens={fila.atrasadas} />
      <Secao id="hoje" titulo="Para hoje" itens={fila.hoje} vazio={total ? "Nada vence hoje." : undefined} />
      <Secao id="semana" titulo="Próximos 7 dias" itens={fila.semana} />
      <Secao id="cliente" titulo="Esperando o cliente" itens={fila.bloqueadas} />
    </>
  );
}
