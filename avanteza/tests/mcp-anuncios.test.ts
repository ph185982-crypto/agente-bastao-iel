// Conector do Claude → anúncios: Mercado Livre (criar com atributos/variações/descrição, alterar pelo executor em modo direto,
// limites diários, dono do anúncio) e Meta Ads. NUNCA chama as APIs reais: o fetch global é trocado por um falso que registra
// cada chamada. DB opcional: TEST_DATABASE_URL.
import "./_sem-timers-presos";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { HAS_DB, resetSchema, closeDb, mkClient } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import { encrypt } from "../src/lib/crypto";
import { assinar, agora } from "../src/lib/mcp/oauth";
import { FERRAMENTAS_MARKETPLACE } from "../src/lib/mcp/ferramentas-marketplace";
import { TODAS_FERRAMENTAS, executarQualquer } from "../src/lib/mcp/registro";
import { ErroFerramenta, limpar, type Ator, type Deps } from "../src/lib/mcp/ferramentas";
import { atributosFaltando, mapearAtributo, montarItemMl, traduzirErroMl } from "../src/lib/marketplaces/mercadolivre/criar";
import { validatePayload } from "../src/lib/executor/policy";
import { ApiError } from "../src/lib/http";
import { atualizarUmAnuncio } from "../src/lib/collector";
import * as mcp from "../src/app/api/mcp/route";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AVANTEZA_MCP_SECRET = "segredo-do-conector-mcp-para-testes-123";
process.env.SESSION_SECRET = "s".repeat(40);
process.env.ADMIN_EMAILS = "dono@avanteza.com.br";
const DONO = "dono@avanteza.com.br";
const dono: Ator = { email: DONO, sessao: { email: DONO, role: "admin", apps: [], name: "Dono" } };
const ML = "https://api.mercadolibre.com";
const TOKEN_ML = "APP_USR-TOKEN-ML-SECRETO-123456";

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
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { /* form */ } }
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
const chamadasMl = () => chamadas.filter((c) => c.url.origin === ML).map((c) => `${c.metodo} ${c.url.pathname}`);

const ATRIBUTOS = [
  { id: "BRAND", name: "Marca", tags: { required: true }, value_type: "string", values: [{ id: "1", name: "Nike" }, { id: "2", name: "Adidas" }] },
  { id: "MODEL", name: "Modelo", tags: { catalog_required: true }, value_type: "string" },
  { id: "COLOR", name: "Cor", tags: { required: true, allow_variations: true }, value_type: "list", values: [{ id: "52049", name: "Preto" }, { id: "52055", name: "Branco" }] },
  { id: "GTIN", name: "Código universal", tags: { read_only: true, required: true } },
  { id: "MATERIAL", name: "Material", tags: {} },
];
const itemVivo = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: "Tênis Corrida Leve", status: "active", sub_status: [], price: 100, currency_id: "BRL", available_quantity: 5, sold_quantity: 2,
  permalink: `https://produto.mercadolivre.com.br/${id}`, secure_thumbnail: "https://http2.mlstatic.com/D_1-I.jpg", pictures: [{ secure_url: "https://http2.mlstatic.com/D_1-O.jpg" }],
  listing_type_id: "gold_special", variations: [], seller_id: 111, ...extra,
});

// ─── Sem banco ───────────────────────────────────────────────────────────────

