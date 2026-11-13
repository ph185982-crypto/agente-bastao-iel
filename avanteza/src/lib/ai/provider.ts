// Provedor de IA configurável (AI_PROVIDER). Hoje: Anthropic (SDK oficial, saída estruturada).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AgentOutputSchema, type AgentOutput } from "./schema";
import { envOptional } from "../env";

export interface AgentResult {
  output: AgentOutput;
  provider: string;
  model: string;
  usage: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  enabled(): boolean;
  analyze(system: string, context: string): Promise<AgentResult>;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private model = envOptional("AI_MODEL") ?? "claude-opus-5-5";
  private effort = (envOptional("AI_EFFORT") ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";

  enabled() {
    return Boolean(envOptional("ANTHROPIC_API_KEY"));
  }

  async analyze(system: string, context: string): Promise<AgentResult> {
    // O SDK lê ANTHROPIC_API_KEY do ambiente e já faz retry com backoff em 429/5xx.
    const client = new Anthropic({ maxRetries: 3, timeout: 120_000 });
    const response = await client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // se o modelo recusar, a API reprocessa em um modelo de fallback
      system,
      output_config: { effort: this.effort, format: betaZodOutputFormat(AgentOutputSchema) },
      messages: [{ role: "user", content: context }],
    });
    if (response.stop_reason === "refusal") throw new Error("A IA recusou a análise deste cliente.");
    if (response.stop_reason === "max_tokens") throw new Error("Resposta da IA truncada (max_tokens).");
    const parsed = AgentOutputSchema.safeParse(response.parsed_output);
    if (!parsed.success) throw new Error("Resposta da IA fora do formato esperado.");
    return {
      output: parsed.data,
      provider: this.name,
      model: response.model,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    };
  }
}

export function getAiProvider(): AiProvider {
  const name = envOptional("AI_PROVIDER") ?? "anthropic";
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    default:
      throw new Error(`Provedor de IA não suportado: ${name}`);
  }
}
