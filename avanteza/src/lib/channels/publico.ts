// Público e localização dos anúncios (Mapa → Canais → Anúncios e aba Canais do administrador).
// Três cortes guardados em channel_snapshots (kind ads_breakdown, um por consulta: idade×gênero, região, posicionamento) e a
// segmentação de cada conjunto (kind adset_targeting, vale o último estado). Funções PURAS + um carregador.
// REGRA: o que vai para o cliente nunca tem id, nome de arquivo (.csv), JSON nem nada técnico; só o administrador recebe `tecnico`.
// Conversas que a fonte não entrega num corte (ex.: região pelo Windsor) ficam "indisponíveis neste corte", nunca viram zero.
import { addDays } from "@/lib/dates";
import type { PeriodoResolvido } from "@/lib/dashboards/periodo";
import { filtrarLinhasCampanhas, normalizarNome } from "./campanhas";
import { lerSnapshots, type CanalRow } from "./store";
import type { DimensaoQuebra, OrigemDado } from "./types";

export interface LinhaSnap { kind: string; date: string; key: string; metrics: Record<string, any> }

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const x = Number(v); return Number.isFinite(x) ? x : null; }
  return null;
};
const arred = (x: number, d = 2) => { const f = 10 ** d; return Math.round(x * f) / f; };
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

// ─── Segmentação (targeting) ─────────────────────────────────────────────────

export interface LocalAlvo {
  tipo: "raio" | "cidade" | "regiao" | "pais" | "cep" | "outro";
  /** Texto em linguagem simples (ex.: "3 km ao redor de ponto definido"). */
  texto: string;
  /** Link do Google Maps (só para raio/cidade com coordenadas). */
  mapa: string | null;
}
export interface PublicoConfigurado {
  conjunto: string;
  campanha: string | null;
  /** false quando a fonte disse que o conjunto não está ativo. */
  ativo: boolean | null;
  /** false = a segmentação não pôde ser lida (formato desconhecido). */
  legivel: boolean;
  idade: string | null;
  genero: string;
  locais: LocalAlvo[];
  locaisExcluidos: string[];
  publicos: string[];
  publicosExcluidos: string[];
  interesses: string[];
  interessesExcluidos: string[];
  /** null = automático (a Meta escolhe onde mostrar). */
  posicionamentos: string | null;
  notas: string[];
}
export interface TargetingTecnico { conjunto: string; campanha: string | null; json: string; naoInterpretados: string[] }

/** Texto JSON ou objeto → objeto. Formato desconhecido = null (nada inventado). */
export function lerTargeting(v: unknown): Record<string, any> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  if (typeof v !== "string" || !v.trim()) return null;
  try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

const CHAVES_CONHECIDAS = new Set([
  "age_min", "age_max", "age_range", "genders", "geo_locations", "excluded_geo_locations", "custom_audiences", "excluded_custom_audiences",
  "flexible_spec", "exclusions", "interests", "behaviors", "publisher_platforms", "facebook_positions", "instagram_positions", "messenger_positions",
  "audience_network_positions", "threads_positions", "device_platforms", "targeting_automation", "targeting_relaxation_types", "locales",
  "brand_safety_content_filter_levels", "targeting_optimization", "user_os", "user_device", "connections", "excluded_connections",
]);

export { limparNome } from "./nomes";
import { limparNome } from "./nomes";

const NEGOCIOS: Array<[RegExp, string]> = [
  [/barbearia/, "da barbearia"], [/clinica/, "da clínica"], [/academia/, "da academia"], [/restaurante/, "do restaurante"], [/salao/, "do salão"],
  [/studio|estudio/, "do estúdio"], [/escola/, "da escola"], [/pet ?shop/, "do pet shop"], [/otica/, "da ótica"], [/farmacia/, "da farmácia"],
  [/padaria/, "da padaria"], [/pizzaria/, "da pizzaria"], [/hamburgueria/, "da hamburgueria"], [/imobiliaria/, "da imobiliária"],
  [/consultorio/, "do consultório"], [/oficina/, "da oficina"], [/loja/, "da loja"],
];
/** "da barbearia", "da clínica"… a partir do nome do cliente (null quando não dá para saber). */
export function negocioDoNome(nome: string | null | undefined): string | null {
  const n = normalizarNome(nome ?? "");
  return NEGOCIOS.find(([re]) => re.test(n))?.[1] ?? null;
}

