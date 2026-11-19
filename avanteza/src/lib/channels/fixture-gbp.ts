// Google · Perfil da Empresa SIMULADO, no formato bruto do Windsor (conector google_my_business). Usado pelos testes e, com
// CHANNELS_FIXTURE=1 (só desenvolvimento), pelas telas. Os TOTAIS reproduzem os números conferidos no Windsor para o Showman
// (30 dias: 177 visualizações = Maps celular 68 + Maps computador 15 + Pesquisa celular 68 + Pesquisa computador 26; 69 rotas,
// 7 ligações, 6 cliques no site; 13 avaliações no período; nota 4,9 de 137; "barbeiro" 35). A repartição por dia, os nomes dos
// avaliadores, os textos e os ids são inventados (determinísticos). Nenhuma chamada de rede: o fetch é falso.
import { addDays } from "@/lib/dates";
import { listarDias } from "@/lib/dashboards/periodo";
import { criarWindsorGbp, type FonteGoogleApi } from "./windsor-gbp";

export const LOCAL_SHOWMAN = "SHOW MAN BARBEARIA";
/** Totais reais dos últimos 30 dias (janela hoje-29 … hoje-1; o dia de hoje ainda não tem dado no Google). */
export const GBP_REAL_30D = { maps_mobile: 68, maps_desktop: 15, search_mobile: 68, search_desktop: 26, directions: 69, calls: 7, website: 6, avaliacoes: 13, nota: 4.9, total: 137, barbeiro: 35 } as const;
const GBP_ANTERIOR = { maps_mobile: 61, maps_desktop: 12, search_mobile: 57, search_desktop: 21, directions: 55, calls: 9, website: 4 } as const;
const GBP_ANTES = { maps_mobile: 52, maps_desktop: 10, search_mobile: 49, search_desktop: 18, directions: 47, calls: 6, website: 3 } as const;

