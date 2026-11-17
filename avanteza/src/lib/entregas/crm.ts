// Cliente HTTP do Funil de Entrega: fala com a API de serviço do CRM (que na Etapa 3 passa a ser do Vendedor IA, mesmo contrato)
//   {CRM_URL}/api/integracoes/avanteza/entregas/<recurso>      Authorization: Bearer {AVANTEZA_CRM_KEY}
// Contrato em crm/docs/integracao-avanteza.md (repositório nexo-backend). Respostas validadas com zod; fetch com timeout;
// leituras (GET) têm uma nova tentativa curta para falha transitória, escritas NUNCA são repetidas. Provedor injetável
// (testes e fixture usam um falso). A chave e os textos do funil nunca vão para log nem para mensagem de erro.
import { z } from "zod";

export const URL_PADRAO = "https://nexo-crm-tawny.vercel.app";
export const TIMEOUT_MS = 12_000;
const RAIZ = "/api/integracoes/avanteza/entregas";

export const COLUNAS = ["BACKLOG", "ESSA_SEMANA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "CONCLUIDO"] as const;
export type Coluna = (typeof COLUNAS)[number];
export const ROTULO_COLUNA: Record<Coluna, string> = { BACKLOG: "Backlog", ESSA_SEMANA: "Essa semana", EM_ANDAMENTO: "Em andamento", AGUARDANDO_CLIENTE: "Aguardando o cliente", CONCLUIDO: "Concluído" };
export const PILARES = ["COMERCIAL", "PRODUTO", "MARKETING", "OPERACAO", "FINANCEIRO", "TECNOLOGIA"] as const;
export type Pilar = (typeof PILARES)[number];
export const ROTULO_PILAR: Record<Pilar, string> = { COMERCIAL: "Comercial", PRODUTO: "Produto", MARKETING: "Marketing", OPERACAO: "Operação", FINANCEIRO: "Financeiro", TECNOLOGIA: "Tecnologia" };
export const STATUS_ENTREGA = ["EM_ANDAMENTO", "PAUSADA", "CONCLUIDA", "CANCELADA"] as const;
export type StatusEntrega = (typeof STATUS_ENTREGA)[number];
export const ROTULO_STATUS: Record<StatusEntrega, string> = { EM_ANDAMENTO: "Em andamento", PAUSADA: "Pausada", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };

const n = z.number().finite();
const iso = z.string();
const isoNull = z.string().nullable();

// ─── Schemas ─────────────────────────────────────────────────────────────────
export const saudeSchema = z.object({
  nota: n, rotulo: z.enum(["SAUDAVEL", "ATENCAO", "EM_RISCO"]), progresso: n, total: n, concluidos: n, atrasados: n, esperandoCliente: n,
  diasParaRenovar: n.nullable(), renovacaoProxima: z.boolean(), porColuna: z.record(z.string(), n),
});
export type Saude = z.infer<typeof saudeSchema>;
const pessoa = z.object({ id: z.string(), nome: z.string() });
export type Pessoa = z.infer<typeof pessoa>;

export const entregaResumoSchema = z.object({
  id: z.string(), nome: z.string(), status: z.string(), contato: pessoa, inicioEm: iso, renovacaoEm: isoNull, valorMensal: n, oportunidadeId: z.string(), saude: saudeSchema,
  fimPrevistoEm: isoNull.optional(), renovacaoOportunidadeId: z.string().nullable().optional(),
});
export type EntregaResumo = z.infer<typeof entregaResumoSchema>;
const listaEntregas = z.object({ entregas: z.array(entregaResumoSchema) });

export const cartaoQuadroSchema = z.object({
  id: z.string(), entregaId: z.string(), titulo: z.string(), pilar: z.string(), coluna: z.string(), ordem: n, dataAlvo: isoNull, cliente: z.boolean(),
  responsavel: pessoa.nullable(), diasDeAtraso: n, diasNaColuna: n, concluidoEm: isoNull, checklist: z.object({ feitos: n, total: n }),
});
export type CartaoQuadro = z.infer<typeof cartaoQuadroSchema>;

export const quadroSchema = z.object({
  colunas: z.array(z.object({ id: z.string(), rotulo: z.string() })),
  pilares: z.array(z.object({ id: z.string(), rotulo: z.string() })),
  indicadores: z.object({ entregas: n, mrr: n, cartoesAbertos: n, atrasados: n, aguardandoCliente: n, emRisco: n, renovacoesProximas: n }),
  entregas: z.array(entregaResumoSchema),
  cartoes: z.array(cartaoQuadroSchema),
});
export type Quadro = z.infer<typeof quadroSchema>;

export const renovacaoSchema = z.object({
  entregaId: z.string(), nome: z.string(), contato: pessoa, renovacaoEm: iso, diasParaRenovar: n, valorMensal: n, status: z.string(), renovacaoOportunidadeId: z.string().nullable(),
});
export type Renovacao = z.infer<typeof renovacaoSchema>;

const itemChecklist = z.object({ texto: z.string(), feito: z.boolean() });
export type ItemChecklist = z.infer<typeof itemChecklist>;
export const cartaoDetalheSchema = z.object({
  id: z.string(), entregaId: z.string(), titulo: z.string(), descricao: z.string().nullable(), pilar: z.string(), coluna: z.string(), ordem: n,
  dataAlvo: isoNull, cliente: z.boolean(), responsavelId: z.string().nullable(), responsavel: pessoa.nullable(), checklist: z.array(itemChecklist),
  colunaDesdeEm: iso, planejadoEm: isoNull, concluidoEm: isoNull, criadoEm: iso,
  entrega: z.object({ id: z.string(), nome: z.string(), status: z.string(), renovacaoEm: isoNull, contato: pessoa }),
  combinados: z.array(z.object({ id: z.string(), descricao: z.string(), status: z.string(), prazoEm: isoNull, entregueEm: isoNull, criadoEm: iso })),
  historico: z.array(z.object({ em: iso, tipo: z.string(), texto: z.string() })),
});
export type CartaoDetalhe = z.infer<typeof cartaoDetalheSchema>;

export const entregaDetalheSchema = z.object({
  id: z.string(), nome: z.string(), status: z.string(), contato: pessoa, oportunidadeId: z.string(), inicioEm: iso, fimPrevistoEm: isoNull, renovacaoEm: isoNull,
  valorMensal: n, diagnostico: z.record(z.string(), z.string()), concluidaEm: isoNull, renovacaoOportunidadeId: z.string().nullable(),
  modelo: z.object({ nome: z.string() }).nullable(), saude: saudeSchema,
  cartoes: z.array(z.object({
    id: z.string(), titulo: z.string(), descricao: z.string().nullable(), pilar: z.string(), coluna: z.string(), ordem: n, dataAlvo: isoNull, cliente: z.boolean(),
    responsavel: pessoa.nullable(), colunaDesdeEm: iso, concluidoEm: isoNull,
  })),
});
export type EntregaDetalhe = z.infer<typeof entregaDetalheSchema>;

export const modeloSchema = z.object({
  id: z.string(), nome: z.string(), descricao: z.string().nullable(), padrao: z.boolean(), ativo: z.boolean(),
  itens: z.array(z.object({ id: z.string(), titulo: z.string(), pilar: z.string(), prazoDias: n.nullable(), cliente: z.boolean(), ordem: n })),
});
export type Modelo = z.infer<typeof modeloSchema>;
export const gatilhosSchema = z.object({
  gatilhos: z.array(z.object({ id: z.string(), rotulo: z.string() })),
  automacoes: z.array(z.object({ id: z.string(), nome: z.string(), ativo: z.boolean(), gatilho: z.string(), rotuloGatilho: z.string(), execucoes30d: z.record(z.string(), n) })),
});
export type Gatilhos = z.infer<typeof gatilhosSchema>;
export const rotinaSchema = z.object({ responsaveis: n, planejados: n, concluidas: n, renovacoes: n, erros: n });
export type ResultadoRotina = z.infer<typeof rotinaSchema>;

// ─── Entradas ────────────────────────────────────────────────────────────────
export interface FiltroQuadro { status?: string; entregaId?: string; q?: string; responsavelId?: string; pilar?: string; atrasados?: boolean }
export interface PatchCartao {
  coluna?: Coluna; posicao?: number; titulo?: string; descricao?: string | null; pilar?: Pilar; dataAlvo?: string | null; cliente?: boolean;
  responsavelId?: string | null; checklist?: ItemChecklist[];
}
export interface NovoCartao { titulo: string; descricao?: string; pilar?: Pilar; coluna?: Coluna; dataAlvo?: string; cliente?: boolean; responsavelId?: string | null }
export interface PatchEntrega { status?: StatusEntrega; renovacaoEm?: string | null; fimPrevistoEm?: string | null; diagnostico?: Partial<Record<Pilar, string>> }

export interface EntregasProvider {
  quadro(f?: FiltroQuadro): Promise<Quadro>;
  entregas(status?: string): Promise<EntregaResumo[]>;
  entrega(id: string): Promise<EntregaDetalhe>;
  cartao(entregaId: string, cartaoId: string): Promise<CartaoDetalhe>;
  renovacoes(dias?: number): Promise<Renovacao[]>;
  gatilhos(): Promise<Gatilhos>;
  usuarios(): Promise<Pessoa[]>;
  modelos(): Promise<Modelo[]>;
  editarCartao(entregaId: string, cartaoId: string, p: PatchCartao): Promise<void>;
  criarCartao(entregaId: string, c: NovoCartao): Promise<{ id: string }>;
  excluirCartao(entregaId: string, cartaoId: string): Promise<void>;
  editarEntrega(id: string, p: PatchEntrega): Promise<void>;
  concluirEntrega(id: string): Promise<void>;
  criarUpsell(id: string): Promise<{ oportunidadeId: string }>;
  definirModeloPadrao(id: string): Promise<void>;
  desativarModelo(id: string): Promise<void>;
  rodarRotina(): Promise<ResultadoRotina>;
}

// ─── Erros ───────────────────────────────────────────────────────────────────
export type CodigoErroEntregas = "nao-configurado" | "nao-autorizado" | "timeout" | "http" | "formato" | "rede" | "rejeitado" | "nao-encontrado";
export class EntregasErro extends Error {
  constructor(message: string, public codigo: CodigoErroEntregas, public status?: number) { super(message); this.name = "EntregasErro"; }
}

/** Texto honesto para a tela, sem detalhe técnico nem dados do funil. */
export function mensagemDoErro(e: unknown): string {
  if (e instanceof EntregasErro) return e.message;
  return "O CRM está indisponível no momento.";
}

// ─── Cliente HTTP ────────────────────────────────────────────────────────────
export interface OpcoesEntregas {
  baseUrl?: string;
  chave: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Novas tentativas para GET com 5xx/rede/timeout (padrão 1). Escritas nunca repetem. */
  tentativas?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function criarProvedorEntregas(o: OpcoesEntregas): EntregasProvider {
  const base = (o.baseUrl || URL_PADRAO).replace(/\/+$/, "");
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const seg = encodeURIComponent;

  async function chamar<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", caminho: string, opts: { query?: Record<string, string | number | boolean | undefined>; corpo?: unknown; schema?: z.ZodType<T> } = {}): Promise<T> {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "" && v !== false) sp.set(k, v === true ? "1" : String(v));
    const url = `${base}${RAIZ}${caminho ? `/${caminho}` : ""}${sp.size ? `?${sp}` : ""}`;
    const max = metodo === "GET" ? (o.tentativas ?? 1) : 0;
    let ultimo = new EntregasErro("O CRM está indisponível no momento.", "rede");
    for (let i = 0; i <= max; i++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" })), o.timeoutMs ?? TIMEOUT_MS);
      try {
        const res = await doFetch(url, {
          method: metodo,
          headers: { Authorization: `Bearer ${o.chave}`, Accept: "application/json", ...(opts.corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
          ...(opts.corpo !== undefined ? { body: JSON.stringify(opts.corpo) } : {}),
          signal: ctl.signal,
          cache: "no-store",
        });
        if (res.status === 401) throw new EntregasErro("O CRM recusou a chave do Funil de Entrega (AVANTEZA_CRM_KEY diferente nos dois projetos).", "nao-autorizado", 401);
        if (res.status === 503) throw new EntregasErro("O CRM ainda não tem a chave AVANTEZA_CRM_KEY configurada.", "nao-configurado", 503);
        if (res.status === 404) throw new EntregasErro("Registro não encontrado (já foi alterado ou apagado no CRM).", "nao-encontrado", 404);
        if (res.status >= 400 && res.status < 500) {
          const corpo = (await res.json().catch(() => null)) as { erro?: unknown } | null;
          // O CRM devolve mensagens de regra de negócio em português (ex.: "coluna inválida"); nunca dados do funil.
          const msg = typeof corpo?.erro === "string" && corpo.erro.length < 200 ? corpo.erro : "O CRM recusou a operação.";
          throw new EntregasErro(msg, "rejeitado", res.status);
        }
        if (!res.ok) {
          ultimo = new EntregasErro(`O CRM respondeu com erro ${res.status}.`, "http", res.status);
          if (i < max) { await sleep(400 * 2 ** i); continue; }
          throw ultimo;
        }
        const corpo = await res.json().catch(() => null);
        if (!opts.schema) return undefined as T;
        const v = opts.schema.safeParse(corpo);
        if (!v.success) throw new EntregasErro("Resposta do CRM fora do formato esperado (versão da API diferente?).", "formato");
        return v.data;
      } catch (e) {
        if (e instanceof EntregasErro) throw e;
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        ultimo = new EntregasErro(timeout ? "O CRM demorou demais para responder." : "Não foi possível falar com o CRM.", timeout ? "timeout" : "rede");
        if (i < max) { await sleep(400 * 2 ** i); continue; }
        throw ultimo;
      } finally {
        clearTimeout(timer);
      }
    }
    throw ultimo;
  }

  const ok = z.unknown();
  return {
    quadro: (f = {}) => chamar("GET", "quadro", { query: { status: f.status, entregaId: f.entregaId, q: f.q, responsavelId: f.responsavelId, pilar: f.pilar, atrasados: f.atrasados }, schema: quadroSchema }),
    entregas: async (status) => (await chamar("GET", "", { query: { status }, schema: listaEntregas })).entregas,
    entrega: (id) => chamar("GET", seg(id), { schema: entregaDetalheSchema }),
    cartao: (e, c) => chamar("GET", `${seg(e)}/cartoes/${seg(c)}`, { schema: cartaoDetalheSchema }),
    renovacoes: async (dias = 60) => (await chamar("GET", "renovacoes", { query: { dias }, schema: z.object({ renovacoes: z.array(renovacaoSchema) }) })).renovacoes,
    gatilhos: () => chamar("GET", "gatilhos", { schema: gatilhosSchema }),
    usuarios: async () => (await chamar("GET", "usuarios", { schema: z.object({ usuarios: z.array(pessoa) }) })).usuarios,
    modelos: async () => (await chamar("GET", "modelos", { schema: z.object({ modelos: z.array(modeloSchema) }) })).modelos,
    editarCartao: async (e, c, p) => { await chamar("PATCH", `${seg(e)}/cartoes/${seg(c)}`, { corpo: p, schema: ok }); },
    criarCartao: (e, c) => chamar("POST", `${seg(e)}/cartoes`, { corpo: c, schema: z.object({ id: z.string() }) }),
    excluirCartao: async (e, c) => { await chamar("DELETE", `${seg(e)}/cartoes/${seg(c)}`, { schema: ok }); },
    editarEntrega: async (id, p) => { await chamar("PATCH", seg(id), { corpo: p, schema: ok }); },
    concluirEntrega: async (id) => { await chamar("POST", `${seg(id)}/concluir`, { schema: ok }); },
    criarUpsell: (id) => chamar("POST", `${seg(id)}/upsell`, { schema: z.object({ oportunidadeId: z.string() }) }),
    definirModeloPadrao: async (id) => { await chamar("PATCH", `modelos/${seg(id)}`, { corpo: { padrao: true }, schema: ok }); },
    desativarModelo: async (id) => { await chamar("PATCH", `modelos/${seg(id)}`, { corpo: { ativo: false }, schema: ok }); },
    rodarRotina: () => chamar("POST", "rotina", { schema: rotinaSchema }),
  };
}

/** Provedor a partir do ambiente (CRM_URL opcional; AVANTEZA_CRM_KEY obrigatória). */
export function provedorEntregasDoAmbiente(env: NodeJS.ProcessEnv = process.env): EntregasProvider {
  const chave = env.AVANTEZA_CRM_KEY?.trim();
  if (!chave) throw new EntregasErro("AVANTEZA_CRM_KEY não configurada neste ambiente.", "nao-configurado");
  return criarProvedorEntregas({ baseUrl: env.CRM_URL?.trim() || URL_PADRAO, chave });
}
