// Metadados do recurso protegido (RFC 9728), servidos em /.well-known/oauth-protected-resource[/api/mcp] (reescrita no next.config).
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
    { resource: `${o}/api/mcp`, authorization_servers: [o], bearer_methods_supported: ["header"], resource_name: "Avanteza" },
    { headers: CORS },
  );
}
