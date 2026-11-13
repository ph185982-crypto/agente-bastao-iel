// Coleta por conta: anúncios, visitas, pedidos, perguntas, reputação e Product Ads.
// Processa UMA conta por vez, a mais desatualizada primeiro, até esgotar o orçamento de tempo.
import { adminDb } from "./supabase/admin";
import { getValidAccessToken, type AccountRow } from "./accounts";
import { getAdapter } from "./marketplaces";
import { addDays, spDate } from "./dates";
import type { Order } from "./marketplaces/types";

const MAX_LISTINGS = 1000;
const MAX_ORDERS = 1000;
const MAX_QUESTIONS = 200;
const VISITS_PER_RUN = 100; // visitas por anúncio são caras (1 chamada por item)

export interface CollectResult {
  accountId: string;
  nickname: string | null;
  ok: boolean;
  error?: string;
  listings?: number;
  orders?: number;
  questions?: number;
  campaigns?: number;
  warnings: string[];
}

export function summarizeOrdersByDay(orders: Order[]): Record<string, { count: number; units: number; revenue: number }> {
  const out: Record<string, { count: number; units: number; revenue: number }> = {};
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "invalid") continue;
    const day = spDate(new Date(o.dateCreated));
    out[day] ??= { count: 0, units: 0, revenue: 0 };
    out[day].count += 1;
    out[day].units += o.units;
    out[day].revenue += o.totalAmount;
  }
  return out;
}

