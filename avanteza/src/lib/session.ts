// Sessão do administrador: cookie HttpOnly assinado com HMAC-SHA256 (SESSION_SECRET).
// Usa Web Crypto para funcionar tanto no middleware (Edge) quanto nas rotas Node.
export const SESSION_COOKIE = "avz_session";
export const SESSION_TTL_S = 7 * 24 * 3600;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function secretOrThrow(secret?: string) {
  const s = secret ?? process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET não configurado");
  return s;
}

export async function signSession(email: string, secret?: string, ttl = SESSION_TTL_S): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ e: email.toLowerCase(), x: Math.floor(Date.now() / 1000) + ttl })));
  const sig = await crypto.subtle.sign("HMAC", await key(secretOrThrow(secret)), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret?: string): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secretOrThrow(secret)), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { e: string; x: number };
    if (!data.e || data.x < Math.floor(Date.now() / 1000)) return null;
    return data.e;
  } catch {
    return null;
  }
}

export function isAllowedAdmin(email: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}
