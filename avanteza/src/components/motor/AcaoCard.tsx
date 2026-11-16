// Cartão de uma ação do Motor (tela Hoje e aba Entregas do cliente): o que é, de quem, até quando e as ações rápidas.
// Sem JavaScript no navegador: cada ação rápida é um formulário (abre num <details>), então funciona até no celular mais simples.
import Link from "next/link";
import { Submit } from "@/components/Submit";
import { acaoRapidaForm, editarAcaoForm } from "@/app/(equipe)/operacoes/motor-actions";
import type { AcaoMotor, Pessoa } from "@/lib/motor/repo";
import { ROTULO_ORIGEM, ROTULO_PAPEL, ROTULO_PRIORIDADE, isPapel } from "@/lib/motor/tipos";
import { fmtDate } from "@/lib/mapa/progress";
import { addDaysStr } from "@/lib/mapa/plan";

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function prazoTexto(due: string | null, hoje: string): { txt: string; late: boolean } {
  if (!due) return { txt: "sem prazo", late: false };
  const d = diasEntre(hoje, due);
  if (d < 0) return { txt: `atrasada há ${-d} ${d === -1 ? "dia" : "dias"} (${fmtDate(due)})`, late: true };
  if (d === 0) return { txt: "vence hoje", late: false };
  if (d === 1) return { txt: "amanhã", late: false };
  return { txt: `até ${fmtDate(due)}`, late: false };
}

function Hidden({ id, tipo, back }: { id: string; tipo: string; back: string }) {
  return (<><input type="hidden" name="id" value={id} /><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="back" value={back} /></>);
}

