// POST /api/capturas — Inbox de combinados (conversa → ações do cliente). API de serviço com AVANTEZA_CAPTURE_KEY.
import { handleCaptura } from "@/lib/motor/capturas-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return handleCaptura(req);
}