const ehLista = (n: string) => /\.(csv|txt|xlsx?)\b|\bbase\b|client|cadastr|lista|customer|\bcrm\b|contato|\bleads?\b|assinante|compr/.test(n);
const ehInstagram = (n: string) => /instagram|\big\b|insta/.test(n);
const ehFacebook = (n: string) => /facebook|\bfb\b|pagina|page/.test(n);
const ehEngaj = (n: string) => /engaj|engag|intera|segui|follow/.test(n);
const ehSite = (n: string) => /\bsite\b|pixel|\bweb|landing|\blp\b|visitante/.test(n);
const ehVideo = (n: string) => /video|assist|thruplay|\bview/.test(n);
const ehConversa = (n: string) => /whats|\bwpp\b|\bzap\b|mensag|messag|convers|direct/.test(n);

function rotuloFonte(n: string, negocio: string | null): string {
  if (ehLista(n)) return `lista de clientes${negocio ? ` ${negocio}` : " cadastrados"}`;
  if (ehVideo(n)) return "pessoas que assistiram aos vídeos";
  if (ehConversa(n)) return "pessoas que já conversaram com a empresa";
  if (ehSite(n)) return "visitantes do site";
  if (ehInstagram(n)) return "pessoas que interagiram com o Instagram";
  if (ehFacebook(n)) return "pessoas que interagiram com a página do Facebook";
  if (ehEngaj(n)) return "pessoas que interagiram com o perfil";
  return "público personalizado da empresa";
}

/**
 * Nome de público da Meta → rótulo amigável, SEM id nem nome de arquivo. Ex.: "SM_base_completa.csv" → "lista de clientes da barbearia";
 * "Lookalike (BR, 1%) - SM_base_completa.csv" → "semelhante 1% aos clientes". `dica` = nome do conjunto (ajuda quando o público não tem nome).
 */
export function rotuloPublico(nome: string | null | undefined, negocio: string | null, dica?: string | null): string {
  const n = normalizarNome(nome ?? "");
  const d = normalizarNome(dica ?? "");
  const semelhante = /lookalike|semelhante|similar|\blal\b|parecid/;
  if (semelhante.test(n) || (!n && semelhante.test(d))) {
    const pct = (nome ?? "").match(/(\d+(?:[.,]\d+)?)\s*%/) ?? (dica ?? "").match(/(\d+(?:[.,]\d+)?)\s*%/);
    const fonte = n.includes(" - ") ? n.slice(n.indexOf(" - ") + 3) : n.replace(semelhante, "");
    const alvo = ehLista(fonte) || (!fonte.trim() && ehLista(d)) || !fonte.trim() ? "aos clientes"
      : ehVideo(fonte) ? "a quem assistiu aos vídeos" : ehSite(fonte) ? "aos visitantes do site" : ehInstagram(fonte) || ehEngaj(fonte) ? "a quem interagiu com o perfil" : "a um público da empresa";
    return `semelhante ${pct ? `${pct[1].replace(".", ",")}% ` : ""}${alvo}`;
  }
  if (!n) return "público personalizado da empresa";
  return rotuloFonte(n, negocio);
}

