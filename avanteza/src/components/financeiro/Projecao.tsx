import Link from "next/link";
import { Kpi } from "@/components/dashboards/Kpi";
import { LineChart } from "@/components/dashboards/LineChart";
import { brl, brlCompacto, inteiro } from "@/lib/dashboards/format";
import { ddmm, ddmmaa } from "@/lib/financeiro/periodo";
import type { Projecao as Dados } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { Aviso, FonteAviso, hrefAba } from "./Comum";

export const HORIZONTES = [15, 30, 45, 60] as const;

export interface EventoProjecao { tipo: "receita" | "conta" | "outro"; descricao: string; valor: number | null }

/** "Receita: Aula particular R$1500.00" / "Conta: Aluguel R$2800.00" → partes (o Vendedor IA manda o evento como texto). */
export function lerEvento(txt: string): EventoProjecao {
  const m = /^(Receita|Conta): (.*) R\$(-?\d+(?:\.\d+)?)$/.exec(txt);
  if (!m) return { tipo: "outro", descricao: txt, valor: null };
  return { tipo: m[1] === "Receita" ? "receita" : "conta", descricao: m[2], valor: Number(m[3]) };
}

export function resumoProjecao(d: Dados) {
  const ult = d.dias[d.dias.length - 1];
  const menor = d.dias.reduce((a, x) => (x.saldo < a.saldo ? x : a), d.dias[0]);
  const entradas = d.dias.flatMap((x) => x.eventos.map(lerEvento)).filter((e) => e.tipo === "receita").reduce((a, e) => a + (e.valor ?? 0), 0);
  const saidas = d.dias.flatMap((x) => x.eventos.map(lerEvento)).filter((e) => e.tipo === "conta").reduce((a, e) => a + (e.valor ?? 0), 0);
  return { final: ult?.saldo ?? d.saldo_atual, menor, entradas: Math.round(entradas * 100) / 100, saidas: Math.round(saidas * 100) / 100 };
}

export function Projecao({ f, escopo, dias }: { f: Fonte<Dados>; escopo: EscopoFin; dias: number }) {
  const horizontes = (
    <nav className="tabs periodo" aria-label="Horizonte da projeção">
      {HORIZONTES.map((h) => <Link key={h} href={`${hrefAba(escopo, "projecao")}${h === 30 ? "" : `?dias=${h}`}`} aria-current={h === dias ? "page" : undefined}>{h} dias</Link>)}
    </nav>
  );
  if (f.estado !== "ok") return <>{horizontes}<FonteAviso f={f} /></>;
  const d = f.dados;
  if (d.dias.length === 0) return <>{horizontes}<div className="empty" role="status">A projeção veio sem dias. Tente novamente em instantes.</div></>;
  const r = resumoProjecao(d);
  const comEventos = d.dias.filter((x) => x.eventos.length > 0);
  const area = escopo === "pessoal" ? "pessoais" : "da empresa";
  return (
    <>
      {horizontes}
      <div className="grid kpis auto" style={{ marginTop: 6 }}>
        <Kpi label="Resultado do mês até hoje" valor={brlCompacto(d.saldo_atual)} sub="receitas − despesas já lançadas" cor={d.saldo_atual < 0 ? "danger" : "ok"} />
        <Kpi label="Gasto médio por dia" valor={brl(d.burn_rate, true)} sub="média dos últimos 60 dias" />
        <Kpi label={`Saldo em ${d.dias.length} dias`} valor={brlCompacto(r.final)} sub={`até ${ddmmaa(d.dias[d.dias.length - 1].data)}`} cor={r.final < 0 ? "danger" : undefined} />
        <Kpi label="Menor saldo do período" valor={brlCompacto(r.menor.saldo)} sub={`em ${ddmm(r.menor.data)}`} cor={r.menor.saldo < 0 ? "danger" : undefined} />
        <Kpi label="Primeiro dia negativo" valor={d.primeiro_negativo ? ddmmaa(d.primeiro_negativo) : "Nenhum"} sub={d.primeiro_negativo ? "o saldo projetado fica abaixo de zero" : "no horizonte escolhido"} cor={d.primeiro_negativo ? "danger" : "ok"} />
      </div>
      {d.primeiro_negativo && <Aviso titulo="Caixa projetado negativo" texto={`Mantido o ritmo atual de gastos, o saldo ${area} fica abaixo de zero em ${ddmmaa(d.primeiro_negativo)}. Revise contas a pagar e receitas previstas antes disso.`} />}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row"><h3>Saldo projetado, dia a dia</h3><span className="small muted">{d.dias.length} dias a partir de hoje</span></div>
        <LineChart titulo="Saldo projetado" datas={d.dias.map((x) => x.data)} formato="brl" series={[{ nome: "Saldo projetado", valores: d.dias.map((x) => x.saldo), cor: r.menor.saldo < 0 ? "danger" : "orange", area: true }]} />
      </div>
      <div className="grid dsplit equal" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>O que entra e sai no período</h3>
          <ul className="plist">
            <li><span>Receitas previstas</span><b className="pos">{brl(r.entradas, true)}</b></li>
            <li><span>Contas a pagar</span><b className="neg">{brl(r.saidas, true)}</b></li>
            <li><span>Gasto médio acumulado</span><b className="neg">{brl(Math.round(d.burn_rate * d.dias.length * 100) / 100, true)}</b></li>
          </ul>
          <p className="small muted" style={{ margin: "10px 0 0" }}>Só entram receitas e contas <b>em aberto com vencimento no período</b>. O que já venceu e continua em aberto não está nesta conta.</p>
        </div>
        <div className="card">
          <h3>Dias com movimento</h3>
          {comEventos.length === 0 ? <div className="empty">Nenhuma conta ou receita prevista para os próximos {d.dias.length} dias.</div> : (
            <ul className="plist">
              {comEventos.slice(0, 12).map((x) => (
                <li key={x.data} className={x.saldo < 0 ? "late" : ""}>
                  <span><b>{ddmm(x.data)}</b> · {x.eventos.map(lerEvento).map((e) => `${e.tipo === "receita" ? "+" : "−"} ${e.descricao}${e.valor != null ? ` (${brl(e.valor, true)})` : ""}`).join("; ")}</span>
                  <b style={{ whiteSpace: "nowrap" }}>{brl(x.saldo)}</b>
                </li>
              ))}
            </ul>
          )}
          {comEventos.length > 12 && <p className="small muted">Mostrando os 12 primeiros dias de {inteiro(comEventos.length)} com movimento.</p>}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Estimativa, não é o saldo do banco: parte do resultado do mês (somente lançamentos confirmados {area}), desconta o gasto médio diário e soma as receitas previstas e contas a pagar de cada dia. O gasto médio e as contas pendentes podem se sobrepor. Um único cenário (o ritmo atual).</p>
    </>
  );
}
