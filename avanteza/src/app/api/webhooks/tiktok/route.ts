// Webhooks do TikTok Shop: confere a assinatura (HMAC do app_key + corpo), grava na fila e responde 200.
import { NextResponse } from "next/server";
import { TikTokShopAdapter, parseTikTokBody, ttsVerifyWebhook } from "@/lib/marketplaces/tiktok/adapter";
import { enqueueWebhook } from "@/lib/webhook-intake";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appKey || !appSecret) return NextResponse.json({ error: "TikTok Shop não configurado" }, { status: 503 });
  const raw = await req.text();
  if (!ttsVerifyWebhook(appKey, appSecret, raw, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = parseTikTokBody(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const n = new TikTokShopAdapter().parseWebhook(body);
  if (n && n.resource) {
    const ok = await enqueueWebhook("tiktok", n);
    if (!ok) return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "Endpoint de webhooks do TikTok Shop (POST)." });
}
