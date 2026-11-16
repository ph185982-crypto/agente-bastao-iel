// Relatório dos canais (funções PURAS sobre as linhas de channel_snapshots): KPIs com variação, série diária, campanhas,
// ranking de criativos, Instagram (KPIs, seguidores, mídias) e Evolução mensal/semanal. Nada é inventado: sem linhas, sem número.
// Nada aqui carrega token, ID de conta de anúncios ou qualquer dado interno: o resultado vai direto para a tela do cliente.
import { addDays } from "@/lib/dates";
import { diasEntre, listarDias, variacaoPct, type PeriodoResolvido } from "@/lib/dashboards/periodo";
import { safeImageUrl } from "@/lib/marketplaces/images";
import { MIN_GASTO_RANKING, type KindSnapshot } from "./types";

export interface Linha { kind: KindSnapshot; date: string; key: string; metrics: Record<string, any> }

const n = (v: unknown): number => { const x = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(x) ? x : 0; };
const tem = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const arred = (x: number, d = 2) => { const f = 10 ** d; return Math.round(x * f) / f; };
const div = (a: number, b: number, d = 2) => (b > 0 ? arred(a / b, d) : null);

export interface Totais { gasto: number; impressoes: number; cliques: number; resultados: number; ctr: number | null; cpc: number | null; custoPorResultado: number | null }
export function somar(rows: Linha[]): Totais {
  let gasto = 0, impressoes = 0, cliques = 0, resultados = 0;
  for (const r of rows) { gasto += n(r.metrics.spend); impressoes += n(r.metrics.impressions); cliques += n(r.metrics.clicks); resultados += n(r.metrics.results); }
  return { gasto: arred(gasto), impressoes, cliques, resultados, ctr: div(cliques * 100, impressoes), cpc: div(gasto, cliques), custoPorResultado: div(gasto, resultados) };
}
const noIntervalo = (rows: Linha[], de: string, ate: string) => rows.filter((r) => r.date >= de && r.date <= ate);

// ─── Anúncios ────────────────────────────────────────────────────────────────

export interface Criativo {
  id: string; nome: string; status: string | null; ativo: boolean; thumb: string | null; video: boolean;
  gasto: number; impressoes: number; cliques: number; resultados: number; ctr: number | null; cpc: number | null; custoPorResultado: number | null;
  selo: "melhor" | "pior" | null;
}
export interface LinhaCampanha extends Totais { id: string; nome: string }
export interface RelAnuncios {
  temHistorico: boolean; temDadosNoPeriodo: boolean;
  atual: Totais; anterior: Totais | null;
  serie: Array<{ data: string; gasto: number; resultados: number }>;
  campanhas: LinhaCampanha[];
  criativos: { ranking: Criativo[]; minGasto: number; foraDoRanking: number; totalAnuncios: number };
}

const statusAtivo = (s?: string | null) => !s || s === "ACTIVE";

