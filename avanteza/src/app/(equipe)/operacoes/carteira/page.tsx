// Operações → Carteira: um cartão por cliente com o semáforo de saúde, os motivos, os próximos marcos e o responsável.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canUseApp } from "@/lib/session";
import { spDate } from "@/lib/dates";
import { fmtDate } from "@/lib/mapa/progress";
import { PageHeader } from "@/components/shell/GlassCard";
import { Semaforo } from "@/components/motor/Semaforo";
import { podeVerMotor } from "@/lib/motor/acesso";
import { carteira } from "@/lib/motor/repo";
import { ordenarPorRisco } from "@/lib/motor/saude";
import "@/components/motor/motor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Carteira — Operações — Avanteza" };

export default async function Carteira() {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const hoje = spDate();
  const cartoes = ordenarPorRisco(await carteira(hoje));
  const n = { vermelho: 0, amarelo: 0, verde: 0 };
  for (const c of cartoes) n[c.saude.nivel]++;
  const link = canUseApp(sess, "marketplaces");
  return (
    <>
      <PageHeader eyebrow="Operações" title={<>Car<span className="accent">teira</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>Saúde de cada cliente pelas entregas, reuniões e canais. Os em risco vêm primeiro.</p>
      </PageHeader>
      <div className="mt-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className={`kpi ${n.vermelho ? "alerta" : ""}`}><div className="label">Em risco</div><div className="value">{n.vermelho}</div></div>
        <div className={`kpi ${n.amarelo ? "atencao" : ""}`}><div className="label">Atenção</div><div className="value">{n.amarelo}</div></div>
        <div className="kpi feito"><div className="label">Em dia</div><div className="value">{n.verde}</div></div>
      </div>
      {cartoes.length === 0 && <div className="empty" style={{ marginTop: 16 }}>Nenhum cliente ativo.</div>}
      <div className="mt-carteira">
        {cartoes.map((c) => (
          <article key={c.id} className={`card mt-cli ${c.saude.nivel}`} aria-label={`${c.nome}: ${c.saude.nivel}`}>
            <div className="row">
              <h3>{link ? <Link href={`/clientes/${c.id}?aba=entregas`}>{c.nome}</Link> : c.nome}</h3>
              <Semaforo nivel={c.saude.nivel} />
            </div>
            <div className="small muted">{c.servicos.length ? c.servicos.join(" · ") : "Sem serviços cadastrados"} · {c.gerente ? `responsável: ${c.gerente}` : "sem responsável"}</div>
            {c.saude.motivos.length > 0 ? <ul>{c.saude.motivos.map((m) => <li key={m}>{m}</li>)}</ul> : <div className="small" style={{ color: "var(--ok)" }}>Tudo em dia.</div>}
            <div className="nums">
              <div><b>{c.saude.metricas.pctPlano}%</b><span>do plano</span></div>
              <div><b className={c.saude.metricas.atrasadas ? "late" : undefined}>{c.saude.metricas.atrasadas}</b><span>atrasadas</span></div>
              <div><b>{c.saude.metricas.diasSemReuniao ?? "—"}</b><span>dias s/ reunião</span></div>
            </div>
            <div className="progress thin" role="progressbar" aria-valuenow={c.saude.metricas.pctPlano} aria-valuemin={0} aria-valuemax={100} aria-label="Andamento do plano"><span style={{ width: `${c.saude.metricas.pctPlano}%` }} /></div>
            {c.proximos.length > 0 && (
              <div>
                <div className="small muted" style={{ fontWeight: 700 }}>Próximos marcos</div>
                <ul className="marcos">{c.proximos.map((p, i) => <li key={i}><span>{p.title}</span><span className={p.atrasada ? "late" : undefined}>{fmtDate(p.due_date)}</span></li>)}</ul>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: "auto" }}>
              <Link className="btn btn-sm btn-ghost" href={`/operacoes?resp=todos&cli=${c.id}`}>Fila do cliente</Link>
              {link && <Link className="btn btn-sm btn-ghost" href={`/clientes/${c.id}?aba=entregas`}>Entregas</Link>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
