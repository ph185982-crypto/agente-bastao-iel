// Callback OAuth do Mercado Livre: valida state, troca o code e salva tokens criptografados.
import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/marketplaces";
import { encrypt } from "@/lib/crypto";
import { redirectUri } from "@/lib/oauth";
import { ensureDefaultRules } from "@/lib/alerts/engine";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

function done(status: "ok" | "erro", detail: string) {
  const u = new URL(`${appUrl()}/conectado`);
  u.searchParams.set("status", status);
  u.searchParams.set("detalhe", detail);
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return done("erro", "Parâmetros ausentes. Peça um novo link à consultoria.");

  const db = adminDb();
  // Consome o state de forma atômica (uso único e dentro da validade)
  const { data: st } = await db
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", state)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();
  if (!st) return done("erro", "Link inválido, expirado ou já utilizado. Peça um novo link à consultoria.");

  try {
    const ml = getAdapter(st.marketplace);
    const tokens = await ml.exchangeCode({
      code,
      redirectUri: redirectUri(st.marketplace),
      codeVerifier: st.code_verifier ?? undefined,
    });
    const seller = await ml.getSeller(tokens.accessToken, tokens.externalUserId);

    const { data: existing } = await db
      .from("marketplace_accounts")
      .select("id, client_id")
      .eq("marketplace", st.marketplace)
      .eq("external_user_id", tokens.externalUserId)
      .maybeSingle();
    if (existing && existing.client_id !== st.client_id) {
      return done("erro", "Esta conta já está vinculada a outro cliente. Fale com a consultoria.");
    }
    const row = {
      client_id: st.client_id,
      marketplace: st.marketplace,
      external_user_id: tokens.externalUserId,
      nickname: seller.nickname,
      site_id: seller.siteId,
      access_token_enc: encrypt(tokens.accessToken),
      refresh_token_enc: encrypt(tokens.refreshToken),
      token_expires_at: tokens.expiresAt.toISOString(),
      scopes: tokens.scope ?? null,
      status: "active",
      last_error: null,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("marketplace_accounts").upsert(row, { onConflict: "marketplace,external_user_id" });
    if (error) throw new Error(error.message);
    await ensureDefaultRules(st.client_id);
    await db.from("audit_log").insert({
      client_id: st.client_id,
      event: "account_connected",
      actor: "cliente (OAuth)",
      details: { marketplace: st.marketplace, nickname: seller.nickname, user_id: tokens.externalUserId },
    });
    return done("ok", seller.nickname);
  } catch (err) {
    console.error("[oauth] falha no callback:", err instanceof Error ? err.message : "erro");
    return done("erro", "Não foi possível concluir a autorização. Peça um novo link à consultoria.");
  }
}
