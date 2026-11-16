// Login único: confere a sessão e a permissão, emite um token de 60 s e devolve o usuário ao aplicativo.
// O destino vem do registro de apps (nunca da URL), então não serve para redirecionar a sites de terceiros.
import { NextResponse, type NextRequest } from "next/server";
import { currentSession } from "@/lib/auth";
import { canUseApp } from "@/lib/session";
import { getApp } from "@/lib/apps";
import { issueToken, safePath } from "@/lib/sso";
import { adminDb } from "@/lib/db";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("app") ?? "";
  const ret = safePath(req.nextUrl.searchParams.get("return"));
  const app = getApp(appId);
  if (!app || app.external) return NextResponse.redirect(new URL("/central?erro=" + encodeURIComponent("Aplicativo desconhecido."), appUrl()));

  const sess = await currentSession();
  if (!sess) {
    const login = new URL("/login", appUrl());
    login.searchParams.set("next", `/sso/authorize?app=${encodeURIComponent(appId)}&return=${encodeURIComponent(ret)}`);
    return NextResponse.redirect(login);
  }
  if (!canUseApp(sess, appId)) {
    return NextResponse.redirect(new URL("/central?erro=" + encodeURIComponent(`Seu usuário não tem acesso a ${app.name}.`), appUrl()));
  }
  if (!app.url) return NextResponse.redirect(new URL(app.internalPath ?? "/", appUrl()));

  const target = new URL(app.url + app.callback);
  // App montado sob um caminho desta Central (ex.: Vendedor IA em /comercial): sem destino, volta para a entrada dele.
  const base = new URL(app.url).pathname.replace(/\/$/, "");
  const volta = ret === "/" && base ? base : ret;
  target.searchParams.set("token", issueToken(sess, appId, volta));
  await adminDb().from("audit_log").insert({ event: "sso_login", actor: sess.email, details: { app: appId } });
  return NextResponse.redirect(target);
}