test("ML puro: obrigatórios (required/catalog_required, sem read_only), variação cobre o atributo, corpo do POST e erros traduzidos", () => {
  const attrs = ATRIBUTOS.map(mapearAtributo);
  assert.deepEqual(attrs.filter((a) => a.obrigatorio).map((a) => a.id), ["BRAND", "MODEL", "COLOR"]);
  const f = atributosFaltando(attrs, { atributos: [{ id: "brand", valor: "Nike" }], variacoes: [] });
  assert.deepEqual(f.map((x) => x.id), ["MODEL", "COLOR"]);
  assert.deepEqual(f[1].exemplos, ["Preto", "Branco"]);
  // COLOR em todas as variações conta como informado; em só uma, não.
  const v = (cor?: string) => ({ atributos: cor ? [{ id: "COLOR", valor: cor }] : [{ id: "SIZE", valor: "40" }], preco: 10, estoque: 1 });
  assert.deepEqual(atributosFaltando(attrs, { atributos: [{ id: "BRAND", valor: "Nike" }, { id: "MODEL", valor: "X" }], variacoes: [v("Preto"), v("Branco")] }), []);
  assert.deepEqual(atributosFaltando(attrs, { atributos: [{ id: "BRAND", valor: "Nike" }, { id: "MODEL", valor: "X" }], variacoes: [v("Preto"), v()] }).map((x) => x.id), ["COLOR"]);

  const item = montarItemMl({ titulo: "Tênis", categoria_id: "MLB1", preco: 1, estoque: 1, condicao: "new", tipo: "premium", fotos: ["https://x.test/a.jpg"], atributos: [{ id: "BRAND", valor: "Nike" }], garantia: { tipo: "Garantia do vendedor", tempo: "90 dias" } }, { me2: false });
  assert.equal(item.listing_type_id, "gold_pro");
  assert.equal(item.shipping, undefined, "sem me2: não força frete");
  assert.deepEqual(item.sale_terms, [{ id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" }, { id: "WARRANTY_TIME", value_name: "90 dias" }]);
  assert.equal(validatePayload("create_listing", { item }), null);
  assert.match(validatePayload("create_listing", { item: { ...item, pictures: [{ source: "javascript:alert(1)" }] } })!, /Fotos/);
  assert.match(validatePayload("create_listing", { item: { ...item, category_id: "XYZ" } })!, /Categoria/);
  assert.throws(() => montarItemMl({ titulo: "T", categoria_id: "MLB1", preco: 1, estoque: 1, condicao: "new", tipo: "classico", fotos: Array.from({ length: 11 }, (_, i) => `https://x.test/${i}.jpg`), atributos: [] }, { me2: true }), /10 fotos/);

  const e = new ApiError("Validation error", 400, { error: "validation_error", cause: [{ type: "error", code: "item.price.invalid", references: ["item.price"], message: "price is invalid" }, { type: "warning", message: "ignorar" }] }, `${ML}/items`);
  assert.equal(traduzirErroMl(e), "O Mercado Livre recusou (400 validation_error): item.price: price is invalid");
  assert.match(traduzirErroMl(new ApiError("x", 401, {}, ML)), /reconecte/);
});

test("tools/list: ferramentas de marketplace registradas, sem exclusão; ml_ads_alterar marcada como escrita", () => {
  const nomes = TODAS_FERRAMENTAS.map((f) => f.nome);
  for (const n of ["marketplace_contas", "anuncios_listar", "anuncio_ver", "ml_categoria_sugerir", "ml_atributos_categoria", "anuncio_criar", "anuncio_alterar", "perguntas_listar", "pergunta_responder", "pedidos_listar", "ml_ads_campanhas", "ml_ads_alterar"]) {
    assert.ok(nomes.includes(n), n);
  }
  assert.equal(new Set(nomes).size, nomes.length, "sem nomes repetidos");
  assert.ok(!FERRAMENTAS_MARKETPLACE.some((f) => /exclu|apag|delet/.test(f.nome)));
  assert.equal(FERRAMENTAS_MARKETPLACE.find((f) => f.nome === "anuncio_criar")!.escrita, true);
});

// ─── Com banco ───────────────────────────────────────────────────────────────

let C1 = "", C2 = "", C3 = "", ACC1 = "", ACC2 = "";
const saidas: unknown[] = [];
const atualizados: string[] = [];
const deps = (extra: Deps = {}): Deps => ({ atualizarAnuncio: async (acc, id) => { atualizados.push(`${acc}:${id}`); }, ...extra });
const rodar = async (nome: string, args: unknown, d: Deps = deps()) => { const r = await executarQualquer(nome, dono, args, d); saidas.push(r); return r as any; };
const auditoria = (event: string) => rawQuery<{ actor: string; client_id: string | null; details: any }>("select actor, client_id, details from avanteza.audit_log where event = $1 order by id desc", [event]);

before(async () => {
  instalar();
  if (!HAS_DB) return;
  await resetSchema();
  C1 = await mkClient("Loja Corrida");
  C2 = await mkClient("Outra Loja");
  C3 = await mkClient("Sem Marketplace");
  const futuro = new Date(Date.now() + 5 * 3600_000).toISOString();
  const conta = async (c: string, uid: string, nick: string) => (await rawQuery<{ id: string }>(
    "insert into avanteza.marketplace_accounts (client_id, marketplace, external_user_id, nickname, access_token_enc, refresh_token_enc, token_expires_at) values ($1,'mercadolivre',$2,$3,$4,$5,$6) returning id",
    [c, uid, nick, encrypt(TOKEN_ML), encrypt("TG-REFRESH-SECRETO"), futuro]))[0].id;
  ACC1 = await conta(C1, "111", "LOJACORRIDA");
  ACC2 = await conta(C2, "222", "OUTRALOJA");
  await rawQuery("insert into avanteza.listings (account_id, external_id, title, status, price, available_quantity) values ($1,'MLB111','Tênis Corrida Leve','active',100,5), ($2,'MLB222','Produto de outro','active',50,1)", [ACC1, ACC2]);
  await rawQuery("update avanteza.settings set dry_run = false, global_pause = false");
  await rawQuery("insert into avanteza.admins (email, role, name, active) values ($1,'admin','Dono',true)", [DONO]);
});
beforeEach(() => { chamadas = []; rotas = []; });
after(async () => { globalThis.fetch = original; if (HAS_DB) await closeDb(); });

test("rota MCP: tools/list devolve as ferramentas de anúncios", { skip }, async () => {
  const tk = assinar({ t: "access", exp: agora() + 60, cid: "c", sub: DONO });
  const res = await mcp.POST(new Request("https://app.avanteza.com.br/api/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tk}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  const txt = await res.text();
  const corpo = txt.startsWith("{") ? JSON.parse(txt) : JSON.parse(txt.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  const nomes = corpo.result.tools.map((t: any) => t.name);
  for (const f of TODAS_FERRAMENTAS) assert.ok(nomes.includes(f.nome), f.nome);
});

test("ML: contas do cliente; cliente sem conta → erro claro com instrução", { skip }, async () => {
  const r = await rodar("marketplace_contas", { cliente: C1 });
  assert.equal(r.contas.length, 1);
  assert.equal(r.contas[0].apelido, "LOJACORRIDA");
  assert.equal(r.contas[0].acesso_ok, true);
  await assert.rejects(executarQualquer("anuncio_criar", dono, { cliente: C3, titulo: "Tênis", categoria_id: "MLB1", preco: 10, fotos: ["https://x.test/a.jpg"] }, deps()), /não tem conta do Mercado Livre conectada.*Reconecte/);
  await assert.rejects(executarQualquer("anuncio_criar", dono, { cliente: C1, marketplace: "shopee", titulo: "Tênis", categoria_id: "MLB1", preco: 10, fotos: ["https://x.test/a.jpg"] }, deps()), /ainda não é suportada/);
  const l = await rodar("anuncios_listar", { cliente: C1 });
  assert.deepEqual(l.anuncios.map((x: any) => x.id), ["MLB111"]);
  assert.equal(chamadas.length, 0, "listar e contas não chamam a API");
});

test("ML criar: faltando atributo obrigatório → lista estruturada e NADA é publicado", { skip }, async () => {
  rota("GET", /\/categories\/MLB1\/attributes$/, { json: ATRIBUTOS });
  rota("GET", /\/categories\/MLB1\/sale_terms$/, { json: [] });
  const r = await rodar("anuncio_criar", { cliente: C1, titulo: "Tênis Corrida Leve", categoria_id: "MLB1", preco: 199.9, fotos: ["https://x.test/a.jpg"], atributos: [{ id: "BRAND", valor: "Nike" }] });
  assert.equal(r.ok, false);
  assert.equal(r.publicado, false);
  assert.deepEqual(r.atributos_faltando.map((x: any) => x.id), ["MODEL", "COLOR"]);
  assert.deepEqual(r.atributos_faltando.find((x: any) => x.id === "COLOR").exemplos, ["Preto", "Branco"]);
  assert.ok(!chamadas.some((c) => c.metodo === "POST"));
  assert.equal((await rawQuery("select 1 from avanteza.actions where action_type = 'create_listing'")).length, 0);
});

test("ML criar completo: atributos → frete → POST /items (variações) → descrição → painel; ação executada e auditada", { skip }, async () => {
  rota("GET", /\/categories\/MLB1\/attributes$/, { json: ATRIBUTOS });
  rota("GET", /\/categories\/MLB1\/sale_terms$/, { json: [{ id: "WARRANTY_TYPE", name: "Tipo de garantia", values: [{ name: "Garantia do vendedor" }] }] });
  rota("GET", /\/users\/111\/shipping_preferences$/, { json: { modes: ["custom", "me2"] } });
  rota("POST", /\/items$/, { status: 201, json: { id: "MLB999", status: "active", permalink: "https://produto.mercadolivre.com.br/MLB999", title: "Tênis Corrida Leve" } });
  rota("POST", /\/items\/MLB999\/description$/, { status: 201, json: { plain_text: "ok" } });
  const r = await rodar("anuncio_criar", {
    cliente: "Loja Corrida", titulo: "Tênis Corrida Leve", categoria_id: "MLB1", preco: 199.9, tipo: "premium", condicao: "new",
    fotos: ["https://x.test/capa.jpg"], atributos: [{ id: "BRAND", valor: "Nike" }, { id: "MODEL", valor: "Leve 2" }],
    garantia: { tipo: "Garantia do vendedor", tempo: "90 dias" },
    variacoes: [
      { atributos: [{ id: "COLOR", valor: "Preto" }], preco: 199.9, estoque: 3, fotos: ["https://x.test/preto.jpg"], sku: "TN-P" },
      { atributos: [{ id: "COLOR", valor_id: "52055" }], preco: 189.9, estoque: 2 },
    ],
    descricao: "Tênis leve para corrida.\nSola de borracha.",
  });
  assert.equal(r.ok, true);
  assert.equal(r.publicado, true);
  assert.equal(r.anuncio_id, "MLB999");
  assert.equal(r.descricao, "criada");
  assert.deepEqual(chamadasMl(), [
    "GET /categories/MLB1/attributes", "GET /categories/MLB1/sale_terms", "GET /users/111/shipping_preferences", "POST /items", "POST /items/MLB999/description",
  ]);
  const post = chamadas.find((c) => c.metodo === "POST" && c.url.pathname === "/items")!;
  assert.equal(post.auth, `Bearer ${TOKEN_ML}`);
  const b = post.corpo;
  assert.equal(b.title, "Tênis Corrida Leve");
  assert.equal(b.currency_id, "BRL");
  assert.equal(b.buying_mode, "buy_it_now");
  assert.equal(b.listing_type_id, "gold_pro");
  assert.equal(b.available_quantity, 5);
  assert.deepEqual(b.pictures, [{ source: "https://x.test/capa.jpg" }, { source: "https://x.test/preto.jpg" }]);
  assert.deepEqual(b.attributes, [{ id: "BRAND", value_name: "Nike" }, { id: "MODEL", value_name: "Leve 2" }]);
  assert.deepEqual(b.shipping, { mode: "me2", local_pick_up: false, free_shipping: false });
  assert.deepEqual(b.variations[0], { attribute_combinations: [{ id: "COLOR", value_name: "Preto" }], price: 199.9, available_quantity: 3, picture_ids: ["https://x.test/preto.jpg"], attributes: [{ id: "SELLER_SKU", value_name: "TN-P" }] });
  assert.deepEqual(b.variations[1].attribute_combinations, [{ id: "COLOR", value_id: "52055" }]);
  assert.deepEqual(chamadas.find((c) => c.url.pathname === "/items/MLB999/description")!.corpo, { plain_text: "Tênis leve para corrida.\nSola de borracha." });
  assert.deepEqual(atualizados.at(-1), `${ACC1}:MLB999`, "atualiza o anúncio no painel");
  const [acao] = await rawQuery<any>("select status, action_type, client_id, decided_by, after_state from avanteza.actions where action_type = 'create_listing'");
  assert.equal(acao.status, "executed");
  assert.equal(acao.client_id, C1);
  assert.equal(acao.decided_by, DONO);
  assert.equal(acao.after_state.id, "MLB999");
  const [aud] = await auditoria("anuncio_criado");
  assert.equal(aud.actor, DONO);
  assert.equal(aud.details.via, "claude");
  assert.equal(aud.details.anuncio_id, "MLB999");
  const [prop] = await auditoria("proposed");
  assert.equal(prop.details.mode, "direto");
});

test("ML criar: erro do ML (cause[]) vira mensagem em português com o campo", { skip }, async () => {
  rota("GET", /\/categories\/MLB1\/attributes$/, { json: ATRIBUTOS.slice(0, 1) });
  rota("GET", /\/categories\/MLB1\/sale_terms$/, { json: [] });
  rota("GET", /shipping_preferences$/, { json: { modes: ["me2"] } });
  rota("POST", /\/items$/, { status: 400, json: { message: "Validation error", error: "validation_error", cause: [{ type: "error", code: "item.title.length", references: ["item.title"], message: "title too long" }] } });
  await assert.rejects(
    executarQualquer("anuncio_criar", dono, { cliente: C1, titulo: "Tênis", categoria_id: "MLB1", preco: 10, fotos: ["https://x.test/a.jpg"], atributos: [{ id: "BRAND", valor: "Nike" }] }, deps()),
    (e: unknown) => e instanceof ErroFerramenta && /Mercado Livre recusou \(400 validation_error\): item\.title: title too long/.test(e.message),
  );
  const [f] = await rawQuery<any>("select status, error from avanteza.actions where action_type = 'create_listing' order by created_at desc limit 1");
  assert.equal(f.status, "failed");
  assert.match(f.error, /item\.title/);
});

test("ML alterar: preço acima do limite diário é recusado; dentro do limite passa; pausar e reativar", { skip }, async () => {
  let preco = 100, status = "active";
  rota("GET", /\/items\/MLB111$/, () => ({ json: itemVivo("MLB111", { price: preco, status }) }));
  rota("PUT", /\/items\/MLB111$/, (c) => { if (c.corpo.price) preco = c.corpo.price; if (c.corpo.status) status = c.corpo.status; return { json: { price: preco, status } }; });
  // limite global de preço: 10 % ao dia (schema)
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, anuncio_id: "MLB111", preco: 150 }, deps()), /preco: Bloqueado pelo limite: Variação de 50\.0% no dia excede o limite de 10%/);
  assert.ok(!chamadas.some((c) => c.metodo === "PUT"), "nada enviado ao ML");
  const ok = await rodar("anuncio_alterar", { cliente: C1, anuncio_id: "MLB111", preco: 105 });
  assert.equal(ok.alteracoes[0].status, "executada");
  assert.equal(preco, 105);
  // a referência do dia continua 100: 112 passaria de 10 %
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, anuncio_id: "MLB111", preco: 112 }, deps()), /limite/);
  const p = await rodar("anuncio_alterar", { cliente: C1, anuncio_id: "MLB111", status: "pausado" });
  assert.equal(p.alteracoes[0].status, "executada");
  assert.equal(status, "paused");
  await rodar("anuncio_alterar", { cliente: C1, anuncio_id: "MLB111", status: "ativo" });
  assert.equal(status, "active");
  const tipos = await rawQuery<any>("select action_type, status from avanteza.actions where target_id = 'MLB111' order by created_at");
  assert.deepEqual(tipos.map((t) => `${t.action_type}:${t.status}`), ["update_price:failed", "update_price:executed", "update_price:failed", "pause_listing:executed", "activate_listing:executed"]);
  const evs = await auditoria("anuncio_alterado");
  assert.ok(evs.length >= 3 && evs.every((e) => e.details.via === "claude" && e.actor === DONO));
  assert.equal((await auditoria("anuncio_alteracao_recusada"))[0].details.via, "claude");
});