const PAISES = (() => { try { return new Intl.DisplayNames(["pt-BR"], { type: "region" }); } catch { return null; } })();
const nomePais = (c: string) => { try { return PAISES?.of(c.toUpperCase()) ?? c; } catch { return c; } };
const coord = (v: unknown) => { const x = num(v); return x != null && Math.abs(x) <= 180 ? x : null; };
/** "3 km", "1,5 km" (milhas viram km). */
function distancia(raio: unknown, unidade: unknown): string | null {
  const r = num(raio);
  if (r == null || r <= 0) return null;
  const km = String(unidade ?? "kilometer").toLowerCase().startsWith("mi") ? r * 1.609 : r;
  return `${km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}
export const linkMapa = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lng.toFixed(5)}`;
/** Nome legível de um ponto: nome/endereço quando houver e não for só coordenada. */
function nomePonto(l: Record<string, any>): string | null {
  for (const k of ["name", "address_string", "primary_city_name"]) {
    const v = txt(l[k]);
    if (v && !/^\(?\s*-?\d+[.,]\d+\s*,\s*-?\d+[.,]\d+\s*\)?$/.test(v)) return limparNome(v) || null;
  }
  return null;
}

/** Nome do lugar escrito no nome do conjunto/campanha junto do mesmo raio (ex.: "… | Floresta 3km" → "Floresta"). */
export function lugarDoNome(textos: Array<string | null | undefined>, raio: unknown): string | null {
  const r = num(raio);
  if (r == null) return null;
  for (const t of textos) for (const parte of String(t ?? "").split(/[|·]/)) {
    const m = parte.trim().match(/^(.*?)\s*\+?\s*(\d+(?:[.,]\d+)?)\s*km$/i);
    if (m && Number(m[2].replace(",", ".")) === r) { const nome = limparNome(m[1]).replace(/[-–]\s*$/, "").trim(); if (nome && /\p{L}/u.test(nome)) return nome; }
  }
  return null;
}

function locais(g: Record<string, any> | null | undefined, dicas: Array<string | null | undefined> = []): LocalAlvo[] {
  if (!g || typeof g !== "object") return [];
  const out: LocalAlvo[] = [];
  for (const l of Array.isArray(g.custom_locations) ? g.custom_locations : []) {
    if (!l || typeof l !== "object") continue;
    const dist = distancia(l.radius, l.distance_unit);
    const lat = coord(l.latitude), lng = coord(l.longitude);
    const nome = nomePonto(l) ?? lugarDoNome(dicas, l.radius) ?? "ponto definido";
    out.push({ tipo: "raio", texto: dist ? `${dist} ao redor de ${nome}` : `Ao redor de ${nome}`, mapa: lat != null && lng != null ? linkMapa(lat, lng) : null });
  }
  for (const c of Array.isArray(g.cities) ? g.cities : []) {
    const nome = txt(c?.name); if (!nome) continue;
    const dist = distancia(c.radius, c.distance_unit);
    out.push({ tipo: "cidade", texto: `${nome}${txt(c.region) ? ` (${c.region})` : ""}${dist ? ` e até ${dist} ao redor` : ""}`, mapa: null });
  }
  for (const r of Array.isArray(g.regions) ? g.regions : []) { const nome = txt(r?.name); if (nome) out.push({ tipo: "regiao", texto: nome, mapa: null }); }
  for (const z of Array.isArray(g.zips) ? g.zips : []) {
    const nome = txt(z?.name) ?? txt(z?.key)?.replace(/^[A-Z]{2}:/, "") ?? null;
    if (nome) out.push({ tipo: "cep", texto: `CEP ${nome}`, mapa: null });
  }
  for (const k of ["neighborhoods", "places", "geo_markets", "subcities", "medium_geo_areas", "large_geo_areas", "metro_areas"]) {
    for (const x of Array.isArray(g[k]) ? g[k] : []) { const nome = txt(x?.name); if (nome) out.push({ tipo: "outro", texto: limparNome(nome), mapa: null }); }
  }
  for (const p of Array.isArray(g.countries) ? g.countries : []) { const c = txt(p); if (c) out.push({ tipo: "pais", texto: nomePais(c), mapa: null }); }
  return out;
}

const NOMES_DETALHE = ["interests", "behaviors", "life_events", "family_statuses", "industries", "income", "work_positions", "work_employers", "education_schools", "education_majors", "education_statuses", "relationship_statuses", "user_adclusters"];
function nomesDetalhados(o: unknown): string[] {
  const out: string[] = [];
  const add = (x: Record<string, any>) => { for (const k of NOMES_DETALHE) for (const i of Array.isArray(x[k]) ? x[k] : []) { const n = txt(i?.name); if (n) out.push(n); } };
  if (Array.isArray(o)) for (const x of o) { if (x && typeof x === "object") add(x); }
  else if (o && typeof o === "object") add(o as Record<string, any>);
  return out;
}

const POS_FB: Record<string, string> = { feed: "Feed", story: "Stories", facebook_reels: "Reels", marketplace: "Marketplace", video_feeds: "Vídeos", right_hand_column: "Coluna da direita", search: "Busca", instream_video: "Vídeos in-stream", profile_feed: "Feed do perfil", notification: "Notificações", facebook_reels_overlay: "Reels (sobreposição)" };
const POS_IG: Record<string, string> = { stream: "Feed", story: "Stories", explore: "Explorar", explore_home: "Explorar (início)", reels: "Reels", profile_feed: "Feed do perfil", ig_search: "Busca", profile_reels: "Reels do perfil" };
const PLATAFORMA: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network", threads: "Threads" };
const capital = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function posicionamentos(t: Record<string, any>): string | null {
  const plats: string[] = Array.isArray(t.publisher_platforms) ? t.publisher_platforms.map(String) : [];
  if (!plats.length) return null;
  return plats.map((p) => {
    const pos: string[] = Array.isArray(t[`${p}_positions`]) ? t[`${p}_positions`].map(String) : [];
    const mapa = p === "facebook" ? POS_FB : p === "instagram" ? POS_IG : {};
    return `${PLATAFORMA[p] ?? capital(p)}${pos.length ? `: ${pos.map((x) => mapa[x] ?? capital(x)).join(", ")}` : ""}`;
  }).join(" · ");
}

/** Lê a segmentação de um conjunto em linguagem simples (para o cliente) e o resumo técnico (só administrador). */
export function interpretarTargeting(bruto: unknown, ctx: { conjunto: string; campanha?: string | null; negocio?: string | null; status?: string | null }): { publico: PublicoConfigurado; tecnico: TargetingTecnico } {
  const t = lerTargeting(bruto);
  const conjunto = limparNome(ctx.conjunto) || "Conjunto de anúncios";
  const campanha = ctx.campanha ? limparNome(ctx.campanha) || null : null;
  const ativo = ctx.status ? ctx.status === "ACTIVE" : null;
  const json = typeof bruto === "string" ? bruto : JSON.stringify(bruto ?? null, null, 2);
  const vazio: PublicoConfigurado = { conjunto, campanha, ativo, legivel: false, idade: null, genero: "Homens e mulheres", locais: [], locaisExcluidos: [], publicos: [], publicosExcluidos: [], interesses: [], interessesExcluidos: [], posicionamentos: null, notas: [] };
  if (!t) return { publico: vazio, tecnico: { conjunto: ctx.conjunto, campanha: ctx.campanha ?? null, json: json.slice(0, 20_000), naoInterpretados: ["(formato não reconhecido)"] } };
  const negocio = ctx.negocio ?? null;
  const ageRange = Array.isArray(t.age_range) ? t.age_range.map(num) : [];
  const min = num(t.age_min) ?? ageRange[0] ?? null, max = num(t.age_max) ?? ageRange[1] ?? null;
  const idade = min == null && max == null ? null : max == null || max >= 65 ? `${min ?? 18} anos ou mais` : `${min ?? 18} a ${max} anos`;
  const gen: number[] = Array.isArray(t.genders) ? t.genders.map(Number) : [];
  const genero = gen.length === 1 && gen[0] === 1 ? "Homens" : gen.length === 1 && gen[0] === 2 ? "Mulheres" : "Homens e mulheres";
  const publicosDe = (lista: unknown) => [...new Set((Array.isArray(lista) ? lista : []).map((a: any) => rotuloPublico(txt(a?.name), negocio, ctx.conjunto)))];
  const notas: string[] = [];
  const auto = t.targeting_automation;
  if (auto && typeof auto === "object" && Number((auto as any).advantage_audience) === 1) notas.push("A Meta pode ampliar o público além destas regras quando encontra pessoas com mais chance de conversar (Público Advantage+).");
  const relax = t.targeting_relaxation_types;
  if (relax && typeof relax === "object" && (Number((relax as any).lookalike) === 1 || Number((relax as any).custom_audience) === 1)) notas.push("A Meta pode expandir os públicos escolhidos para alcançar mais pessoas parecidas.");
  const devices: string[] = Array.isArray(t.device_platforms) ? t.device_platforms.map(String) : [];
  if (devices.length === 1) notas.push(devices[0] === "mobile" ? "Só no celular." : "Só no computador.");
  const publico: PublicoConfigurado = {
    ...vazio, legivel: true, idade, genero,
    locais: locais(t.geo_locations, [ctx.conjunto, ctx.campanha]),
    locaisExcluidos: locais(t.excluded_geo_locations).map((l) => l.texto),
    publicos: publicosDe(t.custom_audiences),
    publicosExcluidos: publicosDe(t.excluded_custom_audiences),
    interesses: [...new Set([...nomesDetalhados(t.flexible_spec), ...nomesDetalhados(t)])].slice(0, 30),
    interessesExcluidos: [...new Set(nomesDetalhados(t.exclusions))].slice(0, 30),
    posicionamentos: posicionamentos(t),
    notas,
  };
  const naoInterpretados = Object.keys(t).filter((k) => !CHAVES_CONHECIDAS.has(k));
  return { publico, tecnico: { conjunto: ctx.conjunto, campanha: ctx.campanha ?? null, json: JSON.stringify(t, null, 2).slice(0, 20_000), naoInterpretados } };
}

/**
 * Público de um conjunto em uma linha, para os cartões de anúncio (ex.: "Homens 18–45 · 3 km de Floresta", "Sua lista de clientes",
 * "Semelhante 1% aos clientes · Homens 20–50"). Linguagem simples, sem ids.
 */
export function resumoPublico(p: PublicoConfigurado): string | null {
  if (!p.legivel) return null;
  const partes: string[] = [];
  const principal = p.publicos[0];
  if (principal) partes.push(/^lista de clientes/.test(principal) ? "Sua lista de clientes" : principal.replace(/^\w/, (c) => c.toUpperCase()));
  const gen = p.genero === "Homens e mulheres" ? "" : p.genero;
  const idade = p.idade ? p.idade.replace(/^(\d+) a (\d+) anos$/, "$1–$2").replace(/^(\d+) anos ou mais$/, "$1+") : "";
  const demo = gen ? `${gen} ${idade}`.trim() : idade && idade !== "18+" ? `${idade} anos` : "";
  if (demo) partes.push(demo);
  const l = p.locais[0];
  if (l && !principal) partes.push(l.tipo === "raio" ? l.texto.replace(" ao redor de ", " de ").replace(" de ponto definido", " do ponto escolhido") : l.texto);
  return partes.join(" · ") || "Público aberto";
}

/** Resumo do público por conjunto: chave = id do conjunto e também "nome:<nome normalizado>" (para fontes que só trazem o nome). Só servidor. */
export function resumosDosConjuntos(rows: LinhaSnap[], negocio: string | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of ultimasSegmentacoes(rows)) {
    const nome = String(r.metrics.adset_name ?? "");
    const p = interpretarTargeting(r.metrics.targeting, { conjunto: nome, campanha: r.metrics.campaign_name ?? null, negocio }).publico;
    const res = resumoPublico(p);
    if (!res) continue;
    if (!r.key.startsWith("nome:")) m.set(r.key, res);
    if (nome) m.set(`nome:${normalizarNome(nome)}`, res);
  }
  return m;
}

