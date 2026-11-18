// Persistência dos canais. O token do cliente só é decifrado por `resolverToken` (coletor e teste de conexão, no servidor):
// nenhuma outra função lê token_enc, e as linhas devolvidas à tela nunca têm esse campo (só `temToken` e `tokenHint`).
import { rawQuery } from "../db/client";
import { decrypt, encrypt } from "../crypto";
import { chaveWindsorDaPlataforma } from "./windsor";
import { RESULTADO_PADRAO, type CanalConfig, type FonteAnuncios, type FonteGoogle, type FonteInstagram, type KindSnapshot, type OrigemDado, type StatusCanal } from "./types";

// Nunca seleciona token_enc nem windsor_key_enc: só se existem (tem_*) e os 4 últimos caracteres (hint).
const COLUNAS = `id, client_id, provider, ad_account_id, campaign_ids, ig_user_id, page_id, result_action_type, token_hint,
  (token_enc is not null) as tem_token, use_platform_token, status, info, last_sync_at, last_error, updated_at,
  ads_source, ig_source, windsor_account_name, (windsor_key_enc is not null) as tem_chave_windsor, windsor_key_hint, ig_last_sync_at, ig_last_error,
  campaign_name_filter, spend_alert_limit::float8 as spend_alert_limit, spend_alert_warn_pct, to_char(spend_alert_since, 'YYYY-MM-DD') as spend_alert_since, spend_alert_emails,
  gbp_source, gbp_location_name, gbp_last_sync_at, gbp_last_error, meta_daily_budget_cap::float8 as meta_daily_budget_cap`;

/** Convenção: `lastSyncAt`/`lastError` = coleta dos ANÚNCIOS (Meta Ads); `igLastSyncAt`/`igLastError` = coleta do INSTAGRAM (Windsor ou Meta). */
export interface CanalRow {
  id: string; clientId: string; provider: "meta";
  adAccountId: string | null; campaignIds: string[]; igUserId: string | null; pageId: string | null; resultActionType: string;
  tokenHint: string | null; temToken: boolean; usarTokenPlataforma: boolean;
  status: StatusCanal; info: Record<string, any>; lastSyncAt: string | null; lastError: string | null; updatedAt: string;
  adsSource: FonteAnuncios; igSource: FonteInstagram; windsorAccountName: string | null; temChaveWindsor: boolean; chaveWindsorHint: string | null;
  igLastSyncAt: string | null; igLastError: string | null;
  campaignNameFilter: string | null;
  /** Alerta de recarga (null = desligado). */
  alertaGasto: AlertaGastoConfig | null;
  /** Google (Perfil da Empresa): terceira fonte, independente (Windsor.ai, mesma chave do Instagram). */
  gbpSource: FonteGoogle; gbpLocationName: string | null; gbpLastSyncAt: string | null; gbpLastError: string | null;
  /** Gestão de anúncios pelo conector do Claude: teto do orçamento diário (R$). */
  metaTetoDiario: number;
}
export interface AlertaGastoConfig { limite: number; avisoPct: number; desde: string; emails: string[] }
const mapa = (r: any): CanalRow => ({
  id: r.id, clientId: r.client_id, provider: r.provider, adAccountId: r.ad_account_id, campaignIds: r.campaign_ids ?? [], igUserId: r.ig_user_id, pageId: r.page_id,
  resultActionType: r.result_action_type, tokenHint: r.token_hint, temToken: Boolean(r.tem_token), usarTokenPlataforma: Boolean(r.use_platform_token),
  status: r.status, info: r.info ?? {}, lastSyncAt: r.last_sync_at, lastError: r.last_error, updatedAt: r.updated_at,
  adsSource: r.ads_source ?? "none", igSource: r.ig_source ?? "none", windsorAccountName: r.windsor_account_name ?? null, temChaveWindsor: Boolean(r.tem_chave_windsor),
  chaveWindsorHint: r.windsor_key_hint ?? null, igLastSyncAt: r.ig_last_sync_at ?? null, igLastError: r.ig_last_error ?? null,
  campaignNameFilter: r.campaign_name_filter ?? null,
  alertaGasto: r.spend_alert_limit != null && r.spend_alert_since ? { limite: Number(r.spend_alert_limit), avisoPct: Number(r.spend_alert_warn_pct ?? 80), desde: r.spend_alert_since, emails: r.spend_alert_emails ?? [] } : null,
  gbpSource: r.gbp_source === "windsor" ? "windsor" : "none", gbpLocationName: r.gbp_location_name ?? null, gbpLastSyncAt: r.gbp_last_sync_at ?? null, gbpLastError: r.gbp_last_error ?? null,
  metaTetoDiario: r.meta_daily_budget_cap != null ? Number(r.meta_daily_budget_cap) : 100,
});

