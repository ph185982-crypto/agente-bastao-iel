import Link from "next/link";
import { Submit } from "@/components/Submit";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl } from "@/lib/dashboards/format";
import { dataHoraBr } from "@/lib/financeiro/periodo";
import type { ListaHistorico } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos, ROTULO_ENTIDADE, baseDe } from "./Comum";

export interface FiltroHist { q: string; entidade: string; acao: string; de: string; ate: string; page: number }
const ACAO = { criado: ["criado", "pill-ok"], atualizado: ["alterado", "pill-navy"], excluido: ["excluído", "pill-danger"] } as const;

export function queryHistorico(f: FiltroHist, page = f.page): string {
  const sp = new URLSearchParams();
  for (const k of ["q", "entidade", "acao", "de", "ate"] as const) if (f[k]) sp.set(k, f[k]);
  if (page > 1) sp.set("page", String(page));
  return sp.size ? `?${sp}` : "";
}

export function Historico({ f, escopo, filtros, podeEscrever, voltar }: { f: Fonte<ListaHistorico>; escopo: EscopoFin; filtros: FiltroHist; podeEscrever: boolean; voltar: string }) {
  const base = `${baseDe(escopo)}/historico`;
  const filtrado = Boolean(filtros.q || filtros.entidade || filtros.acao || filtros.de || filtros.ate);
  return (
    <>
      <p className="small muted" style={{ margin: "12px 0 0" }}>Tudo que é lançado, alterado ou excluído no financeiro fica gravado no Vendedor IA, inclusive o que o Max faz pelo WhatsApp. Lançamentos, receitas previstas e contas excluídos podem ser restaurados.</p>
      <form method="get" action={base} className="card fgrid" style={{ marginTop: 12 }} role="search">
        <div className="field"><label htmlFor="h-q">Buscar</label><input id="h-q" name="q" defaultValue={filtros.q} maxLength={120} placeholder="descrição ou id" /></div>
        <div className="field"><label htmlFor="h-ent">Tipo</label>
          <select id="h-ent" name="entidade" defaultValue={filtros.entidade}><option value="">Todos</option>
            {(f.estado === "ok" ? f.dados.entidades : Object.keys(ROTULO_ENTIDADE)).map((e) => <option key={e} value={e}>{ROTULO_ENTIDADE[e] ?? e}</option>)}
          </select></div>
        <div className="field"><label htmlFor="h-acao">Ação</label>
          <select id="h-acao" name="acao" defaultValue={filtros.acao}><option value="">Todas</option><option value="criado">Criados</option><option value="atualizado">Alterados</option><option value="excluido">Excluídos</option></select></div>
        <div className="field"><label htmlFor="h-de">De</label><input id="h-de" name="de" type="date" defaultValue={filtros.de} /></div>
        <div className="field"><label htmlFor="h-ate">Até</label><input id="h-ate" name="ate" type="date" defaultValue={filtros.ate} /></div>
        <div className="acoes"><button className="btn btn-orange btn-sm" type="submit">Filtrar</button>{filtrado && <Link className="btn btn-ghost btn-sm" href={base}>Limpar</Link>}</div>
      </form>
      {f.estado !== "ok" ? <FonteAviso f={f} /> : f.dados.itens.length === 0 ? (
        <div className="empty" role="status" style={{ marginTop: 14 }}>{filtrado ? "Nenhum registro com esses filtros." : "Nenhum registro no histórico desta área."}</div>
      ) : (
        <div className="card tbl-card" style={{ marginTop: 14 }}>
          <div className="row"><h3>Registros</h3><span className="small muted">{f.dados.total} no total · página {f.dados.pagina} de {f.dados.paginas}</span></div>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Ação</th><th>Descrição</th><th className="num">Valor</th>{podeEscrever && <th>Ações</th>}</tr></thead>
              <tbody>
                {f.dados.itens.map((i) => (
                  <tr key={i.id}>
                    <td className="nowrap">{dataHoraBr(i.criado_em)}</td>
                    <td>{ROTULO_ENTIDADE[i.entidade] ?? i.entidade}</td>
                    <td><span className={`pill ${ACAO[i.acao][1]}`}>{ACAO[i.acao][0]}</span></td>
                    <td className="ctitle">{i.descricao ?? i.entidade_id}</td>
                    <td className="num">{i.valor != null ? brl(i.valor, true) : "—"}</td>
                    {podeEscrever && (
                      <td>
                        {i.restauravel
                          ? <form action={fin}><Ocultos op="historico.restaurar" escopo={escopo} id={i.id} voltar={voltar} /><Submit className="btn btn-sm" confirm="Restaurar este item? Ele volta com os mesmos dados de antes de ser excluído.">Restaurar</Submit></form>
                          : <span className="small muted">—</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {f.dados.paginas > 1 && (
            <nav className="acoes" style={{ marginTop: 12 }} aria-label="Páginas">
              {f.dados.pagina > 1 && <Link className="btn btn-ghost btn-sm" href={`${base}${queryHistorico(filtros, f.dados.pagina - 1)}`}>‹ Mais recentes</Link>}
              {f.dados.pagina < f.dados.paginas && <Link className="btn btn-ghost btn-sm" href={`${base}${queryHistorico(filtros, f.dados.pagina + 1)}`}>Mais antigos ›</Link>}
            </nav>
          )}
        </div>
      )}
    </>
  );
}