test("ML alterar: título, descrição e fotos pelo update_listing", { skip }, async () => {
  rota("GET", /\/items\/MLB111$/, { json: itemVivo("MLB111") });
  rota("PUT", /\/items\/MLB111$/, (c) => ({ json: { title: c.corpo.title ?? "x", pictures: c.corpo.pictures ?? [] } }));
  rota("PUT", /\/items\/MLB111\/description$/, { json: {} });
  const r = await rodar("anuncio_alterar", { cliente: C1, anuncio_id: "MLB111", titulo: "Tênis Corrida Leve Novo", descricao: "Nova descrição", fotos: ["https://x.test/1.jpg", "http://x.test/2.jpg"] });
  assert.equal(r.alteracoes[0].alteracao, "conteudo");
  const puts = chamadas.filter((c) => c.metodo === "PUT");
  assert.deepEqual(puts.map((c) => c.corpo), [{ title: "Tênis Corrida Leve Novo" }, { pictures: [{ source: "https://x.test/1.jpg" }, { source: "https://x.test/2.jpg" }] }, { plain_text: "Nova descrição" }]);
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, anuncio_id: "MLB111", fotos: ["javascript:alert(1)"] }, deps()), /Foto com endereço inválido/);
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, anuncio_id: "MLB111" }, deps()), /Nada para alterar/);
});

