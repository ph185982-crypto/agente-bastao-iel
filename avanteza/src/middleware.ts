import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login/, /^\/conectado/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/health/];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.redirect(new URL("/login?erro=config", req.url));

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = data.user?.email?.toLowerCase();
  if (!email || !admins.includes(email)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo).*)"],
};
