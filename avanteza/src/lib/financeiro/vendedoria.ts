// Cliente HTTP do Financeiro: fala com a API de serviço do Vendedor IA
//   {VENDEDORIA_URL}/api/integracoes/avanteza/financeiro/<recurso>?escopo=empresa|pessoal
//   Authorization: Bearer {AVANTEZA_FINANCE_KEY}
// Contrato em vendedoria/docs/integracao-avanteza.md. Respostas validadas com zod; fetch com timeout; leituras (GET) têm uma
// nova tentativa curta para falha transitória, escritas NUNCA são repetidas (evita lançar em dobro). Provedor injetável
// (testes e fixture usam um falso). A chave e os valores/descrições nunca vão para log nem para mensagem de erro.
import { z } from "zod";

export const URL_PADRAO = "https://nexo-vendedoria.vercel.app";
export const TIMEOUT_MS = 12_000;

export type EscopoFin = "empresa" | "pessoal";

const n = z.number().finite();
const sNull = z.string().nullable().optional();

// ─── Schemas ─────────────────────────────────────────────────────────────────
export const transacaoSchema = z.object({
  id: z.string(), tipo: z.enum(["receita", "despesa"]), valor: n, descricao: z.string(), categoria: z.string(),
  tipo_negocio: z.string(), empresa: sNull, data_transacao: z.string(), mes: z.string(), confirmado: z.boolean(),
});
export type Transacao = z.infer<typeof transacaoSchema>;
const listaTransacoes = z.object({ transacoes: z.array(transacaoSchema), total: n, pagina: n, paginas: n, categorias: z.array(z.string()).optional() });
export type ListaTransacoes = z.infer<typeof listaTransacoes>;

export const contaSchema = z.object({
  id: z.string(), descricao: z.string(), valor: n, data_vencimento: z.string(), categoria: z.string(), tipo_negocio: z.string(),
  recorrente: z.boolean(), frequencia: sNull, status: z.string(), transacao_id: sNull, estimada: z.boolean().optional(),
  parcela_numero: n.nullable().optional(), parcelas_total: n.nullable().optional(),
});
export type Conta = z.infer<typeof contaSchema>;

export const receitaSchema = z.object({
  id: z.string(), descricao: z.string(), valor: n, data_prevista: z.string(), tipo_negocio: sNull, cliente: sNull, status: z.string(),
  data_recebimento: sNull, observacao: sNull, motivo_perda: sNull, contrato_id: sNull, parcela_numero: n.nullable().optional(),
  parcelas_total: n.nullable().optional(), atrasada: z.boolean().optional(),
});
export type Receita = z.infer<typeof receitaSchema>;
const qt = z.object({ quantidade: n, total: n });
const listaReceitas = z.object({ receitas: z.array(receitaSchema), totais: z.object({ abertas: qt, atrasadas: qt, recebidas: qt, perdidas: qt }) });
export type ListaReceitas = z.infer<typeof listaReceitas>;

export const contratoSchema = z.object({
  id: z.string(), descricao: z.string(), cliente: sNull, tipo_negocio: z.string(), modo: z.string(), valor_parcela: n,
  valor_total: n.nullable().optional(), duracao_meses: n.nullable().optional(), dia_vencimento: n, data_inicio: z.string(), status: z.string(),
  parcelas: z.object({ recebidas: qt, abertas: qt, perdidas: qt }),
});
export type Contrato = z.infer<typeof contratoSchema>;

export const metaSchema = z.object({
  id: z.string(), descricao: z.string(), alvo: n, atual: n, aporteDiario: n, cobrarDiariamente: z.boolean(), dataInicio: z.string(), dataFim: z.string(), status: z.string(),
  projecao: z.object({ falta: n, pct: n, diasRestantes: n, pendenteHoje: n, atraso: n, projetadoNoPrazo: n, necessarioPorDia: n, vaiBater: z.boolean(), concluida: z.boolean() }),
  ultimosAportes: z.array(z.object({ id: z.string(), valor: n, data: z.string(), origem: z.string(), observacao: sNull })),
});
export type Meta = z.infer<typeof metaSchema>;

