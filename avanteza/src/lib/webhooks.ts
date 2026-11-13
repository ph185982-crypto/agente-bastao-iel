// Processamento assíncrono da fila de notificações (webhook_events).
import { adminDb } from "./supabase/admin";
import { getValidAccessToken, type AccountRow } from "./accounts";
import { getAdapter } from "./marketplaces";

const now = () => new Date().toISOString();

/** Extrai o ID do recurso: "/orders/123" → "123"; "/questions/45" → "45"; "/items/MLB1" → "MLB1". */
export function resourceId(resource: string): string | null {
  const parts = resource.split("?")[0].split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

async function processOne(ev: { id: number; topic: string; resource: string; external_user_id: string; attempts: number }) {
  const db = adminDb();
  const { data: acc } = await db
    .from("marketplace_accounts")
    .select("*")
    .eq("marketplace", "mercadolivre")
    .eq("external_user_id", ev.external_user_id)
    .maybeSingle();
  if (!acc) return "ignored";
  const account = acc as AccountRow;
  const id = resourceId(ev.resource);
  if (!id) return "ignored";
  const { token } = await getValidAccessToken(account.id);
  const ml = getAdapter(account.marketplace);
  const ts = now();

  switch (ev.topic) {
    case "orders_v2":
    case "orders": {
      const o = await ml.getOrder(token, id);
      await db.from("orders").upsert({
        account_id: account.id,
        external_id: o.externalId,
        status: o.status,
        total_amount: o.totalAmount,
        paid_amount: o.paidAmount,
        currency_id: o.currencyId,
        units: o.units,
        date_created: o.dateCreated,
        date_closed: o.dateClosed,
        shipping_id: o.shippingId,
        updated_at: ts,
      });
      return "done";
    }
    case "questions": {
      const q = await ml.getQuestion(token, id);
      await db.from("questions").upsert({
        account_id: account.id,
        external_id: q.externalId,
        item_id: q.itemId,
        text: q.text,
        status: q.status,
        answer_text: q.answerText,
        date_created: q.dateCreated,
        updated_at: ts,
      });
      return "done";
    }
    case "items": {
      const [l] = await ml.getListings(token, [id]);
      if (l) {
        await db.from("listings").upsert({
          account_id: account.id,
          external_id: l.externalId,
          title: l.title,
          status: l.status,
          sub_status: l.subStatus,
          price: l.price,
          currency_id: l.currencyId,
          available_quantity: l.availableQuantity,
          sold_quantity: l.soldQuantity,
          permalink: l.permalink,
          thumbnail: l.thumbnail,
          listing_type_id: l.listingTypeId,
          has_variations: l.hasVariations,
          updated_at: ts,
        });
      }
      return "done";
    }
    default:
      // messages, shipments, payments, etc.: ficam registrados na fila para consulta.
      return "ignored";
  }
}

export async function processWebhookQueue(budgetMs = 40_000, limit = 100) {
  const db = adminDb();
  const started = Date.now();
  const { data } = await db
    .from("webhook_events")
    .select("id, topic, resource, external_user_id, attempts")
    .in("status", ["pending", "error"])
    .lt("attempts", 5)
    .order("received_at", { ascending: true })
    .limit(limit);
  const stats = { done: 0, ignored: 0, error: 0 };
  for (const ev of data ?? []) {
    if (Date.now() - started > budgetMs) break;
    // Reivindica o evento (evita processamento duplicado entre execuções paralelas)
    const { data: claimed } = await db
      .from("webhook_events")
      .update({ status: "processing", attempts: ev.attempts + 1 })
      .eq("id", ev.id)
      .in("status", ["pending", "error"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    try {
      const status = await processOne(ev);
      await db.from("webhook_events").update({ status, processed_at: now(), last_error: null }).eq("id", ev.id);
      stats[status as "done" | "ignored"]++;
    } catch (err) {
      await db
        .from("webhook_events")
        .update({ status: "error", last_error: err instanceof Error ? err.message : String(err) })
        .eq("id", ev.id);
      stats.error++;
    }
  }
  // Libera eventos presos em "processing" há mais de 10 min
  await db
    .from("webhook_events")
    .update({ status: "error", last_error: "timeout de processamento" })
    .eq("status", "processing")
    .lt("received_at", new Date(Date.now() - 10 * 60_000).toISOString());
  return stats;
}
