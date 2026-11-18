// Servidor MCP da Central (conector personalizado do Claude): https://app.avanteza.com.br/api/mcp
// Autenticação: OAuth (src/lib/mcp/oauth.ts) — Bearer com access token assinado que carrega o e-mail de quem autorizou.
// A cada chamada o usuário é conferido no banco (administrador ativo em ADMIN_EMAILS); senão, 401. As ferramentas ficam em
// src/lib/mcp/ferramentas.ts e agem em nome desse e-mail (auditoria com via "claude").
import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { usuarioDoMcp } from "@/lib/mcp/acesso";
import { mcpConfigurado, origem, subDoBearer } from "@/lib/mcp/oauth";
import { ErroFerramenta, executarFerramenta, FERRAMENTAS, type Ator } from "@/lib/mcp/ferramentas";

export const dynamic = "force-dynamic";
// "Atualizar agora" dos canais pode levar ~1,5 min (coleta + backfill).
export const maxDuration = 150;

const texto = (dado: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(dado) }] });
const erro = (msg: string) => ({ isError: true, content: [{ type: "text" as const, text: JSON.stringify({ erro: msg }) }] });

// Um único handler (o mcp-handler mantém estado de módulo); o ator de cada requisição vai pelo AsyncLocalStorage.
const atorDaVez = new AsyncLocalStorage<Ator>();

const handler = createMcpHandler(
  (server) => {
    for (const f of FERRAMENTAS) {
      server.registerTool(
        f.nome,
        {
          title: f.titulo,
          description: f.descricao,
          inputSchema: f.entrada,
          annotations: { title: f.titulo, readOnlyHint: !f.escrita, destructiveHint: false, idempotentHint: !f.escrita, openWorldHint: false },
        },
        async (args: unknown) => {
          const ator = atorDaVez.getStore();
          if (!ator) return erro("Sessão do conector ausente. Conecte de novo.");
          try {
            return texto(await executarFerramenta(f.nome, ator, args));
          } catch (e) {
            if (e instanceof ErroFerramenta) return erro(e.message);
            console.error(`[mcp] ${f.nome} falhou:`, e instanceof Error ? e.message.slice(0, 200) : "erro");
            return erro("Falha inesperada na Central. Tente de novo em instantes.");
          }
        },
      );
    }
  },
  { serverInfo: { name: "avanteza-central", version: "1.0.0" } },
  // Caminho literal (sem app/[transport]); sem SSE (não precisa de Redis). basePath fica de fora de propósito.
  { streamableHttpEndpoint: "/api/mcp", disableSse: true, maxDuration, verboseLogs: false },
);

function naoAutorizado(req: Request, invalido: boolean) {
  const meta = `${origem(req)}/.well-known/oauth-protected-resource/api/mcp`;
  return Response.json(
    { error: invalido ? "invalid_token" : "unauthorized", error_description: "Conecte de novo o conector da Avanteza no Claude." },
    { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${meta}"${invalido ? ', error="invalid_token"' : ""}`, "cache-control": "no-store" } },
  );
}

async function atender(req: Request) {
  if (!mcpConfigurado()) return Response.json({ error: "Conector do Claude não configurado (AVANTEZA_MCP_SECRET)." }, { status: 503 });
  const auth = req.headers.get("authorization");
  const sub = subDoBearer(auth);
  if (!sub) return naoAutorizado(req, Boolean(auth));
  const sessao = await usuarioDoMcp(sub);
  if (!sessao) return naoAutorizado(req, true);
  return atorDaVez.run({ email: sessao.email, sessao }, () => handler(req));
}

export const POST = atender;
export const GET = atender;
export const DELETE = atender;
