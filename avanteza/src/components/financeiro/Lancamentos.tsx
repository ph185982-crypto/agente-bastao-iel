import { Submit } from "@/components/Submit";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl } from "@/lib/dashboards/format";
import { ddmmaa, hojeBrasilia, mesDe } from "@/lib/financeiro/periodo";
import type { ListaTransacoes, Categorias } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos, baseDe, destinoReclassificar, rotuloArea, soData } from "./Comum";

export interface FiltrosLanc { texto: string; tipo: string; categoria: string; confirmado: string; page: number }

export function Lancamentos({ f, lista, cats, escopo, mes, podeEscrever, podeReclassificar, voltar, filtros }: {
  f: Fonte<ListaTransacoes>; lista?: ListaTransacoes; cats: Categorias | null; escopo: EscopoFin; mes: string; podeEscrever: boolean; podeReclassificar: boolean; voltar: string; filtros: FiltrosLanc;
}) {
  const todasCats = cats ? [...new Set([...cats.receitas, ...cats.despesas])].sort() : [];
  return (
    <>
      <form method="get" action={`${baseDe(escopo)}/lancamentos`} className="card filtros" role="search" aria-label="Filtrar lançamentos">
        <input type="hidden" name="mes" value={mes} />
        <div className="field"><label htmlFor="f-texto">Buscar</label><input id="f-texto" name="texto" defaultValue={filtros.texto} placeholder="Descrição" /></div>
        <div className="field"><label htmlFor="f-tipo">Tipo</label>
          <select id="f-tipo" name="tipo" defaultValue={filtros.tipo}><option value="">Todos</option><option value="receita">Receitas</option><option value="despesa">Despesas</option></select></div>
        <div className="field"><label htmlFor="f-cat">Categoria</label>
          <select id="f-cat" name="categoria" defaultValue={filtros.categoria}><option value="">Todas</option>{todasCats.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="f-conf">Situação</label>
          <select id="f-conf" name="confirmado" defaultValue={filtros.confirmado}><option value="">Todas</option><option value="true">Confirmados</option><option value="false">Não confirmados</option></select></div>
        <button className="btn btn-sm" type="submit">Filtrar</button>
      </form>

      {podeEscrever && (
        <details className="card novo" style={{ marginTop: 14 }}>
          <summary>Novo lançamento</summary>
          <form action={fin} className="fgrid">
            <Ocultos op="lancamento.criar" escopo={escopo} voltar={voltar} />
            <div className="field"><label htmlFor="n-tipo">Tipo</label><select id="n-tipo" name="tipo" defaultValue="despesa"><option value="despesa">Despesa</option><option value="receita">Receita</option></select></div>
            <div className="field"><label htmlFor="n-valor">Valor (R$)</label><input id="n-valor" name="valor" inputMode="decimal" placeholder="0,00" required /></div>
            <div className="field wide"><label htmlFor="n-desc">Descrição</label><input id="n-desc" name="descricao" maxLength={300} required /></div>
            <div className="field"><label htmlFor="n-cat">Categoria</label><input id="n-cat" name="categoria" list="cats" maxLength={80} required /><datalist id="cats">{todasCats.map((c) => <option key={c} value={c} />)}</datalist></div>
            <div className="field"><label htmlFor="n-data">Data</label><input id="n-data" name="data" type="date" defaultValue={mes === mesDe(hojeBrasilia()) ? undefined : `${mes}-01`} /></div>
            <div className="field"><label htmlFor="n-cli">Cliente (opcional)</label><input id="n-cli" name="cliente" maxLength={120} /></div>
            <Submit className="btn btn-orange btn-sm">Criar lançamento</Submit>
          </form>
        </details>
      )}

      {f.estado !== "ok" || !lista ? <FonteAviso f={f} /> : lista.transacoes.length === 0 ? (
        <div className="empty" role="status" style={{ marginTop: 14 }}>Nenhum lançamento com esses filtros em {mes.slice(5)}/{mes.slice(0, 4)}.</div>
      ) : (
        <div className="card tbl-card" style={{ marginTop: 14 }}>
          <div className="row"><h3>{lista.total} {lista.total === 1 ? "lançamento" : "lançamentos"}</h3><span className="small muted">página {lista.pagina} de {lista.paginas}</span></div>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th className="num">Valor</th>{podeEscrever && <th>Ações</th>}</tr></thead>
              <tbody>
                {lista.transacoes.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{ddmmaa(t.data_transacao)}</td>
                    <td className="ctitle">{t.descricao}{!t.confirmado && <> <span className="pill pill-outline">não confirmado</span></>}</td>
                    <td>{t.categoria}</td>
                    <td className={`num ${t.tipo === "receita" ? "pos" : "neg"}`}>{t.tipo === "receita" ? "+" : "−"} {brl(t.valor, true)}</td>
                    {podeEscrever && (
                      <td>
                        <div className="acoes">
                          {!t.confirmado && <form action={fin}><Ocultos op="lancamento.confirmar" escopo={escopo} id={t.id} voltar={voltar} /><Submit className="btn btn-sm">Confirmar</Submit></form>}
                          <details className="mini">
                            <summary>Editar</summary>
                            <form action={fin} className="fgrid mini-form">
                              <Ocultos op="lancamento.editar" escopo={escopo} id={t.id} voltar={voltar} />
                              <div className="field"><label>Tipo</label><select name="tipo" defaultValue={t.tipo}><option value="despesa">Despesa</option><option value="receita">Receita</option></select></div>
                              <div className="field"><label>Valor</label><input name="valor" inputMode="decimal" defaultValue={String(t.valor).replace(".", ",")} required /></div>
                              <div className="field wide"><label>Descrição</label><input name="descricao" defaultValue={t.descricao} required /></div>
                              <div className="field"><label>Categoria</label><input name="categoria" defaultValue={t.categoria} required /></div>
                              <div className="field"><label>Data</label><input name="data" type="date" defaultValue={soData(t.data_transacao)} required /></div>
                              <Submit className="btn btn-orange btn-sm">Salvar</Submit>
                            </form>
                          </details>
                          {podeReclassificar && (
                            <form action={fin}><Ocultos op="lancamento.reclassificar" escopo={escopo} id={t.id} voltar={voltar} para={destinoReclassificar(escopo)} />
                              <Submit className="btn btn-ghost btn-sm" confirm={`Mover este lançamento de ${rotuloArea(escopo)} para ${rotuloArea(destinoReclassificar(escopo))}? A mudança fica registrada na auditoria.`}>Mover p/ {rotuloArea(destinoReclassificar(escopo))}</Submit></form>
                          )}
                          <form action={fin}><Ocultos op="lancamento.excluir" escopo={escopo} id={t.id} voltar={voltar} /><Submit className="btn btn-danger btn-sm" confirm="Excluir este lançamento? Ele fica guardado no histórico do Vendedor IA.">Excluir</Submit></form>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lista.paginas > 1 && (
            <div className="btn-row" style={{ marginTop: 12 }}>
              {lista.pagina > 1 && <a className="btn btn-ghost btn-sm" href={`${baseDe(escopo)}/lancamentos?${new URLSearchParams({ ...(filtros.texto ? { texto: filtros.texto } : {}), ...(filtros.tipo ? { tipo: filtros.tipo } : {}), mes, page: String(lista.pagina - 1) })}`}>‹ Anterior</a>}
              {lista.pagina < lista.paginas && <a className="btn btn-ghost btn-sm" href={`${baseDe(escopo)}/lancamentos?${new URLSearchParams({ ...(filtros.texto ? { texto: filtros.texto } : {}), ...(filtros.tipo ? { tipo: filtros.tipo } : {}), mes, page: String(lista.pagina + 1) })}`}>Próxima ›</a>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