// ─── Cortes (ads_breakdown) ──────────────────────────────────────────────────

export interface Metrica {
  gasto: number; impressoes: number; alcance: number | null; cliques: number | null;
  /** null = indisponível neste corte. */
  conversas: number | null; custoPorConversa: number | null;
  /** % do gasto do corte. */
  participacao: number;
}
type Acc = { gasto: number; impressoes: number; alcance: number | null; cliques: number | null; conversas: number | null };
const novoAcc = (): Acc => ({ gasto: 0, impressoes: 0, alcance: null, cliques: null, conversas: null });
function somarEm(a: Acc, m: Record<string, any>) {
  a.gasto += num(m.spend) ?? 0; a.impressoes += num(m.impressions) ?? 0;
  const r = num(m.reach), c = num(m.clicks), x = num(m.results);
  if (r != null) a.alcance = (a.alcance ?? 0) + r;
  if (c != null) a.cliques = (a.cliques ?? 0) + c;
  if (x != null) a.conversas = (a.conversas ?? 0) + x;
}
function fechar(a: Acc, total: number, conversasOk: boolean): Metrica {
  const conversas = conversasOk ? a.conversas ?? 0 : null;
  return {
    gasto: arred(a.gasto), impressoes: a.impressoes, alcance: a.alcance, cliques: a.cliques, conversas,
    custoPorConversa: conversas != null && conversas > 0 ? arred(a.gasto / conversas) : null,
    participacao: total > 0 ? arred((a.gasto / total) * 100, 1) : 0,
  };
}

