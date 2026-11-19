// Mercado Livre — publicação para todos os segmentos: User Products (moda, family_name, um anúncio por cor/tamanho),
// guia de medidas, atributos por nome → value_id, GTIN/EMPTY_GTIN_REASON, fotos por upload (base64), validação sem
// publicar, lotes, catálogo e alteração por SKU. NUNCA chama a API real: fetch global falso que registra cada chamada.
// DB opcional: TEST_DATABASE_URL.
import "./_sem-timers-presos";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { HAS_DB, resetSchema, closeDb, mkClient } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import { encrypt } from "../src/lib/crypto";
import { TODAS_FERRAMENTAS, executarQualquer } from "../src/lib/mcp/registro";
import type { Ator, Deps } from "../src/lib/mcp/ferramentas";
import { mapearAtributo } from "../src/lib/marketplaces/mercadolivre/criar";
import {
  atributoGtin, classificarFotos, decodificarImagem, limparCacheMl, linhaDoTamanho, montarGuia, resolverAtributo, tipoDaImagem, type Guia,
} from "../src/lib/marketplaces/mercadolivre/publicar";
import { validatePayload } from "../src/lib/executor/policy";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AVANTEZA_MCP_SECRET = "segredo-do-conector-mcp-para-testes-123";
process.env.SESSION_SECRET = "s".repeat(40);
process.env.ADMIN_EMAILS = "dono@avanteza.com.br";
const DONO = "dono@avanteza.com.br";
const dono: Ator = { email: DONO, sessao: { email: DONO, role: "admin", apps: [], name: "Dono" } };
const ML = "https://api.mercadolibre.com";
const TOKEN_ML = "APP_USR-TOKEN-ML-SECRETO-UP-123";

// ─── fetch falso ─────────────────────────────────────────────────────────────

interface Chamada { metodo: string; url: URL; corpo: any; auth: string | null }
let chamadas: Chamada[] = [];
type Resposta = { status?: number; json: unknown } | ((c: Chamada) => { status?: number; json: unknown });
let rotas: Array<[string, RegExp, Resposta]> = [];
const original = globalThis.fetch;
function instalar() {
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(u));
    const metodo = (init?.method ?? "GET").toUpperCase();
    const h = new Headers(init?.headers);
    let corpo: any = init?.body ?? null;
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { /* texto */ } }
    const c: Chamada = { metodo, url, corpo, auth: h.get("authorization") };
    chamadas.push(c);
    const alvo = `${url.origin}${url.pathname}`;
    const r = rotas.find(([m, re]) => m === metodo && re.test(alvo));
    if (!r) return new Response(JSON.stringify({ message: `sem rota falsa: ${metodo} ${alvo}` }), { status: 404 });
    const out = typeof r[2] === "function" ? r[2](c) : r[2];
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const rota = (metodo: string, re: RegExp, r: Resposta) => rotas.push([metodo, re, r]);
const posts = (caminho: RegExp) => chamadas.filter((c) => c.metodo === "POST" && caminho.test(c.url.pathname));
const sku = (b: any) => b.attributes.find((a: any) => a.id === "SELLER_SKU")?.value_name;
const attr = (b: any, id: string) => b.attributes.find((a: any) => a.id === id);

// ─── Categoria de moda falsa (Macaquinho) ────────────────────────────────────

const ATRIBUTOS_MODA = [
  { id: "BRAND", name: "Marca", tags: { required: true }, value_type: "string", values: [] },
  { id: "GENDER", name: "Gênero", tags: { required: true }, value_type: "list", values: [{ id: "339666", name: "Feminino" }, { id: "339665", name: "Masculino" }] },
  { id: "COLOR", name: "Cor", tags: { required: true, allow_variations: true }, value_type: "list", values: [{ id: "52049", name: "Preto" }, { id: "51993", name: "Rosa" }, { id: "52014", name: "Verde" }] },
  { id: "SIZE", name: "Tamanho", tags: { required: true, allow_variations: true }, value_type: "string", values: [] },
  { id: "FABRIC_TYPE", name: "Tipo de tecido", tags: {}, value_type: "list", values: [{ id: "7001", name: "Cirrê" }, { id: "7002", name: "Algodão" }, { id: "7003", name: "Viscose" }] },
  { id: "WITH_POCKETS", name: "Com bolsos", tags: {}, value_type: "boolean", values: [{ id: "242085", name: "Sim" }, { id: "242084", name: "Não" }] },
  { id: "GTIN", name: "Código universal de produto", tags: { conditional_required: true }, value_type: "string" },
  { id: "EMPTY_GTIN_REASON", name: "Motivo de GTIN vazio", tags: { conditional_required: true }, value_type: "list", values: [{ id: "17055158", name: "Artesanal" }, { id: "17055159", name: "Kit" }, { id: "17055160", name: "Não registrado" }, { id: "17055161", name: "Outro" }] },
  { id: "SIZE_GRID_ID", name: "ID da guia de tamanhos", tags: {}, value_type: "grid_id" },
  { id: "SIZE_GRID_ROW_ID", name: "ID da linha da guia", tags: { variation_attribute: true }, value_type: "grid_row_id" },
  { id: "SELLER_SKU", name: "SKU", tags: {}, value_type: "string" },
];
const GUIA = {
  id: "5001", names: { MLB: "Guia Macaquinho Feminino" }, domain_id: "JUMPSUITS", type: "SPECIFIC", main_attribute_id: "SIZE",
  rows: ["P", "M", "G"].map((t, i) => ({ id: `5001:${i + 1}`, attributes: [{ id: "SIZE", values: [{ name: t }] }, { id: "CHEST_CIRCUMFERENCE", values: [{ name: `${84 + i * 4} cm` }] }] })),
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 200 }, (_, i) => i % 256)]);
const JPEG_URI = `data:image/jpeg;base64,${JPEG.toString("base64")}`;
const CORES = ["Preto", "Rosa", "Verde"];
const TAMANHOS = ["P", "M", "G"];
const itensMacaquinho = () => CORES.flatMap((cor) => TAMANHOS.map((tamanho) => ({
  cor, tamanho, preco: cor === "Verde" ? 139.9 : 129.9, estoque: 4, sku: `MCB-${cor.toUpperCase()}-${tamanho}`, fotos: [`https://fotos.test/macaquinho-${cor.toLowerCase()}.jpg`],
})));
const macaquinho = (extra: Record<string, unknown> = {}) => ({
  cliente: "Moda Cirrê", family_name: "Macaquinho Cirrê com Bolsos", categoria_id: "MLB2", tipo: "premium",
  atributos: [{ id: "BRAND", valor: "Ateliê Cirrê" }, { id: "GENDER", valor: "feminino" }, { id: "FABRIC_TYPE", valor: "cirre" }, { id: "WITH_POCKETS", valor: "sim" }],
  guia_id: "5001", fotos: [JPEG_URI], descricao: "Macaquinho em cirrê com bolsos laterais.\nTecido com brilho.",
  envio: { frete_gratis: true, peso_g: 300, altura_cm: 5, largura_cm: 25, comprimento_cm: 30 }, prazo_fabricacao_dias: 5,
  itens: itensMacaquinho(), ...extra,
});

