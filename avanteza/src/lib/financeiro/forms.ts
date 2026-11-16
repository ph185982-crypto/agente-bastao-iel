// Conversões de formulário do Financeiro (puras, testáveis).

/** "1.234,56", "R$ 1234,5" ou "1234.56" → número; vazio/ruim → NaN. */
export function parseValor(v: FormDataEntryValue | null): number {
  const s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!s) return NaN;
  // "1.234" (ponto como milhar, 3 dígitos) = 1234; "12.5" = 12,5
  const norm = s.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(norm) ? Math.round(Number(norm) * 100) / 100 : NaN;
}

