// Lógica da rota POST /api/mapa/reunioes (separada para ser testável sem o Next).
import { z } from "zod";
import { safeEqual } from "../crypto";
import { adminDb } from "../db";
import { SESSION_COOKIE, canAccess, verifySessionFull } from "../session";
import { ingestMeeting, type IngestDeps } from "./meetings";

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientSlug: z.string().min(1).max(80).optional(),
  title: z.string(),
  heldAt: z.string(),
  recordingUrl: z.string().nullish(),
  transcriptUrl: z.string().nullish(),
  transcript: z.string().nullish(),
}).refine((b) => b.clientId || b.clientSlug, { message: "Informe clientId ou clientSlug" });

/** Quem pode chamar: CRON_SECRET (automação) ou administrador logado. Cliente e demais papéis: nunca. */
export async function authorizeIngest(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (secret && bearer && safeEqual(bearer, secret)) return true;
  if (bearer) return false;
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  const sess = await verifySessionFull(m?.[1]).catch(() => null);
  return Boolean(sess && sess.role === "admin" && canAccess(sess));
}

export async function handleIngest(req: Request, deps: IngestDeps = {}): Promise<Response> {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (!(await authorizeIngest(req))) return json({ error: "não autorizado" }, 401);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Use Content-Type: application/json" }, 415);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "Dados inválidos", detalhes: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  const b = parsed.data;
  let clientId = b.clientId;
  if (!clientId) {
    const { data } = await adminDb().from("clients").select("id").eq("slug", b.clientSlug!).maybeSingle();
    if (!data) return json({ error: "Cliente não encontrado" }, 404);
    clientId = data.id;
  }
  try {
    const r = await ingestMeeting({ clientId: clientId!, title: b.title, heldAt: b.heldAt, recordingUrl: b.recordingUrl, transcriptUrl: b.transcriptUrl, transcript: b.transcript }, deps);
    return json(r);
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: "Dados inválidos", detalhes: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    return json({ error: e instanceof Error ? e.message : "Falha" }, 422);
  }
}
