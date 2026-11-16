// POST /api/mapa/reunioes — recebe uma reunião (e a transcrição), extrai resumo/decisões/ações e grava no plano.
// Protegida: "Authorization: Bearer <CRON_SECRET>" ou sessão de administrador.
import { handleIngest } from "@/lib/mapa/reunioes-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return handleIngest(req);
}
