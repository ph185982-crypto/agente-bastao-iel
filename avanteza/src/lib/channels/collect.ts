// Coletor dos canais (somente leitura) e gravação em channel_snapshots (upsert). Um canal por vez, com tempo máximo.
// DUAS FONTES INDEPENDENTES: (1) anúncios = Meta Ads; (2) Instagram = Windsor.ai (ou, opcionalmente, Meta Graph). Cada fonte tem credencial,
// status e erro próprios (last_*  = anúncios; ig_last_* = Instagram) e falha sozinha: o que deu certo é gravado e nada é somado entre fontes.
// Dentro de cada fonte, cada parte (campanhas, anúncios, perfil, mídias…) também falha sozinha.
import { addDays, spDate } from "@/lib/dates";
import { listarDias } from "@/lib/dashboards/periodo";
import { MetaErro } from "@/lib/dashboards/meta";
import { esconderToken } from "./graph";
import { WindsorErro, esconderChave, type FonteWindsor } from "./windsor";
import type { FonteAnunciosApi } from "./windsor-ads";
import { campanhaPassa } from "./campanhas";
import { linkMetaSeguro } from "./links";
import { datasComIgDiario, gravarSnapshots, listarCanaisParaColeta, marcarColeta, configDe, type CanalRow, type FonteColeta, type SnapshotEntrada } from "./store";
import {
  DIAS_BACKFILL, DIAS_ROTINA, DIMENSOES_QUEBRA, IG_METRICAS_DIA,
  type MetricasQuebra, type MetricasSegmentacao, type OrigemDado, type AnuncioInfo, type CanaisApi, type CanalConfig, type IgMetricaDia, type InsightBruto, type IgMidiaBruta, type MetricasAnuncioDia, type MetricasCampanhaDia, type MetricasIgDia, type MetricasIgMidia,
} from "./types";

