import Link from "next/link";
import { requireMapa } from "@/lib/mapa/auth";
import { listActions, listPhases } from "@/lib/mapa/repo";
import { spDate } from "@/lib/dates";
import { OWNER_LABEL, STATUS_LABEL, fmtDate, isOverdue, planSummary, phaseState, PHASE_STATE_LABEL } from "@/lib/mapa/progress";
import { Flash } from "@/components/Flash";
import { updateMyAction } from "../actions";
import { DependeDeVoce } from "@/components/mapa/DependeDeVoce";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function Plano({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { scope } = await requireMapa();
  const today = spDate();
  const [phases, all] = await Promise.all([listPhases(scope), listActions(scope)]);
  const fase = one(sp.fase), status = one(sp.status), resp = one(sp.resp);
  const shown = all.filter((a) =>
    (!fase || (fase === "sem" ? !a.phase_id : a.phase_id === fase)) &&
    (!status || (status === "abertas" ? a.status !== "concluida" : a.status === status)) &&
    (!resp || a.owner === resp),
  );
  const link = (k: Record<string, string>) => {
    const q = new URLSearchParams({ ...(fase && { fase }), ...(status && { status }), ...(resp && { resp }), ...k });
    for (const [key, v] of [...q]) if (!v) q.delete(key);
    return `/mapa/plano${q.size ? `?${q}` : ""}`;
  };
  const groups = [...phases.map((p) => ({ phase: p as any, items: shown.filter((a) => a.phase_id === p.id) })), { phase: null as any, items: shown.filter((a) => !a.phase_id) }].filter((g) => g.items.length);
  const sum = planSummary(all, today);

  return (
    <>
      <Flash sp={sp} />
      <div className="eyebrow">Plano de 12 meses</div>
      <h1>Fases e <span className="accent">ações</span></h1>
      <p className="muted small" style={{ marginTop: 4 }}>{sum.done} de {sum.total} ações concluídas ({sum.pct}%){sum.overdue ? ` · ${sum.overdue} atrasada(s)` : ""}</p>
      <div id="voce"><DependeDeVoce acoes={all} hoje={today} readOnly={scope.readOnly} voltar="/mapa/plano" /></div>

      <div className="chips" aria-label="Filtrar por responsável">
        <Link className="chip" aria-current={!resp} href={link({ resp: "" })}>Todos</Link>
        <Link className="chip" aria-current={resp === "cliente"} href={link({ resp: "cliente" })}>Com você</Link>
        <Link className="chip" aria-current={resp === "avanteza"} href={link({ resp: "avanteza" })}>Com a Avanteza</Link>
      </div>
      <div className="chips" aria-label="Filtrar por situação">
        <Link className="chip" aria-current={!status} href={link({ status: "" })}>Qualquer situação</Link>
        <Link className="chip" aria-current={status === "abertas"} href={link({ status: "abertas" })}>Em aberto</Link>
        {(["planejada", "em_execucao", "concluida", "bloqueada"] as const).map((s) => <Link key={s} className="chip" aria-current={status === s} href={link({ status: s })}>{STATUS_LABEL[s]}</Link>)}
      </div>
      <div className="chips" aria-label="Filtrar por fase">
        <Link className="chip" aria-current={!fase} href={link({ fase: "" })}>Todas as fases</Link>
        {phases.map((p) => <Link key={p.id} className="chip" aria-current={fase === p.id} href={link({ fase: p.id })}>Fase {p.position}</Link>)}
      </div>

      {all.length === 0 && <div className="card muted">Seu plano ainda não foi montado. A equipe da Avanteza está preparando.</div>}
      {all.length > 0 && groups.length === 0 && <div className="card muted">Nenhuma ação com esses filtros.</div>}
      {groups.map((g) => (
        <section key={g.phase?.id ?? "sem"} className="phase" style={{ marginTop: 12 }}>
          <div className="row">
            <h3>{g.phase ? `Fase ${g.phase.position} · ${g.phase.name}` : "Ações fora das fases"}</h3>
            {g.phase && <span className="pill pill-outline">{PHASE_STATE_LABEL[phaseState(g.phase, all, today)]}</span>}
          </div>
          {g.phase && <div className="small muted">Meses {g.phase.start_month}–{g.phase.end_month} · {fmtDate(g.phase.starts_on)} a {fmtDate(g.phase.ends_on)}</div>}
          <div style={{ marginTop: 8 }}>
            {g.items.map((a) => (
              <div className="act" key={a.id} style={a.status !== "concluida" && (a.owner === "cliente" || a.status === "bloqueada") ? { borderLeft: "4px solid var(--orange)", paddingLeft: 10 } : undefined}>
                <div className="row">
                  <strong>{a.title}</strong>
                  <span className={`pill ${a.status === "concluida" ? "pill-ok" : a.status === "bloqueada" ? "pill-danger" : a.status === "em_execucao" ? "pill-orange" : "pill-sand"}`}>{STATUS_LABEL[a.status as keyof typeof STATUS_LABEL]}</span>
                </div>
                {a.description && <div className="small muted">{a.description}</div>}
                <div className="small" style={{ marginTop: 4 }}>
                  <span className="muted">{OWNER_LABEL[a.owner as "cliente"]}</span>
                  {a.due_date && <span className={isOverdue(a, today) ? "late" : "muted"}> · {isOverdue(a, today) ? "atrasada, " : "prazo "}{fmtDate(a.due_date)}</span>}
                  {a.origin === "reuniao" && a.meeting_id && <> · <Link href={`/mapa/reunioes/${a.meeting_id}`}>veio de uma reunião</Link></>}
                  {a.status === "bloqueada" && <> · <b>depende de você</b>{a.blocked_reason ? `: ${a.blocked_reason}` : ""}</>}
                  {a.evidence_url && <> · <a href={a.evidence_url} target="_blank" rel="noreferrer">ver entrega</a></>}
                </div>
                {a.owner === "cliente" && !scope.readOnly && (
                  <form action={updateMyAction} className="btn-row" style={{ marginTop: 8 }}>
                    <input type="hidden" name="action_id" value={a.id} />
                    <select name="status" defaultValue={a.status === "bloqueada" ? "planejada" : a.status} aria-label="Andamento" style={{ width: 170, minHeight: 36 }}>
                      <option value="planejada">Planejada</option><option value="em_execucao">Em execução</option><option value="concluida">Concluída</option>
                    </select>
                    <button className="btn btn-sm btn-ghost">Atualizar</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