/** Teto do orçamento diário (R$) para criar/alterar anúncios da Meta pelo conector. */
export async function salvarTetoMeta(clientId: string, teto: number): Promise<boolean> {
  const r = await rawQuery("update avanteza.client_channels set meta_daily_budget_cap = $2, updated_at = now() where client_id = $1 and provider = 'meta' returning id", [clientId, teto]);
  return r.length > 0;
}

export const configDe = (c: CanalRow): CanalConfig => ({
  clientId: c.clientId, adAccountId: c.adAccountId, campaignIds: c.campaignIds, campaignNameFilter: c.campaignNameFilter, igUserId: c.igUserId, pageId: c.pageId, resultActionType: c.resultActionType,
  adsSource: c.adsSource, igSource: c.igSource, windsorAccountName: c.windsorAccountName,
});

export async function obterCanal(clientId: string): Promise<CanalRow | null> {
  const [r] = await rawQuery(`select ${COLUNAS} from avanteza.client_channels where client_id = $1 and provider = 'meta'`, [clientId]);
  return r ? mapa(r) : null;
}

/** Canais ativos para a rotina diária (mais antigos primeiro). Cada fonte é decidida (e pode ser pulada) separadamente na coleta. */
export async function listarCanaisParaColeta(incluirSemToken: boolean): Promise<CanalRow[]> {
  const fontes = "((ads_source in ('meta','windsor') and ad_account_id is not null) or (ig_source = 'meta' and ig_user_id is not null) or ig_source = 'windsor')";
  const cred = incluirSemToken ? "true" : "(token_enc is not null or use_platform_token or ig_source = 'windsor' or ads_source = 'windsor')";
  const rows = await rawQuery(`select ${COLUNAS} from avanteza.client_channels where status <> 'desconectado' and ${fontes} and ${cred} order by least(coalesce(last_sync_at, 'epoch'), coalesce(ig_last_sync_at, 'epoch')) asc`);
  return rows.map(mapa);
}

export interface EntradaCanal {
  adAccountId: string | null; campaignIds: string[]; campaignNameFilter?: string | null; igUserId: string | null; pageId: string | null; resultActionType?: string;
  usarTokenPlataforma: boolean;
  /** Token novo em texto. Vazio/undefined = manter o que já está guardado. */
  token?: string | null;
  /** Fontes: se omitidas, seguem o que está preenchido (conta de anúncios → meta; ID do Instagram → meta). */
  adsSource?: FonteAnuncios; igSource?: FonteInstagram; windsorAccountName?: string | null;
  /** Chave Windsor própria do canal, em texto. Vazio/undefined = manter a salva. */
  windsorKey?: string | null;
}

/** Cria/atualiza a configuração inteira (anúncios + Instagram). Token/chave novos são cifrados aqui; o texto puro nunca é guardado nem devolvido. */
export async function salvarCanal(clientId: string, e: EntradaCanal): Promise<CanalRow> {
  await salvarAnuncios(clientId, { adAccountId: e.adAccountId, campaignIds: e.campaignIds, campaignNameFilter: e.campaignNameFilter, resultActionType: e.resultActionType, usarTokenPlataforma: e.usarTokenPlataforma, token: e.token, adsSource: e.adsSource ?? (e.adAccountId ? "meta" : "none") });
  return salvarInstagram(clientId, { igSource: e.igSource ?? (e.igUserId ? "meta" : "none"), igUserId: e.igUserId, pageId: e.pageId, windsorAccountName: e.windsorAccountName ?? null, windsorKey: e.windsorKey });
}