export type Genero = "homens" | "mulheres" | "outros";
export const generoDe = (g: unknown): Genero => { const s = String(g ?? "").toLowerCase(); return s === "male" || s === "1" ? "homens" : s === "female" || s === "2" ? "mulheres" : "outros"; };
export const ROTULO_GENERO: Record<Genero, string> = { homens: "Homens", mulheres: "Mulheres", outros: "Não informado" };
const faixaRotulo = (f: string) => (f === "65+" ? "65 ou mais" : f.replace("-", " a "));

export interface SegmentoPublico extends Metrica { faixa: string; genero: Genero; rotulo: string }
export interface FaixaIdade { faixa: string; rotulo: string; homens: Metrica | null; mulheres: Metrica | null; outros: Metrica | null }
export interface RelIdadeGenero {
  faixas: FaixaIdade[]; segmentos: SegmentoPublico[]; porGenero: Array<{ genero: Genero; rotulo: string } & Metrica>;
  conversasDisponiveis: boolean; melhor: SegmentoPublico | null; maisCaro: SegmentoPublico | null; totalGasto: number;
}
export interface ItemRegiao extends Metrica { regiao: string }
export interface RelRegioes { itens: ItemRegiao[]; conversasDisponiveis: boolean }
export type GrupoPosicao = "Feed" | "Reels" | "Stories" | "Explorar" | "Outros";
export interface ItemPosicao extends Metrica { plataforma: string; posicao: string; grupo: GrupoPosicao }
export interface RelPosicionamento {
  grupos: Array<{ grupo: GrupoPosicao; total: Metrica; porPlataforma: Record<string, number> }>;
  plataformas: Array<{ plataforma: string } & Metrica>;
  itens: ItemPosicao[];
  conversasDisponiveis: boolean;
}

