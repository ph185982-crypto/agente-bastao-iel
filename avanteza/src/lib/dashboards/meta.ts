// Marketing = Meta Marketing API (Graph API v21.0), SOMENTE LEITURA.
//   GET /me/adaccounts                      → contas de anúncio do token
//   GET /{act_id}/insights                  → spend, impressions, reach, clicks, ctr, cpc, actions, action_values
// (nível conta com e sem time_increment=1, e nível campaign). Nenhuma chamada de escrita: só GET.
// O token vem de META_ACCESS_TOKEN (nunca no código, em teste, em log ou na URL: vai no cabeçalho Authorization).
// O provedor é injetável (testes e fixture usam um falso). Retry com backoff para 429/5xx/rede (src/lib/http.ts) e para
// os erros transitórios/de limite que a Meta devolve com HTTP 400. Várias contas são listadas e agregadas; conta
// desativada, sem dados ou com erro vira linha própria, sem derrubar as demais.
import { ApiError, backoffDelay, fetchJson, type RetryOptions } from "@/lib/http";
import { comCache, cacheCompartilhado, type CacheStore } from "./cache";
import type { Intervalo } from "./periodo";
import { listarDias } from "./periodo";

export const GRAPH_VERSION = "v21.0";
const GRAPH_HOST = "graph.facebook.com";
export const TTL_META_MS = 15 * 60_000;
const MAX_CONTAS = 25;
const MAX_PAGINAS = 6;

export const CAMPOS_INSIGHTS = "spend,impressions,reach,clicks,ctr,cpc,actions,action_values";
/** Ordem de preferência: "lead" já agrega os demais tipos de lead, então usamos o primeiro que existir (sem dupla contagem). */
export const TIPOS_LEAD = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
export const TIPOS_CONVERSA = ["onsite_conversion.messaging_conversation_started_7d"];
export const TIPOS_COMPRA = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ContaAnuncio { id: string; nome: string; moeda: string | null; status: number | null }
export interface LinhaBruta {
  spend?: string; impressions?: string; reach?: string; clicks?: string; ctr?: string; cpc?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  campaign_id?: string; campaign_name?: string; date_start?: string; date_stop?: string;
}
export interface ConsultaInsights { contaId: string; de: string; ate: string; nivel: "account" | "campaign"; diario?: boolean }
export interface MetaProvider {
  listarContas(): Promise<ContaAnuncio[]>;
  insights(q: ConsultaInsights): Promise<LinhaBruta[]>;
}

export interface Insight {
  gasto: number; impressoes: number; alcance: number; cliques: number; ctr: number | null; cpc: number | null;
  leads: number; conversas: number; compras: number; valorCompras: number;
}
export interface PontoMeta { data: string; gasto: number; impressoes: number; cliques: number; resultados: number }
export interface CampanhaMeta extends Insight { id: string; nome: string; conta: string; resultados: number; custoPorResultado: number | null }
export interface ContaMeta {
  id: string; nome: string; moeda: string | null; status: number | null; statusRotulo: string;
  ok: boolean; erro?: string; semDados: boolean; somada: boolean;
  atual: Insight | null; anterior: Insight | null;
}
export interface MetaResultado {
  geradoEm: string;
  moeda: string;
  contas: ContaMeta[];
  atual: Insight | null;
  anterior: Insight | null;
  serie: PontoMeta[];
  campanhas: CampanhaMeta[];
  avisos: string[];
  /** true quando nenhuma conta trouxe dados no período. */
  semDados: boolean;
}

export type CodigoErroMeta = "nao-configurado" | "token" | "permissao" | "limite" | "rede" | "api";
export class MetaErro extends Error {
  constructor(message: string, public codigo: CodigoErroMeta) { super(message); this.name = "MetaErro"; }
}

// ─── Números e ações ─────────────────────────────────────────────────────────

const num = (v: unknown): number => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };
const arred = (n: number, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };

function valorDaAcao(lista: Array<{ action_type: string; value: string }> | undefined, tipos: string[]): number {
  if (!lista?.length) return 0;
  for (const t of tipos) {
    const a = lista.find((x) => x.action_type === t);
    if (a) return num(a.value);
  }
  return 0;
}

export function parseLinha(r: LinhaBruta): Insight {
  const gasto = num(r.spend), cliques = num(r.clicks), impressoes = num(r.impressions);
  return {
    gasto: arred(gasto), impressoes, alcance: num(r.reach), cliques,
    ctr: impressoes > 0 ? arred((cliques / impressoes) * 100) : null,
    cpc: cliques > 0 ? arred(gasto / cliques) : null,
    leads: valorDaAcao(r.actions, TIPOS_LEAD), conversas: valorDaAcao(r.actions, TIPOS_CONVERSA),
    compras: valorDaAcao(r.actions, TIPOS_COMPRA), valorCompras: arred(valorDaAcao(r.action_values, TIPOS_COMPRA)),
  };
}

