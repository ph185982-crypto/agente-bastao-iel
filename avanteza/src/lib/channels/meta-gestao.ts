// GESTÃO de anúncios da Meta (Marketing API, Graph v21.0): criar e alterar campanhas, conjuntos, criativos e anúncios na
// conta de anúncios configurada no canal do cliente. Usado só pelo conector do Claude (src/lib/mcp/ferramentas-meta.ts).
//
// Travas (decisão do dono):
//   • só a conta `ad_account_id` do canal; todo objeto alterado/usado é lido antes e precisa ter o mesmo account_id;
//   • teto de orçamento DIÁRIO por cliente (client_channels.meta_daily_budget_cap, padrão R$ 100): acima, recusa;
//   • aumento de orçamento respeita o limite % diário da política update_ads_budget (mesma regra do executor; a referência
//     do dia é o "antes" da primeira alteração de orçamento do objeto hoje, guardado na auditoria meta_orcamento_alterado);
//   • campanha criada para cliente com filtro por nome (campaign_name_filter) recebe o prefixo, para o painel e o alerta
//     de recarga continuarem contando;
//   • o token (do canal, cifrado, ou META_ADS_MANAGE_TOKEN) vai só no cabeçalho e nunca sai em retorno, log ou erro.
import { ApiError, fetchJson, type RetryOptions } from "@/lib/http";
import { rawQuery } from "@/lib/db/client";
import { decrypt } from "@/lib/crypto";
import { GRAPH_VERSION, erroGraph } from "@/lib/dashboards/meta";
import { safeImageUrl } from "@/lib/marketplaces/images";
import { esconderToken } from "./graph";
import { normalizarNome } from "./campanhas";

const HOST = "https://graph.facebook.com";
export const TETO_PADRAO = 100;

export class ErroMeta extends Error {
  constructor(message: string, public codigo: "config" | "token" | "permissao" | "conta" | "teto" | "limite" | "entrada" | "api") { super(message); this.name = "ErroMeta"; }
}

// ─── Credencial e contexto do cliente ────────────────────────────────────────

export type OrigemGestao = "cliente" | "plataforma";
/** Token para GERENCIAR anúncios: o do canal (cifrado) se houver; senão META_ADS_MANAGE_TOKEN (system user da plataforma). */
export async function tokenDeGestao(clientId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ token: string; origem: OrigemGestao } | null> {
  const [r] = await rawQuery<{ token_enc: string | null }>("select token_enc from avanteza.client_channels where client_id = $1 and provider = 'meta'", [clientId]);
  if (r?.token_enc) {
    try { return { token: decrypt(r.token_enc), origem: "cliente" }; } catch { /* cifra inválida: cai para a plataforma */ }
  }
  const plat = env.META_ADS_MANAGE_TOKEN?.trim();
  return plat ? { token: plat, origem: "plataforma" } : null;
}

/** Sem chamar a Meta: existe credencial de gestão para este canal? (indicador da aba Canais). */
export function credencialGestaoDisponivel(temTokenCliente: boolean, env: NodeJS.ProcessEnv = process.env): OrigemGestao | null {
  return temTokenCliente ? "cliente" : env.META_ADS_MANAGE_TOKEN?.trim() ? "plataforma" : null;
}

export interface ContextoMeta {
  clientId: string; conta: string; /** act_… */ contaNum: string; pageId: string | null; igUserId: string | null;
  filtroNome: string | null; teto: number; token: string; origem: OrigemGestao;
}

export async function contextoMeta(clientId: string, env: NodeJS.ProcessEnv = process.env): Promise<ContextoMeta> {
  const [c] = await rawQuery<any>(
    "select ad_account_id, page_id, ig_user_id, campaign_name_filter, coalesce(meta_daily_budget_cap, $2)::float8 as teto, status from avanteza.client_channels where client_id = $1 and provider = 'meta'",
    [clientId, TETO_PADRAO],
  );
  if (!c || !c.ad_account_id) throw new ErroMeta("Este cliente não tem conta de anúncios da Meta configurada. Configure em Central → cliente → Canais → Tráfego (anúncios).", "config");
  if (c.status === "desconectado") throw new ErroMeta("O canal da Meta deste cliente está desconectado.", "config");
  const t = await tokenDeGestao(clientId, env);
  if (!t) throw new ErroMeta("Sem token para gerenciar anúncios: salve o token do cliente na aba Canais ou configure META_ADS_MANAGE_TOKEN (usuário do sistema com ads_management).", "token");
  const num = String(c.ad_account_id).replace(/^act_/, "");
  return { clientId, conta: `act_${num}`, contaNum: num, pageId: c.page_id ?? null, igUserId: c.ig_user_id ?? null, filtroNome: c.campaign_name_filter ?? null, teto: Number(c.teto), token: t.token, origem: t.origem };
}