const previstaResumo = z.object({ id: z.string(), descricao: z.string(), valor: n, data_prevista: z.string(), cliente: sNull, status: z.string(), atrasada: z.boolean().optional() });
const variacao = z.object({ atual: n, anterior: n, variacaoPct: n.nullable() });
export const resumoSchema = z.object({
  periodo: z.object({ tipo: z.string(), mes: z.string().nullable(), de: z.string(), ate: z.string(), label: z.string() }),
  competencia: z.object({ mesAtual: z.string(), hoje: z.string(), ehMesAtual: z.boolean() }),
  receitas: n, despesas: n, saldo: n,
  meta: z.object({ alvo: n, atual: n }).nullable(),
  categorias: z.array(z.object({ categoria: z.string(), total: n })),
  mensal: z.array(z.object({ mes: z.string(), receitas: n, despesas: n })),
  comparativo: z.object({ periodoAnterior: z.object({ label: z.string() }), receitas: variacao, despesas: variacao, saldo: variacao }),
  receitasPrevistas: z.object({
    total: n, quantidade: n, recebido: n, recebidoQuantidade: n, itens: z.array(previstaResumo),
    atrasadasAnteriores: z.object({ total: n, quantidade: n }), perdidas: z.object({ total: n, quantidade: n }),
  }),
});
export type Resumo = z.infer<typeof resumoSchema>;

const dreValores = z.object({
  receitaBruta: n, deducoes: n, receitaLiquida: n, custos: n, lucroBruto: n, despesasOperacionais: n, resultadoOperacional: n,
  receitasFinanceiras: n, despesasFinanceiras: n, resultadoAntesImpostos: n, impostos: n, resultadoLiquido: n, dividas: n, investimentos: n,
  entradasNaoOperacionais: n, sobraCaixa: n, margemLiquida: n.nullable(),
});
export type DreValores = z.infer<typeof dreValores>;
export const dreSchema = z.object({
  periodo: z.object({ mes: z.string().nullable(), de: z.string(), ate: z.string(), label: z.string() }),
  anterior: z.object({ label: z.string() }),
  realizado: z.object({ atual: dreValores, anterior: dreValores }),
  projetado: z.object({ atual: dreValores, previsto: z.object({ receitas: n, receitasQtd: n, despesas: n, despesasQtd: n }) }),
  serie: z.array(z.object({ mes: z.string(), label: z.string(), receitaLiquida: n, saidas: n, resultadoLiquido: n })),
  insights: z.array(z.string()),
});
export type Dre = z.infer<typeof dreSchema>;

export const categoriasSchema = z.object({ escopo: z.string(), receitas: z.array(z.string()), despesas: z.array(z.string()) });
export type Categorias = z.infer<typeof categoriasSchema>;

// Etapa 2: projeção de caixa, orçamentos, dívidas, contratos de despesa e histórico.
export const projecaoSchema = z.object({
  escopo: z.string(), saldo_atual: n, burn_rate: n, primeiro_negativo: z.string().nullable(),
  dias: z.array(z.object({ data: z.string(), saldo: n, eventos: z.array(z.string()) })),
});
export type Projecao = z.infer<typeof projecaoSchema>;

export const orcamentoSchema = z.object({ id: z.string(), categoria: z.string(), limite_mensal: n, gasto_atual: n });
export type Orcamento = z.infer<typeof orcamentoSchema>;

export const dividaSchema = z.object({
  id: z.string(), descricao: z.string(), valor_total: n, valor_pago: n, parcela_mensal: n.nullable().optional(), dia_vencimento: n.nullable().optional(),
  credor: sNull, status: z.string(), observacao: sNull, restante: n, progresso: n,
});
export type Divida = z.infer<typeof dividaSchema>;

