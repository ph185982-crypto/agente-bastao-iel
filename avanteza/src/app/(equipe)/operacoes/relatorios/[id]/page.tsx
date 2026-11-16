// Operações → revisão de um relatório semanal: prévia igual à do cliente, edição da abertura e dos destaques, publicar ou descartar.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { RelatorioView } from "@/components/relatorios/RelatorioView";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import { relatorioEquipe } from "@/lib/relatorios/gerar";
import { fmtPeriodo } from "@/lib/relatorios/semana";
import { rotuloPublicacao } from "@/lib/relatorios/rotulos";
import { descartarRelatorioForm, publicarRelatorioForm, salvarRevisaoForm } from "../../aprovacoes/actions";
import "@/components/aprovacoes/aprovacoes.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revisar relatório — Operações — Avanteza" };

export default async function RevisarRelatorio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const { id } = await params;
  const sp = await searchParams;
  const r = await relatorioEquipe(id);
  if (!r) notFound();
  const pode = podeTrabalharMotor(sess);
  const rascunho = r.status === "rascunho";
  return (
    <>
      <Flash sp={sp} />
      <PageHeader eyebrow={`Relatórios · ${r.client_name}`} title={<>Semana de {fmtPeriodo(r.semana, r.periodo_fim)}</>}
        actions={<div className="rs-acoes"><a className="btn btn-sm btn-ghost" href={`/operacoes/relatorios/${r.id}/pdf`} target="_blank" rel="noopener">Ver PDF</a><Link className="btn btn-sm btn-ghost" href={`/clientes/${r.client_id}?aba=comunicacao`}>Ficha do cliente</Link></div>}>
        <p className="muted" style={{ marginTop: 6, textTransform: "none" }}>{rotuloPublicacao(r)}{!r.contact_email ? " · cliente sem e-mail de contato (só no Mapa)" : ""}</p>
      </PageHeader>

      {rascunho && pode && (
        <form action={salvarRevisaoForm} className="card" aria-label="Revisão" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={r.id} />
          <h3 style={{ marginTop: 0 }}>Revisão da equipe</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Abertura gerada {r.abertura_origem === "ia" ? "pela IA" : r.abertura_origem === "equipe" ? `e revisada por ${r.revisado_por}` : "pelo modelo fixo (sem chave de IA)"}. Os números e as listas vêm do sistema e não são editáveis aqui.</p>
          <div className="field"><label htmlFor="rv-ab">Texto de abertura</label><textarea id="rv-ab" name="abertura" required minLength={10} maxLength={2000} defaultValue={r.abertura} style={{ minHeight: 110 }} /></div>
          <div className="field"><label htmlFor="rv-dq">Destaques (um por linha, até 5)</label><textarea id="rv-dq" name="destaques" maxLength={1200} defaultValue={(r.destaques ?? []).join("\n")} /></div>
          <div className="rs-acoes" style={{ marginTop: 12 }}>
            <button className="btn btn-orange btn-sm" name="publicar" value="1">Salvar e publicar</button>
            <Submit className="btn btn-sm">Salvar revisão</Submit>
          </div>
        </form>
      )}
      {rascunho && pode && (
        <div className="rs-acoes" style={{ marginTop: 10 }}>
          <form action={publicarRelatorioForm}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-sm btn-ghost">Publicar como está</Submit></form>
          <form action={descartarRelatorioForm}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-sm btn-danger" confirm="Descartar este relatório? Ele não vai para o cliente.">Descartar</Submit></form>
        </div>
      )}

      <h2>Prévia (como o cliente vê)</h2>
      <RelatorioView dados={r.dados} abertura={r.abertura} destaques={r.destaques ?? []} />
    </>
  );
}
