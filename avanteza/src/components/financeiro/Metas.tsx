import { Submit } from "@/components/Submit";
import { fin } from "@/app/(equipe)/financeiro/actions";
import { brl } from "@/lib/dashboards/format";
import { ddmmaa } from "@/lib/financeiro/periodo";
import type { Meta, Resumo } from "@/lib/financeiro/vendedoria";
import type { Fonte } from "@/lib/financeiro";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import { FonteAviso, Ocultos } from "./Comum";

export function Metas({ escopo, resumo, metas, podeEscrever, voltar }: { escopo: EscopoFin; resumo: Fonte<Resumo>; metas: Fonte<Meta[]> | null; podeEscrever: boolean; voltar: string }) {
  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Meta de receita do mês</h3>
        {resumo.estado !== "ok" ? <FonteAviso f={resumo} /> : resumo.dados.meta ? (
          <>
            <div className="row"><span className="small muted">{brl(resumo.dados.meta.atual)} de {brl(resumo.dados.meta.alvo)}</span><b>{Math.round((resumo.dados.meta.atual / resumo.dados.meta.alvo) * 100)}%</b></div>
            <div className="meta-bar" role="progressbar" aria-label="Progresso da meta de receita" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((resumo.dados.meta.atual / resumo.dados.meta.alvo) * 100))}><span style={{ width: `${Math.min(100, (resumo.dados.meta.atual / resumo.dados.meta.alvo) * 100)}%` }} /></div>
          </>
        ) : <div className="empty">Sem meta mensal definida. Peça ao Max no WhatsApp para definir a meta do mês.</div>}
      </div>
      {escopo === "empresa" ? (
        <p className="small muted" style={{ marginTop: 12 }}>As metas de poupança são pessoais e ficam na área Pessoal.</p>
      ) : metas && (
        <>
          <h2>Metas de poupança</h2>
          {metas.estado !== "ok" ? <FonteAviso f={metas} /> : metas.dados.length === 0 ? <div className="empty">Nenhuma meta de poupança ativa.</div> : (
            <div className="grid dsplit equal">
              {metas.dados.map((m) => (
                <div key={m.id} className="card">
                  <div className="row"><h3>{m.descricao}</h3><span className={`pill ${m.projecao.concluida ? "pill-ok" : m.projecao.vaiBater ? "pill-ok" : "pill-danger"}`}>{m.projecao.concluida ? "concluída" : m.projecao.vaiBater ? "no ritmo" : "abaixo do ritmo"}</span></div>
                  <div className="row" style={{ marginTop: 8 }}><span className="small muted">{brl(m.atual)} de {brl(m.alvo)}</span><b>{Math.round(m.projecao.pct)}%</b></div>
                  <div className="meta-bar" role="progressbar" aria-label={`Progresso: ${m.descricao}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(m.projecao.pct))}><span style={{ width: `${Math.min(100, m.projecao.pct)}%` }} /></div>
                  <ul className="plist">
                    <li><span>Prazo</span><b>{ddmmaa(m.dataFim)}</b></li>
                    <li><span>Falta guardar</span><b>{brl(m.projecao.falta)}</b></li>
                    <li><span>Combinado por dia</span><b>{brl(m.aporteDiario, true)}</b></li>
                    <li><span>Necessário por dia para bater</span><b>{brl(m.projecao.necessarioPorDia, true)}</b></li>
                    <li><span>Projeção no prazo</span><b>{brl(m.projecao.projetadoNoPrazo)}</b></li>
                  </ul>
                  {m.ultimosAportes.length > 0 && (
                    <>
                      <h4 className="small" style={{ margin: "12px 0 4px" }}>Últimos aportes</h4>
                      <ul className="plist">
                        {m.ultimosAportes.slice(0, 4).map((a) => (
                          <li key={a.id}><span>{ddmmaa(a.data)}{a.observacao ? ` · ${a.observacao}` : ""}</span>
                            <b>{brl(a.valor, true)}{podeEscrever && a.origem !== "inicial" && (
                              <form action={fin} style={{ display: "inline" }}><Ocultos op="aporte.excluir" escopo="pessoal" id={a.id} voltar={voltar} /> <Submit className="btn btn-ghost btn-sm" confirm="Excluir este aporte?">×</Submit></form>
                            )}</b></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {podeEscrever && (
                    <details className="mini" style={{ marginTop: 10 }}><summary>Registrar aporte</summary>
                      <form action={fin} className="fgrid mini-form">
                        <Ocultos op="aporte.criar" escopo="pessoal" id={m.id} voltar={voltar} />
                        <div className="field"><label>Tipo</label><select name="tipo_aporte" defaultValue="aporte"><option value="aporte">Aporte</option><option value="retirada">Retirada</option></select></div>
                        <div className="field"><label>Valor (R$)</label><input name="valor" inputMode="decimal" required /></div>
                        <div className="field"><label>Data</label><input name="data" type="date" /></div>
                        <div className="field wide"><label>Observação</label><input name="obs" maxLength={300} /></div>
                        <Submit className="btn btn-orange btn-sm">Registrar</Submit>
                      </form>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
