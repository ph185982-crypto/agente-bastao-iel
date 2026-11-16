// Provider do Windsor.ai (somente leitura) para as MÍDIAS/INSTAGRAM do cliente. É uma fonte independente da Meta Ads (anúncios):
// produz os mesmos dados que o coletor do Instagram da Meta produz (perfil por dia, mídias, audiência), então a tela não depende da fonte.
//
//   GET https://connectors.windsor.ai/instagram?date_from=…&date_to=…&fields=a,b,c&api_key=<chave>   →   { "data": [ {…}, … ] }
//
// A chave só existe na URL da chamada (a API do Windsor exige assim). Ela nunca é logada, devolvida, guardada em erro nem em teste:
// toda mensagem passa por `esconderChave` e a URL de ApiError já sai mascarada (src/lib/http.ts). Perfil e mídias são pedidos em
// consultas separadas (campos de dimensões diferentes geram linhas diferentes) e as linhas podem trazer null nos campos que não se
// aplicam ao dia: nada é inventado, null vira "sem dado".
import { z } from "zod";
import { ApiError, fetchJson, type RetryOptions } from "@/lib/http";
import { addDays as somarDias } from "@/lib/dates";
import { safeImageUrl } from "@/lib/marketplaces/images";
import type { IgMidiaBruta, MetricasIgAudiencia, MetricasIgDia } from "./types";

export const WINDSOR_HOST = "connectors.windsor.ai";
const CONECTOR = "instagram";

export type CodigoWindsor = "chave" | "sem_contas" | "limite" | "rede" | "campo" | "formato" | "conta" | "varias_contas" | "api";
export class WindsorErro extends Error {
  constructor(message: string, public codigo: CodigoWindsor) { super(message); this.name = "WindsorErro"; }
}

/** Remove a chave de qualquer texto antes de guardar ou mostrar. */
export function esconderChave(texto: string, chave?: string | null): string {
  let t = texto;
  if (chave && chave.length >= 6) t = t.split(chave).join("***");
  return t.replace(/(api_?key|key)=[^&\s"']+/gi, "$1=***");
}

export const PERFIL_CAMPOS = ["date", "account_name", "followers_count", "follower_count", "reach", "views", "profile_views", "accounts_engaged", "total_interactions", "follows_and_unfollows", "website_clicks_1d", "profile_links_taps", "impressions"] as const;
export const MIDIA_CAMPOS = ["date", "account_name", "media_id", "media_product_type", "media_type", "media_caption", "media_permalink", "media_thumbnail_url", "media_url", "media_reach", "media_like_count", "media_comments_count", "media_saved", "media_shares", "media_views", "media_plays"] as const;
const AUDIENCIA_DIMENSOES = [
  { chave: "idade", nome: "audience_age_name", tamanho: "audience_age_size" },
  { chave: "genero", nome: "audience_gender_name", tamanho: "audience_gender_size" },
  // O conector não tem audience_city_name (unknown_field): o nome da cidade vem no campo `city`, junto de audience_city_size.
  { chave: "cidades", nome: "city", tamanho: "audience_city_size" },
  { chave: "paises", nome: "audience_country_name", tamanho: "audience_country_size" },
] as const;

type Linha = Record<string, unknown>;
/** follower_count (saldo diário) só aceita os últimos 30 dias; os demais campos do perfil aceitam janelas maiores, em consulta separada. */
const PERFIL_CAMPOS_SALDO = ["date", "account_name", "follower_count"] as const;
const PERFIL_CAMPOS_PRINCIPAIS = PERFIL_CAMPOS.filter((c) => c !== "follower_count");
export type Intervalo = { de: string; ate: string } | { preset: string };

// ─── Esquemas (zod) ──────────────────────────────────────────────────────────

const Resposta = z.object({ data: z.array(z.record(z.string(), z.unknown())) });
const Num = z.union([z.number(), z.string()]).nullish();
const Txt = z.string().nullish();
const LinhaPerfil = z.object({
  date: Txt, account_name: Txt, followers_count: Num, follower_count: Num, reach: Num, views: Num, profile_views: Num, accounts_engaged: Num,
  total_interactions: Num, follows_and_unfollows: Num, website_clicks_1d: Num, profile_links_taps: Num, impressions: Num,
});
const LinhaMidia = z.object({
  date: Txt, account_name: Txt, media_id: z.union([z.string(), z.number()]).nullish(), media_product_type: Txt, media_type: Txt, media_caption: Txt, media_permalink: Txt,
  media_thumbnail_url: Txt, media_url: Txt, media_reach: Num, media_like_count: Num, media_comments_count: Num, media_saved: Num, media_shares: Num, media_views: Num, media_plays: Num,
});

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const x = Number(v); return Number.isFinite(x) ? x : null; }
  return null;
};
const dia = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const norm = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

