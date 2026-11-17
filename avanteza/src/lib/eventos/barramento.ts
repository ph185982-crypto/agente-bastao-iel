// Barramento de eventos da Central: entrada idempotente (id determinístico) e consumidor com retentativa e backoff.
// Tipos registrados em TIPOS (cada um com schema do payload e handler idempotente). Contrato em docs/eventos.md.
import { z } from "zod";
import { rawQuery } from "../db/client";
import { notificar } from "../notificacoes";
import { EnvelopeSchema, type DepsEvento, type Envelope, type TipoEvento } from "./registro";
import { tipoContratoAssinado } from "./contrato-assinado";

export const TIPOS: Record<string, TipoEvento<any>> = {
  [tipoContratoAssinado.tipo]: tipoContratoAssinado,
};

/** Tentativas antes de desistir (status "falhou" + notificação ao admin). */
export const MAX_TENTATIVAS = 8;
/** Espera depois da n-ésima falha: 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h (teto). */
export function atrasoBackoffMs(tentativas: number): number {
  const passos = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000];
  return passos[Math.min(Math.max(tentativas, 1), passos.length) - 1];
}

export type Validacao = { ok: true; evento: Envelope } | { ok: false; status: number; erro: string; detalhes?: string[] };

/** Confere envelope, tipo registrado, payload do tipo e a ligação id ↔ payload. */
export function validarEvento(raw: unknown): Validacao {
  const e = EnvelopeSchema.safeParse(raw);
  if (!e.success) return { ok: false, status: 400, erro: "Evento inválido", detalhes: e.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const tipo = TIPOS[e.data.tipo];
  if (!tipo) return { ok: false, status: 422, erro: `Tipo de evento desconhecido: ${e.data.tipo}` };
  const p = tipo.payload.safeParse(e.data.payload);
  if (!p.success) return { ok: false, status: 400, erro: "Payload inválido", detalhes: (p.error as z.ZodError).issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  const erroId = tipo.validarId?.(e.data.id, p.data);
  if (erroId) return { ok: false, status: 400, erro: erroId };
  return { ok: true, evento: { ...e.data, payload: p.data as Record<string, unknown> } };
}

/** Grava o evento. Mesmo id = mesmo evento: a 2ª entrega não grava nada (duplicado = true). */
export async function receberEvento(ev: Envelope): Promise<{ id: string; duplicado: boolean; status: string }> {
  const r = await rawQuery<{ id: string }>(
    `insert into avanteza.eventos (id, tipo, origem, ocorrido_em, payload) values ($1,$2,$3,$4,$5) on conflict (id) do nothing returning id`,
    [ev.id, ev.tipo, ev.origem, ev.ocorrido_em ?? null, JSON.stringify(ev.payload)],
  );
  if (r.length) {
    await rawQuery("insert into avanteza.audit_log (event, actor, details) values ('evento_recebido', $1, $2)", [`origem:${ev.origem}`, JSON.stringify({ id: ev.id, tipo: ev.tipo })]);
    return { id: ev.id, duplicado: false, status: "pendente" };
  }
  const [prev] = await rawQuery<{ status: string }>("select status from avanteza.eventos where id = $1", [ev.id]);
  return { id: ev.id, duplicado: true, status: prev?.status ?? "pendente" };
}

interface LinhaEvento { id: string; tipo: string; origem: string; ocorrido_em: string | null; payload: Record<string, unknown>; tentativas: number }

/** Reserva um evento (a reserva dura 10 min: se o processo morrer, outro consumidor pega depois). */
async function reservar(id?: string): Promise<LinhaEvento | null> {
  const r = await rawQuery<LinhaEvento>(
    `update avanteza.eventos e set tentativas = e.tentativas + 1, proxima_tentativa_em = now() + interval '10 minutes'
      where e.id = (select id from avanteza.eventos where status = 'pendente' and proxima_tentativa_em <= now() ${id ? "and id = $1" : ""}
                     order by recebido_em limit 1 for update skip locked)
      returning e.id, e.tipo, e.origem, to_char(e.ocorrido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ocorrido_em, e.payload, e.tentativas`,
    id ? [id] : [],
  );
  return r[0] ?? null;
}

export interface ResultadoProcessamento { id: string; status: "processado" | "pendente" | "falhou"; pendencias?: string[]; erro?: string; resultado?: Record<string, unknown> }

async function executar(ev: LinhaEvento, deps: DepsEvento): Promise<ResultadoProcessamento> {
  const tipo = TIPOS[ev.tipo];
  let pendencias: string[] = [];
  let resultado: Record<string, unknown> = {};
  let erro: string | null = null;
  try {
    if (!tipo) throw new Error(`Tipo sem handler: ${ev.tipo}`);
    const payload = tipo.payload.parse(ev.payload);
    const r = await tipo.handler({ id: ev.id, tipo: ev.tipo, origem: ev.origem, ocorrido_em: ev.ocorrido_em ?? undefined, payload }, deps);
    pendencias = r.pendencias;
    resultado = r.resultado;
  } catch (e) {
    erro = e instanceof Error ? e.message.slice(0, 500) : "Falha no processamento";
  }
  if (!erro && !pendencias.length) {
    await rawQuery("update avanteza.eventos set status = 'processado', processado_em = now(), erro = null, resultado = $2 where id = $1", [ev.id, JSON.stringify(resultado)]);
    return { id: ev.id, status: "processado", resultado };
  }
  const msg = erro ?? pendencias.join("; ").slice(0, 500);
  if (ev.tentativas >= MAX_TENTATIVAS) {
    await rawQuery("update avanteza.eventos set status = 'falhou', erro = $2, resultado = $3 where id = $1", [ev.id, msg, JSON.stringify(resultado)]);
    await notificar({ tipo: "evento_falhou", titulo: `Evento com falha: ${ev.tipo}`, corpo: `${msg} (depois de ${ev.tentativas} tentativas). Reprocesse em Operações → Onboarding.`, link: "/operacoes/onboarding", para: "admin", dedupKey: `evento-falhou:${ev.id}:${ev.tentativas}` });
    await rawQuery("insert into avanteza.audit_log (event, actor, details) values ('evento_falhou', 'barramento', $1)", [JSON.stringify({ id: ev.id, tentativas: ev.tentativas })]);
    return { id: ev.id, status: "falhou", erro: msg, pendencias };
  }
  await rawQuery(
    "update avanteza.eventos set erro = $2, resultado = $3, proxima_tentativa_em = now() + ($4::int * interval '1 millisecond') where id = $1",
    [ev.id, msg, JSON.stringify(resultado), atrasoBackoffMs(ev.tentativas)],
  );
  return { id: ev.id, status: "pendente", erro: erro ?? undefined, pendencias, resultado };
}

/** Processa um evento específico agora (logo depois de receber). null = não está pendente ou outro consumidor pegou. */
export async function processarEvento(id: string, deps: DepsEvento = {}): Promise<ResultadoProcessamento | null> {
  const ev = await reservar(id);
  return ev ? executar(ev, deps) : null;
}

/** Consumidor do cron (job "eventos"): processa os pendentes vencidos, um por vez, até o tempo máximo. */
export async function processarPendentes(o: { tempoMaxMs?: number; limite?: number; deps?: DepsEvento } = {}) {
  const ate = Date.now() + (o.tempoMaxMs ?? 60_000);
  const out = { processados: 0, pendentes: 0, falharam: 0, ids: [] as string[] };
  for (let i = 0; i < (o.limite ?? 50) && Date.now() < ate; i++) {
    const ev = await reservar();
    if (!ev) break;
    const r = await executar(ev, o.deps ?? {});
    out.ids.push(ev.id);
    if (r.status === "processado") out.processados++;
    else if (r.status === "falhou") out.falharam++;
    else out.pendentes++;
  }
  return out;
}

/** Reprocessar (admin): volta o evento para a fila agora, zerando as tentativas. */
export async function reenfileirar(id: string, actor: string) {
  const r = await rawQuery("update avanteza.eventos set status = 'pendente', tentativas = 0, proxima_tentativa_em = now() where id = $1 returning id", [id]);
  if (r.length) await rawQuery("insert into avanteza.audit_log (event, actor, details) values ('evento_reenfileirado', $1, $2)", [actor, JSON.stringify({ id })]);
  return r.length > 0;
}

export interface EventoLista { id: string; tipo: string; origem: string; status: string; tentativas: number; erro: string | null; recebido_em: string; processado_em: string | null; resultado: Record<string, unknown> | null }
export async function listarEventos(limite = 50): Promise<EventoLista[]> {
  return rawQuery<EventoLista>(
    `select id, tipo, origem, status, tentativas, erro, to_char(recebido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as recebido_em, to_char(processado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as processado_em, resultado from avanteza.eventos order by recebido_em desc limit $1`,
    [limite],
  );
}
