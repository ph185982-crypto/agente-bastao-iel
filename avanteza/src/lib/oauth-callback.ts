// Callback OAuth genérico (Mercado Livre e Shopee): valida state, troca o code e salva tokens criptografados.
import { NextResponse } from "next/server";
import { adminDb } from "./db";
import { getAdapter } from "./marketplaces";
import { encrypt } from "./crypto";
import { redirectUri } from "./oauth";
import { ensureDefaultRules } from "./alerts/engine";
import { appUrl } from "./env";

function done(status: "ok" | "erro", detail: string) {
  const u = new URL(`${appUrl()}/conectado`);
  u.searchParams.set("status", status);
  u.searchParams.set("detalhe", detail);
  return NextResponse.redirect(u);
}

export async function handleOAuthCallback(marketplace: string, params: URLSearchParams) {
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return done("erro", "Parâmetros ausentes. Peça um novo link à consultoria.");

  const db = adminDb();
  // Consome o state de forma atômica (uso único, dentro da validade e do mesmo marketplace)
  const { data: st } = await db
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", state)
    .eq("marketplace", marketplace)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();
  if (!st) return done("erro", "Link inválido, expirado ou já utilizado. Peça um novo link à consultoria.");

  try {
    const mk = getAdapter(marketplace);
    const extra: Record<string, string> = {};
    for (const k of ["shop_id", "main_account_id"]) {
      const v = params.get(k);
      if (v) extra[k] = v;
    }
    const tokens = await mk.exchangeCode({
      code,
      redirectUri: redirectUri(marketplace),
      codeVerifier: st.code_verifier ?? undefined,
      extra,
    });
    const seller = await mk.getSeller(tokens.accessToken, tokens.externalUserId);

    const { data: existing } = await db
      .from("marketplace_accounts")
      .select("id, client_id")
      .eq("marketplace", marketplace)
      .eq("external_user_id", tokens.externalUserId)
      .maybeSingle();
    if (existing && existing.client_id !== st.client_id) {
      return done("erro", "Esta conta já está vinculada a outro cliente. Fale com a consultoria.");
    }
    const { error } = await db.from("marketplace_accounts").upsert(
      {
        client_id: st.client_id,
        marketplace,
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
      },
      { onConflict: "marketplace,external_user_id" },
    );
    if (error) throw new Error(error.message);
    await ensureDefaultRules(st.client_id);
    await db.from("audit_log").insert({
      client_id: st.client_id,
      event: "account_connected",
      actor: "cliente (OAuth)",
      details: { marketplace, nickname: seller.nickname, user_id: tokens.externalUserId },
    });
    return done("ok", seller.nickname);
  } catch (err) {
    console.error(`[oauth:${marketplace}] falha no callback:`, err instanceof Error ? err.message : "erro");
    return done("erro", "Não foi possível concluir a autorização. Peça um novo link à consultoria.");
  }
}