// ─── Cliente HTTP (GET e POST; token só no cabeçalho) ────────────────────────

export interface OpcoesHttp extends Pick<RetryOptions, "sleep" | "fetchImpl" | "baseDelayMs" | "maxDelayMs"> {}
export interface GraphGestao {
  get<T = any>(caminho: string, params?: Record<string, string | number | undefined>): Promise<T>;
  /** POST com corpo JSON. Sem retry automático (evita criar duas vezes); erros traduzidos. */
  post<T = any>(caminho: string, corpo: Record<string, unknown>): Promise<T>;
}

/** Traduz o erro da Graph para português (mensagem do usuário da Meta quando houver), sem token. */
export function traduzirErroGestao(e: unknown, token?: string): ErroMeta {
  if (e instanceof ErroMeta) return e;
  if (e instanceof ApiError) {
    const g = erroGraph(e) as Record<string, any>;
    const det = esconderToken(String(g.error_user_msg ?? g.message ?? "").slice(0, 300), token);
    if (g.code === 190 || e.status === 401) return new ErroMeta("Token da Meta inválido ou expirado. Gere um novo e salve na aba Canais (ou atualize META_ADS_MANAGE_TOKEN).", "token");
    if ([10, 200, 294, 3, 278].includes(g.code) || (g.code >= 200 && g.code < 300) || e.status === 403) return new ErroMeta(`O token não tem permissão para gerenciar esta conta (ads_management). ${det}`.trim(), "permissao");
    if ([4, 17, 32, 613].includes(g.code) || e.status === 429) return new ErroMeta("A Meta limitou as chamadas agora. Tente de novo em alguns minutos.", "limite");
    return new ErroMeta(`A Meta recusou${g.error_user_title ? ` (${String(g.error_user_title).slice(0, 80)})` : ""}: ${det || `erro ${g.code ?? e.status}`}`, "api");
  }
  return new ErroMeta("Não foi possível falar com a Meta agora.", "api");
}

export function criarGraphGestao(token: string, o: OpcoesHttp = {}): GraphGestao {
  const raiz = `${HOST}/${GRAPH_VERSION}`;
  const url = (c: string, p: Record<string, string | number | undefined> = {}) => {
    if (!/^[A-Za-z0-9_/]+$/.test(c)) throw new ErroMeta("Id inválido.", "entrada");
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const q = qs.toString();
    return `${raiz}/${c.replace(/^\/+/, "")}${q ? `?${q}` : ""}`;
  };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const ret = { sleep: o.sleep, fetchImpl: o.fetchImpl, baseDelayMs: o.baseDelayMs, maxDelayMs: o.maxDelayMs };
  return {
    async get(c, p) {
      try { return await fetchJson(url(c, p), { method: "GET", headers }, { retries: 2, ...ret }); } catch (e) { throw traduzirErroGestao(e, token); }
    },
    async post(c, corpo) {
      try {
        return await fetchJson(url(c), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(corpo) }, { retries: 0, ...ret });
      } catch (e) { throw traduzirErroGestao(e, token); }
    },
  };
}

// ─── Regras puras ────────────────────────────────────────────────────────────

export const OBJETIVOS = ["OUTCOME_ENGAGEMENT", "OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_AWARENESS"] as const;
export type Objetivo = (typeof OBJETIVOS)[number];
export const DESTINOS = ["WHATSAPP", "MESSENGER", "INSTAGRAM_DIRECT", "WEBSITE"] as const;
export type Destino = (typeof DESTINOS)[number];
const MENSAGEM = new Set<Destino>(["WHATSAPP", "MESSENGER", "INSTAGRAM_DIRECT"]);

export const centavos = (reais: number) => Math.round(reais * 100);
export const reais = (c: unknown) => (c === null || c === undefined || c === "" ? null : Math.round(Number(c)) / 100);

