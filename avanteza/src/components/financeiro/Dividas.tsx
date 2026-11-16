import { Submit } from "@/components/Submit";
import { Kpi } from "@/components/dashboards/Kpi";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl, inteiro } from "@/lib/dashboards/format";
import type { Divida } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import { FonteAviso, Ocultos } from "./Comum";

export function Dividas({ f, podeEscrever, voltar }: { f: Fonte<Divida[]>; podeEscrever: boolean; voltar: string }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const lista = f.dados;
  if (lista.length === 0) return <div className="empty" role="status" style={{ marginTop: 14 }}>Nenhuma dívida ativa. As dívidas são cadastradas pelo Max, no WhatsApp; quando houver, elas aparecem aqui com o andamento.</div>;
  const restante = lista.reduce((a, d) => a + d.restante, 0);
  const pago = lista.reduce((a, d) => a + d.valor_pago, 0);
  const mensal = lista.reduce((a, d) => a + (d.parcela_mensal ?? 0), 0);
  return (
    <>
      <div className="grid kpis auto" style={{ marginTop: 14 }}>
        <Kpi label="Ainda a pagar" valor={brl(restante)} sub={`${inteiro(lista.length)} ${lista.length === 1 ? "dívida ativa" : "dívidas ativas"}`} cor="danger" />
        <Kpi label="Já pago" valor={brl(pago)} sub="nas dívidas ativas" cor="ok" />
        <Kpi label="Parcelas por mês" valor={brl(mensal)} sub="soma das parcelas combinadas" />
      </div>
      <div className="grid three" style={{ marginTop: 14 }}>
        {lista.map((d) => (
          <div key={d.id} className="card">
            <div className="row"><h3>{d.descricao}</h3><span className="pill pill-navy">{Math.round(d.progresso)}%</span></div>
            <p className="small muted" style={{ margin: "4px 0 10px" }}>{d.credor || "Sem credor informado"}{d.dia_vencimento ? ` · vence dia ${d.dia_vencimento}` : ""}{d.parcela_mensal ? ` · parcela ${brl(d.parcela_mensal, true)}` : ""}</p>
            <div className="dbig">{brl(d.restante, true)}<span className="small muted"> restantes</span></div>
            <div className="meta-bar" role="progressbar" aria-label={`Quitação: ${d.descricao}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(d.progresso))}><span style={{ width: `${Math.min(100, d.progresso)}%` }} /></div>
            <p className="small muted" style={{ margin: "6px 0 0" }}>{brl(d.valor_pago, true)} pagos de {brl(d.valor_total, true)}</p>
            {d.observacao && <p className="small muted" style={{ margin: "4px 0 0" }}>{d.observacao}</p>}
            {podeEscrever && (
              <div className="acoes" style={{ marginTop: 10 }}>
                <details className="mini"><summary>Pagar parcela</summary>
                  <form action={fin} className="fgrid mini-form">
                    <Ocultos op="divida.pagar" escopo="pessoal" id={d.id} voltar={voltar} />
                    <div className="field"><label>Valor pago (R$)</label><input name="valor" inputMode="decimal" required defaultValue={d.parcela_mensal ? String(Math.min(d.parcela_mensal, d.restante)).replace(".", ",") : ""} /></div>
                    <Submit className="btn btn-orange btn-sm" confirm="Registrar o pagamento? Ele vira uma despesa pessoal no extrato de hoje.">Pagar</Submit>
                  </form>
                </details>
                <form action={fin}><Ocultos op="divida.quitar" escopo="pessoal" id={d.id} voltar={voltar} /><Submit className="btn btn-ghost btn-sm" confirm="Marcar a dívida como quitada? Não lança despesa no extrato.">Quitar</Submit></form>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Pagar uma parcela lança a despesa pessoal no extrato. “Quitar” só encerra a dívida (não lança despesa). Cadastro de novas dívidas continua no Max.</p>
    </>
  );
}