let proximoId = 9000;
/** Rotas da categoria de moda + conta UP; `falharSku` faz o POST /items daquele SKU voltar 400. */
function rotasModa(o: { falharSku?: string; dominiosGuia?: string[]; up?: boolean } = {}) {
  rota("GET", /\/users\/111$/, { json: { id: 111, nickname: "MODACIRRE", tags: ["normal", ...(o.up === false ? [] : ["user_product_seller"])] } });
  rota("GET", /\/categories\/MLB2$/, { json: { id: "MLB2", name: "Macacões", settings: { catalog_domain: "MLB-JUMPSUITS", max_pictures_per_item: 12 } } });
  rota("GET", /\/categories\/MLB2\/attributes$/, { json: ATRIBUTOS_MODA });
  rota("GET", /\/categories\/MLB2\/sale_terms$/, { json: [{ id: "WARRANTY_TYPE", name: "Tipo de garantia" }, { id: "MANUFACTURING_TIME", name: "Tempo de fabricação" }] });
  rota("GET", /\/catalog\/dumps\/domains\/MLB\/catalog_only$/, { json: { domains: [] } });
  rota("GET", /\/catalog\/dumps\/domains\/MLB\/catalog_required$/, { json: { domains: [{ id: "MLB-CELLPHONES" }] } });
  rota("GET", /\/catalog\/charts\/MLB\/configurations\/active_domains$/, { json: { domains: (o.dominiosGuia ?? ["MLB-JUMPSUITS"]).map((d) => ({ domain_id: d })) } });
  rota("GET", /\/catalog\/charts\/5001$/, { json: GUIA });
  rota("GET", /\/users\/111\/shipping_preferences$/, { json: { modes: ["me2", "custom"] } });
  rota("POST", /\/pictures\/items\/upload$/, { json: { id: "123-MLB456_112026", variations: [{ size: "1200x1200", secure_url: "https://http2.mlstatic.com/D_NQ_NP_123-MLB456_112026-F.jpg" }] } });
  rota("POST", /\/items$/, (c) => {
    if (o.falharSku && sku(c.corpo) === o.falharSku) return { status: 400, json: { message: "Validation error", error: "validation_error", cause: [{ type: "error", code: "item.price.invalid", references: ["item.price"], message: "price is invalid" }] } };
    const id = `MLB${proximoId++}`;
    return { status: 201, json: { id, status: "active", permalink: `https://produto.mercadolivre.com.br/${id}`, family_name: c.corpo.family_name, user_product_id: "MLBU1000", title: `Macaquinho ${sku(c.corpo)}` } };
  });
  rota("POST", /\/items\/MLB\d+\/description$/, { status: 201, json: { plain_text: "ok" } });
}

// ─── Sem banco ───────────────────────────────────────────────────────────────

test("atributos: nome → value_id sem acento/caixa (Cirrê), lista fechada recusa nome desconhecido com os aceitos, lista aberta e texto livre passam", () => {
  const defs = new Map(ATRIBUTOS_MODA.map(mapearAtributo).map((a) => [a.id, a]));
  assert.deepEqual(resolverAtributo(defs, { id: "fabric_type", valor: "CIRRE" }).ok, { id: "FABRIC_TYPE", value_id: "7001", value_name: "Cirrê" });
  assert.deepEqual(resolverAtributo(defs, { id: "WITH_POCKETS", valor: "não" }).ok, { id: "WITH_POCKETS", value_id: "242084", value_name: "Não" });
  const r = resolverAtributo(defs, { id: "FABRIC_TYPE", valor: "Seda" });
  assert.match(r.erro!, /Tipo de tecido \(FABRIC_TYPE\): "Seda" não está na lista.*Aceitos: Cirrê, Algodão, Viscose/);
  assert.deepEqual(resolverAtributo(defs, { id: "COLOR", valor: "Rosa Chiclete" }).ok, { id: "COLOR", value_name: "Rosa Chiclete" }, "cor fora da lista é aceita (valor livre)");
  assert.deepEqual(resolverAtributo(defs, { id: "BRAND", valor: "Ateliê" }).ok, { id: "BRAND", value_name: "Ateliê" });
  assert.deepEqual(resolverAtributo(defs, { id: "FABRIC_TYPE", valor_id: "7002" }).ok, { id: "FABRIC_TYPE", value_id: "7002" });
  assert.deepEqual(resolverAtributo(defs, { id: "QUALQUER", valor: "x" }).ok, { id: "QUALQUER", value_name: "x" });
  // GTIN: informado → GTIN; sem GTIN → EMPTY_GTIN_REASON (padrão "Outro"; pt/es casam); categoria sem o atributo → nada.
  assert.deepEqual(atributoGtin(defs, "7891234567895", undefined), { id: "GTIN", value_name: "7891234567895" });
  assert.deepEqual(atributoGtin(defs, undefined, undefined), { id: "EMPTY_GTIN_REASON", value_id: "17055161", value_name: "Outro" });
  assert.deepEqual(atributoGtin(defs, undefined, "nao_registrado"), { id: "EMPTY_GTIN_REASON", value_id: "17055160", value_name: "Não registrado" });
  assert.equal(atributoGtin(new Map(), undefined, "kit"), null);
});

