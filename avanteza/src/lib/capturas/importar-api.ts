// POST /api/capturas/importar?cliente=<nome>&arquivo=<nome.zip|.txt> — o Max repassa a conversa exportada do WhatsApp.
// API de serviço com AVANTEZA_CAPTURE_KEY. Corpo = o arquivo cru (text/plain, application/zip ou application/octet-stream),
// até 4 MB. Sem `cliente`, usa o cliente lembrado para essa conversa/grupo; sem nenhum → 400 pedindo o cliente.
import { autorizarServico, jsonResp } from "../servico";
import { resolverCliente, notificarCaptura } from "../motor/capturas-api";
import { isUuid } from "../motor/repo";
import type { AiProvider } from "../ai/provider";
import { clienteLembrado, importarConversa, ImportacaoErro, LIMITE_ARQUIVO, lerArquivo } from "./importar";
import type { Transcritor } from "./transcricao";

const TIPOS = ["text/plain", "application/zip", "application/x-zip-compressed", "application/octet-stream"];

export async function handleImportar(req: Request, deps: { provider?: AiProvider; transcrever?: Transcritor | null; hoje?: string } = {}): Promise<Response> {
  const negado = autorizarServico(req, "AVANTEZA_CAPTURE_KEY");
  if (negado) return negado;
  const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS.includes(ct)) return jsonResp({ error: "Envie o arquivo cru (text/plain ou application/zip)" }, 415);
  if (Number(req.headers.get("content-length") ?? 0) > LIMITE_ARQUIVO) return jsonResp({ error: "Arquivo acima de 4 MB: exporte “sem mídia”." }, 413);
  const url = new URL(req.url);
  const nome = (url.searchParams.get("arquivo") ?? "conversa.txt").slice(0, 200);
  const cliente = (url.searchParams.get("cliente") ?? "").trim().slice(0, 120);
  const buf = Buffer.from(await req.arrayBuffer());
  try {
    let clientId: string;
    if (cliente) {
      const cli = await resolverCliente(isUuid(cliente) ? { clienteId: cliente } : { clienteNome: cliente });
      if ("erro" in cli) return jsonResp({ error: cli.erro, ...(cli.candidatos ? { candidatos: cli.candidatos } : {}) }, cli.status);
      clientId = cli.id;
    } else {
      const lembrado = await clienteLembrado(lerArquivo(buf, nome).conversa);
      if (!lembrado) return jsonResp({ error: "Diga de qual cliente é esta conversa", titulo: lerArquivo(buf, nome).conversa.titulo }, 400);
      clientId = lembrado.id;
    }
    const r = await importarConversa({ clientId, buf, nome, actor: "max:whatsapp" }, deps);
    if (r.novas) await notificarCaptura(clientId, "whatsapp_export", r.acoesCriadas, ` (${r.novas} mensagem(ns) nova(s) de “${r.titulo ?? "conversa"}”)`).catch(() => undefined);
    return jsonResp(r, r.novas ? 201 : 200);
  } catch (e) {
    if (e instanceof ImportacaoErro) return jsonResp({ error: e.message }, e.status);
    return jsonResp({ error: "Falha ao importar a conversa" }, 422);
  }
}
