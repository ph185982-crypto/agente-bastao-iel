// Operações → Relatórios semanais: rascunhos gerados na segunda (revisar e publicar, ou publicam sozinhos no prazo) e histórico.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { podeEditarPlaybooks, podeVerMotor } from "@/lib/motor/acesso";
import { relatoriosParaEquipe, type RelatorioLinha } from "@/lib/relatorios/gerar";
import { fmtPeriodo } from "@/lib/relatorios/semana";
import { rotuloPublicacao } from "@/lib/relatorios/rotulos";
import { gerarRelatoriosAgoraForm } from "../aprovacoes/actions";
import "@/components/aprovacoes/aprovacoes.css";
import "@/components/motor/motor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatórios semanais — Operações — Avanteza" };

function Item({ r }: { r: RelatorioLinha }) {
  return (
    <Link href={`/operacoes/relatorios/${r.id}`} className={`ap-item ${r.status === "rascunho" ? "pendente" : r.status === "publicado" ? "aprovada" : ""}`}>
      <div className="ap-main">
        <div className="cli">{r.client_name}</div>
        <div className="tit">Semana de {fmtPeriodo(r.semana, r.periodo_fim)}</div>
        <div className="meta"><span>{rotuloPublicacao(r)}</span><span>Abertura: {r.abertura_origem === "ia" ? "IA" : r.abertura_origem === "equipe" ? "revisada pela equipe" : "modelo"}</span></div>
      </div>
      <div className="lado"><span className={`pill ${r.status === "rascunho" ? "pill-orange" : r.status === "publicado" ? "pill-ok" : "pill-outline"}`}>{r.status === "rascunho" ? "Revisar" : r.status === "publicado" ? "Publicado" : "Descartado"}</span></div>
    </Link>
  );
}

export default async function Relatorios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const { rascunhos, recentes } = await relatoriosParaEquipe();
  return (
    <>
      <Flash sp={sp} />
      <PageHeader eyebrow="Operações" title={<>Relatórios <span className="accent">semanais</span></>}
        actions={podeEditarPlaybooks(sess) ? <form action={gerarRelatoriosAgoraForm}><Submit className="btn btn-sm btn-ghost">Gerar os da semana agora</Submit></form> : undefined}>
        <p className="muted" style={{ marginTop: 6, textTransform: "none" }}>Gerados toda segunda cedo. Revise e publique, ou deixe publicar sozinho no prazo de cada cliente (ficha → Aprovações e relatórios).</p>
      </PageHeader>
      <section className="mt-sec" aria-label="Para revisar">
        <h2>Para revisar <span className="n">{rascunhos.length}</span></h2>
        {rascunhos.length === 0 ? <div className="empty">Nenhum rascunho esperando revisão.</div> : <div className="ap-lista">{rascunhos.map((r) => <Item key={r.id} r={r} />)}</div>}
      </section>
      <section className="mt-sec" aria-label="Histórico">
        <h2>Histórico</h2>
        {recentes.length === 0 ? <div className="empty">Nenhum relatório publicado ainda.</div> : <div className="ap-lista">{recentes.map((r) => <Item key={r.id} r={r} />)}</div>}
      </section>
    </>
  );
}
