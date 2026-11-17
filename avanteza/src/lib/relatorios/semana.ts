// Relatório semanal do cliente — partes PURAS (sem banco, sem relógio): semana relatada, destaques e texto de abertura padrão.
// Nada aqui inventa número: sem dado, a seção não aparece.
import { addDaysStr } from "../mapa/plan";

export interface NumerosMarketplace {
  faturamento: number; pedidos: number; ticket: number | null; adsCusto: number; adsReceita: number; roas: number | null; visitas: number;
  variacaoFaturamento: number | null; variacaoPedidos: number | null;
}
export interface NumerosAnuncios {
  gasto: number; resultados: number; custoPorResultado: number | null; cliques: number; impressoes: number; ctr: number | null;
  variacaoResultados: number | null; rotuloResultado: string;
}
export interface NumerosInstagram {
  seguidores: number | null; ganho: number | null; alcance: number | null; interacoes: number | null; variacaoAlcance: number | null;
  melhorPost: { rotulo: string; legenda: string | null; interacoes: number } | null;
}
export interface ItemRelatorio { titulo: string; data: string | null; detalhe?: string | null }

export interface DadosRelatorio {
  cliente: string;
  periodo: { de: string; ate: string };
  marketplaces: NumerosMarketplace | null;
  anuncios: NumerosAnuncios | null;
  instagram: NumerosInstagram | null;
  entregas: ItemRelatorio[];
  proximas: ItemRelatorio[];
  dependeDoCliente: ItemRelatorio[];
}

