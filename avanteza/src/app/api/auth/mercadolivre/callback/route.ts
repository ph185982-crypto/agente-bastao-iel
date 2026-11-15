// Callback OAuth do Mercado Livre.
import type { NextRequest } from "next/server";
import { handleOAuthCallback } from "@/lib/oauth-callback";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleOAuthCallback("mercadolivre", req.nextUrl.searchParams);
}
