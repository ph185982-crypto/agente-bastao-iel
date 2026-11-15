import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, canAccess, verifySessionFull } from "@/lib/session";

const PUBLIC = [/^\/login/, /^\/conectado/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/health/];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return NextResponse.next();
  const sess = await verifySessionFull(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!canAccess(sess)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo).*)"],
};
