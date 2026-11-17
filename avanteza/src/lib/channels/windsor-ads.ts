// Anúncios (Meta Ads) pelo Windsor.ai, conector `facebook` (somente leitura). SEGUNDA opção de fonte de anúncios: serve quando o token da Meta
// não enxerga a conta (ex.: conta que pertence ao perfil pessoal do dono, fora do Business do usuário do sistema), mas o Windsor enxerga.
// Produz o MESMO formato do Graph (InsightBruto/AnuncioInfo), então o coletor, o snapshot (campaign_daily/ad_daily) e as telas não mudam;
// só o `source` gravado (windsor) diferencia. Campos verificados no conector facebook: campaign, campaign_id, ad_id, ad_name, spend, impressions,
// reach, clicks, ctr, cpc, frequency, date, account_id, account_name, status, effective_status, thumbnail_url e
// actions_onsite_conversion_messaging_conversation_started_7d.
//
//   GET https://connectors.windsor.ai/facebook?date_from=…&date_to=…&fields=a,b,c&api_key=<chave>   →   { "data": [ {…}, … ] }
//
// A chave só vive na URL da chamada; toda mensagem passa por `esconderChave`. Erros do Windsor viram texto claro em português.
import { addDays } from "@/lib/dates";
import { fetchJson } from "@/lib/http";
import { safeImageUrl } from "@/lib/marketplaces/images";
import { WINDSOR_HOST, WindsorErro, criarConsulta, esconderChave, traduzir, type Intervalo, type Linha, type OpcoesWindsor } from "./windsor";
import { RESULTADO_PADRAO, type AnuncioInfo, type CanaisApi, type InsightBruto } from "./types";

export const CONECTOR_ADS = "facebook";
/** Pedaço de CanaisApi que o coletor de anúncios usa. A Meta (Graph) e o Windsor implementam o mesmo contrato. */
export type FonteAnunciosApi = Pick<CanaisApi, "insightsDiarios" | "anuncios">;

export interface OpcoesWindsorAds extends OpcoesWindsor {
  /** Conta de anúncios (com ou sem act_). Filtra por account_id; sem ela, mais de uma conta no Windsor é recusado (nada é misturado). */
  contaId?: string | null;
  campaignIds?: string[];
  /** action_type escolhido como resultado (padrão: conversas iniciadas, 7 dias). */
  resultActionType?: string;
}

export interface ResultadoTesteWindsorAds {
  ok: boolean;
  origemChave: "canal" | "plataforma" | "nenhuma";
  /** Conector Facebook Ads ainda não ligado no Windsor desta chave (no_accounts_configured). O cliente segue em “Conectando anúncios”. */
  semConector: boolean;
  verificacoes: Array<{ id: string; rotulo: string; ok: boolean | null; detalhe: string }>;
  info: { contas: Array<{ id: string; nome: string | null }>; campanhas: Array<{ id: string; nome: string }>; anuncios: number; gasto: number | null; resultados: number | null; comMiniatura: number };
}

export interface FonteWindsorAds extends FonteAnunciosApi {
  testar(): Promise<ResultadoTesteWindsorAds>;
}