export function relAnuncios(rows: Linha[], periodo: PeriodoResolvido, campanhasFiltro: string[], minGasto = MIN_GASTO_RANKING): RelAnuncios {
  const filtra = (r: Linha) => !campanhasFiltro.length || campanhasFiltro.includes(r.key);
  const camp = rows.filter((r) => r.kind === "campaign_daily" && filtra(r));
  const ads = rows.filter((r) => r.kind === "ad_daily" && (!campanhasFiltro.length || campanhasFiltro.includes(String(r.metrics.campaign_id ?? ""))));
  const { atual: a, anterior: p } = periodo;
  const cAtual = noIntervalo(camp, a.de, a.ate), cAnt = noIntervalo(camp, p.de, p.ate);
  const tAtual = somar(cAtual);
  const temDadosNoPeriodo = tAtual.gasto > 0 || tAtual.impressoes > 0;
  const histAntes = camp.some((r) => r.date <= p.ate);

  const porDia = new Map(listarDias(a.de, a.ate).map((d) => [d, { data: d, gasto: 0, resultados: 0 }]));
  for (const r of cAtual) { const x = porDia.get(r.date); if (x) { x.gasto = arred(x.gasto + n(r.metrics.spend)); x.resultados += n(r.metrics.results); } }

  const porCamp = new Map<string, Linha[]>();
  for (const r of cAtual) porCamp.set(r.key, [...(porCamp.get(r.key) ?? []), r]);
  const campanhas: LinhaCampanha[] = [...porCamp.entries()].map(([id, rs]) => ({ id, nome: String(rs[rs.length - 1].metrics.nome ?? id), ...somar(rs) })).sort((x, y) => y.gasto - x.gasto);

  const porAd = new Map<string, Linha[]>();
  for (const r of noIntervalo(ads, a.de, a.ate)) porAd.set(r.key, [...(porAd.get(r.key) ?? []), r]);
  const todos: Criativo[] = [...porAd.entries()].map(([id, rs]) => {
    const ult = rs[rs.length - 1].metrics;
    const comMeta = [...rs].reverse().find((r) => r.metrics.thumb || r.metrics.image || r.metrics.effective_status)?.metrics ?? ult;
    const t = somar(rs);
    return {
      id, nome: String(ult.nome ?? id), status: comMeta.effective_status ?? comMeta.status ?? null, ativo: statusAtivo(comMeta.effective_status ?? comMeta.status),
      thumb: safeImageUrl(comMeta.image) ?? safeImageUrl(comMeta.thumb), video: Boolean(comMeta.video_id), ...t, selo: null,
    };
  });
  const elegiveis = todos.filter((c) => c.gasto >= minGasto);
  elegiveis.sort((x, y) => y.resultados - x.resultados || (x.custoPorResultado ?? Infinity) - (y.custoPorResultado ?? Infinity) || y.gasto - x.gasto);
  if (elegiveis.length >= 2) {
    const comRes = elegiveis.filter((c) => c.custoPorResultado != null);
    const melhor = [...comRes].sort((x, y) => x.custoPorResultado! - y.custoPorResultado!)[0];
    const semRes = elegiveis.filter((c) => c.resultados === 0).sort((x, y) => y.gasto - x.gasto)[0];
    const pior = semRes ?? [...comRes].sort((x, y) => y.custoPorResultado! - x.custoPorResultado!)[0];
    if (melhor) melhor.selo = "melhor";
    if (pior && pior !== melhor) pior.selo = "pior";
  }
  return {
    temHistorico: camp.length > 0 || histAntes, temDadosNoPeriodo, atual: tAtual,
    anterior: cAnt.length ? somar(cAnt) : null, serie: [...porDia.values()], campanhas,
    criativos: { ranking: elegiveis, minGasto, foraDoRanking: todos.length - elegiveis.length, totalAnuncios: todos.length },
  };
}

// ─── Instagram ───────────────────────────────────────────────────────────────

export const IG_ROTULOS: Record<string, string> = {
  reach: "Alcance", views: "Visualizações", profile_views: "Visitas ao perfil", accounts_engaged: "Contas engajadas", total_interactions: "Interações",
};
export interface KpiIg { id: string; rotulo: string; disponivel: boolean; atual: number | null; anterior: number | null; variacao: number | null }
export interface MidiaIg {
  id: string; tipo: string; rotulo: string; data: string; legenda: string | null; permalink: string | null; thumb: string | null;
  alcance: number | null; likes: number | null; comentarios: number | null; salvos: number | null; compartilhamentos: number | null; views: number | null; interacoes: number;
}
export interface FatiaAudiencia { rotulo: string; valor: number; pct: number }
export interface RelAudiencia { idade: FatiaAudiencia[]; genero: FatiaAudiencia[]; cidades: FatiaAudiencia[] }
export interface RelInstagram {
  temDados: boolean;
  /** `estimado`: há dias da série reconstruídos para trás a partir do valor atual e do saldo diário (não foram lidos um a um). */
  seguidores: { atual: number | null; ganho: number | null; serie: Array<{ data: string; valor: number }>; estimado: boolean };
  audiencia: RelAudiencia | null;
  kpis: KpiIg[];
  serie: Array<{ data: string; alcance: number }>;
  midias: MidiaIg[];
  indisponiveis: string[];
}

