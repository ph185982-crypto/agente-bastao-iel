// Publicação no Mercado Livre (MLB) para TODOS os segmentos: formato automático por categoria/vendedor
// (User Products com family_name, anúncio clássico com variações ou anúncio de catálogo), atributos com mapeamento
// nome → value_id, GTIN / EMPTY_GTIN_REASON, guia de medidas (moda), fotos por URL ou upload (base64), envio,
// tipo de anúncio, prazo de fabricação e validação sem publicar (POST /items/validate).
//
// Documentação oficial conferida em 2026-11-19 (pt-BR; espelhos es/en quando o pt-BR estava incompleto):
//  - User Products / família:        https://developers.mercadolivre.com.br/pt-br/user-products
//  - Preço por variação (POST UP):   https://developers.mercadolivre.com.br/pt-br/preco-variacao
//      · vendedor no modelo novo = tag "user_product_seller" em GET /users/{id}; nesse caso o formato antigo
//        (title + array variations) dá 400. family_name obrigatório (≤ max_title_length do domínio), "title" NÃO
//        deve ser enviado (o ML gera), um item por variação (cor/tamanho), até 30 condições de venda por UP.
//  - Guia (tabela) de medidas:       https://developers.mercadolivre.com.br/pt-br/primeiros-pasos
//                                    https://developers.mercadolivre.com.br/pt-br/gerenciar-tabela-de-medida
//                                    https://developers.mercadolivre.com.br/pt-br/validacao-tabela-de-medidas
//      · domínios com guia: GET /catalog/charts/{SITE}/configurations/active_domains; busca: POST /catalog/charts/search
//        (domain_id sem prefixo, site_id, seller_id, GENDER [+ BRAND]); criação: POST /catalog/charts (names, domain_id sem
//        prefixo, site_id, main_attribute, attributes GENDER+BRAND, rows); consulta: GET /catalog/charts/{id} (rows[].id =
//        "{chart}:{n}"); no item: SIZE_GRID_ID (value_name = id da guia) e SIZE_GRID_ROW_ID (value_name = id da linha).
//  - Identificadores (GTIN):         https://developers.mercadolivre.com.br/pt-br/identificadores-de-produtos
//      · EMPTY_GTIN_REASON (lista): Artesanal, Kit, No registrado, Otro (ids 17055158..61 no exemplo da doc).
//  - Validador:                      https://developers.mercadolivre.com.br/pt-br/validador-de-publicacoes (204 = ok)
//  - Fotos (upload multipart):       https://developers.mercadolivre.com.br/pt-br/trabalhar-com-imagens
//      · POST /pictures/items/upload (campo "file"), resposta { id, variations[] }; JPG/JPEG/PNG até 10 MB.
//  - Catálogo:                       https://developers.mercadolivre.com.br/pt-br/publicacao-no-catalogo
//                                    https://developers.mercadolivre.com.br/pt-br/publicacoes-necessarias-do-catalogo
//                                    https://developers.mercadolivre.com.br/pt-br/buscador-de-produtos
//      · catalog_product_id + catalog_listing: true no POST /items; dumps /catalog/dumps/domains/MLB/catalog_required
//        e /catalog_only; busca GET /products/search?status=active&site_id=MLB&product_identifier=GTIN | q=texto.
//  - Categoria (settings):           https://developers.mercadolivre.com.br/pt-br/categorias-e-publicacoes
//      · GET /categories/{id} → settings.catalog_domain, settings.max_pictures_per_item.
//  - Prazo de fabricação:            https://developers.mercadolivre.com.br/en_us/products-sync-listings
//      · sale_terms MANUFACTURING_TIME ("20 dias"), só se a categoria listar o termo em /categories/{id}/sale_terms.
//  - Envio / dimensões do pacote:    https://developers.mercadolivre.com.br/itens-atributos-de-envio-e-dimensoes
//                                    https://developers.mercadolivre.com.br/pt-br/publicacao-de-automoveis (exemplo)
//  - Busca por SKU:                  https://developers.mercadolivre.com.br/pt-br/itens-e-buscas
//      · GET /users/{id}/items/search?seller_sku=SKU
//
// Pontos sem confirmação completa na doc estão marcados com "VERIFICAR" (lista também no relatório do commit).
import { createHash } from "node:crypto";
import { ApiError, fetchJson } from "../../http";
import { safeImageUrl } from "../images";
import { ML_API } from "./adapter";
import { contaUsaMe2, MAX_FOTOS, TIPO_ANUNCIO, traduzirErroMl, type AtributoCategoria, type AtributoEntrada, type Faltando, type TipoAnuncio } from "./criar";

type Json = Record<string, any>;
const SITE = "MLB";
const auth = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
const postJson = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(body),
});

/** Sem acento, sem caixa, espaços simples (para casar nomes de valores do ML). */
export const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const semPrefixo = (dominio: string) => dominio.replace(/^ML[A-Z]-/, "");

// ─── Cache curto (dumps públicos do ML mudam pouco) ──────────────────────────

const cache = new Map<string, { ate: number; valor: unknown }>();
async function lembrar<T>(chave: string, ms: number, f: () => Promise<T>, padrao: T): Promise<T> {
  const c = cache.get(chave);
  if (c && c.ate > Date.now()) return c.valor as T;
  let v: T;
  try { v = await f(); } catch { v = padrao; ms = Math.min(ms, 10 * 60_000); }
  cache.set(chave, { ate: Date.now() + ms, valor: v });
  return v;
}
/** Testes: limpa o cache de dumps/domínios. */
export function limparCacheMl() { cache.clear(); }

// ─── Formato por categoria ───────────────────────────────────────────────────

export type Formato = "user_products" | "variacoes" | "catalogo_obrigatorio";

export interface AnaliseCategoria {
  formato: Formato;
  categoria_id: string;
  dominio_id: string | null;
  vendedor_up: boolean;
  catalogo: "obrigatorio" | "exclusivo" | null;
  exige_guia: boolean;
  max_fotos: number;
  avisos: string[];
}

