// Motor de Entregas: tipos e rótulos compartilhados (sem banco, sem relógio).
export type Papel = "gestor_conta" | "marketplace" | "trafego" | "social" | "design";
export type Recorrencia = "none" | "semanal" | "quinzenal" | "mensal";
export type Prioridade = 1 | 2 | 3;
export type StatusAcao = "planejada" | "em_execucao" | "concluida" | "bloqueada";
export type Departamento = "operacoes" | "marketing";

export const PAPEIS: Papel[] = ["gestor_conta", "marketplace", "trafego", "social", "design"];
export const ROTULO_PAPEL: Record<Papel, string> = {
  gestor_conta: "Gestor da conta",
  marketplace: "Analista de marketplace",
  trafego: "Gestor de tráfego",
  social: "Social media",
  design: "Design",
};
/** Departamento de cada papel (filtro "departamento" da tela Hoje). */
export const DEPARTAMENTO_DO_PAPEL: Record<Papel, Departamento> = {
  gestor_conta: "operacoes", marketplace: "operacoes", trafego: "marketing", social: "marketing", design: "marketing",
};
export const ROTULO_DEPARTAMENTO: Record<Departamento, string> = { operacoes: "Operações", marketing: "Marketing" };

export const RECORRENCIAS: Recorrencia[] = ["none", "semanal", "quinzenal", "mensal"];
export const ROTULO_RECORRENCIA: Record<Recorrencia, string> = { none: "Uma vez", semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };
export const ROTULO_PRIORIDADE: Record<Prioridade, string> = { 1: "Alta", 2: "Média", 3: "Baixa" };
export const DIAS_SEMANA = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

export const ROTULO_ORIGEM: Record<string, string> = {
  plano: "Plano de 12 meses", reuniao: "Reunião", manual: "Manual", playbook: "Playbook", captura: "Conversa", ia: "IA",
};

export const isPapel = (v: unknown): v is Papel => typeof v === "string" && (PAPEIS as string[]).includes(v);
export const isRecorrencia = (v: unknown): v is Recorrencia => typeof v === "string" && (RECORRENCIAS as string[]).includes(v);

export function descreverRecorrencia(r: Recorrencia, dia: number | null | undefined): string {
  if (r === "none") return "Uma vez";
  if (r === "mensal") return dia ? `Mensal, dia ${dia}` : "Mensal";
  const d = dia && dia >= 1 && dia <= 7 ? DIAS_SEMANA[dia] : null;
  return d ? `${ROTULO_RECORRENCIA[r]}, ${d}` : ROTULO_RECORRENCIA[r];
}
