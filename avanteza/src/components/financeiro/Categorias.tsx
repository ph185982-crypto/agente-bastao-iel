import { HBars, type ItemBarra } from "@/components/dashboards/HBars";
import { brl } from "@/lib/dashboards/format";
import type { Categorias as Cats, Transacao } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import { FonteAviso } from "./Comum";

export function totaisPorCategoria(itens: Transacao[], tipo: "receita" | "despesa"): ItemBarra[] {
  const m = new Map<string, number>();
  for (const t of itens) if (t.confirmado && t.tipo === tipo) m.set(t.categoria, Math.round(((m.get(t.categoria) ?? 0) + t.valor) * 100) / 100);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([rotulo, valor]) => ({ rotulo, valor, texto: brl(valor), cor: tipo === "receita" ? "ok" : "danger" }));
}

export function Categorias({ cats, movimento }: { cats: Fonte<Cats>; movimento: Fonte<{ itens: Transacao[]; truncado: boolean }> }) {
  if (movimento.estado !== "ok") return <FonteAviso f={movimento} />;
  const rec = totaisPorCategoria(movimento.dados.itens, "receita");
  const desp = totaisPorCategoria(movimento.dados.itens, "despesa");
  const usadas = new Set([...rec, ...desp].map((i) => i.rotulo));
  const sem = cats.estado === "ok" ? [...cats.dados.receitas, ...cats.dados.despesas].filter((c, i, a) => a.indexOf(c) === i && !usadas.has(c)) : [];
  return (
    <>
      <div className="grid dsplit equal" style={{ marginTop: 14 }}>
        <div className="card"><h3>Despesas por categoria</h3><HBars itens={desp} vazio="Sem despesas no mês." /></div>
        <div className="card"><h3>Receitas por categoria</h3><HBars itens={rec} vazio="Sem receitas no mês." /></div>
      </div>
      {cats.estado !== "ok" ? <FonteAviso f={cats} /> : sem.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Sem movimento no mês</h3>
          <div className="btn-row" style={{ marginTop: 8 }}>{sem.map((c) => <span key={c} className="pill pill-outline">{c}</span>)}</div>
        </div>
      )}
      {movimento.dados.truncado && <p className="small muted">Totais dos primeiros lançamentos do mês (limite de segurança).</p>}
    </>
  );
}