export function somarInsights(lista: Insight[]): Insight {
  const t = lista.reduce((a, x) => ({
    gasto: a.gasto + x.gasto, impressoes: a.impressoes + x.impressoes, alcance: a.alcance + x.alcance, cliques: a.cliques + x.cliques,
    leads: a.leads + x.leads, conversas: a.conversas + x.conversas, compras: a.compras + x.compras, valorCompras: a.valorCompras + x.valorCompras,
  }), { gasto: 0, impressoes: 0, alcance: 0, cliques: 0, leads: 0, conversas: 0, compras: 0, valorCompras: 0 });
  return {
    ...t, gasto: arred(t.gasto), valorCompras: arred(t.valorCompras),
    ctr: t.impressoes > 0 ? arred((t.cliques / t.impressoes) * 100) : null,
    cpc: t.cliques > 0 ? arred(t.gasto / t.cliques) : null,
  };
}

/** Leads + conversas iniciadas (o "resultado" de quem anuncia para formulário e WhatsApp). */
export const resultados = (i: Insight) => i.leads + i.conversas;
export const custoPorLead = (i: Insight | null): number | null => (i && resultados(i) > 0 && i.gasto > 0 ? arred(i.gasto / resultados(i)) : null);
export const roas = (i: Insight | null): number | null => (i && i.valorCompras > 0 && i.gasto > 0 ? arred(i.valorCompras / i.gasto) : null);
const temDados = (i: Insight | null) => Boolean(i && (i.gasto > 0 || i.impressoes > 0 || i.cliques > 0));

const STATUS_CONTA: Record<number, string> = { 1: "Ativa", 2: "Desativada", 3: "Com pendência de pagamento", 7: "Em análise de risco", 8: "Em análise", 9: "Período de carência", 100: "Em análise", 101: "Encerrada", 201: "Sem pagamento ativo" };
export const rotuloStatus = (s: number | null) => (s == null ? "Status desconhecido" : STATUS_CONTA[s] ?? `Status ${s}`);

// ─── Provedor real (Graph API, só GET) ───────────────────────────────────────

export interface OpcoesGraph extends Pick<RetryOptions, "sleep" | "fetchImpl" | "baseDelayMs" | "maxDelayMs"> {
  token: string;
  versao?: string;
  /** Tentativas extras para erros transitórios/limite que vêm com HTTP 400 (padrão 3). */
  tentativas?: number;
}

const CODIGOS_TRANSITORIOS = new Set([1, 2, 4, 17, 32, 341, 613]);
const CODIGOS_TOKEN = new Set([102, 190]);
const CODIGOS_PERMISSAO = new Set([10, 200, 294]);

interface ErroGraph { message?: string; code?: number; is_transient?: boolean; error_subcode?: number }
function erroGraph(e: ApiError): ErroGraph {
  const b = e.body as { error?: ErroGraph } | null;
  return b && typeof b === "object" && b.error && typeof b.error === "object" ? b.error : {};
}
const limiteDeUso = (c?: number) => c === 4 || c === 17 || c === 32 || c === 613 || (c != null && c >= 80000 && c <= 80014);

/** Traduz erros da Meta em mensagens curtas em português, sem detalhes internos. */
export function traduzirErroMeta(e: unknown): MetaErro {
  if (e instanceof MetaErro) return e;
  if (e instanceof ApiError) {
    const g = erroGraph(e);
    if (CODIGOS_TOKEN.has(g.code ?? -1) || e.status === 401) return new MetaErro("Token da Meta inválido ou expirado.", "token");
    if (CODIGOS_PERMISSAO.has(g.code ?? -1) || e.status === 403) return new MetaErro("O token da Meta não tem permissão para ler esta conta de anúncios (ads_read).", "permissao");
    if (limiteDeUso(g.code) || e.status === 429) return new MetaErro("A Meta limitou as consultas por agora. Tente novamente em alguns minutos.", "limite");
    return new MetaErro(`A Meta respondeu com erro (${g.code ?? e.status}).`, "api");
  }
  return new MetaErro("Não foi possível falar com a Meta agora.", "rede");
}

