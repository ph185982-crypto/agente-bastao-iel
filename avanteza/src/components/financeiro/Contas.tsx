import { Submit } from "@/components/Submit";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl } from "@/lib/dashboards/format";
import { ddmmaa, hojeBrasilia } from "@/lib/financeiro/periodo";
import type { Conta } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos, destinoReclassificar, rotuloArea, soData } from "./Comum";

function Linha({ c, escopo, podeEscrever, podeReclassificar, voltar }: { c: Conta; escopo: EscopoFin; podeEscrever: boolean; podeReclassificar: boolean; voltar: string }) {
  const hoje = hojeBrasilia();
  const aberta = c.status === "pendente";
  const vencida = aberta && c.data_vencimento.slice(0, 10) < hoje;
  return (
    <tr>
      <td className={`nowrap ${vencida ? "late" : ""}`}>{ddmmaa(c.data_vencimento)}</td>
      <td className="ctitle">{c.descricao}{c.recorrente && <> <span className="pill pill-outline">recorrente</span></>}{c.estimada && <> <span className="pill pill-outline">estimada</span></>}</td>
      <td>{c.categoria}</td>
      <td><span className={`pill ${c.status === "paga" ? "pill-ok" : c.status === "cancelada" ? "pill-outline" : vencida ? "pill-danger" : "pill-navy"}`}>{c.status === "pendente" ? (vencida ? "vencida" : "a vencer") : c.status}</span></td>
      <td className="num neg">{brl(c.valor, true)}</td>
      {podeEscrever && (
        <td>
          <div className="acoes">
            {aberta && <form action={fin}><Ocultos op="conta.pagar" escopo={escopo} id={c.id} voltar={voltar} /><Submit className="btn btn-sm" confirm="Marcar como paga e lançar a despesa no extrato?">Pagar</Submit></form>}
            {aberta && (
              <details className="mini"><summary>Editar</summary>
                <form action={fin} className="fgrid mini-form">
                  <Ocultos op="conta.editar" escopo={escopo} id={c.id} voltar={voltar} />
                  <div className="field wide"><label>Descrição</label><input name="descricao" defaultValue={c.descricao} required /></div>
                  <div className="field"><label>Valor</label><input name="valor" inputMode="decimal" defaultValue={String(c.valor).replace(".", ",")} required /></div>
                  <div className="field"><label>Vencimento</label><input name="vencimento" type="date" defaultValue={soData(c.data_vencimento)} required /></div>
                  <div className="field"><label>Categoria</label><input name="categoria" defaultValue={c.categoria} required /></div>
                  <Submit className="btn btn-orange btn-sm">Salvar</Submit>
                </form>
              </details>
            )}
            {aberta && podeReclassificar && <form action={fin}><Ocultos op="conta.reclassificar" escopo={escopo} id={c.id} voltar={voltar} para={destinoReclassificar(escopo)} /><Submit className="btn btn-ghost btn-sm" confirm={`Mover esta conta de ${rotuloArea(escopo)} para ${rotuloArea(destinoReclassificar(escopo))}?`}>Mover p/ {rotuloArea(destinoReclassificar(escopo))}</Submit></form>}
            {aberta && <form action={fin}><Ocultos op="conta.cancelar" escopo={escopo} id={c.id} voltar={voltar} /><Submit className="btn btn-ghost btn-sm" confirm="Cancelar esta conta?">Cancelar</Submit></form>}
            <form action={fin}><Ocultos op="conta.excluir" escopo={escopo} id={c.id} voltar={voltar} /><Submit className="btn btn-danger btn-sm" confirm="Excluir esta conta? Ela fica guardada no histórico do Vendedor IA.">Excluir</Submit></form>
          </div>
        </td>
      )}
    </tr>
  );
}

export function ContasPagar({ f, escopo, mes, podeEscrever, podeReclassificar, voltar }: { f: Fonte<Conta[]>; escopo: EscopoFin; mes: string; podeEscrever: boolean; podeReclassificar: boolean; voltar: string }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const todas = f.dados;
  const abertas = todas.filter((c) => c.status === "pendente");
  const fechadas = todas.filter((c) => c.status !== "pendente" && c.data_vencimento.slice(0, 7) === mes);
  const total = abertas.reduce((a, c) => a + c.valor, 0);
  const vencidas = abertas.filter((c) => c.data_vencimento.slice(0, 10) < hojeBrasilia());
  const cab = (acoes: boolean) => <thead><tr><th>Vencimento</th><th>Conta</th><th>Categoria</th><th>Situação</th><th className="num">Valor</th>{acoes && <th>Ações</th>}</tr></thead>;
  return (
    <>
      <div className="grid kpis auto" style={{ marginTop: 14 }}>
        <div className="kpi dkpi"><div className="label">Em aberto</div><div className="value">{brl(total)}</div><div className="small muted">{abertas.length} {abertas.length === 1 ? "conta" : "contas"}</div></div>
        <div className="kpi dkpi"><div className="label">Vencidas</div><div className={`value ${vencidas.length ? "neg" : ""}`}>{brl(vencidas.reduce((a, c) => a + c.valor, 0))}</div><div className="small muted">{vencidas.length} em atraso</div></div>
      </div>
      {podeEscrever && (
        <details className="card novo" style={{ marginTop: 14 }}>
          <summary>Nova conta a pagar</summary>
          <form action={fin} className="fgrid">
            <Ocultos op="conta.criar" escopo={escopo} voltar={voltar} />
            <div className="field wide"><label htmlFor="c-desc">Descrição</label><input id="c-desc" name="descricao" required maxLength={200} /></div>
            <div className="field"><label htmlFor="c-val">Valor (R$)</label><input id="c-val" name="valor" inputMode="decimal" placeholder="0,00" required /></div>
            <div className="field"><label htmlFor="c-ven">Vencimento</label><input id="c-ven" name="vencimento" type="date" required defaultValue={`${mes}-10`} /></div>
            <div className="field"><label htmlFor="c-cat">Categoria</label><input id="c-cat" name="categoria" placeholder="Outros" maxLength={80} /></div>
            <div className="field"><label htmlFor="c-freq">Repete</label><select id="c-freq" name="frequencia" defaultValue=""><option value="">Não</option><option value="mensal">Todo mês</option><option value="semanal">Toda semana</option><option value="anual">Todo ano</option></select></div>
            <Submit className="btn btn-orange btn-sm">Criar conta</Submit>
          </form>
        </details>
      )}
      <div className="card tbl-card" style={{ marginTop: 14 }}>
        <h3>A pagar</h3>
        {abertas.length === 0 ? <div className="empty">Nenhuma conta pendente.</div> : (
          <div className="tbl-wrap"><table className="t">{cab(podeEscrever)}<tbody>{abertas.map((c) => <Linha key={c.id} c={c} escopo={escopo} podeEscrever={podeEscrever} podeReclassificar={podeReclassificar} voltar={voltar} />)}</tbody></table></div>
        )}
      </div>
      {fechadas.length > 0 && (
        <div className="card tbl-card" style={{ marginTop: 14 }}>
          <h3>Pagas e canceladas no mês</h3>
          <div className="tbl-wrap"><table className="t">{cab(podeEscrever)}<tbody>{fechadas.map((c) => <Linha key={c.id} c={c} escopo={escopo} podeEscrever={podeEscrever} podeReclassificar={podeReclassificar} voltar={voltar} />)}</tbody></table></div>
        </div>
      )}
    </>
  );
}
