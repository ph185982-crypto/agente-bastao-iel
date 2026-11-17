// Mapa → Para aprovar: peças que a equipe enviou (criativos, posts, legendas, calendário, contratos de mídia, relatórios).
import Link from "next/link";
import { requireMapa } from "@/lib/mapa/auth";
import { listarAprovacoes } from "@/lib/mapa/aprovacoes";
import { spDate } from "@/lib/dates";
import { fmtDate } from "@/lib/mapa/progress";
import { aprovacaoAtrasada, ROTULO_STATUS_APROVACAO, ROTULO_TIPO_PECA, type StatusAprovacao, type TipoPeca } from "@/lib/aprovacoes/tipos";
import { Flash } from "@/components/Flash";
import "@/components/aprovacoes/aprovacoes.css";

export const dynamic = "force-dynamic";

export default async function ParaAprovar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { scope } = await requireMapa();
  const sp = await searchParams;
  const hoje = spDate();
  const todas = await listarAprovacoes(scope);
  const pendentes = todas.filter((a) => a.status === "pendente");
  const outras = todas.filter((a) => a.status !== "pendente");
  const Item = ({ a }: { a: (typeof todas)[number] }) => {
    const atrasada = aprovacaoAtrasada(a, hoje);
    return (
      <Link href={`/mapa/aprovacoes/${a.id}`} className={`ap-item ${atrasada ? "atrasada" : a.status}`}>
        <div className="ap-main">
          <div className="tit">{a.titulo}</div>
          <div className="meta">
            <span>{ROTULO_TIPO_PECA[a.tipo as TipoPeca] ?? a.tipo}</span>
            <span>Versão {a.versao_atual}</span>
            {a.prazo && <span className={atrasada ? "late" : ""}>{atrasada ? "Atrasada, prazo " : "Prazo "}{fmtDate(a.prazo)}</span>}
          </div>
        </div>
        <div className="lado">
          <span className={`pill ${a.status === "pendente" ? "pill-orange" : a.status === "aprovada" ? "pill-ok" : "pill-outline"}`}>{ROTULO_STATUS_APROVACAO[a.status as StatusAprovacao]}</span>
          <span className="small muted">Abrir ›</span>
        </div>
      </Link>
    );
  };
  return (
    <>
      <Flash sp={sp} />
      <div className="eyebrow">Aprovações</div>
      <h1>Para <span className="accent">aprovar</span></h1>
      <p className="muted" style={{ marginTop: 4 }}>Peças que a equipe preparou para você. Abra, confira e aprove ou peça um ajuste com um comentário.</p>
      <h2>Aguardando você {pendentes.length > 0 && <span className="pill pill-orange">{pendentes.length}</span>}</h2>
      {pendentes.length === 0 ? <div className="empty">Nada para aprovar agora. Quando a equipe enviar uma peça, ela aparece aqui.</div> : (
        <div className="ap-lista">{pendentes.map((a) => <Item key={a.id} a={a} />)}</div>
      )}
      {outras.length > 0 && (
        <>
          <h2>Histórico</h2>
          <div className="ap-lista">{outras.map((a) => <Item key={a.id} a={a} />)}</div>
        </>
      )}
    </>
  );
}