// ─── Tradução de erros ───────────────────────────────────────────────────────

const MSG = {
  chave: "A chave do Windsor.ai foi recusada (inválida, revogada ou sem permissão). Confira a chave na conta do Windsor.ai e atualize a variável WINDSOR_API_KEY ou a chave deste canal.",
  sem_contas: "O Windsor.ai não tem nenhuma conta de Instagram conectada para esta chave (no_accounts_configured). Conecte o Instagram em windsor.ai, em Data Sources, e tente de novo.",
  limite: "O Windsor.ai limitou as consultas por agora. A próxima atualização tenta de novo.",
  rede: "Não foi possível falar com o Windsor.ai (rede ou tempo esgotado). A próxima atualização tenta de novo.",
} as const;

function textoDoCorpo(b: unknown): string {
  if (typeof b === "string") return b;
  if (b && typeof b === "object") {
    const o = b as Record<string, unknown>;
    for (const k of ["error", "message", "detail"]) { const v = o[k]; if (typeof v === "string") return v; if (v && typeof v === "object" && typeof (v as any).message === "string") return (v as any).message; }
  }
  return "";
}

function classificar(status: number, texto: string, chave: string | null): WindsorErro {
  const t = esconderChave(texto, chave).slice(0, 200);
  if (/no_accounts_configured|no accounts? (are )?configured|no connected accounts?/i.test(texto)) return new WindsorErro(MSG.sem_contas, "sem_contas");
  if (status === 401 || status === 403 || /api[_ ]?key|unauthori[sz]ed|forbidden|invalid (token|credential)/i.test(texto)) return new WindsorErro(MSG.chave, "chave");
  if (status === 429) return new WindsorErro(MSG.limite, "limite");
  if (status >= 500) return new WindsorErro(`O Windsor.ai está fora do ar no momento (HTTP ${status}). A próxima atualização tenta de novo.`, "api");
  if (status === 400 && /field/i.test(texto)) return new WindsorErro(`O Windsor.ai não reconheceu algum campo pedido${t ? ` (${t})` : ""}.`, "campo");
  return new WindsorErro(`O Windsor.ai recusou a consulta${status ? ` (HTTP ${status})` : ""}${t ? `: ${t}` : ""}.`, "api");
}

function traduzir(e: unknown, chave: string | null): WindsorErro {
  if (e instanceof WindsorErro) return e;
  if (e instanceof ApiError) return classificar(e.status, textoDoCorpo(e.body) || e.message, chave);
  return new WindsorErro(MSG.rede, "rede");
}

// ─── Cliente HTTP ────────────────────────────────────────────────────────────

export interface OpcoesWindsor extends Pick<RetryOptions, "sleep" | "fetchImpl" | "baseDelayMs" | "maxDelayMs"> {
  chave: string;
  /** Filtro por account_name (ex.: showmanbarbearia; o @ é opcional). */
  accountName?: string | null;
  retries?: number;
}

