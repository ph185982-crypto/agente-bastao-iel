// Provider do Windsor.ai (somente leitura) para o GOOGLE · Perfil da Empresa do cliente (conector google_my_business). Terceira fonte,
// independente dos anúncios e do Instagram, com a MESMA chave do Instagram (conta Windsor onde o Perfil da Empresa está conectado).
//
//   GET https://connectors.windsor.ai/google_my_business?date_from=…&date_to=…&fields=a,b,c&api_key=<chave>   →   { "data": [ {…}, … ] }
//
// Uma consulta POR GRUPO de campos (diário, avaliações, totais de avaliação, palavras-chave, dados do local), sempre com datas explícitas:
// misturar grupos gera linhas cruzadas. Particularidades reais do conector:
//   • review_star_rating vem como palavra (ONE…FIVE); review_comment / review_reply_comment vêm como o TEXTO "None" quando vazios;
//   • search_keyword_value = 0 quer dizer valor OCULTO pelo Google (poucas buscas), nunca zero;
//   • só devolve as avaliações escritas no período pedido (por isso cada avaliação é guardada por id e o histórico acumula).
// Sem filtro de local, várias contas/locais na resposta = erro claro (nunca mistura). A chave só vai na querystring e nunca sai em erro.
import { fetchJson } from "@/lib/http";
import { addDays, spDate } from "@/lib/dates";
import { WINDSOR_HOST, WindsorErro, criarConsulta, esconderChave, traduzir, type Linha, type OpcoesWindsor } from "./windsor";
import type { MetricasGbpAvaliacao, MetricasGbpDia, MetricasGbpLocal } from "./types";

export const CONECTOR_GBP = "google_my_business";

export const GBP_CAMPOS_DIA = ["date", "account_name", "location_title", "impressions_mobile_maps", "impressions_mobile_search", "impressions_desktop_maps", "impressions_desktop_search", "call_clicks", "direction_requests", "website_clicks", "conversations", "business_bookings"] as const;
export const GBP_CAMPOS_AVALIACAO = ["account_name", "location_title", "review_id", "review_star_rating", "review_create_time", "review_reviewer", "review_comment", "review_reply_comment"] as const;
export const GBP_CAMPOS_TOTAIS = ["account_name", "location_title", "review_average_rating_total", "review_total_count"] as const;
export const GBP_CAMPOS_PALAVRAS = ["account_name", "location_title", "search_keyword", "search_keyword_value"] as const;
export const GBP_CAMPOS_LOCAL = ["account_name", "location_title", "location_metadata_maps_uri", "location_metadata_new_review_uri"] as const;
/** Campos opcionais do local (categoria, bairro, cidade): só pedidos se a lista de campos do conector disser que existem. */
const EXTRAS_LOCAL = {
  category: ["location_categories_primary_category_display_name", "location_primary_category_display_name", "location_primary_category", "location_category"],
  neighborhood: ["location_storefront_address_sublocality", "location_address_sublocality", "location_sublocality"],
  city: ["location_storefront_address_locality", "location_address_locality", "location_locality"],
} as const;

const DIA_CAMPOS: Record<string, keyof MetricasGbpDia> = {
  impressions_mobile_maps: "maps_mobile", impressions_desktop_maps: "maps_desktop", impressions_mobile_search: "search_mobile", impressions_desktop_search: "search_desktop",
  call_clicks: "calls", direction_requests: "directions", website_clicks: "website", conversations: "conversations", business_bookings: "bookings",
};
const ESTRELAS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "none") { const x = Number(v); return Number.isFinite(x) ? x : null; }
  return null;
};
const dia = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** Texto do conector: "None", "null" e vazio = sem texto. */
export function textoGbp(v: unknown, max = 4000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(none|null|undefined)$/i.test(t)) return null;
  return t.slice(0, max);
}
/** ONE…FIVE (ou "5", "4.0") → 1…5; STAR_RATING_UNSPECIFIED/outro = null. */
export function estrelasGbp(v: unknown): number | null {
  if (typeof v === "string" && ESTRELAS[v.trim().toUpperCase()]) return ESTRELAS[v.trim().toUpperCase()];
  const n = num(v);
  return n != null && n >= 1 && n <= 5 ? Math.round(n) : null;
}
/** Nome do local normalizado para comparar (sem caixa, acento nem espaços repetidos). */
export const normLocal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
/** Dia (fuso de São Paulo) de um carimbo ISO do Google. */
export function diaDoCarimbo(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim());
  if (!Number.isNaN(d.getTime())) return spDate(d);
  return dia(v);
}

