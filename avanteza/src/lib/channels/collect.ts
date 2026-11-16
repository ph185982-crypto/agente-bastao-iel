// Coletor dos canais: busca na Meta (somente leitura) e grava em channel_snapshots (upsert). Um canal por vez, com tempo máximo.
// Cada parte (campanhas, anúncios, Instagram, mídias) falha sozinha: o que deu certo é gravado e o erro fica em last_error.
import { addDays, spDate } from "@/lib/dates";
import { listarDias } from "@/lib/dashboards/periodo";
import { MetaErro } from "@/lib/dashboards/meta";
import { esconderToken } from "./graph";
import { datasComIgDiario, gravarSnapshots, listarCanaisParaColeta, marcarColeta, configDe, type CanalRow, type SnapshotEntrada } from "./store";
import {
  DIAS_BACKFILL, DIAS_ROTINA,
  type AnuncioInfo, type CanaisApi, type CanalConfig, type IgMetricaDia, type InsightBruto, type MetricasAnuncioDia, type MetricasCampanhaDia, type MetricasIgDia, type MetricasIgMidia,
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
  /** Janela de campanhas/anúncios/mídias, em dias terminando hoje. */
  dias: number;
  /** Tempo máximo desta coleta, em ms. */
  maxMs: number;
  agora?: () => number;
}
export interface ResultadoColeta {
  clientId: string; ok: boolean; linhas: Record<string, number>; avisos: string[]; erro: string | null; ms: number; parcial: boolean;
}

/** Mensagem curta e segura (nunca o token) para guardar em last_error. */
export function mensagemSegura(e: unknown, token?: string | null): string {
  const base = e instanceof MetaErro ? e.message : "Falha inesperada na coleta.";
  return esconderToken(base, token).slice(0, 240);
}