/** Prefixo do filtro por nome: "SHOW MAN | Nome" (não duplica se o nome já contém o filtro). */
export function nomeComPrefixo(nome: string, filtro: string | null): string {
  const n = nome.trim();
  if (!filtro?.trim()) return n;
  return normalizarNome(n).includes(normalizarNome(filtro)) ? n : `${filtro.trim()} | ${n}`;
}

/** Orçamento diário (ou média diária de um vitalício) acima do teto do cliente → mensagem de recusa. */
export function checarTeto(teto: number, o: { diario?: number; vitalicio?: number; inicio?: string; fim?: string }): string | null {
  if (o.diario !== undefined && o.diario > teto + 1e-9) return `Orçamento diário de R$ ${o.diario.toFixed(2)} acima do teto deste cliente (R$ ${teto.toFixed(2)}/dia). Ajuste o teto na aba Canais se o dono autorizar.`;
  if (o.vitalicio !== undefined) {
    if (!o.fim) return "Orçamento vitalício exige data de término (fim).";
    const ini = o.inicio ? new Date(o.inicio).getTime() : Date.now();
    const dias = Math.max(1, Math.ceil((new Date(o.fim).getTime() - ini) / 86_400_000));
    const media = o.vitalicio / dias;
    if (media > teto + 1e-9) return `Orçamento vitalício de R$ ${o.vitalicio.toFixed(2)} em ${dias} dia(s) dá R$ ${media.toFixed(2)}/dia, acima do teto deste cliente (R$ ${teto.toFixed(2)}/dia).`;
  }
  return null;
}

