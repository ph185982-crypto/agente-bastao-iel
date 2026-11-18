// Coletor do GOOGLE · Perfil da Empresa (somente leitura, Windsor.ai). TERCEIRA fonte independente: credencial (a mesma chave do
// Instagram), status (gbp_last_sync_at / gbp_last_error) e coleta próprios. Falha aqui nunca derruba anúncios nem Instagram, e cada
// parte (local, diário, avaliações, buscas) também falha sozinha. Grava em channel_snapshots com source 'windsor':
//   gbp_profile (key 'local', date = hoje) · gbp_daily (key 'local') · gbp_review (key = id da avaliação, date = dia em que foi escrita)
//   · gbp_keyword (key = termo, date = 1º dia do mês).
// O Windsor só devolve as avaliações escritas no período pedido: cada uma fica guardada pelo id e o histórico acumula entre coletas
// (a resposta da empresa, quando chega depois, atualiza a mesma linha).
import { addDays, spDate } from "@/lib/dates";
import { esconderChave } from "./windsor";
import { linkGoogleSeguro } from "./links";
import { mensagemSegura } from "./collect";
import { gravarSnapshots, listarCanaisGoogle, marcarColetaGoogle, type CanalRow, type SnapshotEntrada } from "./store";
import { DIAS_BACKFILL, type MetricasGbpAvaliacao, type MetricasGbpDia, type MetricasGbpLocal } from "./types";
import type { FonteGoogleApi } from "./windsor-gbp";

/** Rotina diária: o Google consolida os números com alguns dias de atraso, então a janela diária é maior que a dos anúncios. */
export const DIAS_ROTINA_GOOGLE = 14;
/** Avaliações relidas na rotina (para pegar respostas dadas depois). */
export const DIAS_AVALIACOES_ROTINA = 45;

export interface OpcoesColetaGoogle { hoje?: string; dias: number; diasAvaliacoes?: number; maxMs: number; agora?: () => number }
export interface ResultadoGoogle { clientId: string; executada: boolean; ok: boolean; linhas: Record<string, number>; avisos: string[]; erro: string | null; parcial: boolean; ms: number }