/** Série de seguidores: usa o valor absoluto guardado quando existe e reconstrói os demais dias com a variação líquida diária. */
export function serieSeguidores(igRows: Linha[], de: string, ate: string): Array<{ data: string; valor: number }> {
  const abs = new Map<string, number>(), net = new Map<string, number>();
  for (const r of igRows) { if (tem(r.metrics.followers)) abs.set(r.date, r.metrics.followers); if (tem(r.metrics.follower_net)) net.set(r.date, r.metrics.follower_net); }
  const ancora = [...abs.keys()].filter((d) => d <= addDays(ate, 0)).sort().pop() ?? [...abs.keys()].sort()[0];
  if (!ancora) return [];
  const dias = listarDias(de, ate);
  const valor = new Map<string, number>();
  let cur = abs.get(ancora)!;
  // Sem variação diária conhecida antes de `piso`, não dá para reconstruir: esses dias ficam de fora (nada inventado).
  const piso = [...abs.keys(), ...net.keys()].sort()[0];
  const limite = addDays(piso, -1) > de ? addDays(piso, -1) : de;
  // Do dia âncora para trás: valor no fim de d; ao recuar subtrai a variação do dia d.
  for (let d = ancora; d >= limite; d = addDays(d, -1)) {
    if (abs.has(d)) cur = abs.get(d)!;
    valor.set(d, cur);
    cur -= net.get(d) ?? 0;
  }
  // Dias depois da âncora (se houver) repetem o último valor conhecido.
  for (let d = addDays(ancora, 1); d <= ate; d = addDays(d, 1)) valor.set(d, abs.get(ancora)!);
  return dias.filter((d) => valor.has(d)).map((d) => ({ data: d, valor: valor.get(d)! }));
}

const GENERO: Record<string, string> = { M: "Homens", F: "Mulheres", U: "Não informado" };
function fatias(m: unknown, rotular: (k: string) => string, ordenar: "chave" | "valor", max = 99): FatiaAudiencia[] {
  if (!m || typeof m !== "object") return [];
  const itens = Object.entries(m as Record<string, unknown>).filter(([, v]) => tem(v) && v > 0) as Array<[string, number]>;
  const total = itens.reduce((t, [, v]) => t + v, 0);
  if (!total) return [];
  itens.sort(ordenar === "chave" ? ([a], [b]) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b) : ([, a], [, b]) => b - a);
  return itens.slice(0, max).map(([k, v]) => ({ rotulo: rotular(k), valor: v, pct: arred((v / total) * 100, 1) }));
}
/** Audiência mais recente guardada (idade, gênero, cidades). Sem linha = sem bloco (nada inventado). */
export function relAudiencia(rows: Linha[]): RelAudiencia | null {
  const ult = rows.filter((r) => r.kind === "ig_audience").sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (!ult) return null;
  const idade = fatias(ult.metrics.idade, (k) => k, "chave"), genero = fatias(ult.metrics.genero, (k) => GENERO[k.toUpperCase()] ?? k, "valor"), cidades = fatias(ult.metrics.cidades, (k) => k.split(",")[0].trim(), "valor", 5);
  return idade.length || genero.length || cidades.length ? { idade, genero, cidades } : null;
}

const TIPO_MIDIA: Record<string, string> = { VIDEO: "Reel", REELS: "Reel", IMAGE: "Foto", CAROUSEL_ALBUM: "Carrossel" };