test("ML: anúncio de outro cliente é recusado (banco e ao vivo); pergunta de outro vendedor também", { skip }, async () => {
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, anuncio_id: "MLB222", preco: 51 }, deps()), /outro cliente/);
  await assert.rejects(executarQualquer("anuncio_ver", dono, { cliente: C1, anuncio_id: "MLB222" }, deps()), /outro cliente/);
  // não coletado ainda: confere o seller_id ao vivo
  rota("GET", /\/items\/MLB777$/, { json: { id: "MLB777", seller_id: 222 } });
  await assert.rejects(executarQualquer("anuncio_alterar", dono, { cliente: C1, anuncio_id: "MLB777", status: "pausado" }, deps()), /não pertence à conta/);
  assert.ok(!chamadas.some((c) => c.metodo === "PUT"));
  rota("GET", /\/questions\/555$/, { json: { id: 555, item_id: "MLB222", seller_id: 222, text: "Tem azul?", status: "UNANSWERED", date_created: "2026-11-01T10:00:00Z" } });
  await assert.rejects(executarQualquer("pergunta_responder", dono, { cliente: C1, pergunta_id: "555", texto: "Temos sim!" }, deps()), /não é de um anúncio deste cliente/);
  assert.ok(!chamadas.some((c) => c.metodo === "POST"));
  assert.equal((await rawQuery("select 1 from avanteza.actions where target_id in ('MLB222','MLB777','555')")).length, 0);
});

