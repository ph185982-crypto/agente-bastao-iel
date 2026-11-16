// Formatação do painel Dashboards (pt-BR). Tudo devolve texto pronto; "—" quando não há valor.
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat("pt-BR", o);
const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export const inteiro = (v: number | null | undefined) => (ok(v) ? nf({ maximumFractionDigits: 0 }).format(v) : "—");
export const decimal = (v: number | null | undefined, d = 1) => (ok(v) ? nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "—");
export const percentual = (v: number | null | undefined, d = 1) => (ok(v) ? `${decimal(v, d)}%` : "—");
export const vezes = (v: number | null | undefined) => (ok(v) ? `${decimal(v, 2)}x` : "—");

/** R$ completo (com centavos só quando pequeno) e R$ compacto para cartões estreitos e eixos de gráfico. */
export function brl(v: number | null | undefined, centavos = false): string {
  if (!ok(v)) return "—";
  return nf({ style: "currency", currency: "BRL", minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: centavos ? 2 : 0 }).format(v);
}
export function brlCompacto(v: number | null | undefined): string {
  if (!ok(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${v < 0 ? "-" : ""}R$ ${decimal(a / 1_000_000, 1)} mi`;
  if (a >= 100_000) return `${v < 0 ? "-" : ""}R$ ${decimal(a / 1000, 0)} mil`;
  return brl(v);
}
export function compacto(v: number | null | undefined): string {
  if (!ok(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${decimal(v / 1_000_000, 1)} mi`;
  if (a >= 10_000) return `${decimal(v / 1000, 0)} mil`;
  if (a >= 1000) return `${decimal(v / 1000, 1)} mil`;
  return inteiro(v);
}
export function hora(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