const POSICAO: Record<string, [GrupoPosicao, string]> = {
  feed: ["Feed", "Feed"], stream: ["Feed", "Feed"], profile_feed: ["Feed", "Feed do perfil"], instagram_profile_feed: ["Feed", "Feed do perfil"],
  facebook_reels: ["Reels", "Reels"], instagram_reels: ["Reels", "Reels"], reels: ["Reels", "Reels"], facebook_reels_overlay: ["Reels", "Anúncios sobre Reels"], instagram_profile_reels: ["Reels", "Reels do perfil"],
  facebook_stories: ["Stories", "Stories"], instagram_stories: ["Stories", "Stories"], story: ["Stories", "Stories"], messenger_stories: ["Stories", "Stories"],
  instagram_explore: ["Explorar", "Explorar"], instagram_explore_grid_home: ["Explorar", "Explorar (início)"], explore: ["Explorar", "Explorar"], explore_home: ["Explorar", "Explorar (início)"],
  marketplace: ["Outros", "Marketplace"], video_feeds: ["Outros", "Vídeos"], instream_video: ["Outros", "Vídeos in-stream"], search: ["Outros", "Busca"], instagram_search: ["Outros", "Busca"],
  right_hand_column: ["Outros", "Coluna da direita"], an_classic: ["Outros", "Apps e sites parceiros"], rewarded_video: ["Outros", "Vídeos com recompensa"], messenger_inbox: ["Outros", "Caixa de entrada"],
};
export const posicaoDe = (p: unknown): [GrupoPosicao, string] => POSICAO[String(p ?? "").toLowerCase()] ?? ["Outros", capital(String(p ?? "outro"))];
export const plataformaDe = (p: unknown) => PLATAFORMA[String(p ?? "").toLowerCase()] ?? capital(String(p ?? "outra"));

const doCorte = (rows: LinhaSnap[], d: DimensaoQuebra) => rows.filter((r) => r.kind === "ads_breakdown" && r.metrics.dimensao === d);
const temConversa = (rows: LinhaSnap[]) => rows.some((r) => num(r.metrics.results) != null);

/** Gasto mínimo de um público para entrar nos destaques: R$ 10 ou 5% do gasto do corte (pouco dado não vira destaque). */
export const minimoDestaque = (total: number) => Math.max(10, total * 0.05);

