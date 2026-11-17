import Link from "next/link";
import { Kpi, type DeltaProps } from "@/components/dashboards/Kpi";
import { LineChart, Legenda } from "@/components/dashboards/LineChart";
import { HBars, type ItemBarra } from "@/components/dashboards/HBars";
import { brl, brlCompacto, inteiro } from "@/lib/dashboards/format";
import { ddmmaa, ultimoDia } from "@/lib/financeiro/periodo";
import { hojeBrasilia } from "@/lib/financeiro/periodo";
import type { VisaoGeral as Dados } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { Aviso, FonteAviso, hrefAba } from "./Comum";

const dlt = (v: { variacaoPct: number | null }, rotulo: string, inverso = false): DeltaProps => ({ pct: v.variacaoPct, inverso, anterior: rotulo });

export function VisaoGeral({ d, escopo, mes }: { d: Dados; escopo: EscopoFin; mes: string }) {
  if (d.resumo.estado !== "ok") return <FonteAviso f={d.resumo} />;
  const r = d.resumo.dados;
  const hoje = hojeBrasilia();
  const rotAnt = `Anterior: ${r.comparativo.periodoAnterior.label}`;
  const contas = d.contas.estado === "ok" ? d.contas.dados : null;
  const contasMes = contas?.filter((c) => c.data_vencimento.slice(0, 7) === mes) ?? [];
  const atrasadasContas = contas?.filter((c) => c.data_vencimento.slice(0, 10) < `${mes}-01`) ?? [];
  const aPagar = contasMes.reduce((a, c) => a + c.valor, 0) + atrasadasContas.reduce((a, c) => a + c.valor, 0);
  const aReceber = r.receitasPrevistas.total + r.receitasPrevistas.atrasadasAnteriores.total;
  const contratos = d.contratos.estado === "ok" ? d.contratos.dados.filter((c) => c.status === "ativo") : null;
  const mrr = contratos?.filter((c) => c.modo === "recorrente").reduce((a, c) => a + c.valor_parcela, 0) ?? 0;
  const pontos = d.diario.estado === "ok" ? d.diario.dados.pontos : null;
  const cats: ItemBarra[] = r.categorias.map((c) => ({ rotulo: c.categoria, valor: c.total, texto: brl(c.total), cor: "danger" }));
  const prox = [...r.receitasPrevistas.itens].sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)).slice(0, 5);
  const venc = [...contasMes].sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)).slice(0, 5);
  const ate = ultimoDia(mes);
  return (
    <>
      <div className="grid kpis seis" style={{ marginTop: 14 }}>
        <Kpi label="Receitas" valor={brlCompacto(r.receitas)} delta={dlt(r.comparativo.receitas, rotAnt)} sub="recebidas no mês" cor="ok" spark={pontos?.map((p) => p.receitas)} />
        <Kpi label="Despesas" valor={brlCompacto(r.despesas)} delta={dlt(r.comparativo.despesas, rotAnt, true)} sub="pagas no mês" cor="danger" spark={pontos?.map((p) => p.despesas)} />
        <Kpi label="Resultado" valor={brlCompacto(r.saldo)} delta={dlt(r.comparativo.saldo, rotAnt)} sub="receitas − despesas" />
        <Kpi label="A receber" valor={brlCompacto(aReceber)} sub={r.receitasPrevistas.atrasadasAnteriores.quantidade ? `${inteiro(r.receitasPrevistas.quantidade)} previstas · ${brl(r.receitasPrevistas.atrasadasAnteriores.total)} em atraso` : `${inteiro(r.receitasPrevistas.quantidade)} previstas no mês`} />
        <Kpi label="A pagar" valor={d.contas.estado === "ok" ? brlCompacto(aPagar) : "—"} indisponivel={d.contas.estado !== "ok"} sub={d.contas.estado === "ok" ? `${inteiro(contasMes.length + atrasadasContas.length)} contas pendentes${atrasadasContas.length ? ` (${atrasadasContas.length} em atraso)` : ""}` : "contas indisponíveis"} />
        <Kpi label="Contratos ativos" valor={contratos ? inteiro(contratos.length) : "—"} indisponivel={!contratos} sub={contratos ? `${brl(mrr)}/mês recorrente` : "contratos indisponíveis"} />
      </div>
      {r.meta && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row"><h3>Meta de receita do mês</h3><span className="small muted">{brl(r.meta.atual)} de {brl(r.meta.alvo)}</span></div>
          <div className="meta-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((r.meta.atual / r.meta.alvo) * 100))} aria-label="Progresso da meta de receita">
            <span style={{ width: `${Math.min(100, (r.meta.atual / r.meta.alvo) * 100)}%` }} />
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>{Math.round((r.meta.atual / r.meta.alvo) * 100)}% da meta.</p>
        </div>
      )}
      <div className="grid dsplit" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="row"><h3>Receitas e despesas por dia</h3><Legenda itens={[{ nome: "Receitas", cor: "ok" }, { nome: "Despesas", cor: "danger" }]} /></div>
          {pontos ? (
            <>
              <LineChart titulo="Receitas e despesas por dia" datas={pontos.map((p) => p.data)} formato="brl"
                series={[{ nome: "Receitas", valores: pontos.map((p) => p.receitas), cor: "ok" }, { nome: "Despesas", valores: pontos.map((p) => p.despesas), cor: "danger", area: false }]} />
              {d.diario.estado === "ok" && d.diario.dados.truncado && <p className="small muted">Mostrando os primeiros lançamentos do mês (limite de segurança).</p>}
            </>
          ) : <FonteAviso f={d.diario} />}
        </div>
        <div className="card">
          <h3>Despesas por categoria</h3>
          <HBars itens={cats} vazio="Sem despesas no mês." />
        </div>
      </div>
      <div className="grid dsplit equal" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="row"><h3>Próximos recebimentos</h3><Link className="small" href={hrefAba(escopo, "receber", mes)}>ver todos</Link></div>
          {prox.length === 0 ? <div className="empty">Nada previsto neste mês.</div> : (
            <ul className="plist">
              {prox.map((p) => (
                <li key={p.id} className={p.atrasada ? "late" : ""}><span>{ddmmaa(p.data_prevista)} · {p.cliente || p.descricao}</span><b>{brl(p.valor, true)}</b></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="row"><h3>Contas a vencer</h3><Link className="small" href={hrefAba(escopo, "contas", mes)}>ver todas</Link></div>
          {d.contas.estado !== "ok" ? <FonteAviso f={d.contas} /> : venc.length === 0 ? <div className="empty">Nenhuma conta pendente neste mês.</div> : (
            <ul className="plist">
              {venc.map((c) => (
                <li key={c.id} className={c.data_vencimento.slice(0, 10) < hoje ? "late" : ""}><span>{ddmmaa(c.data_vencimento)} · {c.descricao}</span><b>{brl(c.valor, true)}</b></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {r.receitasPrevistas.perdidas.quantidade > 0 && <Aviso tipo="" titulo="Receitas perdidas no mês" texto={`${inteiro(r.receitasPrevistas.perdidas.quantidade)} previstas somando ${brl(r.receitasPrevistas.perdidas.total)} foram marcadas como perdidas e não entram no resultado.`} />}
      <p className="small muted" style={{ marginTop: 10 }}>Competência mensal (data do lançamento). O painel Dashboards usa os últimos dias (7/30/90) e por isso pode mostrar totais diferentes para o mesmo mês. Período até {ddmmaa(ate)}.</p>
    </>
  );
}
