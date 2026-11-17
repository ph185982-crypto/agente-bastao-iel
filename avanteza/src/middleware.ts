import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, canAccess, isMapaPath, verifySessionFull } from "@/lib/session";
import { ZONA_PUBLICA } from "@/lib/comercial/zona";

const PUBLIC = [/^\/\.well-known\//, /^\/login/, /^\/conectado/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/health/, /^\/api\/mapa\/reunioes\/?$/, /^\/api\/capturas\/?$/, /^\/api\/capturas\/(pendencias|concluir|importar)\/?$/, /^\/api\/eventos\/?$/]; // reuniões, capturas e eventos conferem a própria chave (CRON_SECRET/admin; AVANTEZA_CAPTURE_KEY; AVANTEZA_EVENTS_KEY)

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return NextResponse.next();
  // Comercial (Vendedor IA reescrito): só arquivos estáticos e a proposta pública passam sem a sessão da Central.
  if (ZONA_PUBLICA.some((r) => r.test(path))) return NextResponse.next();
  const sess = await verifySessionFull(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!canAccess(sess)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    const to = new URL("/login", req.url);
    if (path !== "/") to.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(to);
  }
  // Usuário de cliente: só o Mapa (nunca Central, painel, usuários, SSO nem APIs administrativas).
  if (sess!.role === "client" && !isMapaPath(path)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "acesso negado" }, { status: 403 });
    return NextResponse.redirect(new URL("/mapa", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo).*)"],
};
