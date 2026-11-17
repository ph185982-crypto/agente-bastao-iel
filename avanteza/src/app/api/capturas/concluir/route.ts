// POST /api/capturas/concluir — conclui a ação do cliente que casa com o texto ("concluí X da Showman").
// API de serviço com AVANTEZA_CAPTURE_KEY; ação ambígua → 409 com opcoes (o Max confirma e reenvia com acaoId).
import { handleConcluir } from "@/lib/motor/pendencias-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleConcluir(req);
}