const TODAS_DIA: Array<keyof MetricasGbpDia> = ["maps_mobile", "maps_desktop", "search_mobile", "search_desktop", "calls", "directions", "website", "conversations", "bookings"];
/** Meses (YYYY-MM-01) de `de` até `ate`. */
export function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let [y, m] = de.slice(0, 7).split("-").map(Number);
  const [yf, mf] = ate.slice(0, 7).split("-").map(Number);
  while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, "0")}-01`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/** Coleta o Google de UM canal e registra o resultado (gbp_last_*). Nunca lança: o erro vai para o resultado e para gbp_last_error, sem a chave. */
export async function coletarGoogle(canal: CanalRow, fonte: FonteGoogleApi, chave: string | null, o: OpcoesColetaGoogle): Promise<ResultadoGoogle> {
  const agora = o.agora ?? Date.now;
  const inicio = agora();
  const hoje = o.hoje ?? spDate(new Date(agora()));
  const restante = () => inicio + o.maxMs - agora();
  const de = addDays(hoje, -(o.dias - 1));
  const deAv = addDays(hoje, -((o.diasAvaliacoes ?? o.dias) - 1));
  const r: ResultadoGoogle = { clientId: canal.clientId, executada: true, ok: false, linhas: {}, avisos: [], erro: null, parcial: false, ms: 0 };
  const falhas: string[] = [];
  let sucessos = 0;
  const info: Record<string, unknown> = {};
  const parte = async (nome: string, fn: () => Promise<void>) => {
    if (restante() <= 0) { r.parcial = true; r.avisos.push(`${nome}: tempo esgotado; continua na próxima atualização.`); return; }
    try { await fn(); sucessos++; } catch (e) { const t = `${nome}: ${mensagemSegura(e, chave)}`; r.avisos.push(t); falhas.push(t); }
  };

  await parte("Google (local)", async () => {
    const l = await fonte.local(hoje);
    const m: MetricasGbpLocal = {
      title: l.title ?? null, category: l.category ?? null, neighborhood: l.neighborhood ?? null, city: l.city ?? null,
      maps_uri: linkGoogleSeguro(l.maps_uri), review_uri: linkGoogleSeguro(l.review_uri), rating_avg: l.rating_avg ?? null, rating_count: l.rating_count ?? null,
    };
    if (l.title) info.gbp_local = l.title;
    r.linhas.gbp_profile = await gravarSnapshots(canal.clientId, [{ kind: "gbp_profile", date: hoje, key: "local", metrics: { ...m } }], "windsor");
  });
  await parte("Google (visualizações e ações)", async () => {
    // O dia de hoje ainda não fechou no Google: fica de fora (nunca vira um zero falso).
    const dias = await fonte.diario(de, addDays(hoje, -1));
    const rows: SnapshotEntrada[] = dias.filter((d) => d.date < hoje).map((d) => {
      const m: Record<string, number> = {};
      for (const k of TODAS_DIA) if (typeof d.metrics[k] === "number") m[k] = d.metrics[k]!;
      return { kind: "gbp_daily" as const, date: d.date, key: "local", metrics: m };
    });
    r.linhas.gbp_daily = await gravarSnapshots(canal.clientId, rows, "windsor");
  });
  await parte("Google (avaliações)", async () => {
    const av = await fonte.avaliacoes(deAv, hoje);
    const rows: SnapshotEntrada[] = av.filter((a) => a.date <= hoje).map((a) => {
      // Todos os campos sempre presentes: uma resposta removida depois volta a null (o upsert junta por chave).
      const m: MetricasGbpAvaliacao = { stars: a.metrics.stars, reviewer: a.metrics.reviewer, comment: a.metrics.comment, reply: a.metrics.reply, created_at: a.metrics.created_at };
      return { kind: "gbp_review" as const, date: a.date, key: a.id.slice(0, 300), metrics: { ...m } };
    });
    r.linhas.gbp_review = await gravarSnapshots(canal.clientId, rows, "windsor");
  });
  // Buscas: uma consulta por mês (o Google só dá o total mensal). Um mês que falha vira aviso; os outros valem.
  const rowsP: SnapshotEntrada[] = [];
  let mesesOk = 0;
  for (const mes of mesesEntre(de, hoje).reverse()) {
    if (restante() <= 1_000) { r.parcial = true; r.avisos.push("Google (buscas): tempo esgotado; continua na próxima atualização."); break; }
    try {
      for (const p of await fonte.palavras(mes, hoje)) rowsP.push({ kind: "gbp_keyword", date: mes, key: p.palavra.slice(0, 200), metrics: { value: p.valor } });
      mesesOk++;
    } catch (e) { r.avisos.push(`Google (buscas de ${mes.slice(5, 7)}/${mes.slice(0, 4)}): ${mensagemSegura(e, chave)}`); }
  }
  if (rowsP.length) r.linhas.gbp_keyword = await gravarSnapshots(canal.clientId, rowsP, "windsor");
  if (mesesOk) sucessos++;

  r.ok = sucessos > 0;
  r.erro = falhas.length ? esconderChave(falhas.join(" · "), chave).slice(0, 480) : null;
  r.ms = agora() - inicio;
  await marcarColetaGoogle(canal.clientId, { ok: r.ok, erro: r.erro, info });
  return r;
}

export type FabricaGoogle = (canal: CanalRow) => Promise<{ fonte: FonteGoogleApi; chave: string | null } | null>;

/** Rotina diária do Google: um canal por vez, com tempo total e por canal. Sem chave: pula (e registra por quê). */
export async function coletarGoogleTodos(o: { maxMs: number; porCanalMs?: number; fontePara: FabricaGoogle; hoje?: string; agora?: () => number }) {
  const agora = o.agora ?? Date.now;
  const limite = agora() + o.maxMs;
  const canais = await listarCanaisGoogle();
  const out: Array<ResultadoGoogle | { clientId: string; pulado: string }> = [];
  for (const c of canais) {
    const sobra = limite - agora();
    if (sobra < 8_000) { out.push({ clientId: c.clientId, pulado: "tempo total esgotado" }); continue; }
    const f = await o.fontePara(c).catch(() => null);
    if (!f) {
      out.push({ clientId: c.clientId, pulado: "sem chave do Windsor.ai" });
      await marcarColetaGoogle(c.clientId, { ok: false, erro: "Sem chave do Windsor.ai: configure WINDSOR_API_KEY (a mesma conta Windsor do Instagram) ou a chave do canal." });
      continue;
    }
    const primeira = !c.gbpLastSyncAt;
    out.push(await coletarGoogle(c, f.fonte, f.chave, { hoje: o.hoje, dias: primeira ? DIAS_BACKFILL : DIAS_ROTINA_GOOGLE, diasAvaliacoes: primeira ? DIAS_BACKFILL : DIAS_AVALIACOES_ROTINA, maxMs: Math.min(sobra, o.porCanalMs ?? 60_000), agora }));
  }
  return { canais: canais.length, resultados: out };
}
