// Avanteza ID — emissor do login único. JWT ES256 de 60 s, um aplicativo por token (aud).
// A chave privada fica só aqui (SSO_PRIVATE_KEY, PEM PKCS8). Os aplicativos conferem pela chave pública (JWKS).
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { env } from "./env";
import type { Session } from "./session";

export const SSO_ISSUER = "avanteza-id";
export const SSO_TTL_S = 60;

function privateKey() {
  return createPrivateKey(env("SSO_PRIVATE_KEY").replace(/\\n/g, "\n"));
}

export function publicJwk() {
  const jwk = createPublicKey(privateKey()).export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  const kid = createHash("sha256").update(`${jwk.crv}.${jwk.x}.${jwk.y}`).digest("base64url").slice(0, 16);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, use: "sig", alg: "ES256" };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function issueToken(sess: Session, appId: string, returnTo: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid: publicJwk().kid };
  const payload = {
    iss: SSO_ISSUER,
    aud: appId,
    sub: sess.email,
    name: sess.name,
    role: sess.role,
    ret: returnTo,
    iat: now,
    exp: now + SSO_TTL_S,
    jti: randomUUID(),
  };
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = sign("sha256", Buffer.from(data), { key: privateKey(), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${data}.${sig}`;
}

/** Só caminhos internos ("/algo"), nunca outro site. */
export function safePath(p: string | null | undefined): string {
  return p && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/";
}
