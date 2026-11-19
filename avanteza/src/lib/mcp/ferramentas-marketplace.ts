// Ferramentas de MARKETPLACE do conector do Claude: contas, anúncios (listar, ver, criar, alterar), perguntas, pedidos e
// Product Ads (só leitura). Vale para TODOS os clientes com conta conectada. Decisão do dono: publicar DIRETO (sem etapa de
// aprovação) — mas sempre pelo executor (executarDireto), que grava a ação em `actions`, respeita a pausa geral, a simulação
// global e os limites diários de preço/verba, e audita. Cada escrita também vai para a auditoria com { via: "claude" }.
// Hoje só o Mercado Livre cria anúncio; o parâmetro `marketplace` já existe para Shopee/TikTok entrarem depois.
// Criação no ML: formato automático (User Products/moda, clássico com variações ou catálogo), guia de medidas, fotos por
// URL ou upload, validação sem publicar e lotes — regras e fontes da documentação em mercadolivre/publicar.ts.
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
import { atributosDaCategoria, fotosValidas, sugerirCategoria, traduzirErroMl, MAX_FOTOS } from "@/lib/marketplaces/mercadolivre/criar";
import {
  analisarCategoria, anunciosPorSku, buscarCatalogo, buscarGuias, criarGuia, decodificarImagem, dominioDaCategoria, emSerie, enviarFoto, lerGuia, montarGuia,
  planejarProduto, validarNoMl, variacaoPorSku, type Produto,
} from "@/lib/marketplaces/mercadolivre/publicar";
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

// ─── Publicação (todos os segmentos) ─────────────────────────────────────────

/** Máximo de anúncios por chamada nas ferramentas de lote; tempo máximo de trabalho por chamada (rota: 300 s). */
export const MAX_LOTE = 50;
const PRAZO_MS = 240_000;
/** Concorrência por produto ao publicar (limite de chamadas do ML). */
const CONCORRENCIA = 2;

const categoriaId = z.string().trim().regex(/^MLB\d{1,12}$/, "Categoria inválida (ex.: MLB1055).");
const skuRef = z.string().trim().min(1).max(60).describe("SKU do vendedor (SELLER_SKU).");
const foto = z.string().trim().min(1).max(14_500_000)
  .describe("URL https pública, id de foto do ML (de ml_foto_enviar) ou imagem em base64 (data URI ou base64 puro; JPG/PNG/WEBP até 10 MB).");
const motivoGtin = z.enum(["artesanal", "kit", "nao_registrado", "outro"])
  .describe("Motivo de não ter GTIN (EMPTY_GTIN_REASON): artesanal (confecção própria), kit, nao_registrado ou outro (padrão).");
const gtin = z.string().trim().regex(/^\d{8,14}$/, "GTIN/EAN: 8 a 14 dígitos.");

