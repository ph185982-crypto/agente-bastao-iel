// Lógica da rota POST /api/capturas (separada para ser testável sem o Next).
// API de serviço: Authorization: Bearer {AVANTEZA_CAPTURE_KEY}. Sem a variável → 503; chave errada → 401 (comparação em
// tempo constante: as duas chaves passam por SHA-256 antes do timingSafeEqual, então o tamanho não vaza). Quem chama: o Max (F2).
import { z } from "zod";
import { rawQuery } from "../db/client";
import { ORIGENS, ingestCaptura } from "./capturas";
import type { AiProvider } from "../ai/provider";
import { autorizarServico, chaveConfere, jsonResp } from "../servico";
import { notificar } from "../notificacoes";

export { chaveConfere };

const Body = z.object({
  clienteId: z.string().uuid().optional(),
  clienteSlug: z.string().min(1).max(80).optional(),
  clienteNome: z.string().min(2).max(120).optional(),
  origem: z.enum(ORIGENS),
  autor: z.string().max(120).nullish(),
  texto: z.string().max(50_000).nullish(),
  midiaUrl: z.string().max(2000).nullish(),
  transcricao: z.string().max(100_000).nullish(),
  data: z.string().nullish(),
}).refine((b) => b.clienteId || b.clienteSlug || b.clienteNome, { message: "Informe clienteId, clienteSlug ou clienteNome" });

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Resolve o cliente por id, slug ou nome (sem acento, sem caixa; aceita trecho do nome se só um cliente bater). */
export async function resolverCliente(b: { clienteId?: string; clienteSlug?: string; clienteNome?: string }): Promise<{ id: string } | { erro: string; status: number; candidatos?: string[] }> {
  if (b.clienteId) {
    const r = await rawQuery<{ id: string }>("select id from avanteza.clients where id = $1 and active", [b.clienteId]);
    return r[0] ?? { erro: "Cliente não encontrado", status: 404 };
  }
  if (b.clienteSlug) {
    const r = await rawQuery<{ id: string }>("select id from avanteza.clients where slug = $1 and active", [b.clienteSlug.toLowerCase()]);
    return r[0] ?? { erro: "Cliente não encontrado", status: 404 };
  }
  const alvo = semAcento(b.clienteNome!);
  const todos = await rawQuery<{ id: string; name: string }>("select id, name from avanteza.clients where active");
  const exatos = todos.filter((c) => semAcento(c.name) === alvo);
  if (exatos.length === 1) return { id: exatos[0].id };
  const parecidos = todos.filter((c) => semAcento(c.name).includes(alvo) || alvo.includes(semAcento(c.name)));
  if (parecidos.length === 1) return { id: parecidos[0].id };
  if (parecidos.length > 1) return { erro: "Mais de um cliente com esse nome: diga qual", status: 409, candidatos: parecidos.map((c) => c.name) };
  return { erro: "Cliente não encontrado", status: 404 };
}

export async function handleCaptura(req: Request, deps: { provider?: AiProvider; hoje?: string } = {}): Promise<Response> {
  const json = jsonResp;
  const negado = autorizarServico(req, "AVANTEZA_CAPTURE_KEY");
  if (negado) return negado;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Use Content-Type: application/json" }, 415);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const p = Body.safeParse(raw);
  if (!p.success) return json({ error: "Dados inválidos", detalhes: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  const cli = await resolverCliente(p.data);
  if ("erro" in cli) return json({ error: cli.erro, ...(cli.candidatos ? { candidatos: cli.candidatos } : {}) }, cli.status);
  try {
    const r = await ingestCaptura({ origem: p.data.origem, clientId: cli.id, autor: p.data.autor, texto: p.data.texto, midiaUrl: p.data.midiaUrl, transcricao: p.data.transcricao, data: p.data.data }, deps);
    if (!r.duplicada) await notificarCaptura(cli.id, p.data.origem, r.acoesCriadas).catch(() => undefined);
    return json(r, r.duplicada ? 200 : 201);
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: "Dados inválidos", detalhes: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    return json({ error: "Falha ao registrar a captura" }, 422);
  }
}

export async function notificarCaptura(clientId: string, origem: string, acoes: number, extra = "") {
  const [c] = await rawQuery<{ name: string }>("select name from avanteza.clients where id = $1", [clientId]);
  const via: Record<string, string> = { whatsapp_max: "pelo Max (WhatsApp)", whatsapp_export: "por conversa exportada", extensao: "pela extensão", reuniao: "de reunião", manual: "manualmente" };
  await notificar({
    tipo: "captura", para: "equipe", clientId, link: `/operacoes/capturas?cliente=${clientId}`,
    titulo: `Captura registrada: ${c?.name ?? "cliente"}`,
    corpo: `Recebida ${via[origem] ?? origem}${extra}. ${acoes ? `${acoes} ação(ões) criada(s) pela IA.` : "Nenhuma ação nova."}`,
  });
}