test("fotos: base64 com bytes conferidos (jpg/png/webp), lixo e >10 MB recusados; URL e id do ML classificados", () => {
  assert.equal(tipoDaImagem(JPEG), "image/jpeg");
  assert.equal(tipoDaImagem(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(tipoDaImagem(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "image/webp");
  assert.equal(decodificarImagem(JPEG_URI).mime, "image/jpeg");
  assert.equal(decodificarImagem(JPEG.toString("base64")).bytes.length, JPEG.length, "base64 puro também vale");
  // data URI dizendo jpeg, mas o conteúdo é texto (GIF/HTML disfarçado) → recusa pelos bytes
  assert.throws(() => decodificarImagem(`data:image/jpeg;base64,${Buffer.from("<html>não é foto</html>").toString("base64")}`), /não é JPG, PNG ou WEBP/);
  assert.throws(() => decodificarImagem(`data:image/gif;base64,${Buffer.from("GIF89a....").toString("base64")}`), /não é JPG, PNG ou WEBP/);
  assert.throws(() => decodificarImagem("isto não é base64 !!"), /nem uma imagem em base64/);
  const grande = Buffer.alloc(10 * 1024 * 1024 + 10, 1); grande[0] = 0xff; grande[1] = 0xd8; grande[2] = 0xff;
  assert.throws(() => decodificarImagem(grande.toString("base64")), /acima de 10 MB/);
  const c = classificarFotos(["https://x.test/a.jpg", "123-MLB456_112026", JPEG_URI]);
  assert.deepEqual(c.map((x) => x.tipo), ["url", "id", "bytes"]);
  assert.throws(() => classificarFotos(["https://x.test/a.jpg", "javascript:alert(1)"]), /foto 2/);
});

test("guia: tabela simples → corpo do POST /catalog/charts (sem prefixo no domínio); linha pelo tamanho; política aceita UP/catálogo e recusa título no UP", () => {
  const b = montarGuia({ nome: "Guia (Macaquinho) - Feminino", dominio: "MLB-JUMPSUITS", genero: "Feminino", marca: "Ateliê", atributo_principal: "SIZE", linhas: [{ tamanho: "P", medidas: { CHEST_CIRCUMFERENCE: "84 cm" } }, { tamanho: "M", medidas: { chest_circumference: "88 cm" } }] });
  assert.deepEqual(b.names, { MLB: "Guia Macaquinho Feminino" }, "sem ( ) e -");
  assert.equal(b.domain_id, "JUMPSUITS");
  assert.deepEqual(b.main_attribute, { attributes: [{ site_id: "MLB", id: "SIZE" }] });
  assert.deepEqual(b.attributes, [{ id: "GENDER", values: [{ name: "Feminino" }] }, { id: "BRAND", values: [{ name: "Ateliê" }] }]);
  assert.deepEqual(b.rows[1], { attributes: [{ id: "SIZE", values: [{ name: "M" }] }, { id: "CHEST_CIRCUMFERENCE", values: [{ name: "88 cm" }] }] });
  assert.throws(() => montarGuia({ nome: "G", dominio: "X", genero: "F", marca: "M", atributo_principal: "SIZE", linhas: [{ tamanho: "P", medidas: {} }, { tamanho: "p", medidas: {} }] }), /repetido/);
  const g: Guia = { id: "5001", nome: "", dominio_id: null, tipo: null, atributo_principal: "SIZE", linhas: [{ id: "5001:1", tamanho: "P", valores: { SIZE: "P" } }, { id: "5001:2", tamanho: "GG", valores: { SIZE: "GG", BR_SIZE: "46" } }] };
  assert.equal(linhaDoTamanho(g, " gg ")!.id, "5001:2");
  assert.equal(linhaDoTamanho(g, "46")!.id, "5001:2", "casa pelo valor de outra coluna");
  assert.equal(linhaDoTamanho(g, "XG"), null);

  const up = { family_name: "Macaquinho Cirrê", category_id: "MLB2", price: 10, available_quantity: 1, condition: "new", listing_type_id: "gold_pro", pictures: [{ id: "123-MLB456_112026" }, { source: "https://x.test/a.jpg" }], attributes: [] };
  assert.equal(validatePayload("create_listing", { item: up }), null);
  assert.match(validatePayload("create_listing", { item: { ...up, title: "Macaquinho" } })!, /não se envia título/);
  assert.match(validatePayload("create_listing", { item: { ...up, variations: [] } })!, /não há variações/);
  assert.match(validatePayload("create_listing", { item: { ...up, pictures: [{ id: "../x" }] } })!, /Fotos/);
  const cat = { category_id: "MLB3", price: 10, available_quantity: 1, condition: "new", listing_type_id: "gold_special", catalog_listing: true, catalog_product_id: "MLB1234567", pictures: [], attributes: [] };
  assert.equal(validatePayload("create_listing", { item: cat }), null, "catálogo sem título e sem fotos");
  assert.match(validatePayload("create_listing", { item: { ...cat, catalog_product_id: "X" } })!, /catalog_product_id/);
});

test("tools/list: novas ferramentas registradas (escrita marcada), sem exclusão", () => {
  const nomes = TODAS_FERRAMENTAS.map((f) => f.nome);
  for (const n of ["anuncio_validar", "anuncios_criar_lote", "anuncios_alterar_lote", "ml_foto_enviar", "ml_guias_listar", "ml_guia_criar", "ml_catalogo_buscar"]) assert.ok(nomes.includes(n), n);
  assert.equal(new Set(nomes).size, nomes.length);
  const escrita = (n: string) => TODAS_FERRAMENTAS.find((f) => f.nome === n)!.escrita;
  assert.equal(escrita("anuncios_criar_lote"), true);
  assert.equal(escrita("anuncios_alterar_lote"), true);
  assert.equal(escrita("ml_guia_criar"), true);
  assert.equal(escrita("anuncio_validar"), false);
  assert.equal(escrita("ml_guias_listar"), false);
});

// ─── Com banco ───────────────────────────────────────────────────────────────

let C1 = "", C2 = "", ACC1 = "";
const atualizados: string[] = [];
const deps = (): Deps => ({ atualizarAnuncio: async (acc, id) => { atualizados.push(`${acc}:${id}`); } });
const saidas: unknown[] = [];
const rodar = async (nome: string, args: unknown) => { const r = await executarQualquer(nome, dono, args, deps()); saidas.push(r); return r as any; };
const acoes = (tipo = "create_listing") => rawQuery<any>("select status, target_id, payload, after_state, client_id from avanteza.actions where action_type = $1 order by created_at", [tipo]);

before(async () => {
  instalar();
  if (!HAS_DB) return;
  await resetSchema();
  C1 = await mkClient("Moda Cirrê");
  C2 = await mkClient("Outra Loja");
  const futuro = new Date(Date.now() + 5 * 3600_000).toISOString();
  const conta = async (c: string, uid: string, nick: string) => (await rawQuery<{ id: string }>(
    "insert into avanteza.marketplace_accounts (client_id, marketplace, external_user_id, nickname, access_token_enc, refresh_token_enc, token_expires_at) values ($1,'mercadolivre',$2,$3,$4,$5,$6) returning id",
    [c, uid, nick, encrypt(TOKEN_ML), encrypt("TG-REFRESH-SECRETO-UP"), futuro]))[0].id;
  ACC1 = await conta(C1, "111", "MODACIRRE");
  await conta(C2, "222", "OUTRALOJA");
  await rawQuery("update avanteza.settings set dry_run = false, global_pause = false");
  await rawQuery("insert into avanteza.admins (email, role, name, active) values ($1,'admin','Dono',true)", [DONO]);
});
beforeEach(async () => {
  chamadas = []; rotas = []; limparCacheMl();
  if (HAS_DB) await rawQuery("delete from avanteza.actions");
});
after(async () => { globalThis.fetch = original; if (HAS_DB) await closeDb(); });

test("UP Macaquinho Cirrê: 3 cores × 3 tamanhos → 9 anúncios com o mesmo family_name, sem título, SKU/guia/linha por item, descrição em cada um", { skip }, async () => {
  rotasModa();
  const r = await rodar("anuncio_criar", macaquinho());
  assert.equal(r.formato, "user_products");
  assert.equal(r.ok, true, JSON.stringify(r.erros ?? r.erro));
  assert.equal(r.itens.length, 9);
  assert.ok(r.itens.every((i: any) => /^MLB\d+$/.test(i.anuncio_id) && i.status === "executada" && i.descricao === "criada"));
  assert.deepEqual(r.itens.map((i: any) => i.sku), itensMacaquinho().map((i) => i.sku));

  // Foto em base64 comum aos 9: enviada UMA vez (multipart), depois reaproveitada pelo id.
  const up = posts(/^\/pictures\/items\/upload$/);
  assert.equal(up.length, 1);
  assert.ok(up[0].corpo instanceof FormData);
  const arq = up[0].corpo.get("file") as Blob;
  assert.equal(arq.type, "image/jpeg");
  assert.equal(arq.size, JPEG.length);
  assert.equal(up[0].auth, `Bearer ${TOKEN_ML}`);

  const corpos = posts(/^\/items$/).map((c) => c.corpo);
  assert.equal(corpos.length, 9);
  for (const b of corpos) {
    assert.equal(b.family_name, "Macaquinho Cirrê com Bolsos");
    assert.equal(b.title, undefined, "sem título no User Products");
    assert.equal(b.variations, undefined);
    assert.equal(b.category_id, "MLB2");
    assert.equal(b.listing_type_id, "gold_pro");
    assert.equal(b.currency_id, "BRL");
    assert.equal(b.available_quantity, 4);
    assert.deepEqual(attr(b, "FABRIC_TYPE"), { id: "FABRIC_TYPE", value_id: "7001", value_name: "Cirrê" });
    assert.deepEqual(attr(b, "GENDER"), { id: "GENDER", value_id: "339666", value_name: "Feminino" });
    assert.deepEqual(attr(b, "WITH_POCKETS"), { id: "WITH_POCKETS", value_id: "242085", value_name: "Sim" });
    assert.deepEqual(attr(b, "SIZE_GRID_ID"), { id: "SIZE_GRID_ID", value_name: "5001" });
    assert.deepEqual(attr(b, "EMPTY_GTIN_REASON"), { id: "EMPTY_GTIN_REASON", value_id: "17055161", value_name: "Outro" }, "sem GTIN → motivo padrão");
    assert.equal(attr(b, "GTIN"), undefined);
    assert.deepEqual(b.sale_terms, [{ id: "MANUFACTURING_TIME", value_name: "5 dias" }]);
    assert.deepEqual(b.shipping, { mode: "me2", local_pick_up: false, free_shipping: true });
    assert.deepEqual(["SELLER_PACKAGE_HEIGHT", "SELLER_PACKAGE_WIDTH", "SELLER_PACKAGE_LENGTH", "SELLER_PACKAGE_WEIGHT"].map((id) => attr(b, id).value_name), ["5 cm", "25 cm", "30 cm", "300 g"]);
    assert.equal(b.attributes.filter((a: any) => a.id === "SELLER_SKU").length, 1);
  }
  // Cada item: cor, tamanho, linha da guia, SKU, preço e fotos próprias (+ a comum enviada).
  const preto = corpos.find((b) => sku(b) === "MCB-PRETO-M")!;
  assert.deepEqual(attr(preto, "COLOR"), { id: "COLOR", value_id: "52049", value_name: "Preto" });
  assert.deepEqual(attr(preto, "SIZE"), { id: "SIZE", value_name: "M" });
  assert.deepEqual(attr(preto, "SIZE_GRID_ROW_ID"), { id: "SIZE_GRID_ROW_ID", value_name: "5001:2" });
  assert.deepEqual(preto.pictures, [{ source: "https://fotos.test/macaquinho-preto.jpg" }, { id: "123-MLB456_112026" }]);
  assert.equal(preto.price, 129.9);
  const verdeG = corpos.find((b) => sku(b) === "MCB-VERDE-G")!;
  assert.equal(verdeG.price, 139.9);
  assert.equal(attr(verdeG, "SIZE_GRID_ROW_ID").value_name, "5001:3");
  assert.equal(new Set(corpos.map(sku)).size, 9);

  const descs = posts(/^\/items\/MLB\d+\/description$/);
  assert.equal(descs.length, 9, "descrição em cada anúncio");
  assert.ok(descs.every((d) => d.corpo.plain_text === "Macaquinho em cirrê com bolsos laterais.\nTecido com brilho."));
  const a = await acoes();
  assert.equal(a.length, 9);
  assert.ok(a.every((x) => x.status === "executed" && x.client_id === C1 && x.after_state.family_name === "Macaquinho Cirrê com Bolsos"));
  assert.ok(a.some((x) => x.target_id === "novo:MLB2:MCB-ROSA-P"));
  assert.ok(!JSON.stringify(a.map((x) => x.payload)).includes("base64"), "payload gravado sem a imagem");
  assert.equal(atualizados.filter((x) => x.startsWith(`${ACC1}:`)).length, 9);
  const aud = await rawQuery<any>("select details from avanteza.audit_log where event = 'anuncio_criado' order by id desc limit 9");
  assert.ok(aud.every((x) => x.details.via === "claude" && x.details.formato === "user_products" && x.details.family_name === "Macaquinho Cirrê com Bolsos"));
});

test("UP: um item recusado pelo ML não interrompe os outros; relatório por item com o erro em português", { skip }, async () => {
  rotasModa({ falharSku: "MCB-ROSA-M" });
  const r = await rodar("anuncio_criar", macaquinho());
  assert.equal(r.ok, false);
  assert.equal(r.publicado, true);
  assert.match(r.erro, /1 de 9 anúncio\(s\) falharam/);
  const falho = r.itens.find((i: any) => i.sku === "MCB-ROSA-M");
  assert.equal(falho.cor, "Rosa");
  assert.equal(falho.tamanho, "M");
  assert.match(falho.erro, /Mercado Livre recusou \(400 validation_error\): item\.price: price is invalid/);
  assert.equal(r.itens.filter((i: any) => i.anuncio_id).length, 8);
  const a = await acoes();
  assert.deepEqual(a.map((x) => x.status).sort(), [...Array(8).fill("executed"), "failed"].sort());
  assert.equal(posts(/^\/items\/MLB\d+\/description$/).length, 8);
});

test("UP: obrigatório faltando, valor fora da lista, guia ausente, tamanho fora da guia, foto inválida e >10 fotos → nada é enviado", { skip }, async () => {
  const semEnvio = () => {
    assert.equal(posts(/^\/items$/).length, 0, "nenhum POST /items");
    assert.equal(posts(/\/pictures\/items\/upload$/).length, 0, "nem upload de foto");
  };
  rotasModa();
  // GENDER (obrigatório) não informado → lista estruturada, com os itens afetados
  const r1 = await rodar("anuncio_criar", macaquinho({ atributos: [{ id: "BRAND", valor: "Ateliê Cirrê" }] }));
  assert.equal(r1.ok, false);
  assert.equal(r1.publicado, false);
  assert.deepEqual(r1.atributos_faltando.map((x: any) => x.id), ["GENDER"]);
  assert.deepEqual(r1.atributos_faltando[0].exemplos, ["Feminino", "Masculino"]);
  assert.equal(r1.atributos_faltando[0].itens.length, 9);
  semEnvio();
  // Tecido fora da lista fechada
  const r2 = await rodar("anuncio_criar", macaquinho({ atributos: [{ id: "BRAND", valor: "X" }, { id: "GENDER", valor: "Feminino" }, { id: "FABRIC_TYPE", valor: "Seda" }] }));
  assert.match(r2.erro, /"Seda" não está na lista.*Aceitos: Cirrê, Algodão, Viscose/);
  semEnvio();
  // Domínio de moda com guia obrigatória e sem guia_id
  const r3 = await rodar("anuncio_criar", macaquinho({ guia_id: undefined }));
  assert.match(r3.erro, /exige guia de medidas: use ml_guias_listar.*ml_guia_criar/);
  // Tamanho que não existe na guia
  const r4 = await rodar("anuncio_criar", macaquinho({ itens: [{ cor: "Preto", tamanho: "GG", preco: 10, estoque: 1, sku: "X-GG", fotos: ["https://x.test/a.jpg"] }] }));
  assert.match(r4.erro, /"GG" não existe na guia 5001 \(tamanhos: P, M, G\)/);
  // Foto que diz ser JPEG mas não é
  const falsa = `data:image/jpeg;base64,${Buffer.from("<?php echo 1; ?> não é imagem").toString("base64")}`;
  const r5 = await rodar("anuncio_criar", macaquinho({ fotos: [falsa] }));
  assert.match(r5.erro, /foto 1: o arquivo não é JPG, PNG ou WEBP/);
  // 11 fotos num anúncio (5 do item + 6 do modelo)
  const urls = (n: number, p: string) => Array.from({ length: n }, (_, i) => `https://x.test/${p}${i}.jpg`);
  const r6 = await rodar("anuncio_criar", macaquinho({ fotos: urls(6, "m"), itens: [{ cor: "Preto", tamanho: "P", preco: 10, estoque: 1, sku: "X-P", fotos: urls(5, "i") }] }));
  assert.match(r6.erro, /no máximo 10 fotos por anúncio; vieram 11/);
  semEnvio();
  assert.equal((await acoes()).length, 0);
});

test("UP: GTIN informado vai como GTIN; motivo artesanal; variações de conta UP viram um anúncio cada", { skip }, async () => {
  rotasModa();
  const r = await rodar("anuncio_criar", macaquinho({
    fotos: [], itens: [
      { cor: "Preto", tamanho: "P", preco: 100, estoque: 2, sku: "G-P", gtin: "7891234567895", fotos: ["https://x.test/p.jpg"] },
      { cor: "Preto", tamanho: "M", preco: 100, estoque: 2, sku: "G-M", motivo_sem_gtin: "artesanal", fotos: ["https://x.test/p.jpg"] },
    ],
  }));
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const [b1, b2] = posts(/^\/items$/).map((c) => c.corpo);
  assert.deepEqual(attr(b1, "GTIN"), { id: "GTIN", value_name: "7891234567895" });
  assert.equal(attr(b1, "EMPTY_GTIN_REASON"), undefined);
  assert.deepEqual(attr(b2, "EMPTY_GTIN_REASON"), { id: "EMPTY_GTIN_REASON", value_id: "17055158", value_name: "Artesanal" });

  // Entrada no formato antigo (titulo + variacoes) numa conta UP: convertida para um anúncio por variação.
  chamadas = [];
  const r2 = await rodar("anuncio_criar", {
    cliente: C1, titulo: "Macaquinho Cirrê", categoria_id: "MLB2", guia_id: "5001", fotos: ["https://x.test/capa.jpg"],
    atributos: [{ id: "BRAND", valor: "Ateliê" }, { id: "GENDER", valor: "Feminino" }],
    variacoes: [
      { atributos: [{ id: "COLOR", valor: "Preto" }, { id: "SIZE", valor: "P" }], preco: 99, estoque: 1, sku: "V-P" },
      { atributos: [{ id: "COLOR", valor: "Preto" }, { id: "SIZE", valor: "G" }], preco: 99, estoque: 1, sku: "V-G" },
    ],
  });
  assert.equal(r2.formato, "user_products");
  const cs = posts(/^\/items$/).map((c) => c.corpo);
  assert.deepEqual(cs.map((b) => [b.family_name, b.title, sku(b), attr(b, "SIZE_GRID_ROW_ID").value_name]), [["Macaquinho Cirrê", undefined, "V-P", "5001:1"], ["Macaquinho Cirrê", undefined, "V-G", "5001:3"]]);
});

test("validar_apenas: só POST /items/validate (nada publicado, nenhuma ação); erros do ML por item", { skip }, async () => {
  rotasModa();
  rota("POST", /\/items\/validate$/, (c) => (sku(c.corpo) === "MCB-VERDE-P"
    ? { status: 400, json: { message: "Validation error", error: "validation_error", cause: [{ type: "error", code: "item.attributes.invalid", references: ["item.attributes"], message: "COLOR is invalid" }, { type: "warning", message: "ignorar" }] } }
    : { status: 200, json: null }));
  const r = await rodar("anuncio_criar", macaquinho({ fotos: ["https://fotos.test/capa.jpg"], validar_apenas: true }));
  assert.equal(r.validar_apenas, true);
  assert.equal(r.publicado, false);
  assert.equal(r.ok, false);
  assert.equal(r.itens.filter((i: any) => i.valido).length, 8);
  assert.deepEqual(r.itens.find((i: any) => i.sku === "MCB-VERDE-P").erros, ["item.attributes: COLOR is invalid"]);
  const ps = chamadas.filter((c) => c.metodo !== "GET").map((c) => `${c.metodo} ${c.url.pathname}`);
  assert.deepEqual(ps, Array(9).fill("POST /items/validate"), "só validação");
  assert.equal((await acoes()).length, 0);
  // anuncio_validar = mesma coisa, ferramenta somente leitura
  chamadas = [];
  const v = await rodar("anuncio_validar", { ...macaquinho({ fotos: ["https://fotos.test/capa.jpg"] }), itens: itensMacaquinho().slice(0, 2) });
  assert.equal(v.ok, true);
  assert.deepEqual(chamadas.filter((c) => c.metodo !== "GET").map((c) => c.url.pathname), ["/items/validate", "/items/validate"]);
});

test("lote: relatório criados/falharam; produto com problema não para os outros; limite de 50 por chamada", { skip }, async () => {
  rotasModa();
  const r = await rodar("anuncios_criar_lote", {
    cliente: C1,
    produtos: [
      { ...macaquinho(), cliente: undefined, itens: itensMacaquinho().slice(0, 2) },
      { ...macaquinho(), cliente: undefined, family_name: "Short Cirrê", atributos: [{ id: "BRAND", valor: "X" }], itens: itensMacaquinho().slice(3, 4) },
      { ...macaquinho(), cliente: undefined, family_name: "Saia Cirrê", itens: itensMacaquinho().slice(6, 7) },
    ],
  });
  assert.deepEqual(r.resumo, { criados: 3, falharam: 1, validados: 0 });
  assert.deepEqual(r.criados.map((x: any) => x.sku), ["MCB-PRETO-P", "MCB-PRETO-M", "MCB-VERDE-P"]);
  assert.ok(r.criados.every((x: any) => /^MLB\d+$/.test(x.anuncio_id)));
  assert.equal(r.falharam[0].produto, "Short Cirrê");
  assert.match(r.falharam[0].motivo, /Faltam 1 atributo/);
  assert.equal(posts(/\/pictures\/items\/upload$/).length, 1, "foto comum enviada uma vez para o lote inteiro");
  const [aud] = await rawQuery<any>("select details from avanteza.audit_log where event = 'anuncios_lote_criado' order by id desc limit 1");
  assert.equal(aud.details.criados, 3);
  assert.equal(aud.details.via, "claude");
  // Validação em lote
  chamadas = [];
  rota("POST", /\/items\/validate$/, { status: 200, json: null });
  const v = await rodar("anuncios_criar_lote", { cliente: C1, validar_apenas: true, produtos: [{ ...macaquinho(), cliente: undefined, itens: itensMacaquinho().slice(0, 3) }] });
  assert.deepEqual(v.resumo, { criados: 0, falharam: 0, validados: 3 });
  assert.equal(posts(/^\/items$/).length, 0);
  // Limite
  await assert.rejects(executarQualquer("anuncios_criar_lote", dono, { cliente: C1, produtos: [{ ...macaquinho(), cliente: undefined, itens: [...itensMacaquinho(), ...itensMacaquinho(), ...itensMacaquinho(), ...itensMacaquinho(), ...itensMacaquinho(), ...itensMacaquinho()] }] }, deps()), /máximo 50|Entrada inválida/);
  await assert.rejects(executarQualquer("anuncios_criar_lote", dono, { cliente: C1, produtos: Array.from({ length: 6 }, () => ({ ...macaquinho(), cliente: undefined })) }, deps()), /Lote grande demais: 54 anúncios/);
});

test("catálogo: domínio obrigatório sem produto → orienta ml_catalogo_buscar; com catalogo_produto_id → catalog_listing no POST", { skip }, async () => {
  rotasModa({ up: false });
  rota("GET", /\/categories\/MLB3$/, { json: { id: "MLB3", settings: { catalog_domain: "MLB-CELLPHONES" } } });
  rota("GET", /\/categories\/MLB3\/attributes$/, { json: [{ id: "BRAND", name: "Marca", tags: { required: true } }, { id: "GTIN", name: "GTIN", tags: { required: true } }] });
  rota("GET", /\/categories\/MLB3\/sale_terms$/, { json: [] });
  rota("GET", /\/products\/search$/, { json: { results: [{ id: "MLB19615316", status: "active", domain_id: "MLB-CELLPHONES", settings: { listing_strategy: "catalog_required" }, name: "Celular X 128 GB", attributes: [{ id: "BRAND", value_name: "X" }] }] } });
  const r0 = await rodar("anuncio_criar", { cliente: C1, titulo: "Celular X 128 GB", categoria_id: "MLB3", preco: 1500, fotos: ["https://x.test/c.jpg"] });
  assert.equal(r0.ok, false);
  assert.match(r0.erro, /catálogo obrigatório.*ml_catalogo_buscar/);
  assert.equal(posts(/^\/items$/).length, 0);

  const b = await rodar("ml_catalogo_buscar", { cliente: C1, gtin: "7891234567895" });
  assert.equal(b.produtos[0].catalogo_produto_id, "MLB19615316");
  assert.equal(b.produtos[0].catalogo_obrigatorio, true);
  const busca = chamadas.find((c) => c.url.pathname === "/products/search")!;
  assert.deepEqual(Object.fromEntries(busca.url.searchParams), { status: "active", site_id: "MLB", product_identifier: "7891234567895" });

  const r = await rodar("anuncio_criar", { cliente: C1, categoria_id: "MLB3", catalogo_produto_id: "MLB19615316", preco: 1499.9, estoque: 3, sku: "CEL-X-128", gtin: "7891234567895", tipo: "premium" });
  assert.equal(r.ok, true, JSON.stringify(r.erros ?? r.erro));
  assert.equal(r.formato, "catalogo");
  const [body] = posts(/^\/items$/).map((c) => c.corpo);
  assert.equal(body.catalog_listing, true);
  assert.equal(body.catalog_product_id, "MLB19615316");
  assert.equal(body.title, undefined);
  assert.equal(body.family_name, undefined);
  assert.equal(body.variations, undefined);
  assert.equal(body.price, 1499.9);
  assert.equal(body.available_quantity, 3);
  assert.equal(body.listing_type_id, "gold_pro");
  assert.deepEqual(body.attributes, [{ id: "GTIN", value_name: "7891234567895" }, { id: "SELLER_SKU", value_name: "CEL-X-128" }]);
  assert.equal((await acoes())[0].after_state.id.startsWith("MLB"), true);
});

test("guias e foto: ml_guias_listar (busca com domínio sem prefixo e linhas), ml_guia_criar (corpo e ids das linhas), ml_foto_enviar (id)", { skip }, async () => {
  rotasModa();
  rota("POST", /\/catalog\/charts\/search$/, { json: { paging: { total: 1 }, charts: [{ id: "5001", names: { MLB: "Guia Macaquinho Feminino" }, domain_id: "JUMPSUITS", type: "SPECIFIC", main_attribute_id: "SIZE", rows: [] }] } });
  const l = await rodar("ml_guias_listar", { cliente: C1, categoria_id: "MLB2", genero: "Feminino" });
  const busca = posts(/\/catalog\/charts\/search$/)[0];
  assert.deepEqual(busca.corpo, { domain_id: "JUMPSUITS", site_id: "MLB", seller_id: 111, attributes: [{ id: "GENDER", values: [{ name: "Feminino" }] }] });
  assert.deepEqual(l.guias[0].linhas, [{ linha_id: "5001:1", tamanho: "P" }, { linha_id: "5001:2", tamanho: "M" }, { linha_id: "5001:3", tamanho: "G" }]);

  rota("POST", /\/catalog\/charts$/, (c) => ({ json: { id: "7777", names: c.corpo.names, domain_id: c.corpo.domain_id, type: "SPECIFIC", main_attribute_id: "SIZE", rows: c.corpo.rows.map((r: any, i: number) => ({ id: `7777:${i + 1}`, attributes: r.attributes })) } }));
  const g = await rodar("ml_guia_criar", { cliente: C1, dominio_id: "MLB-JUMPSUITS", nome: "Macaquinho Feminino", genero: "Feminino", marca: "Ateliê Cirrê", linhas: [{ tamanho: "P", medidas: { CHEST_CIRCUMFERENCE: "84 cm", WAIST_CIRCUMFERENCE: "66 cm" } }, { tamanho: "M", medidas: { CHEST_CIRCUMFERENCE: "88 cm", WAIST_CIRCUMFERENCE: "70 cm" } }] });
  assert.equal(g.guia_id, "7777");
  assert.deepEqual(g.linhas, [{ linha_id: "7777:1", tamanho: "P" }, { linha_id: "7777:2", tamanho: "M" }]);
  const criar = posts(/\/catalog\/charts$/)[0].corpo;
  assert.equal(criar.domain_id, "JUMPSUITS");
  assert.equal(criar.rows.length, 2);
  // erro de guia (errors[]) vira mensagem com o campo
  rotas = rotas.filter(([m, re]) => !(m === "POST" && String(re).includes("charts$")));
  rota("POST", /\/catalog\/charts$/, { status: 400, json: { errors: [{ code: "invalid_row_attribute_value", message: "measurement must increase" }] } });
  await assert.rejects(executarQualquer("ml_guia_criar", dono, { cliente: C1, dominio_id: "JUMPSUITS", nome: "Teste", genero: "Feminino", marca: "M", linhas: [{ tamanho: "P", medidas: {} }] }, deps()), /Guia de medidas recusada:.*invalid_row_attribute_value: measurement must increase/);

  const f = await rodar("ml_foto_enviar", { cliente: C1, imagem: JPEG_URI });
  assert.equal(f.foto_id, "123-MLB456_112026");
  assert.equal(f.tipo, "image/jpeg");
  await assert.rejects(executarQualquer("ml_foto_enviar", dono, { cliente: C1, imagem: Buffer.from("texto qualquer, não imagem").toString("base64") }, deps()), /não é JPG, PNG ou WEBP/);
  const [aud] = await rawQuery<any>("select details from avanteza.audit_log where event = 'ml_guia_criada' order by id desc limit 1");
  assert.equal(aud.details.guia_id, "7777");
});

test("por SKU: preço respeita o limite diário e o dono do anúncio; estoque na variação do SKU; lote por SKU com resultado por item", { skip }, async () => {
  let preco = 100, status = "active", estoqueVar = 0;
  rota("GET", /\/users\/111\/items\/search$/, (c) => ({ json: { results: ({ "MCB-PRETO-P": ["MLB5001"], "DUPLICADO": ["MLB5001", "MLB5002"], "VAR-AZUL": ["MLB5003"] } as Record<string, string[]>)[c.url.searchParams.get("seller_sku")!] ?? [] } }));
  rota("GET", /\/users\/222\/items\/search$/, { json: { results: ["MLB6001"] } });
  rota("GET", /\/items\/MLB5001$/, () => ({ json: { id: "MLB5001", seller_id: 111, title: "Macaquinho", status, price: preco, available_quantity: 4, variations: [] } }));
  rota("PUT", /\/items\/MLB5001$/, (c) => { if (c.corpo.price) preco = c.corpo.price; if (c.corpo.status) status = c.corpo.status; return { json: { price: preco, status } }; });
  const varItem = () => ({ id: "MLB5003", seller_id: 111, title: "Short", status: "active", price: 50, available_quantity: 3, variations: [
    { id: 11, price: 50, available_quantity: 1, attribute_combinations: [{ value_name: "Preto" }], attributes: [{ id: "SELLER_SKU", value_name: "VAR-PRETO" }] },
    { id: 12, price: 50, available_quantity: estoqueVar, attribute_combinations: [{ value_name: "Azul" }], attributes: [{ id: "SELLER_SKU", value_name: "VAR-AZUL" }] },
  ] });
  rota("GET", /\/items\/MLB5003$/, () => ({ json: varItem() }));
  rota("PUT", /\/items\/MLB5003$/, (c) => { const v = c.corpo.variations?.find((x: any) => x.available_quantity !== undefined); if (v) estoqueVar = v.available_quantity; return { json: { variations: [{ id: 12, available_quantity: estoqueVar }] } }; });

  const ok = await rodar("anuncio_alterar", { cliente: C1, sku: "MCB-PRETO-P", preco: 105 });
  assert.equal(ok.anuncio_id, "MLB5001");
  assert.equal(ok.alteracoes[0].status, "executada");
  assert.equal(preco, 105);
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, sku: "MCB-PRETO-P", preco: 150 }, deps()), /preco: Bloqueado pelo limite: Variação de 50\.0% no dia excede o limite de 10%/);
  assert.equal(preco, 105, "nada enviado acima do limite");
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, sku: "NAO-EXISTE", preco: 10 }, deps()), /Nenhum anúncio com o SKU "NAO-EXISTE"/);
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, sku: "DUPLICADO", preco: 10 }, deps()), /está em 2 anúncios.*informe anuncio_id/);
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, sku: "X", anuncio_id: "MLB5001", preco: 10 }, deps()), /OU/);
  // Dono: a busca devolve um anúncio de outro vendedor → recusado sem PUT
  rota("GET", /\/items\/MLB6001$/, { json: { id: "MLB6001", seller_id: 999 } });
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C2, sku: "ALHEIO", status: "pausado" }, deps()), /não pertence à conta/);
  assert.ok(!chamadas.some((c) => c.metodo === "PUT" && c.url.pathname === "/items/MLB6001"));
  // Estoque pelo SKU da variação: acha a variação 12 sozinho
  const e = await rodar("anuncio_alterar", { cliente: C1, sku: "VAR-AZUL", estoque: 7 });
  assert.equal(e.variacao_id, "12");
  assert.equal(estoqueVar, 7);

  const lote = await rodar("anuncios_alterar_lote", { cliente: C1, itens: [
    { sku: "MCB-PRETO-P", preco: 108 }, { sku: "MCB-PRETO-P", preco: 200 }, { sku: "NAO-EXISTE", estoque: 1 }, { sku: "MCB-PRETO-P", status: "pausado" },
  ] });
  assert.deepEqual(lote.resumo, { ok: 2, falharam: 2 });
  assert.match(lote.resultados[1].erro, /Bloqueado pelo limite/);
  assert.match(lote.resultados[2].erro, /Nenhum anúncio/);
  assert.equal(preco, 108);
  assert.equal(status, "paused");
  const tipos = await rawQuery<any>("select action_type, status from avanteza.actions where target_id = 'MLB5001' order by created_at");
  assert.deepEqual(tipos.map((t) => `${t.action_type}:${t.status}`), ["update_price:executed", "update_price:failed", "update_price:executed", "update_price:failed", "pause_listing:executed"]);
  const evs = await rawQuery<any>("select actor, details from avanteza.audit_log where event = 'anuncio_alterado'");
  assert.ok(evs.length >= 4 && evs.every((x) => x.actor === DONO && x.details.via === "claude"));
});

test("saídas: nunca levam token, refresh ou campo cifrado", { skip }, async () => {
  const tudo = JSON.stringify(saidas);
  assert.ok(saidas.length >= 10);
  for (const proibido of [TOKEN_ML, "TG-REFRESH-SECRETO-UP", "access_token", "_enc", "Bearer"]) assert.ok(!tudo.includes(proibido), proibido);
  const auds = JSON.stringify(await rawQuery("select details from avanteza.audit_log"));
  assert.ok(!auds.includes(TOKEN_ML));
});
