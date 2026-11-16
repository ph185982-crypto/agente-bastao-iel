import { Submit } from "@/components/Submit";
import { Kpi } from "@/components/dashboards/Kpi";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl, inteiro } from "@/lib/dashboards/format";
import type { Categorias, Orcamento } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import { FonteAviso, Ocultos } from "./Comum";

export type NivelOrcamento = "ok" | "alerta" | "estourado";
/** Mesma regra do Vendedor IA: 80% ou mais = alerta; 100% ou mais = estourado. */
export function nivelOrcamento(gasto: number, limite: number): NivelOrcamento {
  if (!(limite > 0)) return "ok";
  const pct = (gasto / limite) * 100;
  return pct >= 100 ? "estourado" : pct >= 80 ? "alerta" : "ok";
}
const ROTULO = { ok: "dentro do limite", alerta: "perto do limite", estourado: "estourado" } as const;
const PILULA = { ok: "pill-ok", alerta: "pill-sand", estourado: "pill-danger" } as const;
const COR = { ok: "var(--ok)", alerta: "var(--orange)", estourado: "var(--danger)" } as const;

export function Orcamentos({ f, cats, podeEscrever, voltar }: { f: Fonte<Orcamento[]>; cats: Fonte<Categorias> | null; podeEscrever: boolean; voltar: string }) {
  if (f.estado !== "ok") return <FonteAviso f={f} />;
  const lista = f.dados;
  const estourados = lista.filter((o) => nivelOrcamento(o.gasto_atual, o.limite_mensal) === "estourado").length;
  const limite = lista.reduce((a, o) => a + o.limite_mensal, 0);
  const gasto = lista.reduce((a, o) => a + o.gasto_atual, 0);
  const sugestoes = cats?.estado === "ok" ? cats.dados.despesas : [];
  return (
    <>
      <div className="grid kpis auto" style={{ marginTop: 14 }}>
        <Kpi label="Limite mensal somado" valor={brl(limite)} sub={`${inteiro(lista.length)} ${lista.length === 1 ? "categoria" : "categorias"}`} />
        <Kpi label="Gasto no mês" valor={brl(gasto)} sub="nas categorias com limite" />
        <Kpi label="Categorias estouradas" valor={inteiro(estourados)} sub={estourados ? "gasto acima do limite" : "nenhuma por enquanto"} cor={estourados ? "danger" : "ok"} />
      </div>
      {podeEscrever && (
        <details className="card novo" style={{ marginTop: 14 }}>
          <summary>Definir limite de uma categoria</summary>
          <form action={fin} className="fgrid">
            <Ocultos op="orcamento.salvar" escopo="pessoal" voltar={voltar} />
            <div className="field"><label htmlFor="o-cat">Categoria</label><input id="o-cat" name="categoria" list="o-cats" required maxLength={80} placeholder="Alimentação" /></div>
            <datalist id="o-cats">{sugestoes.map((c) => <option key={c} value={c} />)}</datalist>
            <div className="field"><label htmlFor="o-lim">Limite mensal (R$)</label><input id="o-lim" name="limite" inputMode="decimal" required placeholder="0,00" /></div>
            <Submit className="btn btn-orange btn-sm">Salvar limite</Submit>
          </form>
          <p className="small muted" style={{ margin: "8px 0 0" }}>Se a categoria já tem limite, o valor é atualizado.</p>
        </details>
      )}
      {lista.length === 0 ? <div className="empty" role="status" style={{ marginTop: 14 }}>Nenhum orçamento definido. Defina um limite mensal por categoria{podeEscrever ? " no formulário acima" : ""}.</div> : (
        <div className="grid three" style={{ marginTop: 14 }}>
          {lista.map((o) => {
            const nivel = nivelOrcamento(o.gasto_atual, o.limite_mensal);
            const pct = o.limite_mensal > 0 ? (o.gasto_atual / o.limite_mensal) * 100 : 0;
            const resta = o.limite_mensal - o.gasto_atual;
            return (
              <div key={o.id} className="card">
                <div className="row"><h3>{o.categoria}</h3><span className={`pill ${PILULA[nivel]}`}>{ROTULO[nivel]}</span></div>
                <div className="dbig">{brl(o.gasto_atual, true)}<span className="small muted"> de {brl(o.limite_mensal, true)}</span></div>
                <div className="meta-bar" role="progressbar" aria-label={`Gasto em ${o.categoria}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(pct))}>
                  <span style={{ width: `${Math.min(100, pct)}%`, background: COR[nivel] }} />
                </div>
                <p className="small muted" style={{ margin: "6px 0 0" }}>{Math.round(pct)}% do limite · {resta >= 0 ? `restam ${brl(resta, true)}` : `${brl(-resta, true)} acima`} neste mês</p>
                {podeEscrever && (
                  <div className="acoes" style={{ marginTop: 10 }}>
                    <details className="mini"><summary>Alterar limite</summary>
                      <form action={fin} className="fgrid mini-form">
                        <Ocultos op="orcamento.salvar" escopo="pessoal" voltar={voltar} />
                        <input type="hidden" name="categoria" value={o.categoria} />
                        <div className="field"><label>Limite mensal (R$)</label><input name="limite" inputMode="decimal" defaultValue={String(o.limite_mensal).replace(".", ",")} required /></div>
                        <Submit className="btn btn-orange btn-sm">Salvar</Submit>
                      </form>
                    </details>
                    <form action={fin}><Ocultos op="orcamento.excluir" escopo="pessoal" voltar={voltar} /><input type="hidden" name="categoria" value={o.categoria} /><Submit className="btn btn-danger btn-sm" confirm={`Remover o limite de ${o.categoria}? Fica guardado no histórico.`}>Remover</Submit></form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>O gasto é o do mês atual (despesas pessoais confirmadas, somando variações de grafia da categoria). Orçamentos existem só na área Pessoal.</p>
    </>
  );
}
