// Operações → Playbooks: serviços vendidos, tarefas-modelo (fase, papel, prazo D+n, recorrência, checklist) e
// "aplicar a clientes existentes" com prévia do que será criado. Só o administrador edita; a equipe consulta.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { fmtDate } from "@/lib/mapa/progress";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { podeEditarPlaybooks, podeVerMotor } from "@/lib/motor/acesso";
import { listarCatalogo, listarEquipe, previaDoServico, type TarefaRow } from "@/lib/motor/repo";
import { DIAS_SEMANA, PAPEIS, ROTULO_PAPEL, ROTULO_PRIORIDADE, ROTULO_RECORRENCIA, RECORRENCIAS, descreverRecorrencia, type Papel } from "@/lib/motor/tipos";
import { aplicarServicoForm, salvarPapeisForm, salvarServicoCatalogoForm, salvarTarefaForm } from "../motor-actions";
import "@/components/motor/motor.css";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Playbooks — Operações — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const KIND: Record<string, string> = { marketplace: "Marketplaces", midia: "Mídia", ambos: "Marketplaces e mídia", geral: "Todos os clientes" };
const FASES = ["", "Diagnóstico e base", "Estruturação", "Aceleração", "Escala"];

function TarefaForm({ t, playbookId, back }: { t?: TarefaRow; playbookId: string; back: string }) {
  return (
    <form action={salvarTarefaForm} className="mini-form stack">
      <input type="hidden" name="playbook_id" value={playbookId} />
      {t && <input type="hidden" name="tarefa_id" value={t.id} />}
      <input type="hidden" name="back" value={back} />
      <div className="field"><label>Título</label><input name="title" defaultValue={t?.title ?? ""} required maxLength={200} /></div>
      <div className="field"><label>Descrição</label><textarea name="description" defaultValue={t?.description ?? ""} style={{ minHeight: 56 }} /></div>
      <div className="fgrid">
        <div className="field"><label>Fase do plano</label><select name="phase_position" defaultValue={String(t?.phase_position ?? 1)}>{[1, 2, 3, 4].map((f) => <option key={f} value={f}>{f} · {FASES[f]}</option>)}</select></div>
        <div className="field"><label>Papel responsável</label><select name="role" defaultValue={t?.role ?? "gestor_conta"}>{PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}</select></div>
        <div className="field"><label>Prazo (dias após o início)</label><input name="offset_days" type="number" min={0} max={400} defaultValue={t?.offset_days ?? 7} required /></div>
        <div className="field"><label>Recorrência</label><select name="recurrence" defaultValue={t?.recurrence ?? "none"}>{RECORRENCIAS.map((r) => <option key={r} value={r}>{ROTULO_RECORRENCIA[r]}</option>)}</select></div>
        <div className="field"><label>Dia preferido (semana: 1=seg…7=dom; mês: 1–28)</label><input name="recurrence_day" type="number" min={1} max={28} defaultValue={t?.recurrence_day ?? ""} /></div>
        <div className="field"><label>Prioridade</label><select name="priority" defaultValue={String(t?.priority ?? 2)}>{([1, 2, 3] as const).map((p) => <option key={p} value={p}>{ROTULO_PRIORIDADE[p]}</option>)}</select></div>
        <div className="field"><label>Tempo estimado (min)</label><input name="estimated_min" type="number" min={0} max={2000} defaultValue={t?.estimated_min ?? ""} /></div>
      </div>
      <div className="field"><label>Checklist (um item por linha)</label><textarea name="checklist" defaultValue={(t?.checklist ?? []).join("\n")} style={{ minHeight: 70 }} /></div>
      <div className="field"><label>Critério de pronto</label><input name="done_criteria" defaultValue={t?.done_criteria ?? ""} /></div>
      <label className="check"><input type="checkbox" name="client_dependent" defaultChecked={t?.client_dependent ?? false} /> Depende do cliente (a tarefa é do cliente; aparece em “Depende de você” no Mapa)</label>
      <label className="check"><input type="checkbox" name="client_visible" defaultChecked={t?.client_visible ?? true} /> Visível ao cliente no Mapa</label>
      <label className="check"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Ativa</label>
      <Submit className="btn btn-sm btn-orange">{t ? "Salvar tarefa" : "Criar tarefa"}</Submit>
    </form>
  );
}

