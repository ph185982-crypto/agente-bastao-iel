// Ferramentas de META ADS do conector do Claude: diagnóstico, leitura, criação (campanha → conjunto → criativo → anúncio) e
// alteração, SEMPRE na conta de anúncios configurada no canal do cliente. Publicação direta (decisão do dono), com as travas
// de src/lib/channels/meta-gestao.ts: conta do canal, dono de cada objeto conferido, teto diário por cliente, limite % de
// aumento de orçamento, prefixo do filtro por nome. Tudo auditado com { via: "claude" }; token nunca aparece.
import { z } from "zod";
import { spDate } from "@/lib/dates";
import { checkDailyLimit } from "@/lib/executor/policy";
import { salvarInfo } from "@/lib/channels/store";
import { campanhaPassa } from "@/lib/channels/campanhas";
import { coletaLeveDoCliente } from "@/lib/channels/servico";
import {
  DESTINOS, ErroMeta, OBJETIVOS, baixarImagem, centavos, checarTeto, contextoMeta, criarGraphGestao, montarTargeting, nomeComPrefixo, objetoDaConta,
  padroesConjunto, pctDiarioOrcamento, reais, referenciaDoDia, resolverPagina, tokenDeGestao, type ContextoMeta, type GraphGestao, type Objetivo,
} from "@/lib/channels/meta-gestao";
import { ErroFerramenta, LIMITE, auditar, cliente, def, ehAdmin, exigir, resolverCliente, type Ator, type Deps, type Ferramenta } from "./ferramentas";

const idMeta = z.string().trim().regex(/^\d{3,25}$/, "Id da Meta inválido (só números).");
const dinheiro = z.number().finite().positive().max(1_000_000);
const dataHora = z.string().trim().refine((s) => !Number.isNaN(Date.parse(s)), "Data/hora inválida (ISO 8601, ex.: 2026-12-01T00:00:00-03:00).");

type Aberto = { c: { id: string; name: string }; ctx: ContextoMeta; g: GraphGestao };
async function abrir(ator: Ator, ref: string, deps: Deps): Promise<Aberto> {
  exigir(ehAdmin(ator));
  const c = await resolverCliente(ref);
  const ctx = await contextoMeta(c.id, deps.env ?? process.env);
  return { c, ctx, g: criarGraphGestao(ctx.token, { fetchImpl: deps.fetchMeta, baseDelayMs: 300 }) };
}

/** ErroMeta (de negócio, já em português e sem token) → ErroFerramenta. */
function meta<A, R>(fn: (ator: Ator, a: A, deps: Deps) => Promise<R>) {
  return async (ator: Ator, a: A, deps: Deps): Promise<R> => {
    try { return await fn(ator, a, deps); } catch (e) { if (e instanceof ErroMeta) throw new ErroFerramenta(e.message); throw e; }
  };
}

/** Coleta leve só deste cliente (sem alerta de recarga). Falha não derruba a ferramenta. */
async function refletirNoPainel(deps: Deps, clientId: string): Promise<boolean> {
  try { await (deps.coletarAnunciosMeta ?? coletaLeveDoCliente)(clientId); return true; } catch { return false; }
}

const status = (pausado?: boolean) => (pausado ? "PAUSED" : "ACTIVE");
const inicioDoDia = () => `${spDate()}T00:00:00-03:00`;

const CTAS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "SEND_MESSAGE", "WHATSAPP_MESSAGE", "BOOK_TRAVEL", "GET_QUOTE", "SUBSCRIBE", "ORDER_NOW", "GET_OFFER", "APPLY_NOW", "CALL_NOW", "DOWNLOAD"] as const;

