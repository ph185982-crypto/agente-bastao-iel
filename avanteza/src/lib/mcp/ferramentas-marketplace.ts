// Ferramentas de MARKETPLACE do conector do Claude: contas, anúncios (listar, ver, criar, alterar), perguntas, pedidos e
// Product Ads (só leitura). Vale para TODOS os clientes com conta conectada. Decisão do dono: publicar DIRETO (sem etapa de
// aprovação) — mas sempre pelo executor (executarDireto), que grava a ação em `actions`, respeita a pausa geral, a simulação
// global e os limites diários de preço/verba, e audita. Cada escrita também vai para a auditoria com { via: "claude" }.
// Hoje só o Mercado Livre cria anúncio; o parâmetro `marketplace` já existe para Shopee/TikTok entrarem depois.
import { z } from "zod";
import { rawQuery } from "@/lib/db/client";
import { adminDb } from "@/lib/db";
import { getValidAccessToken, type AccountRow } from "@/lib/accounts";
import { getAdapter, MARKETPLACE_LABEL } from "@/lib/marketplaces";
import type { ActionType, MarketplaceId } from "@/lib/marketplaces/types";
import { executarDireto } from "@/lib/executor/executor";
import { atualizarUmAnuncio } from "@/lib/collector";
import { addDays, spDate } from "@/lib/dates";
import { ML_API } from "@/lib/marketplaces/mercadolivre/adapter";
import { fetchJson } from "@/lib/http";
import {
  atributosDaCategoria, atributosFaltando, contaUsaMe2, fotosValidas, montarItemMl, sugerirCategoria, traduzirErroMl, MAX_FOTOS, type NovoAnuncio,
} from "@/lib/marketplaces/mercadolivre/criar";
import { ErroFerramenta, LIMITE, auditar, cliente, corta, def, ehAdmin, exigir, resolverCliente, type Ator, type Deps, type Ferramenta } from "./ferramentas";

// ─── Conta e anúncio do cliente ──────────────────────────────────────────────

const MARKETPLACES = ["mercadolivre", "shopee", "tiktok"] as const;
const marketplace = z.enum(MARKETPLACES).default("mercadolivre").describe("mercadolivre (padrão), shopee ou tiktok.");
const contaRef = z.string().trim().max(80).optional().describe("Apelido ou id da conta, se o cliente tiver mais de uma no marketplace.");
const idAnuncio = z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, "Id de anúncio inválido.").describe("Id do anúncio (ex.: MLB1234567890).");

const RECONECTAR = "Reconecte na Central: Clientes → abra o cliente → Marketplaces → Conectar.";

type Conta = Pick<AccountRow, "id" | "client_id" | "marketplace" | "external_user_id" | "nickname" | "status" | "ads_advertiser_id" | "site_id">;

/** Conta do cliente no marketplace. Sem conta, conta desativada/precisando de reautorização ou ambígua → erro claro. */
export async function contaDoCliente(c: { id: string; name: string }, mp: MarketplaceId, ref?: string): Promise<Conta> {
  const contas = await rawQuery<Conta>(
    "select id, client_id, marketplace, external_user_id, nickname, status, ads_advertiser_id, site_id from avanteza.marketplace_accounts where client_id = $1 and marketplace = $2 order by created_at",
    [c.id, mp],
  );
  const rotulo = MARKETPLACE_LABEL[mp];
  if (!contas.length) throw new ErroFerramenta(`${c.name} não tem conta do ${rotulo} conectada. ${RECONECTAR}`);
  let escolhidas = contas;
  if (ref) escolhidas = contas.filter((x) => x.id === ref || (x.nickname ?? "").toLowerCase() === ref.toLowerCase() || x.external_user_id === ref);
  else if (contas.length > 1) escolhidas = contas.filter((x) => x.status === "active");
  if (escolhidas.length !== 1) {
    throw new ErroFerramenta(`${c.name} tem ${contas.length} contas do ${rotulo}: ${contas.map((x) => `${x.nickname ?? "?"} (${x.id})`).join("; ")}. Informe "conta".`);
  }
  const a = escolhidas[0];
  if (a.status !== "active") throw new ErroFerramenta(`A conta ${a.nickname ?? a.id} do ${rotulo} precisa de nova autorização (status: ${a.status}). ${RECONECTAR}`);
  return a;
}