export interface EntradaAnuncios {
  adAccountId: string | null; campaignIds: string[]; campaignNameFilter?: string | null; resultActionType?: string; usarTokenPlataforma: boolean; token?: string | null; adsSource: FonteAnuncios;
}
/** Só a fonte de ANÚNCIOS (Meta Ads). Não toca nas colunas do Instagram. */
export async function salvarAnuncios(clientId: string, e: EntradaAnuncios): Promise<CanalRow> {
  const token = e.token?.trim() || null;
  const enc = token ? encrypt(token) : null;
  const hint = token ? token.slice(-4) : null;
  const [r] = await rawQuery(
    `insert into avanteza.client_channels (client_id, provider, ad_account_id, campaign_ids, result_action_type, token_enc, token_hint, use_platform_token, ads_source, status, campaign_name_filter)
     values ($1,'meta',$2,$3,$4,$5,$6,$7,$8,'pendente',$9)
     on conflict (client_id, provider) do update set
       ad_account_id = excluded.ad_account_id, campaign_ids = excluded.campaign_ids,
       campaign_name_filter = case when $10::boolean then excluded.campaign_name_filter else avanteza.client_channels.campaign_name_filter end,
       result_action_type = excluded.result_action_type, use_platform_token = excluded.use_platform_token, ads_source = excluded.ads_source,
       last_sync_at = case when avanteza.client_channels.ads_source is distinct from excluded.ads_source then null else avanteza.client_channels.last_sync_at end,
       last_error = case when avanteza.client_channels.ads_source is distinct from excluded.ads_source then null else avanteza.client_channels.last_error end,
       token_enc = coalesce(excluded.token_enc, avanteza.client_channels.token_enc),
       token_hint = case when excluded.token_enc is not null then excluded.token_hint else avanteza.client_channels.token_hint end,
       status = case when avanteza.client_channels.status = 'desconectado' then 'pendente' else avanteza.client_channels.status end,
       updated_at = now()
     returning ${COLUNAS}`,
    [clientId, e.adAccountId, e.campaignIds, e.resultActionType || RESULTADO_PADRAO, enc, hint, e.usarTokenPlataforma, e.adsSource, e.campaignNameFilter?.trim() || null, e.campaignNameFilter !== undefined],
  );
  return mapa(r);
}

export interface EntradaInstagram {
  igSource: FonteInstagram; igUserId?: string | null; pageId?: string | null; windsorAccountName?: string | null; windsorKey?: string | null;
}
/** Só a fonte de INSTAGRAM (Windsor ou Meta). Não toca nas colunas de anúncios nem no token da Meta. */
export async function salvarInstagram(clientId: string, e: EntradaInstagram): Promise<CanalRow> {
  const chave = e.windsorKey?.trim() || null;
  const enc = chave ? encrypt(chave) : null;
  const hint = chave ? chave.slice(-4) : null;
  const [r] = await rawQuery(
    `insert into avanteza.client_channels (client_id, provider, ig_source, ig_user_id, page_id, windsor_account_name, windsor_key_enc, windsor_key_hint, status)
     values ($1,'meta',$2,$3,$4,$5,$6,$7,'pendente')
     on conflict (client_id, provider) do update set
       ig_source = excluded.ig_source, ig_user_id = excluded.ig_user_id, page_id = excluded.page_id, windsor_account_name = excluded.windsor_account_name,
       windsor_key_enc = coalesce(excluded.windsor_key_enc, avanteza.client_channels.windsor_key_enc),
       windsor_key_hint = case when excluded.windsor_key_enc is not null then excluded.windsor_key_hint else avanteza.client_channels.windsor_key_hint end,
       status = case when avanteza.client_channels.status = 'desconectado' then 'pendente' else avanteza.client_channels.status end,
       updated_at = now()
     returning ${COLUNAS}`,
    [clientId, e.igSource, e.igUserId ?? null, e.pageId ?? null, e.windsorAccountName?.trim() || null, enc, hint],
  );
  return mapa(r);
}

/** Apaga TODAS as credenciais do canal (token da Meta e chave do Windsor) e as duas fontes. O histórico coletado continua guardado. */
export async function desconectarCanal(clientId: string): Promise<void> {
  await rawQuery("update avanteza.client_channels set token_enc = null, token_hint = null, use_platform_token = false, windsor_key_enc = null, windsor_key_hint = null, ads_source = 'none', ig_source = 'none', gbp_source = 'none', status = 'desconectado', updated_at = now() where client_id = $1 and provider = 'meta'", [clientId]);
}