const segmentacao = z.object({
  idade_min: z.number().int().min(13).max(65).optional(), idade_max: z.number().int().min(13).max(65).optional(),
  generos: z.array(z.enum(["masculino", "feminino"])).max(2).optional(),
  cidades: z.array(z.object({ key: z.string().trim().regex(/^\d{1,15}$/), raio_km: z.number().min(1).max(80).optional() })).max(50).optional().describe("Cidades pela key (veja meta_locais_buscar)."),
  pontos: z.array(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), raio_km: z.number().min(1).max(80) })).max(50).optional().describe("Raio em volta de um ponto (lat/long)."),
  paises: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).optional(),
  interesses: z.array(z.object({ id: idMeta, nome: z.string().max(120).optional() })).max(50).optional().describe("Ids de meta_interesses_buscar."),
  publicos: z.array(idMeta).max(20).optional().describe("Públicos personalizados existentes (meta_publicos_listar)."),
  plataformas: z.array(z.enum(["facebook", "instagram", "messenger", "audience_network"])).max(4).optional().describe("Vazio = posicionamento automático (recomendado)."),
  posicoes_instagram: z.array(z.enum(["stream", "story", "reels", "explore", "profile_feed"])).optional(),
  posicoes_facebook: z.array(z.enum(["feed", "story", "facebook_reels", "marketplace", "video_feeds", "search"])).optional(),
}).default({});

