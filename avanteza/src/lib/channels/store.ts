// Persistência dos canais. O token do cliente só é decifrado por `resolverToken` (coletor e teste de conexão, no servidor):
// nenhuma outra função lê token_enc, e as linhas devolvidas à tela nunca têm esse campo (só `temToken` e `tokenHint`).
import { rawQuery } from "../db/client";
import { decrypt, encrypt } from "../crypto";
import { RESULTADO_PADRAO, type CanalConfig, type KindSnapshot, type StatusCanal } from "./types";

const COLUNAS = `id, client_id, provider, ad_account_id, campaign_ids, ig_user_id, page_id, result_action_type, token_hint,
  (token_enc is not null) as tem_token, use_platform_token, status, info, last_sync_at, last_error, updated_at`;

export interface CanalRow {
  id: string; clientId: string; provider: "meta";
  adAccountId: string | null; campaignIds: string[]; igUserId: string | null; pageId: string | null; resultActionType: string;
  tokenHint: string | null; temToken: boolean; usarTokenPlataforma: boolean;
  status: StatusCanal; info: Record<string, any>; lastSyncAt: string | null; lastError: string | null; updatedAt: string;
}
const mapa = (r: any): CanalRow => ({
  id: r.id, clientId: r.client_id, provider: r.provider, adAccountId: r.ad_account_id, campaignIds: r.campaign_ids ?? [], igUserId: r.ig_user_id, pageId: r.page_id,
  resultActionType: r.result_action_type, tokenHint: r.token_hint, temToken: Boolean(r.tem_token), usarTokenPlataforma: Boolean(r.use_platform_token),
  status: r.status, info: r.info ?? {}, lastSyncAt: r.last_sync_at, lastError: r.last_error, updatedAt: r.updated_at,
});

export const configDe = (c: CanalRow): CanalConfig => ({ clientId: c.clientId, adAccountId: c.adAccountId, campaignIds: c.campaignIds, igUserId: c.igUserId, pageId: c.pageId, resultActionType: c.resultActionType });

export async function obterCanal(clientId: string): Promise<CanalRow | null> {
  const [r] = await rawQuery(`select ${COLUNAS} from avanteza.client_channels where client_id = $1 and provider = 'meta'`, [clientId]);
  return r ? mapa(r) : null;
}

/** Canais ativos para a rotina diária (mais antigos primeiro). Com credencial; em desenvolvimento com fixture, qualquer canal configurado. */
export async function listarCanaisParaColeta(incluirSemToken: boolean): Promise<CanalRow[]> {
  const base = "status <> 'desconectado' and (ad_account_id is not null or ig_user_id is not null)";
  const where = incluirSemToken ? base : `${base} and (token_enc is not null or use_platform_token)`;
  const rows = await rawQuery(`select ${COLUNAS} from avanteza.client_channels where ${where} order by last_sync_at asc nulls first`);
  return rows.map(mapa);
}

export interface EntradaCanal {
  adAccountId: string | null; campaignIds: string[]; igUserId: string | null; pageId: string | null; resultActionType?: string;
  usarTokenPlataforma: boolean;
  /** Token novo em texto. Vazio/undefined = manter o que já está guardado. */
  token?: string | null;
}

/** Cria/atualiza a configuração. Token novo é cifrado aqui; o texto puro nunca é guardado nem devolvido. */
export async function salvarCanal(clientId: string, e: EntradaCanal): Promise<CanalRow> {
  const token = e.token?.trim() || null;
  const enc = token ? encrypt(token) : null;
  const hint = token ? token.slice(-4) : null;
  const [r] = await rawQuery(
    `insert into avanteza.client_channels (client_id, provider, ad_account_id, campaign_ids, ig_user_id, page_id, result_action_type, token_enc, token_hint, use_platform_token, status)
     values ($1,'meta',$2,$3,$4,$5,$6,$7,$8,$9,'pendente')
     on conflict (client_id, provider) do update set
       ad_account_id = excluded.ad_account_id, campaign_ids = excluded.campaign_ids, ig_user_id = excluded.ig_user_id, page_id = excluded.page_id,
       result_action_type = excluded.result_action_type, use_platform_token = excluded.use_platform_token,
       token_enc = coalesce(excluded.token_enc, avanteza.client_channels.token_enc),
       token_hint = case when excluded.token_enc is not null then excluded.token_hint else avanteza.client_channels.token_hint end,
       status = case when avanteza.client_channels.status = 'desconectado' then 'pendente' else avanteza.client_channels.status end,
       updated_at = now()
     returning ${COLUNAS}`,
    [clientId, e.adAccountId, e.campaignIds, e.igUserId, e.pageId, e.resultActionType || RESULTADO_PADRAO, enc, hint, e.usarTokenPlataforma],
  );
  return mapa(r);
}

