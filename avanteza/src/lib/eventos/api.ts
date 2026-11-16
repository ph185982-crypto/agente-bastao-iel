// Lógica da rota POST /api/eventos (separada para ser testável sem o Next).
// API de serviço: Authorization: Bearer {AVANTEZA_EVENTS_KEY}. Sem a variável → 503; chave errada → 401 (tempo constante).
// Respostas: 202 recebido (e já processado na hora, quando possível), 200 duplicado (mesmo id), 400/415/422 recusado.
import { autorizarServico, jsonResp } from "../servico";
import { processarEvento, receberEvento, validarEvento } from "./barramento";
import type { DepsEvento } from "./registro";

export async function handleEvento(req: Request, deps: DepsEvento & { processarAgora?: boolean } = {}): Promise<Response> {
  const negado = autorizarServico(req, "AVANTEZA_EVENTS_KEY");
  if (negado) return negado;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return jsonResp({ error: "Use Content-Type: application/json" }, 415);
  const tamanho = Number(req.headers.get("content-length") ?? 0);
  if (tamanho > 256_000) return jsonResp({ error: "Evento grande demais" }, 413);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResp({ error: "JSON inválido" }, 400);
  }
  const v = validarEvento(raw);
  if (!v.ok) return jsonResp({ error: v.erro, ...(v.detalhes ? { detalhes: v.detalhes } : {}) }, v.status);
  const r = await receberEvento(v.evento);
  if (r.duplicado) return jsonResp({ id: r.id, duplicado: true, status: r.status }, 200);
  let status = "pendente";
  if (deps.processarAgora !== false) {
    try {
      const p = await processarEvento(r.id, deps);
      if (p) status = p.status;
    } catch {
      // fica na fila: o cron "eventos" tenta de novo
    }
  }
  return jsonResp({ id: r.id, duplicado: false, status }, 202);
}
