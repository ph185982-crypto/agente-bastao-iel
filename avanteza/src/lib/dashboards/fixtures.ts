// Dados simulados SÓ para desenvolvimento e teste (capturas de tela, QA visual). Ativados por DASHBOARDS_FIXTURE
// (1 = tudo com dados, vazio = fontes sem dados, erro = fontes indisponíveis) e SÓ fora de produção: com NODE_ENV=production
// (Vercel: produção e previews) ou VERCEL_ENV=production a variável é ignorada. Não há nenhum dado real aqui.
import type { Intervalo } from "./periodo";
import { listarDias } from "./periodo";
import { addDays } from "@/lib/dates";
import type { ContaAnuncio, ConsultaInsights, LinhaBruta, MetaProvider } from "./meta";
import { MetaErro } from "./meta";
import { VendedoriaErro, type BlocoVendedoria, type MetricasVendedoria, type VendedoriaProvider } from "./vendedoria";

export type ModoFixture = "1" | "vazio" | "erro";

export function fixtureAtiva(env: NodeJS.ProcessEnv = process.env): ModoFixture | null {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return null;
  const v = env.DASHBOARDS_FIXTURE?.trim();
  return v === "1" || v === "vazio" || v === "erro" ? v : null;
}

/** Aleatório determinístico (0..1) a partir de um texto. */
function rnd(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const r2 = (x: number) => Math.round(x * 100) / 100;
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

function blocoFixture(de: string, ate: string, escala: number, vazio: boolean): BlocoVendedoria {
  const dias = listarDias(de, ate);
  const series = dias.map((data) => {
    const util = dow(data) !== 0 && dow(data) !== 6 ? 1 : 0.35;
    const leadsNovos = vazio ? 0 : Math.round((4 + rnd(`l${data}`) * 9) * util * escala);
    const ganhos = vazio ? 0 : rnd(`g${data}`) < 0.32 * util * escala ? 1 + (rnd(`g2${data}`) < 0.2 ? 1 : 0) : 0;
    const vendas = ganhos * Math.round(2400 + rnd(`v${data}`) * 1800);
    const dia = Number(data.slice(8, 10));
    const receitas = vazio ? 0 : r2((dia >= 5 && dia <= 10 ? 3800 + rnd(`r${data}`) * 5200 : rnd(`r${data}`) < 0.25 ? 800 + rnd(`r2${data}`) * 2200 : 0) * escala);
    const despesas = vazio ? 0 : r2((rnd(`d${data}`) < 0.55 ? 150 + rnd(`d2${data}`) * 1400 : 0) * (0.9 + rnd(`d3${data}`) * 0.3));
    return { data, leadsNovos, ganhos, vendas, receitas, despesas };
  });
  const sum = (k: "leadsNovos" | "ganhos" | "vendas" | "receitas" | "despesas") => r2(series.reduce((a, p) => a + p[k], 0));
  const novos = sum("leadsNovos"), ganhos = sum("ganhos"), vendas = sum("vendas"), receitas = sum("receitas"), despesas = sum("despesas");
  const perdidos = Math.round(novos * 0.18);
  const viraram = Math.min(ganhos, novos);
  const resto = Math.max(0, novos - viraram - perdidos);
  const novosEtapa = Math.round(resto * 0.42), qualif = Math.round(resto * 0.3), propos = Math.round(resto * 0.16);
  const porEtapa = vazio ? [] : [
    { etapa: "Novos", tipo: "TRIAGE", quantidade: novosEtapa },
    { etapa: "Em qualificação", tipo: "EM_QUALIFICACAO", quantidade: qualif },
    { etapa: "Proposta e negociação", tipo: "PROPOSTA_NEGOCIACAO", quantidade: propos },
    { etapa: "Reunião agendada", tipo: "REUNIAO_AGENDADA", quantidade: Math.max(0, resto - novosEtapa - qualif - propos) },
    { etapa: "Ganho", tipo: "GANHO", quantidade: viraram },
    { etapa: "Perdido", tipo: "LOST", quantidade: perdidos },
  ].filter((e) => e.quantidade > 0);
  const despCat = [["Anúncios", 0.46], ["Software e ferramentas", 0.2], ["Equipe e freelancers", 0.22], ["Impostos e taxas", 0.12]] as const;
  return {
    periodo: { from: de, to: ate, dias: dias.length },
    leads: { novos, porEtapa, ganhos, perdidos },
    conversao: { leadsDaCoorte: novos, viraramCliente: viraram, taxaPct: novos ? Math.round((viraram / novos) * 1000) / 10 : null },
    vendas: { quantidade: ganhos, valor: vendas, ticketMedio: ganhos ? r2(vendas / ganhos) : null, comValor: ganhos },
    faturamento: { vendido: vendas, contratosRecorrentesNovos: Math.round(ganhos * 0.7), valorMensalRecorrenteNovo: r2(vendas * 0.35), contratosParceladosNovos: Math.round(ganhos * 0.2), valorParceladoNovo: r2(vendas * 0.25) },
    financeiro: {
      receitas, despesas, resultado: r2(receitas - despesas),
      receitasPorCategoria: vazio ? [] : [{ categoria: "Mensalidades", valor: r2(receitas * 0.72) }, { categoria: "Projetos", valor: r2(receitas * 0.28) }],
      despesasPorCategoria: vazio ? [] : despCat.map(([categoria, p]) => ({ categoria, valor: r2(despesas * p) })),
    },
    series,
  };
}

export function vendedoriaFixture(modo: ModoFixture = "1"): VendedoriaProvider {
  return {
    async metricas({ de, ate }: Intervalo): Promise<MetricasVendedoria> {
      if (modo === "erro") throw new VendedoriaErro("O Vendedor IA demorou demais para responder.", "timeout");
      const vazio = modo === "vazio";
      const dias = listarDias(de, ate).length;
      const antAte = addDays(de, -1), antDe = addDays(antAte, -(dias - 1));
      const ag = (t: number, q: number, a: number, a2: number, p30: number, p60: number, p90: number) =>
        ({ total: vazio ? 0 : t, quantidade: vazio ? 0 : q, atrasado: { total: vazio ? 0 : a, quantidade: vazio ? 0 : a2 }, proximos30: vazio ? 0 : p30, proximos60: vazio ? 0 : p60, proximos90: vazio ? 0 : p90 });
      return {
        versao: 1, geradoEm: new Date().toISOString(),
        escopo: { financeiro: "avanteza", tiposNegocio: ["nexo", "vendedoria"], excluido: ["pessoal", "lukaizen", "geral"], comercial: "todas as organizações do Vendedor IA", observacao: "Dados simulados (fixture local)." },
        atual: blocoFixture(de, ate, 1, vazio),
        anterior: blocoFixture(antDe, antAte, 0.97, vazio),
        previstos: {
          referencia: ate,
          aReceber: { ...ag(48600, 17, 3200, 2, 21400, 38900, 48600), deContratos: { total: vazio ? 0 : 41300, quantidade: vazio ? 0 : 14 } },
          aPagar: ag(15900, 11, 600, 1, 8200, 12100, 15900),
          saldoProjetado30: vazio ? 0 : 13200, saldoProjetado90: vazio ? 0 : 32700,
        },
        contratos: vazio ? { ativos: 0, recorrentes: 0, parcelados: 0, valorMensalRecorrente: 0, saldoAReceberParcelados: 0 } : { ativos: 14, recorrentes: 11, parcelados: 3, valorMensalRecorrente: 21400, saldoAReceberParcelados: 9800 },
      };
    },
  };
}

const CONTAS: ContaAnuncio[] = [
  { id: "act_1000000000001", nome: "Avanteza — Captação", moeda: "BRL", status: 1 },
  { id: "act_1000000000002", nome: "Avanteza — WhatsApp", moeda: "BRL", status: 1 },
  { id: "act_1000000000003", nome: "Conta antiga (desativada)", moeda: "BRL", status: 2 },
];
const CAMPANHAS: Record<string, string[]> = {
  act_1000000000001: ["Captação — Lookalike 1%", "Remarketing — Visitantes 30d", "Institucional — Reconhecimento"],
  act_1000000000002: ["WhatsApp — Diagnóstico gratuito", "WhatsApp — Marketplace"],
};

function linhaDia(seed: string, conta: string, escala: number): Omit<LinhaBruta, "date_start" | "date_stop"> {
  const gasto = (conta.endsWith("1") ? 120 : 70) * (0.7 + rnd(`s${seed}`) * 0.7) * escala;
  const impressoes = Math.round(gasto * (70 + rnd(`i${seed}`) * 40));
  const cliques = Math.round(impressoes * (0.012 + rnd(`c${seed}`) * 0.012));
  const leads = conta.endsWith("1") ? Math.round(cliques * (0.05 + rnd(`ld${seed}`) * 0.05)) : 0;
  const conversas = conta.endsWith("2") ? Math.round(cliques * (0.12 + rnd(`cv${seed}`) * 0.08)) : 0;
  const compras = conta.endsWith("1") && rnd(`p${seed}`) < 0.12 ? 1 : 0;
  const actions = [
    ...(leads ? [{ action_type: "lead", value: String(leads) }] : []),
    ...(conversas ? [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(conversas) }] : []),
    ...(compras ? [{ action_type: "purchase", value: String(compras) }] : []),
  ];
  return {
    spend: gasto.toFixed(2), impressions: String(impressoes), reach: String(Math.round(impressoes * 0.62)), clicks: String(cliques),
    ctr: String((cliques / Math.max(impressoes, 1)) * 100), cpc: String(gasto / Math.max(cliques, 1)), actions,
    action_values: compras ? [{ action_type: "purchase", value: String(2800 + Math.round(rnd(`pv${seed}`) * 1500)) }] : [],
  };
}
const soma = (rows: LinhaBruta[]): LinhaBruta => {
  const f = (k: "spend" | "impressions" | "reach" | "clicks") => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const acc = new Map<string, number>(), val = new Map<string, number>();
  for (const r of rows) { for (const a of r.actions ?? []) acc.set(a.action_type, (acc.get(a.action_type) ?? 0) + Number(a.value)); for (const a of r.action_values ?? []) val.set(a.action_type, (val.get(a.action_type) ?? 0) + Number(a.value)); }
  return { spend: f("spend").toFixed(2), impressions: String(f("impressions")), reach: String(Math.round(f("reach") * 0.55)), clicks: String(f("clicks")), actions: [...acc].map(([action_type, value]) => ({ action_type, value: String(value) })), action_values: [...val].map(([action_type, value]) => ({ action_type, value: String(value) })) };
};

export function metaFixture(modo: ModoFixture = "1"): MetaProvider {
  return {
    async listarContas() {
      if (modo === "erro") throw new MetaErro("A Meta limitou as consultas por agora. Tente novamente em alguns minutos.", "limite");
      return CONTAS;
    },
    async insights(q: ConsultaInsights) {
      if (modo === "vazio" || q.contaId === "act_1000000000003") return [];
      const dias = listarDias(q.de, q.ate);
      if (q.nivel === "campaign") {
        const nomes = CAMPANHAS[q.contaId] ?? [];
        return nomes.map((nome, k) => {
          const rows = dias.map((d) => ({ ...linhaDia(`${d}${k}`, q.contaId, 1 / nomes.length * (k === 0 ? 1.4 : 0.8)) }));
          return { ...soma(rows), campaign_id: `${q.contaId}_c${k}`, campaign_name: nome };
        });
      }
      const rows = dias.map((d) => ({ ...linhaDia(d, q.contaId, 1), date_start: d, date_stop: d }));
      return q.diario ? rows : [soma(rows)];
    },
  };
}
