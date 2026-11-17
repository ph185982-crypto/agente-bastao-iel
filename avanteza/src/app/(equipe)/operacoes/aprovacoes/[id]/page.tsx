// Operações → uma peça: versão atual, histórico de comentários e decisões, nova versão, comentário e cancelamento.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { dt } from "@/lib/format";
import { fmtDate } from "@/lib/mapa/progress";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import { arquivosDoCliente, detalheEquipe } from "@/lib/aprovacoes/equipe";
import { aprovacaoAtrasada, ROTULO_EVENTO, ROTULO_STATUS_APROVACAO, ROTULO_TIPO_PECA, type StatusAprovacao, type TipoEventoAprovacao, type TipoPeca } from "@/lib/aprovacoes/tipos";
import { cancelarAprovacaoForm, comentarAprovacaoForm, novaVersaoForm } from "../actions";
import "@/components/aprovacoes/aprovacoes.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aprovação — Operações — Avanteza" };

export default async function AprovacaoEquipe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const { id } = await params;
  const sp = await searchParams;
  const r = await detalheEquipe(id);
  if (!r) notFound();
  const { aprovacao: a, versoes, eventos, acao } = r;
  const pode = podeTrabalharMotor(sess);
  const aberta = a.status === "pendente" || a.status === "ajuste";
  const arquivos = pode && aberta ? await arquivosDoCliente(a.client_id) : [];
  const atrasada = aprovacaoAtrasada(a, spDate());
  return (
    <>
      <Flash sp={sp} />
      <PageHeader eyebrow={`Aprovações · ${a.client_name}`} title={a.titulo}
        actions={<Link className="btn btn-sm btn-ghost" href={`/clientes/${a.client_id}?aba=comunicacao`}>Ficha do cliente</Link>} />
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <span className={`pill ${atrasada ? "pill-danger" : a.status === "pendente" ? "pill-orange" : a.status === "aprovada" ? "pill-ok" : a.status === "ajuste" ? "pill-sand" : "pill-outline"}`}>
            {atrasada ? "Atrasada com o cliente" : ROTULO_STATUS_APROVACAO[a.status as StatusAprovacao]}
          </span>
          <span className="small muted">{ROTULO_TIPO_PECA[a.tipo as TipoPeca] ?? a.tipo} · versão {a.versao_atual}{a.prazo ? ` · prazo ${fmtDate(a.prazo)}` : ""} · enviada por {a.criado_por}</span>
        </div>
        {a.descricao && <p style={{ marginBottom: 0 }}>{a.descricao}</p>}
        <div className="ap-peca">
          {a.link && <a className="btn btn-sm btn-ghost" href={a.link} target="_blank" rel="noopener noreferrer">Abrir a versão {a.versao_atual} ↗</a>}
          {acao && <span className="small muted">Tarefa ligada: <strong>{acao.title}</strong> ({acao.status === "concluida" ? "concluída" : "aberta"}) — aprovar conclui.</span>}
          {a.ajuste_action_id && <span className="small muted">Ajuste com: <strong>{a.ajuste_responsavel ?? "sem responsável"}</strong> (está na fila do Hoje).</span>}
        </div>
      </div>

      {pode && aberta && (
        <div className="grid two" style={{ marginTop: 14 }}>
          <form action={novaVersaoForm} className="card" aria-label="Nova versão" style={{ marginTop: 0 }}>
            <input type="hidden" name="id" value={a.id} />
            <h3 style={{ marginTop: 0 }}>Enviar nova versão</h3>
            <p className="small muted" style={{ marginTop: 0 }}>Volta para “aguardando o cliente” e conclui a ação de ajuste.</p>
            <div className="field"><label htmlFor="nv-link">Link</label><input id="nv-link" name="link" type="url" maxLength={2000} placeholder="https://…" /></div>
            <div className="field"><label htmlFor="nv-arq">ou arquivo do cliente</label><select id="nv-arq" name="arquivo_id" defaultValue=""><option value="">— nenhum —</option>{arquivos.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></div>
            <div className="field"><label htmlFor="nv-nota">O que mudou (o cliente vê)</label><textarea id="nv-nota" name="nota" maxLength={1000} style={{ minHeight: 70 }} /></div>
            <div style={{ marginTop: 10 }}><Submit className="btn btn-orange btn-sm">Enviar versão {a.versao_atual + 1}</Submit></div>
          </form>
          <div className="card" style={{ marginTop: 0 }}>
            <form action={comentarAprovacaoForm} aria-label="Comentar">
              <input type="hidden" name="id" value={a.id} />
              <h3 style={{ marginTop: 0 }}>Comentar</h3>
              <div className="field"><label htmlFor="cm-t" className="sr">Comentário</label><textarea id="cm-t" name="texto" required minLength={2} maxLength={2000} placeholder="O cliente vê este comentário no histórico." style={{ minHeight: 70 }} /></div>
              <div style={{ marginTop: 10 }}><Submit className="btn btn-sm">Comentar</Submit></div>
            </form>
            <form action={cancelarAprovacaoForm} aria-label="Cancelar" style={{ marginTop: 16, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
              <input type="hidden" name="id" value={a.id} />
              <div className="field"><label htmlFor="cc-m">Cancelar a aprovação (some do Mapa)</label><input id="cc-m" name="motivo" maxLength={500} placeholder="Motivo (opcional)" /></div>
              <div style={{ marginTop: 10 }}><Submit className="btn btn-sm btn-danger" confirm="Cancelar esta aprovação?">Cancelar aprovação</Submit></div>
            </form>
          </div>
        </div>
      )}

      <h2>Histórico</h2>
      <div className="card">
        <ul className="ap-hist">
          {eventos.map((e, i) => (
            <li key={i} className={`${e.autor_tipo === "cliente" ? "cliente" : ""} ${e.tipo === "aprovada" ? "aprovada" : ""}`}>
              <span className="quem">{e.autor_tipo === "cliente" ? `Cliente (${e.autor})` : e.autor}</span> · {ROTULO_EVENTO[e.tipo as TipoEventoAprovacao] ?? e.tipo}
              <span className="small muted"> (versão {e.versao}) · {dt(e.criado_em)}</span>
              {e.texto && <div className="txt">{e.texto}</div>}
            </li>
          ))}
        </ul>
      </div>

      <h2>Versões</h2>
      <div className="card">
        <ul className="list">
          {versoes.map((v) => (
            <li key={v.numero} className="row" style={{ padding: "8px 0" }}>
              <span>Versão {v.numero} <span className="small muted">· {v.criado_por} · {dt(v.criado_em)}</span>{v.nota ? <div className="small muted">{v.nota}</div> : null}</span>
              <a className="small" href={v.link} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
