import { NextResponse } from "next/server";
import { publicJwk } from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ keys: [publicJwk()] }, { headers: { "Cache-Control": "public, max-age=600" } });
  } catch {
    return NextResponse.json({ keys: [] }, { status: 503 });
  }
}
