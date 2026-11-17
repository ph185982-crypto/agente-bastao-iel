import { Submit } from "@/components/Submit";
import { Kpi } from "@/components/dashboards/Kpi";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl, inteiro } from "@/lib/dashboards/format";
import { ddmmaa } from "@/lib/financeiro/periodo";
import type { ContratoDespesa } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos, destinoReclassificar, rotuloArea } from "./Comum";

function Cartao({ c, escopo, podeEscrever, podeReclassificar, voltar }: { c: ContratoDespesa; escopo: EscopoFin; podeEscrever: boolean; podeReclassificar: boolean; voltar: string }) {
  const ativo = c.status === "ativo";
  const total = c.parcelas_total;
  const pct = total ? Math.min(100, (c.pagas / total) * 100) : 0;
  return (
    <div className="card">
      <div className="row"><h3>{c.descricao}</h3><span className={`pill ${ativo ? "pill-ok" : "pill-outline"}`}>{ativo ? "ativo" : "encerrado"}</span></div>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>
        {c.credor || "Sem credor"} · {c.categoria} · dia {c.dia_vencimento}{c.estimada ? " · valor aproximado" : ""}
      </p>
      <div className="dbig">{brl(c.valor_parcela, true)}<span className="small muted"> / mês</span></div>
      {total ? (
        <>
          <div className="meta-bar" role="progressbar" aria-label={`Parcelas pagas: ${c.descricao}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={c.pagas}><span style={{ width: `${pct}%` }} /></div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>{c.pagas} de {total} pagas · faltam {c.restantes ?? Math.max(0, total - c.pagas)}{c.valor_restante != null ? ` (${brl(c.valor_restante)})` : ""}</p>
        </>
      ) : <p className="small muted" style={{ margin: "8px 0 0" }}>Sem data de fim · {c.pagas} {c.pagas === 1 ? "paga" : "pagas"}</p>}
      <ul className="plist">
        {c.proxima && ativo && <li><span>Próxima conta</span><b>{ddmmaa(c.proxima.vencimento)} · {brl(c.proxima.valor, true)}</b></li>}
        {c.saldo_devedor != null && <li><span>Saldo devedor informado</span><b>{brl(c.saldo_devedor)}</b></li>}
      </ul>
      {podeEscrever && (
        <div className="acoes" style={{ marginTop: 10 }}>
          <details className="mini"><summary>Editar</summary>
            <form action={fin} className="fgrid mini-form">
              <Ocultos op="contrato_despesa.editar" escopo={escopo} id={c.id} voltar={voltar} />
              <div className="field wide"><label>Nome</label><input name="descricao" defaultValue={c.descricao} required maxLength={200} /></div>
              <div className="field"><label>Valor da parcela (R$)</label><input name="valor" inputMode="decimal" defaultValue={String(c.valor_parcela).replace(".", ",")} required /></div>
              <div className="field"><label>Credor</label><input name="credor" defaultValue={c.credor ?? ""} maxLength={120} /></div>
              <div className="field"><label>Saldo devedor (R$)</label><input name="saldo" inputMode="decimal" defaultValue={c.saldo_devedor != null ? String(c.saldo_devedor).replace(".", ",") : ""} /></div>
              <p className="small muted wide" style={{ margin: 0 }}>O novo valor vale para as contas pendentes que ainda estão no valor antigo.</p>
              <Submit className="btn btn-orange btn-sm">Salvar</Submit>
            </form>
          </details>
          {ativo
            ? <form action={fin}><Ocultos op="contrato_despesa.encerrar" escopo={escopo} id={c.id} voltar={voltar} /><Submit className="btn btn-danger btn-sm" confirm="Encerrar o contrato? As contas pendentes que ainda não venceram são canceladas. Nada é apagado.">Encerrar</Submit></form>
            : <form action={fin}><Ocultos op="contrato_despesa.reativar" escopo={escopo} id={c.id} voltar={voltar} /><Submit className="btn btn-sm" confirm="Reativar o contrato e voltar a gerar as contas?">Reativar</Submit></form>}
          {podeReclassificar && <form action={fin}><Ocultos op="contrato_despesa.reclassificar" escopo={escopo} id={c.id} voltar={voltar} para={destinoReclassificar(escopo)} /><Submit className="btn btn-ghost btn-sm" confirm={`Mover este contrato de ${rotuloArea(escopo)} para ${rotuloArea(destinoReclassificar(escopo))}? As contas pendentes vão junto.`}>Mover p/ {rotuloArea(destinoReclassificar(escopo))}</Submit></form>}
        </div>
      )}
    </div>
  );
}

export function ContratosDespesa({ f, escopo, podeEscrever, podeReclassificar, voltar, mes }: { f: Fonte<ContratoDespesa[]>; escopo: EscopoFin; podeEscrever: boolean; podeReclassificar: boolean; voltar: string; mes: string }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const lista = f.dados;
  const ativos = lista.filter((c) => c.status === "ativo");
  const encerrados = lista.filter((c) => c.status !== "ativo");
  const porMes = ativos.reduce((a, c) => a + c.valor_parcela, 0);
  const saldo = ativos.reduce((a, c) => a + (c.saldo_devedor ?? 0), 0);
  return (
    <>
      <div className="grid kpis auto" style={{ marginTop: 14 }}>
        <Kpi label="Contratos ativos" valor={inteiro(ativos.length)} sub={encerrados.length ? `${inteiro(encerrados.length)} ${encerrados.length === 1 ? "encerrado" : "encerrados"}` : "nenhum encerrado"} />
        <Kpi label="Compromisso por mês" valor={brl(porMes)} sub="soma das parcelas ativas" cor="danger" />
        <Kpi label="Saldo devedor informado" valor={saldo > 0 ? brl(saldo) : "—"} sub={saldo > 0 ? "só onde foi informado" : "nenhum informado"} />
      </div>
      {podeEscrever && (
        <details className="card novo" style={{ marginTop: 14 }}>
          <summary>Novo contrato de despesa</summary>
          <form action={fin} className="fgrid">
            <Ocultos op="contrato_despesa.criar" escopo={escopo} voltar={voltar} />
            <div className="field wide"><label htmlFor="cd-desc">Nome</label><input id="cd-desc" name="descricao" required maxLength={200} placeholder="Financiamento, internet, aluguel…" /></div>
            <div className="field"><label htmlFor="cd-val">Valor da parcela (R$)</label><input id="cd-val" name="valor" inputMode="decimal" required placeholder="0,00" /></div>
            <div className="field"><label htmlFor="cd-par">Parcelas</label><input id="cd-par" name="parcelas" inputMode="numeric" placeholder="vazio = sem fim" /></div>
            <div className="field"><label htmlFor="cd-pri">Primeiro vencimento</label><input id="cd-pri" name="primeiro" type="date" required defaultValue={`${mes}-10`} /></div>
            <div className="field"><label htmlFor="cd-dia">Dia de vencimento</label><input id="cd-dia" name="dia" inputMode="numeric" placeholder="igual ao do 1º" /></div>
            <div className="field"><label htmlFor="cd-cre">Credor</label><input id="cd-cre" name="credor" maxLength={120} /></div>
            <div className="field"><label htmlFor="cd-cat">Categoria</label><input id="cd-cat" name="categoria" maxLength={80} placeholder="Outros" /></div>
            <div className="field"><label htmlFor="cd-sal">Saldo devedor (R$)</label><input id="cd-sal" name="saldo" inputMode="decimal" placeholder="opcional" /></div>
            <div className="field"><label htmlFor="cd-est">Valor varia</label><select id="cd-est" name="estimada" defaultValue=""><option value="">Fixo</option><option value="sim">Aproximado (água, luz)</option></select></div>
            <Submit className="btn btn-orange btn-sm">Criar contrato</Submit>
          </form>
          <p className="small muted" style={{ margin: "8px 0 0" }}>O sistema gera as contas a pagar do mês e do seguinte; o resto vem a cada mês.</p>
        </details>
      )}
      {lista.length === 0 ? <div className="empty" role="status" style={{ marginTop: 14 }}>Nenhum contrato de despesa. Cadastre financiamentos, aluguel, internet e assinaturas uma vez; as contas a pagar nascem sozinhas.</div> : (
        <>
          <div className="grid three" style={{ marginTop: 14 }}>
            {ativos.map((c) => <Cartao key={c.id} c={c} escopo={escopo} podeEscrever={podeEscrever} podeReclassificar={podeReclassificar} voltar={voltar} />)}
          </div>
          {encerrados.length > 0 && (
            <>
              <h2>Encerrados</h2>
              <div className="grid three">{encerrados.map((c) => <Cartao key={c.id} c={c} escopo={escopo} podeEscrever={podeEscrever} podeReclassificar={podeReclassificar} voltar={voltar} />)}</div>
            </>
          )}
        </>
      )}
    </>
  );
}
