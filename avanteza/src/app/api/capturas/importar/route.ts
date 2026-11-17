// POST /api/capturas/importar — conversa exportada do WhatsApp (.txt/.zip, até 4 MB) enviada pelo Max.
// API de serviço com AVANTEZA_CAPTURE_KEY. Ver src/lib/capturas/importar-api.ts.
import { handleImportar } from "@/lib/capturas/importar-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  return handleImportar(req);
}