export const contratoDespesaSchema = z.object({
  id: z.string(), descricao: z.string(), credor: sNull, categoria: z.string(), tipo_negocio: z.string(), valor_parcela: n, parcelas_total: n.nullable(),
  dia_vencimento: n, data_inicio: z.string(), entrada: n.nullable().optional(), saldo_devedor: n.nullable().optional(), estimada: z.boolean(), status: z.string(),
  observacao: sNull, pagas: n, pendentes: n, restantes: n.nullable(), valor_restante: n.nullable(),
  proxima: z.object({ vencimento: z.string(), valor: n, numero: n }).nullable(),
});
export type ContratoDespesa = z.infer<typeof contratoDespesaSchema>;

export const itemHistoricoSchema = z.object({
  id: z.string(), entidade: z.string(), entidade_id: z.string(), acao: z.enum(["criado", "atualizado", "excluido"]), criado_em: z.string(),
  descricao: sNull, valor: n.nullable().optional(), restauravel: z.boolean(),
});
export type ItemHistorico = z.infer<typeof itemHistoricoSchema>;
export const historicoSchema = z.object({ itens: z.array(itemHistoricoSchema), total: n, pagina: n, paginas: n, entidades: z.array(z.string()) });
export type ListaHistorico = z.infer<typeof historicoSchema>;

// ─── Entradas ────────────────────────────────────────────────────────────────
export interface PeriodoFin { mes?: string; dia?: string; de?: string; ate?: string }
export interface FiltroTransacoes extends PeriodoFin { tipo?: "receita" | "despesa"; categoria?: string; texto?: string; confirmado?: boolean; page?: number; pageSize?: number }
export interface NovaTransacao { tipo: "receita" | "despesa"; valor: number; descricao: string; categoria: string; data_transacao?: string; empresa?: string }
export type EdicaoTransacao = Partial<NovaTransacao & { confirmado: boolean; tipo_negocio: "nexo" | "pessoal"; empresa: string | null }>;
export interface NovaConta { descricao: string; valor: number; data_vencimento: string; categoria?: string; recorrente?: boolean; frequencia?: "mensal" | "semanal" | "anual" }
export type AcaoConta = { acao: "pagar" } | { acao: "cancelar" } | { acao: "editar"; descricao?: string; valor?: number; data_vencimento?: string; categoria?: string; tipo_negocio?: "nexo" | "pessoal" };
export type NovaReceita =
  | { modo: "avulsa"; descricao: string; valor: number; data_prevista: string; cliente?: string; observacao?: string }
  | { modo: "parcelada"; descricao: string; data_prevista: string; meses: number; valor_total?: number; valor_parcela?: number; cliente?: string; observacao?: string }
  | { modo: "recorrente"; descricao: string; data_prevista: string; valor_parcela: number; meses?: number | null; cliente?: string; observacao?: string };
export type AcaoReceita = { acao: "confirmar" } | { acao: "perder"; motivo?: string } | { acao: "reverter_perda" } | { acao: "editar"; valor?: number; descricao?: string; cliente?: string | null; observacao?: string | null; data_prevista?: string; tipo_negocio?: "nexo" | "pessoal" };
export type AcaoContrato = { acao: "encerrar"; motivo?: string } | { acao: "editar"; valor_parcela?: number; descricao?: string; cliente?: string | null; observacao?: string | null; a_partir_de?: string };

export interface NovoContratoDespesa {
  descricao: string; valor_parcela: number; primeiro_vencimento: string; parcelas_total?: number | null; dia_vencimento?: number; credor?: string | null;
  categoria?: string; entrada?: number | null; entrada_data?: string | null; saldo_devedor?: number | null; estimada?: boolean; observacao?: string | null;
}
export type AcaoContratoDespesa =
  | { acao: "encerrar" } | { acao: "reativar" }
  | { acao: "editar"; descricao?: string; credor?: string | null; categoria?: string; valor_parcela?: number; saldo_devedor?: number | null; estimada?: boolean; observacao?: string | null; tipo_negocio?: "nexo" | "pessoal" };