/** Desliga uma fonte só (apaga a credencial dela) sem mexer na outra. O canal fica 'desconectado' quando as duas estão desligadas. */
export async function desconectarFonte(clientId: string, fonte: "ads" | "instagram"): Promise<void> {
  const sets = fonte === "ads"
    ? "token_enc = null, token_hint = null, use_platform_token = false, ads_source = 'none'"
    : "windsor_key_enc = null, windsor_key_hint = null, ig_source = 'none', ig_user_id = null, page_id = null, windsor_account_name = null";
  await rawQuery(
    `update avanteza.client_channels set ${sets}, updated_at = now() where client_id = $1 and provider = 'meta'`,
    [clientId],
  );
  await rawQuery("update avanteza.client_channels set status = 'desconectado' where client_id = $1 and provider = 'meta' and ads_source = 'none' and ig_source = 'none' and gbp_source = 'none'", [clientId]);
}

// ─── Fonte 3: Google (Perfil da Empresa) ─────────────────────────────────────

export interface EntradaGoogle { gbpSource: FonteGoogle; gbpLocationName?: string | null }
/** Só a fonte do GOOGLE. Não toca em anúncios, Instagram, token nem chave. Trocar de local zera a última coleta (o próximo “Atualizar” refaz o histórico). */
export async function salvarGoogle(clientId: string, e: EntradaGoogle): Promise<CanalRow> {
  const [r] = await rawQuery(
    `insert into avanteza.client_channels (client_id, provider, gbp_source, gbp_location_name, status)
     values ($1,'meta',$2,$3,'pendente')
     on conflict (client_id, provider) do update set
       gbp_source = excluded.gbp_source, gbp_location_name = excluded.gbp_location_name,
       gbp_last_sync_at = case when avanteza.client_channels.gbp_location_name is distinct from excluded.gbp_location_name or avanteza.client_channels.gbp_source is distinct from excluded.gbp_source then null else avanteza.client_channels.gbp_last_sync_at end,
       gbp_last_error = case when avanteza.client_channels.gbp_location_name is distinct from excluded.gbp_location_name or avanteza.client_channels.gbp_source is distinct from excluded.gbp_source then null else avanteza.client_channels.gbp_last_error end,
       status = case when avanteza.client_channels.status = 'desconectado' and excluded.gbp_source <> 'none' then 'pendente' else avanteza.client_channels.status end,
       updated_at = now()
     returning ${COLUNAS}`,
    [clientId, e.gbpSource, e.gbpLocationName?.trim() || null],
  );
  return mapa(r);
}

/** Desliga só o Google. O histórico (inclusive as avaliações acumuladas) continua guardado. */
export async function desconectarGoogle(clientId: string): Promise<void> {
  await rawQuery("update avanteza.client_channels set gbp_source = 'none', updated_at = now() where client_id = $1 and provider = 'meta'", [clientId]);
  await rawQuery("update avanteza.client_channels set status = 'desconectado' where client_id = $1 and provider = 'meta' and ads_source = 'none' and ig_source = 'none' and gbp_source = 'none'", [clientId]);
}

/** Resultado da coleta do Google: só as colunas gbp_*; o status geral só passa a 'ativo' (nunca a 'erro') por causa do Google. */
export async function marcarColetaGoogle(clientId: string, r: { ok: boolean; erro?: string | null; info?: Record<string, unknown> }): Promise<void> {
  await rawQuery(
    `update avanteza.client_channels set gbp_last_error = $2, gbp_last_sync_at = case when $3::boolean then now() else gbp_last_sync_at end,
       status = case when $3::boolean and status = 'pendente' then 'ativo' else status end, info = info || $4::jsonb, updated_at = now()
     where client_id = $1 and provider = 'meta' and status <> 'desconectado'`,
    [clientId, r.erro ? r.erro.slice(0, 500) : null, r.ok, JSON.stringify(r.info ?? {})],
  );
}

/** Canais com o Google ligado (rotina diária), os mais antigos primeiro. */
export async function listarCanaisGoogle(): Promise<CanalRow[]> {
  const rows = await rawQuery(`select ${COLUNAS} from avanteza.client_channels where status <> 'desconectado' and gbp_source = 'windsor' order by gbp_last_sync_at asc nulls first`);
  return rows.map(mapa);
}

