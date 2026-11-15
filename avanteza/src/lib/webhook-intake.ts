// Grava uma notificação na fila e agenda o processamento logo após responder (after).
import { after } from "next/server";
import { adminDb } from "./db";
import { processWebhookQueue } from "./webhooks";
import type { WebhookNotification } from "./marketplaces/types";

export async function enqueueWebhook(marketplace: string, n: WebhookNotification): Promise<boolean> {
  const { error } = await adminDb().from("webhook_events").insert({
    marketplace,
    topic: n.topic,
    resource: n.resource,
    external_user_id: n.externalUserId,
    payload: n.raw as object,
  });
  if (error) {
    console.error(`[webhook:${marketplace}] falha ao gravar:`, error.message);
    return false;
  }
  after(async () => {
    try {
      await processWebhookQueue(20_000, 20);
    } catch (err) {
      console.error("[webhook] processamento adiado:", err instanceof Error ? err.message : err);
    }
  });
  return true;
}