export interface PerfilWindsor {
  conta: string | null;
  /** Contas (account_name) vistas na resposta, antes do filtro. */
  contas: string[];
  /** Último valor de followers_count (o Windsor só traz no dia atual) e o dia a que pertence. */
  seguidores: number | null; seguidoresDia: string | null;
  dias: Array<{ date: string; metrics: Partial<MetricasIgDia> }>;
  /** Campos do perfil que vieram com valor em ao menos uma linha. */
  camposComDado: string[];
  linhasIgnoradas: number;
  /** Consultas opcionais que falharam (ex.: saldo diário de seguidores); o resto do perfil continua valendo. */
  avisos?: string[];
}
export interface ResultadoTesteWindsor {
  ok: boolean;
  origemChave: "canal" | "plataforma" | "nenhuma";
  verificacoes: Array<{ id: string; rotulo: string; ok: boolean | null; detalhe: string }>;
  info: { contas: string[]; campos: string[]; dias: number; midias: number; seguidores: number | null; ig_username?: string };
}

/** O que o coletor e o teste precisam do Windsor. Implementações: real (criarWindsor), simulada (fixture.ts e testes). */
export interface FonteWindsor {
  testar(): Promise<ResultadoTesteWindsor>;
  perfil(i: Intervalo): Promise<PerfilWindsor>;
  midias(i: Intervalo, limite: number): Promise<IgMidiaBruta[]>;
  audiencia(): Promise<{ dados: MetricasIgAudiencia; erros: string[] }>;
}