export function relIdadeGenero(rows: LinhaSnap[]): RelIdadeGenero | null {
  const linhas = doCorte(rows, "idade_genero");
  if (!linhas.length) return null;
  const ok = temConversa(linhas);
  const seg = new Map<string, Acc>(), gen = new Map<Genero, Acc>();
  let total = 0;
  for (const r of linhas) {
    const f = txt(r.metrics.idade) ?? "Não informada", g = generoDe(r.metrics.genero);
    const k = `${f}|${g}`;
    if (!seg.has(k)) seg.set(k, novoAcc());
    if (!gen.has(g)) gen.set(g, novoAcc());
    somarEm(seg.get(k)!, r.metrics); somarEm(gen.get(g)!, r.metrics);
    total += num(r.metrics.spend) ?? 0;
  }
  const segmentos: SegmentoPublico[] = [...seg.entries()].map(([k, a]) => {
    const [faixa, g] = k.split("|") as [string, Genero];
    return { faixa, genero: g, rotulo: `${ROTULO_GENERO[g]} de ${faixaRotulo(faixa)}${/\d/.test(faixa) ? " anos" : ""}`, ...fechar(a, total, ok) };
  }).sort((a, b) => b.gasto - a.gasto);
  const faixasOrdem = [...new Set(segmentos.map((s) => s.faixa))].sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));
  const faixas: FaixaIdade[] = faixasOrdem.map((f) => {
    const pega = (g: Genero) => segmentos.find((s) => s.faixa === f && s.genero === g) ?? null;
    return { faixa: f, rotulo: faixaRotulo(f), homens: pega("homens"), mulheres: pega("mulheres"), outros: pega("outros") };
  });
  const porGenero = (["homens", "mulheres", "outros"] as Genero[]).filter((g) => gen.has(g)).map((g) => ({ genero: g, rotulo: ROTULO_GENERO[g], ...fechar(gen.get(g)!, total, ok) }));
  let melhor: SegmentoPublico | null = null, maisCaro: SegmentoPublico | null = null;
  if (ok) {
    const elegiveis = segmentos.filter((s) => s.gasto >= minimoDestaque(total));
    if (elegiveis.length >= 2) {
      const comConversa = elegiveis.filter((s) => s.custoPorConversa != null).sort((a, b) => a.custoPorConversa! - b.custoPorConversa!);
      melhor = comConversa[0] ?? null;
      const semConversa = elegiveis.filter((s) => (s.conversas ?? 0) === 0).sort((a, b) => b.gasto - a.gasto)[0];
      maisCaro = semConversa ?? comConversa[comConversa.length - 1] ?? null;
      if (maisCaro === melhor) maisCaro = null;
    }
  }
  return { faixas, segmentos, porGenero, conversasDisponiveis: ok, melhor, maisCaro, totalGasto: arred(total) };
}

/**
 * Regiões. Conversas: só valem se a fonte as trouxe neste corte (algum valor não nulo) e se não contradizem o total da campanha
 * (conversas > 0 na campanha e soma 0 por região = indisponível, não zero — foi o que o Windsor devolveu com `region`).
 */
export function relRegioes(rows: LinhaSnap[], conversasCampanha?: number | null): RelRegioes | null {
  const linhas = doCorte(rows, "regiao");
  if (!linhas.length) return null;
  const acc = new Map<string, Acc>();
  let total = 0;
  for (const r of linhas) { const k = txt(r.metrics.regiao) ?? "Não informada"; if (!acc.has(k)) acc.set(k, novoAcc()); somarEm(acc.get(k)!, r.metrics); total += num(r.metrics.spend) ?? 0; }
  const soma = linhas.reduce((t, r) => t + (num(r.metrics.results) ?? 0), 0);
  const ok = temConversa(linhas) && !(soma === 0 && (conversasCampanha ?? 0) > 0);
  const itens = [...acc.entries()].map(([regiao, a]) => ({ regiao, ...fechar(a, total, ok) })).sort((a, b) => b.gasto - a.gasto);
  return { itens, conversasDisponiveis: ok };
}

export function relPosicionamento(rows: LinhaSnap[]): RelPosicionamento | null {
  const linhas = doCorte(rows, "posicionamento");
  if (!linhas.length) return null;
  const ok = temConversa(linhas);
  let total = 0;
  const item = new Map<string, Acc>(), grupo = new Map<GrupoPosicao, { acc: Acc; por: Record<string, number> }>(), plat = new Map<string, Acc>();
  for (const r of linhas) {
    const p = plataformaDe(r.metrics.plataforma), [g, rot] = posicaoDe(r.metrics.posicao);
    const k = `${p}|${rot}|${g}`;
    if (!item.has(k)) item.set(k, novoAcc());
    if (!grupo.has(g)) grupo.set(g, { acc: novoAcc(), por: {} });
    if (!plat.has(p)) plat.set(p, novoAcc());
    somarEm(item.get(k)!, r.metrics); somarEm(grupo.get(g)!.acc, r.metrics); somarEm(plat.get(p)!, r.metrics);
    const gs = num(r.metrics.spend) ?? 0;
    grupo.get(g)!.por[p] = arred((grupo.get(g)!.por[p] ?? 0) + gs);
    total += gs;
  }
  const ordem: GrupoPosicao[] = ["Feed", "Reels", "Stories", "Explorar", "Outros"];
  return {
    grupos: ordem.filter((g) => grupo.has(g)).map((g) => ({ grupo: g, total: fechar(grupo.get(g)!.acc, total, ok), porPlataforma: grupo.get(g)!.por })),
    plataformas: [...plat.entries()].map(([plataforma, a]) => ({ plataforma, ...fechar(a, total, ok) })).sort((a, b) => b.gasto - a.gasto),
    itens: [...item.entries()].map(([k, a]) => { const [plataforma, posicao, g] = k.split("|"); return { plataforma, posicao, grupo: g as GrupoPosicao, ...fechar(a, total, ok) }; }).sort((a, b) => b.gasto - a.gasto),
    conversasDisponiveis: ok,
  };
}

