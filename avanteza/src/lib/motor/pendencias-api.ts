// APIs de serviço do Max (mesma chave AVANTEZA_CAPTURE_KEY de POST /api/capturas):
//   GET  /api/capturas/pendencias?cliente=<nome|slug>   → ações abertas do cliente ("o que falta para a Ladies?")
//   POST /api/capturas/concluir {cliente, acao | acaoId} → conclui a ação que casa com o texto ("concluí X da Showman")
// Cliente ambíguo → 409 com `candidatos`; ação ambígua → 409 com `opcoes` (o Max pergunta e reenvia com acaoId).
import { z } from "zod";
import { rawQuery } from "../db/client";
import { autorizarServico, jsonResp } from "../servico";
import { resolverCliente } from "./capturas-api";
import { acaoRapida, isUuid } from "./repo";
import { normalizarTitulo } from "./gerador";
import { spDate } from "../dates";

const PARADAS = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "para", "pra", "com", "um", "uma", "ao", "aos", "que", "se", "por", "the"]);
const palavras = (s: string) => normalizarTitulo(s).split(" ").filter((w) => w.length > 1 && !PARADAS.has(w));

/** Similaridade entre o que o dono disse e o título da ação (0–1): palavras em comum (com prefixo de 4+ letras) sobre as do pedido. */
export function similaridade(pedido: string, titulo: string): number {
  const a = palavras(pedido), b = palavras(titulo);
  if (!a.length || !b.length) return 0;
  const casa = (w: string) => b.some((x) => x === w || (w.length >= 4 && x.length >= 4 && (x.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(x.slice(0, Math.max(4, x.length - 2))))));
  const comuns = a.filter(casa).length;
  const cobertura = comuns / a.length; // quanto do pedido aparece no título
  const jaccard = comuns / (a.length + b.length - comuns); // desempata títulos mais "do tamanho" do pedido
  const inteiro = normalizarTitulo(titulo).includes(normalizarTitulo(pedido)) ? 1 : 0;
  return Math.max(cobertura * 0.8 + jaccard * 0.2, inteiro);
}

export interface AcaoAberta { id: string; titulo: string; prazo: string | null; status: string; responsavel: string; atrasada: boolean }

/** Escolhe a ação: uma clara (nota ≥ 0,5 e folga de 0,15 sobre a 2ª) ou a lista de opções parecidas (até 5). */
export function casarAcao(pedido: string, acoes: AcaoAberta[]): { acao: AcaoAberta } | { opcoes: AcaoAberta[] } | { nenhuma: true } {
  const notas = acoes.map((a) => ({ a, n: similaridade(pedido, a.titulo) })).filter((x) => x.n >= 0.34).sort((x, y) => y.n - x.n);
  if (!notas.length) return { nenhuma: true };
  if (notas[0].n >= 0.5 && (notas.length === 1 || notas[0].n - notas[1].n >= 0.15)) return { acao: notas[0].a };
  return { opcoes: notas.slice(0, 5).map((x) => x.a) };
}

export async function acoesAbertas(clientId: string, hoje = spDate()): Promise<AcaoAberta[]> {
  const r = await rawQuery<{ id: string; title: string; due_date: string | null; status: string; owner: string }>(
    `select id, title, due_date, status, owner from avanteza.plan_actions
      where client_id = $1 and archived_at is null and status <> 'concluida' order by due_date nulls last, priority, position limit 200`,
    [clientId],
  );
  return r.map((a) => ({ id: a.id, titulo: a.title, prazo: a.due_date, status: a.status, responsavel: a.owner, atrasada: Boolean(a.due_date && a.due_date < hoje) }));
}

const nomeDoCliente = async (id: string) => (await rawQuery<{ name: string }>("select name from avanteza.clients where id = $1", [id]))[0]?.name ?? "";