export function criarWindsor(o: OpcoesWindsor): FonteWindsor {
  const retries = o.retries ?? 2;
  const alvo = o.accountName?.trim() ? norm(o.accountName) : null;

  async function consultar(campos: readonly string[], i: Intervalo): Promise<Linha[]> {
    const qs = new URLSearchParams();
    if ("preset" in i) qs.set("date_preset", i.preset); else { qs.set("date_from", i.de); qs.set("date_to", i.ate); }
    qs.set("fields", campos.join(","));
    qs.set("api_key", o.chave);
    const url = `https://${WINDSOR_HOST}/${CONECTOR}?${qs.toString()}`;
    let corpo: unknown;
    try {
      // Só GET. A chave só vai na querystring, exigência da API do Windsor.
      corpo = await fetchJson<unknown>(url, { method: "GET", headers: { Accept: "application/json" } }, { retries, baseDelayMs: o.baseDelayMs ?? 500, maxDelayMs: o.maxDelayMs ?? 8000, sleep: o.sleep, fetchImpl: o.fetchImpl });
    } catch (e) { throw traduzir(e, o.chave); }
    const erro = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>).error : null;
    if (erro) throw classificar(200, textoDoCorpo(corpo) || String(erro), o.chave);
    const r = Resposta.safeParse(corpo);
    if (!r.success) {
      if (typeof corpo === "string" && corpo) throw classificar(200, corpo, o.chave);
      throw new WindsorErro("Resposta inesperada do Windsor.ai (formato diferente do esperado).", "formato");
    }
    return r.data.data;
  }

  /** Aplica o filtro por conta. Sem filtro e com mais de uma conta, recusa em vez de misturar contas. */
  function porConta(linhas: Linha[]): { linhas: Linha[]; conta: string | null; contas: string[] } {
    const nomes = linhas.map((l) => (typeof l.account_name === "string" && l.account_name.trim() ? l.account_name.trim() : null));
    const contas = [...new Set(nomes.filter((n): n is string => n !== null))].sort();
    if (!contas.length) return { linhas, conta: null, contas };
    if (alvo) {
      const achada = contas.find((c) => norm(c) === alvo);
      if (!achada) throw new WindsorErro(`Nenhuma conta com o nome “${o.accountName!.trim()}” no Windsor.ai. Contas encontradas: ${contas.join(", ")}.`, "conta");
      return { linhas: linhas.filter((_, k) => nomes[k] === achada), conta: achada, contas };
    }
    if (contas.length > 1) throw new WindsorErro(`O Windsor.ai devolveu ${contas.length} contas (${contas.join(", ")}). Informe o nome da conta (account_name) para escolher qual usar.`, "varias_contas");
    return { linhas, conta: contas[0], contas };
  }

  async function perfil(i: Intervalo): Promise<PerfilWindsor> {
    const avisos: string[] = [];
    // Consulta principal (janela inteira, sem follower_count). Falha aqui é fatal para o perfil.
    const principal = await consultar(PERFIL_CAMPOS_PRINCIPAIS, i);
    // Saldo diário: janela limitada a 30 dias, em consulta própria; se falhar vira aviso e não derruba o resto.
    let saldo: Linha[] = [];
    try {
      const j: Intervalo = "preset" in i ? i : { de: i.de < somarDias(i.ate, -29) ? somarDias(i.ate, -29) : i.de, ate: i.ate };
      saldo = await consultar(PERFIL_CAMPOS_SALDO, j);
    } catch (e) {
      if (e instanceof WindsorErro && (e.codigo === "chave" || e.codigo === "sem_contas")) throw e;
      avisos.push(`Saldo diário de seguidores: ${e instanceof WindsorErro ? e.message : "falha inesperada"}`);
    }
    const bruto = [...principal, ...saldo];
    const { linhas, conta, contas } = porConta(bruto);
    const porDia = new Map<string, Partial<MetricasIgDia>>();
    const campos = new Set<string>();
    let ignoradas = 0, seguidores: number | null = null, seguidoresDia: string | null = null;
    for (const l of linhas) {
      const p = LinhaPerfil.safeParse(l);
      const d = p.success ? dia(p.data.date) : null;
      if (!p.success || !d) { ignoradas++; continue; }
      const x = p.data;
      const m = porDia.get(d) ?? {};
      const set = (campo: string, v: unknown, alvoCampo: keyof MetricasIgDia) => { const n = num(v); if (n == null) return; campos.add(campo); (m as Record<string, unknown>)[alvoCampo] = n; };
      set("reach", x.reach, "reach"); set("views", x.views, "views"); set("profile_views", x.profile_views, "profile_views");
      set("accounts_engaged", x.accounts_engaged, "accounts_engaged"); set("total_interactions", x.total_interactions, "total_interactions");
      set("follower_count", x.follower_count, "follower_net"); set("followers_count", x.followers_count, "followers");
      for (const c of ["follows_and_unfollows", "website_clicks_1d", "profile_links_taps", "impressions"] as const) if (num(x[c]) != null) campos.add(c);
      const f = num(x.followers_count);
      if (f != null && (seguidoresDia == null || d >= seguidoresDia)) { seguidores = f; seguidoresDia = d; }
      if (Object.keys(m).length) porDia.set(d, m);
    }
    const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({ date, metrics }));
    return { conta, contas, seguidores, seguidoresDia, dias, camposComDado: [...campos].sort(), linhasIgnoradas: ignoradas, avisos };
  }

  async function midias(i: Intervalo, limite: number): Promise<IgMidiaBruta[]> {
    const bruto = await consultar(MIDIA_CAMPOS, i);
    const { linhas } = porConta(bruto);
    const porId = new Map<string, { primeiroDia: string; v: Record<string, unknown> }>();
    for (const l of linhas) {
      const p = LinhaMidia.safeParse(l);
      const id = p.success && p.data.media_id != null ? String(p.data.media_id) : null;
      const d = p.success ? dia(p.data.date) : null;
      if (!p.success || !id || !d) continue;
      const atual = porId.get(id) ?? { primeiroDia: d, v: {} };
      if (d < atual.primeiroDia) atual.primeiroDia = d;
      // linhas repetidas da mesma mídia: o valor não nulo mais recente prevalece (null = "não se aplica a este dia")
      for (const [k, v] of Object.entries(p.data)) if (v != null && v !== "") atual.v[k] = v;
      porId.set(id, atual);
    }
    const out: IgMidiaBruta[] = [];
    for (const [id, { primeiroDia, v }] of porId) {
      if (String(v.media_product_type ?? "").toUpperCase() === "STORY") continue;
      const tipo = String(v.media_type ?? "IMAGE");
      const likes = num(v.media_like_count), coment = num(v.media_comments_count), salvos = num(v.media_saved), comp = num(v.media_shares);
      const algum = [likes, coment, salvos, comp].some((x) => x != null);
      const link = typeof v.media_permalink === "string" && /^https:\/\//.test(v.media_permalink) ? v.media_permalink : null;
      out.push({
        id, tipo, produto: typeof v.media_product_type === "string" ? v.media_product_type : null,
        legenda: typeof v.media_caption === "string" ? v.media_caption.slice(0, 160) : null, permalink: link,
        thumb: safeImageUrl(tipo.toUpperCase() === "VIDEO" ? v.media_thumbnail_url ?? v.media_url : v.media_url ?? v.media_thumbnail_url),
        data: primeiroDia, timestamp: `${primeiroDia}T15:00:00+0000`,
        likes, comentarios: coment, alcance: num(v.media_reach), salvos, compartilhamentos: comp,
        views: num(v.media_views) ?? num(v.media_plays),
        interacoes: algum ? (likes ?? 0) + (coment ?? 0) + (salvos ?? 0) + (comp ?? 0) : null,
      });
    }
    return out.sort((a, b) => b.data.localeCompare(a.data)).slice(0, limite);
  }

  /** Lista de campos do conector (cacheada por instância). Falhou ou formato desconhecido = null (não filtra, tenta mesmo assim). */
  let camposConhecidos: Set<string> | null | undefined;
  async function listaDeCampos(): Promise<Set<string> | null> {
    if (camposConhecidos !== undefined) return camposConhecidos;
    try {
      const qs = new URLSearchParams({ api_key: o.chave });
      const corpo = await fetchJson<unknown>(`https://${WINDSOR_HOST}/${CONECTOR}/fields?${qs.toString()}`, { method: "GET", headers: { Accept: "application/json" } }, { retries: 1, baseDelayMs: o.baseDelayMs ?? 500, maxDelayMs: o.maxDelayMs ?? 8000, sleep: o.sleep, fetchImpl: o.fetchImpl });
      const itens: unknown[] = Array.isArray(corpo) ? corpo : corpo && typeof corpo === "object" ? (Array.isArray((corpo as any).data) ? (corpo as any).data : Object.keys(corpo as object)) : [];
      const nomes = itens.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as any).id ?? (x as any).name ?? (x as any).field : null)).filter((x): x is string => typeof x === "string");
      camposConhecidos = nomes.length > 10 ? new Set(nomes) : null;
    } catch { camposConhecidos = null; }
    return camposConhecidos;
  }

  async function audiencia(): Promise<{ dados: MetricasIgAudiencia; erros: string[] }> {
    const dados: MetricasIgAudiencia = {};
    const erros: string[] = [];
    const conhecidos = await listaDeCampos();
    for (const dim of AUDIENCIA_DIMENSOES) {
      const faltam = conhecidos ? [dim.nome, dim.tamanho].filter((c) => !conhecidos.has(c)) : [];
      if (faltam.length) { erros.push(`${dim.chave}: campo(s) ${faltam.join(", ")} não existem neste conector; dimensão ignorada.`); continue; }
      try {
        const bruto = await consultar(["account_name", dim.nome, dim.tamanho], { preset: "last_30d" });
        const { linhas } = porConta(bruto);
        const acc: Record<string, number> = {};
        for (const l of linhas) {
          const nome = l[dim.nome], tam = num(l[dim.tamanho]);
          if (typeof nome !== "string" || !nome.trim() || tam == null) continue;
          acc[nome.trim()] = Math.max(acc[nome.trim()] ?? 0, tam); // várias linhas do mesmo rótulo: não soma (evita contar a mesma audiência duas vezes)
        }
        if (Object.keys(acc).length) dados[dim.chave] = acc;
      } catch (e) {
        if (e instanceof WindsorErro && (e.codigo === "chave" || e.codigo === "sem_contas" || e.codigo === "conta" || e.codigo === "varias_contas")) throw e;
        erros.push(`${dim.chave}: ${e instanceof WindsorErro ? e.message : "falha inesperada"}`);
      }
    }
    return { dados, erros };
  }

  async function testar(): Promise<ResultadoTesteWindsor> {
    const v: ResultadoTesteWindsor["verificacoes"] = [];
    const info: ResultadoTesteWindsor["info"] = { contas: [], campos: [], dias: 0, midias: 0, seguidores: null };
    const add = (id: string, rotulo: string, ok: boolean | null, detalhe: string) => v.push({ id, rotulo, ok, detalhe: esconderChave(detalhe, o.chave) });
    const fim = (): ResultadoTesteWindsor => ({ ok: v.every((x) => x.ok !== false), origemChave: "nenhuma", verificacoes: v, info });
    const intervalo: Intervalo = { preset: "last_30d" };

    let bruto: Linha[];
    try {
      bruto = await consultar(PERFIL_CAMPOS, intervalo);
      add("chave", "Chave aceita pelo Windsor.ai", true, "O Windsor.ai respondeu à consulta do Instagram.");
    } catch (e) {
      const w = traduzir(e, o.chave);
      add(w.codigo === "chave" ? "chave" : w.codigo === "sem_contas" ? "contas" : "chave", w.codigo === "sem_contas" ? "Contas de Instagram no Windsor.ai" : "Chave aceita pelo Windsor.ai", false, w.message);
      return fim();
    }
    const nomes = [...new Set(bruto.map((l) => (typeof l.account_name === "string" ? l.account_name.trim() : "")).filter(Boolean))].sort();
    info.contas = nomes;
    if (!nomes.length) {
      add("contas", "Contas de Instagram no Windsor.ai", false, bruto.length ? "As linhas não trazem account_name; não dá para identificar a conta." : MSG.sem_contas);
      return fim();
    }
    add("contas", "Contas de Instagram no Windsor.ai", true, `${nomes.length} conta(s): ${nomes.map((n) => `@${n.replace(/^@/, "")}`).join(", ")}.`);
    if (alvo) {
      const achada = nomes.find((n) => norm(n) === alvo);
      add("conta_filtro", "Nome da conta (account_name)", Boolean(achada), achada ? `“${o.accountName!.trim()}” corresponde a @${achada.replace(/^@/, "")}.` : `“${o.accountName!.trim()}” não casa com nenhuma conta. Use um destes nomes: ${nomes.join(", ")}.`);
      if (!achada) return fim();
    } else if (nomes.length > 1) {
      add("conta_filtro", "Nome da conta (account_name)", false, `Há ${nomes.length} contas no Windsor.ai; informe o account_name para escolher uma e não misturar dados.`);
      return fim();
    } else {
      add("conta_filtro", "Nome da conta (account_name)", null, "Não informado; há uma só conta, então ela será usada.");
    }
    try {
      const p = await perfil(intervalo);
      info.dias = p.dias.length; info.campos = p.camposComDado; info.seguidores = p.seguidores; if (p.conta) info.ig_username = p.conta.replace(/^@/, "");
      add("perfil", "Perfil diário (últimos 30 dias)", p.dias.length > 0, p.dias.length ? `${p.dias.length} dia(s) lidos${p.seguidores != null ? ` · ${p.seguidores} seguidores hoje` : " · sem followers_count no período"}.` : "Nenhum dia com métricas do perfil.");
      add("campos", "Campos do perfil com dados", p.camposComDado.length > 0, p.camposComDado.length ? p.camposComDado.join(", ") : "Nenhum campo veio com valor.");
    } catch (e) { add("perfil", "Perfil diário (últimos 30 dias)", false, traduzir(e, o.chave).message); }
    try {
      const m = await midias(intervalo, 200);
      info.midias = m.length;
      add("midias", "Mídias (últimos 30 dias)", m.length > 0 ? true : null, m.length ? `${m.length} mídia(s) lidas, ${m.filter((x) => x.thumb).length} com miniatura.` : "Nenhuma mídia publicada no período (ou ainda sem dados).");
    } catch (e) { add("midias", "Mídias (últimos 30 dias)", false, traduzir(e, o.chave).message); }
    return fim();
  }

  return { testar, perfil, midias, audiencia };
}

/** Chave do Windsor da plataforma (variável de ambiente). Nunca é devolvida a uma tela: só se sabe se existe. */
export function chaveWindsorDaPlataforma(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.WINDSOR_API_KEY?.trim() || null;
}
