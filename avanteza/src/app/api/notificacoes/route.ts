// Sino de notificações da equipe (AppShell). Sessão obrigatória (o middleware barra sem login e o cliente do Mapa).
//   GET  → últimas notificações e quantas não lidas
//   POST {acao: "lida", id} | {acao: "todas"} | {acao: "revelar", id} (senha inicial do cliente, uma única vez, só admin)
import { currentSession } from "@/lib/auth";
import { listarNotificacoes, marcarLida, podeVerNotificacoes, revelarSegredo } from "@/lib/notificacoes";
import { isUuid } from "@/lib/motor/repo";

export const dynamic = "force-dynamic";
const json = (o: unknown, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });

export async function GET() {
  const s = await currentSession();
  if (!podeVerNotificacoes(s)) return json({ error: "não autorizado" }, 401);
  return json(await listarNotificacoes(s));
}

export async function POST(req: Request) {
  const s = await currentSession();
  if (!podeVerNotificacoes(s)) return json({ error: "não autorizado" }, 401);
  // mesma origem (o sino só chama daqui); evita POST de outro site com o cookie
  const origem = req.headers.get("origin");
  if (origem && new URL(origem).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host)) return json({ error: "origem recusada" }, 403);
  const b = (await req.json().catch(() => ({}))) as { acao?: string; id?: string };
  if (b.acao === "todas") { await marcarLida(s, "todas"); return json({ ok: true }); }
  if (!isUuid(b.id)) return json({ error: "id inválido" }, 400);
  if (b.acao === "lida") { await marcarLida(s, b.id); return json({ ok: true }); }
  if (b.acao === "revelar") {
    const segredo = await revelarSegredo(s, b.id);
    return segredo ? json({ segredo }) : json({ error: "Senha já exibida (ou indisponível). Use “Redefinir senha” na tela do cliente." }, 410);
  }
  return json({ error: "ação desconhecida" }, 400);
}