export const FERRAMENTAS_META: Ferramenta[] = [
  def({
    nome: "meta_status", titulo: "Meta Ads: acesso de gestão", escrita: false,
    descricao: "Confere se dá para GERENCIAR anúncios deste cliente: de onde vem o acesso (token do cliente ou da plataforma), se tem a permissão ads_management, se a conta de anúncios do canal responde, e o teto diário configurado.",
    entrada: { cliente },
    executar: meta(async (ator, a, deps) => {
      exigir(ehAdmin(ator));
      const c = await resolverCliente(a.cliente);
      const env = deps.env ?? process.env;
      const t = await tokenDeGestao(c.id, env);
      if (!t) return { cliente: c.name, pode_gerenciar: false, origem_acesso: "nenhuma", problema: "Sem token de gestão: salve o token do cliente na aba Canais ou configure META_ADS_MANAGE_TOKEN." };
      let ctx: ContextoMeta;
      try { ctx = await contextoMeta(c.id, env); } catch (e) { if (e instanceof ErroMeta) return { cliente: c.name, pode_gerenciar: false, origem_acesso: t.origem, problema: e.message }; throw e; }
      const g = criarGraphGestao(ctx.token, { fetchImpl: deps.fetchMeta, baseDelayMs: 300 });
      let perms: string[] = [];
      try {
        const r = await g.get<{ data?: Array<{ permission: string; status: string }> }>("me/permissions");
        perms = (r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
      } catch (e) {
        if (e instanceof ErroMeta) return { cliente: c.name, pode_gerenciar: false, origem_acesso: t.origem, problema: e.message };
        throw e;
      }
      const ads = perms.includes("ads_management");
      let conta: Record<string, unknown> | null = null, problemaConta: string | null = null;
      try {
        const r = await g.get<any>(ctx.conta, { fields: "name,account_status,currency" });
        conta = { id: ctx.conta, nome: r.name ?? null, status: r.account_status ?? null, moeda: r.currency ?? null };
      } catch (e) { problemaConta = e instanceof ErroMeta ? e.message : "Conta não respondeu."; }
      const pode = ads && Boolean(conta);
      await salvarInfo(c.id, { meta_gestao: { pode_gerenciar: pode, ads_management: ads, verificado_em: new Date().toISOString() } }).catch(() => undefined);
      return {
        cliente: c.name, pode_gerenciar: pode, origem_acesso: ctx.origem, ads_management: ads, ads_read: perms.includes("ads_read"),
        pagina: ctx.pageId, instagram: ctx.igUserId, conta, teto_diario: ctx.teto, filtro_nome: ctx.filtroNome,
        problema: !ads ? "O token não tem a permissão ads_management: dá para ler, mas não para criar ou alterar anúncios. Gere um token (usuário do sistema) com ads_management e acesso à conta." : problemaConta ?? undefined,
      };
    }),
  }),
  def({
    nome: "meta_listar", titulo: "Meta Ads: listar campanhas, conjuntos ou anúncios", escrita: false,
    descricao: `Campanhas, conjuntos ou anúncios da conta do cliente com status, status efetivo, objetivo e orçamento (R$). Respeita o filtro por nome do canal (ex.: só "SHOW MAN"). Até ${LIMITE}.`,
    entrada: { cliente, nivel: z.enum(["campanhas", "conjuntos", "anuncios"]).default("campanhas"), so_ativos: z.boolean().default(false), campanha_id: idMeta.optional() },
    executar: meta(async (ator, a, deps) => {
      const { c, ctx, g } = await abrir(ator, a.cliente, deps);
      const borda = a.nivel === "campanhas" ? "campaigns" : a.nivel === "conjuntos" ? "adsets" : "ads";
      const base = a.campanha_id ? (await objetoDaConta(g, ctx, a.campanha_id), a.campanha_id) : ctx.conta;
      const campos = a.nivel === "campanhas"
        ? "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time"
        : a.nivel === "conjuntos" ? "id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,destination_type,campaign{id,name},end_time"
          : "id,name,status,effective_status,adset_id,creative{id},campaign{id,name}";
      const r = await g.get<{ data?: any[] }>(`${base}/${borda}`, { fields: campos, limit: 200, ...(a.so_ativos ? { effective_status: JSON.stringify(["ACTIVE"]) } : {}) });
      const filtro = { campaignIds: [], campaignNameFilter: ctx.filtroNome };
      const itens = (r.data ?? []).filter((x) => (a.nivel === "campanhas" ? campanhaPassa(x.id, x.name, filtro) : campanhaPassa(x.campaign?.id, x.campaign?.name, filtro)));
      return {
        cliente: c.name, conta: ctx.conta, filtro_nome: ctx.filtroNome, total: itens.length,
        itens: itens.slice(0, LIMITE).map((x) => ({
          id: x.id, nome: x.name, status: x.status, status_efetivo: x.effective_status, objetivo: x.objective, otimizacao: x.optimization_goal, destino: x.destination_type,
          orcamento_diario: reais(x.daily_budget), orcamento_vitalicio: reais(x.lifetime_budget), campanha: x.campaign?.name, campanha_id: x.campaign?.id, conjunto_id: x.adset_id, criativo_id: x.creative?.id,
          inicio: x.start_time, fim: x.stop_time ?? x.end_time,
        })),
      };
    }),
  }),
  def({
    nome: "meta_interesses_buscar", titulo: "Meta Ads: buscar interesses", escrita: false,
    descricao: "Busca interesses para segmentação (ids para meta_conjunto_criar).",
    entrada: { cliente, q: z.string().trim().min(2).max(80) },
    executar: meta(async (ator, a, deps) => {
      const { g } = await abrir(ator, a.cliente, deps);
      const r = await g.get<{ data?: any[] }>("search", { type: "adinterest", q: a.q, limit: 15, locale: "pt_BR" });
      return { interesses: (r.data ?? []).map((x) => ({ id: String(x.id), nome: x.name, publico_min: x.audience_size_lower_bound ?? null, publico_max: x.audience_size_upper_bound ?? null, caminho: Array.isArray(x.path) ? x.path.join(" › ") : null })) };
    }),
  }),
  def({
    nome: "meta_locais_buscar", titulo: "Meta Ads: buscar cidades", escrita: false,
    descricao: "Busca cidades/regiões para segmentação (key para meta_conjunto_criar → segmentacao.cidades).",
    entrada: { cliente, q: z.string().trim().min(2).max(80) },
    executar: meta(async (ator, a, deps) => {
      const { g } = await abrir(ator, a.cliente, deps);
      const r = await g.get<{ data?: any[] }>("search", { type: "adgeolocation", location_types: JSON.stringify(["city", "region"]), q: a.q, country_code: "BR", limit: 10 });
      return { locais: (r.data ?? []).map((x) => ({ key: String(x.key), nome: x.name, tipo: x.type, regiao: x.region ?? null })) };
    }),
  }),
  def({
    nome: "meta_publicos_listar", titulo: "Meta Ads: públicos personalizados", escrita: false,
    descricao: "Públicos personalizados e semelhantes existentes na conta do cliente.",
    entrada: { cliente },
    executar: meta(async (ator, a, deps) => {
      const { ctx, g } = await abrir(ator, a.cliente, deps);
      const r = await g.get<{ data?: any[] }>(`${ctx.conta}/customaudiences`, { fields: "id,name,subtype,approximate_count_lower_bound", limit: 100 });
      return { publicos: (r.data ?? []).slice(0, LIMITE).map((x) => ({ id: String(x.id), nome: x.name, tipo: x.subtype, tamanho_min: x.approximate_count_lower_bound ?? null })) };
    }),
  }),

  // ─────────────── Escrita ───────────────
  def({
    nome: "meta_campanha_criar", titulo: "Meta Ads: criar campanha", escrita: true,
    descricao:
      "Cria DIRETO uma campanha na conta do cliente. Objetivo: OUTCOME_ENGAGEMENT (mensagens/WhatsApp), OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_SALES ou OUTCOME_AWARENESS. " +
      "Orçamento em reais na campanha (diário ou vitalício) ou deixe vazio para pôr o orçamento em cada conjunto. Ativa por padrão (pausada=true para criar pausada). " +
      "Recusa orçamento acima do teto diário do cliente. Com filtro por nome no canal, o nome ganha o prefixo (ex.: \"SHOW MAN | …\").",
    entrada: {
      cliente, nome: z.string().trim().min(2).max(200), objetivo: z.enum(OBJETIVOS),
      orcamento_diario: dinheiro.optional(), orcamento_vitalicio: dinheiro.optional(), inicio: dataHora.optional(), fim: dataHora.optional(), pausada: z.boolean().default(false),
    },
    executar: meta(async (ator, a, deps) => {
      if (a.orcamento_diario && a.orcamento_vitalicio) throw new ErroFerramenta("Use orçamento diário OU vitalício, não os dois.");
      const { c, ctx, g } = await abrir(ator, a.cliente, deps);
      const teto = checarTeto(ctx.teto, { diario: a.orcamento_diario, vitalicio: a.orcamento_vitalicio, inicio: a.inicio, fim: a.fim });
      if (teto) {
        await auditar(ator, "meta_recusado_teto", c.id, { op: "campanha_criar", diario: a.orcamento_diario ?? null, vitalicio: a.orcamento_vitalicio ?? null, teto: ctx.teto });
        throw new ErroFerramenta(teto);
      }
      const nome = nomeComPrefixo(a.nome, ctx.filtroNome);
      const temOrc = Boolean(a.orcamento_diario || a.orcamento_vitalicio);
      const corpo: Record<string, unknown> = {
        name: nome, objective: a.objetivo, status: status(a.pausada), special_ad_categories: [], buying_type: "AUCTION",
        ...(a.orcamento_diario ? { daily_budget: centavos(a.orcamento_diario) } : {}),
        ...(a.orcamento_vitalicio ? { lifetime_budget: centavos(a.orcamento_vitalicio) } : {}),
        ...(temOrc ? { bid_strategy: "LOWEST_COST_WITHOUT_CAP" } : { is_adset_budget_sharing_enabled: false }),
        ...(a.inicio ? { start_time: a.inicio } : {}), ...(a.fim ? { stop_time: a.fim } : {}),
      };
      const r = await g.post<{ id: string }>(`${ctx.conta}/campaigns`, corpo);
      await auditar(ator, "meta_campanha_criada", c.id, { id: r.id, conta: ctx.conta, nome, objetivo: a.objetivo, diario: a.orcamento_diario ?? null, vitalicio: a.orcamento_vitalicio ?? null, status: corpo.status });
      const painel = await refletirNoPainel(deps, c.id);
      return { ok: true, campanha_id: r.id, nome, status: corpo.status, orcamento: temOrc ? "na campanha" : "nos conjuntos", no_painel: painel };
    }),
  }),
  def({
    nome: "meta_conjunto_criar", titulo: "Meta Ads: criar conjunto de anúncios", escrita: true,
    descricao:
      "Cria DIRETO um conjunto numa campanha do cliente: público (idade, gênero, cidades ou raio em km, interesses, públicos personalizados), posicionamento (automático por padrão), " +
      "destino (WHATSAPP, MESSENGER, INSTAGRAM_DIRECT ou WEBSITE), otimização/cobrança padrão pelo objetivo da campanha, Página do canal, início/fim. " +
      "Orçamento aqui só se a campanha não tiver orçamento. Recusa acima do teto diário.",
    entrada: {
      cliente, campanha_id: idMeta, nome: z.string().trim().min(2).max(200), destino: z.enum(DESTINOS).optional(), segmentacao,
      orcamento_diario: dinheiro.optional(), orcamento_vitalicio: dinheiro.optional(), inicio: dataHora.optional(), fim: dataHora.optional(),
      otimizacao: z.string().trim().regex(/^[A-Z_]{3,40}$/).optional().describe("Sobrescreve a otimização padrão (ex.: CONVERSATIONS, LINK_CLICKS, REACH)."),
      cobranca: z.enum(["IMPRESSIONS", "LINK_CLICKS"]).optional(), pixel_id: idMeta.optional(), evento: z.string().trim().regex(/^[A-Z_]{3,40}$/).optional().describe("Vendas no site: evento do pixel (padrão PURCHASE)."),
      page_id: idMeta.optional().describe("Só se for diferente da Página do canal (precisa estar acessível)."), pausado: z.boolean().default(false),
    },
    executar: meta(async (ator, a, deps) => {
      if (a.orcamento_diario && a.orcamento_vitalicio) throw new ErroFerramenta("Use orçamento diário OU vitalício, não os dois.");
      const { c, ctx, g } = await abrir(ator, a.cliente, deps);
      const camp = await objetoDaConta(g, ctx, a.campanha_id, "name,objective,daily_budget,lifetime_budget");
      const cbo = Boolean(camp.daily_budget || camp.lifetime_budget);
      const temOrc = Boolean(a.orcamento_diario || a.orcamento_vitalicio);
      if (cbo && temOrc) throw new ErroFerramenta("A campanha já tem orçamento (orçamento da campanha): crie o conjunto sem orçamento ou altere o da campanha.");
      if (!cbo && !temOrc) throw new ErroFerramenta("A campanha não tem orçamento: informe orcamento_diario ou orcamento_vitalicio no conjunto.");
      const teto = checarTeto(ctx.teto, { diario: a.orcamento_diario, vitalicio: a.orcamento_vitalicio, inicio: a.inicio, fim: a.fim });
      if (teto) {
        await auditar(ator, "meta_recusado_teto", c.id, { op: "conjunto_criar", diario: a.orcamento_diario ?? null, vitalicio: a.orcamento_vitalicio ?? null, teto: ctx.teto });
        throw new ErroFerramenta(teto);
      }
      const objetivo = camp.objective as Objetivo;
      const p = padroesConjunto(objetivo, a.destino);
      const corpo: Record<string, unknown> = {
        name: a.nome, campaign_id: a.campanha_id, status: status(a.pausado),
        optimization_goal: a.otimizacao ?? p.optimization_goal, billing_event: a.cobranca ?? p.billing_event,
        ...(p.destination_type ? { destination_type: p.destination_type } : {}),
        targeting: montarTargeting(a.segmentacao),
        ...(a.orcamento_diario ? { daily_budget: centavos(a.orcamento_diario) } : {}),
        ...(a.orcamento_vitalicio ? { lifetime_budget: centavos(a.orcamento_vitalicio) } : {}),
        ...(temOrc ? { bid_strategy: "LOWEST_COST_WITHOUT_CAP" } : {}),
        ...(a.inicio ? { start_time: a.inicio } : {}), ...(a.fim ? { end_time: a.fim } : {}),
      };
      let override = false;
      if (p.optimization_goal === "OFFSITE_CONVERSIONS") {
        if (!a.pixel_id) throw new ErroFerramenta("Vendas no site: informe pixel_id (e o evento, padrão PURCHASE).");
        corpo.promoted_object = { pixel_id: a.pixel_id, custom_event_type: a.evento ?? "PURCHASE" };
      } else if (p.destination_type !== "WEBSITE" && objetivo !== "OUTCOME_AWARENESS") {
        const pg = await resolverPagina(g, ctx, a.page_id);
        override = pg.override;
        corpo.promoted_object = { page_id: pg.pageId };
      }
      const r = await g.post<{ id: string }>(`${ctx.conta}/adsets`, corpo);
      await auditar(ator, "meta_conjunto_criado", c.id, { id: r.id, campanha: a.campanha_id, conta: ctx.conta, destino: corpo.destination_type ?? null, otimizacao: corpo.optimization_goal, diario: a.orcamento_diario ?? null, vitalicio: a.orcamento_vitalicio ?? null, pagina_override: override ? a.page_id : undefined });
      const painel = await refletirNoPainel(deps, c.id);
      return { ok: true, conjunto_id: r.id, otimizacao: corpo.optimization_goal, cobranca: corpo.billing_event, destino: corpo.destination_type ?? null, status: corpo.status, no_painel: painel };
    }),
  }),
  def({
    nome: "meta_criativo_criar", titulo: "Meta Ads: criar criativo", escrita: true,
    descricao:
      "Cria um criativo com imagem (URL pública, enviada para a biblioteca da conta) ou vídeo (URL pública; informe capa_url), Página e Instagram do canal, texto, título, descrição, link e botão. " +
      "Para WhatsApp use whatsapp=true (botão WHATSAPP_MESSAGE).",
    entrada: {
      cliente, nome: z.string().trim().min(2).max(200), imagem_url: z.string().max(2000).optional(), video_url: z.string().max(2000).optional(), capa_url: z.string().max(2000).optional(),
      texto: z.string().trim().min(1).max(5000).describe("Texto principal."), titulo: z.string().trim().max(255).optional(), descricao: z.string().trim().max(255).optional(),
      link: z.string().max(2000).optional().describe("Destino (site). Obrigatório quando não é WhatsApp."), botao: z.enum(CTAS).optional(), whatsapp: z.boolean().default(false),
      page_id: idMeta.optional(), instagram_id: idMeta.optional().describe("Só se diferente do Instagram do canal."),
    },
    executar: meta(async (ator, a, deps) => {
      if (Boolean(a.imagem_url) === Boolean(a.video_url)) throw new ErroFerramenta("Informe imagem_url OU video_url.");
      if (!a.whatsapp && !a.link) throw new ErroFerramenta("Informe o link de destino (ou whatsapp=true).");
      if (a.link && !/^https:\/\/\S+$/i.test(a.link)) throw new ErroFerramenta("Link deve começar com https://.");
      const { c, ctx, g } = await abrir(ator, a.cliente, deps);
      const pg = await resolverPagina(g, ctx, a.page_id);
      let ig = ctx.igUserId, igOverride = false;
      if (a.instagram_id && a.instagram_id !== ctx.igUserId) {
        await g.get(a.instagram_id, { fields: "id,username" }).catch(() => { throw new ErroFerramenta("Não consegui acessar esse Instagram com o token de gestão."); });
        ig = a.instagram_id; igOverride = true;
      }
      const link = a.whatsapp ? "https://api.whatsapp.com/send" : a.link!;
      const cta = a.whatsapp
        ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } }
        : { type: a.botao ?? "LEARN_MORE", value: { link } };
      let spec: Record<string, unknown>;
      let midia: Record<string, unknown>;
      if (a.imagem_url) {
        const bytes = await baixarImagem(a.imagem_url, deps.fetchMeta);
        const up = await g.post<{ images?: Record<string, { hash: string }> }>(`${ctx.conta}/adimages`, { bytes });
        const hash = Object.values(up.images ?? {})[0]?.hash;
        if (!hash) throw new ErroFerramenta("A Meta não devolveu a imagem enviada.");
        midia = { imagem_hash: hash };
        spec = { link_data: { image_hash: hash, link, message: a.texto, ...(a.titulo ? { name: a.titulo } : {}), ...(a.descricao ? { description: a.descricao } : {}), call_to_action: cta } };
      } else {
        if (!a.capa_url || !/^https:\/\/\S+$/i.test(a.capa_url)) throw new ErroFerramenta("Vídeo: informe capa_url (imagem https de capa).");
        if (!/^https:\/\/\S+$/i.test(a.video_url!)) throw new ErroFerramenta("video_url deve ser https público.");
        const v = await g.post<{ id: string }>(`${ctx.conta}/advideos`, { file_url: a.video_url });
        midia = { video_id: v.id };
        spec = { video_data: { video_id: v.id, image_url: a.capa_url, message: a.texto, ...(a.titulo ? { title: a.titulo } : {}), ...(a.descricao ? { link_description: a.descricao } : {}), call_to_action: a.whatsapp ? cta : { type: a.botao ?? "LEARN_MORE", value: { link } } } };
      }
      const corpo = { name: a.nome, object_story_spec: { page_id: pg.pageId, ...(ig ? { instagram_user_id: ig } : {}), ...spec } };
      const r = await g.post<{ id: string }>(`${ctx.conta}/adcreatives`, corpo);
      await auditar(ator, "meta_criativo_criado", c.id, { id: r.id, conta: ctx.conta, ...midia, whatsapp: a.whatsapp, pagina_override: pg.override ? pg.pageId : undefined, instagram_override: igOverride ? ig : undefined });
      return { ok: true, criativo_id: r.id, ...midia, pagina: pg.pageId, instagram: ig };
    }),
  }),
  def({
    nome: "meta_anuncio_criar", titulo: "Meta Ads: criar anúncio", escrita: true,
    descricao: "Cria DIRETO o anúncio ligando um conjunto e um criativo da conta do cliente. Ativo por padrão (pausado=true para criar pausado).",
    entrada: { cliente, conjunto_id: idMeta, criativo_id: idMeta, nome: z.string().trim().min(2).max(200), pausado: z.boolean().default(false) },
    executar: meta(async (ator, a, deps) => {
      const { c, ctx, g } = await abrir(ator, a.cliente, deps);
      await objetoDaConta(g, ctx, a.conjunto_id, "name,campaign_id");
      await objetoDaConta(g, ctx, a.criativo_id, "name");
      const corpo = { name: a.nome, adset_id: a.conjunto_id, creative: { creative_id: a.criativo_id }, status: status(a.pausado) };
      const r = await g.post<{ id: string }>(`${ctx.conta}/ads`, corpo);
      await auditar(ator, "meta_anuncio_criado", c.id, { id: r.id, conjunto: a.conjunto_id, criativo: a.criativo_id, conta: ctx.conta, status: corpo.status });
      const painel = await refletirNoPainel(deps, c.id);
      return { ok: true, anuncio_id: r.id, status: corpo.status, no_painel: painel, aviso: "A Meta revisa o anúncio antes de veicular (status efetivo IN_PROCESS/PENDING_REVIEW)." };
    }),
  }),
  def({
    nome: "meta_alterar", titulo: "Meta Ads: alterar", escrita: true,
    descricao:
      "Altera DIRETO uma campanha, conjunto ou anúncio da conta do cliente: status (ativo/pausado), orçamento diário em reais (campanha ou conjunto), fim e nome. " +
      "Confere antes que o objeto é da conta do cliente. Orçamento acima do teto diário é recusado; aumento respeita o limite % diário da política de verba.",
    entrada: {
      cliente, nivel: z.enum(["campanha", "conjunto", "anuncio"]), id: idMeta, status: z.enum(["ativo", "pausado"]).optional(),
      orcamento_diario: dinheiro.optional(), fim: dataHora.optional(), nome: z.string().trim().min(2).max(200).optional(), motivo: z.string().trim().max(300).optional(),
    },
    executar: meta(async (ator, a, deps) => {
      if (a.status === undefined && a.orcamento_diario === undefined && a.fim === undefined && a.nome === undefined) throw new ErroFerramenta("Nada para alterar: informe status, orcamento_diario, fim ou nome.");
      if (a.nivel === "anuncio" && (a.orcamento_diario !== undefined || a.fim !== undefined)) throw new ErroFerramenta("Anúncio não tem orçamento nem data de fim: altere a campanha ou o conjunto.");
      const { c, ctx, g } = await abrir(ator, a.cliente, deps);
      const campos = a.nivel === "anuncio" ? "name,status" : "name,status,daily_budget,lifetime_budget";
      const obj = await objetoDaConta(g, ctx, a.id, campos);
      const corpo: Record<string, unknown> = {};
      if (a.status) corpo.status = a.status === "pausado" ? "PAUSED" : "ACTIVE";
      if (a.nome) corpo.name = a.nivel === "campanha" ? nomeComPrefixo(a.nome, ctx.filtroNome) : a.nome;
      if (a.fim) corpo[a.nivel === "campanha" ? "stop_time" : "end_time"] = a.fim;
      let antes: number | null = null;
      if (a.orcamento_diario !== undefined) {
        antes = reais(obj.daily_budget);
        if (antes === null) throw new ErroFerramenta(obj.lifetime_budget ? "Este objeto usa orçamento vitalício: altere pelo Gerenciador de Anúncios." : `Est${a.nivel === "campanha" ? "a campanha" : "e conjunto"} não tem orçamento diário próprio (o orçamento está no outro nível).`);
        const teto = checarTeto(ctx.teto, { diario: a.orcamento_diario });
        if (teto) {
          await auditar(ator, "meta_recusado_teto", c.id, { op: "alterar", objeto: a.id, novo: a.orcamento_diario, teto: ctx.teto });
          throw new ErroFerramenta(teto);
        }
        if (a.orcamento_diario > antes) {
          const ref = await referenciaDoDia(a.id, inicioDoDia());
          const viol = checkDailyLimit({ type: "update_ads_budget", maxPct: await pctDiarioOrcamento(c.id), currentValue: antes, newValue: a.orcamento_diario, firstValueToday: ref });
          if (viol) {
            await auditar(ator, "meta_recusado_limite", c.id, { objeto: a.id, antes, novo: a.orcamento_diario, motivo: viol });
            throw new ErroFerramenta(`Bloqueado pelo limite: ${viol}`);
          }
        }
        corpo.daily_budget = centavos(a.orcamento_diario);
      }
      await g.post(a.id, corpo);
      if (antes !== null) await auditar(ator, "meta_orcamento_alterado", c.id, { objeto: a.id, nivel: a.nivel, orcamento_antes: antes, orcamento_depois: a.orcamento_diario, motivo: a.motivo ?? null });
      await auditar(ator, "meta_objeto_alterado", c.id, { objeto: a.id, nivel: a.nivel, antes: { nome: obj.name, status: obj.status }, mudancas: Object.keys(corpo), status: corpo.status ?? null, motivo: a.motivo ?? null });
      const painel = await refletirNoPainel(deps, c.id);
      return { ok: true, id: a.id, nivel: a.nivel, alterado: { ...corpo, daily_budget: undefined, orcamento_diario: a.orcamento_diario }, orcamento_antes: antes ?? undefined, no_painel: painel };
    }),
  }),
];