export type AcaoDivida = { acao: "pagar_parcela"; valor: number } | { acao: "quitar" };
export interface FiltroHistorico { entidade?: string; acao?: "criado" | "atualizado" | "excluido"; de?: string; ate?: string; q?: string; page?: number; pageSize?: number }

export interface FinanceiroProvider {
  resumo(e: EscopoFin, p: PeriodoFin): Promise<Resumo>;
  dre(e: EscopoFin, p: PeriodoFin): Promise<Dre>;
  transacoes(e: EscopoFin, f: FiltroTransacoes): Promise<ListaTransacoes>;
  criarTransacao(e: EscopoFin, t: NovaTransacao): Promise<Transacao>;
  editarTransacao(e: EscopoFin, id: string, t: EdicaoTransacao): Promise<Transacao>;
  confirmarTransacao(e: EscopoFin, id: string): Promise<Transacao>;
  excluirTransacao(e: EscopoFin, id: string): Promise<void>;
  contas(e: EscopoFin, status?: "pendente" | "paga" | "cancelada"): Promise<Conta[]>;
  criarConta(e: EscopoFin, c: NovaConta): Promise<Conta>;
  acaoConta(e: EscopoFin, id: string, a: AcaoConta): Promise<Conta>;
  excluirConta(e: EscopoFin, id: string): Promise<void>;
  receitas(e: EscopoFin, p: PeriodoFin & { status?: "abertas" | "atrasada" | "pendente" | "recebida" | "perdida"; contrato_id?: string }): Promise<ListaReceitas>;
  criarReceita(e: EscopoFin, r: NovaReceita): Promise<void>;
  acaoReceita(e: EscopoFin, id: string, a: AcaoReceita): Promise<Receita>;
  contratos(e: EscopoFin): Promise<Contrato[]>;
  acaoContrato(e: EscopoFin, id: string, a: AcaoContrato): Promise<void>;
  metas(): Promise<Meta[]>;
  aporte(a: { meta_id: string; valor: number; data?: string; observacao?: string }): Promise<void>;
  excluirAporte(id: string): Promise<void>;
  categorias(e: EscopoFin): Promise<Categorias>;
  projecao(e: EscopoFin, dias?: number): Promise<Projecao>;
  /** Orçamentos, dívidas e metas só existem no Pessoal (a API recusa Empresa com 404). */
  orcamentos(): Promise<Orcamento[]>;
  salvarOrcamento(o: { categoria: string; limite_mensal: number }): Promise<void>;
  excluirOrcamento(categoria: string): Promise<void>;
  dividas(): Promise<Divida[]>;
  acaoDivida(id: string, a: AcaoDivida): Promise<void>;
  contratosDespesa(e: EscopoFin): Promise<ContratoDespesa[]>;
  criarContratoDespesa(e: EscopoFin, c: NovoContratoDespesa): Promise<void>;
  acaoContratoDespesa(e: EscopoFin, id: string, a: AcaoContratoDespesa): Promise<void>;
  historico(e: EscopoFin, f: FiltroHistorico): Promise<ListaHistorico>;
  restaurar(e: EscopoFin, historicoId: string): Promise<void>;
}

// ─── Erros ───────────────────────────────────────────────────────────────────
export type CodigoErroFin = "nao-configurado" | "nao-autorizado" | "timeout" | "http" | "formato" | "rede" | "rejeitado" | "nao-encontrado";
export class FinanceiroErro extends Error {
  constructor(message: string, public codigo: CodigoErroFin, public status?: number) { super(message); this.name = "FinanceiroErro"; }
}

/** Texto honesto para a tela, sem detalhe técnico nem valores. */
export function mensagemDoErro(e: unknown): string {
  if (e instanceof FinanceiroErro) return e.message;
  return "Vendedor IA indisponível no momento.";
}