export async function collectAccount(acc: AccountRow): Promise<CollectResult> {
  const db = adminDb();
  const warnings: string[] = [];
  const result: CollectResult = { accountId: acc.id, nickname: acc.nickname, ok: false, warnings };
  const today = spDate();
  const yesterday = addDays(today, -1);

  try {
    const { token } = await getValidAccessToken(acc.id);
    const ml = getAdapter(acc.marketplace);
    const uid = acc.external_user_id;

    // 1) Reputação
    const seller = await ml.getSeller(token, uid);

    // 2) Anúncios
    const ids = await ml.listListingIds(token, uid, MAX_LISTINGS);
    const listings = await ml.getListings(token, ids);
    const now = new Date().toISOString();

    // Visitas dos últimos 30 dias: rotaciona para cobrir aos poucos os anúncios sem dado recente.
    const { data: prevListings } = await db
      .from("listings")
      .select("external_id, visits_30d, updated_at")
      .eq("account_id", acc.id);
    const prevVisits = new Map((prevListings ?? []).map((l) => [l.external_id, l.visits_30d as number | null]));
    const visitTargets = listings
      .filter((l) => l.status === "active")
      .map((l) => l.externalId)
      .slice(0, VISITS_PER_RUN);
    const visits = await ml.getListingVisits(token, visitTargets, { from: addDays(today, -30), to: today });

    const listingRows = listings.map((l) => ({
      account_id: acc.id,
      external_id: l.externalId,
      title: l.title,
      status: l.status,
      sub_status: l.subStatus,
      price: l.price,
      currency_id: l.currencyId,
      available_quantity: l.availableQuantity,
      sold_quantity: l.soldQuantity,
      visits_30d: visits[l.externalId] ?? prevVisits.get(l.externalId) ?? null,
      permalink: l.permalink,
      thumbnail: l.thumbnail,
      listing_type_id: l.listingTypeId,
      has_variations: l.hasVariations,
      raw: null,
      updated_at: now,
    }));
    for (let i = 0; i < listingRows.length; i += 500) {
      const { error } = await db.from("listings").upsert(listingRows.slice(i, i + 500));
      if (error) throw new Error(`listings: ${error.message}`);
    }
    const snapRows = listingRows.map((l) => ({
      account_id: acc.id,
      external_id: l.external_id,
      snapshot_date: today,
      status: l.status,
      price: l.price,
      available_quantity: l.available_quantity,
      sold_quantity: l.sold_quantity,
      visits_30d: l.visits_30d,
    }));
    for (let i = 0; i < snapRows.length; i += 500) {
      await db.from("listing_snapshots").upsert(snapRows.slice(i, i + 500));
    }
    result.listings = listings.length;

    // 3) Pedidos (ontem + hoje, para fechar o dia anterior corretamente)
    const orders = await ml.searchOrders(token, uid, { from: yesterday, to: today }, MAX_ORDERS);
    if (orders.length) {
      const { error } = await db.from("orders").upsert(
        orders.map((o) => ({
          account_id: acc.id,
          external_id: o.externalId,
          status: o.status,
          total_amount: o.totalAmount,
          paid_amount: o.paidAmount,
          currency_id: o.currencyId,
          units: o.units,
          date_created: o.dateCreated,
          date_closed: o.dateClosed,
          shipping_id: o.shippingId,
          raw: null,
          updated_at: now,
        })),
      );
      if (error) throw new Error(`orders: ${error.message}`);
    }
    result.orders = orders.length;
    const byDay = summarizeOrdersByDay(orders);

    // 4) Perguntas sem resposta
    const questions = await ml.listUnansweredQuestions(token, uid, MAX_QUESTIONS);
    // Marca como respondidas as que saíram da lista
    const openIds = questions.map((q) => q.externalId);
    const { data: prevOpen } = await db
      .from("questions")
      .select("external_id")
      .eq("account_id", acc.id)
      .eq("status", "UNANSWERED");
    const closed = (prevOpen ?? []).map((q) => q.external_id).filter((id) => !openIds.includes(id));
    if (closed.length) {
      await db.from("questions").update({ status: "ANSWERED", updated_at: now }).eq("account_id", acc.id).in("external_id", closed);
    }
    if (questions.length) {
      await db.from("questions").upsert(
        questions.map((q) => ({
          account_id: acc.id,
          external_id: q.externalId,
          item_id: q.itemId,
          text: q.text,
          status: q.status,
          answer_text: q.answerText,
          date_created: q.dateCreated,
          raw: null,
          updated_at: now,
        })),
      );
    }
    result.questions = questions.length;

    // 5) Product Ads (opcional: nem todo vendedor usa)
    let ads = { cost: null as number | null, revenue: null as number | null, roas: null as number | null, clicks: null as number | null, prints: null as number | null };
    try {
      const ctx = await ml.getAdsContext(token, uid);
      if (ctx) {
        if (ctx.advertiserId !== acc.ads_advertiser_id) {
          await db.from("marketplace_accounts").update({ ads_advertiser_id: ctx.advertiserId }).eq("id", acc.id);
        }
        const c1 = await ml.listAdsCampaigns(token, ctx, { from: yesterday, to: yesterday });
        const c7 = await ml.listAdsCampaigns(token, ctx, { from: addDays(today, -7), to: yesterday });
        const m7 = new Map(c7.map((c) => [c.externalId, c.metrics]));
        await db.from("ads_campaigns").upsert(
          c1.map((c) => ({
            account_id: acc.id,
            external_id: c.externalId,
            name: c.name,
            status: c.status,
            budget: c.budget,
            strategy: c.strategy,
            roas_target: c.roasTarget,
            metrics_1d: c.metrics,
            metrics_7d: m7.get(c.externalId) ?? null,
            raw: null,
            updated_at: now,
          })),
        );
        const sum = (k: "cost" | "revenue" | "clicks" | "prints") => c1.reduce((s, c) => s + (c.metrics[k] ?? 0), 0);
        const cost = sum("cost");
        const revenue = sum("revenue");
        ads = { cost, revenue, roas: cost > 0 ? revenue / cost : null, clicks: sum("clicks"), prints: sum("prints") };
        result.campaigns = c1.length;
      }
    } catch (err) {
      warnings.push(`Product Ads: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6) Visitas da conta (ontem e hoje)
    const visitsYesterday = await ml.getAccountVisits(token, uid, { from: yesterday, to: yesterday });
    const visitsToday = await ml.getAccountVisits(token, uid, { from: today, to: today });

    // 7) Snapshots diários (hoje é parcial; ontem é fechado)
    const base = {
      account_id: acc.id,
      active_listings: listings.filter((l) => l.status === "active").length,
      paused_listings: listings.filter((l) => l.status === "paused").length,
      out_of_stock_listings: listings.filter(
        (l) => (l.availableQuantity ?? 0) === 0 || l.subStatus.includes("out_of_stock"),
      ).length,
      unanswered_questions: questions.length,
      reputation_level: seller.reputationLevel,
      power_seller_status: seller.powerSellerStatus,
      claims_rate: seller.claimsRate,
      delayed_rate: seller.delayedRate,
      cancellations_rate: seller.cancellationsRate,
      updated_at: now,
    };
    await db.from("daily_snapshots").upsert([
      {
        ...base,
        snapshot_date: today,
        orders_count: byDay[today]?.count ?? 0,
        units_sold: byDay[today]?.units ?? 0,
        revenue: byDay[today]?.revenue ?? 0,
        visits: visitsToday,
        raw: { reputation: seller.raw },
      },
    ]);
    // Ontem: atualiza vendas, visitas e Ads (sem sobrescrever o retrato de estoque/reputação já salvo)
    const { data: ySnap } = await db
      .from("daily_snapshots")
      .select("account_id")
      .eq("account_id", acc.id)
      .eq("snapshot_date", yesterday)
      .maybeSingle();
    const yRow = {
      account_id: acc.id,
      snapshot_date: yesterday,
      orders_count: byDay[yesterday]?.count ?? 0,
      units_sold: byDay[yesterday]?.units ?? 0,
      revenue: byDay[yesterday]?.revenue ?? 0,
      visits: visitsYesterday,
      ads_cost: ads.cost,
      ads_revenue: ads.revenue,
      ads_roas: ads.roas,
      ads_clicks: ads.clicks,
      ads_prints: ads.prints,
      updated_at: now,
    };
    if (ySnap) await db.from("daily_snapshots").update(yRow).eq("account_id", acc.id).eq("snapshot_date", yesterday);
    else await db.from("daily_snapshots").insert({ ...base, ...yRow });

    await db
      .from("marketplace_accounts")
      .update({ nickname: seller.nickname, site_id: seller.siteId, last_collected_at: now, last_error: null })
      .eq("id", acc.id);
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await db
      .from("marketplace_accounts")
      .update({ last_error: `Coleta: ${result.error}`, last_collected_at: new Date().toISOString() })
      .eq("id", acc.id);
  }
  return result;
}

/** Roda a coleta em lote respeitando o tempo máximo da função. */
export async function collectBatch(budgetMs = 45_000, accountId?: string): Promise<CollectResult[]> {
  const started = Date.now();
  const db = adminDb();
  let q = db.from("marketplace_accounts").select("*").eq("status", "active");
  if (accountId) q = q.eq("id", accountId);
  const { data, error } = await q.order("last_collected_at", { ascending: true, nullsFirst: true }).limit(20);
  if (error) throw new Error(error.message);
  const results: CollectResult[] = [];
  for (const acc of (data ?? []) as AccountRow[]) {
    if (Date.now() - started > budgetMs) break;
    // Não repete conta coletada há menos de 50 min (a menos que seja pedido explícito)
    if (!accountId && acc.last_collected_at && Date.now() - new Date(acc.last_collected_at).getTime() < 50 * 60_000) continue;
    results.push(await collectAccount(acc));
  }
  return results;
}
