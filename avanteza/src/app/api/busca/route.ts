// Busca global da equipe (paleta Ctrl/Cmd+K). Sessão obrigatória; cliente do Mapa nunca (o middleware já barra com 403 e a
// função recusa de novo). GET ?q=<texto, 2..80>&limite=<1..10>&grupos=clientes (opcional). Somente leitura, sem cache.
import { currentSession } from "@/lib/auth";
import { buscar, BuscaNegada } from "@/lib/busca";
import type { GrupoId } from "@/lib/busca/tipos";

export const dynamic = "force-dynamic";
const json = (o: unknown, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
const GRUPOS: GrupoId[] = ["clientes", "acoes", "aprovacoes", "oportunidades", "contatos", "contratos"];

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const grupos = sp.get("grupos")?.split(",").filter((g): g is GrupoId => (GRUPOS as string[]).includes(g));
  try {
    return json(await buscar(await currentSession(), sp.get("q"), { limite: Number(sp.get("limite") ?? undefined) || undefined, grupos: grupos?.length ? grupos : undefined }));
  } catch (e) {
    if (e instanceof BuscaNegada) return json({ error: "não autorizado" }, 401);
    return json({ error: "Busca indisponível no momento." }, 500);
  }
}
