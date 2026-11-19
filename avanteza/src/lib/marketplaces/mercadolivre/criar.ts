// Criação de anúncio no Mercado Livre (site MLB): categoria sugerida, atributos da categoria, validação local dos
// obrigatórios, montagem do corpo do POST /items e tradução dos erros do ML (cause[]) para português.
// As chamadas de leitura usam o mesmo fetchJson do adapter; a escrita (POST /items + descrição) roda no executor
// (ActionType "create_listing", MercadoLivreAdapter.executeAction).
import { ApiError, fetchJson } from "../../http";
import { safeImageUrl } from "../images";
import { ML_API } from "./adapter";

type Json = Record<string, any>;
const auth = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });

export const MAX_FOTOS = 10;
export const TIPO_ANUNCIO = { classico: "gold_special", premium: "gold_pro" } as const;
export type TipoAnuncio = keyof typeof TIPO_ANUNCIO;

export interface CategoriaSugerida { categoria_id: string; categoria: string; dominio_id: string | null; dominio: string | null }

/** Preditor de categoria do ML (domain_discovery). */
export async function sugerirCategoria(token: string, q: string): Promise<CategoriaSugerida[]> {
  const u = new URL(`${ML_API}/sites/MLB/domain_discovery/search`);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "5");
  const r = await fetchJson<Json[]>(u.toString(), auth(token), { retries: 2 });
  return (Array.isArray(r) ? r : []).slice(0, 5).map((x) => ({ categoria_id: String(x.category_id), categoria: String(x.category_name ?? ""), dominio_id: x.domain_id ?? null, dominio: x.domain_name ?? null }));
}

export interface AtributoCategoria {
  id: string; nome: string; obrigatorio: boolean; de_variacao: boolean; tipo: string | null;
  valores: Array<{ id: string; nome: string }>; unidades: string[];
}

/** Obrigatório = tags.required ou tags.catalog_required (e não "somente leitura"/"fixo"). */
export function mapearAtributo(a: Json): AtributoCategoria {
  const t = a.tags ?? {};
  return {
    id: String(a.id), nome: String(a.name ?? a.id),
    obrigatorio: Boolean((t.required || t.catalog_required) && !t.read_only && !t.fixed),
    de_variacao: Boolean(t.allow_variations || t.variation_attribute),
    tipo: a.value_type ?? null,
    valores: ((a.values ?? []) as Json[]).map((v) => ({ id: String(v.id), nome: String(v.name) })),
    unidades: ((a.allowed_units ?? []) as Json[]).map((u) => String(u.name ?? u.id)).filter(Boolean),
  };
}

export async function atributosDaCategoria(token: string, categoriaId: string): Promise<{ atributos: AtributoCategoria[]; termos_venda: Array<{ id: string; nome: string; valores: string[] }> }> {
  if (!/^MLB\d{1,12}$/.test(categoriaId)) throw new Error("Categoria inválida (ex.: MLB1055).");
  const attrs = await fetchJson<Json[]>(`${ML_API}/categories/${categoriaId}/attributes`, auth(token), { retries: 2 });
  let termos: Json[] = [];
  try { termos = await fetchJson<Json[]>(`${ML_API}/categories/${categoriaId}/sale_terms`, auth(token), { retries: 1 }); } catch { /* informativo */ }
  const lista = (Array.isArray(attrs) ? attrs : []).map(mapearAtributo);
  // Obrigatórios primeiro.
  lista.sort((a, b) => Number(b.obrigatorio) - Number(a.obrigatorio));
  return {
    atributos: lista,
    termos_venda: (Array.isArray(termos) ? termos : []).map((t) => ({ id: String(t.id), nome: String(t.name ?? t.id), valores: ((t.values ?? []) as Json[]).map((v) => String(v.name)).slice(0, 8) })),
  };
}

// ─── Entrada de criação ──────────────────────────────────────────────────────

export interface AtributoEntrada { id: string; valor?: string; valor_id?: string }
export interface VariacaoEntrada { atributos: AtributoEntrada[]; preco: number; estoque: number; fotos?: string[]; sku?: string }
export interface NovoAnuncio {
  titulo: string; categoria_id: string; preco: number; estoque: number; condicao: "new" | "used"; tipo: TipoAnuncio;
  fotos: string[]; atributos: AtributoEntrada[]; descricao?: string; garantia?: { tipo: string; tempo?: string };
  variacoes?: VariacaoEntrada[]; frete_gratis?: boolean; sku?: string;
}

export interface Faltando { id: string; nome: string; exemplos: string[] }

/** Obrigatórios da categoria que não vieram (nem no anúncio, nem em todas as variações). */
export function atributosFaltando(attrs: AtributoCategoria[], a: Pick<NovoAnuncio, "atributos" | "variacoes">): Faltando[] {
  const doItem = new Set(a.atributos.filter((x) => x.valor || x.valor_id).map((x) => x.id.toUpperCase()));
  const vars = a.variacoes ?? [];
  const emTodas = (id: string) => vars.length > 0 && vars.every((v) => v.atributos.some((x) => x.id.toUpperCase() === id && (x.valor || x.valor_id)));
  return attrs
    .filter((x) => x.obrigatorio && !doItem.has(x.id.toUpperCase()) && !emTodas(x.id.toUpperCase()))
    .map((x) => ({ id: x.id, nome: x.nome, exemplos: x.valores.slice(0, 8).map((v) => v.nome) }));
}