export function relInstagram(rows: Linha[], periodo: PeriodoResolvido): RelInstagram {
  const ig = rows.filter((r) => r.kind === "ig_daily");
  const { atual: a, anterior: p } = periodo;
  const kpis: KpiIg[] = Object.entries(IG_ROTULOS).map(([id, rotulo]) => {
    const tem_ = ig.filter((r) => tem(r.metrics[id]));
    const soma = (de: string, ate: string) => { const rs = noIntervalo(tem_, de, ate); return rs.length ? rs.reduce((t, r) => t + n(r.metrics[id]), 0) : null; };
    const at = soma(a.de, a.ate), an = soma(p.de, p.ate);
    return { id, rotulo, disponivel: tem_.length > 0, atual: at, anterior: an, variacao: variacaoPct(at, an) };
  });
  const serieSeg = serieSeguidores(ig, addDays(a.de, -1), a.ate);
  const fim = serieSeg[serieSeg.length - 1];
  const inicio = serieSeg.find((x) => x.data === addDays(a.de, -1));
  const midias: MidiaIg[] = rows.filter((r) => r.kind === "ig_media").map((r) => {
    const m = r.metrics;
    const interacoes = tem(m.interactions) ? m.interactions : n(m.likes) + n(m.comments) + n(m.saved) + n(m.shares);
    return {
      id: r.key, tipo: String(m.type ?? ""), rotulo: TIPO_MIDIA[String(m.product ?? "").toUpperCase()] ?? TIPO_MIDIA[String(m.type ?? "")] ?? "Post", data: r.date,
      legenda: typeof m.caption === "string" ? m.caption : null, permalink: typeof m.permalink === "string" && /^https:\/\//.test(m.permalink) ? m.permalink : null,
      thumb: safeImageUrl(m.thumb), alcance: tem(m.reach) ? m.reach : null, likes: tem(m.likes) ? m.likes : null, comentarios: tem(m.comments) ? m.comments : null,
      salvos: tem(m.saved) ? m.saved : null, compartilhamentos: tem(m.shares) ? m.shares : null, views: tem(m.views) ? m.views : null, interacoes,
    };
  }).sort((x, y) => y.interacoes - x.interacoes || (y.alcance ?? 0) - (x.alcance ?? 0)).slice(0, 12);
  // Métricas indisponíveis: vale o aviso mais recente (se a métrica voltou a vir, o aviso antigo não fica para sempre).
  const ultimoAviso = ig.filter((r) => Array.isArray(r.metrics.indisponiveis)).sort((x, y) => x.date.localeCompare(y.date)).pop();
  const indis = new Set<string>((ultimoAviso?.metrics.indisponiveis ?? []).map(String));
  const lidos = new Set(ig.filter((r) => tem(r.metrics.followers)).map((r) => r.date));
  const naSerie = serieSeg.filter((x) => x.data >= a.de);
  return {
    temDados: ig.length > 0 || midias.length > 0,
    seguidores: { atual: fim?.valor ?? null, ganho: fim && inicio ? fim.valor - inicio.valor : null, serie: naSerie, estimado: naSerie.some((x) => !lidos.has(x.data)) },
    audiencia: relAudiencia(rows),
    kpis,
    // Só dias com alcance coletado (hoje ainda não fechou: não vira um "zero" falso no gráfico).
    serie: listarDias(a.de, a.ate).flatMap((d) => { const r = ig.find((x) => x.date === d && tem(x.metrics.reach)); return r ? [{ data: d, alcance: n(r.metrics.reach) }] : []; }),
    midias,
    indisponiveis: [...indis].map((m) => IG_ROTULOS[m] ?? m),
  };
}

// ─── Evolução ────────────────────────────────────────────────────────────────

