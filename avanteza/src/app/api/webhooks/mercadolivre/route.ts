// Notificações do Mercado Livre: grava na fila e responde 200 imediatamente.
// O processamento acontece em seguida (after) e, como garantia, pelo cron da fila.
import { NextResponse, after } from "next/server";
import { adminDb } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/marketplaces";
import { processWebhookQueue } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // nada a fazer, mas não forçamos reenvio
  }
  const n = getAdapter("mercadolivre").parseWebhook(body);
  if (n) {
    const { error } = await adminDb().from("webhook_events").insert({
      marketplace: "mercadolivre",
      topic: n.topic,
      resource: n.resource,
      external_user_id: n.externalUserId,
      payload: n.raw as object,
    });
    if (error) {
      // 500 faz o Mercado Livre reenviar a notificação mais tarde (nada se perde).
      console.error("[webhook] falha ao gravar:", error.message);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    after(async () => {
      try {
        await processWebhookQueue(20_000, 20);
      } catch (err) {
        console.error("[webhook] processamento adiado:", err instanceof Error ? err.message : err);
      }
    });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "Endpoint de notificações do Mercado Livre (POST)." });
}