// ─── Cliente HTTP ────────────────────────────────────────────────────────────
export interface OpcoesFinanceiro {
  baseUrl?: string;
  chave: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Novas tentativas para GET com 5xx/rede/timeout (padrão 1). Escritas nunca repetem. */
  tentativas?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RAIZ = "/api/integracoes/avanteza/financeiro";

export function criarProvedorFinanceiro(o: OpcoesFinanceiro): FinanceiroProvider {
  const base = (o.baseUrl || URL_PADRAO).replace(/\/+$/, "");
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function chamar<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", caminho: string, escopo: EscopoFin, opts: { query?: Record<string, string | number | boolean | undefined>; corpo?: unknown; schema?: z.ZodType<T> } = {}): Promise<T> {
    const sp = new URLSearchParams({ escopo });
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") sp.set(k, String(v));
    const url = `${base}${RAIZ}/${caminho}?${sp}`;
    const max = metodo === "GET" ? (o.tentativas ?? 1) : 0;
    let ultimo = new FinanceiroErro("Vendedor IA indisponível no momento.", "rede");
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
        if (res.status === 401) throw new FinanceiroErro("O Vendedor IA recusou a chave do Financeiro (AVANTEZA_FINANCE_KEY diferente nos dois projetos).", "nao-autorizado", 401);
        if (res.status === 503) throw new FinanceiroErro("O Vendedor IA ainda não tem a chave AVANTEZA_FINANCE_KEY configurada.", "nao-configurado", 503);
        if (res.status === 404) throw new FinanceiroErro("Registro não encontrado (já foi alterado ou está em outra área).", "nao-encontrado", 404);
        if (res.status >= 400 && res.status < 500) {
          const corpo = (await res.json().catch(() => null)) as { error?: unknown } | null;
          // O Vendedor IA devolve mensagens de regra de negócio em português (ex.: "Esta receita já foi recebida."); nunca valores.
          const msg = typeof corpo?.error === "string" && corpo.error.length < 200 ? corpo.error : "O Vendedor IA recusou a operação.";
          throw new FinanceiroErro(msg, "rejeitado", res.status);
        }
        if (!res.ok) {
          ultimo = new FinanceiroErro(`O Vendedor IA respondeu com erro ${res.status}.`, "http", res.status);
          if (i < max) { await sleep(400 * 2 ** i); continue; }
          throw ultimo;
        }
        const corpo = await res.json().catch(() => null);
        if (!opts.schema) return undefined as T;
        const v = opts.schema.safeParse(corpo);
        if (!v.success) throw new FinanceiroErro("Resposta do Vendedor IA fora do formato esperado (versão da API diferente?).", "formato");
        return v.data;
      } catch (e) {
        if (e instanceof FinanceiroErro) {
          if (e.codigo === "http" && i < max) { ultimo = e; continue; }
          throw e;
        }
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        ultimo = new FinanceiroErro(timeout ? "O Vendedor IA demorou demais para responder." : "Não foi possível falar com o Vendedor IA.", timeout ? "timeout" : "rede");
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
    resumo: (e, p) => chamar("GET", "resumo", e, { query: { ...p }, schema: resumoSchema }),
    dre: (e, p) => chamar("GET", "dre", e, { query: { ...p }, schema: dreSchema }),
    transacoes: (e, f) => chamar("GET", "transacoes", e, { query: { tipo: f.tipo, categoria: f.categoria, texto: f.texto, data_inicio: f.de, data_fim: f.ate, confirmado: f.confirmado, page: f.page, pageSize: f.pageSize }, schema: listaTransacoes }),
    criarTransacao: (e, t) => chamar("POST", "transacoes", e, { corpo: t, schema: transacaoSchema }),
    editarTransacao: (e, id, t) => chamar("PATCH", `transacoes/${encodeURIComponent(id)}`, e, { corpo: t, schema: transacaoSchema }),
    confirmarTransacao: (e, id) => chamar("POST", `transacoes/${encodeURIComponent(id)}/confirmar`, e, { schema: transacaoSchema }),
    excluirTransacao: async (e, id) => { await chamar("DELETE", `transacoes/${encodeURIComponent(id)}`, e, { schema: ok }); },
    contas: (e, status) => chamar("GET", "contas", e, { query: { status }, schema: z.array(contaSchema) }),
    criarConta: (e, c) => chamar("POST", "contas", e, { corpo: c, schema: contaSchema }),
    acaoConta: (e, id, a) => chamar("PATCH", `contas/${encodeURIComponent(id)}`, e, { corpo: a, schema: contaSchema }),
    excluirConta: async (e, id) => { await chamar("DELETE", `contas/${encodeURIComponent(id)}`, e, { schema: ok }); },
    receitas: (e, p) => chamar("GET", "receitas", e, { query: { ...p }, schema: listaReceitas }),
    criarReceita: async (e, r) => { await chamar("POST", "receitas", e, { corpo: r, schema: ok }); },
    acaoReceita: (e, id, a) => chamar("PATCH", `receitas/${encodeURIComponent(id)}`, e, { corpo: a, schema: receitaSchema }),
    contratos: async (e) => (await chamar("GET", "contratos", e, { schema: z.object({ contratos: z.array(contratoSchema) }) })).contratos,
    acaoContrato: async (e, id, a) => { await chamar("PATCH", `contratos/${encodeURIComponent(id)}`, e, { corpo: a, schema: ok }); },
    metas: () => chamar("GET", "metas", "pessoal", { schema: z.array(metaSchema) }),
    aporte: async (a) => { await chamar("POST", "metas/aportes", "pessoal", { corpo: a, schema: ok }); },
    excluirAporte: async (id) => { await chamar("DELETE", `metas/aportes/${encodeURIComponent(id)}`, "pessoal", { schema: ok }); },
    categorias: (e) => chamar("GET", "categorias", e, { schema: categoriasSchema }),
    projecao: (e, dias) => chamar("GET", "projecao", e, { query: { dias }, schema: projecaoSchema }),
    orcamentos: () => chamar("GET", "orcamentos", "pessoal", { schema: z.array(orcamentoSchema) }),
    salvarOrcamento: async (o) => { await chamar("POST", "orcamentos", "pessoal", { corpo: o, schema: ok }); },
    excluirOrcamento: async (categoria) => { await chamar("DELETE", "orcamentos", "pessoal", { query: { categoria }, schema: ok }); },
    dividas: () => chamar("GET", "dividas", "pessoal", { schema: z.array(dividaSchema) }),
    acaoDivida: async (id, a) => { await chamar("PATCH", `dividas/${encodeURIComponent(id)}`, "pessoal", { corpo: a, schema: ok }); },
    contratosDespesa: async (e) => (await chamar("GET", "contratos-despesa", e, { schema: z.object({ contratos: z.array(contratoDespesaSchema) }) })).contratos,
    criarContratoDespesa: async (e, c) => { await chamar("POST", "contratos-despesa", e, { corpo: c, schema: ok }); },
    acaoContratoDespesa: async (e, id, a) => { await chamar("PATCH", `contratos-despesa/${encodeURIComponent(id)}`, e, { corpo: a, schema: ok }); },
    historico: (e, f) => chamar("GET", "historico", e, { query: { entidade: f.entidade, acao: f.acao, de: f.de, ate: f.ate, q: f.q, page: f.page, pageSize: f.pageSize }, schema: historicoSchema }),
    restaurar: async (e, hid) => { await chamar("POST", `historico/${encodeURIComponent(hid)}/restaurar`, e, { schema: ok }); },
  };
}

/** Provedor a partir do ambiente (VENDEDORIA_URL opcional; AVANTEZA_FINANCE_KEY obrigatória). */
export function provedorFinanceiroDoAmbiente(env: NodeJS.ProcessEnv = process.env): FinanceiroProvider {
  const chave = env.AVANTEZA_FINANCE_KEY?.trim();
  if (!chave) throw new FinanceiroErro("AVANTEZA_FINANCE_KEY não configurada neste ambiente.", "nao-configurado");
  return criarProvedorFinanceiro({ baseUrl: env.VENDEDORIA_URL?.trim() || URL_PADRAO, chave });
}