const attrMl = (x: AtributoEntrada) => (x.valor_id ? { id: x.id.toUpperCase(), value_id: x.valor_id } : { id: x.id.toUpperCase(), value_name: x.valor });

/** Fotos por URL pública (https, validadas, sem repetição). Erro se alguma for inválida ou passar de 10. */
export function fotosValidas(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const s = safeImageUrl(u);
    if (!s) throw new Error(`Foto com endereço inválido: ${String(u).slice(0, 80)}`);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_FOTOS) throw new Error(`No máximo ${MAX_FOTOS} fotos por anúncio.`);
  return out;
}

/**
 * Corpo do POST /items. Com variações, o preço/estoque do item saem de cada variação e as fotos da variação entram
 * na lista do item (o ML liga variação ↔ foto pelo `picture_ids`, que aceita a própria URL de origem).
 */
export function montarItemMl(a: NovoAnuncio, o: { me2: boolean }): Json {
  const fotos = fotosValidas(a.fotos);
  const vars = a.variacoes ?? [];
  const fotosVar = vars.map((v) => fotosValidas(v.fotos ?? []));
  const todas = [...fotos];
  for (const fv of fotosVar) for (const f of fv) if (!todas.includes(f)) todas.push(f);
  if (!todas.length) throw new Error("Envie ao menos 1 foto (URL pública).");
  if (todas.length > MAX_FOTOS) throw new Error(`No máximo ${MAX_FOTOS} fotos por anúncio (somando as das variações).`);
  const item: Json = {
    title: a.titulo,
    category_id: a.categoria_id,
    price: vars.length ? Math.max(...vars.map((v) => v.preco)) : a.preco,
    currency_id: "BRL",
    available_quantity: vars.length ? vars.reduce((s, v) => s + v.estoque, 0) : a.estoque,
    buying_mode: "buy_it_now",
    condition: a.condicao,
    listing_type_id: TIPO_ANUNCIO[a.tipo],
    pictures: todas.map((source) => ({ source })),
    attributes: [...a.atributos.filter((x) => x.valor || x.valor_id).map(attrMl), ...(a.sku ? [{ id: "SELLER_SKU", value_name: a.sku }] : [])],
  };
  if (a.garantia) {
    item.sale_terms = [{ id: "WARRANTY_TYPE", value_name: a.garantia.tipo }, ...(a.garantia.tempo ? [{ id: "WARRANTY_TIME", value_name: a.garantia.tempo }] : [])];
  }
  if (vars.length) {
    item.variations = vars.map((v, i) => ({
      attribute_combinations: v.atributos.filter((x) => x.valor || x.valor_id).map(attrMl),
      price: v.preco,
      available_quantity: v.estoque,
      picture_ids: fotosVar[i].length ? fotosVar[i] : fotos.slice(0, 1),
      ...(v.sku ? { attributes: [{ id: "SELLER_SKU", value_name: v.sku }] } : {}),
    }));
  }
  if (o.me2) item.shipping = { mode: "me2", local_pick_up: false, free_shipping: Boolean(a.frete_gratis) };
  return item;
}

/** A conta usa Mercado Envios (me2)? Falha de leitura → false (o ML aplica o padrão da conta). */
export async function contaUsaMe2(token: string, userId: string): Promise<boolean> {
  try {
    const r = await fetchJson<Json>(`${ML_API}/users/${userId}/shipping_preferences`, auth(token), { retries: 1 });
    return Array.isArray(r?.modes) && r.modes.includes("me2");
  } catch {
    return false;
  }
}

// ─── Erros ───────────────────────────────────────────────────────────────────

/** Traduz um erro do ML (message + cause[]) para português, citando o campo. Nunca inclui token. */
export function traduzirErroMl(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message.slice(0, 300) : "Falha ao falar com o Mercado Livre.";
  if (e.status === 401) return "Token do Mercado Livre inválido ou expirado: reconecte a conta na Central (cliente → Marketplaces).";
  if (e.status === 403) return "O Mercado Livre recusou a operação (sem permissão para este anúncio/conta).";
  if (e.status === 429) return "O Mercado Livre limitou as chamadas agora. Tente de novo em alguns minutos.";
  const b = (e.body && typeof e.body === "object" ? e.body : {}) as Json;
  // /items usa cause[]; /catalog/charts usa errors[] (code, message).
  const causas = ((Array.isArray(b.cause) ? b.cause : Array.isArray(b.errors) ? b.errors : []) as Json[]).filter((c) => c && c.type !== "warning");
  const itens = causas.slice(0, 6).map((c) => {
    const campo = c.references?.[0] ?? c.code ?? "";
    return `${campo ? `${campo}: ` : ""}${String(c.message ?? c.code ?? "").slice(0, 160)}`;
  });
  const base = `O Mercado Livre recusou (${e.status}${b.error ? ` ${b.error}` : ""})`;
  if (itens.length) return `${base}: ${itens.join("; ")}`;
  // Sem causas estruturadas: devolve o corpo resumido (sem tokens; é a resposta do ML) para a pessoa ver o motivo real.
  const resto = Object.fromEntries(Object.entries(b).filter(([k]) => !["message", "error", "status"].includes(k)));
  const extra = Object.keys(resto).length ? ` · detalhes: ${JSON.stringify(resto).slice(0, 600)}` : "";
  return `${base}: ${String(b.message ?? e.message).slice(0, 200)}${extra}`;
}
