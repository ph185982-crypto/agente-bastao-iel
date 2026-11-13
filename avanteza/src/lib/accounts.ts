// Gestão de tokens das contas: criptografia, renovação antecipada e trava contra corrida.
import { adminDb } from "./supabase/admin";
import { decrypt, encrypt } from "./crypto";
import { getAdapter } from "./marketplaces";
import type { TokenSet } from "./marketplaces/types";
import { ApiError } from "./http";

export interface AccountRow {
  id: string;
  client_id: string;
  marketplace: string;
  external_user_id: string;
  nickname: string | null;
  site_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
  ads_advertiser_id: string | null;
  last_collected_at: string | null;
}

/** Renova quando faltar menos que isso para expirar. */
export const REFRESH_WINDOW_MS = 60 * 60 * 1000;

export async function saveTokens(accountId: string, t: TokenSet) {
  const db = adminDb();
  const { error } = await db
    .from("marketplace_accounts")
    .update({
      access_token_enc: encrypt(t.accessToken),
      refresh_token_enc: encrypt(t.refreshToken), // sempre o NOVO refresh token
      token_expires_at: t.expiresAt.toISOString(),
      scopes: t.scope ?? null,
      status: "active",
      last_error: null,
      last_refreshed_at: new Date().toISOString(),
      refresh_lock_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) throw new Error(`Falha ao salvar tokens: ${error.message}`);
}

export async function getAccount(accountId: string): Promise<AccountRow> {
  const { data, error } = await adminDb().from("marketplace_accounts").select("*").eq("id", accountId).single();
  if (error || !data) throw new Error("Conta não encontrada");
  return data as AccountRow;
}

/** Renova o token com trava otimista: só um processo por vez consegue a trava. */
export async function refreshAccount(acc: AccountRow, force = false): Promise<string | null> {
  const db = adminDb();
  if (!acc.refresh_token_enc) return null;
  const expiresAt = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
  if (!force && expiresAt - Date.now() > REFRESH_WINDOW_MS) return decrypt(acc.access_token_enc!);

  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + 60_000).toISOString();
  const { data: locked } = await db
    .from("marketplace_accounts")
    .update({ refresh_lock_until: lockUntil })
    .eq("id", acc.id)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${now}`)
    .select("id, refresh_token_enc")
    .maybeSingle();

  if (!locked) {
    // Outro processo está renovando: espera e relê.
    await new Promise((r) => setTimeout(r, 3000));
    const fresh = await getAccount(acc.id);
    return fresh.access_token_enc ? decrypt(fresh.access_token_enc) : null;
  }

  try {
    const tokens = await getAdapter(acc.marketplace).refreshToken(decrypt(locked.refresh_token_enc));
    await saveTokens(acc.id, tokens);
    return tokens.accessToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const invalid = err instanceof ApiError && (err.status === 400 || err.status === 401);
    await db
      .from("marketplace_accounts")
      .update({
        refresh_lock_until: null,
        last_error: `Renovação falhou: ${msg}`,
        ...(invalid ? { status: "reauth_required" } : {}),
      })
      .eq("id", acc.id);
    throw err;
  }
}

/** Devolve um access token válido (renovando se necessário). */
export async function getValidAccessToken(accountId: string): Promise<{ token: string; account: AccountRow }> {
  const acc = await getAccount(accountId);
  if (acc.status !== "active") throw new Error(`Conta ${acc.nickname ?? acc.id} precisa de nova autorização`);
  const token = await refreshAccount(acc);
  if (!token) throw new Error("Conta sem token");
  return { token, account: acc };
}
