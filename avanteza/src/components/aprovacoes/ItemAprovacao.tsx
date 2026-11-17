// Item da fila de aprovações da equipe (Operações → Aprovações e ficha do cliente).
import Link from "next/link";
import { dt } from "@/lib/format";
import { fmtDate } from "@/lib/mapa/progress";
import type { AprovacaoLinha } from "@/lib/aprovacoes/equipe";
import { aprovacaoAtrasada, ROTULO_STATUS_APROVACAO, ROTULO_TIPO_PECA, type StatusAprovacao, type TipoPeca } from "@/lib/aprovacoes/tipos";

export function ItemAprovacao({ a, hoje, mostrarCliente = true }: { a: AprovacaoLinha; hoje: string; mostrarCliente?: boolean }) {
  const atrasada = aprovacaoAtrasada(a, hoje);
  return (
    <Link href={`/operacoes/aprovacoes/${a.id}`} className={`ap-item ${atrasada ? "atrasada" : a.status}`}>
      <div className="ap-main">
        {mostrarCliente && <div className="cli">{a.client_name}</div>}
        <div className="tit">{a.titulo}</div>
        <div className="meta">
          <span>{ROTULO_TIPO_PECA[a.tipo as TipoPeca] ?? a.tipo}</span>
          <span>Versão {a.versao_atual}</span>
          {a.prazo && <span className={atrasada ? "late" : ""}>{atrasada ? "Atrasada, prazo " : "Prazo "}{fmtDate(a.prazo)}</span>}
          {a.status === "ajuste" && <span>Com {a.ajuste_responsavel ?? "ninguém (sem responsável)"}</span>}
          {a.status !== "pendente" && a.status !== "ajuste" && a.decidido_em && <span>{dt(a.decidido_em)}</span>}
        </div>
        {a.status === "ajuste" && a.ultimo_comentario && <div className="small" style={{ marginTop: 6 }}>“{a.ultimo_comentario.slice(0, 180)}{a.ultimo_comentario.length > 180 ? "…" : ""}”</div>}
      </div>
      <div className="lado">
        <span className={`pill ${atrasada ? "pill-danger" : a.status === "pendente" ? "pill-orange" : a.status === "aprovada" ? "pill-ok" : a.status === "ajuste" ? "pill-sand" : "pill-outline"}`}>
          {atrasada ? "Atrasada" : a.status === "pendente" ? "Com o cliente" : ROTULO_STATUS_APROVACAO[a.status as StatusAprovacao]}
        </span>
      </div>
    </Link>
  );
}
