// Callback de autorização da Shopee (recebe code + shop_id; o state volta na própria URL).
import type { NextRequest } from "next/server";
import { handleOAuthCallback } from "@/lib/oauth-callback";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleOAuthCallback("shopee", req.nextUrl.searchParams);
}