/** Token válido (renova se precisar). Nunca sai da função chamadora; falha vira instrução de reconectar. */
async function tokenDa(conta: Conta): Promise<string> {
  try {
    return (await getValidAccessToken(conta.id)).token;
  } catch {
    throw new ErroFerramenta(`O acesso da conta ${conta.nickname ?? conta.id} expirou ou não pôde ser renovado. ${RECONECTAR}`);
  }
}

/** O anúncio precisa ser desta conta: pelo banco (coleta) ou, se ainda não coletado, pelo seller_id no Mercado Livre. */
async function garantirAnuncioDaConta(conta: Conta, itemId: string): Promise<void> {
  const linhas = await rawQuery<{ account_id: string; client_id: string }>(
    "select l.account_id, a.client_id from avanteza.listings l join avanteza.marketplace_accounts a on a.id = l.account_id where l.external_id = $1",
    [itemId],
  );
  if (linhas.some((l) => l.account_id === conta.id)) return;
  if (linhas.length) throw new ErroFerramenta("Este anúncio é de outro cliente/conta. Nada foi alterado.");
  if (conta.marketplace !== "mercadolivre") throw new ErroFerramenta("Anúncio não encontrado nesta conta (rode a coleta da conta antes).");
  const token = await tokenDa(conta);
  let dono: string | null = null;
  try {
    const it = await fetchJson<{ seller_id?: number | string }>(`${ML_API}/items/${itemId}?attributes=id,seller_id`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, { retries: 1 });
    dono = it.seller_id != null ? String(it.seller_id) : null;
  } catch (e) {
    throw new ErroFerramenta(`Não consegui ler o anúncio ${itemId}: ${traduzirErroMl(e)}`);
  }
  if (dono !== conta.external_user_id) throw new ErroFerramenta("Este anúncio não pertence à conta deste cliente. Nada foi alterado.");
}

const soMl = (mp: MarketplaceId, o = "esta operação") => {
  if (mp !== "mercadolivre") throw new ErroFerramenta(`${MARKETPLACE_LABEL[mp]}: ${o} ainda não é suportada pelo conector (só Mercado Livre por enquanto).`);
};

/** Executa uma ação pelo executor em modo direto e traduz o resultado. Falha → ErroFerramenta com a mensagem do executor. */
async function executar(ator: Ator, c: { id: string }, conta: Conta, type: ActionType, targetId: string, payload: Record<string, unknown>, motivo?: string) {
  let r: any;
  try {
    r = await executarDireto({ clientId: c.id, accountId: conta.id, type, targetId, payload, reason: motivo ?? "Pedido pelo conector do Claude", source: "manual", actor: ator.email, via: "claude" });
  } catch (e) {
    throw new ErroFerramenta(e instanceof Error ? e.message.slice(0, 400) : "Não foi possível executar.");
  }
  if (r?.status === "failed") throw new ErroFerramenta(String(r.error ?? "Falhou.").slice(0, 500));
  if (r?.status === "approved") return { acao_id: r.id, status: "aguardando", aviso: "Pausa geral ligada (Configurações): a ação ficou aprovada na fila e roda quando a pausa for desligada.", depois: null };
  return { acao_id: r?.id, status: r?.status === "simulated" ? "simulada" : "executada", aviso: r?.status === "simulated" ? "Simulação ligada (Configurações → modo simulação): nada foi enviado ao marketplace." : undefined, depois: r?.after_state ?? null };
}

