// Competência mensal do Financeiro (mês de Brasília). Funções puras.
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const isMes = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isData = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Hoje em Brasília (UTC-3, sem horário de verão) como YYYY-MM-DD. */
export function hojeBrasilia(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}
export const mesDe = (data: string) => data.slice(0, 7);

export function somarMeses(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}
export function rotuloMesCurto(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1].slice(0, 3).toLowerCase()}/${String(a).slice(2)}`;
}
export function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const ddmmaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

/** Mês pedido na URL (?mes=YYYY-MM); inválido ou ausente = mês corrente. */
export function mesDaUrl(v: string | string[] | undefined, hoje = hojeBrasilia()): string {
  const s = Array.isArray(v) ? v[0] : v;
  return isMes(s) ? s : mesDe(hoje);
}
