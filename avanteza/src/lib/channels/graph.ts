// Cliente da Meta Graph API (v21.0) para os canais dos clientes. SOMENTE LEITURA: só GET, só no host graph.facebook.com.
// O token vai no cabeçalho Authorization (nunca na URL, em log ou em mensagem de erro). Retry com backoff (src/lib/http.ts)
// para 429/5xx/rede e para os erros transitórios/de limite que a Meta devolve com HTTP 400. Pausa curta entre chamadas
// (rate limit gentil). Métricas do Instagram indisponíveis viram "indisponível", nunca derrubam a coleta inteira.
import { ApiError, backoffDelay, fetchJson, type RetryOptions } from "@/lib/http";
import { addDays } from "@/lib/dates";
import { CODIGOS_TRANSITORIOS, GRAPH_VERSION, MetaErro, erroGraph, limiteDeUso, rotuloStatus, traduzirErroMeta, type CodigoErroMeta } from "@/lib/dashboards/meta";
import { safeImageUrl } from "@/lib/marketplaces/images";
import {
  IG_METRICAS_DIA, PERMISSOES_NECESSARIAS,
  type AnuncioInfo, type CanaisApi, type IgMetricaDia, type IgMidiaBruta, type IgPerfil, type InsightBruto, type ResultadoTeste, type VerificacaoTeste,
} from "./types";

const HOST = "graph.facebook.com";
const MAX_PAGINAS = 30;
const SO_DIGITOS = /^\d{3,25}$/;
const ACT = /^act_\d{3,25}$/;

/** Erro da Graph com o código e a mensagem originais (a mensagem original só serve para o administrador). */
export class GraphErro extends MetaErro {
  constructor(message: string, codigo: CodigoErroMeta, public graphCode?: number, public detalhe?: string) { super(message, codigo); this.name = "GraphErro"; }
}

export interface OpcoesGraph extends Pick<RetryOptions, "sleep" | "fetchImpl" | "baseDelayMs" | "maxDelayMs"> {
  token: string;
  versao?: string;
  /** Tentativas extras para erros transitórios/limite com HTTP 400 (padrão 3). */
  tentativas?: number;
  /** Pausa entre chamadas, em ms (padrão 120). Testes usam 0. */
  pausaMs?: number;
}
export type Params = Record<string, string | number | undefined>;
export interface Graph {
  get<T = any>(caminho: string, params?: Params): Promise<T>;
  paginar<T = any>(caminho: string, params?: Params, maxPaginas?: number): Promise<T[]>;
}

/** Remove o token de qualquer texto antes de guardar ou mostrar. */
export function esconderToken(texto: string, token?: string | null): string {
  let t = texto;
  if (token && token.length >= 6) t = t.split(token).join("***");
  return t.replace(/access_token=[^&\s"']+/gi, "access_token=***").replace(/Bearer\s+[A-Za-z0-9_\-.]+/g, "Bearer ***");
}

export function criarGraph(o: OpcoesGraph): Graph {
  const versao = o.versao ?? GRAPH_VERSION;
  const tentativas = o.tentativas ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = o.baseDelayMs ?? 500, max = o.maxDelayMs ?? 8000;
  const pausa = o.pausaMs ?? 120;
  const raiz = `https://${HOST}/${versao}`;
  let primeira = true;

  const traduzir = (e: unknown): GraphErro => {
    const m = traduzirErroMeta(e);
    const g = e instanceof ApiError ? erroGraph(e) : {};
    return new GraphErro(m.message, m.codigo, g.code, g.message ? esconderToken(String(g.message), o.token).slice(0, 220) : undefined);
  };

  const getUrl = async <T,>(url: string): Promise<T> => {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== HOST) throw new GraphErro("Endereço inesperado na paginação da Meta.", "api");
    if (!primeira && pausa > 0) await sleep(pausa);
    primeira = false;
    for (let i = 0; ; i++) {
      try {
        // Só GET. O token só vai no cabeçalho.
        return await fetchJson<T>(url, { method: "GET", headers: { Authorization: `Bearer ${o.token}`, Accept: "application/json" } }, { retries: 2, baseDelayMs: base, maxDelayMs: max, sleep, fetchImpl: o.fetchImpl });
      } catch (e) {
        const g = e instanceof ApiError ? erroGraph(e) : null;
        const transitorio = g && (g.is_transient === true || CODIGOS_TRANSITORIOS.has(g.code ?? -1) || limiteDeUso(g.code));
        if (transitorio && i < tentativas) { await sleep(backoffDelay(i, limiteDeUso(g.code) ? base * 4 : base, max * 4)); continue; }
        throw traduzir(e);
      }
    }
  };
  const montar = (caminho: string, params: Params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const q = qs.toString();
    return `${raiz}/${caminho.replace(/^\/+/, "")}${q ? `?${q}` : ""}`;
  };
  return {
    get: (caminho, params) => getUrl(montar(caminho, params)),
    async paginar<T,>(caminho: string, params?: Params, maxPaginas = MAX_PAGINAS) {
      const out: T[] = [];
      let url: string | undefined = montar(caminho, params);
      for (let p = 0; url && p < maxPaginas; p++) {
        const r: { data?: T[]; paging?: { next?: string } } = await getUrl(url);
        out.push(...(r.data ?? []));
        url = r.paging?.next;
      }
      return out;
    },
  };
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : null; };
const filtroCampanhas = (ids: string[]) => (ids.length ? JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids.filter((i) => SO_DIGITOS.test(i)) }]) : undefined);

