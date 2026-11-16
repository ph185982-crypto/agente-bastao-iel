// APIs de serviço (máquina → máquina) da Central: chave em Authorization: Bearer <chave>.
// Sem a variável no ambiente → 503; chave errada → 401 (comparação em tempo constante: as duas passam por SHA-256 antes do
// timingSafeEqual, então nem o tamanho vaza). A chave nunca vai para log nem para resposta.
import { createHash, timingSafeEqual } from "node:crypto";

export function chaveConfere(recebida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b) && recebida.length === esperada.length;
}

export const jsonResp = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Devolve a resposta de recusa (503/401) ou null quando a chave confere. */
export function autorizarServico(req: Request, variavel: string): Response | null {
  const chave = process.env[variavel]?.trim();
  if (!chave) return jsonResp({ error: `${variavel} não configurada` }, 503);
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!chaveConfere(bearer, chave)) return jsonResp({ error: "não autorizado" }, 401);
  return null;
}