/** Nome do campo do Windsor para um action_type da Meta: onsite_conversion.messaging_conversation_started_7d → actions_onsite_conversion_messaging_conversation_started_7d. */
export const campoResultado = (tipo: string): string => `actions_${tipo.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;

const CAMPOS_BASE = ["date", "account_id", "account_name", "campaign_id", "campaign", "spend", "impressions", "reach", "clicks", "ctr", "cpc", "frequency"] as const;
const CAMPOS_ANUNCIO = ["ad_id", "ad_name", "thumbnail_url"] as const;
const CAMPOS_STATUS = ["ad_id", "ad_name", "campaign_id", "account_id", "status", "effective_status", "thumbnail_url"] as const;

const semAct = (s: string) => s.trim().replace(/^act_/i, "");
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const numTxt = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return v.trim();
  return undefined;
};
const diaDe = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

export function criarWindsorAds(o: OpcoesWindsorAds): FonteWindsorAds {
  const consultar = criarConsulta(o, CONECTOR_ADS);
  const alvoConta = o.contaId?.trim() ? semAct(o.contaId) : null;
  const campanhasAlvo = o.campaignIds ?? [];
  const tipo = o.resultActionType || RESULTADO_PADRAO;
  const campoRes = campoResultado(tipo);
  /** Miniaturas vistas nas consultas de insights (por ad_id), reaproveitadas em `anuncios`. */
  const miniaturas = new Map<string, { nome: string | null; campanha: string | null; thumb: string | null }>();
  let ultimoAd: Linha[] | null = null;

  /** Filtra pela conta (account_id) e, sem conta informada, recusa mais de uma conta em vez de misturar. */
  function porConta(linhas: Linha[]): { linhas: Linha[]; contas: Array<{ id: string; nome: string | null }> } {
    const mapa = new Map<string, string | null>();
    for (const l of linhas) { const id = txt(l.account_id); if (id) mapa.set(semAct(id), txt(l.account_name) ?? mapa.get(semAct(id)) ?? null); }
    const contas = [...mapa.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.id.localeCompare(b.id));
    if (!contas.length) return { linhas, contas };
    const desc = contas.map((c) => `${c.nome ? `${c.nome} · ` : ""}${c.id}`).join(", ");
    if (alvoConta) {
      if (!mapa.has(alvoConta)) throw new WindsorErro(`O Windsor.ai não enxerga a conta de anúncios ${alvoConta}. Contas disponíveis nesta chave: ${desc}.`, "conta");
      return { linhas: linhas.filter((l) => { const id = txt(l.account_id); return id ? semAct(id) === alvoConta : false; }), contas };
    }
    if (contas.length > 1) throw new WindsorErro(`O Windsor.ai devolveu ${contas.length} contas de anúncios (${desc}). Informe a conta de anúncios do cliente para escolher qual usar.`, "varias_contas");
    return { linhas, contas };
  }
  const porCampanha = (linhas: Linha[]) => (campanhasAlvo.length ? linhas.filter((l) => campanhasAlvo.includes(txt(l.campaign_id) ?? "")) : linhas);

  function paraInsight(l: Linha, nivel: "campaign" | "ad"): InsightBruto | null {
    const d = diaDe(l.date), campanha = txt(l.campaign_id);
    if (!d || !campanha) return null;
    const r: InsightBruto = { campaign_id: campanha, campaign_name: txt(l.campaign) ?? undefined, date_start: d, date_stop: d };
    if (nivel === "ad") { const a = txt(l.ad_id); if (!a) return null; r.ad_id = a; r.ad_name = txt(l.ad_name) ?? undefined; }
    r.spend = numTxt(l.spend); r.impressions = numTxt(l.impressions); r.reach = numTxt(l.reach); r.clicks = numTxt(l.clicks);
    r.ctr = numTxt(l.ctr); r.cpc = numTxt(l.cpc); r.frequency = numTxt(l.frequency);
    const res = numTxt(l[campoRes]);
    if (res !== undefined) r.actions = [{ action_type: tipo, value: res }];
    return r;
  }

  /** Dias em que uma linha pode ser repetida (várias linhas por dia/anúncio): o Windsor devolve uma linha por dia; se vier mais de uma, soma. */
  function juntar(lista: InsightBruto[], nivel: "campaign" | "ad"): InsightBruto[] {
    const mapa = new Map<string, InsightBruto>();
    for (const x of lista) {
      const k = `${x.date_start}|${nivel === "ad" ? x.ad_id : x.campaign_id}`;
      const a = mapa.get(k);
      if (!a) { mapa.set(k, { ...x }); continue; }
      for (const c of ["spend", "impressions", "reach", "clicks"] as const) if (x[c] !== undefined) a[c] = String(Number(a[c] ?? 0) + Number(x[c]));
      if (x.actions?.[0]) a.actions = [{ action_type: tipo, value: String(Number(a.actions?.[0]?.value ?? 0) + Number(x.actions[0].value)) }];
    }
    return [...mapa.values()];
  }

  async function insightsDiarios(p: { contaId: string; nivel: "campaign" | "ad"; de: string; ate: string; campanhas: string[] }): Promise<InsightBruto[]> {
    const campos = p.nivel === "ad" ? [...CAMPOS_BASE, ...CAMPOS_ANUNCIO, campoRes] : [...CAMPOS_BASE, campoRes];
    const bruto = await consultar(campos, { de: p.de, ate: p.ate });
    const { linhas } = porConta(bruto);
    const filtradas = porCampanha(linhas);
    if (p.nivel === "ad") {
      ultimoAd = filtradas;
      for (const l of filtradas) {
        const id = txt(l.ad_id); if (!id) continue;
        const ant = miniaturas.get(id);
        miniaturas.set(id, { nome: txt(l.ad_name) ?? ant?.nome ?? null, campanha: txt(l.campaign_id) ?? ant?.campanha ?? null, thumb: safeImageUrl(l.thumbnail_url) ?? ant?.thumb ?? null });
      }
    }
    return juntar(filtradas.map((l) => paraInsight(l, p.nivel)).filter((x): x is InsightBruto => x !== null), p.nivel);
  }

  async function anuncios(_p: { contaId: string; campanhas: string[] }): Promise<AnuncioInfo[]> {
    if (!ultimoAd) await insightsDiarios({ contaId: o.contaId ?? "", nivel: "ad", ...janela30(), campanhas: campanhasAlvo });
    // Status vem em consulta própria (sem data): se falhar, os criativos seguem só com nome e miniatura.
    const status = new Map<string, { status: string | null; efetivo: string | null; thumb: string | null }>();
    try {
      const bruto = await consultar(CAMPOS_STATUS, { preset: "last_30d" });
      for (const l of porCampanha(porConta(bruto).linhas)) {
        const id = txt(l.ad_id); if (!id) continue;
        status.set(id, { status: txt(l.status), efetivo: txt(l.effective_status), thumb: safeImageUrl(l.thumbnail_url) });
      }
    } catch (e) { if (e instanceof WindsorErro && (e.codigo === "chave" || e.codigo === "sem_contas" || e.codigo === "conta" || e.codigo === "varias_contas")) throw e; }
    const ids = new Set([...miniaturas.keys(), ...status.keys()]);
    return [...ids].map((id) => {
      const m = miniaturas.get(id), s = status.get(id);
      return { id, nome: m?.nome ?? id, campanhaId: m?.campanha ?? null, status: s?.status ?? null, statusEfetivo: s?.efetivo ?? null, thumb: s?.thumb ?? m?.thumb ?? null, imagem: null, videoId: null };
    });
  }

  async function testar(): Promise<ResultadoTesteWindsorAds> {
    const v: ResultadoTesteWindsorAds["verificacoes"] = [];
    const info: ResultadoTesteWindsorAds["info"] = { contas: [], campanhas: [], anuncios: 0, gasto: null, resultados: null, comMiniatura: 0 };
    const add = (id: string, rotulo: string, ok: boolean | null, detalhe: string) => v.push({ id, rotulo, ok, detalhe: esconderChave(detalhe, o.chave) });
    let semConector = false;
    const fim = (): ResultadoTesteWindsorAds => ({ ok: v.every((x) => x.ok !== false), origemChave: "nenhuma", semConector, verificacoes: v, info });
    const intervalo: Intervalo = { preset: "last_30d" };

    let bruto: Linha[];
    try {
      bruto = await consultar(["date", "account_id", "account_name", "campaign_id", "campaign", "spend"], intervalo);
      add("chave", "Chave aceita pelo Windsor.ai", true, "O Windsor.ai respondeu à consulta de anúncios (conector facebook).");
    } catch (e) {
      const w = traduzir(e, o.chave, CONECTOR_ADS);
      semConector = w.codigo === "sem_contas";
      add(semConector ? "conector" : "chave", semConector ? "Facebook Ads no Windsor.ai" : "Chave aceita pelo Windsor.ai", false, w.message);
      return fim();
    }
    const conhecidos = await listarCamposAds(o);
    if (conhecidos) {
      const faltamCampos = [...CAMPOS_BASE, ...CAMPOS_ANUNCIO, ...CAMPOS_STATUS, campoRes].filter((c, i, a) => a.indexOf(c) === i && !conhecidos.includes(c));
      add("campos", "Campos do conector facebook", faltamCampos.length === 0 ? true : null, faltamCampos.length ? `Campos que o Windsor não lista (podem falhar na coleta): ${faltamCampos.join(", ")}.` : "Todos os campos usados existem no conector.");
    }
    const contasAll = porContaSemFiltro(bruto);
    info.contas = contasAll;
    if (!contasAll.length) {
      add("contas", "Contas de anúncios no Windsor.ai", false, bruto.length ? "As linhas não trazem account_id; não dá para identificar a conta." : "O Windsor.ai respondeu sem nenhuma linha de anúncios nos últimos 30 dias. Confira se a conta de anúncios está conectada ao Facebook Ads no Windsor.");
      return fim();
    }
    add("contas", "Contas de anúncios no Windsor.ai", true, `${contasAll.length} conta(s): ${contasAll.map((c) => `${c.nome ? `${c.nome} · ` : ""}${c.id}`).join(", ")}.`);
    let linhas: Linha[];
    try {
      linhas = porConta(bruto).linhas;
      add("conta_filtro", "Conta de anúncios do cliente", alvoConta ? true : null, alvoConta ? `A conta ${alvoConta} foi encontrada.` : "Não informada; há uma só conta, então ela será usada.");
    } catch (e) { add("conta_filtro", "Conta de anúncios do cliente", false, traduzir(e, o.chave, CONECTOR_ADS).message); return fim(); }
    const camp = new Map<string, string>();
    for (const l of linhas) { const id = txt(l.campaign_id); if (id) camp.set(id, txt(l.campaign) ?? id); }
    info.campanhas = [...camp.entries()].map(([id, nome]) => ({ id, nome }));
    const faltam = campanhasAlvo.filter((c) => !camp.has(c));
    add("campanhas", "Campanhas", info.campanhas.length > 0 && faltam.length === 0 ? true : false,
      !info.campanhas.length ? "Nenhuma campanha com entrega nos últimos 30 dias nesta conta." : faltam.length ? `Campanha(s) ${faltam.join(", ")} não encontrada(s) nos últimos 30 dias. Encontradas: ${info.campanhas.map((c) => `${c.nome} (${c.id})`).join("; ")}.` : `${info.campanhas.length} campanha(s): ${info.campanhas.map((c) => `${c.nome} (${c.id})`).join("; ")}.`);
    try {
      const ads = await insightsDiarios({ contaId: o.contaId ?? "", nivel: "ad", ...janela30(), campanhas: campanhasAlvo });
      const ids = new Set(ads.map((a) => a.ad_id));
      info.anuncios = ids.size;
      info.gasto = Math.round(ads.reduce((a, x) => a + Number(x.spend ?? 0), 0) * 100) / 100;
      info.resultados = ads.reduce((a, x) => a + Number(x.actions?.[0]?.value ?? 0), 0);
      info.comMiniatura = [...ids].filter((id) => id && miniaturas.get(id)?.thumb).length;
      add("insights", "Anúncios e resultados (30 dias)", ads.length > 0, ads.length ? `${ids.size} anúncio(s), gasto R$ ${info.gasto!.toFixed(2).replace(".", ",")}, ${info.resultados} resultado(s) (${campoRes}), ${info.comMiniatura} com miniatura.` : "Nenhum anúncio com entrega nos últimos 30 dias.");
    } catch (e) { add("insights", "Anúncios e resultados (30 dias)", false, traduzir(e, o.chave, CONECTOR_ADS).message); }
    return fim();
  }

  return { testar, insightsDiarios, anuncios };

  function janela30() { const hoje = new Date().toISOString().slice(0, 10); return { de: addDays(hoje, -29), ate: hoje }; }
  function porContaSemFiltro(linhas: Linha[]) {
    const mapa = new Map<string, string | null>();
    for (const l of linhas) { const id = txt(l.account_id); if (id) mapa.set(semAct(id), txt(l.account_name) ?? mapa.get(semAct(id)) ?? null); }
    return [...mapa.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.id.localeCompare(b.id));
  }
}

/** Lista de campos do conector facebook (GET /facebook/fields), para o administrador conferir nomes. Falha = null. */
export async function listarCamposAds(o: Pick<OpcoesWindsor, "chave" | "fetchImpl" | "sleep">): Promise<string[] | null> {
  try {
    const qs = new URLSearchParams({ api_key: o.chave });
    const corpo = await fetchJson<unknown>(`https://${WINDSOR_HOST}/${CONECTOR_ADS}/fields?${qs.toString()}`, { method: "GET", headers: { Accept: "application/json" } }, { retries: 1, baseDelayMs: 300, maxDelayMs: 2000, sleep: o.sleep, fetchImpl: o.fetchImpl });
    const itens: unknown[] = Array.isArray(corpo) ? corpo : corpo && typeof corpo === "object" ? (Array.isArray((corpo as any).data) ? (corpo as any).data : Object.keys(corpo as object)) : [];
    const nomes = itens.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as any).id ?? (x as any).name ?? (x as any).field : null)).filter((x): x is string => typeof x === "string");
    return nomes.length ? nomes : null;
  } catch { return null; }
}