export function criarProvedorMeta(o: OpcoesGraph): MetaProvider {
  const versao = o.versao ?? GRAPH_VERSION;
  const tentativas = o.tentativas ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = o.baseDelayMs ?? 500, max = o.maxDelayMs ?? 8000;

  const get = async <T,>(url: string): Promise<T> => {
    // Só GET e só no host da Graph API (inclusive nos links de paginação devolvidos pela Meta).
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== GRAPH_HOST) throw new MetaErro("Endereço inesperado na paginação da Meta.", "api");
    for (let i = 0; ; i++) {
      try {
        return await fetchJson<T>(url, { method: "GET", headers: { Authorization: `Bearer ${o.token}`, Accept: "application/json" } }, { retries: 2, baseDelayMs: base, maxDelayMs: max, sleep, fetchImpl: o.fetchImpl });
      } catch (e) {
        const g = e instanceof ApiError ? erroGraph(e) : null;
        const transitorio = g && (g.is_transient === true || CODIGOS_TRANSITORIOS.has(g.code ?? -1) || limiteDeUso(g.code));
        if (transitorio && i < tentativas) { await sleep(backoffDelay(i, limiteDeUso(g.code) ? base * 4 : base, max * 4)); continue; }
        throw traduzirErroMeta(e);
      }
    }
  };
  const paginar = async <T,>(primeira: string): Promise<T[]> => {
    const out: T[] = [];
    let url: string | undefined = primeira;
    for (let p = 0; url && p < MAX_PAGINAS; p++) {
      const r: { data?: T[]; paging?: { next?: string } } = await get(url);
      out.push(...(r.data ?? []));
      url = r.paging?.next;
    }
    return out;
  };
  const raiz = `https://${GRAPH_HOST}/${versao}`;
  return {
    async listarContas() {
      const qs = new URLSearchParams({ fields: "id,name,account_status,currency", limit: "100" });
      const rows = await paginar<{ id: string; name?: string; account_status?: number; currency?: string }>(`${raiz}/me/adaccounts?${qs}`);
      return rows.map((r) => ({ id: r.id, nome: r.name ?? r.id, moeda: r.currency ?? null, status: typeof r.account_status === "number" ? r.account_status : null }));
    },
    async insights(q) {
      if (!/^act_\d+$/.test(q.contaId)) throw new MetaErro("Identificador de conta inválido.", "api");
      const campos = q.nivel === "campaign" ? `campaign_id,campaign_name,${CAMPOS_INSIGHTS}` : CAMPOS_INSIGHTS;
      const qs = new URLSearchParams({ fields: campos, level: q.nivel, time_range: JSON.stringify({ since: q.de, until: q.ate }), limit: "500" });
      if (q.diario) qs.set("time_increment", "1");
      return paginar<LinhaBruta>(`${raiz}/${q.contaId}/insights?${qs}`);
    },
  };
}

/** Provedor a partir do ambiente. Sem META_ACCESS_TOKEN: erro "nao-configurado" (o painel mostra "Meta sem dados"). */
export function provedorMetaDoAmbiente(env: NodeJS.ProcessEnv = process.env): MetaProvider {
  const token = env.META_ACCESS_TOKEN?.trim();
  if (!token) throw new MetaErro("META_ACCESS_TOKEN não configurado neste ambiente.", "nao-configurado");
  return criarProvedorMeta({ token });
}

// ─── Orquestração: contas → agregados ────────────────────────────────────────

async function emLotes<T, R>(itens: T[], tam: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += tam) out.push(...(await Promise.all(itens.slice(i, i + tam).map(fn))));
  return out;
}

