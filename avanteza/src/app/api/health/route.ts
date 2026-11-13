import { NextResponse } from "next/server";
import { missingConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const missing = missingConfig();
  return NextResponse.json({ ok: true, app: "avanteza", configured: missing.length === 0, missing });
}