/** Apaga o token (do cliente e o uso do token da plataforma). O histórico coletado continua guardado. */
export async function desconectarCanal(clientId: string): Promise<void> {
  await rawQuery("update avanteza.client_channels set token_enc = null, token_hint = null, use_platform_token = false, status = 'desconectado', updated_at = now() where client_id = $1 and provider = 'meta'", [clientId]);
}

export async function marcarColeta(clientId: string, r: { ok: boolean; erro?: string | null; info?: Record<string, unknown> }): Promise<void> {
  await rawQuery(
    `update avanteza.client_channels set
       status = $2, last_error = $3, last_sync_at = case when $4::boolean then now() else last_sync_at end,
       info = info || $5::jsonb, updated_at = now()
     where client_id = $1 and provider = 'meta' and status <> 'desconectado'`,
    [clientId, r.ok ? "ativo" : "erro", r.erro ? r.erro.slice(0, 500) : null, r.ok, JSON.stringify(r.info ?? {})],
  );
}

export async function salvarInfo(clientId: string, info: Record<string, unknown>): Promise<void> {
  await rawQuery("update avanteza.client_channels set info = info || $2::jsonb, updated_at = now() where client_id = $1 and provider = 'meta'", [clientId, JSON.stringify(info)]);
}

export type OrigemToken = "cliente" | "plataforma";
export function tokenDaPlataforma(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.META_ACCESS_TOKEN?.trim() || null;
}
/** ÚNICO ponto que decifra o token do cliente. Só para uso interno do servidor; o valor nunca deve ser devolvido a uma tela. */
export async function resolverToken(clientId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ token: string; origem: OrigemToken } | null> {
  const [r] = await rawQuery<{ token_enc: string | null; use_platform_token: boolean }>("select token_enc, use_platform_token from avanteza.client_channels where client_id = $1 and provider = 'meta'", [clientId]);
  if (!r) return null;
  if (r.token_enc) {
    try { return { token: decrypt(r.token_enc), origem: "cliente" }; } catch { return null; }
  }
  const plat = r.use_platform_token ? tokenDaPlataforma(env) : null;
  return plat ? { token: plat, origem: "plataforma" } : null;
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

export interface SnapshotEntrada { kind: KindSnapshot; date: string; key: string; metrics: Record<string, unknown> }
export interface SnapshotRow { kind: KindSnapshot; date: string; key: string; metrics: Record<string, any> }

/** Upsert idempotente: mesma (cliente, tipo, dia, chave) atualiza; campos novos se juntam aos antigos (jsonb ||). */
export async function gravarSnapshots(clientId: string, rows: SnapshotEntrada[]): Promise<number> {
  const unicas = new Map<string, SnapshotEntrada>();
  for (const r of rows) unicas.set(`${r.kind}|${r.date}|${r.key}`, r);
  const lista = [...unicas.values()];
  for (let i = 0; i < lista.length; i += 200) {
    const lote = lista.slice(i, i + 200);
    const params: unknown[] = [clientId];
    const values = lote.map((r) => {
      params.push(r.kind, r.date, r.key, JSON.stringify(r.metrics));
      const n = params.length;
      return `($1,'meta',$${n - 3},$${n - 2}::date,$${n - 1},$${n}::jsonb)`;
    });
    await rawQuery(
      `insert into avanteza.channel_snapshots (client_id, provider, kind, date, key, metrics) values ${values.join(",")}
       on conflict (client_id, kind, date, key) do update set metrics = avanteza.channel_snapshots.metrics || excluded.metrics, updated_at = now()`,
      params,
    );
  }
  return lista.length;
}

export async function lerSnapshots(clientId: string, kinds: KindSnapshot[], de: string, ate: string): Promise<SnapshotRow[]> {
  return rawQuery<SnapshotRow>("select kind, date, key, metrics from avanteza.channel_snapshots where client_id = $1 and kind = any($2::text[]) and date between $3::date and $4::date order by date, key", [clientId, kinds, de, ate]);
}

/** Dias que já têm métricas diárias do Instagram (para o backfill incremental). */
export async function datasComIgDiario(clientId: string, de: string, ate: string): Promise<Set<string>> {
  const rows = await rawQuery<{ date: string }>("select date from avanteza.channel_snapshots where client_id = $1 and kind = 'ig_daily' and date between $2::date and $3::date and metrics ? 'reach'", [clientId, de, ate]);
  return new Set(rows.map((r) => r.date));
}