async function dominiosDoDump(token: string, tipo: "catalog_required" | "catalog_only"): Promise<Set<string>> {
  const ids = await lembrar(`dump:${tipo}`, 6 * 3600_000, async () => {
    const r = await fetchJson<Json>(`${ML_API}/catalog/dumps/domains/${SITE}/${tipo}`, auth(token), { retries: 1 });
    return ((r?.domains ?? []) as Json[]).map((d) => String(d.id ?? d.domain_id ?? ""));
  }, [] as string[]);
  return new Set(ids);
}

async function dominiosComGuia(token: string): Promise<Set<string>> {
  const ids = await lembrar("charts:active_domains", 6 * 3600_000, async () => {
    const r = await fetchJson<Json>(`${ML_API}/catalog/charts/${SITE}/configurations/active_domains`, auth(token), { retries: 1 });
    return ((r?.domains ?? []) as Json[]).map((d) => String(d.domain_id ?? ""));
  }, [] as string[]);
  return new Set(ids);
}

/** O vendedor está no modelo User Products (tag "user_product_seller" em /users/{id})? */
export async function vendedorUp(token: string, sellerId: string): Promise<boolean | null> {
  try {
    const u = await fetchJson<Json>(`${ML_API}/users/${sellerId}`, auth(token), { retries: 1 });
    return Array.isArray(u?.tags) && u.tags.includes("user_product_seller");
  } catch {
    return null;
  }
}

/**
 * Lê vendedor, categoria e dumps e decide o formato:
 *  - domínio em catalog_only/catalog_required → "catalogo_obrigatorio" (publicar com catalog_product_id);
 *  - vendedor com tag user_product_seller → "user_products" (family_name, um item por cor/tamanho);
 *  - senão → "variacoes" (modelo clássico: title + variations).
 * Guia de medidas exigida se o domínio está nos domínios ativos de guia OU a categoria tem SIZE_GRID_ID.
 */
export async function analisarCategoria(token: string, categoriaId: string, sellerId: string, atributos?: AtributoCategoria[]): Promise<AnaliseCategoria> {
  const avisos: string[] = [];
  const up = await vendedorUp(token, sellerId);
  if (up === null) avisos.push("Não consegui ler o perfil do vendedor no ML; assumi o modelo clássico (variações).");
  let cat: Json = {};
  try { cat = await fetchJson<Json>(`${ML_API}/categories/${categoriaId}`, auth(token), { retries: 1 }); } catch { avisos.push("Não consegui ler os dados da categoria (domínio)."); }
  const dominio: string | null = cat?.settings?.catalog_domain ?? null;
  const maxFotos = Math.min(MAX_FOTOS, Number(cat?.settings?.max_pictures_per_item) || MAX_FOTOS);
  let catalogo: AnaliseCategoria["catalogo"] = null;
  let exigeGuia = Boolean(atributos?.some((a) => a.id === "SIZE_GRID_ID"));
  if (dominio) {
    if ((await dominiosDoDump(token, "catalog_only")).has(dominio)) catalogo = "exclusivo";
    else if ((await dominiosDoDump(token, "catalog_required")).has(dominio)) catalogo = "obrigatorio";
    if (!exigeGuia && (await dominiosComGuia(token)).has(dominio)) exigeGuia = true;
  }
  const formato: Formato = catalogo ? "catalogo_obrigatorio" : up ? "user_products" : "variacoes";
  return { formato, categoria_id: categoriaId, dominio_id: dominio, vendedor_up: Boolean(up), catalogo, exige_guia: exigeGuia, max_fotos: maxFotos, avisos };
}

/** Formato de publicação para a categoria e o vendedor (ver analisarCategoria). */
export async function formatoDaCategoria(token: string, categoriaId: string, sellerId: string): Promise<Formato> {
  return (await analisarCategoria(token, categoriaId, sellerId)).formato;
}

// ─── Atributos ───────────────────────────────────────────────────────────────

/**
 * Atributos de lista que aceitam valor livre além da lista (o ML aceita cor/tamanho fora da lista, ex.: cor composta).
 * VERIFICAR: a API de /categories não marca "aceita valor livre"; esta lista é conservadora.
 */
const LISTA_ABERTA = new Set(["COLOR", "MAIN_COLOR", "SIZE", "MODEL", "LINE", "BRAND"]);
/** Preenchidos pela própria Central (não contam como "faltando" quando a entrada correspondente vem). */
const AUTOMATICOS = new Set(["SELLER_SKU", "SIZE_GRID_ID", "SIZE_GRID_ROW_ID", "ITEM_CONDITION"]);

export interface ResultadoAtributo { ok?: Json; erro?: string }

/** valor_id passa direto; nome → value_id pela lista do atributo (sem acento/caixa); lista fechada com nome desconhecido → erro. */
export function resolverAtributo(defs: Map<string, AtributoCategoria>, x: AtributoEntrada): ResultadoAtributo {
  const id = x.id.trim().toUpperCase();
  if (x.valor_id) return { ok: { id, value_id: x.valor_id } };
  const valor = (x.valor ?? "").trim();
  if (!valor) return { erro: `${id}: informe "valor" ou "valor_id".` };
  const d = defs.get(id);
  if (!d || !d.valores.length) return { ok: { id, value_name: valor } };
  const n = normalizar(valor);
  const achado = d.valores.find((v) => normalizar(v.nome) === n);
  if (achado) return { ok: { id, value_id: achado.id, value_name: achado.nome } };
  const fechada = (d.tipo === "list" || d.tipo === "boolean") && !LISTA_ABERTA.has(id);
  if (fechada) {
    const aceitos = d.valores.slice(0, 25).map((v) => v.nome).join(", ");
    return { erro: `${d.nome} (${id}): "${valor}" não está na lista do Mercado Livre. Aceitos: ${aceitos}${d.valores.length > 25 ? "…" : ""}.` };
  }
  return { ok: { id, value_name: valor } };
}

