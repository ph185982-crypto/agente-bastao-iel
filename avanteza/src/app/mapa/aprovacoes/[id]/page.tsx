// Mapa → uma peça para aprovar: versão atual, versões anteriores, histórico de comentários e a decisão (aprovar / pedir ajuste).
// "Ver como cliente" (equipe) é somente leitura: os formulários não aparecem e a escrita recusa o escopo.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMapa } from "@/lib/mapa/auth";
import { obterAprovacao } from "@/lib/mapa/aprovacoes";
import { decidirMinhaAprovacao } from "@/app/mapa/actions";
import { spDate } from "@/lib/dates";
import { dt } from "@/lib/format";
import { fmtDate } from "@/lib/mapa/progress";
import { aprovacaoAtrasada, ROTULO_EVENTO, ROTULO_STATUS_APROVACAO, ROTULO_TIPO_PECA, type StatusAprovacao, type TipoEventoAprovacao, type TipoPeca } from "@/lib/aprovacoes/tipos";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import "@/components/aprovacoes/aprovacoes.css";

export const dynamic = "force-dynamic";

export default async function Peca({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { scope } = await requireMapa();
  const { id } = await params;
  const sp = await searchParams;
  const r = await obterAprovacao(scope, id);
  if (!r) notFound();
  const { aprovacao: a, versoes, historico } = r;
  const hoje = spDate();
  const atrasada = aprovacaoAtrasada(a, hoje);
  return (
    <>
      <Flash sp={sp} />
      <div className="eyebrow"><Link href="/mapa/aprovacoes" style={{ textDecoration: "none" }}>Para aprovar</Link> / {ROTULO_TIPO_PECA[a.tipo as TipoPeca] ?? a.tipo}</div>
      <h1>{a.titulo}</h1>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <span className={`pill ${a.status === "pendente" ? "pill-orange" : a.status === "aprovada" ? "pill-ok" : "pill-outline"}`}>{ROTULO_STATUS_APROVACAO[a.status as StatusAprovacao]}</span>
          <span className={`small ${atrasada ? "late" : "muted"}`}>Versão {a.versao_atual}{a.prazo ? ` · ${atrasada ? "atrasada, prazo" : "prazo"} ${fmtDate(a.prazo)}` : ""}</span>
        </div>
        {a.descricao && <p style={{ marginBottom: 0 }}>{a.descricao}</p>}
        {a.nota && <p className="small muted" style={{ marginBottom: 0 }}>Nota da equipe nesta versão: {a.nota}</p>}
        {a.link && (
          <div className="ap-peca">
            <a className="btn btn-sm btn-ghost" href={a.link} target="_blank" rel="noopener noreferrer">Abrir a peça (versão {a.versao_atual}) ↗</a>
          </div>
        )}
        {a.status === "pendente" && !scope.readOnly && (
          <div className="ap-decidir">
            <form action={decidirMinhaAprovacao} className="aprovar" aria-label="Aprovar">
              <input type="hidden" name="aprovacao_id" value={a.id} /><input type="hidden" name="decisao" value="aprovar" />
              <strong>Está tudo certo?</strong>
              <label className="sr" htmlFor="c-ok">Comentário (opcional)</label>
              <textarea id="c-ok" name="comentario" placeholder="Comentário (opcional)" maxLength={2000} />
              <Submit className="btn btn-orange">Aprovar versão {a.versao_atual}</Submit>
            </form>
            <form action={decidirMinhaAprovacao} aria-label="Pedir ajuste">
              <input type="hidden" name="aprovacao_id" value={a.id} /><input type="hidden" name="decisao" value="ajuste" />
              <strong>Precisa mudar algo?</strong>
              <label className="sr" htmlFor="c-aj">O que precisa mudar</label>
              <textarea id="c-aj" name="comentario" required minLength={3} placeholder="Conte o que precisa mudar (obrigatório)" maxLength={2000} />
              <Submit className="btn btn-ghost">Pedir ajuste</Submit>
            </form>
          </div>
        )}
        {a.status === "pendente" && scope.readOnly && <p className="small muted" style={{ marginBottom: 0 }}>Visualização somente leitura: o cliente aprova ou pede ajuste aqui.</p>}
        {a.status === "ajuste" && <p className="small" style={{ marginBottom: 0 }}>Você pediu um ajuste. A equipe está trabalhando numa nova versão e ela aparece aqui para você aprovar.</p>}
      </div>

      <h2>Histórico</h2>
      <div className="card">
        <ul className="ap-hist">
          {historico.map((h, i) => (
            <li key={i} className={`${h.quem === "Você" ? "cliente" : ""} ${h.tipo === "aprovada" ? "aprovada" : ""}`}>
              <span className="quem">{h.quem}</span> · {ROTULO_EVENTO[h.tipo as TipoEventoAprovacao] ?? h.tipo} <span className="small muted">(versão {h.versao}) · {dt(h.criado_em)}</span>
              {h.texto && <div className="txt">{h.texto}</div>}
            </li>
          ))}
        </ul>
      </div>

      {versoes.length > 1 && (
        <>
          <h2>Versões</h2>
          <div className="card">
            <ul className="list">
              {versoes.map((v) => (
                <li key={v.numero} className="row" style={{ padding: "8px 0" }}>
                  <span>Versão {v.numero} <span className="small muted">· {dt(v.criado_em)}</span>{v.nota ? <div className="small muted">{v.nota}</div> : null}</span>
                  <a className="small" href={v.link} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
