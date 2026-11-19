// Filtro de campanhas do canal: por ids (campaign_ids) E/OU por nome (campaign_name_filter: “contém”, sem caixa e sem acento).
// Usado na coleta (o que é gravado), no painel do cliente e no alerta de recarga: campanhas de outros projetos na mesma conta
// de anúncios (ex.: “Destrava - SHOPEE” na conta do Showman) nunca entram em nenhum número do cliente.

export interface FiltroCampanhas { campaignIds: string[]; campaignNameFilter: string | null }

export const normalizarNome = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** true quando a campanha passa nos dois filtros (ids, se houver; nome, se houver). Sem nenhum filtro, tudo passa. */
export function campanhaPassa(id: string | null | undefined, nome: string | null | undefined, f: FiltroCampanhas): boolean {
  if (f.campaignIds.length && !f.campaignIds.includes(String(id ?? ""))) return false;
  const alvo = f.campaignNameFilter ? normalizarNome(f.campaignNameFilter) : "";
  if (alvo && !normalizarNome(String(nome ?? "")).includes(alvo)) return false;
  return true;
}

export const temFiltroCampanhas = (f: FiltroCampanhas) => f.campaignIds.length > 0 || Boolean(f.campaignNameFilter?.trim());

/**
 * Filtra linhas de snapshot (campaign_daily / ad_daily) pelo filtro do canal. campaign_daily: chave = id, nome em metrics.nome.
 * ad_daily, ads_breakdown e adset_targeting: campaign_id/campaign_name nas métricas; sem nome, vale se a campanha do anúncio passou no nível de campanha.
 */
export function filtrarLinhasCampanhas<T extends { kind: string; key: string; metrics: Record<string, any> }>(rows: T[], f: FiltroCampanhas): T[] {
  if (!temFiltroCampanhas(f)) return rows;
  const aceitas = new Set(rows.filter((r) => r.kind === "campaign_daily" && campanhaPassa(r.key, r.metrics.nome, f)).map((r) => r.key));
  return rows.filter((r) => {
    if (r.kind === "campaign_daily") return aceitas.has(r.key);
    if (r.kind === "ad_daily" || r.kind === "ads_breakdown" || r.kind === "adset_targeting") {
      const cid = String(r.metrics.campaign_id ?? "");
      return r.metrics.campaign_name ? campanhaPassa(cid, r.metrics.campaign_name, f) : aceitas.has(cid);
    }
    return true;
  });
}
