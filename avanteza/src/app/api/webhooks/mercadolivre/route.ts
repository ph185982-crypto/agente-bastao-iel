// Notificações do Mercado Livre: grava na fila e responde 200 imediatamente.
// O processamento acontece em seguida (after) e, como garantia, pelo cron da fila.
import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/marketplaces";
import { enqueueWebhook } from "@/lib/webhook-intake";

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
    // 500 faz o Mercado Livre reenviar a notificação mais tarde (nada se perde).
    if (!(await enqueueWebhook("mercadolivre", n))) return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "Endpoint de notificações do Mercado Livre (POST)." });
}