/** Divide [de, ate] em janelas de até `n` dias (a Meta responde melhor a janelas moderadas). */
export function janelas(de: string, ate: string, n = 30): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let ini = de; ini <= ate; ini = addDays(ini, n)) out.push([ini, addDays(ini, n - 1) < ate ? addDays(ini, n - 1) : ate]);
  return out;
}

const CAMPOS_BASE = "spend,impressions,reach,clicks,ctr,cpc,frequency,actions";
const erroDeMetrica = (e: unknown) => e instanceof GraphErro && (e.graphCode === 100 || e.graphCode === 3001 || e.graphCode === 2108006 || /metric/i.test(e.detalhe ?? ""));

function valorDeInsight(item: any): number | null {
  if (!item || typeof item !== "object") return null;
  if (item.total_value && typeof item.total_value === "object") return num(item.total_value.value);
  if (Array.isArray(item.values) && item.values.length) return num(item.values[item.values.length - 1]?.value);
  return null;
}

// ─── Implementação da API ────────────────────────────────────────────────────

export function criarApiGraph(g: Graph): CanaisApi {
  return {
    testar: (cfg) => testarConexao(g, cfg),

    async insightsDiarios({ contaId, nivel, de, ate, campanhas }) {
      if (!ACT.test(contaId)) throw new GraphErro("Identificador de conta inválido.", "api");
      const out: InsightBruto[] = [];
      for (const [a, b] of janelas(de, ate)) {
        const campos = nivel === "ad" ? `ad_id,ad_name,campaign_id,campaign_name,${CAMPOS_BASE}` : `campaign_id,campaign_name,${CAMPOS_BASE}`;
        out.push(...(await g.paginar<InsightBruto>(`${contaId}/insights`, { fields: campos, level: nivel, time_increment: 1, time_range: JSON.stringify({ since: a, until: b }), limit: 500, filtering: filtroCampanhas(campanhas) })));
      }
      return out;
    },

    async anuncios({ contaId, campanhas }) {
      if (!ACT.test(contaId)) throw new GraphErro("Identificador de conta inválido.", "api");
      const parse = (r: any): AnuncioInfo => ({
        id: String(r.id), nome: String(r.name ?? r.id), campanhaId: r.campaign_id ? String(r.campaign_id) : null,
        status: r.status ?? null, statusEfetivo: r.effective_status ?? null,
        thumb: safeImageUrl(r.creative?.thumbnail_url), imagem: safeImageUrl(r.creative?.image_url), videoId: r.creative?.video_id ? String(r.creative.video_id) : null,
      });
      const consulta = (campos: string) => g.paginar<any>(`${contaId}/ads`, { fields: campos, limit: 100, filtering: filtroCampanhas(campanhas) }, 10);
      let rows: any[];
      try {
        // Miniatura em tamanho maior (a padrão é 64×64). Se a Meta recusar o modificador, cai para o campo simples.
        rows = await consulta("id,name,status,effective_status,campaign_id,creative.thumbnail_width(400).thumbnail_height(400){thumbnail_url,image_url,video_id}");
      } catch (e) {
        if (!(e instanceof GraphErro) || e.graphCode !== 100) throw e;
        rows = await consulta("id,name,status,effective_status,campaign_id,creative{thumbnail_url,image_url,video_id}");
      }
      return rows.map(parse);
    },

    async igPerfil(igId) {
      if (!SO_DIGITOS.test(igId)) throw new GraphErro("ID do Instagram inválido.", "api");
      const r = await g.get<any>(igId, { fields: "username,name,followers_count,media_count,profile_picture_url" });
      return { username: r.username ?? null, nome: r.name ?? null, seguidores: num(r.followers_count), midias: num(r.media_count), foto: safeImageUrl(r.profile_picture_url) } satisfies IgPerfil;
    },

    async igSeguidoresDiarios(igId, de, ate) {
      // follower_count só existe para os últimos ~30 dias; pedimos uma janela de no máximo 29 dias terminando em `ate`.
      const ini = de > addDays(ate, -29) ? de : addDays(ate, -29);
      const r = await g.get<{ data?: any[] }>(`${igId}/insights`, { metric: "follower_count", period: "day", since: ini, until: addDays(ate, 1) });
      const out: Record<string, number> = {};
      for (const v of r.data?.[0]?.values ?? []) {
        const n = num(v?.value), fim = typeof v?.end_time === "string" ? v.end_time.slice(0, 10) : null;
        if (n != null && fim) out[addDays(fim, -1)] = n; // end_time é o FIM do dia: o valor pertence ao dia anterior
      }
      return out;
    },

    async igMetricasDia(igId, dia, excluir) {
      const pedir = (ms: readonly IgMetricaDia[]) => g.get<{ data?: any[] }>(`${igId}/insights`, { metric: ms.join(","), period: "day", metric_type: "total_value", since: dia, until: addDays(dia, 1) });
      const metricas = IG_METRICAS_DIA.filter((m) => !excluir.has(m));
      const valores: Partial<Record<IgMetricaDia, number>> = {};
      const indisponiveis: IgMetricaDia[] = [];
      if (!metricas.length) return { valores, indisponiveis };
      try {
        const r = await pedir(metricas);
        for (const it of r.data ?? []) { const v = valorDeInsight(it); if (v != null && (IG_METRICAS_DIA as readonly string[]).includes(it.name)) valores[it.name as IgMetricaDia] = v; }
      } catch (e) {
        if (!erroDeMetrica(e)) throw e;
        // Alguma métrica não existe/ não é suportada nesta conta: testa uma a uma e guarda só as que respondem.
        for (const m of metricas) {
          try {
            const r = await pedir([m]);
            const v = valorDeInsight(r.data?.[0]);
            if (v != null) valores[m] = v;
          } catch (e2) {
            if (!erroDeMetrica(e2)) throw e2;
            indisponiveis.push(m);
          }
        }
      }
      return { valores, indisponiveis };
    },

    async igMidias(igId, desde, limite, pode) {
      const lista = await g.paginar<any>(`${igId}/media`, { fields: "id,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: 50 }, 4);
      const recentes = lista.filter((m) => typeof m.timestamp === "string" && m.timestamp.slice(0, 10) >= desde).slice(0, limite);
      const out: IgMidiaBruta[] = [];
      for (const m of recentes) {
        const ts = String(m.timestamp);
        const tipo = String(m.media_type ?? "IMAGE");
        const item: IgMidiaBruta = {
          id: String(m.id), tipo, produto: m.media_product_type ?? null, legenda: typeof m.caption === "string" ? m.caption.slice(0, 160) : null,
          permalink: typeof m.permalink === "string" && /^https:\/\//.test(m.permalink) ? m.permalink : null,
          thumb: safeImageUrl(tipo === "VIDEO" ? m.thumbnail_url ?? m.media_url : m.media_url ?? m.thumbnail_url),
          timestamp: ts, data: ts.slice(0, 10),
          likes: num(m.like_count), comentarios: num(m.comments_count), alcance: null, salvos: null, compartilhamentos: null, views: null, interacoes: null,
        };
        if (pode()) {
          const lido: Record<string, number> = {};
          const pedir = async (ms: string[]) => { const r = await g.get<{ data?: any[] }>(`${m.id}/insights`, { metric: ms.join(",") }); for (const it of r.data ?? []) { const v = valorDeInsight(it); if (v != null) lido[it.name] = v; } };
          try { await pedir(["reach", "saved", "shares", "total_interactions", "views"]); }
          catch (e) {
            if (!erroDeMetrica(e)) throw e;
            for (const mt of ["reach", "saved", "shares", "total_interactions", "views"]) { try { await pedir([mt]); } catch (e2) { if (!erroDeMetrica(e2)) throw e2; } }
          }
          item.alcance = lido.reach ?? null; item.salvos = lido.saved ?? null; item.compartilhamentos = lido.shares ?? null; item.interacoes = lido.total_interactions ?? null; item.views = lido.views ?? lido.plays ?? null;
        }
        out.push(item);
      }
      return out;
    },
  };
}

// ─── Teste de conexão (só GET; nunca devolve o token) ────────────────────────

const msgErro = (e: unknown) => (e instanceof GraphErro ? `${e.message}${e.detalhe ? ` (${e.detalhe})` : ""}` : "Falha inesperada ao consultar a Meta.");

export async function testarConexao(g: Graph, cfg: { adAccountId: string | null; campaignIds: string[]; igUserId: string | null; pageId: string | null }): Promise<ResultadoTeste> {
  const v: VerificacaoTeste[] = [];
  const info: ResultadoTeste["info"] = {};
  let concedidas: string[] = [];
  let faltando: string[] = [];
  const add = (id: string, rotulo: string, ok: boolean | null, detalhe: string) => v.push({ id, rotulo, ok, detalhe });

  try {
    const me = await g.get<any>("me", { fields: "id,name" });
    add("token", "Token válido", true, `Reconhecido como “${String(me.name ?? me.id)}”.`);
  } catch (e) {
    add("token", "Token válido", false, msgErro(e));
    return { origemToken: "nenhum", verificacoes: v, concedidas, faltando: [...PERMISSOES_NECESSARIAS], ok: false, info };
  }

  try {
    const r = await g.get<{ data?: Array<{ permission: string; status: string }> }>("me/permissions", { limit: 100 });
    concedidas = (r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
    faltando = PERMISSOES_NECESSARIAS.filter((p) => !concedidas.includes(p));
    add("permissoes", "Permissões de leitura", faltando.length === 0, faltando.length ? `Faltam: ${faltando.join(", ")}.` : "Todas as permissões necessárias foram concedidas.");
  } catch (e) {
    add("permissoes", "Permissões de leitura", null, `Não foi possível listar as permissões (${msgErro(e)}). Os testes abaixo mostram o que funciona na prática.`);
  }

  if (!cfg.adAccountId) {
    add("conta", "Conta de anúncios", null, "Não informada.");
  } else if (!ACT.test(cfg.adAccountId)) {
    add("conta", "Conta de anúncios", false, "Formato inválido. Use act_ seguido de números.");
  } else {
    try {
      const c = await g.get<any>(cfg.adAccountId, { fields: "name,account_status,currency" });
      info.conta_nome = String(c.name ?? cfg.adAccountId); info.moeda = c.currency ?? undefined;
      info.conta_status = rotuloStatus(typeof c.account_status === "number" ? c.account_status : null);
      add("conta", "Conta de anúncios", true, `${info.conta_nome} · ${info.conta_status} · moeda ${info.moeda ?? "?"}.`);
    } catch (e) {
      add("conta", "Conta de anúncios", false, `${msgErro(e)} Confira se a conta foi atribuída ao usuário do sistema com “Visualizar desempenho”.`);
    }
    try {
      await g.get(`${cfg.adAccountId}/insights`, { date_preset: "last_7d", fields: "spend", limit: 1 });
      add("insights", "Leitura de insights dos anúncios", true, "A Meta respondeu aos insights dos últimos 7 dias.");
    } catch (e) {
      add("insights", "Leitura de insights dos anúncios", false, msgErro(e));
    }
    try {
      const filtro = filtroCampanhas(cfg.campaignIds);
      const cs = await g.paginar<any>(`${cfg.adAccountId}/campaigns`, { fields: "id,name,effective_status", limit: 100, filtering: filtro }, 3);
      if (cfg.campaignIds.length) {
        const achadas = cfg.campaignIds.filter((id) => cs.some((c) => String(c.id) === id));
        const perdidas = cfg.campaignIds.filter((id) => !achadas.includes(id));
        add("campanhas", "Acesso às campanhas", perdidas.length === 0, perdidas.length ? `Não encontrei: ${perdidas.join(", ")}.` : cs.map((c) => `${c.name} (${c.effective_status})`).join("; "));
      } else {
        add("campanhas", "Acesso às campanhas", true, `${cs.length} campanha(s) visível(is) na conta.`);
      }
    } catch (e) {
      add("campanhas", "Acesso às campanhas", false, msgErro(e));
    }
  }

  let igId = cfg.igUserId;
  if (!cfg.pageId) {
    add("pagina", "Página do Facebook", null, "Não informada.");
  } else if (!SO_DIGITOS.test(cfg.pageId)) {
    add("pagina", "Página do Facebook", false, "O ID da Página deve ter só números.");
  } else {
    try {
      const p = await g.get<any>(cfg.pageId, { fields: "name,instagram_business_account{id,username}" });
      const ig = p.instagram_business_account;
      if (ig?.id) info.ig_sugerido = String(ig.id);
      add("pagina", "Página do Facebook", true, `${p.name ?? cfg.pageId}${ig?.id ? ` · Instagram vinculado: @${ig.username ?? ig.id} (ID ${ig.id})` : " · nenhum Instagram vinculado a esta Página"}.`);
      if (!igId && ig?.id) igId = String(ig.id);
    } catch (e) {
      add("pagina", "Página do Facebook", false, `${msgErro(e)} Confira a atribuição da Página ao usuário do sistema e a permissão pages_read_engagement.`);
    }
  }

  if (!igId) {
    add("instagram", "Instagram", null, "Não informado.");
  } else if (!SO_DIGITOS.test(igId)) {
    add("instagram", "Instagram", false, "O ID do Instagram deve ter só números.");
  } else {
    try {
      const r = await g.get<any>(igId, { fields: "username,followers_count,media_count" });
      info.ig_username = r.username ?? undefined;
      add("instagram", "Instagram", true, `@${r.username ?? igId} · ${num(r.followers_count) ?? "?"} seguidores · ${num(r.media_count) ?? "?"} mídias.`);
    } catch (e) {
      add("instagram", "Instagram", false, `${msgErro(e)} O perfil precisa ser profissional, vinculado à Página, e o token precisa de instagram_basic.`);
    }
    try {
      await g.get(`${igId}/insights`, { metric: "reach", period: "day", metric_type: "total_value", since: addDays(new Date().toISOString().slice(0, 10), -3), until: addDays(new Date().toISOString().slice(0, 10), -2) });
      add("ig_insights", "Insights do Instagram", true, "A Meta respondeu às métricas do perfil.");
    } catch (e) {
      add("ig_insights", "Insights do Instagram", false, `${msgErro(e)} Precisa de instagram_manage_insights.`);
    }
  }
  return { origemToken: "nenhum", verificacoes: v, concedidas, faltando, ok: v.every((x) => x.ok !== false), info };
}
