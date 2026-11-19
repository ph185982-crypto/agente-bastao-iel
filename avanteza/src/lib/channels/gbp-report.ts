// Relatório do GOOGLE · Perfil da Empresa (funções PURAS sobre channel_snapshots gbp_*). Vai direto para a tela do cliente:
// nunca leva id de avaliação, nome completo do avaliador nem id do local. Sem linha, sem número (nada inventado).
import { listarDias, variacaoPct, type PeriodoResolvido } from "@/lib/dashboards/periodo";
import { linkGoogleSeguro } from "./links";
import { limparNome } from "./nomes";
import type { Linha } from "./report";

const tem = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const noIntervalo = (rows: Linha[], de: string, ate: string) => rows.filter((r) => r.date >= de && r.date <= ate);
const arred = (x: number, d = 1) => { const f = 10 ** d; return Math.round(x * f) / f; };

export const SUPERFICIES = [
  { id: "maps_mobile", rotulo: "Maps · celular" }, { id: "maps_desktop", rotulo: "Maps · computador" },
  { id: "search_mobile", rotulo: "Pesquisa · celular" }, { id: "search_desktop", rotulo: "Pesquisa · computador" },
] as const;
const vis = (m: Record<string, any>) => SUPERFICIES.reduce((t, s) => t + (tem(m[s.id]) ? m[s.id] : 0), 0);
const temVis = (m: Record<string, any>) => SUPERFICIES.some((s) => tem(m[s.id]));

export interface KpiGoogle { atual: number | null; anterior: number | null; variacao: number | null }
export interface AvaliacaoCliente { id: string; autor: string; estrelas: number | null; data: string; comentario: string | null; resposta: string | null }
export interface RelGoogle {
  temDados: boolean;
  local: { titulo: string | null; categoria: string | null; bairro: string | null; cidade: string | null; mapsUrl: string | null; avaliarUrl: string | null } | null;
  visualizacoes: KpiGoogle; maps: KpiGoogle; pesquisa: KpiGoogle; rotas: KpiGoogle; ligacoes: KpiGoogle; site: KpiGoogle;
  /** Só aparecem quando o perfil tem esses recursos (alguma linha com valor > 0). */
  conversas: KpiGoogle | null; reservas: KpiGoogle | null;
  superficies: Array<{ id: string; rotulo: string; valor: number; pct: number }>;
  serie: Array<{ data: string; visualizacoes: number; acoes: number }>;
  nota: { media: number | null; total: number | null; noPeriodo: number; mediaNoPeriodo: number | null; semResposta: number; porEstrela: number[] };
  /** Avaliações mais recentes (primeiro nome do autor; "sem resposta" = resposta null). */
  avaliacoes: AvaliacaoCliente[];
  /** Termos do mês mais recente do período (`parcial` = mês em andamento); `anterior` = mesmo termo no mês anterior (null = oculto/sem dado). */
  buscas: { mes: string | null; mesAnterior: string | null; parcial: boolean; itens: Array<{ termo: string; valor: number | null; anterior: number | null }>; ocultas: number };
}

/** Só o primeiro nome do avaliador (o Mapa nunca mostra o nome completo). */
export function primeiroNome(v: unknown): string {
  if (typeof v !== "string") return "Cliente do Google";
  const p = limparNome(v).split(/\s+/).find((x) => /\p{L}/u.test(x));
  return p ? p.slice(0, 40) : "Cliente do Google";
}

function kpi(rows: Linha[], periodo: PeriodoResolvido, f: (m: Record<string, any>) => number | null): KpiGoogle {
  const soma = (de: string, ate: string) => { const vs = noIntervalo(rows, de, ate).map((r) => f(r.metrics)).filter(tem); return vs.length ? vs.reduce((a, b) => a + b, 0) : null; };
  const atual = soma(periodo.atual.de, periodo.atual.ate), anterior = soma(periodo.anterior.de, periodo.anterior.ate);
  return { atual, anterior, variacao: variacaoPct(atual, anterior) };
}
const campo = (k: string) => (m: Record<string, any>) => (tem(m[k]) ? m[k] : null);