export type FonteColeta = "ads" | "instagram";
/** Registra o resultado da coleta de UMA fonte (status e erro próprios). O status geral é 'ativo' se esta fonte deu certo ou se a outra está saudável. */
export async function marcarColeta(clientId: string, r: { ok: boolean; erro?: string | null; info?: Record<string, unknown> }, fonte: FonteColeta = "ads"): Promise<void> {
  const [syncMe, errMe, syncOutra, errOutra, srcOutra] = fonte === "ads"
    ? ["last_sync_at", "last_error", "ig_last_sync_at", "ig_last_error", "ig_source"]
    : ["ig_last_sync_at", "ig_last_error", "last_sync_at", "last_error", "ads_source"];
  await rawQuery(
    `update avanteza.client_channels set
       ${errMe} = $2, ${syncMe} = case when $3::boolean then now() else ${syncMe} end,
       status = case when $3::boolean or (${srcOutra} <> 'none' and ${syncOutra} is not null and ${errOutra} is null) then 'ativo' else 'erro' end,
       info = info || $4::jsonb, updated_at = now()
     where client_id = $1 and provider = 'meta' and status <> 'desconectado'`,
    [clientId, r.erro ? r.erro.slice(0, 500) : null, r.ok, JSON.stringify(r.info ?? {})],
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

export type OrigemChaveWindsor = "canal" | "plataforma";
/** ÚNICO ponto que decifra a chave Windsor do canal. A chave do canal vale mais que a da plataforma (WINDSOR_API_KEY). Só para uso interno do servidor. */
export async function resolverChaveWindsor(clientId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ chave: string; origem: OrigemChaveWindsor } | null> {
  const [r] = await rawQuery<{ windsor_key_enc: string | null }>("select windsor_key_enc from avanteza.client_channels where client_id = $1 and provider = 'meta'", [clientId]);
  if (!r) return null;
  if (r.windsor_key_enc) {
    try { return { chave: decrypt(r.windsor_key_enc), origem: "canal" }; } catch { return null; }
  }
  const plat = chaveWindsorDaPlataforma(env);
  return plat ? { chave: plat, origem: "plataforma" } : null;
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

export interface SnapshotEntrada { kind: KindSnapshot; date: string; key: string; metrics: Record<string, unknown> }
export interface SnapshotRow { kind: KindSnapshot; date: string; key: string; metrics: Record<string, any>; source?: OrigemDado }

/** Upsert idempotente: mesma (cliente, tipo, dia, chave, fonte) atualiza; campos novos se juntam aos antigos (jsonb ||). Fontes diferentes nunca se misturam. */
export async function gravarSnapshots(clientId: string, rows: SnapshotEntrada[], source: OrigemDado = "meta"): Promise<number> {
  const unicas = new Map<string, SnapshotEntrada>();
  for (const r of rows) unicas.set(`${r.kind}|${r.date}|${r.key}`, r);
  const lista = [...unicas.values()];
  for (let i = 0; i < lista.length; i += 200) {
    const lote = lista.slice(i, i + 200);
    const params: unknown[] = [clientId, source];
    const values = lote.map((r) => {
      params.push(r.kind, r.date, r.key, JSON.stringify(r.metrics));
      const n = params.length;
      return `($1,$2,$2,$${n - 3},$${n - 2}::date,$${n - 1},$${n}::jsonb)`;
    });
    await rawQuery(
      `insert into avanteza.channel_snapshots (client_id, provider, source, kind, date, key, metrics) values ${values.join(",")}
       on conflict (client_id, kind, date, key, source) do update set metrics = avanteza.channel_snapshots.metrics || excluded.metrics, updated_at = now()`,
      params,
    );
  }
  return lista.length;
}

/** Lê snapshots. `source` restringe à origem (o Mapa lê o Instagram só da fonte configurada e os anúncios só da Meta). */
export async function lerSnapshots(clientId: string, kinds: KindSnapshot[], de: string, ate: string, source?: OrigemDado): Promise<SnapshotRow[]> {
  return rawQuery<SnapshotRow>(
    `select kind, date, key, metrics, source from avanteza.channel_snapshots where client_id = $1 and kind = any($2::text[]) and date between $3::date and $4::date ${source ? "and source = $5" : ""} order by date, key`,
    source ? [clientId, kinds, de, ate, source] : [clientId, kinds, de, ate],
  );
}

/** Dias que já têm métricas diárias do Instagram (para o backfill incremental da Meta). */
export async function datasComIgDiario(clientId: string, de: string, ate: string, source: OrigemDado = "meta"): Promise<Set<string>> {
  const rows = await rawQuery<{ date: string }>("select date from avanteza.channel_snapshots where client_id = $1 and kind = 'ig_daily' and source = $4 and date between $2::date and $3::date and metrics ? 'reach'", [clientId, de, ate, source]);
  return new Set(rows.map((r) => r.date));
}
