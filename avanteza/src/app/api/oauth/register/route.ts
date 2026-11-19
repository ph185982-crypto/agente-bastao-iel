// Registro dinâmico de cliente (RFC 7591), sem estado: o client_id é um payload assinado com os redirect_uris registrados.
// Só aceita os callbacks do Claude (claude.ai / claude.com) e http://localhost|127.0.0.1 (MCP Inspector); qualquer outro → 400.
import { agora, assinar, mcpConfigurado, redirectAceito, TTL_CLIENTE } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "cache-control": "no-store" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST" } });
}

export async function POST(req: Request) {
  if (!mcpConfigurado()) return Response.json({ error: "temporarily_unavailable", error_description: "AVANTEZA_MCP_SECRET não configurado" }, { status: 503, headers: CORS });
  const body = (await req.json().catch(() => ({}))) as { redirect_uris?: unknown; client_name?: unknown };
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectAceito)) {
    return Response.json({ error: "invalid_redirect_uri", error_description: "Só os callbacks do Claude ou http://localhost são aceitos." }, { status: 400, headers: CORS });
  }
  const nome = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "Cliente MCP";
  const client_id = assinar({ t: "client", exp: agora() + TTL_CLIENTE, uris, nome });
  return Response.json(
    {
      client_id, client_name: nome, redirect_uris: uris, client_id_issued_at: agora(),
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    },
    { status: 201, headers: CORS },
  );
}
