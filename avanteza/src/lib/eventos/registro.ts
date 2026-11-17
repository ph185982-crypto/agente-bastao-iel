// Barramento de eventos: envelope comum e contrato dos tipos registrados. Contrato público em docs/eventos.md.
import { z } from "zod";
import type { FinanceiroProvider } from "../financeiro/vendedoria";

export const EnvelopeSchema = z.object({
  /** Determinístico: o mesmo fato sempre tem o mesmo id (ex.: "contrato.assinado:<envelopeId>"). Reenvio = mesmo evento. */
  id: z.string().trim().min(3).max(200).regex(/^[\w.:@-]+$/, "use só letras, números e . : @ _ -"),
  tipo: z.string().trim().min(3).max(80),
  origem: z.string().trim().min(2).max(60),
  ocorrido_em: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export interface DepsEvento {
  /** Data de hoje (AAAA-MM-DD, fuso de São Paulo). */
  hoje?: string;
  /** Financeiro (Vendedor IA). null = indisponível; ausente = do ambiente. */
  financeiro?: FinanceiroProvider | null;
}

export interface ResultadoHandler {
  /** O que foi feito (vai para eventos.resultado; nada sensível). */
  resultado: Record<string, unknown>;
  /** Passos que ficaram para depois (ex.: Financeiro fora do ar): o evento volta para a fila com backoff. */
  pendencias: string[];
}

export interface TipoEvento<P = unknown> {
  tipo: string;
  descricao: string;
  payload: z.ZodType<P>;
  /** Confere a ligação entre id e payload (ex.: id = "contrato.assinado:" + envelopeId). Devolve a mensagem de erro ou null. */
  validarId?: (id: string, payload: P) => string | null;
  /** Precisa ser idempotente: rodar 2× o mesmo evento não duplica nada. */
  handler: (ev: Envelope & { payload: P }, deps: DepsEvento) => Promise<ResultadoHandler>;
}