export default async function Playbooks({ searchParams }: { searchParams: Promise<SP> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const admin = podeEditarPlaybooks(sess);
  const { servicos, playbooks, tarefas } = await listarCatalogo();
  const atual = servicos.find((s) => s.slug === one(sp.s)) ?? servicos[0];
  const pb = atual ? playbooks.find((p) => p.service_id === atual.id) : undefined;
  const lista = pb ? tarefas.filter((t) => t.playbook_id === pb.id) : [];
  const back = `/operacoes/playbooks${atual ? `?s=${atual.slug}` : ""}`;
  const hoje = spDate();
  const previa = admin && atual && one(sp.previa) === "1" ? await previaDoServico(atual.id, hoje) : null;
  const equipe = admin ? await listarEquipe() : [];
  const unicas = lista.filter((t) => t.recurrence === "none").sort((a, b) => a.offset_days - b.offset_days);
  const recorrentes = lista.filter((t) => t.recurrence !== "none");

  const Tarefa = ({ t }: { t: TarefaRow }) => (
    <div className={`mt-tarefa ${t.active ? "" : "off"}`}>
      <div className="row">
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <strong>{t.title}</strong>
          <div className="small muted">
            {t.recurrence === "none" ? `D+${t.offset_days}` : `${descreverRecorrencia(t.recurrence, t.recurrence_day)} · a partir de D+${t.offset_days}`} · fase {t.phase_position} · {ROTULO_PAPEL[t.role as Papel] ?? t.role}
            {t.estimated_min ? ` · ~${t.estimated_min} min` : ""}
          </div>
        </div>
        <div className="btn-row" style={{ gap: 6 }}>
          {t.priority === 1 && <span className="pill pill-orange">Alta</span>}
          {t.client_dependent && <span className="pill pill-sand">Cliente</span>}
          {!t.client_visible && <span className="pill pill-navy">interna</span>}
          {!t.active && <span className="pill pill-danger">desativada</span>}
        </div>
      </div>
      {t.checklist.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>Checklist: {t.checklist.join(" · ")}</div>}
      {admin && <details className="mini" style={{ marginTop: 6 }}><summary>Editar</summary><TarefaForm t={t} playbookId={t.playbook_id} back={back} /></details>}
    </div>
  );

  return (
    <>
      <Flash sp={sp} />
      <PageHeader eyebrow="Operações" title={<>Play<span className="accent">books</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>O que a Avanteza entrega em cada serviço: tarefas, prazos e rotinas. Os clientes recebem as ações daqui.</p>
      </PageHeader>
      {servicos.length === 0 && <div className="empty">Nenhum serviço cadastrado. Rode <code>node db/seed-playbooks.mjs</code> para criar o catálogo padrão.</div>}
      <nav className="tabs" aria-label="Serviços">
        {servicos.map((s) => <Link key={s.id} href={`/operacoes/playbooks?s=${s.slug}`} aria-current={s.id === atual?.id ? "page" : undefined}>{s.name}{!s.active ? " (inativo)" : ""}</Link>)}
      </nav>

      {atual && (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row"><h3>{atual.name}</h3><span className="pill pill-outline">{KIND[atual.kind] ?? atual.kind}</span></div>
            {atual.description && <p className="muted small" style={{ margin: "4px 0 0" }}>{atual.description}</p>}
            <div className="small muted" style={{ marginTop: 6 }}>{unicas.length} tarefa(s) de prazo único · {recorrentes.length} rotina(s) recorrente(s)</div>
            {admin && (
              <details className="mini" style={{ marginTop: 10 }}><summary>Editar serviço</summary>
                <form action={salvarServicoCatalogoForm} className="mini-form stack">
                  <input type="hidden" name="service_id" value={atual.id} /><input type="hidden" name="back" value={back} />
                  <div className="field"><label>Nome</label><input name="name" defaultValue={atual.name} required /></div>
                  <div className="field"><label>Descrição</label><textarea name="description" defaultValue={atual.description ?? ""} style={{ minHeight: 56 }} /></div>
                  <div className="fgrid">
                    <div className="field"><label>Para quem</label><select name="kind" defaultValue={atual.kind}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                    <div className="field"><label>Valor mensal de referência (R$)</label><input name="default_monthly_value" type="number" step="0.01" min={0} defaultValue={atual.default_monthly_value ?? ""} /></div>
                  </div>
                  <label className="check"><input type="checkbox" name="active" defaultChecked={atual.active} /> Ativo</label>
                  <Submit className="btn btn-sm">Salvar serviço</Submit>
                </form>
              </details>
            )}
          </div>

          <h2>Tarefas de prazo único</h2>
          {unicas.length === 0 ? <div className="empty">Nenhuma.</div> : unicas.map((t) => <Tarefa key={t.id} t={t} />)}
          <h2>Rotinas recorrentes</h2>
          {recorrentes.length === 0 ? <div className="empty">Nenhuma.</div> : recorrentes.map((t) => <Tarefa key={t.id} t={t} />)}
          {admin && pb && (
            <details className="mini novo" style={{ marginTop: 12 }}><summary>Nova tarefa</summary><TarefaForm playbookId={pb.id} back={back} /></details>
          )}

          {admin && (
            <>
              <h2>Aplicar a clientes existentes</h2>
              <div className="card">
                <p className="small muted" style={{ marginTop: 0 }}>
                  Vale para quem contratou <b>{atual.name}</b> (ou, sem serviços cadastrados, para quem o tipo indica). Nada é duplicado: ações já criadas,
                  concluídas ou editadas à mão ficam como estão. As rotinas dos próximos 30 dias entram agora; a rotina diária gera o resto.
                </p>
                {!previa && <Link className="btn btn-sm btn-orange" href={`${back}&previa=1#previa`}>Ver prévia</Link>}
                {previa && (
                  <form action={aplicarServicoForm} id="previa">
                    <input type="hidden" name="back" value={back} />
                    {previa.length === 0 && <div className="empty">Nenhum cliente com este serviço.</div>}
                    <div className="mt-previa">
                      {previa.map((c) => (
                        <div key={c.id} className="mt-tarefa">
                          <label className="check"><input type="checkbox" name="client_id" value={c.id} defaultChecked={c.criar.length > 0} /> <strong>{c.name}</strong> — {c.criar.length} ação(ões) nova(s) deste serviço{c.vincular ? `, ${c.vincular} ligada(s) ao plano` : ""}{c.arquivar ? `, ${c.arquivar} arquivada(s)` : ""}</label>
                          {c.criar.length > 0 && (
                            <ul>
                              {c.criar.slice(0, 6).map((d) => <li key={d.key}>{fmtDate(d.dueDate)} · {d.title}</li>)}
                              {c.criar.length > 6 && <li className="muted">e mais {c.criar.length - 6}…</li>}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                    {previa.length > 0 && <div className="btn-row" style={{ marginTop: 12 }}><Submit className="btn btn-orange" confirm="Aplicar os playbooks aos clientes marcados?">Aplicar agora</Submit><Link className="btn btn-ghost" href={back}>Cancelar</Link></div>}
                  </form>
                )}
              </div>
            </>
          )}
        </>
      )}

      {admin && (
        <>
          <h2>Quem cobre cada papel</h2>
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>As ações novas vão para quem cobre o papel da tarefa (o responsável do serviço no cliente vale mais; sem ninguém, vai para o responsável pela conta).</p>
            {equipe.map((u) => (
              <form key={u.id} action={salvarPapeisForm} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--hairline)" }}>
                <input type="hidden" name="pessoa_id" value={u.id} /><input type="hidden" name="back" value={back} />
                <strong style={{ minWidth: 160 }}>{u.name || u.email}</strong>
                <div className="btn-row" style={{ gap: 10, flex: "1 1 300px" }}>
                  {PAPEIS.map((p) => <label key={p} className="check small"><input type="checkbox" name="papel" value={p} defaultChecked={u.delivery_roles?.includes(p)} /> {ROTULO_PAPEL[p]}</label>)}
                </div>
                <Submit className="btn btn-sm btn-ghost">Salvar</Submit>
              </form>
            ))}
          </div>
        </>
      )}
      {!admin && <p className="small muted" style={{ marginTop: 16 }}>Somente administradores editam os playbooks. Dias da semana: {DIAS_SEMANA.slice(1).join(", ")}.</p>}
    </>
  );
}
