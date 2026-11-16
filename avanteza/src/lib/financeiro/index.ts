// Orquestração do Financeiro da Central: escolhe o provedor (Vendedor IA, ou a fixture em desenvolvimento) e carrega cada
// bloco isolado — se uma fonte falhar a tela mostra o aviso daquele bloco ("Vendedor IA indisponível") e segue com o resto.
import {
  FinanceiroErro, mensagemDoErro, provedorFinanceiroDoAmbiente, type Conta, type Contrato, type EscopoFin, type FinanceiroProvider,
  type PeriodoFin, type Resumo, type Transacao,
} from "./vendedoria";
import { criarProvedorFixture, fixtureFinanceiroAtiva } from "./fixture";
import { ultimoDia } from "./periodo";

export type Fonte<T> =
  | { estado: "ok"; dados: T }
  | { estado: "indisponivel"; codigo: string; motivo: string }
  | { estado: "nao-configurado"; motivo: string };

const fixtures = new Map<string, FinanceiroProvider>();

/** Provedor do ambiente. `injetado` é para teste. Fixture (só fora de produção) guarda o estado em memória por processo. */
export function obterProvedor(env: NodeJS.ProcessEnv = process.env, injetado?: FinanceiroProvider): FinanceiroProvider {
  if (injetado) return injetado;
  const modo = fixtureFinanceiroAtiva(env);
  if (modo) {
    let p = fixtures.get(modo);
    if (!p) { p = criarProvedorFixture(modo); fixtures.set(modo, p); }
    return p;
  }
  return provedorFinanceiroDoAmbiente(env);
}
export const emFixture = (env: NodeJS.ProcessEnv = process.env) => Boolean(fixtureFinanceiroAtiva(env));

export async function tentar<T>(fn: (p: FinanceiroProvider) => Promise<T>, env: NodeJS.ProcessEnv = process.env, injetado?: FinanceiroProvider): Promise<Fonte<T>> {
  try {
    return { estado: "ok", dados: await fn(obterProvedor(env, injetado)) };
  } catch (e) {
    if (e instanceof FinanceiroErro && e.codigo === "nao-configurado") return { estado: "nao-configurado", motivo: e.message };
    return { estado: "indisponivel", codigo: e instanceof FinanceiroErro ? e.codigo : "rede", motivo: mensagemDoErro(e) };
  }
}

/** Todos os lançamentos de um período (várias páginas de 100); `truncado` se passou do limite de segurança. */
export async function todasTransacoes(p: FinanceiroProvider, escopo: EscopoFin, per: Required<Pick<PeriodoFin, "de" | "ate">>, maxPaginas = 8): Promise<{ itens: Transacao[]; truncado: boolean }> {
  const itens: Transacao[] = [];
  for (let page = 1; page <= maxPaginas; page++) {
    const r = await p.transacoes(escopo, { de: per.de, ate: per.ate, page, pageSize: 100 });
    itens.push(...r.transacoes);
    if (page >= r.paginas) return { itens, truncado: false };
  }
  return { itens, truncado: true };
}

export interface PontoDiario { data: string; receitas: number; despesas: number }

/** Série diária (só confirmados) de receitas e despesas do mês. */
export function serieDiaria(mes: string, itens: Transacao[]): PontoDiario[] {
  const dias = Number(ultimoDia(mes).slice(8));
  const pts: PontoDiario[] = Array.from({ length: dias }, (_, i) => ({ data: `${mes}-${String(i + 1).padStart(2, "0")}`, receitas: 0, despesas: 0 }));
  for (const t of itens) {
    if (!t.confirmado) continue;
    const p = pts[Number(t.data_transacao.slice(8, 10)) - 1];
    if (!p || t.data_transacao.slice(0, 7) !== mes) continue;
    if (t.tipo === "receita") p.receitas = Math.round((p.receitas + t.valor) * 100) / 100;
    else p.despesas = Math.round((p.despesas + t.valor) * 100) / 100;
  }
  return pts;
}

export interface VisaoGeral {
  resumo: Fonte<Resumo>;
  contas: Fonte<Conta[]>;
  contratos: Fonte<Contrato[]>;
  diario: Fonte<{ pontos: PontoDiario[]; truncado: boolean }>;
}

export async function carregarVisaoGeral(escopo: EscopoFin, mes: string, env: NodeJS.ProcessEnv = process.env, injetado?: FinanceiroProvider): Promise<VisaoGeral> {
  const de = `${mes}-01`, ate = ultimoDia(mes);
  const [resumo, contas, contratos, diario] = await Promise.all([
    tentar((p) => p.resumo(escopo, { mes }), env, injetado),
    tentar((p) => p.contas(escopo, "pendente"), env, injetado),
    tentar((p) => p.contratos(escopo), env, injetado),
    tentar(async (p) => { const r = await todasTransacoes(p, escopo, { de, ate }); return { pontos: serieDiaria(mes, r.itens), truncado: r.truncado }; }, env, injetado),
  ]);
  return { resumo, contas, contratos, diario };
}
