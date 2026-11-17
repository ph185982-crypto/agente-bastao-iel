// GET /api/capturas/pendencias?cliente=<nome> — ações abertas do cliente (o Max responde "o que falta para a Ladies?").
// API de serviço com AVANTEZA_CAPTURE_KEY; cliente ambíguo → 409 com candidatos.
import { handlePendencias } from "@/lib/motor/pendencias-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handlePendencias(req);
}