test("ML: responder pergunta, ler Product Ads e recusar escrita de Product Ads", { skip }, async () => {
  rota("GET", /\/questions\/556$/, { json: { id: 556, item_id: "MLB111", seller_id: 111, text: "Tem 42?", status: "UNANSWERED", date_created: "2026-11-01T10:00:00Z" } });
  rota("POST", /\/answers$/, { json: { status: "ANSWERED", answer: { text: "Temos sim!" } } });
  const r = await rodar("pergunta_responder", { cliente: C1, pergunta_id: "556", texto: "Temos sim!" });
  assert.equal(r.status, "executada");
  assert.deepEqual(chamadas.find((c) => c.metodo === "POST")!.corpo, { question_id: 556, text: "Temos sim!" });
  rota("GET", /\/advertising\/advertisers$/, { json: { advertisers: [{ advertiser_id: 9, site_id: "MLB" }] } });
  rota("GET", /\/product_ads\/campaigns\/search$/, { json: { results: [{ id: 1, name: "Campanha 1", status: "active", budget: 50, metrics: { cost: 10, total_amount: 80, roas: 8 } }], paging: { total: 1 } } });
  const ads = await rodar("ml_ads_campanhas", { cliente: C1 });
  assert.equal(ads.campanhas[0].roas, 8);
  await assert.rejects(executarQualquer("ml_ads_alterar", dono, { cliente: C1, campanha_id: "1", orcamento: 80 }, deps()), /ainda não foi validado/);
  assert.ok(!chamadas.some((c) => c.metodo === "PUT"));
});