export function relGoogle(rows: Linha[], periodo: PeriodoResolvido, maxAvaliacoes = 8): RelGoogle {
  const dia = rows.filter((r) => r.kind === "gbp_daily");
  const revs = rows.filter((r) => r.kind === "gbp_review");
  const kw = rows.filter((r) => r.kind === "gbp_keyword");
  const prof = rows.filter((r) => r.kind === "gbp_profile").sort((a, b) => a.date.localeCompare(b.date));
  const { atual: a } = periodo;

  // Local e totais: vale o último valor não nulo de cada campo.
  const ult = (k: string) => { for (let i = prof.length - 1; i >= 0; i--) { const v = prof[i].metrics[k]; if (v != null && v !== "") return v; } return null; };
  const txt = (k: string) => { const v = ult(k); return typeof v === "string" ? v.slice(0, 200) : null; };
  const local = prof.length ? { titulo: txt("title"), categoria: txt("category"), bairro: txt("neighborhood"), cidade: txt("city"), mapsUrl: linkGoogleSeguro(ult("maps_uri")), avaliarUrl: linkGoogleSeguro(ult("review_uri")) } : null;

  const opcional = (k: string) => (dia.some((r) => tem(r.metrics[k]) && r.metrics[k] > 0) ? kpi(dia, periodo, campo(k)) : null);
  const visualizacoes = kpi(dia, periodo, (m) => (temVis(m) ? vis(m) : null));
  const atualDia = noIntervalo(dia, a.de, a.ate);
  const totSup = SUPERFICIES.map((s) => ({ id: s.id, rotulo: s.rotulo, valor: atualDia.reduce((t, r) => t + (tem(r.metrics[s.id]) ? r.metrics[s.id] : 0), 0) }));
  const somaSup = totSup.reduce((t, s) => t + s.valor, 0);
  const porDia = new Map(atualDia.map((r) => [r.date, r.metrics]));
  const serie = listarDias(a.de, a.ate).flatMap((d) => {
    const m = porDia.get(d);
    if (!m) return [];
    return [{ data: d, visualizacoes: vis(m), acoes: (tem(m.directions) ? m.directions : 0) + (tem(m.calls) ? m.calls : 0) + (tem(m.website) ? m.website : 0) }];
  });

  // Avaliações: as do período contam para a nota do período; a lista mostra as mais recentes guardadas.
  const ordenadas = [...revs].sort((x, y) => String(y.metrics.created_at ?? y.date).localeCompare(String(x.metrics.created_at ?? x.date)));
  const doPeriodo = noIntervalo(revs, a.de, a.ate);
  const estrelas = doPeriodo.map((r) => r.metrics.stars).filter(tem);
  const porEstrela = [1, 2, 3, 4, 5].map((n) => estrelas.filter((e) => e === n).length);
  const media = ult("rating_avg"), total = ult("rating_count");
  const avaliacoes: AvaliacaoCliente[] = ordenadas.slice(0, maxAvaliacoes).map((r, i) => ({
    id: `r${i}`, autor: primeiroNome(r.metrics.reviewer), estrelas: tem(r.metrics.stars) ? r.metrics.stars : null, data: r.date,
    comentario: typeof r.metrics.comment === "string" ? r.metrics.comment.slice(0, 1200) : null, resposta: typeof r.metrics.reply === "string" ? r.metrics.reply.slice(0, 1200) : null,
  }));

  // Buscas: o Google só dá o total por MÊS. Mostramos o mês mais recente do período que tem termos (com o mês anterior para comparar).
  // Valor oculto pelo Google (0 no conector) nunca vira zero: fica null ("poucas buscas").
  const mesesKw = [...new Set(kw.map((r) => r.date))].sort();
  const mes = mesesKw.filter((m) => m.slice(0, 7) >= a.de.slice(0, 7) && m.slice(0, 7) <= a.ate.slice(0, 7)).pop() ?? null;
  const mesAnt = mes ? mesesKw.filter((m) => m < mes).pop() ?? null : null;
  const valorDe = (r: Linha) => (tem(r.metrics.value) && r.metrics.value > 0 ? r.metrics.value : null);
  const ant = new Map(kw.filter((r) => r.date === mesAnt).map((r) => [r.key, valorDe(r)]));
  const itens = kw.filter((r) => r.date === mes).map((r) => ({ termo: limparNome(r.key).slice(0, 80) || r.key.slice(0, 80), valor: valorDe(r), anterior: ant.get(r.key) ?? null }))
    .sort((x, y) => (y.valor ?? -1) - (x.valor ?? -1) || x.termo.localeCompare(y.termo));

  return {
    temDados: dia.length > 0 || revs.length > 0 || prof.length > 0 || kw.length > 0,
    local, visualizacoes,
    maps: kpi(dia, periodo, (m) => (tem(m.maps_mobile) || tem(m.maps_desktop) ? (m.maps_mobile ?? 0) + (m.maps_desktop ?? 0) : null)),
    pesquisa: kpi(dia, periodo, (m) => (tem(m.search_mobile) || tem(m.search_desktop) ? (m.search_mobile ?? 0) + (m.search_desktop ?? 0) : null)),
    rotas: kpi(dia, periodo, campo("directions")), ligacoes: kpi(dia, periodo, campo("calls")), site: kpi(dia, periodo, campo("website")),
    conversas: opcional("conversations"), reservas: opcional("bookings"),
    superficies: totSup.map((s) => ({ ...s, pct: somaSup ? arred((s.valor / somaSup) * 100) : 0 })),
    serie,
    nota: {
      media: tem(media) ? media : null, total: tem(total) ? total : null, noPeriodo: doPeriodo.length,
      mediaNoPeriodo: estrelas.length ? arred(estrelas.reduce((x, y) => x + y, 0) / estrelas.length) : null,
      semResposta: doPeriodo.filter((r) => typeof r.metrics.reply !== "string" || !r.metrics.reply.trim()).length, porEstrela,
    },
    avaliacoes,
    buscas: { mes, mesAnterior: mesAnt, parcial: mes != null && mes.slice(0, 7) === a.ate.slice(0, 7), itens: itens.slice(0, 12), ocultas: itens.filter((i) => i.valor == null).length },
  };
}

/** Números do Google de um intervalo (Evolução): visualizações, rotas, ligações e a nota média das avaliações escritas nele. */
export function googleNoIntervalo(rows: Linha[], de: string, ate: string): { visualizacoes: number; rotas: number; ligacoes: number; nota: number | null; avaliacoes: number } | null {
  const dia = noIntervalo(rows.filter((r) => r.kind === "gbp_daily"), de, ate);
  const revs = noIntervalo(rows.filter((r) => r.kind === "gbp_review"), de, ate);
  if (!dia.length && !revs.length) return null;
  const est = revs.map((r) => r.metrics.stars).filter(tem);
  return {
    visualizacoes: dia.reduce((t, r) => t + vis(r.metrics), 0), rotas: dia.reduce((t, r) => t + (tem(r.metrics.directions) ? r.metrics.directions : 0), 0),
    ligacoes: dia.reduce((t, r) => t + (tem(r.metrics.calls) ? r.metrics.calls : 0), 0), nota: est.length ? arred(est.reduce((x, y) => x + y, 0) / est.length) : null, avaliacoes: revs.length,
  };
}
