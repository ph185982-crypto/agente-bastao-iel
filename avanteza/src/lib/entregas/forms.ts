// Utilitários dos formulários do Funil de Entrega (sem dependência de servidor).
import type { ItemChecklist } from "./crm";

export const TZ = "America/Sao_Paulo";

/** "2026-11-20" (campo date) → ISO ao meio-dia de Brasília, que cai no mesmo dia em UTC e em São Paulo. */
export const diaParaIso = (d: string) => `${d}T12:00:00-03:00`;

/** ISO → "2026-11-20" no fuso de São Paulo (para preencher campo date). */
export function isoParaDia(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "20/11/2026" no fuso de São Paulo, ou "—". */
export function fmtDia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
export function fmtDiaCurto(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
}
export function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

export const moeda = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

/** Uma linha por item: "[x] texto" (feito) ou "[ ] texto"/"texto" (a fazer). Máx. 50 itens de 200 caracteres. */
export function parseChecklist(texto: string): ItemChecklist[] {
  return texto.split(/\r?\n/).flatMap((l) => {
    const m = /^\s*(?:\[( |x|X)\]\s*)?(.*?)\s*$/.exec(l);
    const t = (m?.[2] ?? "").slice(0, 200);
    return t ? [{ texto: t, feito: m?.[1] === "x" || m?.[1] === "X" }] : [];
  }).slice(0, 50);
}
export const checklistParaTexto = (c: ItemChecklist[]) => c.map((i) => `[${i.feito ? "x" : " "}] ${i.texto}`).join("\n");
