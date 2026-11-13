// Formato estruturado da resposta do agente (validado pela API e de novo aqui com zod).
import { z } from "zod";

export const ACTION_ENUM = [
  "update_price",
  "update_stock",
  "pause_listing",
  "activate_listing",
  "update_listing",
  "answer_question",
  "update_ads_budget",
  "update_ads_status",
  "create_promotion",
] as const;

export const ProposedActionSchema = z.object({
  tipo: z.enum(ACTION_ENUM),
  conta_id: z.string().describe("ID interno da conta (campo conta_id do contexto)"),
  alvo: z.string().describe("ID do anúncio (MLB...), da pergunta ou da campanha, exatamente como no contexto"),
  justificativa: z.string().describe("Por que esta ação, com os números que a sustentam"),
  prioridade: z.enum(["alta", "media", "baixa"]),
  preco: z.number().nullable().describe("update_price: novo preço"),
  estoque: z.number().nullable().describe("update_stock: nova quantidade"),
  titulo: z.string().nullable().describe("update_listing: novo título (até 60 caracteres)"),
  descricao: z.string().nullable().describe("update_listing: nova descrição em texto simples"),
  resposta: z.string().nullable().describe("answer_question: texto da resposta ao comprador"),
  verba: z.number().nullable().describe("update_ads_budget: nova verba diária"),
  status_campanha: z.enum(["active", "paused"]).nullable().describe("update_ads_status"),
  preco_promocional: z.number().nullable().describe("create_promotion: preço com desconto"),
  inicio: z.string().nullable().describe("create_promotion: início ISO 8601"),
  fim: z.string().nullable().describe("create_promotion: fim ISO 8601"),
});

export const AgentOutputSchema = z.object({
  resumo: z.string().describe("Resumo executivo de 3 a 6 frases sobre o desempenho do cliente"),
  diagnostico: z.array(
    z.object({
      tema: z.string(),
      severidade: z.enum(["critica", "atencao", "info"]),
      texto: z.string(),
    }),
  ),
  acoes: z.array(ProposedActionSchema).describe("No máximo 8 ações, só quando os dados justificam"),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

/** Converte a ação da IA para o payload do executor. */
export function toExecutorPayload(a: ProposedAction): Record<string, unknown> {
  switch (a.tipo) {
    case "update_price": return { price: a.preco };
    case "update_stock": return { available_quantity: a.estoque };
    case "pause_listing":
    case "activate_listing": return {};
    case "update_listing": {
      const p: Record<string, unknown> = {};
      if (a.titulo) p.title = a.titulo;
      if (a.descricao) p.description = a.descricao;
      return p;
    }
    case "answer_question": return { text: a.resposta };
    case "update_ads_budget": return { budget: a.verba };
    case "update_ads_status": return { status: a.status_campanha };
    case "create_promotion": return { deal_price: a.preco_promocional, start_date: a.inicio, finish_date: a.fim };
  }
}
