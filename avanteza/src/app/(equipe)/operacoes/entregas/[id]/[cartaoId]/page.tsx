// Ficha do cartão de entrega: dados, checklist, histórico (criação, etapas, combinados e automações) e edição.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { podeEscreverEntregas, podeVerEntregas } from "@/lib/entregas/acesso";
import { emFixture, tentar } from "@/lib/entregas";
import { COLUNAS, PILARES, ROTULO_COLUNA, ROTULO_PILAR, type Coluna, type Pilar } from "@/lib/entregas/crm";
import { checklistParaTexto, fmtDataHora, fmtDia, isoParaDia } from "@/lib/entregas/forms";
import { Flash } from "@/components/Flash";
import { GlassCard } from "@/components/shell/GlassCard";
import { FonteAviso } from "@/components/entregas/Blocos";
import "@/components/entregas/entregas.css";
import { entregasForm } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cartão de entrega — Avanteza" };
type SP = Record<string, string | string[] | undefined>;

export default async function FichaCartao({ params, searchParams }: { params: Promise<{ id: string; cartaoId: string }>; searchParams: Promise<SP> }) {
  const { id, cartaoId } = await params;
  const sp = await searchParams;
  const sess = await requireUser();
  if (!podeVerEntregas(sess)) redirect("/central?erro=" + encodeURIComponent("Você não tem acesso ao Funil de Entrega."));
  const podeEscrever = podeEscreverEntregas(sess);
  const [fonte, usuarios] = await Promise.all([tentar((p) => p.cartao(id, cartaoId)), tentar((p) => p.usuarios())]);
  if (fonte.estado === "indisponivel" && fonte.codigo === "nao-encontrado") notFound();
  const c = fonte.estado === "ok" ? fonte.dados : null;
  const voltar = `/operacoes/entregas/${encodeURIComponent(id)}/${encodeURIComponent(cartaoId)}`;
  const lista = usuarios.estado === "ok" ? usuarios.dados : [];
  const atrasado = c && c.coluna !== "CONCLUIDO" && c.dataAlvo && Date.parse(c.dataAlvo) < Date.now();

  return (
    <>
      <Flash sp={sp} />
      <Link href={`/operacoes/entregas/${encodeURIComponent(id)}`} className="ent-voltar">‹ {c ? c.entrega.contato.nome : "Entrega"}</Link>
      {emFixture() && <div className="notice" role="note" style={{ margin: "6px 0 10px" }}><b>Dados simulados</b> (ENTREGAS_FIXTURE).</div>}
      <FonteAviso f={fonte} />
      {c && (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">{ROTULO_PILAR[c.pilar as Pilar] ?? c.pilar} · {ROTULO_COLUNA[c.coluna as Coluna] ?? c.coluna}</div>
              <h1>{c.titulo}</h1>
              <p className="muted small" style={{ marginTop: 4 }}>{c.entrega.contato.nome} · {c.entrega.nome}</p>
            </div>
            {atrasado && <span className="pill pill-danger">Atrasado</span>}
          </div>
          <div className="ent-ficha">
            <div className="col">
              <GlassCard>
                <h2 style={{ margin: 0, fontSize: 16 }}>{podeEscrever ? "Editar cartão" : "Detalhes"}</h2>
                {podeEscrever ? (
                  <form action={entregasForm}>
                    <input type="hidden" name="op" value="cartao.editar" /><input type="hidden" name="entregaId" value={id} /><input type="hidden" name="cartaoId" value={cartaoId} /><input type="hidden" name="voltar" value={voltar} />
                    <div className="fgrid">
                      <div className="field wide"><label htmlFor="c-titulo">Título</label><input id="c-titulo" name="titulo" required maxLength={200} defaultValue={c.titulo} /></div>
                      <div className="field wide"><label htmlFor="c-desc">Descrição</label><textarea id="c-desc" name="descricao" rows={3} maxLength={5000} defaultValue={c.descricao ?? ""} /></div>
                      <div className="field"><label htmlFor="c-col">Etapa</label><select id="c-col" name="coluna" defaultValue={c.coluna}>{COLUNAS.map((k) => <option key={k} value={k}>{ROTULO_COLUNA[k]}</option>)}</select></div>
                      <div className="field"><label htmlFor="c-pilar">Pilar</label><select id="c-pilar" name="pilar" defaultValue={c.pilar}>{PILARES.map((p) => <option key={p} value={p}>{ROTULO_PILAR[p]}</option>)}</select></div>
                      <div className="field"><label htmlFor="c-alvo">Prazo</label><input id="c-alvo" type="date" name="dataAlvo" defaultValue={isoParaDia(c.dataAlvo)} /></div>
                      <div className="field"><label htmlFor="c-resp">Responsável</label><select id="c-resp" name="responsavelId" defaultValue={c.responsavelId ?? ""}><option value="">Sem responsável</option>{lista.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
                      <div className="field wide"><label htmlFor="c-check">Checklist (uma linha por item; [x] marca como feito)</label><textarea id="c-check" name="checklist" rows={4} defaultValue={checklistParaTexto(c.checklist)} /></div>
                      <label className="check small wide"><input type="checkbox" name="cliente" defaultChecked={c.cliente} /> Quem executa é o cliente</label>
                    </div>
                    <div className="btn-row" style={{ marginTop: 12 }}><button className="btn btn-orange btn-sm" type="submit">Salvar</button></div>
                  </form>
                ) : (
                  <>
                    {c.descricao && <p className="ent-diag" style={{ marginTop: 10 }}>{c.descricao}</p>}
                    {c.checklist.length > 0 && <ul className="ent-check">{c.checklist.map((i, n) => <li key={n}><span className={i.feito ? "ok" : "muted"} aria-hidden="true">{i.feito ? "✓" : "○"}</span><span>{i.texto}</span><span className="sr">{i.feito ? "feito" : "a fazer"}</span></li>)}</ul>}
                  </>
                )}
              </GlassCard>
              <GlassCard>
                <h2 style={{ margin: 0, fontSize: 16 }}>Histórico</h2>
                <ul className="ent-hist">
                  {c.historico.map((h, i) => <li key={i}><span className="quando">{fmtDataHora(h.em)}</span>{h.texto}</li>)}
                </ul>
              </GlassCard>
            </div>
            <div className="col">
              <GlassCard>
                <h2 style={{ margin: 0, fontSize: 16 }}>Resumo</h2>
                <dl className="ent-miolo" style={{ marginTop: 10 }}>
                  <dt>Responsável</dt><dd>{c.responsavel?.nome ?? "Sem responsável"}</dd>
                  <dt>Prazo</dt><dd className={atrasado ? "ent-late" : undefined}>{fmtDia(c.dataAlvo)}{atrasado ? " (atrasado)" : ""}</dd>
                  <dt>Na etapa desde</dt><dd>{fmtDia(c.colunaDesdeEm)}</dd>
                  <dt>Quem executa</dt><dd>{c.cliente ? "O cliente" : "A Avanteza"}</dd>
                  {c.concluidoEm && <><dt>Concluído em</dt><dd>{fmtDia(c.concluidoEm)}</dd></>}
                </dl>
                {!podeEscrever && c.checklist.length === 0 && null}
              </GlassCard>
              {c.combinados.length > 0 && (
                <GlassCard>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Combinados ligados</h2>
                  <ul className="ent-itens">{c.combinados.map((x) => <li key={x.id}><span className={`pill ${x.status === "ENTREGUE" ? "pill-ok" : "pill-outline"}`}>{x.status.toLowerCase()}</span><span>{x.descricao}</span></li>)}</ul>
                </GlassCard>
              )}
              {podeEscrever && (
                <GlassCard>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Excluir</h2>
                  <form action={entregasForm} style={{ marginTop: 10 }}>
                    <input type="hidden" name="op" value="cartao.excluir" /><input type="hidden" name="entregaId" value={id} /><input type="hidden" name="cartaoId" value={cartaoId} /><input type="hidden" name="voltar" value={voltar} />
                    <label className="check small"><input type="checkbox" required /> Confirmo a exclusão deste cartão</label>
                    <div className="btn-row" style={{ marginTop: 8 }}><button className="btn btn-danger btn-sm" type="submit">Excluir cartão</button></div>
                  </form>
                </GlassCard>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
