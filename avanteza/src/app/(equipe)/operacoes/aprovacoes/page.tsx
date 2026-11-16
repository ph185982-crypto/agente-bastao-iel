// Operações → Aprovações: fila das peças enviadas aos clientes (aguardando, atrasadas, ajustes pedidos) e envio de peça nova.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { FormNovaPeca } from "@/components/aprovacoes/FormNovaPeca";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import { clientesAtivos, isUuid } from "@/lib/motor/repo";
import { arquivosDoCliente, filaEquipe, tarefasLigaveis, type AprovacaoLinha } from "@/lib/aprovacoes/equipe";
import { aprovacaoAtrasada } from "@/lib/aprovacoes/tipos";
import { ItemAprovacao } from "@/components/aprovacoes/ItemAprovacao";
import "@/components/aprovacoes/aprovacoes.css";
import "@/components/motor/motor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aprovações — Operações — Avanteza" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function Aprovacoes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const hoje = spDate();
  const cli = isUuid(one(sp.cli)) ? one(sp.cli) : "";
  const [clientes, fila, tarefas, arquivos] = await Promise.all([
    clientesAtivos(), filaEquipe({ clientId: cli || null }), cli ? tarefasLigaveis(cli) : Promise.resolve([]), cli ? arquivosDoCliente(cli) : Promise.resolve([]),
  ]);
  const pode = podeTrabalharMotor(sess);
  const atrasadas = fila.pendentes.filter((a) => aprovacaoAtrasada(a, hoje));
  const porCliente = new Map<string, AprovacaoLinha[]>();
  for (const a of fila.pendentes) (porCliente.get(a.client_name) ?? porCliente.set(a.client_name, []).get(a.client_name)!).push(a);
  const aprovadas = fila.recentes.filter((a) => a.status === "aprovada").length;

  return (
    <>
      <Flash sp={sp} />
      <PageHeader eyebrow="Operações" title={<>Aprova<span className="accent">ções</span></>}>
        <p className="muted" style={{ marginTop: 6, textTransform: "none" }}>Peças enviadas aos clientes pelo Mapa: o que está com eles, o que atrasou e os ajustes pedidos.</p>
      </PageHeader>

      <div className="mt-kpis" role="list" aria-label="Contadores">
        <a role="listitem" href="#cliente" className={`kpi ${fila.pendentes.length ? "atencao" : ""}`}><div className="label">Com o cliente</div><div className="value">{fila.pendentes.length}</div></a>
        <a role="listitem" href="#cliente" className={`kpi ${atrasadas.length ? "alerta" : ""}`}><div className="label">Atrasadas</div><div className="value">{atrasadas.length}</div></a>
        <a role="listitem" href="#ajustes" className={`kpi ${fila.ajustes.length ? "alerta" : ""}`}><div className="label">Ajustes pedidos</div><div className="value">{fila.ajustes.length}</div></a>
        <a role="listitem" href="#recentes" className={`kpi ${aprovadas ? "feito" : ""}`}><div className="label">Aprovadas (30 dias)</div><div className="value">{aprovadas}</div></a>
        <Link role="listitem" href="/operacoes/relatorios" className="kpi"><div className="label">Relatórios</div><div className="value" style={{ fontSize: 15, marginTop: 8 }}>Revisar ›</div></Link>
      </div>

      <form className="mt-filtros card" method="get" aria-label="Filtro" style={{ padding: 14 }}>
        <div className="field"><label htmlFor="f-cli">Cliente</label>
          <select id="f-cli" name="cli" defaultValue={cli}><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <div className="btns"><button className="btn btn-sm">Filtrar</button>{cli && <Link className="btn btn-sm btn-ghost" href="/operacoes/aprovacoes">Limpar</Link>}</div>
      </form>

      {pode && (
        <details className="card" style={{ marginTop: 14 }} open={Boolean(cli) && one(sp.novo) === "1"}>
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>Enviar peça para aprovação</summary>
          <div style={{ marginTop: 12 }}>
            {!cli ? (
              <form method="get" className="ap-form" aria-label="Escolher cliente">
                <input type="hidden" name="novo" value="1" />
                <div className="field"><label htmlFor="n-cli">Cliente</label><select id="n-cli" name="cli" required defaultValue="">{[<option key="" value="" disabled>Escolha…</option>, ...clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</select></div>
                <div><button className="btn btn-sm">Continuar</button></div>
              </form>
            ) : (
              <FormNovaPeca clientId={cli} tarefas={tarefas} arquivos={arquivos} back={`/operacoes/aprovacoes?cli=${cli}`} />
            )}
          </div>
        </details>
      )}

      <section className="mt-sec" id="ajustes" aria-label="Ajustes pedidos">
        <h2>Ajustes pedidos <span className="n">{fila.ajustes.length}</span></h2>
        {fila.ajustes.length === 0 ? <div className="empty">Nenhum ajuste pendente.</div> : <div className="ap-lista">{fila.ajustes.map((a) => <ItemAprovacao key={a.id} a={a} hoje={hoje} />)}</div>}
      </section>

      <section className="mt-sec" id="cliente" aria-label="Com o cliente">
        <h2>Com o cliente <span className="n">{fila.pendentes.length}</span></h2>
        {fila.pendentes.length === 0 ? <div className="empty">Nenhuma peça aguardando aprovação.</div> : (
          [...porCliente.entries()].map(([nome, itens]) => (
            <div key={nome} style={{ marginTop: 12 }}>
              <div className="row"><h3 style={{ margin: 0 }}>{nome}</h3><span className="small muted">{itens.length} pendente(s){itens.some((a) => aprovacaoAtrasada(a, hoje)) ? ` · ${itens.filter((a) => aprovacaoAtrasada(a, hoje)).length} atrasada(s)` : ""}</span></div>
              <div className="ap-lista">{itens.map((a) => <ItemAprovacao key={a.id} a={a} hoje={hoje} mostrarCliente={false} />)}</div>
            </div>
          ))
        )}
      </section>

      {fila.recentes.length > 0 && (
        <section className="mt-sec" id="recentes" aria-label="Decididas recentemente">
          <h2>Decididas nos últimos 30 dias <span className="n">{fila.recentes.length}</span></h2>
          <div className="ap-lista">{fila.recentes.map((a) => <ItemAprovacao key={a.id} a={a} hoje={hoje} />)}</div>
        </section>
      )}
    </>
  );
}