/** Último estado de cada conjunto (maior data por chave). */
export function ultimasSegmentacoes(rows: LinhaSnap[]): LinhaSnap[] {
  const m = new Map<string, LinhaSnap>();
  for (const r of rows) if (r.kind === "adset_targeting") { const a = m.get(r.key); if (!a || r.date >= a.date) m.set(r.key, r); }
  return [...m.values()].sort((a, b) => String(a.metrics.campaign_name ?? "").localeCompare(String(b.metrics.campaign_name ?? "")) || String(a.metrics.adset_name ?? "").localeCompare(String(b.metrics.adset_name ?? "")));
}

export interface RelPublico {
  temDados: boolean;
  idadeGenero: RelIdadeGenero | null;
  regioes: RelRegioes | null;
  /** Raios/locais configurados nos conjuntos (únicos). */
  locaisConfigurados: LocalAlvo[];
  posicionamento: RelPosicionamento | null;
  conjuntos: PublicoConfigurado[];
  /** SÓ administrador (o carregador do cliente nunca preenche). */
  tecnico?: TargetingTecnico[];
}

/** Relatório completo a partir das linhas JÁ filtradas por campanha e por período (cortes) e do último estado dos conjuntos. */
export function relPublico(rows: LinhaSnap[], o: { negocio?: string | null; tecnico?: boolean; conversasCampanha?: number | null } = {}): RelPublico {
  const idadeGenero = relIdadeGenero(rows), regioes = relRegioes(rows, o.conversasCampanha), posicionamento = relPosicionamento(rows);
  const segs = ultimasSegmentacoes(rows).map((r) => interpretarTargeting(r.metrics.targeting, { conjunto: String(r.metrics.adset_name ?? "Conjunto"), campanha: r.metrics.campaign_name ?? null, negocio: o.negocio ?? null, status: r.metrics.status ?? null }));
  const vistos = new Set<string>();
  const locaisConfigurados = segs.flatMap((s) => s.publico.locais).filter((l) => { const k = `${l.texto}|${l.mapa ?? ""}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  const r: RelPublico = { temDados: Boolean(idadeGenero || regioes || posicionamento || segs.length), idadeGenero, regioes, locaisConfigurados, posicionamento, conjuntos: segs.map((s) => s.publico) };
  if (o.tecnico) r.tecnico = segs.map((s) => s.tecnico);
  return r;
}

/**
 * Carrega a seção para UM cliente: cortes do período atual e último estado dos conjuntos (últimos 120 dias), da fonte de anúncios
 * do canal, só das campanhas do filtro do canal. Quem chama garante o isolamento (cliente: escopo da sessão; admin: página do cliente).
 */
export async function carregarPublico(canal: CanalRow, periodo: PeriodoResolvido, hoje: string, o: { negocio?: string | null; tecnico?: boolean } = {}): Promise<RelPublico | null> {
  if (!((canal.adsSource === "meta" || canal.adsSource === "windsor") && canal.adAccountId && canal.lastSyncAt)) return null;
  const fonte = canal.adsSource as OrigemDado;
  const { de, ate } = periodo.atual;
  const [camp, cortes, segs] = await Promise.all([
    lerSnapshots(canal.clientId, ["campaign_daily"], addDays(hoje, -120) < de ? addDays(hoje, -120) : de, hoje, fonte),
    lerSnapshots(canal.clientId, ["ads_breakdown"], de, ate, fonte),
    lerSnapshots(canal.clientId, ["adset_targeting"], addDays(hoje, -120), hoje, fonte),
  ]);
  const filtro = { campaignIds: canal.campaignIds, campaignNameFilter: canal.campaignNameFilter };
  const todas = filtrarLinhasCampanhas([...camp, ...cortes, ...segs], filtro) as LinhaSnap[];
  const conversasCampanha = todas.filter((r) => r.kind === "campaign_daily" && r.date >= de && r.date <= ate).reduce((t, r) => t + (num(r.metrics.results) ?? 0), 0);
  return relPublico(todas.filter((r) => r.kind !== "campaign_daily"), { negocio: o.negocio, tecnico: o.tecnico, conversasCampanha });
}