export async function carregarMeta(
  provider: MetaProvider, atual: Intervalo, anterior: Intervalo, agora: () => Date = () => new Date(),
): Promise<MetaResultado> {
  const contasBrutas = (await provider.listarContas()).slice(0, MAX_CONTAS);
  const avisos: string[] = [];
  const porConta = await emLotes(contasBrutas, 3, async (c) => {
    const base: ContaMeta = { id: c.id, nome: c.nome, moeda: c.moeda, status: c.status, statusRotulo: rotuloStatus(c.status), ok: true, semDados: false, somada: true, atual: null, anterior: null };
    const [rAtual, rAnt, rDia, rCamp] = await Promise.allSettled([
      provider.insights({ contaId: c.id, de: atual.de, ate: atual.ate, nivel: "account" }),
      provider.insights({ contaId: c.id, de: anterior.de, ate: anterior.ate, nivel: "account" }),
      provider.insights({ contaId: c.id, de: atual.de, ate: atual.ate, nivel: "account", diario: true }),
      provider.insights({ contaId: c.id, de: atual.de, ate: atual.ate, nivel: "campaign" }),
    ]);
    if (rAtual.status === "rejected") {
      const err = traduzirErroMeta(rAtual.reason);
      return { conta: { ...base, ok: false, erro: err.message, somada: false }, dia: [] as LinhaBruta[], camp: [] as LinhaBruta[], err };
    }
    const insAtual = rAtual.value.length ? somarInsights(rAtual.value.map(parseLinha)) : null;
    const insAnt = rAnt.status === "fulfilled" && rAnt.value.length ? somarInsights(rAnt.value.map(parseLinha)) : null;
    if (rAnt.status === "rejected") avisos.push(`${c.nome}: não foi possível ler o período anterior.`);
    const conta: ContaMeta = { ...base, atual: insAtual, anterior: insAnt, semDados: !temDados(insAtual) && !temDados(insAnt) };
    return { conta, dia: rDia.status === "fulfilled" ? rDia.value : [], camp: rCamp.status === "fulfilled" ? rCamp.value : [], err: null };
  });

  // Mesma moeda para somar: a da conta com mais gasto; as outras ficam fora da soma, com aviso.
  const ok = porConta.filter((p) => p.conta.ok);
  const gastoPorMoeda = new Map<string, number>();
  for (const p of ok) { const m = p.conta.moeda ?? "BRL"; gastoPorMoeda.set(m, (gastoPorMoeda.get(m) ?? 0) + (p.conta.atual?.gasto ?? 0)); }
  const moeda = [...gastoPorMoeda.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "BRL";
  for (const p of ok) {
    if ((p.conta.moeda ?? "BRL") !== moeda) { p.conta.somada = false; avisos.push(`${p.conta.nome}: moeda ${p.conta.moeda} diferente de ${moeda}; não entra nos totais.`); }
  }
  const somadas = ok.filter((p) => p.conta.somada);
  const atuais = somadas.map((p) => p.conta.atual).filter((x): x is Insight => Boolean(x));
  const anteriores = somadas.map((p) => p.conta.anterior).filter((x): x is Insight => Boolean(x));
  if (somadas.length > 1) avisos.push("Alcance somado entre contas pode contar a mesma pessoa mais de uma vez.");

  // Série diária (soma das contas somadas)
  const dias = listarDias(atual.de, atual.ate);
  const serieMap = new Map<string, PontoMeta>(dias.map((d) => [d, { data: d, gasto: 0, impressoes: 0, cliques: 0, resultados: 0 }]));
  for (const p of somadas) for (const r of p.dia) {
    const d = r.date_start, pt = d ? serieMap.get(d) : undefined;
    if (!pt) continue;
    const i = parseLinha(r);
    pt.gasto = arred(pt.gasto + i.gasto); pt.impressoes += i.impressoes; pt.cliques += i.cliques; pt.resultados += resultados(i);
  }

  // Campanhas: ranking por gasto
  const campanhas: CampanhaMeta[] = [];
  for (const p of somadas) for (const r of p.camp) {
    const i = parseLinha(r);
    const res = resultados(i);
    campanhas.push({ ...i, id: r.campaign_id ?? r.campaign_name ?? "?", nome: r.campaign_name ?? "(sem nome)", conta: p.conta.nome, resultados: res, custoPorResultado: res > 0 && i.gasto > 0 ? arred(i.gasto / res) : null });
  }
  campanhas.sort((a, b) => b.gasto - a.gasto);

  const falhas = porConta.filter((p) => !p.conta.ok);
  // Se TODAS as contas falharam pelo mesmo motivo estrutural (token/permissão/limite), é erro da fonte, não "sem dados".
  if (contasBrutas.length > 0 && falhas.length === contasBrutas.length && falhas[0].err && ["token", "permissao", "limite"].includes(falhas[0].err.codigo)) throw falhas[0].err;
  for (const f of falhas) avisos.push(`${f.conta.nome}: ${f.conta.erro}`);

  const totalAtual = atuais.length ? somarInsights(atuais) : null;
  return {
    geradoEm: agora().toISOString(), moeda, contas: porConta.map((p) => p.conta),
    atual: totalAtual, anterior: anteriores.length ? somarInsights(anteriores) : null,
    serie: [...serieMap.values()], campanhas: campanhas.slice(0, 15), avisos,
    semDados: !temDados(totalAtual),
  };
}

/** Com cache de ~15 min (memória + Postgres) e, se a Meta falhar, o último valor guardado marcado como desatualizado. */
export async function carregarMetaComCache(
  provider: MetaProvider, atual: Intervalo, anterior: Intervalo, store: CacheStore = cacheCompartilhado, agora: () => number = Date.now,
): Promise<{ dados: MetaResultado; desatualizado: boolean; geradoEm: number }> {
  const r = await comCache(store, `meta:${GRAPH_VERSION}:${atual.de}:${atual.ate}`, TTL_META_MS, () => carregarMeta(provider, atual, anterior, () => new Date(agora())), agora);
  return { dados: r.valor, desatualizado: r.desatualizado, geradoEm: r.geradoEm };
}
