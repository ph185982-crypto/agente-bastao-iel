// Cálculos puros do plano: andamento, estado das fases e próximos marcos.
export type ActionStatus = "planejada" | "em_execucao" | "concluida" | "bloqueada";

export interface ActionLike {
  id: string;
  title: string;
  status: ActionStatus;
  owner: "avanteza" | "cliente";
  due_date: string | null;
  phase_id: string | null;
}
export interface PhaseLike {
  id: string;
  position: number;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
}

export const STATUS_LABEL: Record<ActionStatus, string> = {
  planejada: "Planejada",
  em_execucao: "Em execução",
  concluida: "Concluída",
  bloqueada: "Bloqueada",
};
export const OWNER_LABEL = { avanteza: "Avanteza", cliente: "Cliente" } as const;

export const isOpen = (a: Pick<ActionLike, "status">) => a.status !== "concluida";
export const isOverdue = (a: Pick<ActionLike, "status" | "due_date">, today: string) => isOpen(a) && Boolean(a.due_date) && a.due_date! < today;

export function planSummary(actions: Pick<ActionLike, "status" | "due_date">[], today: string) {
  const total = actions.length;
  const done = actions.filter((a) => a.status === "concluida").length;
  const overdue = actions.filter((a) => isOverdue(a, today)).length;
  const blocked = actions.filter((a) => a.status === "bloqueada").length;
  return { total, done, open: total - done, overdue, blocked, pct: total ? Math.round((done / total) * 100) : 0 };
}

export type PhaseState = "concluida" | "em_execucao" | "futura";

export function phaseState(phase: PhaseLike, actions: Pick<ActionLike, "status" | "phase_id">[], today: string): PhaseState {
  const mine = actions.filter((a) => a.phase_id === phase.id);
  if (mine.length > 0 && mine.every((a) => a.status === "concluida")) return "concluida";
  const started = mine.some((a) => a.status === "em_execucao" || a.status === "concluida");
  if (started) return "em_execucao";
  if (phase.starts_on && today < phase.starts_on) return "futura";
  return "em_execucao";
}

export const PHASE_STATE_LABEL: Record<PhaseState, string> = { concluida: "Concluída", em_execucao: "Em execução", futura: "Futura" };

/** Próximos marcos: ações em aberto mais próximas do prazo (atrasadas primeiro) e o início da próxima fase. */
export function nextMilestones(phases: PhaseLike[], actions: ActionLike[], today: string, limit = 3) {
  const open = actions
    .filter((a) => isOpen(a) && a.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0))
    .slice(0, limit)
    .map((a) => ({ kind: "acao" as const, label: a.title, date: a.due_date!, overdue: a.due_date! < today }));
  const nextPhase = [...phases]
    .filter((p) => p.starts_on && p.starts_on > today)
    .sort((a, b) => (a.starts_on! < b.starts_on! ? -1 : 1))[0];
  return { actions: open, nextPhase: nextPhase ? { name: nextPhase.name, date: nextPhase.starts_on! } : null };
}

export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
