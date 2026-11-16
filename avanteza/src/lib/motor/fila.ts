// Fila da tela "Hoje" e grade do Calendário. Funções PURAS.
import { addDaysStr } from "../mapa/plan";
import { DEPARTAMENTO_DO_PAPEL, isPapel, type Departamento } from "./tipos";
import { diaSemana } from "./gerador";

export interface ItemFila {
  id: string;
  client_id: string;
  title: string;
  status: string;
  due_date: string | null;
  priority: number;
  assignee_id: string | null;
  role: string | null;
  /** "cliente": a ação é do cliente (a equipe só acompanha). */
  owner?: string;
}

export interface FiltroFila {
  cliente?: string;
  /** id do responsável; "eu" já deve vir resolvido; "ninguem" = sem responsável. */
  responsavel?: string;
  departamento?: Departamento | "";
}

export interface Fila<T extends ItemFila> {
  atrasadas: T[];
  hoje: T[];
  semana: T[];
  bloqueadas: T[];
  contadores: { atrasadas: number; hoje: number; semana: number; bloqueadas: number; concluidasHoje: number };
}

const porPrioridade = <T extends ItemFila>(a: T, b: T) =>
  (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : (a.due_date ?? "9999") > (b.due_date ?? "9999") ? 1 : a.priority - b.priority || a.title.localeCompare(b.title, "pt-BR");

export function filtrar<T extends ItemFila>(itens: T[], f: FiltroFila): T[] {
  return itens.filter((a) => {
    if (f.cliente && a.client_id !== f.cliente) return false;
    if (f.responsavel === "ninguem" ? a.assignee_id !== null : f.responsavel && a.assignee_id !== f.responsavel) return false;
    if (f.departamento && !(isPapel(a.role) && DEPARTAMENTO_DO_PAPEL[a.role] === f.departamento)) return false;
    return true;
  });
}

/**
 * Prioridade de trabalho: atrasadas (mais antigas primeiro) → vencem hoje → próximos 7 dias; dentro do grupo, prioridade alta
 * primeiro. Bloqueadas e ações do próprio cliente ficam num grupo à parte ("esperando o cliente"). Concluídas não entram.
 */
export function montarFila<T extends ItemFila & { completed_at?: string | null }>(itens: T[], hoje: string, concluidasHoje = 0): Fila<T> {
  const abertas = itens.filter((a) => a.status !== "concluida");
  const esperando = (a: T) => a.status === "bloqueada" || a.owner === "cliente";
  const ativas = abertas.filter((a) => !esperando(a));
  const fim = addDaysStr(hoje, 7);
  const atrasadas = ativas.filter((a) => a.due_date && a.due_date < hoje).sort(porPrioridade);
  const deHoje = ativas.filter((a) => a.due_date === hoje).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, "pt-BR"));
  const semana = ativas.filter((a) => a.due_date && a.due_date > hoje && a.due_date <= fim).sort(porPrioridade);
  const bloqueadas = abertas.filter(esperando).sort(porPrioridade);
  return {
    atrasadas, hoje: deHoje, semana, bloqueadas,
    contadores: { atrasadas: atrasadas.length, hoje: deHoje.length, semana: semana.length, bloqueadas: bloqueadas.length, concluidasHoje },
  };
}

/** Dias do calendário: semana (segunda a domingo da data) ou mês (semanas completas que cobrem o mês). */
export function diasDoCalendario(data: string, modo: "semana" | "mes"): string[] {
  if (modo === "semana") {
    const seg = addDaysStr(data, 1 - diaSemana(data));
    return Array.from({ length: 7 }, (_, i) => addDaysStr(seg, i));
  }
  const primeiro = `${data.slice(0, 8)}01`;
  const ini = addDaysStr(primeiro, 1 - diaSemana(primeiro));
  const [y, m] = data.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const fim = addDaysStr(ultimo, 7 - diaSemana(ultimo));
  const out: string[] = [];
  for (let d = ini; d <= fim; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

export function agruparPorDia<T extends { due_date: string | null }>(itens: T[], dias: string[]): Map<string, T[]> {
  const m = new Map(dias.map((d) => [d, [] as T[]]));
  for (const a of itens) if (a.due_date && m.has(a.due_date)) m.get(a.due_date)!.push(a);
  return m;
}
