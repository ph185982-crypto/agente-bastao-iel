// Troca do código (com PKCE) e renovação. Em ambos, o usuário (sub) precisa CONTINUAR administrador ativo no cadastro.
import { usuarioDoMcp } from "@/lib/mcp/acesso";
import { emitirTokens, mcpConfigurado, pkceConfere, verificar } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
const H = { "Access-Control-Allow-Origin": "*", "cache-control": "no-store" };
const erro = (error: string, status = 400, error_description?: string) => Response.json({ error, ...(error_description ? { error_description } : {}) }, { status, headers: H });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...H, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" } });
}

export async function POST(req: Request) {
  if (!mcpConfigurado()) return erro("temporarily_unavailable", 503, "AVANTEZA_MCP_SECRET não configurado");
  const f = new URLSearchParams(await req.text().catch(() => ""));
  const grant = f.get("grant_type");

  if (grant === "authorization_code") {
    const c = verificar(f.get("code"), "code");
    if (!c || f.get("redirect_uri") !== c.uri || f.get("client_id") !== c.cid) return erro("invalid_grant");
    if (!pkceConfere(f.get("code_verifier") ?? "", String(c.ch))) return erro("invalid_grant", 400, "PKCE não confere.");
    if (!(await usuarioDoMcp(String(c.sub)))) return erro("invalid_grant", 400, "Usuário sem acesso de administrador.");
    return Response.json(emitirTokens(String(c.cid), String(c.sub)), { headers: H });
  }
  if (grant === "refresh_token") {
    const r = verificar(f.get("refresh_token"), "refresh");
    if (!r || (f.get("client_id") && f.get("client_id") !== r.cid)) return erro("invalid_grant");
    if (!(await usuarioDoMcp(String(r.sub)))) return erro("invalid_grant", 400, "Usuário sem acesso de administrador.");
    return Response.json(emitirTokens(String(r.cid), String(r.sub)), { headers: H });
  }
  return erro("unsupported_grant_type");
}