function rnd(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Reparte `total` inteiro entre os dias (pesos determinísticos; maior resto). A soma é exatamente `total`. */
function repartir(total: number, dias: string[], seed: string): Map<string, number> {
  const pesos = dias.map((d) => 0.4 + rnd(`${seed}${d}`) * (new Date(`${d}T12:00:00Z`).getUTCDay() === 6 ? 1.6 : 1));
  const soma = pesos.reduce((a, b) => a + b, 0);
  const brutos = pesos.map((p) => (p / soma) * total);
  const base = brutos.map(Math.floor);
  let falta = total - base.reduce((a, b) => a + b, 0);
  const ordem = brutos.map((b, i) => [b - Math.floor(b), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of ordem) { if (falta <= 0) break; base[i]++; falta--; }
  return new Map(dias.map((d, i) => [d, base[i]]));
}

const CAMPOS_DIA: Record<string, keyof typeof GBP_ANTERIOR> = {
  impressions_mobile_maps: "maps_mobile", impressions_desktop_maps: "maps_desktop", impressions_mobile_search: "search_mobile", impressions_desktop_search: "search_desktop",
  direction_requests: "directions", call_clicks: "calls", website_clicks: "website",
};

const NOMES = ["Lucas Andrade", "Rafael Souza", "Bruno Lima", "Gustavo Rocha", "Thiago Martins", "Diego Alves", "Felipe Costa", "Matheus Ribeiro", "João Pedro Silva", "Carlos Eduardo", "Vinícius Melo", "André Nunes", "Leonardo Dias", "Marcos Paulo", "Henrique Teles", "Pedro Henrique"];
const COMENTARIOS = [
  "Atendimento top, corte impecável. Virei assinante!", "None", "Melhor barbearia do Floresta, ambiente muito bom.", "Degradê perfeito, recomendo demais.", "None",
  "Pontual e caprichoso. O plano ilimitado vale muito a pena.", "Muito bom, só demorou um pouco no sábado.", "None", "Barba e cabelo na régua, voltarei sempre.", "Equipe atenciosa e preço justo.",
  "None", "Ótimo corte!", "Lugar limpo, música boa e corte excelente.",
];
const RESPOSTA = "Valeu demais pela avaliação! Te esperamos de volta na Show Man.";

/** As avaliações simuladas: 13 nos últimos 30 dias (12 de 5 estrelas, 1 de 4; 3 ainda sem resposta) e 9 entre 31 e 90 dias atrás. */
export function avaliacoesFixture(hoje: string) {
  const recentes = Array.from({ length: GBP_REAL_30D.avaliacoes }, (_, i) => {
    const d = addDays(hoje, -(1 + Math.round((i * 28) / (GBP_REAL_30D.avaliacoes - 1))));
    return {
      review_id: `AbFvOq-fixture-${String(i + 1).padStart(3, "0")}`, review_star_rating: i === 6 ? "FOUR" : "FIVE", review_create_time: `${d}T${String(12 + (i % 8)).padStart(2, "0")}:15:30.000Z`,
      review_reviewer: NOMES[i], review_comment: COMENTARIOS[i], review_reply_comment: i === 0 || i === 2 || i === 6 ? "None" : RESPOSTA,
    };
  });
  const antigas = Array.from({ length: 9 }, (_, i) => {
    const d = addDays(hoje, -(33 + i * 6));
    return { review_id: `AbFvOq-fixture-a${i}`, review_star_rating: i === 4 ? "FOUR" : "FIVE", review_create_time: `${d}T15:00:00Z`, review_reviewer: NOMES[(i + 7) % NOMES.length], review_comment: i % 2 ? "Muito bom." : "None", review_reply_comment: RESPOSTA };
  });
  return [...recentes, ...antigas];
}

/** Buscas por mês (0 = oculto pelo Google). O mês atual traz "barbeiro" 35. */
function palavrasDoMes(mes: string, hoje: string): Array<[string, number]> {
  const atual = mes === `${hoje.slice(0, 7)}-01`;
  return atual
    ? [["barbeiro", GBP_REAL_30D.barbeiro], ["barbearia", 28], ["barbearia perto de mim", 12], ["show man barbearia", 9], ["barbearia floresta", 0], ["corte de cabelo masculino", 0]]
    : [["barbeiro", 31], ["barbearia", 24], ["barbearia perto de mim", 10], ["show man barbearia", 7], ["barbearia goiania", 0]];
}

/** Linhas brutas do Windsor (google_my_business) para os campos e datas pedidos. Mesmo comportamento do conector real. */
export function respostaGbpFixture(hoje: string, campos: string[], de: string, ate: string, local = LOCAL_SHOWMAN): Array<Record<string, unknown>> {
  const loc = { account_name: local, location_title: local };
  const pega = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => campos.includes(k)));
  if (campos.includes("search_keyword")) return palavrasDoMes(`${de.slice(0, 7)}-01`, hoje).map(([search_keyword, search_keyword_value]) => pega({ ...loc, search_keyword, search_keyword_value }));
  if (campos.includes("review_id")) return avaliacoesFixture(hoje).filter((r) => r.review_create_time.slice(0, 10) >= de && r.review_create_time.slice(0, 10) <= ate).map((r) => pega({ ...loc, ...r }));
  if (campos.includes("review_total_count")) return [pega({ ...loc, review_average_rating_total: GBP_REAL_30D.nota, review_total_count: GBP_REAL_30D.total })];
  if (campos.some((c) => c.startsWith("impressions_") || c === "direction_requests")) {
    const janelas: Array<[string, string, Record<string, number>]> = [
      [addDays(hoje, -29), addDays(hoje, -1), GBP_REAL_30D], [addDays(hoje, -59), addDays(hoje, -30), GBP_ANTERIOR], [addDays(hoje, -119), addDays(hoje, -60), GBP_ANTES],
    ];
    const valores = new Map<string, Record<string, number>>();
    for (const [a, b, tot] of janelas) {
      const dias = listarDias(a, b);
      for (const [campo, k] of Object.entries(CAMPOS_DIA)) for (const [d, v] of repartir(tot[k], dias, k)) valores.set(d, { ...(valores.get(d) ?? {}), [campo]: v });
    }
    return listarDias(de, ate).filter((d) => d < hoje && valores.has(d)).map((d) => pega({ date: d, ...loc, ...valores.get(d), conversations: 0, business_bookings: 0 }));
  }
  return [pega({
    ...loc, location_metadata_maps_uri: "https://maps.google.com/maps?cid=1000000000000000001", location_metadata_new_review_uri: "https://search.google.com/local/writereview?placeid=FIXTURE-PLACE",
    location_categories_primary_category_display_name: "Barbearia", location_storefront_address_sublocality: "Floresta", location_storefront_address_locality: "Goiânia",
  })];
}

export const CAMPOS_CONECTOR_GBP_FIXTURE = [
  "date", "account_name", "location_title", "impressions_mobile_maps", "impressions_mobile_search", "impressions_desktop_maps", "impressions_desktop_search", "call_clicks", "direction_requests",
  "website_clicks", "conversations", "business_bookings", "review_id", "review_star_rating", "review_create_time", "review_reviewer", "review_comment", "review_reply_comment",
  "review_average_rating_total", "review_total_count", "search_keyword", "search_keyword_value", "location_metadata_maps_uri", "location_metadata_new_review_uri",
  "location_categories_primary_category_display_name", "location_storefront_address_sublocality", "location_storefront_address_locality",
];

/** fetch falso do Windsor (google_my_business) com as linhas acima. `chamadas` registra cada URL (para conferir o que foi pedido). */
export function fetchGbpFixture(hoje: string, local = LOCAL_SHOWMAN) {
  const chamadas: URL[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    chamadas.push(u);
    const corpo = u.pathname.endsWith("/fields")
      ? CAMPOS_CONECTOR_GBP_FIXTURE.map((id) => ({ id }))
      : { data: respostaGbpFixture(hoje, (u.searchParams.get("fields") ?? "").split(","), u.searchParams.get("date_from") ?? hoje, u.searchParams.get("date_to") ?? hoje, local) };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, chamadas };
}

/** Fonte do Google simulada (passa pelo parser real com o fetch falso). */
export function criarGoogleFixture(hoje: string, local: string | null = LOCAL_SHOWMAN): FonteGoogleApi {
  return criarWindsorGbp({ chave: "fixture-sem-chave", local, fetchImpl: fetchGbpFixture(hoje).fetchImpl, sleep: async () => undefined, baseDelayMs: 1, maxDelayMs: 2 });
}