export function resolverAtributos(defs: Map<string, AtributoCategoria>, xs: AtributoEntrada[], erros: string[], contexto = ""): Json[] {
  const out: Json[] = [];
  for (const x of xs) {
    if (!x.valor && !x.valor_id) continue;
    const r = resolverAtributo(defs, x);
    if (r.erro) erros.push(`${contexto}${r.erro}`);
    else if (r.ok) {
      const i = out.findIndex((a) => a.id === r.ok!.id);
      if (i >= 0) out[i] = r.ok; else out.push(r.ok);
    }
  }
  return out;
}

/** Obrigatórios (required/catalog_required, sem read_only) ausentes do conjunto de ids. */
export function faltandoNoConjunto(defs: AtributoCategoria[], presentes: Set<string>): Faltando[] {
  return defs
    .filter((d) => d.obrigatorio && !presentes.has(d.id) && !AUTOMATICOS.has(d.id))
    .map((d) => ({ id: d.id, nome: d.nome, exemplos: d.valores.slice(0, 8).map((v) => v.nome) }));
}

// ─── GTIN ────────────────────────────────────────────────────────────────────

export type MotivoSemGtin = "artesanal" | "kit" | "nao_registrado" | "outro";
const MOTIVOS: Record<MotivoSemGtin, { nomes: string[]; idDoc: string }> = {
  artesanal: { nomes: ["artesanal"], idDoc: "17055158" },
  kit: { nomes: ["kit"], idDoc: "17055159" },
  nao_registrado: { nomes: ["nao registrado", "no registrado"], idDoc: "17055160" },
  outro: { nomes: ["outro", "otro"], idDoc: "17055161" },
};
/**
 * Motivo padrão quando não há GTIN nem motivo informado. A doc não define padrão; "Outro" é o motivo genérico.
 * VERIFICAR: para confecção própria (moda autoral) "Artesanal" pode ser o mais correto — informe motivo_sem_gtin.
 */
export const MOTIVO_PADRAO: MotivoSemGtin = "outro";

/** Atributo GTIN ou EMPTY_GTIN_REASON para o item (ou nada, se a categoria não usa GTIN). */
export function atributoGtin(defs: Map<string, AtributoCategoria>, gtin: string | undefined, motivo: MotivoSemGtin | undefined): Json | null {
  if (gtin) return { id: "GTIN", value_name: gtin };
  const d = defs.get("EMPTY_GTIN_REASON");
  if (!d) return null;
  const m = MOTIVOS[motivo ?? MOTIVO_PADRAO];
  const v = d.valores.find((x) => m.nomes.includes(normalizar(x.nome)));
  // Sem lista na categoria: usa o id da doc (VERIFICAR: ids iguais no MLB).
  return v ? { id: "EMPTY_GTIN_REASON", value_id: v.id, value_name: v.nome } : { id: "EMPTY_GTIN_REASON", value_id: m.idDoc };
}

// ─── Guia de medidas ─────────────────────────────────────────────────────────

export interface LinhaGuia { id: string; tamanho: string; valores: Record<string, string> }
export interface Guia { id: string; nome: string; dominio_id: string | null; tipo: string | null; atributo_principal: string | null; linhas: LinhaGuia[] }

function mapearGuia(g: Json): Guia {
  const principal: string | null = g.main_attribute_id ?? null;
  const linhas = ((g.rows ?? []) as Json[]).map((r) => {
    const valores: Record<string, string> = {};
    for (const a of (r.attributes ?? []) as Json[]) {
      const v = (a.values ?? [])[0];
      if (v?.name != null) valores[String(a.id)] = String(v.name);
    }
    return { id: String(r.id), tamanho: valores.SIZE ?? (principal ? valores[principal] : undefined) ?? Object.values(valores)[0] ?? "", valores };
  });
  const nomes = (g.names ?? {}) as Record<string, string>;
  return { id: String(g.id), nome: nomes[SITE] ?? Object.values(nomes)[0] ?? "", dominio_id: g.domain_id ?? null, tipo: g.type ?? null, atributo_principal: principal, linhas };
}

export async function lerGuia(token: string, guiaId: string): Promise<Guia> {
  if (!/^[0-9]{1,15}$/.test(guiaId)) throw new Error("guia_id inválido (só números, ex.: 463005).");
  return mapearGuia(await fetchJson<Json>(`${ML_API}/catalog/charts/${guiaId}`, auth(token), { retries: 1 }));
}

/** Linha da guia para um tamanho (pelo SIZE, pelo atributo principal ou por qualquer valor da linha). */
export function linhaDoTamanho(g: Guia, tamanho: string): LinhaGuia | null {
  const n = normalizar(tamanho);
  return g.linhas.find((l) => normalizar(l.tamanho) === n)
    ?? g.linhas.find((l) => Object.values(l.valores).some((v) => normalizar(v) === n))
    ?? null;
}

export async function buscarGuias(token: string, o: { dominio: string; sellerId: string; genero: string; marca?: string; tipo?: "SPECIFIC" | "STANDARD" | "BRAND" }): Promise<Guia[]> {
  const body: Json = {
    domain_id: semPrefixo(o.dominio), site_id: SITE, seller_id: Number(o.sellerId),
    attributes: [{ id: "GENDER", values: [{ name: o.genero }] }, ...(o.marca ? [{ id: "BRAND", values: [{ name: o.marca }] }] : [])],
    ...(o.tipo ? { type: o.tipo } : {}),
  };
  const r = await fetchJson<Json>(`${ML_API}/catalog/charts/search?limit=50`, postJson(token, body), { retries: 1 });
  return ((r?.charts ?? []) as Json[]).map(mapearGuia);
}

export interface NovaGuia {
  nome: string; dominio: string; genero: string; marca: string;
  /** Atributo principal (tamanho) da guia; moda costuma usar SIZE. VERIFICAR por domínio em technical_specs?section=grids. */
  atributo_principal: string;
  linhas: Array<{ tamanho: string; medidas: Record<string, string> }>;
}