async function atualizarPainel(deps: Deps, contaId: string, itemId: string) {
  try {
    await (deps.atualizarAnuncio ?? atualizarUmAnuncio)(contaId, itemId);
    return true;
  } catch {
    return false; // a coleta da conta corrige depois
  }
}

const brl = (n: number) => Math.round(n * 100) / 100;

// ─── Ferramentas ─────────────────────────────────────────────────────────────

const atributo = z.object({
  id: z.string().trim().min(2).max(60).describe("Id do atributo (ex.: BRAND, MODEL, COLOR)."),
  valor: z.string().trim().min(1).max(255).optional(), valor_id: z.string().trim().max(40).optional().describe("Id do valor da lista do ML (opcional)."),
});

export const FERRAMENTAS_MARKETPLACE: Ferramenta[] = [
  def({
    nome: "marketplace_contas", titulo: "Contas de marketplace do cliente", escrita: false,
    descricao: "Contas conectadas do cliente (Mercado Livre, Shopee, TikTok Shop): apelido, status, se o acesso está ok, se tem Product Ads e a última coleta.",
    entrada: { cliente },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const rows = await rawQuery<any>(
        `select id, marketplace, nickname, status, ads_advertiser_id is not null as ads, (refresh_token_enc is not null) as renovavel, token_expires_at, last_collected_at, last_error,
           (select count(*)::int from avanteza.listings l where l.account_id = a.id) as anuncios
         from avanteza.marketplace_accounts a where client_id = $1 order by marketplace, created_at`, [c.id]);
      return {
        cliente: c.name,
        contas: rows.map((r) => ({
          id: r.id, marketplace: r.marketplace, apelido: r.nickname, status: r.status,
          acesso_ok: r.status === "active" && (r.renovavel || (r.token_expires_at && new Date(r.token_expires_at).getTime() > Date.now())),
          ads_disponivel: Boolean(r.ads), anuncios_no_painel: r.anuncios, ultima_coleta: r.last_collected_at, ultimo_erro: corta(r.last_error, 200),
        })),
        aviso: rows.length ? undefined : `Nenhuma conta conectada. ${RECONECTAR}`,
      };
    },
  }),
  def({
    nome: "anuncios_listar", titulo: "Listar anúncios", escrita: false,
    descricao: `Anúncios do cliente (da última coleta, no banco): status, preço, estoque, vendidos, visitas 30d e variações. Filtros por status e texto. Até ${LIMITE}.`,
    entrada: {
      cliente, marketplace, status: z.enum(["active", "paused", "closed", "under_review", "inactive"]).optional(), texto: z.string().trim().max(80).optional(),
      limite: z.number().int().min(1).max(LIMITE).optional(),
    },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const params: unknown[] = [c.id, a.marketplace];
      let filtro = "";
      if (a.status) { params.push(a.status); filtro += ` and l.status = $${params.length}`; }
      if (a.texto) { params.push(`%${a.texto}%`); filtro += ` and (l.title ilike $${params.length} or l.external_id ilike $${params.length})`; }
      params.push(a.limite ?? LIMITE);
      const rows = await rawQuery<any>(
        `select l.external_id, l.title, l.status, l.price::float8 as price, l.available_quantity, l.sold_quantity, l.visits_30d, l.permalink, l.listing_type_id, l.has_variations, l.variations, l.updated_at, a.nickname
         from avanteza.listings l join avanteza.marketplace_accounts a on a.id = l.account_id
         where a.client_id = $1 and a.marketplace = $2 ${filtro} order by l.sold_quantity desc nulls last, l.updated_at desc limit $${params.length}`, params);
      const [{ total }] = await rawQuery<{ total: number }>("select count(*)::int total from avanteza.listings l join avanteza.marketplace_accounts a on a.id = l.account_id where a.client_id = $1 and a.marketplace = $2", [c.id, a.marketplace]);
      return {
        cliente: c.name, total_no_painel: total,
        anuncios: rows.map((r) => ({
          id: r.external_id, titulo: r.title, status: r.status, preco: r.price, estoque: r.available_quantity, vendidos: r.sold_quantity, visitas_30d: r.visits_30d,
          tipo: r.listing_type_id, conta: r.nickname, link: r.permalink, atualizado_em: r.updated_at,
          variacoes: r.has_variations && Array.isArray(r.variations) ? r.variations.slice(0, 20).map((v: any) => ({ id: v.id, nome: v.name, preco: v.price, estoque: v.stock })) : undefined,
        })),
      };
    },
  }),
  def({
    nome: "anuncio_ver", titulo: "Ver anúncio", escrita: false,
    descricao: "Um anúncio do cliente: dados do painel + leitura ao vivo no marketplace (status, sub-status, preço, estoque, fotos, variações).",
    entrada: { cliente, marketplace, anuncio_id: idAnuncio, conta: contaRef },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, a.marketplace, a.conta);
      await garantirAnuncioDaConta(conta, a.anuncio_id);
      const [db] = await rawQuery<any>("select visits_30d, updated_at from avanteza.listings where account_id = $1 and external_id = $2", [conta.id, a.anuncio_id]);
      const token = await tokenDa(conta);
      let vivo;
      try { [vivo] = await getAdapter(conta.marketplace).getListings(token, [a.anuncio_id]); } catch (e) { throw new ErroFerramenta(`Leitura ao vivo falhou: ${traduzirErroMl(e)}`); }
      if (!vivo) throw new ErroFerramenta("Anúncio não encontrado no marketplace.");
      return {
        id: vivo.externalId, titulo: vivo.title, status: vivo.status, sub_status: vivo.subStatus, preco: vivo.price, estoque: vivo.availableQuantity, vendidos: vivo.soldQuantity,
        tipo: vivo.listingTypeId, link: vivo.permalink, fotos: vivo.imageUrls, visitas_30d: db?.visits_30d ?? null, painel_atualizado_em: db?.updated_at ?? null,
        variacoes: (vivo.variations ?? []).map((v) => ({ id: v.id, nome: v.name, preco: v.price, estoque: v.stock, sku: v.sku })),
      };
    },
  }),
  def({
    nome: "ml_categoria_sugerir", titulo: "Sugerir categoria (Mercado Livre)", escrita: false,
    descricao: "Sugere a categoria do Mercado Livre pelo título do produto (preditor do ML). Use o categoria_id em ml_atributos_categoria e anuncio_criar.",
    entrada: { cliente, titulo: z.string().trim().min(3).max(120), conta: contaRef },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      try { return { sugestoes: await sugerirCategoria(await tokenDa(conta), a.titulo) }; } catch (e) { if (e instanceof ErroFerramenta) throw e; throw new ErroFerramenta(traduzirErroMl(e)); }
    },
  }),
  def({
    nome: "ml_atributos_categoria", titulo: "Atributos da categoria (Mercado Livre)", escrita: false,
    descricao: "Atributos da categoria do Mercado Livre, obrigatórios primeiro (id, nome, se vale por variação, valores aceitos) e os termos de venda (garantia).",
    entrada: { cliente, categoria_id: z.string().trim().regex(/^MLB\d{1,12}$/, "Categoria inválida (ex.: MLB1055)."), so_obrigatorios: z.boolean().default(false), conta: contaRef },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      let r;
      try { r = await atributosDaCategoria(await tokenDa(conta), a.categoria_id); } catch (e) { if (e instanceof ErroFerramenta) throw e; throw new ErroFerramenta(traduzirErroMl(e)); }
      const lista = r.atributos.filter((x) => !a.so_obrigatorios || x.obrigatorio).slice(0, 80);
      return {
        categoria_id: a.categoria_id,
        obrigatorios: r.atributos.filter((x) => x.obrigatorio).length,
        atributos: lista.map((x) => ({ id: x.id, nome: x.nome, obrigatorio: x.obrigatorio || undefined, de_variacao: x.de_variacao || undefined, tipo: x.tipo, valores: x.valores.slice(0, 15).map((v) => v.nome), unidades: x.unidades.length ? x.unidades.slice(0, 6) : undefined })),
        termos_venda: r.termos_venda,
      };
    },
  }),
  def({
    nome: "anuncio_criar", titulo: "Criar anúncio", escrita: true,
    descricao:
      "Publica DIRETO um anúncio novo no Mercado Livre (fotos por URL pública, até 10; atributos; variações; descrição em texto puro; garantia). " +
      "Antes confere os atributos obrigatórios da categoria: se faltar algum, NÃO publica e devolve a lista (id, nome, exemplos) para você perguntar ao usuário. " +
      "Frete: Mercado Envios (me2) quando a conta usa; frete grátis só se pedido. Respeita a pausa geral e a simulação da Central.",
    entrada: {
      cliente, marketplace, conta: contaRef,
      titulo: z.string().trim().min(3).max(60), categoria_id: z.string().trim().regex(/^MLB\d{1,12}$/, "Categoria inválida (ex.: MLB1055)."),
      preco: z.number().finite().positive().max(10_000_000).describe("Em reais. Com variações, use o preço de cada variação."),
      estoque: z.number().int().min(1).max(100_000).default(1).describe("Sem variações. Com variações, vale o estoque de cada uma."),
      condicao: z.enum(["new", "used"]).default("new").describe("new (novo) ou used (usado)."),
      tipo: z.enum(["classico", "premium"]).default("classico").describe("classico (gold_special) ou premium (gold_pro)."),
      fotos: z.array(z.string().max(2000)).min(1).max(MAX_FOTOS).describe("URLs públicas (https) das fotos, na ordem."),
      atributos: z.array(atributo).max(80).default([]),
      descricao: z.string().max(50_000).optional().describe("Texto puro (sem HTML)."),
      garantia: z.object({ tipo: z.string().trim().min(2).max(60).describe('Ex.: "Garantia do vendedor", "Garantia de fábrica", "Sem garantia".'), tempo: z.string().trim().max(40).optional().describe('Ex.: "90 dias".') }).optional(),
      variacoes: z.array(z.object({
        atributos: z.array(atributo).min(1).max(5), preco: z.number().finite().positive().max(10_000_000), estoque: z.number().int().min(0).max(100_000),
        fotos: z.array(z.string().max(2000)).max(MAX_FOTOS).optional(), sku: z.string().trim().max(60).optional(),
      })).max(60).optional(),
      sku: z.string().trim().max(60).optional(), frete_gratis: z.boolean().optional(),
    },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      soMl(a.marketplace, "criar anúncio");
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      const token = await tokenDa(conta);
      try { fotosValidas([...a.fotos, ...(a.variacoes ?? []).flatMap((v) => v.fotos ?? [])]); } catch (e) { throw new ErroFerramenta((e as Error).message); }
      let cat;
      try { cat = await atributosDaCategoria(token, a.categoria_id); } catch (e) { throw new ErroFerramenta(`Não consegui ler a categoria: ${traduzirErroMl(e)}`); }
      const entrada: NovoAnuncio = { ...a, atributos: a.atributos, variacoes: a.variacoes };
      const faltando = atributosFaltando(cat.atributos, entrada);
      if (faltando.length) {
        return {
          ok: false, publicado: false,
          erro: `Faltam ${faltando.length} atributo(s) obrigatório(s) da categoria ${a.categoria_id}. Pergunte ao usuário e chame de novo com "atributos".`,
          atributos_faltando: faltando,
        };
      }
      let item;
      try { item = montarItemMl(entrada, { me2: await contaUsaMe2(token, conta.external_user_id) }); } catch (e) { throw new ErroFerramenta((e as Error).message); }
      const r = await executar(ator, c, conta, "create_listing", `novo:${a.categoria_id}`, { item, ...(a.descricao?.trim() ? { description: a.descricao } : {}) }, "Anúncio novo pelo conector do Claude");
      const id = typeof r.depois?.id === "string" ? r.depois.id : null;
      const painel = id ? await atualizarPainel(deps, conta.id, id) : false;
      await auditar(ator, "anuncio_criado", c.id, { acao_id: r.acao_id, conta: conta.id, anuncio_id: id, status: r.status, categoria: a.categoria_id, titulo: a.titulo.slice(0, 60), variacoes: a.variacoes?.length ?? 0 });
      return {
        ok: true, publicado: r.status === "executada", status: r.status, anuncio_id: id, link: r.depois?.permalink ?? null, status_ml: r.depois?.status ?? null,
        descricao: r.depois?.description ?? (a.descricao ? null : "sem descrição"), no_painel: painel, aviso: r.aviso, acao_id: r.acao_id,
      };
    },
  }),
  def({
    nome: "anuncio_alterar", titulo: "Alterar anúncio", escrita: true,
    descricao:
      "Altera DIRETO um anúncio do cliente: preço, estoque (com variacao_id se houver várias), título, descrição, fotos (substitui todas) e status ativo/pausado. " +
      "Respeita o limite diário de variação de preço da política, a pausa geral e a simulação. Cada mudança vira uma ação no histórico do executor.",
    entrada: {
      cliente, marketplace, conta: contaRef, anuncio_id: idAnuncio,
      preco: z.number().finite().positive().max(10_000_000).optional(), estoque: z.number().int().min(0).max(100_000).optional(),
      variacao_id: z.string().trim().regex(/^[0-9A-Za-z_-]{1,40}$/).optional(), titulo: z.string().trim().min(3).max(60).optional(),
      descricao: z.string().max(50_000).optional(), fotos: z.array(z.string().max(2000)).min(1).max(MAX_FOTOS).optional(),
      status: z.enum(["ativo", "pausado"]).optional(), motivo: z.string().trim().max(300).optional(),
    },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      const ops: Array<[ActionType, Record<string, unknown>, string]> = [];
      if (a.preco !== undefined) ops.push(["update_price", { price: brl(a.preco) }, "preco"]);
      if (a.estoque !== undefined) ops.push(["update_stock", { available_quantity: a.estoque, ...(a.variacao_id ? { variation_id: a.variacao_id } : {}) }, "estoque"]);
      if (a.titulo !== undefined || a.descricao !== undefined || a.fotos !== undefined) {
        let fotos: string[] | undefined;
        try { fotos = a.fotos ? fotosValidas(a.fotos) : undefined; } catch (e) { throw new ErroFerramenta((e as Error).message); }
        ops.push(["update_listing", { ...(a.titulo !== undefined ? { title: a.titulo } : {}), ...(a.descricao !== undefined ? { description: a.descricao } : {}), ...(fotos ? { pictures: fotos } : {}) }, "conteudo"]);
      }
      if (a.status) ops.push([a.status === "pausado" ? "pause_listing" : "activate_listing", {}, "status"]);
      if (!ops.length) throw new ErroFerramenta("Nada para alterar: informe preco, estoque, titulo, descricao, fotos ou status.");
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, a.marketplace, a.conta);
      await garantirAnuncioDaConta(conta, a.anuncio_id);
      const feitos: Array<Record<string, unknown>> = [];
      for (const [tipo, payload, rotulo] of ops) {
        try {
          const r = await executar(ator, c, conta, tipo, a.anuncio_id, payload, a.motivo);
          feitos.push({ alteracao: rotulo, status: r.status, acao_id: r.acao_id, aviso: r.aviso });
          await auditar(ator, "anuncio_alterado", c.id, { acao_id: r.acao_id, conta: conta.id, anuncio_id: a.anuncio_id, tipo, status: r.status });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falhou.";
          await auditar(ator, "anuncio_alteracao_recusada", c.id, { conta: conta.id, anuncio_id: a.anuncio_id, tipo, erro: msg.slice(0, 200) });
          if (feitos.length) await atualizarPainel(deps, conta.id, a.anuncio_id);
          throw new ErroFerramenta(`${rotulo}: ${msg}${feitos.length ? ` (já feito antes disso: ${feitos.map((f) => f.alteracao).join(", ")})` : ""}`);
        }
      }
      const painel = await atualizarPainel(deps, conta.id, a.anuncio_id);
      return { ok: true, anuncio_id: a.anuncio_id, alteracoes: feitos, no_painel: painel };
    },
  }),
  def({
    nome: "perguntas_listar", titulo: "Perguntas sem resposta", escrita: false,
    descricao: "Perguntas de compradores ainda sem resposta (leitura ao vivo no Mercado Livre), mais antigas primeiro.",
    entrada: { cliente, conta: contaRef, limite: z.number().int().min(1).max(LIMITE).optional() },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      let qs;
      try { qs = await getAdapter("mercadolivre").listUnansweredQuestions(await tokenDa(conta), conta.external_user_id, a.limite ?? 20); } catch (e) { if (e instanceof ErroFerramenta) throw e; throw new ErroFerramenta(traduzirErroMl(e)); }
      const ids = [...new Set(qs.map((q) => q.itemId))];
      const titulos = ids.length ? await rawQuery<{ external_id: string; title: string }>("select external_id, title from avanteza.listings where account_id = $1 and external_id = any($2::text[])", [conta.id, ids]) : [];
      const t = new Map(titulos.map((x) => [x.external_id, x.title]));
      return { cliente: c.name, total: qs.length, perguntas: qs.map((q) => ({ id: q.externalId, anuncio_id: q.itemId, anuncio: t.get(q.itemId) ?? null, texto: corta(q.text, 500), criada_em: q.dateCreated })) };
    },
  }),
  def({
    nome: "pergunta_responder", titulo: "Responder pergunta", escrita: true,
    descricao: "Responde DIRETO uma pergunta de comprador no Mercado Livre (2 a 2000 caracteres). Confere se a pergunta é de um anúncio deste cliente.",
    entrada: { cliente, conta: contaRef, pergunta_id: z.string().trim().regex(/^\d{3,20}$/, "Id de pergunta inválido."), texto: z.string().trim().min(2).max(2000) },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      let q;
      try { q = await getAdapter("mercadolivre").getQuestion(await tokenDa(conta), a.pergunta_id); } catch (e) { if (e instanceof ErroFerramenta) throw e; throw new ErroFerramenta(`Pergunta não encontrada: ${traduzirErroMl(e)}`); }
      const vendedor = String((q.raw as any)?.seller_id ?? "");
      if (vendedor !== conta.external_user_id) throw new ErroFerramenta("Esta pergunta não é de um anúncio deste cliente. Nada foi respondido.");
      if (q.status !== "UNANSWERED") throw new ErroFerramenta(`Esta pergunta já está ${q.status === "ANSWERED" ? "respondida" : q.status}.`);
      const r = await executar(ator, c, conta, "answer_question", a.pergunta_id, { text: a.texto });
      if (r.status === "executada") await adminDb().from("questions").update({ status: "ANSWERED", answer_text: a.texto, updated_at: new Date().toISOString() }).eq("account_id", conta.id).eq("external_id", a.pergunta_id);
      await auditar(ator, "pergunta_respondida", c.id, { acao_id: r.acao_id, conta: conta.id, pergunta_id: a.pergunta_id, anuncio_id: q.itemId, status: r.status });
      return { ok: true, pergunta_id: a.pergunta_id, status: r.status, aviso: r.aviso };
    },
  }),
  def({
    nome: "pedidos_listar", titulo: "Pedidos recentes", escrita: false,
    descricao: `Pedidos do cliente nos últimos dias (da coleta, no banco): status, valor, unidades e data. Até ${LIMITE}.`,
    entrada: { cliente, marketplace, dias: z.number().int().min(1).max(90).default(7), status: z.string().trim().max(30).optional(), limite: z.number().int().min(1).max(LIMITE).optional() },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const desde = `${addDays(spDate(), -a.dias)}T00:00:00-03:00`;
      const params: unknown[] = [c.id, a.marketplace, desde];
      let filtro = "";
      if (a.status) { params.push(a.status); filtro = ` and o.status = $${params.length}`; }
      const rows = await rawQuery<any>(
        `select o.external_id, o.status, o.total_amount::float8 as total, o.units, o.date_created, a.nickname
         from avanteza.orders o join avanteza.marketplace_accounts a on a.id = o.account_id
         where a.client_id = $1 and a.marketplace = $2 and o.date_created >= $3::timestamptz ${filtro} order by o.date_created desc`, params);
      const validos = rows.filter((r) => r.status !== "cancelled" && r.status !== "invalid");
      return {
        cliente: c.name, desde: desde.slice(0, 10), quantidade: validos.length, faturamento: brl(validos.reduce((s, r) => s + Number(r.total ?? 0), 0)), unidades: validos.reduce((s, r) => s + Number(r.units ?? 0), 0),
        pedidos: rows.slice(0, a.limite ?? LIMITE).map((r) => ({ id: r.external_id, status: r.status, valor: r.total, unidades: r.units, data: r.date_created, conta: r.nickname })),
      };
    },
  }),
  def({
    nome: "ml_ads_campanhas", titulo: "Product Ads (Mercado Livre)", escrita: false,
    descricao: "Campanhas de Product Ads do Mercado Livre com métricas do período (custo, receita, ROAS, ACOS, cliques). Somente leitura.",
    entrada: { cliente, conta: contaRef, dias: z.number().int().min(1).max(90).default(30) },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      const token = await tokenDa(conta);
      const ml = getAdapter("mercadolivre");
      try {
        const ctx = conta.ads_advertiser_id ? { advertiserId: conta.ads_advertiser_id, siteId: conta.site_id ?? "MLB" } : await ml.getAdsContext(token, conta.external_user_id);
        if (!ctx) return { disponivel: false, mensagem: "Esta conta não tem Product Ads (ou o app não tem permissão de publicidade)." };
        const hoje = spDate();
        const camps = await ml.listAdsCampaigns(token, ctx, { from: addDays(hoje, -a.dias), to: hoje });
        return {
          disponivel: true, periodo: { de: addDays(hoje, -a.dias), ate: hoje },
          campanhas: camps.slice(0, LIMITE).map((x) => ({ id: x.externalId, nome: x.name, status: x.status, orcamento: x.budget, estrategia: x.strategy, roas_alvo: x.roasTarget, custo: x.metrics.cost, receita: x.metrics.revenue, roas: x.metrics.roas, acos: x.metrics.acos, cliques: x.metrics.clicks, impressoes: x.metrics.prints })),
        };
      } catch (e) {
        if (e instanceof ErroFerramenta) throw e;
        throw new ErroFerramenta(traduzirErroMl(e));
      }
    },
  }),
  def({
    nome: "ml_ads_alterar", titulo: "Alterar Product Ads (desligado)", escrita: true,
    descricao: "Alterar orçamento/status de campanhas de Product Ads do Mercado Livre. AINDA NÃO VALIDADO: a rota de escrita do ML está pendente de verificação, então esta ferramenta sempre recusa. Use ml_ads_campanhas para ler.",
    entrada: { cliente, campanha_id: z.string().trim().max(40), orcamento: z.number().positive().optional(), status: z.enum(["active", "paused"]).optional() },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      await auditar(ator, "ml_ads_alterar_recusado", c.id, { campanha: a.campanha_id, motivo: "escrita de Product Ads ainda não validada" });
      throw new ErroFerramenta("Alterar Product Ads do Mercado Livre ainda não foi validado (a rota de escrita da API está marcada para verificação). Nada foi alterado. Faça a mudança pelo painel do Mercado Livre por enquanto.");
    },
  }),
];
