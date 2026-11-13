// Datas no fuso de São Paulo (snapshots diários).
export const TZ = "America/Sao_Paulo";

export function spDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Início do dia (00:00 de São Paulo, UTC-3) em ISO com offset, formato aceito pelo ML. */
export function spDayStartIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000-03:00`;
}
export function spDayEndIso(dateStr: string): string {
  return `${dateStr}T23:59:59.999-03:00`;
}