export async function coletarCanal(canal: CanalRow, api: CanaisApi, o: OpcoesColeta, token?: string | null): Promise<ResultadoColeta> {
  const agora = o.agora ?? Date.now;
  const inicio = agora();
  const limite = inicio + o.maxMs;
  const restante = () => limite - agora();
  const hoje = o.hoje ?? spDate(new Date(agora()));
  const de = addDays(hoje, -(o.dias - 1));
  const cfg: CanalConfig = configDe(canal);
  const linhas: Record<string, number> = {};
  const avisos: string[] = [];
  const falhas: string[] = [];
  let sucessos = 0, parcial = false;
  const info: Record<string, unknown> = {};

  const parte = async (nome: string, fn: () => Promise<void>) => {
    if (restante() <= 0) { parcial = true; avisos.push(`${nome}: tempo esgotado; continua na próxima atualização.`); return; }
    try { await fn(); sucessos++; }
    catch (e) { const t = `${nome}: ${mensagemSegura(e, token)}`; avisos.push(t); falhas.push(t); }
  };

  if (cfg.adAccountId) {
    const conta = cfg.adAccountId;
    await parte("Campanhas", async () => {
      const bruto = await api.insightsDiarios({ contaId: conta, nivel: "campaign", de, ate: hoje, campanhas: cfg.campaignIds });
      const rows: SnapshotEntrada[] = [];
      for (const r of bruto) {
        if (!r.date_start || !r.campaign_id) continue;
        rows.push({ kind: "campaign_daily", date: r.date_start, key: r.campaign_id, metrics: { ...metricasDaLinha(r, cfg.resultActionType, r.campaign_name ?? r.campaign_id) } });
      }
      linhas.campaign_daily = await gravarSnapshots(cfg.clientId, rows);
    });
    await parte("Anúncios", async () => {
      const bruto = await api.insightsDiarios({ contaId: conta, nivel: "ad", de, ate: hoje, campanhas: cfg.campaignIds });
      let infos: AnuncioInfo[] = [];
      try { infos = await api.anuncios({ contaId: conta, campanhas: cfg.campaignIds }); }
      catch (e) { avisos.push(`Criativos: ${mensagemSegura(e, token)}`); }
      const porId = new Map(infos.map((a) => [a.id, a]));
      const rows: SnapshotEntrada[] = [];
      for (const r of bruto as InsightBruto[]) {
        if (!r.date_start || !r.ad_id) continue;
        const a = porId.get(r.ad_id);
        const m: MetricasAnuncioDia = {
          ...metricasDaLinha(r, cfg.resultActionType, r.ad_name ?? a?.nome ?? r.ad_id),
          campaign_id: r.campaign_id, campaign_name: r.campaign_name,
          ...(a ? { status: a.status, effective_status: a.statusEfetivo, thumb: a.thumb, image: a.imagem, video_id: a.videoId } : {}),
        };
        rows.push({ kind: "ad_daily", date: r.date_start, key: r.ad_id, metrics: { ...m } });
      }
      linhas.ad_daily = await gravarSnapshots(cfg.clientId, rows);
    });
  }

  if (cfg.igUserId) {
    const ig = cfg.igUserId;
    await parte("Instagram (perfil)", async () => {
      const p = await api.igPerfil(ig);
      if (p.username) info.ig_username = p.username;
      const m: MetricasIgDia = {};
      if (p.seguidores != null) m.followers = p.seguidores;
      let net: Record<string, number> = {};
      try { net = await api.igSeguidoresDiarios(ig, de, addDays(hoje, -1)); } catch (e) { avisos.push(`Seguidores por dia: ${mensagemSegura(e, token)}`); }
      const rows: SnapshotEntrada[] = Object.entries(net).map(([date, v]) => ({ kind: "ig_daily", date, key: "account", metrics: { follower_net: v } }));
      if (p.seguidores != null) rows.push({ kind: "ig_daily", date: hoje, key: "account", metrics: { followers: p.seguidores } });
      linhas.ig_perfil = await gravarSnapshots(cfg.clientId, rows);
    });
    await parte("Instagram (métricas diárias)", async () => {
      // Mais recentes primeiro; o que não couber no tempo é completado nas próximas atualizações.
      const ontem = addDays(hoje, -1);
      const ja = await datasComIgDiario(cfg.clientId, de, ontem);
      const recentes = new Set([ontem, addDays(ontem, -1), addDays(ontem, -2)]);
      const dias = listarDias(de, ontem).filter((d) => !ja.has(d) || recentes.has(d)).reverse();
      const excluir = new Set<IgMetricaDia>();
      const rows: SnapshotEntrada[] = [];
      for (const d of dias) {
        if (restante() < 5_000) { parcial = true; break; }
        const r = await api.igMetricasDia(ig, d, excluir);
        for (const m of r.indisponiveis) excluir.add(m);
        const m: MetricasIgDia = { ...r.valores };
        if (Object.keys(m).length) rows.push({ kind: "ig_daily", date: d, key: "account", metrics: { ...m } });
      }
      if (excluir.size) {
        info.ig_indisponiveis = [...excluir];
        const d = ontem;
        rows.push({ kind: "ig_daily", date: d, key: "account", metrics: { indisponiveis: [...excluir] } });
      }
      linhas.ig_daily = await gravarSnapshots(cfg.clientId, rows);
      if (parcial) avisos.push("Instagram: parte do histórico diário será completada nas próximas atualizações.");
    });
    await parte("Instagram (mídias)", async () => {
      const midias = await api.igMidias(ig, de, 40, () => restante() > 3_000);
      const rows: SnapshotEntrada[] = midias.map((m) => {
        const v: MetricasIgMidia = {
          type: m.tipo, product: m.produto, caption: m.legenda, permalink: m.permalink, thumb: m.thumb, timestamp: m.timestamp,
          likes: m.likes, comments: m.comentarios, reach: m.alcance, saved: m.salvos, shares: m.compartilhamentos, views: m.views, interactions: m.interacoes,
        };
        return { kind: "ig_media", date: spDate(new Date(m.timestamp)), key: m.id, metrics: { ...v } };
      });
      linhas.ig_media = await gravarSnapshots(cfg.clientId, rows);
    });
  }

  const ok = sucessos > 0;
  const erro = falhas.length ? falhas.join(" · ").slice(0, 480) : null;
  await marcarColeta(cfg.clientId, { ok, erro, info });
  return { clientId: cfg.clientId, ok, linhas, avisos, erro, ms: agora() - inicio, parcial };
}

export type FabricaApi = (canal: CanalRow) => Promise<{ api: CanaisApi; token: string | null } | null>;

/** Rotina diária: um canal por vez, do mais antigo ao mais novo, com tempo máximo total e por canal. */
export async function coletarTodos(o: { maxMs: number; porCanalMs?: number; apiPara: FabricaApi; incluirSemToken?: boolean; agora?: () => number }) {
  const agora = o.agora ?? Date.now;
  const limite = agora() + o.maxMs;
  const canais = await listarCanaisParaColeta(Boolean(o.incluirSemToken));
  const out: Array<ResultadoColeta | { clientId: string; pulado: string }> = [];
  for (const c of canais) {
    const sobra = limite - agora();
    if (sobra < 15_000) { out.push({ clientId: c.clientId, pulado: "tempo total esgotado" }); continue; }
    const fabrica = await o.apiPara(c).catch(() => null);
    if (!fabrica) { out.push({ clientId: c.clientId, pulado: "sem credencial" }); continue; }
    try {
      out.push(await coletarCanal(c, fabrica.api, { dias: c.lastSyncAt ? DIAS_ROTINA : DIAS_BACKFILL, maxMs: Math.min(sobra, o.porCanalMs ?? 120_000), agora }, fabrica.token));
    } catch (e) {
      const msg = mensagemSegura(e, fabrica.token);
      await marcarColeta(c.clientId, { ok: false, erro: msg }).catch(() => undefined);
      out.push({ clientId: c.clientId, pulado: `erro: ${msg}` });
    }
  }
  return { canais: canais.length, resultados: out };
}