const produtoShape = {
  formato: z.enum(["user_products", "variacoes", "catalogo"]).optional()
    .describe("Normalmente deixe vazio (automático pela categoria e pela conta). Força: user_products (um anúncio por cor/tamanho com family_name), variacoes (clássico) ou catalogo."),
  categoria_id: categoriaId,
  titulo: z.string().trim().min(3).max(60).optional().describe("Título (formato clássico). No User Products o ML gera o título; use family_name."),
  family_name: z.string().trim().min(3).max(120).optional().describe('Nome genérico do produto, sem cor/tamanho (ex.: "Macaquinho Cirrê com Bolsos"). Obrigatório no User Products (se faltar, usa o titulo).'),
  preco: z.number().finite().positive().max(10_000_000).optional().describe("Em reais (anúncio sem itens/variações)."),
  estoque: z.number().int().min(1).max(100_000).default(1).describe("Anúncio sem itens/variações."),
  condicao: z.enum(["new", "used"]).default("new").describe("new (novo) ou used (usado)."),
  tipo: z.enum(["classico", "premium"]).default("classico").describe("classico (gold_special) ou premium (gold_pro)."),
  fotos: z.array(foto).max(MAX_FOTOS).default([]).describe("Fotos comuns a todos os itens (no clássico: fotos do anúncio)."),
  atributos: z.array(atributo).max(80).default([]).describe("Atributos comuns (marca, modelo, material…) por nome (valor) ou valor_id."),
  descricao: z.string().max(50_000).optional().describe("Texto puro (sem HTML). No User Products vai em cada anúncio."),
  garantia: z.object({ tipo: z.string().trim().min(2).max(60).describe('Ex.: "Garantia do vendedor", "Garantia de fábrica", "Sem garantia".'), tempo: z.string().trim().max(40).optional().describe('Ex.: "90 dias".') }).optional(),
  variacoes: z.array(z.object({
    atributos: z.array(atributo).min(1).max(5), preco: z.number().finite().positive().max(10_000_000), estoque: z.number().int().min(0).max(100_000),
    fotos: z.array(foto).max(MAX_FOTOS).optional(), sku: z.string().trim().max(60).optional(),
  })).max(60).optional().describe("Formato clássico. Se a conta estiver no User Products, cada variação vira um anúncio."),
  itens: z.array(z.object({
    cor: z.string().trim().min(1).max(60).optional(), tamanho: z.string().trim().min(1).max(30).optional(),
    preco: z.number().finite().positive().max(10_000_000), estoque: z.number().int().min(1).max(100_000), sku: z.string().trim().min(1).max(60).optional(),
    fotos: z.array(foto).max(MAX_FOTOS).default([]), gtin: gtin.optional(), motivo_sem_gtin: motivoGtin.optional(),
    atributos: z.array(atributo).max(30).default([]).describe("Atributos só deste item."),
  })).min(1).max(MAX_LOTE).optional().describe("User Products (moda etc.): um anúncio por item, todos com o mesmo family_name."),
  sku: z.string().trim().max(60).optional(), frete_gratis: z.boolean().optional(),
  envio: z.object({
    modo: z.enum(["me2", "padrao"]).optional().describe("me2 = Mercado Envios (padrão quando a conta usa); padrao = não envia shipping (o ML aplica o da conta)."),
    frete_gratis: z.boolean().optional(),
    peso_g: z.number().int().positive().max(100_000).optional(), altura_cm: z.number().positive().max(300).optional(),
    largura_cm: z.number().positive().max(300).optional(), comprimento_cm: z.number().positive().max(300).optional(),
  }).optional().describe("Envio e pacote (peso em gramas, medidas em cm; os quatro juntos)."),
  prazo_fabricacao_dias: z.number().int().min(1).max(120).optional().describe("Prazo de fabricação/disponibilidade (MANUFACTURING_TIME), se a categoria aceitar."),
  gtin: gtin.optional(), motivo_sem_gtin: motivoGtin.optional(),
  guia_id: z.string().trim().regex(/^\d{1,15}$/, "guia_id: só números.").optional().describe("Guia de medidas (ml_guias_listar / ml_guia_criar). Obrigatória nos domínios de moda que exigem."),
  catalogo_produto_id: z.string().trim().regex(/^MLB\d{1,15}$/, "Produto de catálogo inválido (ex.: MLB12345678).").optional().describe("Publica no catálogo (ml_catalogo_buscar)."),
};

interface ResultadoItem {
  sku: string | null; cor: string | null; tamanho: string | null;
  anuncio_id?: string | null; link?: string | null; status?: string; status_ml?: string | null; descricao?: string | null; no_painel?: boolean; acao_id?: string; aviso?: string;
  valido?: boolean; erros?: string[]; erro?: string;
}
interface ResultadoProduto {
  ok: boolean; formato: string | null; publicado: boolean; validar_apenas?: boolean; itens: ResultadoItem[]; avisos: string[];
  erro?: string; erros?: string[]; atributos_faltando?: unknown[]; dominio?: string | null; guia_exigida?: boolean;
  // Compatibilidade (anúncio único): campos do primeiro item no topo.
  anuncio_id?: string | null; link?: string | null; status?: string; status_ml?: string | null; descricao?: string | null; no_painel?: boolean; aviso?: string; acao_id?: string;
}

/**
 * Planeja (formato, atributos, guia, fotos) e publica ou só valida um produto. Problema de entrada → nada é enviado e
 * volta em erro/erros/atributos_faltando. Na publicação, cada anúncio é uma ação create_listing do executor; a falha
 * de um não interrompe os outros.
 */
