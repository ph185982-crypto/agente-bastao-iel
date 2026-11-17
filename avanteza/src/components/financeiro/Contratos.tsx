import { Submit } from "@/components/Submit";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl, inteiro } from "@/lib/dashboards/format";
import { ddmmaa } from "@/lib/financeiro/periodo";
import type { Contrato } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos } from "./Comum";

export function Contratos({ f, escopo, podeEscrever, voltar }: { f: Fonte<Contrato[]>; escopo: EscopoFin; podeEscrever: boolean; voltar: string }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const lista = f.dados;
  const ativos = lista.filter((c) => c.status === "ativo");
  const mrr = ativos.filter((c) => c.modo === "recorrente").reduce((a, c) => a + c.valor_parcela, 0);
  const aReceber = ativos.reduce((a, c) => a + c.parcelas.abertas.total, 0);
  if (lista.length === 0) return <div className="empty" role="status" style={{ marginTop: 14 }}>Nenhum contrato de receita. Crie uma receita recorrente ou parcelada em “A receber”.</div>;
  return (
    <>
      <div className="grid kpis auto" style={{ marginTop: 14 }}>
        <div className="kpi dkpi"><div className="label">Ativos</div><div className="value">{inteiro(ativos.length)}</div><div className="small muted">de {inteiro(lista.length)} contratos</div></div>
        <div className="kpi dkpi"><div className="label">Recorrente por mês</div><div className="value">{brl(mrr)}</div></div>
        <div className="kpi dkpi"><div className="label">Parcelas a receber</div><div className="value">{brl(aReceber)}</div><div className="small muted">dos contratos ativos</div></div>
      </div>
      <div className="grid three" style={{ marginTop: 14 }}>
        {lista.map((c) => {
          const rec = c.parcelas.recebidas.quantidade, ab = c.parcelas.abertas.quantidade, per = c.parcelas.perdidas.quantidade;
          const tot = rec + ab + per;
          return (
            <div key={c.id} className="card">
              <div className="row"><h3>{c.descricao}</h3><span className={`pill ${c.status === "ativo" ? "pill-ok" : "pill-outline"}`}>{c.status}</span></div>
              <p className="small muted" style={{ margin: "4px 0 10px" }}>{c.cliente || "Sem cliente"} · {c.modo === "recorrente" ? "recorrente" : "parcelado"} · dia {c.dia_vencimento} · desde {ddmmaa(c.data_inicio)}</p>
              <div className="dbig">{brl(c.valor_parcela, true)}<span className="small muted"> {c.modo === "recorrente" ? "/ mês" : "/ parcela"}</span></div>
              <div className="meta-bar" role="progressbar" aria-label="Parcelas recebidas" aria-valuemin={0} aria-valuemax={tot} aria-valuenow={rec}><span style={{ width: `${tot ? (rec / tot) * 100 : 0}%` }} /></div>
              <p className="small muted" style={{ margin: "6px 0 0" }}>{rec} recebidas ({brl(c.parcelas.recebidas.total)}) · {ab} em aberto ({brl(c.parcelas.abertas.total)}){per ? ` · ${per} perdidas` : ""}</p>
              {podeEscrever && c.status === "ativo" && (
                <details className="mini" style={{ marginTop: 10 }}><summary>Encerrar contrato</summary>
                  <form action={fin} className="fgrid mini-form">
                    <Ocultos op="contrato.encerrar" escopo={escopo} id={c.id} voltar={voltar} />
                    <div className="field wide"><label>Motivo (opcional)</label><input name="motivo" maxLength={300} /></div>
                    <Submit className="btn btn-danger btn-sm" confirm="Encerrar o contrato? As parcelas futuras em aberto viram perdidas.">Encerrar</Submit>
                  </form>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