export interface DiaGbp { date: string; metrics: MetricasGbpDia }
export interface AvaliacaoGbp { id: string; date: string; metrics: MetricasGbpAvaliacao }
export interface PalavraGbp { palavra: string; valor: number | null }
export interface LocalGbp extends MetricasGbpLocal { locais: string[] }
export interface ResultadoTesteGoogle {
  ok: boolean;
  origemChave: "canal" | "plataforma" | "nenhuma";
  verificacoes: Array<{ id: string; rotulo: string; ok: boolean | null; detalhe: string }>;
  info: { locais: string[]; local: string | null; dias: number; visualizacoes: number | null; avaliacoes: number; nota: number | null; totalAvaliacoes: number | null; palavras: number };
}

/** O que o coletor e o teste precisam do Google. Implementações: real (criarWindsorGbp) e simulada (fixture-gbp.ts e testes). */
export interface FonteGoogleApi {
  local(hoje?: string): Promise<LocalGbp>;
  diario(de: string, ate: string): Promise<DiaGbp[]>;
  avaliacoes(de: string, ate: string): Promise<AvaliacaoGbp[]>;
  /** Buscas do mês que começa em `mes` (YYYY-MM-01) até `ate`. */
  palavras(mes: string, ate: string): Promise<PalavraGbp[]>;
  testar(hoje?: string): Promise<ResultadoTesteGoogle>;
}

export interface OpcoesGbp extends OpcoesWindsor {
  /** Nome do local no Windsor (location_title ou account_name). Obrigatório quando a chave enxerga mais de um local. */
  local?: string | null;
}

