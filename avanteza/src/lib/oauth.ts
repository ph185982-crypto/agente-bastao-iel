import { createHash } from "node:crypto";
import { adminDb } from "./supabase/admin";
import { appUrl, envOptional } from "./env";
import { randomToken } from "./crypto";
import { getAdapter } from "./marketplaces";

export const STATE_TTL_DAYS = 7;

export function redirectUri(marketplace = "mercadolivre"): string {
  if (marketplace === "mercadolivre" && envOptional("ML_REDIRECT_URI")) return envOptional("ML_REDIRECT_URI")!;
  return `${appUrl()}/api/auth/${marketplace}/callback`;
}

/** Gera o link de autorização para enviar ao cliente (state único contra CSRF; PKCE opcional). */
export async function createAuthorizationLink(clientId: string, marketplace = "mercadolivre") {
  const state = randomToken(24);
  const usePkce = marketplace === "mercadolivre" && envOptional("ML_USE_PKCE") === "true";
  const verifier = usePkce ? randomToken(48) : null;
  const challenge = verifier ? createHash("sha256").update(verifier).digest("base64url") : undefined;
  const { error } = await adminDb().from("oauth_states").insert({
    state,
    client_id: clientId,
    marketplace,
    code_verifier: verifier,
    expires_at: new Date(Date.now() + STATE_TTL_DAYS * 86400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  const url = getAdapter(marketplace).buildAuthorizationUrl({ state, redirectUri: redirectUri(marketplace), codeChallenge: challenge });
  return { url, expiresInDays: STATE_TTL_DAYS };
}