async function processarProduto(
  ator: Ator, c: { id: string; name: string }, conta: Conta, token: string, p: Produto,
  o: { validarApenas: boolean; deps: Deps; prazo: number; enviados: Map<string, string> },
): Promise<ResultadoProduto> {
  let plano;
  try {
    plano = await planejarProduto(token, conta.external_user_id, p, { atributos: atributosDaCategoria }, o.enviados);
  } catch (e) {
    return { ok: false, formato: null, publicado: false, itens: [], avisos: [], erro: `Não consegui preparar o anúncio: ${traduzirErroMl(e)}` };
  }
  const comum = { formato: plano.formato, avisos: plano.avisos, dominio: plano.analise.dominio_id, guia_exigida: plano.analise.exige_guia || undefined };
  if (plano.faltando?.length) {
    return {
      ...comum, ok: false, publicado: false, itens: [], atributos_faltando: plano.faltando, erros: plano.erros,
      erro: `Faltam ${plano.faltando.length} atributo(s) obrigatório(s) da categoria ${p.categoria_id}. Pergunte ao usuário e chame de novo com "atributos" (ou nos itens).`,
    };
  }
  if (plano.erros?.length) return { ...comum, ok: false, publicado: false, itens: [], erros: plano.erros, erro: plano.erros.length === 1 ? plano.erros[0] : `${plano.erros.length} problemas na entrada; nada foi enviado. Veja "erros".` };

  if (o.validarApenas) {
    const itens = await emSerie(plano.cargas, CONCORRENCIA, async (cg): Promise<ResultadoItem> => {
      const v = await validarNoMl(token, cg.item);
      return { ...cg.unidade, valido: v.valido, erros: v.erros.length ? v.erros : undefined };
    });
    await auditar(ator, "anuncio_validado", c.id, { conta: conta.id, categoria: p.categoria_id, formato: plano.formato, itens: itens.length, validos: itens.filter((i) => i.valido).length });
    return { ...comum, ok: itens.every((i) => i.valido), publicado: false, validar_apenas: true, itens };
  }

  const itens = await emSerie(plano.cargas, CONCORRENCIA, async (cg): Promise<ResultadoItem> => {
    if (Date.now() > o.prazo) return { ...cg.unidade, erro: "Não processado: tempo da chamada esgotado. Chame de novo só com os que faltaram." };
    const alvo = `novo:${p.categoria_id}${cg.unidade.sku ? `:${cg.unidade.sku.slice(0, 40)}` : ""}`;
    try {
      const r = await executar(ator, c, conta, "create_listing", alvo, { item: cg.item, ...(cg.description ? { description: cg.description } : {}) }, "Anúncio novo pelo conector do Claude");
      const id = typeof r.depois?.id === "string" ? r.depois.id : null;
      const painel = id ? await atualizarPainel(o.deps, conta.id, id) : false;
      await auditar(ator, "anuncio_criado", c.id, {
        acao_id: r.acao_id, conta: conta.id, anuncio_id: id, status: r.status, categoria: p.categoria_id, formato: plano.formato,
        titulo: (p.titulo ?? p.family_name ?? "").slice(0, 60), family_name: cg.item.family_name, sku: cg.unidade.sku, variacoes: cg.item.variations?.length ?? 0,
      });
      return {
        ...cg.unidade, anuncio_id: id, link: r.depois?.permalink ?? null, status: r.status, status_ml: r.depois?.status ?? null,
        descricao: r.depois?.description ?? (cg.description ? null : "sem descrição"), no_painel: painel, acao_id: r.acao_id, aviso: r.aviso,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : "Falhou.";
      await auditar(ator, "anuncio_criacao_falhou", c.id, { conta: conta.id, categoria: p.categoria_id, formato: plano.formato, sku: cg.unidade.sku, erro: msg.slice(0, 200) });
      return { ...cg.unidade, erro: msg };
    }
  });
  const okTodos = itens.every((i) => !i.erro);
  const unico = itens.length === 1 ? itens[0] : null;
  return {
    ...comum, ok: okTodos, publicado: itens.some((i) => i.status === "executada"), itens,
    ...(okTodos ? {} : { erro: `${itens.filter((i) => i.erro).length} de ${itens.length} anúncio(s) falharam; os outros seguiram. Veja "itens".` }),
    ...(unico && !unico.erro ? { anuncio_id: unico.anuncio_id, link: unico.link, status: unico.status, status_ml: unico.status_ml, descricao: unico.descricao, no_painel: unico.no_painel, aviso: unico.aviso, acao_id: unico.acao_id } : {}),
  };
}

// ─── Alteração (por id ou SKU) ───────────────────────────────────────────────

type Op = [ActionType, Record<string, unknown>, string];
interface Alvo { itemId: string; variacaoId?: string }

function montarOps(a: { preco?: number; estoque?: number; variacao_id?: string; titulo?: string; descricao?: string; fotos?: string[]; status?: "ativo" | "pausado" }): Op[] {
  const ops: Op[] = [];
  if (a.preco !== undefined) ops.push(["update_price", { price: brl(a.preco) }, "preco"]);
  if (a.estoque !== undefined) ops.push(["update_stock", { available_quantity: a.estoque, ...(a.variacao_id ? { variation_id: a.variacao_id } : {}) }, "estoque"]);
  if (a.titulo !== undefined || a.descricao !== undefined || a.fotos !== undefined) {
    let fotos: string[] | undefined;
    try { fotos = a.fotos ? fotosValidas(a.fotos) : undefined; } catch (e) { throw new ErroFerramenta((e as Error).message); }
    ops.push(["update_listing", { ...(a.titulo !== undefined ? { title: a.titulo } : {}), ...(a.descricao !== undefined ? { description: a.descricao } : {}), ...(fotos ? { pictures: fotos } : {}) }, "conteudo"]);
  }
  if (a.status) ops.push([a.status === "pausado" ? "pause_listing" : "activate_listing", {}, "status"]);
  if (!ops.length) throw new ErroFerramenta("Nada para alterar: informe preco, estoque, titulo, descricao, fotos ou status.");
  return ops;
}

/** Id do anúncio (direto ou pelo SKU na conta) já conferido como desta conta; pelo SKU também acha a variação (estoque). */
async function resolverAlvo(conta: Conta, ref: { anuncio_id?: string; sku?: string }, precisaVariacao: boolean): Promise<Alvo> {
  if (ref.anuncio_id) {
    await garantirAnuncioDaConta(conta, ref.anuncio_id);
    return { itemId: ref.anuncio_id };
  }
  soMl(conta.marketplace as MarketplaceId, "alterar por SKU");
  const sku = ref.sku!;
  const token = await tokenDa(conta);
  let ids: string[];
  try { ids = await anunciosPorSku(token, conta.external_user_id, sku); } catch (e) { throw new ErroFerramenta(`Não consegui buscar o SKU ${sku}: ${traduzirErroMl(e)}`); }
  if (!ids.length) throw new ErroFerramenta(`Nenhum anúncio com o SKU "${sku}" na conta ${conta.nickname ?? conta.id}.`);
  if (ids.length > 1) throw new ErroFerramenta(`O SKU "${sku}" está em ${ids.length} anúncios (${ids.slice(0, 10).join(", ")}): informe anuncio_id.`);
  const itemId = ids[0];
  await garantirAnuncioDaConta(conta, itemId);
  if (!precisaVariacao) return { itemId };
  try {
    const v = await variacaoPorSku(token, itemId, sku);
    return v && v.total > 1 ? { itemId, variacaoId: v.id } : { itemId };
  } catch {
    return { itemId }; // sem a variação, o executor pede variacao_id se o anúncio tiver várias
  }
}

async function aplicarOps(ator: Ator, c: { id: string }, conta: Conta, alvo: Alvo, ops: Op[], motivo: string | undefined, deps: Deps) {
  const feitos: Array<{ alteracao: string; status: string; acao_id?: string; aviso?: string }> = [];
  for (const [tipo, payload0, rotulo] of ops) {
    const payload = tipo === "update_stock" && alvo.variacaoId && !payload0.variation_id ? { ...payload0, variation_id: alvo.variacaoId } : payload0;
    try {
      const r = await executar(ator, c, conta, tipo, alvo.itemId, payload, motivo);
      feitos.push({ alteracao: rotulo, status: r.status, acao_id: r.acao_id, aviso: r.aviso });
      await auditar(ator, "anuncio_alterado", c.id, { acao_id: r.acao_id, conta: conta.id, anuncio_id: alvo.itemId, tipo, status: r.status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falhou.";
      await auditar(ator, "anuncio_alteracao_recusada", c.id, { conta: conta.id, anuncio_id: alvo.itemId, tipo, erro: msg.slice(0, 200) });
      if (feitos.length) await atualizarPainel(deps, conta.id, alvo.itemId);
      throw new ErroFerramenta(`${rotulo}: ${msg}${feitos.length ? ` (já feito antes disso: ${feitos.map((f) => f.alteracao).join(", ")})` : ""}`);
    }
  }
  return feitos;
}

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
    descricao: "Atributos da categoria do Mercado Livre, obrigatórios primeiro (id, nome, se vale por variação, valores aceitos), os termos de venda (garantia, prazo de fabricação) e o formato de publicação desta conta (user_products, variacoes ou catalogo_obrigatorio) com o aviso se exige guia de medidas.",
    entrada: { cliente, categoria_id: z.string().trim().regex(/^MLB\d{1,12}$/, "Categoria inválida (ex.: MLB1055)."), so_obrigatorios: z.boolean().default(false), conta: contaRef },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      let r, analise;
      try {
        const token = await tokenDa(conta);
        r = await atributosDaCategoria(token, a.categoria_id);
        analise = await analisarCategoria(token, a.categoria_id, conta.external_user_id, r.atributos);
      } catch (e) { if (e instanceof ErroFerramenta) throw e; throw new ErroFerramenta(traduzirErroMl(e)); }
      const lista = r.atributos.filter((x) => !a.so_obrigatorios || x.obrigatorio).slice(0, 80);
      return {
        categoria_id: a.categoria_id,
        obrigatorios: r.atributos.filter((x) => x.obrigatorio).length,
        atributos: lista.map((x) => ({ id: x.id, nome: x.nome, obrigatorio: x.obrigatorio || undefined, de_variacao: x.de_variacao || undefined, tipo: x.tipo, valores: x.valores.slice(0, 15).map((v) => v.nome), unidades: x.unidades.length ? x.unidades.slice(0, 6) : undefined })),
        termos_venda: r.termos_venda,
        formato: analise.formato, dominio: analise.dominio_id, exige_guia_de_medidas: analise.exige_guia, catalogo: analise.catalogo, max_fotos: analise.max_fotos,
        avisos: analise.avisos.length ? analise.avisos : undefined,
      };
    },
  }),
  def({
    nome: "anuncio_criar", titulo: "Criar anúncio", escrita: true,
    descricao:
      "Publica DIRETO no Mercado Livre, escolhendo o formato pela categoria e pela conta: (1) User Products/moda (vendedor com o modelo novo): " +
      "family_name + lista de itens (cor, tamanho, preço, estoque, SKU, fotos, GTIN ou motivo sem GTIN) → um anúncio por item, sem título; " +
      "(2) clássico com variações (titulo + variacoes); (3) catálogo (catalogo_produto_id, ache com ml_catalogo_buscar). " +
      "Atributos por nome ou valor_id (o nome é convertido para o id da lista do ML); obrigatórios conferidos antes: se faltar algum, NÃO publica e devolve a lista. " +
      "Moda que exige guia de medidas: envie guia_id (ml_guias_listar / ml_guia_criar); cada item é ligado à linha do seu tamanho. " +
      "Fotos: URL https, id de foto do ML (ml_foto_enviar) ou imagem em base64 (até 10 por anúncio, 10 MB cada). Envio me2 quando a conta usa; dimensões do pacote; tipo clássico/premium; prazo de fabricação. " +
      "validar_apenas=true só valida no ML (POST /items/validate) e não publica. Falha de um item não interrompe os outros. Respeita a pausa geral e a simulação da Central.",
    entrada: { cliente, marketplace, conta: contaRef, ...produtoShape, validar_apenas: z.boolean().default(false).describe("true = só valida no Mercado Livre, sem publicar.") },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      soMl(a.marketplace, "criar anúncio");
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      const token = await tokenDa(conta);
      const r = await processarProduto(ator, c, conta, token, a as Produto, { validarApenas: a.validar_apenas, deps, prazo: Date.now() + PRAZO_MS, enviados: new Map() });
      // Compatível com o formato antigo: anúncio único (clássico/catálogo) que o ML recusou vira erro da ferramenta.
      if (!a.validar_apenas && r.formato !== "user_products" && r.itens.length === 1 && r.itens[0].erro) throw new ErroFerramenta(r.itens[0].erro);
      return r;
    },
  }),
  def({
    nome: "anuncio_validar", titulo: "Validar anúncio (sem publicar)", escrita: false,
    descricao: "Mesma entrada de anuncio_criar, mas NÃO publica: monta cada anúncio (formato automático, atributos, guia, fotos) e manda para POST /items/validate do Mercado Livre, devolvendo os erros do ML por item. Fotos em base64 são enviadas ao ML para obter o id (não ficam públicas).",
    entrada: { cliente, conta: contaRef, ...produtoShape },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      return processarProduto(ator, c, conta, await tokenDa(conta), a as Produto, { validarApenas: true, deps, prazo: Date.now() + PRAZO_MS, enviados: new Map() });
    },
  }),
  def({
    nome: "anuncios_criar_lote", titulo: "Criar anúncios em lote", escrita: true,
    descricao:
      `Cria (ou só valida, com validar_apenas) vários produtos de uma vez no Mercado Livre — cada produto no mesmo formato de anuncio_criar (modelo User Products com itens, clássico ou catálogo). ` +
      `Até ${MAX_LOTE} anúncios por chamada (somando os itens), em sequência e com concorrência pequena para respeitar o limite do ML. ` +
      "Devolve o relatório: criados (ids), falharam (motivo) e validados. Falha de um produto/item não interrompe os outros.",
    entrada: {
      cliente, conta: contaRef,
      produtos: z.array(z.object(produtoShape)).min(1).max(MAX_LOTE),
      validar_apenas: z.boolean().default(false),
    },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      const total = a.produtos.reduce((s, p) => s + Math.max(1, p.itens?.length ?? 0, p.variacoes?.length ? (p.formato === "variacoes" ? 1 : p.variacoes.length) : 0), 0);
      if (total > MAX_LOTE) throw new ErroFerramenta(`Lote grande demais: ${total} anúncios (máximo ${MAX_LOTE} por chamada). Divida em partes.`);
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      const token = await tokenDa(conta);
      const prazo = Date.now() + PRAZO_MS;
      const enviados = new Map<string, string>();
      const criados: unknown[] = [], falharam: unknown[] = [], validados: unknown[] = [];
      const produtos: unknown[] = [];
      for (const [i, p] of a.produtos.entries()) {
        const nome = p.family_name ?? p.titulo ?? p.catalogo_produto_id ?? `produto ${i + 1}`;
        if (Date.now() > prazo) {
          falharam.push({ produto: nome, motivo: "Não processado: tempo da chamada esgotado. Chame de novo só com os que faltaram." });
          continue;
        }
        const r = await processarProduto(ator, c, conta, token, p as Produto, { validarApenas: a.validar_apenas, deps, prazo, enviados });
        produtos.push({ produto: nome, formato: r.formato, ok: r.ok, erro: r.erro, atributos_faltando: r.atributos_faltando, avisos: r.avisos.length ? r.avisos : undefined });
        if (r.erro && !r.itens.length) { falharam.push({ produto: nome, motivo: r.erro, erros: r.erros, atributos_faltando: r.atributos_faltando }); continue; }
        for (const it of r.itens) {
          const base = { produto: nome, sku: it.sku, cor: it.cor, tamanho: it.tamanho };
          if (a.validar_apenas) (it.valido ? validados : falharam).push(it.valido ? base : { ...base, motivo: (it.erros ?? []).join("; ") || it.erro });
          else if (it.erro) falharam.push({ ...base, motivo: it.erro });
          else criados.push({ ...base, anuncio_id: it.anuncio_id, link: it.link, status: it.status });
        }
      }
      await auditar(ator, a.validar_apenas ? "anuncios_lote_validado" : "anuncios_lote_criado", c.id, { conta: conta.id, produtos: a.produtos.length, criados: criados.length, falharam: falharam.length, validados: validados.length });
      return { resumo: { criados: criados.length, falharam: falharam.length, validados: validados.length }, criados, falharam, validados: a.validar_apenas ? validados : undefined, produtos };
    },
  }),
  def({
    nome: "ml_foto_enviar", titulo: "Enviar foto ao Mercado Livre", escrita: true,
    descricao: "Envia UMA imagem (base64: data URI ou puro; JPG/PNG/WEBP até 10 MB, conteúdo conferido) para o Mercado Livre (POST /pictures/items/upload) e devolve o foto_id. Use o foto_id nas fotos de anuncio_criar/itens para reaproveitar a mesma foto em vários anúncios sem reenviar.",
    entrada: { cliente, conta: contaRef, imagem: z.string().min(16).max(14_500_000).describe("Imagem em base64 (data:image/jpeg;base64,... ou base64 puro).") },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      let img;
      try { img = decodificarImagem(a.imagem, "imagem"); } catch (e) { throw new ErroFerramenta((e as Error).message); }
      let r;
      try { r = await enviarFoto(await tokenDa(conta), img.bytes, img.mime); } catch (e) { if (e instanceof ErroFerramenta) throw e; throw new ErroFerramenta(`Envio da foto falhou: ${traduzirErroMl(e)}`); }
      await auditar(ator, "ml_foto_enviada", c.id, { conta: conta.id, foto_id: r.id, bytes: img.bytes.length, tipo: img.mime });
      return { ok: true, foto_id: r.id, url: r.url, tipo: img.mime, tamanho_kb: Math.round(img.bytes.length / 1024) };
    },
  }),
  def({
    nome: "ml_guias_listar", titulo: "Guias de medidas (Mercado Livre)", escrita: false,
    descricao: "Lista as guias (tabelas) de medidas disponíveis para a conta num domínio de moda: as da conta (SPECIFIC), as padrão do ML (STANDARD) e as de marca (BRAND), com as linhas (id da linha + tamanho). Informe categoria_id (ou dominio_id) e o gênero (ex.: Feminino).",
    entrada: {
      cliente, conta: contaRef,
      categoria_id: categoriaId.optional(), dominio_id: z.string().trim().regex(/^(ML[A-Z]-)?[A-Z0-9_]{2,80}$/, "Domínio inválido (ex.: MLB-DRESSES).").optional(),
      genero: z.string().trim().min(2).max(40).describe('Gênero da guia (ex.: "Feminino", "Masculino", "Sem gênero").'),
      marca: z.string().trim().max(60).optional(), tipo: z.enum(["SPECIFIC", "STANDARD", "BRAND"]).optional().describe("SPECIFIC = da conta."),
      com_linhas: z.boolean().default(true).describe("Lê as linhas (tamanhos) de até 10 guias."),
    },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      const token = await tokenDa(conta);
      try {
        const dominio = a.dominio_id ?? (a.categoria_id ? await dominioDaCategoria(token, a.categoria_id) : null);
        if (!dominio) throw new ErroFerramenta("Informe categoria_id ou dominio_id (não achei o domínio da categoria).");
        const guias = await buscarGuias(token, { dominio, sellerId: conta.external_user_id, genero: a.genero, marca: a.marca, tipo: a.tipo });
        const det = a.com_linhas ? await emSerie(guias.slice(0, 10), 2, async (g) => (g.linhas.length ? g : lerGuia(token, g.id).catch(() => g))) : guias;
        return {
          dominio, total: guias.length,
          guias: [...det, ...guias.slice(det.length)].map((g) => ({ guia_id: g.id, nome: g.nome, tipo: g.tipo, atributo_principal: g.atributo_principal, linhas: g.linhas.length ? g.linhas.map((l) => ({ linha_id: l.id, tamanho: l.tamanho })) : undefined })),
          aviso: guias.length ? undefined : "Nenhuma guia para este domínio/gênero: crie uma com ml_guia_criar.",
        };
      } catch (e) {
        if (e instanceof ErroFerramenta) throw e;
        throw new ErroFerramenta(traduzirErroMl(e));
      }
    },
  }),
  def({
    nome: "ml_guia_criar", titulo: "Criar guia de medidas (Mercado Livre)", escrita: true,
    descricao:
      "Cria uma guia de medidas da conta (tipo SPECIFIC) a partir de uma tabela simples: tamanhos × medidas. Cada linha = um tamanho (ex.: P, M, G) e suas medidas por id de atributo do ML " +
      '(ex.: {"CHEST_CIRCUMFERENCE": "88 cm", "WAIST_CIRCUMFERENCE": "70 cm"}). Gênero e marca vão no nível da guia. Os ids de medida aceitos dependem do domínio (o ML recusa os que não pertencem à ficha da guia e a mensagem diz o campo). ' +
      "Devolve o guia_id e o id de cada linha. Respeita a pausa geral e a simulação da Central.",
    entrada: {
      cliente, conta: contaRef,
      categoria_id: categoriaId.optional(), dominio_id: z.string().trim().regex(/^(ML[A-Z]-)?[A-Z0-9_]{2,80}$/).optional(),
      nome: z.string().trim().min(3).max(60).describe("Nome da guia (letras, números e espaços)."),
      genero: z.string().trim().min(2).max(40), marca: z.string().trim().min(1).max(60),
      atributo_principal: z.string().trim().regex(/^[A-Z0-9_]{2,60}$/i).default("SIZE").describe("Atributo do tamanho principal (moda: SIZE)."),
      linhas: z.array(z.object({ tamanho: z.string().trim().min(1).max(30), medidas: z.record(z.string().regex(/^[A-Z0-9_]{2,60}$/i), z.string().trim().min(1).max(40)) })).min(1).max(40),
    },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      const token = await tokenDa(conta);
      const { data: cfg } = await adminDb().from("settings").select("dry_run, global_pause").single();
      try {
        const dominio = a.dominio_id ?? (a.categoria_id ? await dominioDaCategoria(token, a.categoria_id) : null);
        if (!dominio) throw new ErroFerramenta("Informe categoria_id ou dominio_id (não achei o domínio da categoria).");
        const nova = { nome: a.nome, dominio, genero: a.genero, marca: a.marca, atributo_principal: a.atributo_principal, linhas: a.linhas };
        try { montarGuia(nova); } catch (e) { throw new ErroFerramenta((e as Error).message); }
        if (cfg?.global_pause || cfg?.dry_run) {
          await auditar(ator, "ml_guia_simulada", c.id, { conta: conta.id, dominio, linhas: a.linhas.length });
          return { ok: true, criada: false, aviso: cfg.global_pause ? "Pausa geral ligada: a guia não foi criada." : "Simulação ligada: a guia não foi criada no Mercado Livre." };
        }
        const g = await criarGuia(token, nova);
        await auditar(ator, "ml_guia_criada", c.id, { conta: conta.id, guia_id: g.id, dominio, linhas: g.linhas.length });
        return { ok: true, criada: true, guia_id: g.id, nome: g.nome, dominio, linhas: g.linhas.map((l) => ({ linha_id: l.id, tamanho: l.tamanho })) };
      } catch (e) {
        if (e instanceof ErroFerramenta) throw e;
        await auditar(ator, "ml_guia_recusada", c.id, { conta: conta.id, erro: traduzirErroMl(e).slice(0, 200) });
        throw new ErroFerramenta(`Guia de medidas recusada: ${traduzirErroMl(e)}`);
      }
    },
  }),
  def({
    nome: "ml_catalogo_buscar", titulo: "Buscar produto no catálogo (Mercado Livre)", escrita: false,
    descricao: "Procura produtos ativos no catálogo do Mercado Livre por GTIN/EAN (mais preciso) ou por texto. Use o id (catalogo_produto_id) em anuncio_criar para publicar no catálogo. Confira a ficha: o vendedor responde se o produto não for idêntico.",
    entrada: { cliente, conta: contaRef, gtin: z.string().trim().regex(/^\d{8,14}$/, "GTIN: 8 a 14 dígitos.").optional(), texto: z.string().trim().min(3).max(120).optional() },
    async executar(ator, a) {
      exigir(ehAdmin(ator));
      if (!a.gtin && !a.texto) throw new ErroFerramenta("Informe gtin ou texto.");
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, "mercadolivre", a.conta);
      try {
        const r = await buscarCatalogo(await tokenDa(conta), { gtin: a.gtin, q: a.texto });
        return { total: r.length, produtos: r.map((p) => ({ catalogo_produto_id: p.id, nome: p.nome, dominio: p.dominio_id, status: p.status, catalogo_obrigatorio: p.estrategia === "catalog_required" || undefined, atributos: p.atributos })) };
      } catch (e) {
        if (e instanceof ErroFerramenta) throw e;
        throw new ErroFerramenta(traduzirErroMl(e));
      }
    },
  }),
  def({
    nome: "anuncio_alterar", titulo: "Alterar anúncio", escrita: true,
    descricao:
      "Altera DIRETO um anúncio do cliente, pelo id (anuncio_id) OU pelo SKU (sku; precisa ser da conta do cliente): preço, estoque (com variacao_id se houver várias — pelo SKU da variação é automático), título, descrição, fotos (substitui todas) e status ativo/pausado. " +
      "Respeita o limite diário de variação de preço da política, a pausa geral e a simulação. Cada mudança vira uma ação no histórico do executor.",
    entrada: {
      cliente, marketplace, conta: contaRef, anuncio_id: idAnuncio.optional(), sku: skuRef.optional(),
      preco: z.number().finite().positive().max(10_000_000).optional(), estoque: z.number().int().min(0).max(100_000).optional(),
      variacao_id: z.string().trim().regex(/^[0-9A-Za-z_-]{1,40}$/).optional(), titulo: z.string().trim().min(3).max(60).optional(),
      descricao: z.string().max(50_000).optional(), fotos: z.array(z.string().max(2000)).min(1).max(MAX_FOTOS).optional(),
      status: z.enum(["ativo", "pausado"]).optional(), motivo: z.string().trim().max(300).optional(),
    },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      if (Boolean(a.anuncio_id) === Boolean(a.sku)) throw new ErroFerramenta('Informe "anuncio_id" OU "sku" (um dos dois).');
      const ops = montarOps(a);
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, a.marketplace, a.conta);
      const alvo = await resolverAlvo(conta, { anuncio_id: a.anuncio_id, sku: a.sku }, a.estoque !== undefined && !a.variacao_id);
      const feitos = await aplicarOps(ator, c, conta, alvo, ops, a.motivo, deps);
      return { ok: true, anuncio_id: alvo.itemId, sku: a.sku, variacao_id: alvo.variacaoId, alteracoes: feitos, no_painel: await atualizarPainel(deps, conta.id, alvo.itemId) };
    },
  }),
  def({
    nome: "anuncios_alterar_lote", titulo: "Alterar anúncios em lote (por SKU)", escrita: true,
    descricao: `Altera preço, estoque e/ou status (ativo/pausado) de vários anúncios do cliente de uma vez, por SKU (ou id). Até ${MAX_LOTE} por chamada, em sequência. Cada um passa pelo executor (limite diário de preço, pausa geral, simulação, dono do anúncio). Devolve o resultado por SKU; falha de um não interrompe os outros.`,
    entrada: {
      cliente, marketplace, conta: contaRef, motivo: z.string().trim().max(300).optional(),
      itens: z.array(z.object({
        sku: skuRef.optional(), anuncio_id: idAnuncio.optional(),
        preco: z.number().finite().positive().max(10_000_000).optional(), estoque: z.number().int().min(0).max(100_000).optional(), status: z.enum(["ativo", "pausado"]).optional(),
      })).min(1).max(MAX_LOTE),
    },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const conta = await contaDoCliente(c, a.marketplace, a.conta);
      const prazo = Date.now() + PRAZO_MS;
      const resultados: Array<Record<string, unknown>> = [];
      for (const it of a.itens) {
        const ref = it.sku ?? it.anuncio_id ?? "?";
        try {
          if (Date.now() > prazo) throw new ErroFerramenta("Não processado: tempo da chamada esgotado. Chame de novo só com os que faltaram.");
          if (Boolean(it.anuncio_id) === Boolean(it.sku)) throw new ErroFerramenta('Informe "sku" OU "anuncio_id".');
          const ops = montarOps(it);
          const alvo = await resolverAlvo(conta, { anuncio_id: it.anuncio_id, sku: it.sku }, it.estoque !== undefined);
          const feitos = await aplicarOps(ator, c, conta, alvo, ops, a.motivo, deps);
          await atualizarPainel(deps, conta.id, alvo.itemId);
          resultados.push({ ref, ok: true, anuncio_id: alvo.itemId, alteracoes: feitos.map((f) => `${f.alteracao}: ${f.status}`) });
        } catch (e) {
          resultados.push({ ref, ok: false, erro: e instanceof Error ? e.message.slice(0, 400) : "Falhou." });
        }
      }
      const ok = resultados.filter((r) => r.ok).length;
      return { resumo: { ok, falharam: resultados.length - ok }, resultados };
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
