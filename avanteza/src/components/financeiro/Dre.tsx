import { LineChart, Legenda } from "@/components/dashboards/LineChart";
import { brl, percentual } from "@/lib/dashboards/format";
import { rotuloMesCurto } from "@/lib/financeiro/periodo";
import type { Dre as DreT, DreValores } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import { FonteAviso } from "./Comum";

type Linha = { campo: keyof DreValores; rotulo: string; prefixo: string; nivel: "item" | "subtotal" | "total"; saida?: boolean };
const LINHAS: Linha[] = [
  { campo: "receitaBruta", rotulo: "Receita bruta", prefixo: "", nivel: "subtotal" },
  { campo: "deducoes", rotulo: "Deduções (impostos sobre vendas, taxas)", prefixo: "(−)", nivel: "item", saida: true },
  { campo: "receitaLiquida", rotulo: "Receita líquida", prefixo: "=", nivel: "total" },
  { campo: "custos", rotulo: "Custos diretos", prefixo: "(−)", nivel: "item", saida: true },
  { campo: "lucroBruto", rotulo: "Lucro bruto", prefixo: "=", nivel: "total" },
  { campo: "despesasOperacionais", rotulo: "Despesas operacionais", prefixo: "(−)", nivel: "subtotal", saida: true },
  { campo: "resultadoOperacional", rotulo: "Resultado operacional", prefixo: "=", nivel: "total" },
  { campo: "receitasFinanceiras", rotulo: "Receitas financeiras", prefixo: "(+)", nivel: "item" },
  { campo: "despesasFinanceiras", rotulo: "Despesas financeiras", prefixo: "(−)", nivel: "item", saida: true },
  { campo: "impostos", rotulo: "Impostos sobre o resultado", prefixo: "(−)", nivel: "item", saida: true },
  { campo: "resultadoLiquido", rotulo: "Resultado líquido", prefixo: "=", nivel: "total" },
  { campo: "dividas", rotulo: "Dívidas e cartões pagos", prefixo: "(−)", nivel: "item", saida: true },
  { campo: "investimentos", rotulo: "Investimentos", prefixo: "(−)", nivel: "item", saida: true },
  { campo: "sobraCaixa", rotulo: "Sobra de caixa", prefixo: "=", nivel: "total" },
];

export function Dre({ f }: { f: Fonte<DreT> }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const d = f.dados;
  const a = d.realizado.atual, p = d.realizado.anterior, pj = d.projetado.atual;
  const meses = d.serie.map((s) => s.mes);
  return (
    <>
      <div className="card tbl-card" style={{ marginTop: 14 }}>
        <div className="row"><h3>DRE · {d.periodo.label}</h3><span className="small muted">regime de caixa (o que está no extrato)</span></div>
        <div className="tbl-wrap">
          <table className="t dre">
            <thead><tr><th>Linha</th><th className="num">Realizado</th><th className="num">{d.anterior.label}</th><th className="num">Projetado*</th></tr></thead>
            <tbody>
              {LINHAS.map((l) => (
                <tr key={l.campo} className={`dre-${l.nivel}`}>
                  <td><span className="dre-pre" aria-hidden="true">{l.prefixo}</span> {l.rotulo}</td>
                  <td className="num">{brl(a[l.campo] as number, true)}</td>
                  <td className="num muted">{brl(p[l.campo] as number, true)}</td>
                  <td className="num muted">{brl(pj[l.campo] as number, true)}</td>
                </tr>
              ))}
              <tr className="dre-margem"><td>Margem líquida</td><td className="num">{percentual(a.margemLiquida)}</td><td className="num muted">{percentual(p.margemLiquida)}</td><td className="num muted">{percentual(pj.margemLiquida)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>* Projetado = realizado + receitas previstas em aberto ({brl(d.projetado.previsto.receitas)}) − contas a pagar pendentes ({brl(d.projetado.previsto.despesas)}).</p>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row"><h3>Últimos meses</h3><Legenda itens={[{ nome: "Receita líquida", cor: "ok" }, { nome: "Saídas", cor: "danger" }, { nome: "Resultado", cor: "orange" }]} /></div>
        <LineChart titulo="Receita, saídas e resultado por mês" datas={meses.map((m) => `${m}-01`)} nomes={meses.map(rotuloMesCurto)} formato="brl"
          series={[{ nome: "Receita líquida", valores: d.serie.map((s) => s.receitaLiquida), cor: "ok" }, { nome: "Saídas", valores: d.serie.map((s) => s.saidas), cor: "danger", area: false }, { nome: "Resultado", valores: d.serie.map((s) => s.resultadoLiquido), cor: "orange", area: false }]} />
      </div>
      {d.insights.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Leituras do período</h3>
          <ul className="plist">{d.insights.map((i) => <li key={i}><span>{i}</span></li>)}</ul>
        </div>
      )}
    </>
  );
}
