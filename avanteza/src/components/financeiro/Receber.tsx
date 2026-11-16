import { Submit } from "@/components/Submit";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl, inteiro } from "@/lib/dashboards/format";
import { ddmmaa } from "@/lib/financeiro/periodo";
import type { ListaReceitas, Receita } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos, destinoReclassificar, rotuloArea, soData } from "./Comum";

function Linha({ r, escopo, podeEscrever, podeReclassificar, voltar }: { r: Receita; escopo: EscopoFin; podeEscrever: boolean; podeReclassificar: boolean; voltar: string }) {
  const aberta = r.status === "pendente" || r.status === "atrasada";
  const rot = r.status === "recebida" ? "recebida" : r.status === "perdida" ? "perdida" : r.atrasada ? "atrasada" : "prevista";
  return (
    <tr>
      <td className={`nowrap ${r.atrasada ? "late" : ""}`}>{ddmmaa(r.data_prevista)}</td>
      <td className="ctitle">{r.descricao}{r.parcela_numero ? <> <span className="pill pill-outline">parcela {r.parcela_numero}{r.parcelas_total ? `/${r.parcelas_total}` : ""}</span></> : null}{r.motivo_perda && <div className="small muted">Motivo: {r.motivo_perda}</div>}</td>
      <td>{r.cliente || "—"}</td>
      <td><span className={`pill ${rot === "recebida" ? "pill-ok" : rot === "perdida" ? "pill-outline" : rot === "atrasada" ? "pill-danger" : "pill-navy"}`}>{rot}</span></td>
      <td className="num pos">{brl(r.valor, true)}</td>
      {podeEscrever && (
        <td>
          <div className="acoes">
            {aberta && <form action={fin}><Ocultos op="receita.baixar" escopo={escopo} id={r.id} voltar={voltar} /><Submit className="btn btn-sm" confirm="Confirmar o recebimento? A entrada é lançada no extrato.">Dar baixa</Submit></form>}
            {aberta && (
              <details className="mini"><summary>Editar</summary>
                <form action={fin} className="fgrid mini-form">
                  <Ocultos op="receita.editar" escopo={escopo} id={r.id} voltar={voltar} />
                  <div className="field wide"><label>Descrição</label><input name="descricao" defaultValue={r.descricao} required /></div>
                  <div className="field"><label>Valor</label><input name="valor" inputMode="decimal" defaultValue={String(r.valor).replace(".", ",")} required /></div>
                  <div className="field"><label>Data prevista</label><input name="data" type="date" defaultValue={soData(r.data_prevista)} required /></div>
                  <div className="field"><label>Cliente</label><input name="cliente" defaultValue={r.cliente ?? ""} /></div>
                  <Submit className="btn btn-orange btn-sm">Salvar</Submit>
                </form>
              </details>
            )}
            {aberta && podeReclassificar && <form action={fin}><Ocultos op="receita.reclassificar" escopo={escopo} id={r.id} voltar={voltar} para={destinoReclassificar(escopo)} /><Submit className="btn btn-ghost btn-sm" confirm={`Mover esta receita de ${rotuloArea(escopo)} para ${rotuloArea(destinoReclassificar(escopo))}?`}>Mover p/ {rotuloArea(destinoReclassificar(escopo))}</Submit></form>}
            {aberta && (
              <details className="mini"><summary>Perda</summary>
                <form action={fin} className="fgrid mini-form">
                  <Ocultos op="receita.perder" escopo={escopo} id={r.id} voltar={voltar} />
                  <div className="field wide"><label>Motivo (opcional)</label><input name="motivo" maxLength={300} /></div>
                  <Submit className="btn btn-danger btn-sm" confirm="Marcar como perdida? Ela sai do resultado previsto (dá para desfazer).">Marcar perdida</Submit>
                </form>
              </details>
            )}
            {r.status === "perdida" && <form action={fin}><Ocultos op="receita.reverter" escopo={escopo} id={r.id} voltar={voltar} /><Submit className="btn btn-ghost btn-sm">Desfazer perda</Submit></form>}
          </div>
        </td>
      )}
    </tr>
  );
}