/** Meta de otimização e cobrança padrão por objetivo e destino. */
export function padroesConjunto(objetivo: Objetivo, destino: Destino | undefined): { optimization_goal: string; billing_event: string; destination_type?: string } {
  const msg = destino && MENSAGEM.has(destino);
  switch (objetivo) {
    case "OUTCOME_ENGAGEMENT":
      return msg ? { optimization_goal: "CONVERSATIONS", billing_event: "IMPRESSIONS", destination_type: destino } : { optimization_goal: "POST_ENGAGEMENT", billing_event: "IMPRESSIONS" };
    case "OUTCOME_TRAFFIC":
      return { optimization_goal: "LINK_CLICKS", billing_event: "IMPRESSIONS", destination_type: destino ?? "WEBSITE" };
    case "OUTCOME_LEADS":
      return msg ? { optimization_goal: "CONVERSATIONS", billing_event: "IMPRESSIONS", destination_type: destino } : { optimization_goal: "LEAD_GENERATION", billing_event: "IMPRESSIONS", destination_type: "ON_AD" };
    case "OUTCOME_SALES":
      return msg ? { optimization_goal: "CONVERSATIONS", billing_event: "IMPRESSIONS", destination_type: destino } : { optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", destination_type: "WEBSITE" };
    case "OUTCOME_AWARENESS":
      return { optimization_goal: "REACH", billing_event: "IMPRESSIONS" };
  }
}

export interface Segmentacao {
  idade_min?: number; idade_max?: number; generos?: Array<"masculino" | "feminino">;
  cidades?: Array<{ key: string; raio_km?: number }>; pontos?: Array<{ latitude: number; longitude: number; raio_km: number }>; paises?: string[];
  interesses?: Array<{ id: string; nome?: string }>; publicos?: string[];
  plataformas?: Array<"facebook" | "instagram" | "messenger" | "audience_network">; posicoes_instagram?: string[]; posicoes_facebook?: string[];
}

/** Monta `targeting` da Marketing API. Sem localização → Brasil. Posicionamento automático quando nada é informado. */
export function montarTargeting(s: Segmentacao): Record<string, unknown> {
  const geo: Record<string, unknown> = {};
  if (s.cidades?.length) geo.cities = s.cidades.map((c) => ({ key: c.key, ...(c.raio_km ? { radius: c.raio_km, distance_unit: "kilometer" } : {}) }));
  if (s.pontos?.length) geo.custom_locations = s.pontos.map((p) => ({ latitude: p.latitude, longitude: p.longitude, radius: p.raio_km, distance_unit: "kilometer" }));
  if (s.paises?.length || !Object.keys(geo).length) geo.countries = s.paises?.length ? s.paises : ["BR"];
  const t: Record<string, unknown> = { geo_locations: geo, age_min: s.idade_min ?? 18, age_max: s.idade_max ?? 65 };
  if (s.generos?.length === 1) t.genders = [s.generos[0] === "masculino" ? 1 : 2];
  if (s.interesses?.length) t.flexible_spec = [{ interests: s.interesses.map((i) => ({ id: i.id, ...(i.nome ? { name: i.nome } : {}) })) }];
  if (s.publicos?.length) t.custom_audiences = s.publicos.map((id) => ({ id }));
  if (s.plataformas?.length) {
    t.publisher_platforms = s.plataformas;
    if (s.posicoes_instagram?.length) t.instagram_positions = s.posicoes_instagram;
    if (s.posicoes_facebook?.length) t.facebook_positions = s.posicoes_facebook;
  }
  t.targeting_automation = { advantage_audience: 0 };
  return t;
}

const somenteDigitos = (s: unknown) => String(s ?? "").replace(/^act_/, "");

/** Lê o objeto e confere que é da conta do cliente. Outro dono → recusa (nada é alterado). */
export async function objetoDaConta(g: GraphGestao, ctx: ContextoMeta, id: string, campos = "id,name"): Promise<Record<string, any>> {
  if (!/^\d{3,25}$/.test(id)) throw new ErroMeta("Id do objeto da Meta inválido (só números).", "entrada");
  const o = await g.get<Record<string, any>>(id, { fields: `account_id,${campos}` });
  if (somenteDigitos(o.account_id) !== ctx.contaNum) throw new ErroMeta("Este objeto não pertence à conta de anúncios deste cliente. Nada foi alterado.", "conta");
  return o;
}

/** Página/Instagram: os do canal; override só se a Meta responder (alcançável) — quem chama registra na auditoria. */
export async function resolverPagina(g: GraphGestao, ctx: ContextoMeta, override?: string): Promise<{ pageId: string; override: boolean }> {
  if (override && override !== ctx.pageId) {
    if (!/^\d{3,25}$/.test(override)) throw new ErroMeta("page_id inválido.", "entrada");
    await g.get(override, { fields: "id,name" }).catch(() => { throw new ErroMeta("Não consegui acessar essa Página com o token de gestão.", "conta"); });
    return { pageId: override, override: true };
  }
  if (!ctx.pageId) throw new ErroMeta("O canal não tem Página do Facebook (page_id). Configure na aba Canais → Instagram (fonte Meta) ou informe page_id.", "config");
  return { pageId: ctx.pageId, override: false };
}

// ─── Limite % diário de aumento de orçamento (política update_ads_budget) ──────

/** Referência do dia: o "antes" da 1ª alteração de orçamento deste objeto hoje (auditoria), ou null. */
export async function referenciaDoDia(objetoId: string, desdeIso: string): Promise<number | null> {
  const [r] = await rawQuery<{ antes: string | null }>(
    "select details->>'orcamento_antes' as antes from avanteza.audit_log where event = 'meta_orcamento_alterado' and details->>'objeto' = $1 and created_at >= $2::timestamptz order by created_at asc limit 1",
    [objetoId, desdeIso],
  );
  return r?.antes != null ? Number(r.antes) : null;
}

export async function pctDiarioOrcamento(clientId: string): Promise<number | null> {
  const rows = await rawQuery<{ client_id: string | null; max: string | null }>("select client_id, max_change_pct_per_day::float8 as max from avanteza.action_policies where action_type = 'update_ads_budget' and (client_id = $1 or client_id is null)", [clientId]);
  const r = rows.find((x) => x.client_id === clientId) ?? rows.find((x) => x.client_id === null);
  return r?.max != null ? Number(r.max) : null;
}

/** Baixa a imagem (URL pública https, até 8 MB) e devolve em base64 para /adimages (bytes). */
export async function baixarImagem(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const u = safeImageUrl(url);
  if (!u) throw new ErroMeta("URL de imagem inválida (use https público).", "entrada");
  let res: Response;
  try { res = await fetchImpl(u, { signal: AbortSignal.timeout(20_000) }); } catch { throw new ErroMeta("Não consegui baixar a imagem.", "entrada"); }
  if (!res.ok) throw new ErroMeta(`Não consegui baixar a imagem (HTTP ${res.status}).`, "entrada");
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 8 * 1024 * 1024) throw new ErroMeta("Imagem vazia ou maior que 8 MB.", "entrada");
  return buf.toString("base64");
}
