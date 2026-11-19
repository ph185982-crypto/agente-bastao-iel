// Nomes mostrados ao cliente (campanha, conjunto, anúncio): sem nome de arquivo nem ids.
/** Remove o que é técnico de um nome mostrado ao cliente: arquivos (.csv/.txt/.xlsx), números longos (ids) e sobras de separadores. */
export function limparNome(s: string): string {
  return s.replace(/\S+\.(csv|txt|xlsx?|json)\b/gi, "").replace(/\b\d{9,}\b/g, "").replace(/\s*([|·-])\s*(?=[|·-]|$)/g, "").replace(/^\s*[|·-]\s*/, "").replace(/\s{2,}/g, " ").trim();
}