/** Corpo do POST /catalog/charts a partir de uma tabela simples (tamanhos × medidas). */
export function montarGuia(g: NovaGuia): Json {
  const nome = g.nome.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!nome) throw new Error("Nome da guia: use letras, números e espaços (até 60).");
  if (!g.linhas.length) throw new Error("Informe ao menos uma linha (tamanho e medidas).");
  const vistos = new Set<string>();
  for (const l of g.linhas) {
    const k = normalizar(l.tamanho);
    if (vistos.has(k)) throw new Error(`Tamanho repetido na guia: ${l.tamanho}.`);
    vistos.add(k);
  }
  const principal = g.atributo_principal.toUpperCase();
  return {
    names: { [SITE]: nome },
    domain_id: semPrefixo(g.dominio),
    site_id: SITE,
    main_attribute: { attributes: [{ site_id: SITE, id: principal }] },
    attributes: [{ id: "GENDER", values: [{ name: g.genero }] }, { id: "BRAND", values: [{ name: g.marca }] }],
    rows: g.linhas.map((l) => ({
      attributes: [
        { id: principal, values: [{ name: l.tamanho }] },
        ...Object.entries(l.medidas).filter(([k]) => k.toUpperCase() !== principal).map(([k, v]) => ({ id: k.toUpperCase(), values: [{ name: String(v) }] })),
      ],
    })),
  };
}

export async function criarGuia(token: string, g: NovaGuia): Promise<Guia> {
  return mapearGuia(await fetchJson<Json>(`${ML_API}/catalog/charts`, postJson(token, montarGuia(g)), { retries: 0 }));
}

// ─── Fotos ───────────────────────────────────────────────────────────────────

export const MAX_BYTES_FOTO = 10 * 1024 * 1024;
export type FotoRef = { source: string } | { id: string };
type FotoEntrada = { tipo: "url"; url: string } | { tipo: "id"; id: string } | { tipo: "bytes"; bytes: Buffer; mime: string; hash: string };

const ID_FOTO = /^\d{1,20}-ML[A-Z]\d{1,20}_\d{4,8}$/; // ex.: 123-MLA456_112021 (formato da doc; VERIFICAR variações)