test("ML: atualizarUmAnuncio grava o anúncio novo em listings e no snapshot do dia (painel)", { skip }, async () => {
  rota("GET", /\/items$/, (c) => ({ json: [{ code: 200, body: itemVivo(c.url.searchParams.get("ids")!, { title: "Criado agora", price: 199.9 }) }] }));
  assert.equal(await atualizarUmAnuncio(ACC1, "MLB999"), true);
  const [l] = await rawQuery<any>("select title, price::float8 p, thumbnail from avanteza.listings where account_id = $1 and external_id = 'MLB999'", [ACC1]);
  assert.equal(l.title, "Criado agora");
  assert.equal(l.p, 199.9);
  assert.equal(l.thumbnail, "https://http2.mlstatic.com/D_1-I.jpg");
  assert.equal((await rawQuery("select 1 from avanteza.listing_snapshots where account_id = $1 and external_id = 'MLB999'", [ACC1])).length, 1);
});

test("saídas de marketplace: nunca levam token, refresh ou campo cifrado", { skip }, async () => {
  const tudo = JSON.stringify(saidas);
  assert.ok(saidas.length >= 8);
  for (const proibido of [TOKEN_ML, "TG-REFRESH-SECRETO", "access_token", "_enc", "v1:"]) assert.ok(!tudo.includes(proibido), proibido);
  assert.deepEqual(limpar({ ok: 1, token: "x" }), { ok: 1 });
});
