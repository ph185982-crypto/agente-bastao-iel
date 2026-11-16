// POST /api/eventos — barramento de eventos entre módulos (ex.: contrato.assinado). API de serviço com AVANTEZA_EVENTS_KEY.
// Contrato em docs/eventos.md. Idempotente pelo id do evento; o consumidor do cron ("eventos") retenta com backoff.
import { handleEvento } from "@/lib/eventos/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return handleEvento(req);
}