const num = (v: unknown): number => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };
const arred = (n: number, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** Resultados = valor da ação escolhida (padrão: conversas iniciadas no WhatsApp em 7 dias). */
export function resultadoDaLinha(r: InsightBruto, tipo: string): number {
  const a = r.actions?.find((x) => x.action_type === tipo);
  return a ? num(a.value) : 0;
}

export function metricasDaLinha(r: InsightBruto, tipo: string, nome: string): MetricasCampanhaDia {
  const spend = arred(num(r.spend)), impressions = num(r.impressions), clicks = num(r.clicks);
  return {
    nome, spend, impressions, reach: num(r.reach), clicks,
    ctr: impressions > 0 ? arred((clicks / impressions) * 100) : null,
    cpc: clicks > 0 ? arred(spend / clicks) : null,
    frequency: r.frequency != null && r.frequency !== "" ? arred(num(r.frequency)) : null,
    results: resultadoDaLinha(r, tipo),
  };
}


export interface OpcoesColeta {
  hoje?: string;
  /** Janela de campanhas/anúncios (e das mídias da Meta), em dias terminando hoje. */
  dias: number;
  /** Janela do Instagram (backfill de 90 dias na primeira coleta do Instagram). Padrão: `dias`. */
  diasIg?: number;
  /** Tempo máximo desta coleta, em ms. */
  maxMs: number;
  agora?: () => number;
  /** Quais fontes coletar (padrão: as duas). Cada uma é independente. */
  fontes?: FonteColeta[];
  /** Coleta leve (alerta de recarga): só o nível de campanha dos anúncios, sem anúncios/criativos. */
  soCampanhas?: boolean;
}
export interface ResultadoFonte {
  fonte: FonteColeta; origem: OrigemDado | null;
  /** Rodou de fato (false = pulada, p. ex. sem credencial ou não configurada). */
  executada: boolean; motivoPulo?: string;
  ok: boolean; linhas: Record<string, number>; avisos: string[]; erro: string | null; parcial: boolean;
}
export interface ResultadoColeta {
  clientId: string;
  /** Pelo menos uma fonte coletou com sucesso. */
  ok: boolean; linhas: Record<string, number>; avisos: string[]; erro: string | null; ms: number; parcial: boolean;
  ads: ResultadoFonte | null; instagram: ResultadoFonte | null;
}

/** Credenciais por fonte. Anúncios e Instagram-Meta usam `meta`; Instagram-Windsor usa `windsor`. */
export interface CredenciaisColeta {
  meta?: { api: CanaisApi; token: string | null } | null;
  windsor?: { fonte: FonteWindsor; chave: string | null } | null;
  /** Anúncios pelo Windsor.ai (conector facebook). */
  windsorAds?: { api: FonteAnunciosApi; chave: string | null } | null;
}

/** Mensagem curta e segura (nunca o token nem a chave) para guardar em last_error. */
export function mensagemSegura(e: unknown, segredo?: string | null): string {
  const base = e instanceof WindsorErro || e instanceof MetaErro ? e.message : "Falha inesperada na coleta.";
  return esconderChave(esconderToken(base, segredo), segredo).slice(0, 240);
}

/** Linhas ig_media (as mesmas, venham da Meta ou do Windsor). */
export function linhasDeMidias(midias: IgMidiaBruta[]): SnapshotEntrada[] {
  return midias.map((m) => {
    const v: MetricasIgMidia = {
      type: m.tipo, product: m.produto, caption: m.legenda, permalink: m.permalink, thumb: m.thumb, timestamp: m.timestamp,
      likes: m.likes, comments: m.comentarios, reach: m.alcance, saved: m.salvos, shares: m.compartilhamentos, views: m.views, interactions: m.interacoes,
    };
    return { kind: "ig_media" as const, date: spDate(new Date(m.timestamp)), key: m.id, metrics: { ...v } };
  });
}

interface Rastreio { avisos: string[]; falhas: string[]; sucessos: number; parcial: boolean; linhas: Record<string, number> }
const novoRastreio = (): Rastreio => ({ avisos: [], falhas: [], sucessos: 0, parcial: false, linhas: {} });

function executor(r: Rastreio, restante: () => number, segredo?: string | null) {
  return async (nome: string, fn: () => Promise<void>) => {
    if (restante() <= 0) { r.parcial = true; r.avisos.push(`${nome}: tempo esgotado; continua na próxima atualização.`); return; }
    try { await fn(); r.sucessos++; }
    catch (e) { const t = `${nome}: ${mensagemSegura(e, segredo)}`; r.avisos.push(t); r.falhas.push(t); }
  };
}

const fechar = (fonte: FonteColeta, origem: OrigemDado | null, r: Rastreio): ResultadoFonte => ({
  fonte, origem, executada: true, ok: r.sucessos > 0, linhas: r.linhas, avisos: r.avisos, erro: r.falhas.length ? r.falhas.join(" · ").slice(0, 480) : null, parcial: r.parcial,
});
const pulada = (fonte: FonteColeta, motivo: string): ResultadoFonte => ({ fonte, origem: null, executada: false, motivoPulo: motivo, ok: false, linhas: {}, avisos: [], erro: null, parcial: false });

// ─── Fonte 1: anúncios (Meta Ads) ────────────────────────────────────────────

async function coletarAnuncios(cfg: CanalConfig, api: FonteAnunciosApi, token: string | null | undefined, de: string, hoje: string, restante: () => number, origem: OrigemDado = "meta", soCampanhas = false): Promise<{ r: Rastreio; info: Record<string, unknown> }> {
  const r = novoRastreio();
  const parte = executor(r, restante, token);
  const conta = cfg.adAccountId!;
  // Filtro do canal (ids e nome) aplicado também aqui, seja qual for a fonte: campanha de outro projeto nunca é gravada.
  const filtro = { campaignIds: cfg.campaignIds, campaignNameFilter: cfg.campaignNameFilter ?? null };
  const aceitas = new Set<string>();
  await parte("Campanhas", async () => {
    const bruto = await api.insightsDiarios({ contaId: conta, nivel: "campaign", de, ate: hoje, campanhas: cfg.campaignIds });
    const rows: SnapshotEntrada[] = [];
    for (const x of bruto) {
      if (!x.date_start || !x.campaign_id) continue;
      if (!campanhaPassa(x.campaign_id, x.campaign_name, filtro)) continue;
      aceitas.add(x.campaign_id);
      rows.push({ kind: "campaign_daily", date: x.date_start, key: x.campaign_id, metrics: { ...metricasDaLinha(x, cfg.resultActionType, x.campaign_name ?? x.campaign_id) } });
    }
    r.linhas.campaign_daily = await gravarSnapshots(cfg.clientId, rows, origem);
  });
  await coletarPublico(cfg, api, token, de, hoje, restante, origem, filtro, aceitas, r);
  if (soCampanhas) return { r, info: {} };
  await parte("Anúncios", async () => {
    const bruto = (await api.insightsDiarios({ contaId: conta, nivel: "ad", de, ate: hoje, campanhas: cfg.campaignIds }))
      .filter((x) => (x.campaign_name ? campanhaPassa(x.campaign_id, x.campaign_name, filtro) : !filtro.campaignNameFilter || aceitas.has(String(x.campaign_id ?? ""))));
    let infos: AnuncioInfo[] = [];
    try { infos = await api.anuncios({ contaId: conta, campanhas: cfg.campaignIds }); }
    catch (e) { r.avisos.push(`Criativos: ${mensagemSegura(e, token)}`); }
    const porId = new Map(infos.map((a) => [a.id, a]));
    const rows: SnapshotEntrada[] = [];
    for (const x of bruto as InsightBruto[]) {
      if (!x.date_start || !x.ad_id) continue;
      const a = porId.get(x.ad_id);
      const m: MetricasAnuncioDia = {
        ...metricasDaLinha(x, cfg.resultActionType, x.ad_name ?? a?.nome ?? x.ad_id),
        campaign_id: x.campaign_id, campaign_name: x.campaign_name,
        ...(a ? { status: a.status, effective_status: a.statusEfetivo, thumb: a.thumb, image: a.imagem, video_id: a.videoId } : {}),
        ...(a ? criativoDe(a) : {}),
      };
      rows.push({ kind: "ad_daily", date: x.date_start, key: x.ad_id, metrics: { ...m } });
    }
    r.linhas.ad_daily = await gravarSnapshots(cfg.clientId, rows, origem);
  });
  return { r, info: {} };
}

/** Conjunto e criativo (título, texto, CTA, links) do anúncio — só o que veio; links já sanitizados na fonte e de novo aqui. */
function criativoDe(a: AnuncioInfo): Partial<MetricasAnuncioDia> {
  const m: Partial<MetricasAnuncioDia> = {};
  if (a.conjuntoId) m.adset_id = a.conjuntoId;
  if (a.conjuntoNome) m.adset_name = a.conjuntoNome;
  if (a.titulo) m.title = a.titulo.slice(0, 300);
  if (a.texto) m.body = a.texto.slice(0, 3000);
  if (a.cta) m.cta = a.cta.slice(0, 60);
  const previa = linkMetaSeguro(a.previa), ig = linkMetaSeguro(a.instagram);
  if (previa) m.preview_url = previa;
  if (ig) m.ig_url = ig;
  return m;
}

/** Chave estável de um corte: dimensão, campanha e valores (ex.: "idade_genero|120…|25-34|male"). */
export const chaveQuebra = (q: Pick<MetricasQuebra, "dimensao" | "campaign_id" | "idade" | "genero" | "regiao" | "plataforma" | "posicao">) =>
  [q.dimensao, q.campaign_id, ...(q.dimensao === "idade_genero" ? [q.idade ?? "?", q.genero ?? "?"] : q.dimensao === "regiao" ? [q.regiao ?? "?"] : [q.plataforma ?? "?", q.posicao ?? "?"])].join("|").slice(0, 300);

/**
 * Público e localização (extra dos anúncios): um corte por consulta (idade×gênero, região, posicionamento) e a segmentação dos conjuntos.
 * Mesmo filtro de campanhas. Falha aqui vira AVISO (não derruba nem marca erro nos anúncios): é um complemento.
 */
async function coletarPublico(cfg: CanalConfig, api: FonteAnunciosApi, segredo: string | null | undefined, de: string, hoje: string, restante: () => number, origem: OrigemDado, filtro: { campaignIds: string[]; campaignNameFilter: string | null }, aceitas: Set<string>, r: Rastreio) {
  const passa = (id: string | null | undefined, nome: string | null | undefined) => (nome ? campanhaPassa(id, nome, filtro) : !filtro.campaignNameFilter || aceitas.has(String(id ?? "")));
  const conta = cfg.adAccountId!;
  if (api.quebras) {
    const rows: SnapshotEntrada[] = [];
    for (const dimensao of DIMENSOES_QUEBRA) {
      if (restante() <= 2_000) { r.parcial = true; r.avisos.push("Público e localização: tempo esgotado; continua na próxima atualização."); break; }
      try {
        const lista = await api.quebras({ contaId: conta, dimensao, de, ate: hoje, campanhas: cfg.campaignIds, tipo: cfg.resultActionType });
        for (const q of lista) {
          if (!q.date || q.date > hoje || !passa(q.campaign_id, q.campaign_name)) continue;
          const m: MetricasQuebra = { ...q, spend: arred(q.spend) };
          delete (m as any).date;
          rows.push({ kind: "ads_breakdown", date: q.date, key: chaveQuebra(q), metrics: { ...m } });
        }
      } catch (e) { r.avisos.push(`Público (${dimensao.replace("_", " × ")}): ${mensagemSegura(e, segredo)}`); }
    }
    if (rows.length) r.linhas.ads_breakdown = await gravarSnapshots(cfg.clientId, rows, origem);
  }
  if (api.segmentacoes && restante() > 2_000) {
    try {
      const lista = await api.segmentacoes({ contaId: conta, campanhas: cfg.campaignIds, de, ate: hoje });
      const rows: SnapshotEntrada[] = lista.filter((s) => passa(s.campaignId, s.campaignNome)).map((s) => {
        const m: MetricasSegmentacao = { adset_name: s.adsetNome, campaign_id: s.campaignId, campaign_name: s.campaignNome, status: s.status, targeting: s.targeting };
        return { kind: "adset_targeting" as const, date: hoje, key: (s.adsetId ?? `nome:${s.adsetNome}`).slice(0, 300), metrics: { ...m } };
      });
      if (rows.length) r.linhas.adset_targeting = await gravarSnapshots(cfg.clientId, rows, origem);
    } catch (e) { r.avisos.push(`Segmentação dos conjuntos: ${mensagemSegura(e, segredo)}`); }
  }
}

// ─── Fonte 2a: Instagram pelo Windsor.ai ─────────────────────────────────────

async function coletarInstagramWindsor(cfg: CanalConfig, fonte: FonteWindsor, chave: string | null | undefined, de: string, hoje: string, restante: () => number): Promise<{ r: Rastreio; info: Record<string, unknown> }> {
  const r = novoRastreio();
  const info: Record<string, unknown> = {};
  const parte = executor(r, restante, chave);
  const ontem = addDays(hoje, -1);
  await parte("Instagram (perfil)", async () => {
    const p = await fonte.perfil({ de, ate: hoje });
    for (const a of p.avisos ?? []) r.avisos.push(esconderChave(a, chave).slice(0, 200));
    if (p.conta) info.ig_username = p.conta.replace(/^@/, "");
    const porDia = new Map<string, Record<string, unknown>>();
    for (const d of p.dias) {
      if (d.date > hoje) continue;
      const m: Record<string, unknown> = { ...d.metrics };
      // O dia em andamento ainda não fechou: só entram seguidores (atuais e saldo parcial), nunca um alcance/visualizações incompletos.
      if (d.date >= hoje) for (const k of IG_METRICAS_DIA) delete m[k];
      if (Object.keys(m).length) porDia.set(d.date, m);
    }
    // Métricas que nenhum dia trouxe (null em todas as linhas) = indisponíveis para este perfil. Gravado sempre (inclusive vazio) para o último valor valer.
    const completos = p.dias.filter((d) => d.date <= ontem);
    const indisp = completos.length ? IG_METRICAS_DIA.filter((k) => !completos.some((d) => d.metrics[k] != null)) : [];
    if (completos.length) { info.ig_indisponiveis = indisp; porDia.set(ontem, { ...(porDia.get(ontem) ?? {}), indisponiveis: indisp }); }
    const rows: SnapshotEntrada[] = [...porDia.entries()].map(([date, metrics]) => ({ kind: "ig_daily" as const, date, key: "account", metrics }));
    r.linhas.ig_daily = await gravarSnapshots(cfg.clientId, rows, "windsor");
  });
  await parte("Instagram (mídias)", async () => {
    const midias = await fonte.midias({ de, ate: hoje }, 40);
    r.linhas.ig_media = await gravarSnapshots(cfg.clientId, linhasDeMidias(midias), "windsor");
  });
  if (restante() > 0) {
    // Audiência é um extra: se o Windsor não a entregar, vira aviso e não derruba o resto do Instagram.
    try {
      const a = await fonte.audiencia();
      if (Object.keys(a.dados).length) r.linhas.ig_audience = await gravarSnapshots(cfg.clientId, [{ kind: "ig_audience", date: hoje, key: "account", metrics: { ...a.dados } }], "windsor");
      for (const e of a.erros) r.avisos.push(`Audiência: ${esconderChave(e, chave).slice(0, 160)}`);
    } catch (e) { r.avisos.push(`Audiência: ${mensagemSegura(e, chave)}`); }
  }
  return { r, info };
}

// ─── Fonte 2b: Instagram pela Meta Graph (opcional) ──────────────────────────

async function coletarInstagramMeta(cfg: CanalConfig, api: CanaisApi, token: string | null | undefined, de: string, hoje: string, restante: () => number): Promise<{ r: Rastreio; info: Record<string, unknown> }> {
  const r = novoRastreio();
  const info: Record<string, unknown> = {};
  const parte = executor(r, restante, token);
  const ig = cfg.igUserId!;
  await parte("Instagram (perfil)", async () => {
    const p = await api.igPerfil(ig);
    if (p.username) info.ig_username = p.username;
    let net: Record<string, number> = {};
    try { net = await api.igSeguidoresDiarios(ig, de, addDays(hoje, -1)); } catch (e) { r.avisos.push(`Seguidores por dia: ${mensagemSegura(e, token)}`); }
    const rows: SnapshotEntrada[] = Object.entries(net).map(([date, v]) => ({ kind: "ig_daily", date, key: "account", metrics: { follower_net: v } }));
    if (p.seguidores != null) rows.push({ kind: "ig_daily", date: hoje, key: "account", metrics: { followers: p.seguidores } });
    r.linhas.ig_perfil = await gravarSnapshots(cfg.clientId, rows, "meta");
  });
  await parte("Instagram (métricas diárias)", async () => {
    // Mais recentes primeiro; o que não couber no tempo é completado nas próximas atualizações.
    const ontem = addDays(hoje, -1);
    const ja = await datasComIgDiario(cfg.clientId, de, ontem, "meta");
    const recentes = new Set([ontem, addDays(ontem, -1), addDays(ontem, -2)]);
    const dias = listarDias(de, ontem).filter((d) => !ja.has(d) || recentes.has(d)).reverse();
    const excluir = new Set<IgMetricaDia>();
    const rows: SnapshotEntrada[] = [];
    for (const d of dias) {
      if (restante() < 5_000) { r.parcial = true; break; }
      const x = await api.igMetricasDia(ig, d, excluir);
      for (const m of x.indisponiveis) excluir.add(m);
      const m: MetricasIgDia = { ...x.valores };
      if (Object.keys(m).length) rows.push({ kind: "ig_daily", date: d, key: "account", metrics: { ...m } });
    }
    if (excluir.size) {
      info.ig_indisponiveis = [...excluir];
      rows.push({ kind: "ig_daily", date: ontem, key: "account", metrics: { indisponiveis: [...excluir] } });
    }
    r.linhas.ig_daily = await gravarSnapshots(cfg.clientId, rows, "meta");
    if (r.parcial) r.avisos.push("Instagram: parte do histórico diário será completada nas próximas atualizações.");
  });
  await parte("Instagram (mídias)", async () => {
    const midias = await api.igMidias(ig, de, 40, () => restante() > 3_000);
    r.linhas.ig_media = await gravarSnapshots(cfg.clientId, linhasDeMidias(midias), "meta");
  });
  return { r, info };
}

/**
 * Coleta as fontes do canal, uma de cada vez e de forma INDEPENDENTE: falha (ou falta de credencial) em uma não impede a outra, e cada
 * uma grava o próprio status/erro. Compatível com a assinatura antiga: (canal, api, opções, token) usa a Meta para anúncios e Instagram-Meta.
 */
export async function coletarCanal(canal: CanalRow, api: CanaisApi | null, o: OpcoesColeta, token?: string | null, windsor?: CredenciaisColeta["windsor"], windsorAds?: CredenciaisColeta["windsorAds"]): Promise<ResultadoColeta> {
  const agora = o.agora ?? Date.now;
  const inicio = agora();
  const limite = inicio + o.maxMs;
  const hoje = o.hoje ?? spDate(new Date(agora()));
  const cfg: CanalConfig = configDe(canal);
  const quer = new Set<FonteColeta>(o.fontes ?? ["ads", "instagram"]);
  let ads: ResultadoFonte | null = null, instagram: ResultadoFonte | null = null;

  if (quer.has("ads") && (cfg.adsSource === "meta" || cfg.adsSource === "windsor") && cfg.adAccountId) {
    const doWindsor = cfg.adsSource === "windsor";
    const fonteApi: FonteAnunciosApi | null = doWindsor ? windsorAds?.api ?? null : api;
    if (!fonteApi) ads = pulada("ads", doWindsor ? "sem chave do Windsor.ai" : "sem credencial da Meta");
    else {
      // Anúncios podem usar até ~70% do tempo; o Instagram sempre sobra algum.
      const fimAds = inicio + Math.floor(o.maxMs * 0.7);
      const { r } = await coletarAnuncios(cfg, fonteApi, doWindsor ? windsorAds?.chave : token, addDays(hoje, -(o.dias - 1)), hoje, () => Math.min(fimAds, limite) - agora(), doWindsor ? "windsor" : "meta", Boolean(o.soCampanhas));
      ads = fechar("ads", doWindsor ? "windsor" : "meta", r);
      await marcarColeta(cfg.clientId, { ok: ads.ok, erro: ads.erro }, "ads");
    }
  }

  if (quer.has("instagram") && cfg.igSource !== "none") {
    const deIg = addDays(hoje, -((o.diasIg ?? o.dias) - 1));
    const restante = () => limite - agora();
    if (cfg.igSource === "windsor") {
      if (!windsor) instagram = pulada("instagram", "sem chave do Windsor.ai");
      else {
        const { r, info } = await coletarInstagramWindsor(cfg, windsor.fonte, windsor.chave, deIg, hoje, restante);
        instagram = fechar("instagram", "windsor", r);
        await marcarColeta(cfg.clientId, { ok: instagram.ok, erro: instagram.erro, info }, "instagram");
      }
    } else if (cfg.igUserId) {
      if (!api) instagram = pulada("instagram", "sem credencial da Meta");
      else {
        const { r, info } = await coletarInstagramMeta(cfg, api, token, deIg, hoje, restante);
        instagram = fechar("instagram", "meta", r);
        await marcarColeta(cfg.clientId, { ok: instagram.ok, erro: instagram.erro, info }, "instagram");
      }
    }
  }

  const feitas = [ads, instagram].filter((x): x is ResultadoFonte => Boolean(x?.executada));
  const linhas: Record<string, number> = {};
  for (const f of feitas) Object.assign(linhas, f.linhas);
  const erros = feitas.map((f) => f.erro).filter(Boolean);
  return {
    clientId: cfg.clientId, ok: feitas.some((f) => f.ok), linhas, avisos: feitas.flatMap((f) => f.avisos),
    erro: erros.length ? erros.join(" · ").slice(0, 480) : (feitas.length ? null : [ads, instagram].map((f) => f?.motivoPulo).filter(Boolean).join(" · ") || "Nenhuma fonte configurada."),
    ms: agora() - inicio, parcial: feitas.some((f) => f.parcial), ads, instagram,
  };
}

export type FabricaApi = (canal: CanalRow) => Promise<{ api: CanaisApi; token: string | null } | null>;
export type FabricaWindsorAds = (canal: CanalRow) => Promise<{ api: FonteAnunciosApi; chave: string | null } | null>;
export type FabricaWindsor = (canal: CanalRow) => Promise<{ fonte: FonteWindsor; chave: string | null } | null>;

/** Rotina diária: um canal por vez, do mais antigo ao mais novo, com tempo máximo total e por canal. Credencial ausente pula só aquela fonte. */
export async function coletarTodos(o: { maxMs: number; porCanalMs?: number; apiPara: FabricaApi; windsorPara?: FabricaWindsor; windsorAdsPara?: FabricaWindsorAds; incluirSemToken?: boolean; agora?: () => number }) {
  const agora = o.agora ?? Date.now;
  const limite = agora() + o.maxMs;
  const canais = await listarCanaisParaColeta(Boolean(o.incluirSemToken));
  const out: Array<ResultadoColeta | { clientId: string; pulado: string }> = [];
  for (const c of canais) {
    const sobra = limite - agora();
    if (sobra < 15_000) { out.push({ clientId: c.clientId, pulado: "tempo total esgotado" }); continue; }
    const precisaMeta = (c.adsSource === "meta" && c.adAccountId) || (c.igSource === "meta" && c.igUserId);
    const meta = precisaMeta ? await o.apiPara(c).catch(() => null) : null;
    const win = c.igSource === "windsor" && o.windsorPara ? await o.windsorPara(c).catch(() => null) : null;
    const winAds = c.adsSource === "windsor" && o.windsorAdsPara ? await o.windsorAdsPara(c).catch(() => null) : null;
    if (!meta && !win && !winAds) { out.push({ clientId: c.clientId, pulado: "sem credencial" }); continue; }
    try {
      out.push(await coletarCanal(c, meta?.api ?? null, { dias: c.lastSyncAt ? DIAS_ROTINA : DIAS_BACKFILL, diasIg: c.igLastSyncAt ? DIAS_ROTINA : DIAS_BACKFILL, maxMs: Math.min(sobra, o.porCanalMs ?? 120_000), agora }, meta?.token ?? null, win, winAds));
    } catch (e) {
      const msg = mensagemSegura(e, meta?.token ?? win?.chave ?? winAds?.chave);
      out.push({ clientId: c.clientId, pulado: `erro: ${msg}` });
    }
  }
  return { canais: canais.length, resultados: out };
}
