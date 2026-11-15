// Push da Shopee: confere a assinatura (HMAC-SHA256 com a partner key sobre "URL|corpo"), grava e responde 200.
// VERIFICAR na documentação oficial ao ativar o push no app da Shopee.
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { enqueueWebhook } from "@/lib/webhook-intake";
import { shopeePushValid } from "@/lib/marketplaces/shopee/adapter";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const key = process.env.SHOPEE_PARTNER_KEY;
  if (!key) return NextResponse.json({ error: "Shopee não configurada" }, { status: 503 });
  const raw = await req.text();
  if (!shopeePushValid(key, `${appUrl()}/api/webhooks/shopee`, raw, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  let b: Record<string, any>;
  try {
    b = JSON.parse(raw.replace(/"shop_id"\s*:\s*(\d+)/, '"shop_id":"$1"'));
  } catch {
    return NextResponse.json({ ok: true });
  }
  const shopId = b.shop_id != null ? String(b.shop_id) : "";
  const ordersn = b.data?.ordersn;
  if (shopId && ordersn) {
    const ok = await enqueueWebhook("shopee", { topic: "orders", resource: `/orders/${ordersn}`, externalUserId: shopId, raw: b });
    if (!ok) return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