export function Receber({ f, escopo, mes, podeEscrever, podeReclassificar, voltar }: { f: Fonte<ListaReceitas>; escopo: EscopoFin; mes: string; podeEscrever: boolean; podeReclassificar: boolean; voltar: string }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const { receitas, totais } = f.dados;
  const noMes = receitas.filter((r) => r.data_prevista.slice(0, 7) === mes);
  const abertasAnteriores = receitas.filter((r) => (r.status === "pendente" || r.status === "atrasada") && r.data_prevista.slice(0, 7) < mes);
  const lista = [...abertasAnteriores, ...noMes];
  const cab = <thead><tr><th>Data</th><th>Receita</th><th>Cliente</th><th>Situação</th><th className="num">Valor</th>{podeEscrever && <th>Ações</th>}</tr></thead>;
  const q = (nome: string, x: { quantidade: number; total: number }, cls = "") => <div className="kpi dkpi"><div className="label">{nome}</div><div className={`value ${cls}`}>{brl(x.total)}</div><div className="small muted">{inteiro(x.quantidade)} {x.quantidade === 1 ? "lançamento" : "lançamentos"}</div></div>;
  return (
    <>
      <div className="grid kpis auto" style={{ marginTop: 14 }}>
        {q("Em aberto", totais.abertas)}{q("Em atraso", totais.atrasadas, totais.atrasadas.quantidade ? "neg" : "")}{q("Recebidas", totais.recebidas)}{q("Perdidas", totais.perdidas)}
      </div>
      {podeEscrever && (
        <details className="card novo" style={{ marginTop: 14 }}>
          <summary>Nova receita prevista</summary>
          <form action={fin} className="fgrid">
            <Ocultos op="receita.criar" escopo={escopo} voltar={voltar} />
            <div className="field"><label htmlFor="r-modo">Tipo</label><select id="r-modo" name="modo" defaultValue="avulsa"><option value="avulsa">Avulsa (um recebimento)</option><option value="parcelada">Parcelada</option><option value="recorrente">Recorrente (mensalidade)</option></select></div>
            <div className="field wide"><label htmlFor="r-desc">Descrição</label><input id="r-desc" name="descricao" required maxLength={200} /></div>
            <div className="field"><label htmlFor="r-cli">Cliente</label><input id="r-cli" name="cliente" maxLength={120} /></div>
            <div className="field"><label htmlFor="r-data">Primeiro vencimento</label><input id="r-data" name="data" type="date" required defaultValue={`${mes}-10`} /></div>
            <div className="field"><label htmlFor="r-val">Valor (avulsa) ou da parcela</label><input id="r-val" name="valor" inputMode="decimal" placeholder="0,00" /></div>
            <div className="field"><label htmlFor="r-tot">Valor total (parcelada)</label><input id="r-tot" name="valor_total" inputMode="decimal" placeholder="opcional" /></div>
            <div className="field"><label htmlFor="r-mes">Nº de parcelas/meses</label><input id="r-mes" name="meses" type="number" min={1} max={120} placeholder="vazio = indeterminado (recorrente)" /></div>
            <div className="field wide"><label htmlFor="r-obs">Observação</label><input id="r-obs" name="obs" maxLength={500} /></div>
            <Submit className="btn btn-orange btn-sm">Criar</Submit>
          </form>
        </details>
      )}
      <div className="card tbl-card" style={{ marginTop: 14 }}>
        <h3>Receitas previstas</h3>
        <p className="small muted dsub">Do mês escolhido, mais o que ficou em aberto de meses anteriores.</p>
        {lista.length === 0 ? <div className="empty">Nada previsto para este mês.</div> : (
          <div className="tbl-wrap"><table className="t">{cab}<tbody>{lista.map((r) => <Linha key={r.id} r={r} escopo={escopo} podeEscrever={podeEscrever} podeReclassificar={podeReclassificar} voltar={voltar} />)}</tbody></table></div>
        )}
      </div>
    </>
  );
}
