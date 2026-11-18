// OAuth 2.1 sem estado (PKCE S256 + registro dinâmico) para o conector do Claude (claude.ai → Conectores → "Adicionar
// conector personalizado"). Igual ao do Vendedor IA, com duas diferenças: o login é a sessão do Avanteza ID (não uma chave
// compartilhada) e todo código/token carrega `sub` = e-mail de quem autorizou.
//
// client_id, código, form de consentimento, access e refresh são payloads assinados com HMAC — nenhuma tabela nova. A chave
// vem de AVANTEZA_MCP_SECRET; sem ela, TODAS as rotas OAuth/MCP respondem 503. Trocar o segredo invalida tudo de uma vez.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const TTL_CODIGO = 5 * 60;
export const TTL_FORM = 10 * 60;
export const TTL_CLIENTE = 60 * 60 * 24 * 365;
export const TTL_ACESSO = 60 * 60 * 24 * 30; // 30 dias
export const TTL_REFRESH = 60 * 60 * 24 * 180; // 180 dias

/** Únicos destinos aceitos (além de http://localhost e http://127.0.0.1, para o MCP Inspector). */
export const REDIRECTS_CLAUDE = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"] as const;

export type Tipo = "client" | "code" | "form" | "access" | "refresh";
export interface Payload {
  t: Tipo;
  exp: number;
  [k: string]: unknown;
}

export function mcpConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AVANTEZA_MCP_SECRET?.trim());
}

function chave(): string | null {
  const s = process.env.AVANTEZA_MCP_SECRET?.trim();
  return s ? createHmac("sha256", s).update("avanteza-mcp-oauth-v1").digest("hex") : null;
}

export const agora = () => Math.floor(Date.now() / 1000);

export function assinar(p: Payload): string {
  const k = chave();
  if (!k) throw new Error("AVANTEZA_MCP_SECRET não configurado");
  const corpo = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${corpo}.${createHmac("sha256", k).update(corpo).digest("base64url")}`;
}

export function verificar(token: string | null | undefined, tipo: Tipo): Payload | null {
  const k = chave();
  if (!k || !token || token.length > 8192) return null;
  const [corpo, sig, sobra] = token.split(".");
  if (!corpo || !sig || sobra !== undefined) return null;
  if (!iguais(sig, createHmac("sha256", k).update(corpo).digest("base64url"))) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, "base64url").toString()) as Payload;
    return p.t === tipo && typeof p.exp === "number" && p.exp > agora() ? p : null;
  } catch {
    return null;
  }
}

/** Comparação em tempo constante (hash antes, para não vazar o tamanho). */
export function iguais(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function pkceConfere(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return iguais(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

/** Origem pública (https://host) a partir dos headers da requisição. */
export function origem(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** redirect_uri aceito: os dois callbacks do Claude (exatos) ou http://localhost / http://127.0.0.1 em qualquer porta. */
export function redirectAceito(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  if ((REDIRECTS_CLAUDE as readonly string[]).includes(uri)) return true;
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && !u.username && !u.password && !u.hash;
  } catch {
    return false;
  }
}

export function emitirTokens(clientId: string, sub: string) {
  const t = agora();
  return {
    access_token: assinar({ t: "access", exp: t + TTL_ACESSO, cid: clientId, sub }),
    token_type: "Bearer",
    expires_in: TTL_ACESSO,
    refresh_token: assinar({ t: "refresh", exp: t + TTL_REFRESH, cid: clientId, sub }),
  };
}

/** E-mail (sub) do access token do header Authorization, ou null. */
export function subDoBearer(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const p = verificar(authorization.slice(7).trim(), "access");
  return p && typeof p.sub === "string" && p.sub ? p.sub : null;
}

// ─── Pedido de autorização ───────────────────────────────────────────────────

export interface ParamsAutorizacao {
  client_id: string; redirect_uri: string; response_type: string; code_challenge: string; code_challenge_method: string; state: string;
}
export const CAMPOS_AUTORIZACAO: (keyof ParamsAutorizacao)[] = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state"];

export function lerParams(get: (k: string) => unknown): ParamsAutorizacao {
  const v = (k: string) => { const x = get(k); return typeof x === "string" ? x.slice(0, 4096) : ""; };
  return Object.fromEntries(CAMPOS_AUTORIZACAO.map((k) => [k, v(k)])) as unknown as ParamsAutorizacao;
}

export function queryDosParams(p: ParamsAutorizacao): string {
  return new URLSearchParams(CAMPOS_AUTORIZACAO.filter((k) => p[k]).map((k) => [k, p[k]])).toString();
}

/** Confere o pedido: cliente registrado (assinado), redirect_uri registrado E permitido, response_type=code e PKCE S256. */
export function validarPedido(p: ParamsAutorizacao): { erro: string } | { nomeCliente: string } {
  const c = verificar(p.client_id, "client");
  if (!c) return { erro: "Cliente não registrado ou expirado." };
  const uris = Array.isArray(c.uris) ? (c.uris as unknown[]) : [];
  if (!uris.includes(p.redirect_uri) || !redirectAceito(p.redirect_uri)) return { erro: "redirect_uri não registrado." };
  if (p.response_type !== "code") return { erro: "response_type inválido (use code)." };
  if (p.code_challenge_method !== "S256" || !/^[A-Za-z0-9\-_]{43,128}$/.test(p.code_challenge)) return { erro: "PKCE (S256) é obrigatório." };
  if (p.state.length > 1000) return { erro: "state grande demais." };
  return { nomeCliente: typeof c.nome === "string" && c.nome ? c.nome : "Cliente MCP" };
}

const hashParams = (p: ParamsAutorizacao) => createHash("sha256").update(JSON.stringify(CAMPOS_AUTORIZACAO.map((k) => p[k]))).digest("base64url");

/** Token do formulário de consentimento (anti-CSRF): curto, ligado ao e-mail da sessão e aos parâmetros exatos do pedido. */
export function tokenDoFormulario(email: string, p: ParamsAutorizacao): string {
  return assinar({ t: "form", exp: agora() + TTL_FORM, sub: email.toLowerCase(), h: hashParams(p) });
}

export function formularioConfere(token: string | null | undefined, email: string, p: ParamsAutorizacao): boolean {
  const f = verificar(token, "form");
  return Boolean(f && f.sub === email.toLowerCase() && typeof f.h === "string" && iguais(f.h, hashParams(p)));
}

export function emitirCodigo(p: ParamsAutorizacao, email: string): string {
  return assinar({ t: "code", exp: agora() + TTL_CODIGO, cid: p.client_id, uri: p.redirect_uri, ch: p.code_challenge, sub: email.toLowerCase() });
}

/** Volta ao redirect_uri (já validado) com os parâmetros dados e o state. */
export function voltarAoCliente(p: ParamsAutorizacao, params: Record<string, string>): string {
  const u = new URL(p.redirect_uri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (p.state) u.searchParams.set("state", p.state);
  return u.toString();
}
