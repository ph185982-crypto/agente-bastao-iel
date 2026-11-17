// Normalização do texto da busca (sem acento, minúsculo, espaços simples) e filtro local de páginas/ações rápidas.
// Puro: roda no servidor e na paleta.
import { LIMITE_PADRAO, MAX_CARACTERES, type ItemBusca } from "./tipos";

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Texto do usuário pronto para a busca: normalizado e cortado em MAX_CARACTERES. */
export function limparConsulta(q: unknown): string {
  return typeof q === "string" ? normalizar(q).slice(0, MAX_CARACTERES).trim() : "";
}

/** Padrão LIKE com %, _ e \ escapados (o texto do usuário nunca vira curinga). Use com `escape '\'`. */
export function padraoLike(q: string): string {
  return `%${normalizar(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Pontua um item para a consulta: todas as palavras precisam aparecer; começo do título vale mais. 0 = não casa. */
export function pontuar(item: Pick<ItemBusca, "titulo" | "detalhe" | "termos">, q: string): number {
  const alvo = normalizar(`${item.titulo} ${item.detalhe ?? ""} ${item.termos ?? ""}`);
  const titulo = normalizar(item.titulo);
  const palavras = normalizar(q).split(" ").filter(Boolean);
  if (!palavras.length || !palavras.every((p) => alvo.includes(p))) return 0;
  return titulo.startsWith(palavras[0]) ? 3 : titulo.includes(palavras[0]) ? 2 : 1;
}

/** Filtra e ordena uma lista local (páginas do menu, ações rápidas). */
export function filtrarLocal(itens: ItemBusca[], q: string, limite = LIMITE_PADRAO): ItemBusca[] {
  return itens
    .map((i, ordem) => ({ i, ordem, p: pontuar(i, q) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.ordem - b.ordem)
    .slice(0, limite)
    .map((x) => x.i);
}