function clienteDoTexto(v: string): { clienteNome?: string; clienteSlug?: string; clienteId?: string } {
  if (isUuid(v)) return { clienteId: v };
  return { clienteNome: v };
}

export async function handlePendencias(req: Request, deps: { hoje?: string } = {}): Promise<Response> {
  const negado = autorizarServico(req, "AVANTEZA_CAPTURE_KEY");
  if (negado) return negado;
  const cliente = (new URL(req.url).searchParams.get("cliente") ?? "").trim();
  if (cliente.length < 2 || cliente.length > 120) return jsonResp({ error: "Informe ?cliente=<nome>" }, 400);
  const cli = await resolverCliente(clienteDoTexto(cliente));
  if ("erro" in cli) return jsonResp({ error: cli.erro, ...(cli.candidatos ? { candidatos: cli.candidatos } : {}) }, cli.status);
  const hoje = deps.hoje ?? spDate();
  const acoes = await acoesAbertas(cli.id, hoje);
  // Para o Max: atrasadas e da semana primeiro; o resto resumido na contagem.
  const relevantes = acoes.filter((a) => a.status === "bloqueada" || !a.prazo || a.prazo <= hoje || a.prazo <= addDias(hoje, 30));
  return jsonResp({
    cliente: { id: cli.id, nome: await nomeDoCliente(cli.id) },
    total: acoes.length,
    atrasadas: acoes.filter((a) => a.atrasada).length,
    doCliente: acoes.filter((a) => a.responsavel === "cliente").length,
    acoes: relevantes.slice(0, 25),
  });
}
const addDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const BodyConcluir = z.object({
  cliente: z.string().trim().min(2).max(120),
  acao: z.string().trim().min(2).max(300).optional(),
  acaoId: z.string().uuid().optional(),
  evidencia: z.string().trim().max(2000).optional(),
}).refine((b) => b.acao || b.acaoId, { message: "Informe acao (texto) ou acaoId" });

export async function handleConcluir(req: Request, deps: { hoje?: string } = {}): Promise<Response> {
  const negado = autorizarServico(req, "AVANTEZA_CAPTURE_KEY");
  if (negado) return negado;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return jsonResp({ error: "Use Content-Type: application/json" }, 415);
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonResp({ error: "JSON inválido" }, 400); }
  const p = BodyConcluir.safeParse(raw);
  if (!p.success) return jsonResp({ error: "Dados inválidos", detalhes: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  const cli = await resolverCliente(clienteDoTexto(p.data.cliente));
  if ("erro" in cli) return jsonResp({ error: cli.erro, ...(cli.candidatos ? { candidatos: cli.candidatos } : {}) }, cli.status);
  const acoes = await acoesAbertas(cli.id, deps.hoje);
  let alvo: AcaoAberta | undefined;
  if (p.data.acaoId) {
    alvo = acoes.find((a) => a.id === p.data.acaoId);
    if (!alvo) return jsonResp({ error: "Ação não encontrada entre as abertas deste cliente (já concluída?)" }, 404);
  } else {
    const c = casarAcao(p.data.acao!, acoes);
    if ("nenhuma" in c) return jsonResp({ error: "Nenhuma ação aberta parecida com isso", cliente: await nomeDoCliente(cli.id) }, 404);
    if ("opcoes" in c) return jsonResp({ error: "Mais de uma ação parecida: confirme qual", opcoes: c.opcoes }, 409);
    alvo = c.acao;
  }
  const ev = p.data.evidencia && /^https?:\/\/\S+$/i.test(p.data.evidencia) ? p.data.evidencia : null;
  const r = await acaoRapida("max:whatsapp", alvo.id, { tipo: "concluir", evidencia: ev });
  if (!r.ok) return jsonResp({ error: r.erro ?? "Não foi possível concluir" }, 422);
  return jsonResp({ cliente: { id: cli.id, nome: await nomeDoCliente(cli.id) }, concluida: { id: alvo.id, titulo: alvo.titulo } });
}