/** Semana relatada: de segunda a domingo da semana ANTERIOR a `hoje` (rodando na segunda, é a semana que acabou ontem). */
export function semanaAnterior(hoje: string): { de: string; ate: string } {
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const segundaAtual = addDaysStr(hoje, -((dow + 6) % 7));
  return { de: addDaysStr(segundaAtual, -7), ate: addDaysStr(segundaAtual, -1) };
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");
const pctTxt = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Destaques calculados a partir dos números (no máximo 5). */
export function destaquesDe(d: DadosRelatorio): string[] {
  const out: string[] = [];
  const m = d.marketplaces;
  if (m && m.faturamento > 0) {
    out.push(`Faturamento de ${brl(m.faturamento)} nos marketplaces${m.variacaoFaturamento !== null ? ` (${pctTxt(m.variacaoFaturamento)} vs. semana anterior)` : ""}.`);
    if (m.roas !== null && m.adsCusto > 0) out.push(`Cada R$ 1 investido em ADS voltou ${m.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} em vendas.`);
  }
  const a = d.anuncios;
  if (a && a.gasto > 0) {
    out.push(`${int(a.resultados)} ${a.rotuloResultado} com ${brl(a.gasto)} em anúncios${a.custoPorResultado !== null ? ` (${brl(a.custoPorResultado)} cada)` : ""}${a.variacaoResultados !== null ? `, ${pctTxt(a.variacaoResultados)} vs. semana anterior` : ""}.`);
  }
  const i = d.instagram;
  if (i) {
    if (i.ganho !== null && i.ganho !== 0) out.push(`${i.ganho > 0 ? "+" : ""}${int(i.ganho)} seguidores no Instagram${i.seguidores !== null ? ` (agora ${int(i.seguidores)})` : ""}.`);
    if (i.melhorPost && i.melhorPost.interacoes > 0) out.push(`Destaque do Instagram: ${i.melhorPost.rotulo.toLowerCase()} com ${int(i.melhorPost.interacoes)} interações.`);
  }
  if (d.entregas.length) out.push(`${d.entregas.length} entrega${d.entregas.length > 1 ? "s" : ""} concluída${d.entregas.length > 1 ? "s" : ""} pela equipe.`);
  return out.slice(0, 5);
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Abertura padrão (sem IA): curta, factual e sem prometer nada. */
export function aberturaModelo(d: DadosRelatorio): string {
  const partes = [`Este é o resumo da semana de ${dm(d.periodo.de)} a ${dm(d.periodo.ate)} da ${d.cliente} com a Avanteza.`];
  if (d.entregas.length) partes.push(`Concluímos ${d.entregas.length} entrega${d.entregas.length > 1 ? "s" : ""} no período.`);
  if (d.proximas.length) partes.push(`Para os próximos dias, ${d.proximas.length} ${d.proximas.length > 1 ? "ações estão" : "ação está"} na fila.`);
  if (d.dependeDoCliente.length) partes.push(`${d.dependeDoCliente.length === 1 ? "Um item depende" : `${d.dependeDoCliente.length} itens dependem`} de você para seguirmos no ritmo — eles estão listados abaixo.`);
  else partes.push("Nada está parado esperando por você nesta semana.");
  return partes.join(" ");
}

export interface KpiRelatorio { grupo: "Marketplaces" | "Anúncios (Meta)" | "Instagram"; rotulo: string; valor: string; variacao: number | null }

const sp = (s: string) => s.replace(/[  ]/g, " ");
const moeda = (v: number) => sp(brl(v));
const dec1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Números da semana em formato de cartão (mesma lista na tela e no PDF). */
export function kpisDoRelatorio(d: DadosRelatorio): KpiRelatorio[] {
  const out: KpiRelatorio[] = [];
  const m = d.marketplaces;
  if (m) {
    out.push({ grupo: "Marketplaces", rotulo: "Faturamento", valor: moeda(m.faturamento), variacao: m.variacaoFaturamento });
    out.push({ grupo: "Marketplaces", rotulo: "Pedidos", valor: sp(int(m.pedidos)), variacao: m.variacaoPedidos });
    out.push({ grupo: "Marketplaces", rotulo: "Ticket médio", valor: m.ticket !== null ? moeda(m.ticket) : "—", variacao: null });
    if (m.adsCusto > 0) out.push({ grupo: "Marketplaces", rotulo: "ROAS dos ADS", valor: m.roas !== null ? dec1(m.roas) : "—", variacao: null });
  }
  const a = d.anuncios;
  if (a) {
    out.push({ grupo: "Anúncios (Meta)", rotulo: "Investimento", valor: moeda(a.gasto), variacao: null });
    out.push({ grupo: "Anúncios (Meta)", rotulo: a.rotuloResultado === "resultados" ? "Resultados" : "Conversas", valor: sp(int(a.resultados)), variacao: a.variacaoResultados });
    out.push({ grupo: "Anúncios (Meta)", rotulo: a.rotuloResultado === "resultados" ? "Custo por resultado" : "Custo por conversa", valor: a.custoPorResultado !== null ? moeda(a.custoPorResultado) : "—", variacao: null });
  }
  const i = d.instagram;
  if (i) {
    if (i.seguidores !== null) out.push({ grupo: "Instagram", rotulo: "Seguidores", valor: sp(int(i.seguidores)), variacao: null });
    if (i.ganho !== null) out.push({ grupo: "Instagram", rotulo: "Novos seguidores", valor: `${i.ganho > 0 ? "+" : ""}${sp(int(i.ganho))}`, variacao: null });
    if (i.alcance !== null) out.push({ grupo: "Instagram", rotulo: "Alcance", valor: sp(int(i.alcance)), variacao: i.variacaoAlcance });
    if (i.interacoes !== null) out.push({ grupo: "Instagram", rotulo: "Interações", valor: sp(int(i.interacoes)), variacao: null });
  }
  return out;
}

export const fmtVariacao = (v: number) => `${v > 0 ? "+" : ""}${dec1(v)}% vs. semana anterior`;
export const fmtPeriodo = (de: string, ate: string) => `${de.slice(8, 10)}/${de.slice(5, 7)} a ${ate.slice(8, 10)}/${ate.slice(5, 7)}/${ate.slice(0, 4)}`;