/** Tipo real pelos primeiros bytes (não confia na extensão nem no data URI). */
export function tipoDaImagem(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  if (b.length >= 12 && Buffer.from(b.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(b.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Base64 (data URI ou puro) → bytes validados: jpg/png/webp, até 10 MB. VERIFICAR: a doc lista só JPG/PNG; WEBP é aceito aqui e o ML decide. */
export function decodificarImagem(s: string, rotulo = "foto"): { bytes: Buffer; mime: string } {
  let b64 = s.trim();
  const m = /^data:([^;,]+)?(;base64)?,/i.exec(b64);
  if (m) {
    if (!m[2]) throw new Error(`${rotulo}: data URI precisa ser base64.`);
    b64 = b64.slice(m[0].length);
  }
  b64 = b64.replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw new Error(`${rotulo}: não é uma URL https nem uma imagem em base64 válida.`);
  if (b64.length > Math.ceil((MAX_BYTES_FOTO * 4) / 3) + 4) throw new Error(`${rotulo}: imagem acima de 10 MB.`);
  const bytes = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.length > MAX_BYTES_FOTO) throw new Error(`${rotulo}: imagem acima de 10 MB.`);
  const mime = tipoDaImagem(bytes);
  if (!mime) throw new Error(`${rotulo}: o arquivo não é JPG, PNG ou WEBP (conteúdo não confere).`);
  return { bytes, mime };
}

/** Classifica cada foto: URL https pública, id de foto já enviada ao ML ou imagem em base64. Erro com a posição. */
export function classificarFotos(xs: string[], contexto = ""): FotoEntrada[] {
  return xs.map((s, i) => {
    const rot = `${contexto}foto ${i + 1}`;
    const t = String(s ?? "").trim();
    if (/^https?:\/\//i.test(t) || t.startsWith("//")) {
      const u = safeImageUrl(t);
      if (!u) throw new Error(`${rot}: endereço inválido (${t.slice(0, 80)}).`);
      return { tipo: "url", url: u };
    }
    if (ID_FOTO.test(t)) return { tipo: "id", id: t };
    const { bytes, mime } = decodificarImagem(t, rot);
    return { tipo: "bytes", bytes, mime, hash: createHash("sha256").update(bytes).digest("hex") };
  });
}

/** Upload multipart para POST /pictures/items/upload; devolve o id da foto no ML. */
export async function enviarFoto(token: string, bytes: Uint8Array, mime: string): Promise<{ id: string; url: string | null }> {
  const fd = new FormData();
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  fd.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `foto.${ext}`);
  const r = await fetchJson<Json>(`${ML_API}/pictures/items/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, body: fd }, { retries: 1 });
  if (!r?.id) throw new Error("O Mercado Livre não devolveu o id da foto enviada.");
  const maior = ((r.variations ?? []) as Json[])[0];
  return { id: String(r.id), url: safeImageUrl(maior?.secure_url ?? maior?.url) };
}

/** Resolve fotos classificadas em referências do ML, enviando cada imagem base64 uma única vez (cache por hash). */
export async function resolverFotos(token: string, fs: FotoEntrada[], enviados: Map<string, string>): Promise<FotoRef[]> {
  const out: FotoRef[] = [];
  for (const f of fs) {
    let ref: FotoRef;
    if (f.tipo === "url") ref = { source: f.url };
    else if (f.tipo === "id") ref = { id: f.id };
    else {
      let id = enviados.get(f.hash);
      if (!id) {
        id = (await enviarFoto(token, f.bytes, f.mime)).id;
        enviados.set(f.hash, id);
      }
      ref = { id };
    }
    if (!out.some((x) => JSON.stringify(x) === JSON.stringify(ref))) out.push(ref);
  }
  return out;
}
const refChave = (r: FotoRef) => ("id" in r ? r.id : r.source);

// ─── Envio, termos de venda ──────────────────────────────────────────────────

export interface Envio {
  modo?: "me2" | "padrao";
  frete_gratis?: boolean;
  peso_g?: number; altura_cm?: number; largura_cm?: number; comprimento_cm?: number;
}

/**
 * Dimensões/peso do pacote como atributos SELLER_PACKAGE_* (todos juntos, erro 5400 se faltar um).
 * VERIFICAR formato: o exemplo de payload da doc usa "21 cm"/"179 g"; uma FAQ da mesma doc fala em número sem unidade.
 */
export function atributosPacote(e: Envio | undefined): Json[] {
  if (!e) return [];
  const campos = [e.altura_cm, e.largura_cm, e.comprimento_cm, e.peso_g];
  if (campos.every((x) => x === undefined)) return [];
  if (campos.some((x) => x === undefined)) throw new Error("Envio: informe juntos peso_g, altura_cm, largura_cm e comprimento_cm (o ML exige os quatro).");
  const cm = (n: number) => `${Math.round(n * 10) / 10} cm`;
  return [
    { id: "SELLER_PACKAGE_HEIGHT", value_name: cm(e.altura_cm!) },
    { id: "SELLER_PACKAGE_WIDTH", value_name: cm(e.largura_cm!) },
    { id: "SELLER_PACKAGE_LENGTH", value_name: cm(e.comprimento_cm!) },
    { id: "SELLER_PACKAGE_WEIGHT", value_name: `${Math.round(e.peso_g!)} g` },
  ];
}

export function termosDeVenda(o: { garantia?: { tipo: string; tempo?: string }; prazo_fabricacao_dias?: number }, termosCategoria: string[]): Json[] | undefined {
  const t: Json[] = [];
  if (o.garantia) t.push({ id: "WARRANTY_TYPE", value_name: o.garantia.tipo }, ...(o.garantia.tempo ? [{ id: "WARRANTY_TIME", value_name: o.garantia.tempo }] : []));
  if (o.prazo_fabricacao_dias) {
    if (termosCategoria.length && !termosCategoria.includes("MANUFACTURING_TIME")) throw new Error("Esta categoria não aceita prazo de fabricação (MANUFACTURING_TIME).");
    t.push({ id: "MANUFACTURING_TIME", value_name: `${o.prazo_fabricacao_dias} dias` });
  }
  return t.length ? t : undefined;
}

// ─── Entrada e planejamento ──────────────────────────────────────────────────

export interface ItemUp {
  cor?: string; tamanho?: string; preco: number; estoque: number; sku?: string; fotos: string[];
  gtin?: string; motivo_sem_gtin?: MotivoSemGtin; atributos: AtributoEntrada[];
}
export interface VariacaoClassica { atributos: AtributoEntrada[]; preco: number; estoque: number; fotos?: string[]; sku?: string }

/** Um produto a publicar (anúncio clássico, modelo User Products com itens, ou catálogo). */
export interface Produto {
  formato?: "user_products" | "variacoes" | "catalogo";
  categoria_id: string;
  titulo?: string; family_name?: string;
  preco?: number; estoque: number; sku?: string;
  condicao: "new" | "used"; tipo: TipoAnuncio;
  fotos: string[]; atributos: AtributoEntrada[];
  descricao?: string; garantia?: { tipo: string; tempo?: string };
  variacoes?: VariacaoClassica[]; itens?: ItemUp[];
  frete_gratis?: boolean; envio?: Envio; prazo_fabricacao_dias?: number;
  gtin?: string; motivo_sem_gtin?: MotivoSemGtin;
  guia_id?: string; catalogo_produto_id?: string;
}

export interface Unidade { sku: string | null; cor: string | null; tamanho: string | null }
export interface Carga { unidade: Unidade; item: Json; description?: string }
export interface Plano {
  formato: "user_products" | "variacoes" | "catalogo";
  analise: AnaliseCategoria;
  cargas: Carga[];
  avisos: string[];
  /** Problemas que impedem publicar QUALQUER item (nada é enviado). */
  erros?: string[];
  faltando?: Array<Faltando & { itens?: string[] }>;
}

export interface Leitores {
  atributos: (token: string, categoriaId: string) => Promise<{ atributos: AtributoCategoria[]; termos_venda: Array<{ id: string }> }>;
}

const valorDe = (xs: AtributoEntrada[], id: string) => xs.find((x) => x.id.toUpperCase() === id)?.valor;
const rotuloUnidade = (u: Unidade) => [u.sku, u.cor, u.tamanho].filter(Boolean).join(" / ") || "item";

/**
 * Lê a categoria, decide o formato e monta TODOS os corpos de POST /items, sem publicar.
 * Qualquer problema de entrada (atributo, foto, guia, obrigatório) volta em `erros`/`faltando` e nada é enviado.
 * Única escrita possível aqui: upload das fotos em base64 (necessário para ter o id), feito só depois de tudo validado.
 */
export async function planejarProduto(token: string, sellerId: string, p: Produto, leitores: Leitores, enviados: Map<string, string> = new Map()): Promise<Plano> {
  const cat = await leitores.atributos(token, p.categoria_id);
  const defs = new Map(cat.atributos.map((a) => [a.id, a]));
  const analise = await analisarCategoria(token, p.categoria_id, sellerId, cat.atributos);
  const avisos = [...analise.avisos];
  let formato: Plano["formato"];
  if (p.formato) formato = p.formato;
  else if (p.catalogo_produto_id) formato = "catalogo";
  else if (analise.formato === "catalogo_obrigatorio") {
    return {
      formato: "catalogo", analise, cargas: [], avisos,
      erros: [`O domínio ${analise.dominio_id} é de catálogo ${analise.catalogo === "exclusivo" ? "exclusivo" : "obrigatório"} no Mercado Livre: busque o produto com ml_catalogo_buscar (por GTIN ou texto) e envie catalogo_produto_id. Se não houver produto no catálogo, use formato "${analise.vendedor_up ? "user_products" : "variacoes"}" (o ML pode moderar).`],
    };
  } else formato = analise.formato as Plano["formato"];
  if (analise.catalogo && formato !== "catalogo") avisos.push(`Domínio ${analise.dominio_id} é de catálogo ${analise.catalogo}: o ML pode pedir que o anúncio entre no catálogo.`);
  if (formato === "variacoes" && analise.vendedor_up) avisos.push("Este vendedor está no modelo User Products: o ML costuma recusar anúncios com variações (use formato user_products).");

  const erros: string[] = [];
  const termos = cat.termos_venda.map((t) => t.id);

  // Unidades (um item por cor/tamanho no UP; variações no clássico).
  let itens: ItemUp[] = p.itens ?? [];
  if (!itens.length && p.variacoes?.length) {
    itens = p.variacoes.map((v) => ({
      cor: valorDe(v.atributos, "COLOR"), tamanho: valorDe(v.atributos, "SIZE"), preco: v.preco, estoque: v.estoque, sku: v.sku, fotos: v.fotos ?? [],
      atributos: v.atributos.filter((x) => !["COLOR", "SIZE"].includes(x.id.toUpperCase()) || x.valor_id),
    }));
  }
  if (!itens.length) {
    if (p.preco === undefined) erros.push("Informe o preço (preco) ou a lista de itens/variações com preço.");
    itens = [{ preco: p.preco ?? 0, estoque: p.estoque, sku: p.sku, fotos: [], gtin: p.gtin, motivo_sem_gtin: p.motivo_sem_gtin, atributos: [] }];
  }
  if (formato === "catalogo" && itens.length > 1) erros.push("Anúncio de catálogo é um item só (sem lista de itens/variações).");
  if (formato !== "variacoes") itens.forEach((i, k) => { if (!(i.estoque >= 1)) erros.push(`${i.sku ?? `item ${k + 1}`}: estoque inicial precisa ser pelo menos 1 (cada cor/tamanho é um anúncio).`); });
  else if (itens.reduce((s, i) => s + i.estoque, 0) < 1) erros.push("Estoque total precisa ser pelo menos 1.");
  if (formato === "user_products" && itens.length > 30) erros.push("No modelo User Products o ML aceita até 30 itens por produto; divida em mais de um envio.");
  const unidades: Unidade[] = itens.map((i) => ({ sku: i.sku ?? null, cor: i.cor ?? null, tamanho: i.tamanho ?? null }));
  const skus = unidades.map((u) => u.sku).filter(Boolean);
  if (new Set(skus).size !== skus.length) erros.push("SKU repetido entre os itens.");

  const nome = formato === "user_products" ? (p.family_name ?? p.titulo) : (p.titulo ?? p.family_name);
  if (formato !== "catalogo" && !nome) erros.push(formato === "user_products" ? "Informe family_name (nome genérico do produto, sem cor/tamanho)." : "Informe o título (titulo).");

  // Guia de medidas.
  let guia: Guia | null = null;
  if (formato !== "catalogo" && (analise.exige_guia || p.guia_id)) {
    if (!p.guia_id) {
      erros.push(`Esta categoria (${analise.dominio_id ?? p.categoria_id}) exige guia de medidas: use ml_guias_listar para achar uma guia da conta ou ml_guia_criar para criar, e envie guia_id.`);
    } else {
      try { guia = await lerGuia(token, p.guia_id); } catch (e) { erros.push(`Guia de medidas ${p.guia_id}: ${traduzirErroMl(e)}`); }
    }
  }

  // Atributos comuns e por item.
  const comuns = resolverAtributos(defs, p.atributos, erros);
  const pacote = (() => { try { return atributosPacote(p.envio); } catch (e) { erros.push((e as Error).message); return []; } })();
  const porItem = itens.map((i, k) => {
    const ctx = itens.length > 1 ? `${rotuloUnidade(unidades[k])}: ` : "";
    const extras: AtributoEntrada[] = [...i.atributos];
    if (i.cor) extras.push({ id: "COLOR", valor: i.cor });
    if (i.tamanho) extras.push({ id: "SIZE", valor: i.tamanho });
    const attrs = resolverAtributos(defs, extras, erros, ctx);
    let linha: LinhaGuia | null = null;
    if (guia) {
      if (!i.tamanho) erros.push(`${ctx}informe o tamanho (a guia de medidas liga cada item a uma linha).`);
      else {
        linha = linhaDoTamanho(guia, i.tamanho);
        if (!linha) erros.push(`${ctx}o tamanho "${i.tamanho}" não existe na guia ${guia.id} (tamanhos: ${guia.linhas.map((l) => l.tamanho).join(", ") || "nenhum"}).`);
      }
    }
    const gtin = atributoGtin(defs, i.gtin ?? p.gtin, i.motivo_sem_gtin ?? p.motivo_sem_gtin);
    return { attrs, linha, gtin, sku: i.sku };
  });

  // Obrigatórios.
  const faltando = new Map<string, Faltando & { itens?: string[] }>();
  if (formato !== "catalogo") {
    const baseIds = new Set([...comuns, ...pacote].map((a) => a.id));
    if (formato === "variacoes") {
      // Clássico: atributo vale se está no item ou em TODAS as variações.
      const emTodas = (id: string) => porItem.every((x) => x.attrs.some((a) => a.id === id) || (id === "GTIN" && x.gtin?.id === "GTIN"));
      const ids = new Set([...baseIds, ...cat.atributos.map((a) => a.id).filter(emTodas)]);
      if (porItem.length && porItem.every((x) => x.gtin)) ids.add(porItem[0].gtin!.id);
      for (const f of faltandoNoConjunto(cat.atributos, ids)) {
        if (f.id === "GTIN" && porItem.every((x) => x.gtin)) continue;
        faltando.set(f.id, f);
      }
    } else {
      porItem.forEach((x, k) => {
        const ids = new Set([...baseIds, ...x.attrs.map((a) => a.id), ...(x.gtin ? [x.gtin.id] : [])]);
        for (const f of faltandoNoConjunto(cat.atributos, ids)) {
          if (f.id === "GTIN" && x.gtin) continue;
          const atual = faltando.get(f.id) ?? { ...f, itens: [] };
          atual.itens!.push(rotuloUnidade(unidades[k]));
          faltando.set(f.id, atual);
        }
      });
    }
  }

  let sale_terms: Json[] | undefined;
  try { sale_terms = termosDeVenda(p, termos); } catch (e) { erros.push((e as Error).message); }

  // Fotos: classifica e valida tudo antes de qualquer upload.
  let fotosModelo: FotoEntrada[] = [];
  let fotosItens: FotoEntrada[][] = [];
  try {
    fotosModelo = classificarFotos(p.fotos);
    fotosItens = itens.map((i, k) => classificarFotos(i.fotos, itens.length > 1 ? `${rotuloUnidade(unidades[k])}: ` : ""));
  } catch (e) { erros.push((e as Error).message); }
  const chaveEntrada = (f: FotoEntrada) => (f.tipo === "url" ? f.url : f.tipo === "id" ? f.id : f.hash);
  const unicas = (fs: FotoEntrada[]) => [...new Set(fs.map(chaveEntrada))].length;
  if (!erros.length) {
    const maxF = analise.max_fotos;
    if (formato === "variacoes") {
      const total = unicas([...fotosModelo, ...fotosItens.flat()]);
      if (total > maxF) erros.push(`No máximo ${maxF} fotos por anúncio (somando as das variações); vieram ${total}.`);
      if (!total) erros.push("Envie ao menos 1 foto (URL pública, id de foto do ML ou imagem em base64).");
    } else if (formato === "user_products") {
      fotosItens.forEach((fi, k) => {
        const total = unicas([...fi, ...fotosModelo]);
        if (total > maxF) erros.push(`${rotuloUnidade(unidades[k])}: no máximo ${maxF} fotos por anúncio; vieram ${total}.`);
        if (!total) erros.push(`${rotuloUnidade(unidades[k])}: envie ao menos 1 foto (do item ou do modelo).`);
      });
    } else if (unicas(fotosModelo) > maxF) erros.push(`No máximo ${maxF} fotos por anúncio.`);
  }

  if (erros.length || faltando.size) return { formato, analise, cargas: [], avisos, erros: erros.length ? erros : undefined, faltando: faltando.size ? [...faltando.values()] : undefined };

  // Tudo validado: agora envia as fotos em base64 (uma vez cada) e monta os corpos.
  const refsModelo = await resolverFotos(token, fotosModelo, enviados);
  const refsItens: FotoRef[][] = [];
  for (const fi of fotosItens) refsItens.push(await resolverFotos(token, fi, enviados));
  const me2 = p.envio?.modo === "padrao" ? false : p.envio?.modo === "me2" ? true : await contaUsaMe2(token, sellerId);
  const freteGratis = Boolean(p.envio?.frete_gratis ?? p.frete_gratis);
  const shipping = me2 ? { mode: "me2", local_pick_up: false, free_shipping: freteGratis } : undefined;
  if (!me2 && freteGratis) avisos.push("Frete grátis pedido, mas a conta não usa Mercado Envios (me2): o ML aplica o padrão da conta.");
  const base = (): Json => ({ currency_id: "BRL", buying_mode: "buy_it_now", condition: p.condicao, listing_type_id: TIPO_ANUNCIO[p.tipo] });
  const sku = (s?: string | null) => (s ? [{ id: "SELLER_SKU", value_name: s }] : []);
  const grade = guia ? [{ id: "SIZE_GRID_ID", value_name: guia.id }] : [];
  const desc = p.descricao?.trim() ? p.descricao : undefined;
  const cargas: Carga[] = [];

  if (formato === "user_products") {
    porItem.forEach((x, k) => {
      const fotos = [...refsItens[k]];
      for (const r of refsModelo) if (!fotos.some((f) => refChave(f) === refChave(r))) fotos.push(r);
      const item: Json = {
        family_name: nome, category_id: p.categoria_id, price: itens[k].preco, available_quantity: itens[k].estoque, ...base(),
        pictures: fotos.slice(0, analise.max_fotos),
        attributes: mesclar([...comuns, ...x.attrs, ...(x.gtin ? [x.gtin] : []), ...pacote, ...grade, ...(x.linha ? [{ id: "SIZE_GRID_ROW_ID", value_name: x.linha.id }] : []), ...sku(x.sku)]),
      };
      if (sale_terms) item.sale_terms = sale_terms;
      if (shipping) item.shipping = shipping;
      cargas.push({ unidade: unidades[k], item, description: desc });
    });
  } else if (formato === "catalogo") {
    const x = porItem[0];
    const item: Json = {
      ...(p.titulo ? { title: p.titulo } : {}),
      category_id: p.categoria_id, price: itens[0].preco, available_quantity: itens[0].estoque, ...base(),
      catalog_product_id: p.catalogo_produto_id, catalog_listing: true,
      // VERIFICAR: a doc de catálogo mostra "title" e pictures vazias; vendedor UP pode exigir family_name.
      pictures: refsModelo,
      attributes: mesclar([...comuns, ...x.attrs, ...(x.gtin?.id === "GTIN" ? [x.gtin] : []), ...pacote, ...sku(x.sku)]),
    };
    if (!p.catalogo_produto_id) return { formato, analise, cargas: [], avisos, erros: ["Informe catalogo_produto_id (use ml_catalogo_buscar)."] };
    if (sale_terms) item.sale_terms = sale_terms;
    if (shipping) item.shipping = shipping;
    cargas.push({ unidade: unidades[0], item, description: desc });
  } else {
    const temVar = Boolean(p.variacoes?.length || p.itens?.length);
    const todas = [...refsModelo];
    for (const r of refsItens.flat()) if (!todas.some((f) => refChave(f) === refChave(r))) todas.push(r);
    const unico = porItem[0];
    const item: Json = {
      title: nome, category_id: p.categoria_id,
      price: temVar ? Math.max(...itens.map((i) => i.preco)) : itens[0].preco,
      available_quantity: temVar ? itens.reduce((s, i) => s + i.estoque, 0) : itens[0].estoque,
      ...base(),
      pictures: todas,
      attributes: mesclar([...comuns, ...(temVar ? [] : [...unico.attrs, ...(unico.gtin ? [unico.gtin] : [])]), ...pacote, ...grade, ...(!temVar && unico.linha ? [{ id: "SIZE_GRID_ROW_ID", value_name: unico.linha.id }] : []), ...sku(temVar ? p.sku : unico.sku ?? p.sku)]),
    };
    if (sale_terms) item.sale_terms = sale_terms;
    if (temVar) {
      item.variations = porItem.map((x, k) => {
        const fotosVar = refsItens[k].length ? refsItens[k] : todas.slice(0, 1);
        const varAttrs = [...(x.gtin ? [x.gtin] : []), ...(x.linha ? [{ id: "SIZE_GRID_ROW_ID", value_name: x.linha.id }] : []), ...sku(x.sku)];
        return {
          attribute_combinations: x.attrs, price: itens[k].preco, available_quantity: itens[k].estoque,
          picture_ids: fotosVar.map(refChave),
          ...(varAttrs.length ? { attributes: varAttrs } : {}),
        };
      });
    }
    if (shipping) item.shipping = shipping;
    cargas.push({ unidade: unidades.length === 1 ? unidades[0] : { sku: p.sku ?? null, cor: null, tamanho: null }, item, description: desc });
  }
  return { formato, analise, cargas, avisos };
}

/** Último valor de cada atributo vence (sem ids repetidos no corpo). */
function mesclar(xs: Json[]): Json[] {
  const out: Json[] = [];
  for (const a of xs) {
    const i = out.findIndex((b) => b.id === a.id);
    if (i >= 0) out[i] = a; else out.push(a);
  }
  return out;
}

// ─── Validação (sem publicar), catálogo e SKU ────────────────────────────────

/** Causas (erros, sem avisos) de uma resposta de erro do ML, em português curto com o campo. */
export function causasMl(e: unknown): string[] {
  if (!(e instanceof ApiError) || e.status === 401 || e.status === 403 || e.status === 429) return [traduzirErroMl(e)];
  const b = (e.body && typeof e.body === "object" ? e.body : {}) as Json;
  const causas = ((Array.isArray(b.cause) ? b.cause : []) as Json[]).filter((c) => c && c.type !== "warning");
  if (!causas.length) return [traduzirErroMl(e)];
  return causas.slice(0, 15).map((c) => `${c.references?.[0] ?? c.code ?? ""}${c.references?.[0] || c.code ? ": " : ""}${String(c.message ?? c.code ?? "").slice(0, 200)}`);
}

/** POST /items/validate: 204 = válido. Nada é publicado. */
export async function validarNoMl(token: string, item: Json): Promise<{ valido: boolean; erros: string[] }> {
  try {
    await fetchJson(`${ML_API}/items/validate`, postJson(token, item), { retries: 1 });
    return { valido: true, erros: [] };
  } catch (e) {
    return { valido: false, erros: causasMl(e) };
  }
}

export interface ProdutoCatalogo { id: string; nome: string; dominio_id: string | null; status: string | null; estrategia: string | null; atributos: Array<{ id: string; valor: string }> }

/** Busca no catálogo: por GTIN (product_identifier, prioridade) ou por texto (q). */
export async function buscarCatalogo(token: string, o: { gtin?: string; q?: string }): Promise<ProdutoCatalogo[]> {
  const u = new URL(`${ML_API}/products/search`);
  u.searchParams.set("status", "active");
  u.searchParams.set("site_id", SITE);
  if (o.gtin) u.searchParams.set("product_identifier", o.gtin);
  else if (o.q) u.searchParams.set("q", o.q);
  else throw new Error("Informe gtin ou texto.");
  const r = await fetchJson<Json>(u.toString(), auth(token), { retries: 1 });
  return ((r?.results ?? []) as Json[]).slice(0, 20).map((x) => ({
    id: String(x.id), nome: String(x.name ?? ""), dominio_id: x.domain_id ?? null, status: x.status ?? null, estrategia: x.settings?.listing_strategy ?? null,
    atributos: ((x.attributes ?? []) as Json[]).slice(0, 12).map((a) => ({ id: String(a.id), valor: String(a.value_name ?? "") })),
  }));
}

/**
 * Ids dos anúncios da conta com este SKU: primeiro pelo atributo SELLER_SKU (?seller_sku=), depois pelo campo antigo
 * seller_custom_field (?sku=). VERIFICAR: se ?seller_sku= acha SKU de variação (a doc fala do "campo/atributo SELLER_SKU").
 */
export async function anunciosPorSku(token: string, sellerId: string, sku: string): Promise<string[]> {
  for (const param of ["seller_sku", "sku"]) {
    const u = new URL(`${ML_API}/users/${sellerId}/items/search`);
    u.searchParams.set(param, sku);
    const r = await fetchJson<Json>(u.toString(), auth(token), { retries: 1 });
    const ids = ((r?.results ?? []) as unknown[]).map(String).filter((x) => /^[A-Z]{3}\d+$/.test(x));
    if (ids.length) return [...new Set(ids)];
  }
  return [];
}

/** Variação do anúncio com este SKU (atributo SELLER_SKU da variação ou seller_custom_field), lendo ?include_attributes=all. */
export async function variacaoPorSku(token: string, itemId: string, sku: string): Promise<{ id: string; total: number } | null> {
  const it = await fetchJson<Json>(`${ML_API}/items/${itemId}?include_attributes=all`, auth(token), { retries: 1 });
  const vars = (it?.variations ?? []) as Json[];
  const v = vars.find((x) => x.seller_custom_field === sku || ((x.attributes ?? []) as Json[]).some((a) => a.id === "SELLER_SKU" && a.value_name === sku));
  return v ? { id: String(v.id), total: vars.length } : null;
}

/** Executa tarefas com concorrência pequena, mantendo a ordem dos resultados. */
export async function emSerie<T, R>(xs: T[], concorrencia: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let prox = 0;
  const trabalhador = async () => {
    while (prox < xs.length) {
      const i = prox++;
      out[i] = await f(xs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, xs.length)) }, trabalhador));
  return out;
}

/** Domínio (settings.catalog_domain) da categoria, ex.: MLB-DRESSES. */
export async function dominioDaCategoria(token: string, categoriaId: string): Promise<string | null> {
  const c = await fetchJson<Json>(`${ML_API}/categories/${categoriaId}`, auth(token), { retries: 1 });
  return c?.settings?.catalog_domain ?? null;
}