export function AcaoCard({ a, hoje, equipe, back, pode, linkCliente = true, fases }: {
  a: AcaoMotor; hoje: string; equipe: Pessoa[]; back: string; pode: boolean; /** false: mostra o nome sem link (quem não abre a ficha do cliente). null: nem mostra (já está na ficha). */ linkCliente?: boolean | null; fases?: { id: string; position: number; name: string }[];
}) {
  const p = prazoTexto(a.due_date, hoje);
  const feita = a.status === "concluida";
  const parada = a.status === "bloqueada";
  const cls = ["mt-acao", feita ? "feita" : p.late ? "atrasada" : parada ? "parada" : a.priority === 1 ? "p1" : ""].filter(Boolean).join(" ");
  const checklist = Array.isArray(a.checklist) ? a.checklist : [];
  const feitos = checklist.filter((c) => c.ok).length;
  return (
    <article className={cls} id={`a-${a.id}`}>
      <div className="topo">
        <div style={{ minWidth: 0 }}>
          {linkCliente === null ? null : linkCliente ? <Link className="cli" href={`/clientes/${a.client_id}?aba=entregas`}>{a.client_name}</Link> : <span className="cli">{a.client_name}</span>}
          <div className="tit">{a.title}</div>
        </div>
        {a.status === "em_execucao" && <span className="pill pill-orange">Em execução</span>}
        {parada && <span className="pill pill-danger">Depende do cliente</span>}
        {feita && <span className="pill pill-ok">Concluída</span>}
      </div>
      <div className="meta">
        <span className={p.late ? "late" : undefined}>{p.txt}</span>
        <span>{a.owner === "cliente" ? "com o cliente" : a.assignee_name ? `com ${a.assignee_name}` : "sem responsável"}</span>
        {isPapel(a.role) && <span>{ROTULO_PAPEL[a.role]}</span>}
        {a.estimated_min ? <span>~{a.estimated_min} min</span> : null}
      </div>
      <div className="tags">
        {a.priority === 1 && <span className="pill pill-orange">Prioridade {ROTULO_PRIORIDADE[1].toLowerCase()}</span>}
        {a.ai_generated && <span className="mt-selo" title="Criada automaticamente a partir de uma conversa. Revise, edite ou desfaça.">gerado por IA</span>}
        {a.origin !== "playbook" && !a.ai_generated && <span className="pill pill-outline">{ROTULO_ORIGEM[a.origin] ?? a.origin}</span>}
        {!a.visible_to_client && <span className="pill pill-navy">interna</span>}
        {a.evidence_url && <a className="pill pill-ok" href={a.evidence_url} target="_blank" rel="noreferrer">evidência</a>}
      </div>
      {parada && a.blocked_reason && <div className="motivo"><b>Esperando:</b> {a.blocked_reason}</div>}
      {(checklist.length > 0 || (a.done_criteria && !feita)) && (
        <details className="mini chk-det" open={feitos > 0 && feitos < checklist.length}>
          <summary>{checklist.length > 0 ? `Checklist ${feitos}/${checklist.length}` : "Critério de pronto"}</summary>
      {checklist.length > 0 && (
        <ul className="chk">
          {checklist.map((c, i) => (
            <li key={i} className={c.ok ? "ok" : undefined}>
              {pode && !feita ? (
                <form action={acaoRapidaForm}>
                  <Hidden id={a.id} tipo="checklist" back={back} /><input type="hidden" name="indice" value={i} /><input type="hidden" name="ok" value={c.ok ? "0" : "1"} /><input type="hidden" name="anchor" value={`a-${a.id}`} />
                  <button aria-pressed={c.ok}><span className="box">{c.ok ? "✓" : ""}</span><span>{c.t}</span></button>
                </form>
              ) : (<span style={{ display: "inline-flex", gap: 8 }}><span className="box">{c.ok ? "✓" : ""}</span><span>{c.t}</span></span>)}
            </li>
          ))}
        </ul>
      )}
      {a.done_criteria && !feita && <div className="small muted" style={{ marginTop: 6 }}>Pronto quando: {a.done_criteria}</div>}
        </details>
      )}
      {pode && (
        <div className="acoes">
          {!feita && (
            <form action={acaoRapidaForm}><Hidden id={a.id} tipo="concluir" back={back} /><Submit className="btn btn-sm btn-orange">Concluir</Submit></form>
          )}
          {feita && (
            <form action={acaoRapidaForm}><Hidden id={a.id} tipo="reabrir" back={back} /><Submit className="btn btn-sm btn-ghost">Reabrir</Submit></form>
          )}
          {!feita && !parada && (
            <details className="mini"><summary>Depende do cliente</summary>
              <form action={acaoRapidaForm} className="mini-form stack">
                <Hidden id={a.id} tipo="bloquear" back={back} />
                <div className="field"><label htmlFor={`m-${a.id}`}>O que falta do cliente? (ele vê no Mapa)</label><input id={`m-${a.id}`} name="motivo" required minLength={3} maxLength={500} placeholder="ex.: acesso ao Mercado Livre" /></div>
                <Submit className="btn btn-sm">Marcar como dependente</Submit>
              </form>
            </details>
          )}
          {parada && (
            <form action={acaoRapidaForm}><Hidden id={a.id} tipo="desbloquear" back={back} /><Submit className="btn btn-sm btn-ghost">Cliente respondeu</Submit></form>
          )}
          {!feita && (
            <details className="mini"><summary>Adiar</summary>
              <form action={acaoRapidaForm} className="mini-form stack">
                <Hidden id={a.id} tipo="adiar" back={back} />
                <div className="field"><label htmlFor={`d-${a.id}`}>Novo prazo</label><input id={`d-${a.id}`} name="para" type="date" required defaultValue={addDaysStr(a.due_date && a.due_date > hoje ? a.due_date : hoje, 1)} /></div>
                <Submit className="btn btn-sm">Adiar</Submit>
              </form>
            </details>
          )}
          <details className="mini"><summary>Reatribuir</summary>
            <form action={acaoRapidaForm} className="mini-form stack">
              <Hidden id={a.id} tipo="reatribuir" back={back} />
              <div className="field"><label htmlFor={`r-${a.id}`}>Responsável</label>
                <select id={`r-${a.id}`} name="para" defaultValue={a.assignee_id ?? ""}><option value="">Sem responsável</option>{equipe.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select>
              </div>
              <Submit className="btn btn-sm">Salvar</Submit>
            </form>
          </details>
          <details className="mini"><summary>Evidência</summary>
            <form action={acaoRapidaForm} className="mini-form stack">
              <Hidden id={a.id} tipo="evidencia" back={back} />
              <div className="field"><label htmlFor={`e-${a.id}`}>Link (Drive, relatório, post…)</label><input id={`e-${a.id}`} name="url" type="url" required placeholder="https://" defaultValue={a.evidence_url ?? ""} /></div>
              <Submit className="btn btn-sm">Anexar</Submit>
            </form>
          </details>
          <details className="mini"><summary>Editar</summary>
            <form action={editarAcaoForm} className="mini-form stack">
              <input type="hidden" name="id" value={a.id} /><input type="hidden" name="back" value={back} />
              <div className="field"><label>Título</label><input name="title" defaultValue={a.title} required maxLength={200} /></div>
              <div className="field"><label>Descrição</label><textarea name="description" defaultValue={a.description ?? ""} style={{ minHeight: 60 }} /></div>
              <div className="fgrid">
                <div className="field"><label>Prazo</label><input name="due_date" type="date" defaultValue={a.due_date ?? ""} /></div>
                <div className="field"><label>Prioridade</label><select name="priority" defaultValue={String(a.priority)}><option value="1">Alta</option><option value="2">Média</option><option value="3">Baixa</option></select></div>
                <div className="field"><label>Quem faz</label><select name="owner" defaultValue={a.owner}><option value="avanteza">Avanteza</option><option value="cliente">Cliente</option></select></div>
                {fases && fases.length > 0 && <div className="field"><label>Fase</label><select name="phase_id" defaultValue={a.phase_id ?? ""}><option value="">Sem fase</option>{fases.map((f) => <option key={f.id} value={f.id}>Fase {f.position} · {f.name}</option>)}</select></div>}
              </div>
              {(!fases || fases.length === 0) && <input type="hidden" name="phase_id" value={a.phase_id ?? ""} />}
              <label className="check"><input type="checkbox" name="visible_to_client" defaultChecked={a.visible_to_client} /> Aparece para o cliente no Mapa</label>
              <Submit className="btn btn-sm">Salvar</Submit>
            </form>
            <div className="btn-row" style={{ marginTop: 8 }}>
              {a.ai_generated ? (
                <form action={acaoRapidaForm}><Hidden id={a.id} tipo="desfazer_ia" back={back} /><Submit className="btn btn-sm btn-danger" confirm="Desfazer esta ação criada pela IA? Ela é apagada.">Desfazer (IA)</Submit></form>
              ) : !feita ? (
                <form action={acaoRapidaForm}><Hidden id={a.id} tipo="dispensar" back={back} /><Submit className="btn btn-sm btn-danger" confirm="Dispensar esta ação? Ela some das listas e do Mapa e não volta na próxima geração.">Dispensar</Submit></form>
              ) : null}
            </div>
          </details>
        </div>
      )}
    </article>
  );
}
