// Metadados do servidor de autorização (RFC 8414), servidos em /.well-known/oauth-authorization-server (reescrita no next.config).
import { mcpConfigurado, origem } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "cache-control": "no-store" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET" } });
}

export function GET(req: Request) {
  if (!mcpConfigurado()) return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: CORS });
  const o = origem(req);
  return Response.json(
    {
      issuer: o,
      authorization_endpoint: `${o}/api/oauth/authorize`,
      token_endpoint: `${o}/api/oauth/token`,
      registration_endpoint: `${o}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: CORS },
  );
}
