// Orquestração do painel Dashboards: busca Meta (marketing) e Vendedor IA (financeiro/comercial) em paralelo, cada
// fonte isolada — uma indisponível não derruba a página. CAC = investimento da Meta ÷ novos clientes do Vendedor IA.
import { resolverPeriodo, type PeriodoId, type PeriodoResolvido } from "./periodo";
import { carregarMetaComCache, provedorMetaDoAmbiente, traduzirErroMeta, type MetaProvider, type MetaResultado } from "./meta";
import { provedorVendedoriaDoAmbiente, VendedoriaErro, type MetricasVendedoria, type VendedoriaProvider } from "./vendedoria";
import { cacheCompartilhado, type CacheStore } from "./cache";
import { fixtureAtiva, metaFixture, vendedoriaFixture } from "./fixtures";

export type Fonte<T> =
  | { estado: "ok"; dados: T; desatualizado: boolean; geradoEm: number }
  | { estado: "indisponivel"; codigo: string; motivo: string }
  | { estado: "nao-configurado"; motivo: string };

export interface Cac { valor: number | null; anterior: number | null; motivo: string | null }
export interface Dashboards {
  periodo: PeriodoResolvido;
  fixture: boolean;
  vendas: Fonte<MetricasVendedoria>;
  meta: Fonte<MetaResultado>;
  cac: Cac;
}
export interface Dependencias {
  meta?: () => MetaProvider;
  vendedoria?: () => VendedoriaProvider;
  cache?: CacheStore;
  env?: NodeJS.ProcessEnv;
  agora?: () => number;
}

/** CAC = investimento em marketing ÷ novos clientes (negócios ganhos) no mesmo período. "—" com motivo quando falta dado. */
export function calcularCac(
  meta: Fonte<MetaResultado>, vendas: Fonte<MetricasVendedoria>,
): Cac {
  if (vendas.estado !== "ok") return { valor: null, anterior: null, motivo: "Sem os novos clientes do Vendedor IA, não dá para calcular o CAC." };
  if (meta.estado !== "ok") return { valor: null, anterior: null, motivo: "Sem o investimento da Meta, não dá para calcular o CAC." };
  const inv = meta.dados.atual?.gasto ?? 0;
  const invAnt = meta.dados.anterior?.gasto ?? 0;
  const novos = vendas.dados.atual.leads.ganhos;
  const novosAnt = vendas.dados.anterior.leads.ganhos;
  const cac = (g: number, c: number) => (g > 0 && c > 0 ? Math.round((g / c) * 100) / 100 : null);
  const valor = cac(inv, novos);
  const anterior = cac(invAnt, novosAnt);
  if (valor != null) return { valor, anterior, motivo: null };
  if (inv <= 0) return { valor: null, anterior, motivo: "A Meta não registrou investimento no período." };
  return { valor: null, anterior, motivo: "Nenhum cliente novo no período: o CAC fica indefinido (houve investimento, sem conversão em cliente)." };
}

/** Só a Meta da agência (Marketing → Anúncios usa sem depender do Vendedor IA). Mesmo cache e fixture dos Dashboards. */
export async function carregarMeta(periodo: PeriodoResolvido, deps: Dependencias = {}): Promise<Fonte<MetaResultado>> {
  const env = deps.env ?? process.env;
  const modo = fixtureAtiva(env);
  const store = deps.cache ?? cacheCompartilhado;
  const agora = deps.agora ?? Date.now;
  try {
    const prov = deps.meta ? deps.meta() : modo ? metaFixture(modo) : provedorMetaDoAmbiente(env);
    // Fixture não usa o cache compartilhado (evita gravar dados simulados no banco).
    const r = await carregarMetaComCache(prov, periodo.atual, periodo.anterior, modo ? { get: async () => null, set: async () => undefined } : store, agora);
    return { estado: "ok", dados: r.dados, desatualizado: r.desatualizado, geradoEm: r.geradoEm };
  } catch (e) {
    const err = traduzirErroMeta(e);
    if (err.codigo === "nao-configurado") return { estado: "nao-configurado", motivo: err.message };
    return { estado: "indisponivel", codigo: err.codigo, motivo: err.message };
  }
}

export async function carregarDashboards(id: PeriodoId, deps: Dependencias = {}, hoje?: string): Promise<Dashboards> {
  const env = deps.env ?? process.env;
  const periodo = resolverPeriodo(id, hoje);
  const modo = fixtureAtiva(env);
  const agora = deps.agora ?? Date.now;

  const buscarVendas = async (): Promise<Fonte<MetricasVendedoria>> => {
    try {
      const prov = deps.vendedoria ? deps.vendedoria() : modo ? vendedoriaFixture(modo) : provedorVendedoriaDoAmbiente(env);
      return { estado: "ok", dados: await prov.metricas(periodo.atual), desatualizado: false, geradoEm: agora() };
    } catch (e) {
      if (e instanceof VendedoriaErro && e.codigo === "nao-configurado") return { estado: "nao-configurado", motivo: e.message };
      return { estado: "indisponivel", codigo: e instanceof VendedoriaErro ? e.codigo : "rede", motivo: e instanceof VendedoriaErro ? e.message : "Não foi possível falar com o Vendedor IA." };
    }
  };
  const [vendas, meta] = await Promise.all([buscarVendas(), carregarMeta(periodo, deps)]);
  return { periodo, fixture: Boolean(modo), vendas, meta, cac: calcularCac(meta, vendas) };
}
