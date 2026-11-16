// Financeiro e comercial = Vendedor IA (nexo-vendedoria). Cliente SOMENTE LEITURA do endpoint de agregados
//   GET {VENDEDORIA_URL}/api/integracoes/avanteza/metricas?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Authorization: Bearer {AVANTEZA_METRICS_KEY}
// Contrato em vendedoria/docs/integracao-avanteza.md. A resposta é validada com zod; fetch com timeout e uma nova tentativa
// para falhas transitórias. Provedor injetável (testes e fixture usam um falso). A chave nunca vai para log nem para mensagem.
import { z } from "zod";
import type { Intervalo } from "./periodo";

export const URL_PADRAO = "https://nexo-vendedoria.vercel.app";
export const TIMEOUT_MS = 10_000;

const n = z.number().finite();
const nn = n.nullable();
const ponto = z.object({ data: z.string(), leadsNovos: n, ganhos: n, vendas: n, receitas: n, despesas: n });
const categoria = z.object({ categoria: z.string(), valor: n });
const bloco = z.object({
  periodo: z.object({ from: z.string(), to: z.string(), dias: n }),
  leads: z.object({ novos: n, porEtapa: z.array(z.object({ etapa: z.string(), tipo: z.string(), quantidade: n })), ganhos: n, perdidos: n }),
  conversao: z.object({ leadsDaCoorte: n, viraramCliente: n, taxaPct: nn }),
  vendas: z.object({ quantidade: n, valor: n, ticketMedio: nn, comValor: n }),
  faturamento: z.object({ vendido: n, contratosRecorrentesNovos: n, valorMensalRecorrenteNovo: n, contratosParceladosNovos: n, valorParceladoNovo: n }),
  financeiro: z.object({ receitas: n, despesas: n, resultado: n, receitasPorCategoria: z.array(categoria), despesasPorCategoria: z.array(categoria) }),
  series: z.array(ponto),
});
const agenda = z.object({ total: n, quantidade: n, atrasado: z.object({ total: n, quantidade: n }), proximos30: n, proximos60: n, proximos90: n });
export const metricasSchema = z.object({
  versao: z.literal(1),
  geradoEm: z.string(),
  escopo: z.object({ financeiro: z.string(), tiposNegocio: z.array(z.string()), excluido: z.array(z.string()), comercial: z.string(), observacao: z.string() }),
  atual: bloco,
  anterior: bloco,
  previstos: z.object({
    referencia: z.string(),
    aReceber: agenda.extend({ deContratos: z.object({ total: n, quantidade: n }) }),
    aPagar: agenda,
    saldoProjetado30: n,
    saldoProjetado90: n,
  }),
  contratos: z.object({ ativos: n, recorrentes: n, parcelados: n, valorMensalRecorrente: n, saldoAReceberParcelados: n }),
});
export type MetricasVendedoria = z.infer<typeof metricasSchema>;
export type BlocoVendedoria = z.infer<typeof bloco>;

export type CodigoErroVendedoria = "nao-configurado" | "nao-autorizado" | "timeout" | "http" | "formato" | "rede";
export class VendedoriaErro extends Error {
  constructor(message: string, public codigo: CodigoErroVendedoria) { super(message); this.name = "VendedoriaErro"; }
}

export interface VendedoriaProvider { metricas(i: Intervalo): Promise<MetricasVendedoria> }

export interface OpcoesVendedoria {
  baseUrl?: string;
  chave: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Novas tentativas para 5xx/rede/timeout (padrão 1). */
  tentativas?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function criarProvedorVendedoria(o: OpcoesVendedoria): VendedoriaProvider {
  const base = (o.baseUrl || URL_PADRAO).replace(/\/+$/, "");
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async metricas({ de, ate }) {
      const url = `${base}/api/integracoes/avanteza/metricas?${new URLSearchParams({ from: de, to: ate })}`;
      const max = o.tentativas ?? 1;
      let ultimo: VendedoriaErro = new VendedoriaErro("Vendedor IA indisponível.", "rede");
      for (let i = 0; i <= max; i++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" })), o.timeoutMs ?? TIMEOUT_MS);
        try {
          const res = await doFetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${o.chave}`, Accept: "application/json" },
            signal: ctl.signal,
            cache: "no-store",
          });
          if (res.status === 401) throw new VendedoriaErro("O Vendedor IA recusou a chave de integração (AVANTEZA_METRICS_KEY diferente nos dois projetos).", "nao-autorizado");
          if (res.status === 503) throw new VendedoriaErro("O Vendedor IA ainda não tem a chave AVANTEZA_METRICS_KEY configurada.", "http");
          if (!res.ok) { ultimo = new VendedoriaErro(`O Vendedor IA respondeu com erro ${res.status}.`, "http"); if (res.status >= 500 && i < max) { await sleep(400 * 2 ** i); continue; } throw ultimo; }
          const corpo = await res.json().catch(() => null);
          const v = metricasSchema.safeParse(corpo);
          if (!v.success) throw new VendedoriaErro("Resposta do Vendedor IA fora do formato esperado (versão do endpoint diferente?).", "formato");
          return v.data;
        } catch (e) {
          if (e instanceof VendedoriaErro) { if (e.codigo === "rede" && i < max) { ultimo = e; await sleep(400 * 2 ** i); continue; } throw e; }
          const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
          ultimo = new VendedoriaErro(timeout ? "O Vendedor IA demorou demais para responder." : "Não foi possível falar com o Vendedor IA.", timeout ? "timeout" : "rede");
          if (i < max) { await sleep(400 * 2 ** i); continue; }
          throw ultimo;
        } finally {
          clearTimeout(timer);
        }
      }
      throw ultimo;
    },
  };
}

/** Provedor a partir do ambiente (VENDEDORIA_URL opcional; AVANTEZA_METRICS_KEY obrigatória). */
export function provedorVendedoriaDoAmbiente(env: NodeJS.ProcessEnv = process.env): VendedoriaProvider {
  const chave = env.AVANTEZA_METRICS_KEY?.trim();
  if (!chave) throw new VendedoriaErro("AVANTEZA_METRICS_KEY não configurada neste ambiente.", "nao-configurado");
  return criarProvedorVendedoria({ baseUrl: env.VENDEDORIA_URL?.trim() || URL_PADRAO, chave });
}
