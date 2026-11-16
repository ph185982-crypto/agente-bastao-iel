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

export type Role = "admin" | "member" | "reviewer" | "client";
export interface Session {
  email: string;
  role: Role;
  /** IDs dos aplicativos liberados (membros). Administradores acessam todos. */
  apps: string[];
  name: string;
  /** Só no papel "client": empresa principal (a primeira da lista). */
  clientId?: string;
  /** Só no papel "client": LISTA de empresas que o usuário pode ver (grupo do mesmo titular). Única fonte dos client_ids do Mapa. */
  clientIds?: string[];
}

export async function signSession(
  email: string,
  secret?: string,
  ttl = SESSION_TTL_S,
  role: Role = "admin",
  extra: { apps?: string[]; name?: string; clientId?: string; clientIds?: string[] } = {},
): Promise<string> {
  const body: Record<string, unknown> = { e: email.toLowerCase(), x: Math.floor(Date.now() / 1000) + ttl, r: role, a: extra.apps ?? [], n: extra.name ?? "" };
  if (role === "client") {
    const list = [...new Set([...(extra.clientIds ?? []), ...(extra.clientId ? [extra.clientId] : [])])];
    if (!list.length) throw new Error("Sessão de cliente exige ao menos uma empresa");
    body.c = list;
  }
  const payload = b64url(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign("HMAC", await key(secretOrThrow(secret)), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret?: string): Promise<string | null> {
  return (await verifySessionFull(token, secret))?.email ?? null;
}

/** Sessão completa: e-mail, papel (admin = tudo; member = apps liberados; reviewer = só leitura) e apps. */
export async function verifySessionFull(token: string | undefined, secret?: string): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secretOrThrow(secret)), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { e: string; x: number; r?: string; a?: string[]; n?: string; c?: unknown };
    if (!data.e || data.x < Math.floor(Date.now() / 1000)) return null;
    // Token antigo (sem papel) = admin. Papel desconhecido = sessão inválida (nunca vira admin por engano).
    const known: Role[] = ["admin", "member", "reviewer", "client"];
    const role = data.r === undefined ? "admin" : (known as string[]).includes(data.r) ? (data.r as Role) : null;
    if (!role) return null;
    if (role === "client") {
      const list = Array.isArray(data.c) ? data.c.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
      if (!list.length) return null;
      return { email: data.e, role, apps: [], name: data.n ?? "", clientId: list[0], clientIds: list };
    }
    return { email: data.e, role, apps: Array.isArray(data.a) ? data.a : [], name: data.n ?? "" };
  } catch {
    return null;
  }
}

export function isAllowedAdmin(email: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Sessão válida: administradores precisam estar em ADMIN_EMAILS; membros e revisores vêm do cadastro. */
export function canAccess(sess: Session | null): boolean {
  if (!sess) return false;
  if (sess.role === "client") return Boolean(sess.clientId);
  return sess.role !== "admin" || isAllowedAdmin(sess.email);
}

/** Pode usar o aplicativo? (admin: todos; reviewer: só marketplaces; member: os liberados) */
export function canUseApp(sess: Session | null, appId: string): boolean {
  if (!canAccess(sess)) return false;
  if (sess!.role === "client") return false; // cliente só usa o Mapa
  if (sess!.role === "admin") return true;
  if (sess!.role === "reviewer") return appId === "marketplaces";
  return sess!.apps.includes(appId);
}

/** Usuário do cliente (área Mapa). Nunca é administrador: não acessa Central, apps nem rotas admin. */
export function isClientSession(sess: Session | null): sess is Session & { clientId: string; clientIds: string[] } {
  return Boolean(sess && sess.role === "client" && sess.clientId && sess.clientIds?.length);
}

/** Equipe Avanteza que pode ver o Mapa de um cliente em modo "Ver como cliente" (admin escreve em outro lugar; aqui só lê). */
export function canPreviewClients(sess: Session | null): boolean {
  return canAccess(sess) && (sess!.role === "admin" || sess!.role === "reviewer" || sess!.role === "member");
}

// ── Visualização "Ver como cliente": cookie próprio, assinado, ligado ao e-mail da equipe que o criou. Somente leitura. ──
export const VIEW_COOKIE = "avz_view";
export const VIEW_TTL_S = 2 * 3600;

export async function signViewToken(staffEmail: string, clientId: string, secret?: string, ttl = VIEW_TTL_S): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, e: staffEmail.toLowerCase(), c: clientId, x: Math.floor(Date.now() / 1000) + ttl })));
  const sig = await crypto.subtle.sign("HMAC", await key(secretOrThrow(secret)), enc.encode("view." + payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyViewToken(token: string | undefined, staffEmail: string, secret?: string): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secretOrThrow(secret)), fromB64url(sig), enc.encode("view." + payload));
    if (!ok) return null;
    const d = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { v?: number; e?: string; c?: string; x?: number };
    if (d.v !== 1 || !d.c || d.e !== staffEmail.toLowerCase() || !d.x || d.x < Math.floor(Date.now() / 1000)) return null;
    return d.c;
  } catch {
    return null;
  }
}

/** Caminhos que o usuário de cliente pode abrir (o resto é bloqueado no middleware). */
export function isMapaPath(path: string): boolean {
  return path === "/mapa" || path.startsWith("/mapa/");
}