export interface Marco {
  id: string; rotulo: string; de: string; ate: string; parcial: boolean;
  /** Mês/semana em andamento (ainda não terminou). */
  inicioParcial: boolean;
  gasto: number; resultados: number; custoPorResultado: number | null; impressoes: number;
  alcanceIg: number | null; seguidoresFim: number | null; seguidoresGanho: number | null;
  /** Comparação com o período imediatamente anterior (mesmos dias, quando o atual está em andamento). */
  anterior: { gasto: number; resultados: number; custoPorResultado: number | null; alcanceIg: number | null; seguidoresGanho: number | null; rotulo: string } | null;
}
export type Agrupamento = "mes" | "semana";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const inicioSemana = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return addDays(d, -((w + 6) % 7)); };
const fimMes = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function evolucao(rows: Linha[], agrup: Agrupamento, hoje: string, campanhasFiltro: string[], maxMarcos = 12): Marco[] {
  const camp = rows.filter((r) => r.kind === "campaign_daily" && (!campanhasFiltro.length || campanhasFiltro.includes(r.key)));
  const ig = rows.filter((r) => r.kind === "ig_daily");
  const datas = [...camp, ...ig].map((r) => r.date).sort();
  if (!datas.length) return [];
  const iniDe = (d: string) => (agrup === "mes" ? `${d.slice(0, 7)}-01` : inicioSemana(d));
  const fimDe = (ini: string) => (agrup === "mes" ? fimMes(ini.slice(0, 7)) : addDays(ini, 6));
  const proxIni = (ini: string) => addDays(fimDe(ini), 1);
  const primeiro = iniDe(datas[0]), ultimo = iniDe(hoje);
  const inicios: string[] = [];
  for (let i = primeiro; i <= ultimo; i = proxIni(i)) inicios.push(i);
  const seg = serieSeguidores(ig, datas[0] < primeiro ? datas[0] : primeiro, hoje);
  const segPor = new Map(seg.map((s) => [s.data, s.valor]));

  const calc = (de: string, ate: string) => {
    const t = somar(noIntervalo(camp, de, ate));
    const igs = noIntervalo(ig, de, ate).filter((r) => tem(r.metrics.reach));
    const alcance = igs.length ? igs.reduce((s, r) => s + n(r.metrics.reach), 0) : null;
    const fim = segPor.get(ate > hoje ? hoje : ate) ?? null, ini = segPor.get(addDays(de, -1)) ?? null;
    return { ...t, alcanceIg: alcance, seguidoresFim: fim, seguidoresGanho: fim != null && ini != null ? fim - ini : null };
  };
  const rotulo = (ini: string) => (agrup === "mes" ? `${MESES[Number(ini.slice(5, 7)) - 1]}/${ini.slice(2, 4)}` : `${ddmm(ini)} a ${ddmm(fimDe(ini))}`);

  const marcos: Marco[] = inicios.map((ini, i) => {
    const fim = fimDe(ini);
    const ateEfetivo = fim > hoje ? hoje : fim;
    const c = calc(ini, ateEfetivo);
    let anterior: Marco["anterior"] = null;
    if (i > 0) {
      const pIni = inicios[i - 1];
      const corte = fim > hoje ? addDays(pIni, diasEntre(ini, hoje) - 1) : fimDe(pIni);
      const pc = calc(pIni, corte);
      anterior = { gasto: pc.gasto, resultados: pc.resultados, custoPorResultado: pc.custoPorResultado, alcanceIg: pc.alcanceIg, seguidoresGanho: pc.seguidoresGanho, rotulo: fim > hoje ? `${rotulo(pIni)} (mesmos ${diasEntre(ini, hoje)} dias)` : rotulo(pIni) };
    }
    return { id: ini, rotulo: rotulo(ini), de: ini, ate: ateEfetivo, parcial: fim > hoje, inicioParcial: ini < datas[0], gasto: c.gasto, resultados: c.resultados, custoPorResultado: c.custoPorResultado, impressoes: c.impressoes, alcanceIg: c.alcanceIg, seguidoresFim: c.seguidoresFim, seguidoresGanho: c.seguidoresGanho, anterior };
  });
  return marcos.slice(-maxMarcos);
}
