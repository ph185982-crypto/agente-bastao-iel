export const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const int = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR"));
export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
export const dec = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));
export const dt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const ago = (v: string | null | undefined) => {
  if (!v) return "—";
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
};
export const REPUTATION_LABEL: Record<string, string> = {
  "1_red": "Vermelha",
  "2_orange": "Laranja",
  "3_yellow": "Amarela",
  "4_light_green": "Verde-clara",
  "5_green": "Verde",
};
export const STATUS_LABEL: Record<string, string> = {
  proposed: "Aguardando aprovação",
  approved: "Aprovada",
  executing: "Executando",
  executed: "Executada",
  simulated: "Simulada",
  failed: "Falhou",
  rejected: "Rejeitada",
  blocked: "Bloqueada",
};
