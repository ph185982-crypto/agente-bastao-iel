// Períodos do painel Dashboards: 7, 30, 90 dias (terminando hoje) ou o mês atual (do dia 1º até hoje).
// Datas "só dia" (YYYY-MM-DD) no fuso de São Paulo. O período anterior tem o MESMO número de dias, logo antes do início.
import { addDays, spDate } from "@/lib/dates";

export const PERIODOS = ["7", "30", "90", "mes"] as const;
export type PeriodoId = (typeof PERIODOS)[number];
export const PERIODO_PADRAO: PeriodoId = "30";
export const ROTULO_PERIODO: Record<PeriodoId, string> = { "7": "7 dias", "30": "30 dias", "90": "90 dias", mes: "Mês atual" };

export interface Intervalo { de: string; ate: string }
export interface PeriodoResolvido {
  id: PeriodoId;
  atual: Intervalo & { dias: number };
  anterior: Intervalo & { dias: number };
}

export function parsePeriodo(v: string | string[] | undefined | null): PeriodoId {
  const s = Array.isArray(v) ? v[0] : v;
  return (PERIODOS as readonly string[]).includes(s ?? "") ? (s as PeriodoId) : PERIODO_PADRAO;
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000) + 1;
}

/** `hoje` é injetável para teste; o padrão é a data de São Paulo. */
export function resolverPeriodo(id: PeriodoId, hoje: string = spDate()): PeriodoResolvido {
  const de = id === "mes" ? `${hoje.slice(0, 8)}01` : addDays(hoje, -(Number(id) - 1));
  const dias = diasEntre(de, hoje);
  const antAte = addDays(de, -1);
  return { id, atual: { de, ate: hoje, dias }, anterior: { de: addDays(antAte, -(dias - 1)), ate: antAte, dias } };
}

export function listarDias(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = addDays(d, 1)) out.push(d);
  return out;
}

export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const ddmmaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Variação percentual; null = sem base de comparação (anterior zero ou ausente). */
export function variacaoPct(atual: number | null | undefined, anterior: number | null | undefined): number | null {
  if (atual == null || anterior == null || !Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  if (anterior === 0) return atual === 0 ? 0 : null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}