const fimDoMes = (mes: string) => { const [y, m] = mes.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export function criarWindsorGbp(o: OpcoesGbp): FonteGoogleApi {
  const consultarBase = criarConsulta(o, CONECTOR_GBP);
  const consultar: typeof consultarBase = async (c, i) => { try { return await consultarBase(c, i); } catch (e) { throw traduzirGbp(e, o.chave); } };
  const alvo = o.local?.trim() ? normLocal(o.local) : null;

  /** Nome do local de uma linha: location_title (preferido) ou account_name. */
  const nomeDe = (l: Linha) => {
    for (const k of ["location_title", "account_name"]) { const v = l[k]; if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "none") return v.trim(); }
    return null;
  };
  /** Filtra pelo local configurado; sem filtro e com vários locais, recusa em vez de misturar. Casa por location_title OU account_name. */
  function porLocal(linhas: Linha[]): { linhas: Linha[]; locais: string[] } {
    const locais = [...new Set(linhas.map(nomeDe).filter((n): n is string => Boolean(n)))].sort();
    if (alvo) {
      const casa = (l: Linha) => ["location_title", "account_name"].some((k) => typeof l[k] === "string" && normLocal(l[k] as string) === alvo);
      const filtradas = linhas.filter(casa);
      if (!filtradas.length && locais.length) throw new WindsorErro(`Nenhum local com o nome “${o.local!.trim()}” no Windsor.ai (Perfil da Empresa). Locais encontrados: ${locais.join(", ")}.`, "conta");
      return { linhas: filtradas, locais };
    }
    if (locais.length > 1) throw new WindsorErro(`O Windsor.ai devolveu ${locais.length} locais do Perfil da Empresa (${locais.join(", ")}). Informe o nome do local para escolher qual usar.`, "varias_contas");
    return { linhas, locais };
  }

  async function diario(de: string, ate: string): Promise<DiaGbp[]> {
    const { linhas } = porLocal(await consultar(GBP_CAMPOS_DIA, { de, ate }));
    const porDia = new Map<string, MetricasGbpDia>();
    for (const l of linhas) {
      const d = dia(l.date);
      if (!d) continue;
      const m = porDia.get(d) ?? {};
      for (const [campo, alvoCampo] of Object.entries(DIA_CAMPOS)) {
        const v = num(l[campo]);
        if (v != null) m[alvoCampo] = (m[alvoCampo] ?? 0) + v; // várias linhas do mesmo dia (raro): soma por superfície
      }
      porDia.set(d, m);
    }
    return [...porDia.entries()].filter(([, m]) => Object.keys(m).length > 0).sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({ date, metrics }));
  }

  async function avaliacoes(de: string, ate: string): Promise<AvaliacaoGbp[]> {
    const { linhas } = porLocal(await consultar(GBP_CAMPOS_AVALIACAO, { de, ate }));
    const porId = new Map<string, AvaliacaoGbp>();
    for (const l of linhas) {
      const criada = typeof l.review_create_time === "string" ? l.review_create_time.trim() : null;
      const date = diaDoCarimbo(criada);
      const id = textoGbp(l.review_id, 300) ?? (criada ? `t:${criada}|${textoGbp(l.review_reviewer, 80) ?? "?"}` : null);
      if (!id || !date) continue;
      porId.set(id, {
        id, date,
        metrics: { stars: estrelasGbp(l.review_star_rating), reviewer: textoGbp(l.review_reviewer, 120), comment: textoGbp(l.review_comment), reply: textoGbp(l.review_reply_comment), created_at: criada },
      });
    }
    return [...porId.values()].sort((a, b) => (b.metrics.created_at ?? b.date).localeCompare(a.metrics.created_at ?? a.date));
  }

  async function palavras(mes: string, ate: string): Promise<PalavraGbp[]> {
    const fim = fimDoMes(mes) < ate ? fimDoMes(mes) : ate;
    const { linhas } = porLocal(await consultar(GBP_CAMPOS_PALAVRAS, { de: mes, ate: fim }));
    const acc = new Map<string, number | null>();
    for (const l of linhas) {
      const p = textoGbp(l.search_keyword, 120);
      if (!p) continue;
      const k = p.toLowerCase();
      const v = num(l.search_keyword_value);
      const valor = v != null && v > 0 ? v : null; // 0 = oculto pelo Google
      const atual = acc.get(k);
      acc.set(k, atual == null ? valor : valor == null ? atual : Math.max(atual, valor)); // não soma a mesma palavra duas vezes
    }
    return [...acc.entries()].map(([palavra, valor]) => ({ palavra, valor }));
  }

  /** Lista de campos do conector (cache por instância); null = desconhecida (então não pede os opcionais). */
  let campos: Set<string> | null | undefined;
  async function listaDeCampos(): Promise<Set<string> | null> {
    if (campos !== undefined) return campos;
    try {
      const qs = new URLSearchParams({ api_key: o.chave });
      const corpo = await fetchJson<unknown>(`https://${WINDSOR_HOST}/${CONECTOR_GBP}/fields?${qs.toString()}`, { method: "GET", headers: { Accept: "application/json" } }, { retries: 1, baseDelayMs: o.baseDelayMs ?? 500, maxDelayMs: o.maxDelayMs ?? 8000, sleep: o.sleep, fetchImpl: o.fetchImpl });
      const itens: unknown[] = Array.isArray(corpo) ? corpo : corpo && typeof corpo === "object" ? (Array.isArray((corpo as any).data) ? (corpo as any).data : Object.keys(corpo as object)) : [];
      const nomes = itens.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as any).id ?? (x as any).name ?? (x as any).field : null)).filter((x): x is string => typeof x === "string");
      campos = nomes.length > 10 ? new Set(nomes) : null;
    } catch { campos = null; }
    return campos;
  }

  async function local(hoje: string = spDate()): Promise<LocalGbp> {
    const janela = { de: addDays(hoje, -29), ate: hoje };
    const base = porLocal(await consultar(GBP_CAMPOS_LOCAL, janela));
    const ultimo = <T,>(f: (l: Linha) => T | null): T | null => { for (let i = base.linhas.length - 1; i >= 0; i--) { const v = f(base.linhas[i]); if (v != null) return v; } return null; };
    const out: LocalGbp = {
      locais: base.locais,
      title: ultimo((l) => textoGbp(l.location_title, 200)) ?? ultimo((l) => textoGbp(l.account_name, 200)),
      maps_uri: ultimo((l) => textoGbp(l.location_metadata_maps_uri, 2000)),
      review_uri: ultimo((l) => textoGbp(l.location_metadata_new_review_uri, 2000)),
    };
    // Totais de avaliação: consulta própria (dimensão diferente). Falha aqui não derruba os dados do local.
    try {
      const t = porLocal(await consultar(GBP_CAMPOS_TOTAIS, janela)).linhas;
      for (const l of t) {
        const media = num(l.review_average_rating_total), total = num(l.review_total_count);
        if (media != null) out.rating_avg = Math.round(media * 100) / 100;
        if (total != null) out.rating_count = Math.max(out.rating_count ?? 0, total);
      }
    } catch (e) { if (e instanceof WindsorErro && ["chave", "sem_contas", "conta", "varias_contas"].includes(e.codigo)) throw e; }
    // Categoria, bairro e cidade: opcionais, só com nomes de campo que o conector confirma.
    const conhecidos = await listaDeCampos();
    if (conhecidos) {
      const escolhidos: Array<[string, string]> = [];
      for (const [k, opcoes] of Object.entries(EXTRAS_LOCAL)) { const c = (opcoes as readonly string[]).find((x) => conhecidos.has(x)); if (c) escolhidos.push([k, c]); }
      if (escolhidos.length) {
        try {
          const ls = porLocal(await consultar(["account_name", "location_title", ...escolhidos.map(([, c]) => c)], janela)).linhas;
          for (const [k, c] of escolhidos) { const v = ls.map((l) => textoGbp(l[c], 120)).filter(Boolean).pop(); if (v) (out as any)[k] = v; }
        } catch { /* extra: sem categoria/bairro, o resto vale */ }
      }
    }
    return out;
  }

  async function testar(hoje: string = spDate()): Promise<ResultadoTesteGoogle> {
    const v: ResultadoTesteGoogle["verificacoes"] = [];
    const info: ResultadoTesteGoogle["info"] = { locais: [], local: null, dias: 0, visualizacoes: null, avaliacoes: 0, nota: null, totalAvaliacoes: null, palavras: 0 };
    const add = (id: string, rotulo: string, ok: boolean | null, detalhe: string) => v.push({ id, rotulo, ok, detalhe: esconderChave(detalhe, o.chave) });
    const fim = (): ResultadoTesteGoogle => ({ ok: v.every((x) => x.ok !== false), origemChave: "nenhuma", verificacoes: v, info });
    const de = addDays(hoje, -29);
    let bruto: Linha[];
    try {
      bruto = await consultar(GBP_CAMPOS_LOCAL, { de, ate: hoje });
      add("chave", "Chave aceita pelo Windsor.ai", true, "O Windsor.ai respondeu à consulta do Perfil da Empresa (google_my_business).");
    } catch (e) {
      const w = traduzir(e, o.chave, CONECTOR_GBP);
      const semContas = w.codigo === "sem_contas";
      add(semContas ? "locais" : "chave", semContas ? "Perfil da Empresa no Windsor.ai" : "Chave aceita pelo Windsor.ai", false, semContas ? MSG_SEM_GBP : w.message);
      return fim();
    }
    const locais = [...new Set(bruto.map(nomeDe).filter((n): n is string => Boolean(n)))].sort();
    info.locais = locais;
    if (!locais.length) { add("locais", "Perfil da Empresa no Windsor.ai", false, bruto.length ? "As linhas não trazem o nome do local." : MSG_SEM_GBP); return fim(); }
    add("locais", "Perfil da Empresa no Windsor.ai", true, `${locais.length} local(is): ${locais.join(", ")}.`);
    if (alvo) {
      const achado = locais.find((n) => normLocal(n) === alvo) ?? (bruto.some((l) => typeof l.account_name === "string" && normLocal(l.account_name) === alvo) ? o.local!.trim() : undefined);
      add("local", "Nome do local", Boolean(achado), achado ? `“${o.local!.trim()}” encontrado.` : `“${o.local!.trim()}” não casa com nenhum local. Use um destes nomes: ${locais.join(", ")}.`);
      if (!achado) return fim();
      info.local = achado;
    } else if (locais.length > 1) {
      add("local", "Nome do local", false, `Há ${locais.length} locais nesta conta do Windsor.ai; informe o nome do local para não misturar dados.`);
      return fim();
    } else { info.local = locais[0]; add("local", "Nome do local", null, "Não informado; há um só local, então ele será usado."); }
    try {
      const dias = await diario(de, hoje);
      info.dias = dias.length;
      const vis = dias.reduce((t, d) => t + (d.metrics.maps_mobile ?? 0) + (d.metrics.maps_desktop ?? 0) + (d.metrics.search_mobile ?? 0) + (d.metrics.search_desktop ?? 0), 0);
      info.visualizacoes = dias.length ? vis : null;
      const rotas = dias.reduce((t, d) => t + (d.metrics.directions ?? 0), 0), lig = dias.reduce((t, d) => t + (d.metrics.calls ?? 0), 0);
      add("diario", "Visualizações e ações (últimos 30 dias)", dias.length > 0, dias.length ? `${dias.length} dia(s) · ${vis} visualizações · ${rotas} rotas · ${lig} ligações.` : "Nenhum dia com dados no período.");
    } catch (e) { add("diario", "Visualizações e ações (últimos 30 dias)", false, traduzir(e, o.chave, CONECTOR_GBP).message); }
    try {
      const av = await avaliacoes(de, hoje);
      info.avaliacoes = av.length;
      const l = await local(hoje);
      info.nota = l.rating_avg ?? null; info.totalAvaliacoes = l.rating_count ?? null;
      add("avaliacoes", "Avaliações", true, `${av.length} avaliação(ões) nos últimos 30 dias${l.rating_avg != null ? ` · nota ${l.rating_avg.toLocaleString("pt-BR")}` : ""}${l.rating_count != null ? ` de ${l.rating_count} avaliações` : ""}.`);
    } catch (e) { add("avaliacoes", "Avaliações", false, traduzir(e, o.chave, CONECTOR_GBP).message); }
    try {
      const p = await palavras(`${hoje.slice(0, 8)}01`, hoje);
      info.palavras = p.length;
      add("palavras", "Buscas que levaram ao perfil", p.length ? true : null, p.length ? `${p.length} termo(s) neste mês.` : "Nenhum termo de busca neste mês ainda (o Google libera com atraso).");
    } catch (e) { add("palavras", "Buscas que levaram ao perfil", null, traduzir(e, o.chave, CONECTOR_GBP).message); }
    return fim();
  }

  return { local, diario, avaliacoes, palavras, testar };
}

export const MSG_SEM_GBP = "O Windsor.ai não tem o Perfil da Empresa (Google My Business) conectado nesta chave (no_accounts_configured). Conecte em https://onboard.windsor.ai?datasource=google_my_business com a conta Google dona do perfil e teste de novo.";

/** Traduz erro do conector google_my_business (sem contas = mensagem própria do Perfil da Empresa). */
export function traduzirGbp(e: unknown, chave: string | null): WindsorErro {
  const w = traduzir(e, chave, CONECTOR_GBP);
  return w.codigo === "sem_contas" ? new WindsorErro(MSG_SEM_GBP, "sem_contas") : w;
}
