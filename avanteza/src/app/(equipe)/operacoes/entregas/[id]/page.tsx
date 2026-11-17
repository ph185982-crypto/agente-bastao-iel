// Ficha da entrega de um cliente: cartões por etapa, saúde, renovação e diagnóstico por pilar.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { podeEscreverEntregas, podeVerEntregas } from "@/lib/entregas/acesso";
import { clientesDoMapa, emFixture, tentar } from "@/lib/entregas";
import { COLUNAS, PILARES, ROTULO_COLUNA, ROTULO_PILAR, ROTULO_STATUS, STATUS_ENTREGA, URL_PADRAO, type Pilar, type StatusEntrega } from "@/lib/entregas/crm";
import { fmtDia, fmtDiaCurto, isoParaDia, moeda } from "@/lib/entregas/forms";
import { Flash } from "@/components/Flash";
import { GlassCard } from "@/components/shell/GlassCard";
import { FonteAviso, LinkMapa, SaudeChip } from "@/components/entregas/Blocos";
import "@/components/entregas/entregas.css";
import { entregasForm } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrega do cliente — Avanteza" };
type SP = Record<string, string | string[] | undefined>;

export default async function FichaEntrega({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sess = await requireUser();
  if (!podeVerEntregas(sess)) redirect("/central?erro=" + encodeURIComponent("Você não tem acesso ao Funil de Entrega."));
  const podeEscrever = podeEscreverEntregas(sess);
  const [fonte, usuarios] = await Promise.all([tentar((p) => p.entrega(id)), tentar((p) => p.usuarios())]);
  if (fonte.estado === "indisponivel" && fonte.codigo === "nao-encontrado") notFound();
  const voltar = `/operacoes/entregas/${encodeURIComponent(id)}`;
  const e = fonte.estado === "ok" ? fonte.dados : null;
  const mapa = e ? await clientesDoMapa([e.contato]) : new Map();
  const crmUrl = (process.env.CRM_URL?.trim() || URL_PADRAO).replace(/\/+$/, "");
  const lista = usuarios.estado === "ok" ? usuarios.dados : [];

  return (
    <>
      <Flash sp={sp} />
      <Link href="/operacoes/entregas" className="ent-voltar">‹ Funil de Entrega</Link>
      {emFixture() && <div className="notice" role="note" style={{ margin: "6px 0 10px" }}><b>Dados simulados</b> (ENTREGAS_FIXTURE).</div>}
      <FonteAviso f={fonte} />
      {e && (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">Entrega · {ROTULO_STATUS[e.status as StatusEntrega] ?? e.status}</div>
              <h1>{e.contato.nome}</h1>
              <p className="muted small" style={{ marginTop: 4 }}>{e.nome}{e.valorMensal > 0 ? ` · ${moeda(e.valorMensal)}/mês` : ""} · início {fmtDia(e.inicioEm)}{e.modelo ? ` · modelo "${e.modelo.nome}"` : ""}</p>
            </div>
            <SaudeChip r={e.saude.rotulo} nota={e.saude.nota} />
          </div>
          <div className="btn-row" style={{ alignItems: "center" }}>
            <Link className="btn btn-ghost btn-sm" href={`/operacoes/entregas?q=${encodeURIComponent(e.contato.nome)}`}>Ver no quadro</Link>
            <a className="btn btn-ghost btn-sm" href={`${crmUrl}/oportunidades?abrir=${encodeURIComponent(e.oportunidadeId)}`} target="_blank" rel="noreferrer">Oportunidade no CRM ›</a>
            <LinkMapa c={mapa.get(e.contato.id)} />
          </div>
          <div className="ent-kpis">
            <div className="kpi"><div className="label">Progresso</div><div className="value">{e.saude.progresso}%</div></div>
            <div className="kpi"><div className="label">Concluídos</div><div className="value">{e.saude.concluidos}/{e.saude.total}</div></div>
            <div className={`kpi ${e.saude.atrasados ? "alerta" : ""}`}><div className="label">Atrasados</div><div className="value">{e.saude.atrasados}</div></div>
            <div className={`kpi ${e.saude.renovacaoProxima ? "atencao" : ""}`}><div className="label">Renovação</div><div className="value" style={{ fontSize: 18 }}>{e.renovacaoEm ? (e.saude.renovacaoProxima ? `em ${Math.max(0, e.saude.diasParaRenovar ?? 0)} d` : fmtDia(e.renovacaoEm)) : "—"}</div></div>
          </div>

          <div className="ent-ficha">
            <div className="col">
              <GlassCard>
                <h2 style={{ margin: 0, fontSize: 16 }}>Cartões</h2>
                {COLUNAS.map((col) => {
                  const cs = e.cartoes.filter((c) => c.coluna === col);
                  if (!cs.length) return null;
                  return (
                    <div key={col} className="ent-bloco">
                      <div className="small muted" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{ROTULO_COLUNA[col]} · {cs.length}</div>
                      <ul className="ent-itens">
                        {cs.map((c) => {
                          const atrasado = col !== "CONCLUIDO" && c.dataAlvo && Date.parse(c.dataAlvo) < Date.now();
                          return (
                            <li key={c.id}>
                              <span className="pill pill-outline">{ROTULO_PILAR[c.pilar as Pilar] ?? c.pilar}</span>
                              <Link href={`${voltar}/${encodeURIComponent(c.id)}`}><b>{c.titulo}</b></Link>
                              {c.cliente && <span className="pill pill-sand">Do cliente</span>}
                              <span className="small muted">{c.responsavel?.nome ?? "sem responsável"}</span>
                              {c.dataAlvo && <span className={`small ${atrasado ? "ent-late" : "muted"}`}>{atrasado ? "atrasado · " : "até "}{fmtDiaCurto(c.dataAlvo)}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
                {e.cartoes.length === 0 && <p className="muted small">Esta entrega ainda não tem cartões.</p>}
              </GlassCard>

              {podeEscrever && (
                <GlassCard>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Novo cartão</h2>
                  <form action={entregasForm}>
                    <input type="hidden" name="op" value="cartao.criar" /><input type="hidden" name="entregaId" value={e.id} /><input type="hidden" name="voltar" value={voltar} />
                    <div className="fgrid">
                      <div className="field wide"><label htmlFor="n-titulo">Título</label><input id="n-titulo" name="titulo" required maxLength={200} /></div>
                      <div className="field"><label htmlFor="n-pilar">Pilar</label><select id="n-pilar" name="pilar" defaultValue="COMERCIAL">{PILARES.map((p) => <option key={p} value={p}>{ROTULO_PILAR[p]}</option>)}</select></div>
                      <div className="field"><label htmlFor="n-col">Etapa</label><select id="n-col" name="coluna" defaultValue="BACKLOG">{COLUNAS.map((c) => <option key={c} value={c}>{ROTULO_COLUNA[c]}</option>)}</select></div>
                      <div className="field"><label htmlFor="n-alvo">Prazo</label><input id="n-alvo" type="date" name="dataAlvo" /></div>
                      <div className="field"><label htmlFor="n-resp">Responsável</label><select id="n-resp" name="responsavelId" defaultValue=""><option value="">Sem responsável</option>{lista.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
                      <label className="check small"><input type="checkbox" name="cliente" /> Quem executa é o cliente</label>
                    </div>
                    <div className="btn-row" style={{ marginTop: 12 }}><button className="btn btn-orange btn-sm" type="submit">Criar cartão</button></div>
                  </form>
                </GlassCard>
              )}
            </div>

            <div className="col">
              <GlassCard>
                <h2 style={{ margin: 0, fontSize: 16 }}>Renovação e diagnóstico</h2>
                {podeEscrever ? (
                  <form action={entregasForm}>
                    <input type="hidden" name="op" value="entrega.editar" /><input type="hidden" name="entregaId" value={e.id} /><input type="hidden" name="voltar" value={voltar} />
                    <div className="fgrid">
                      <div className="field"><label htmlFor="e-status">Situação</label><select id="e-status" name="status" defaultValue={e.status}>{STATUS_ENTREGA.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}</select></div>
                      <div className="field"><label htmlFor="e-ren">Renovação</label><input id="e-ren" type="date" name="renovacaoEm" defaultValue={isoParaDia(e.renovacaoEm)} /></div>
                      <div className="field"><label htmlFor="e-fim">Fim previsto</label><input id="e-fim" type="date" name="fimPrevistoEm" defaultValue={isoParaDia(e.fimPrevistoEm)} /></div>
                      {PILARES.map((p) => (
                        <div key={p} className="field wide"><label htmlFor={`d-${p}`}>Diagnóstico · {ROTULO_PILAR[p]}</label><textarea id={`d-${p}`} name={`diag_${p}`} rows={2} maxLength={5000} defaultValue={e.diagnostico[p] ?? ""} /></div>
                      ))}
                    </div>
                    <div className="btn-row" style={{ marginTop: 12 }}><button className="btn btn-orange btn-sm" type="submit">Salvar</button></div>
                  </form>
                ) : (
                  <dl className="ent-miolo" style={{ marginTop: 10 }}>
                    <dt>Renovação</dt><dd>{fmtDia(e.renovacaoEm)}</dd>
                    <dt>Fim previsto</dt><dd>{fmtDia(e.fimPrevistoEm)}</dd>
                    {PILARES.filter((p) => e.diagnostico[p]).map((p) => <div key={p}><dt>Diagnóstico · {ROTULO_PILAR[p]}</dt><dd className="ent-diag">{e.diagnostico[p]}</dd></div>)}
                  </dl>
                )}
              </GlassCard>
              {podeEscrever && (
                <GlassCard>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Ações</h2>
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    {e.status === "EM_ANDAMENTO" && (
                      <form action={entregasForm}><input type="hidden" name="op" value="entrega.concluir" /><input type="hidden" name="entregaId" value={e.id} /><input type="hidden" name="voltar" value={voltar} /><button className="btn btn-ghost btn-sm" type="submit">Concluir entrega</button></form>
                    )}
                    <form action={entregasForm}><input type="hidden" name="op" value="entrega.upsell" /><input type="hidden" name="entregaId" value={e.id} /><input type="hidden" name="voltar" value={voltar} /><button className="btn btn-ghost btn-sm" type="submit">Abrir upsell no CRM</button></form>
                  </div>
                  <p className="small muted" style={{ margin: "8px 0 0" }}>Concluir dispara o gatilho "Entrega concluída" do CRM. O upsell cria uma oportunidade no funil de vendas.</p>
                </GlassCard>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
