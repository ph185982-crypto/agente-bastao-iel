// Dados simulados SÓ para desenvolvimento e capturas de tela (CHANNELS_FIXTURE=1). Ignorado com NODE_ENV=production ou
// VERCEL_ENV=production. Não há nenhum dado real aqui: os nomes dos anúncios são os do cliente de demonstração e todos os
// números são inventados de forma determinística. Sem imagens remotas: os criativos usam o fallback da tela.
import { addDays } from "@/lib/dates";
import { listarDias } from "@/lib/dashboards/periodo";
import type { AnuncioInfo, CanaisApi, IgMetricaDia, IgMidiaBruta, InsightBruto, QuebraBruta, ResultadoTeste, SegmentacaoBruta } from "./types";
import type { FonteWindsor, Intervalo, PerfilWindsor } from "./windsor";
import { RESULTADO_PADRAO } from "./types";

export function canaisFixtureAtiva(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return false;
  return env.CHANNELS_FIXTURE?.trim() === "1";
}

function rnd(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const r2 = (x: number) => Math.round(x * 100) / 100;

export const CAMPANHA_FIXTURE = { id: "120252388371430661", nome: "SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km" };

/** Os 6 anúncios do cliente de demonstração. `peso` = fatia do investimento; `taxa` = conversas por R$ gasto (qualidade do criativo). */
export const ANUNCIOS_FIXTURE = [
  { id: "6900000000001", nome: "A1 | Estático | Ilimitado R$69,90", peso: 0.24, taxa: 0.19, video: false },
  { id: "6900000000002", nome: "A2 | Estático | 4 motivos", peso: 0.14, taxa: 0.105, video: false },
  { id: "6900000000003", nome: "A3 | Estático | Barbearia do Floresta", peso: 0.1, taxa: 0.082, video: false },
  { id: "6900000000004", nome: "A1V | Vídeo | Ilimitado R$69,90", peso: 0.26, taxa: 0.235, video: true },
  { id: "6900000000005", nome: "A2V | Vídeo | 4 motivos", peso: 0.16, taxa: 0.14, video: true },
  { id: "6900000000006", nome: "A3V | Vídeo | Barbearia do Floresta", peso: 0.1, taxa: 0.06, video: true },
] as const;

const gastoDoDia = (d: string) => {
  const util = dow(d) === 0 ? 0.7 : dow(d) === 6 ? 1.15 : 1;
  return r2((34 + rnd(`g${d}`) * 14) * util);
};

function linhaAnuncio(d: string, a: (typeof ANUNCIOS_FIXTURE)[number]): InsightBruto {
  const spend = r2(gastoDoDia(d) * a.peso * (0.85 + rnd(`s${a.id}${d}`) * 0.3));
  const impressions = Math.round(spend * (95 + rnd(`i${a.id}${d}`) * 40));
  const clicks = Math.round(impressions * (0.011 + rnd(`c${a.id}${d}`) * 0.012));
  const reach = Math.round(impressions * (0.62 + rnd(`r${a.id}${d}`) * 0.12));
  const results = Math.max(0, Math.round(spend * a.taxa * (0.7 + rnd(`x${a.id}${d}`) * 0.6)));
  return {
    ad_id: a.id, ad_name: a.nome, campaign_id: CAMPANHA_FIXTURE.id, campaign_name: CAMPANHA_FIXTURE.nome, date_start: d, date_stop: d,
    spend: String(spend), impressions: String(impressions), reach: String(reach), clicks: String(clicks),
    ctr: String(impressions ? r2((clicks / impressions) * 100) : 0), cpc: String(clicks ? r2(spend / clicks) : 0), frequency: String(r2(impressions / Math.max(reach, 1))),
    actions: [{ action_type: RESULTADO_PADRAO, value: String(results) }, { action_type: "link_click", value: String(clicks) }],
  };
}

/** Fatias do gasto por público (proporções inspiradas nas linhas reais do Showman, 01–18/11/2026) e conversas por R$. */
const PUBLICO_FIXTURE: Array<[string, string, number, number]> = [
  ["18-24", "male", 0.13, 0.3], ["25-34", "male", 0.385, 0.18], ["35-44", "male", 0.3, 0.15], ["45-54", "male", 0.025, 0.2],
  ["18-24", "female", 0.04, 0.12], ["25-34", "female", 0.06, 0.08], ["35-44", "female", 0.035, 0], ["25-34", "unknown", 0.025, 0.1],
];
const REGIOES_FIXTURE: Array<[string, number]> = [["Goiás", 0.97], ["Distrito Federal", 0.03]];
const POSICOES_FIXTURE: Array<[string, string, number]> = [
  ["facebook", "feed", 0.3], ["facebook", "facebook_reels", 0.16], ["facebook", "facebook_stories", 0.06], ["facebook", "facebook_reels_overlay", 0.01],
  ["instagram", "feed", 0.17], ["instagram", "instagram_reels", 0.18], ["instagram", "instagram_stories", 0.1], ["instagram", "instagram_explore", 0.02],
];
/** Segmentações no formato da Meta (como as dos conjuntos reais, com coordenadas de demonstração). */
export const SEGMENTACOES_FIXTURE: SegmentacaoBruta[] = [
  { adsetId: "120252388371440661", adsetNome: "CJ1 | Ilimitado R$69,90 | Floresta 3km", campaignId: CAMPANHA_FIXTURE.id, campaignNome: CAMPANHA_FIXTURE.nome, status: "ACTIVE",
    targeting: JSON.stringify({ age_max: 45, age_min: 18, excluded_custom_audiences: [{ id: "120252609561060661", name: "SM_base_completa.csv" }], genders: [1], geo_locations: { custom_locations: [{ distance_unit: "kilometer", latitude: -16.6253, longitude: -49.2643, radius: 3, country: "BR" }], location_types: ["home", "recent"] }, publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed", "facebook_reels", "story"], instagram_positions: ["stream", "story", "reels", "explore"], targeting_automation: { advantage_audience: 0 } }) },
  { adsetId: "120252609606480661", adsetNome: "BASE | Clientes cadastrados", campaignId: "120252609606470661", campaignNome: "SHOW MAN | BASE CLIENTES", status: "ACTIVE",
    targeting: JSON.stringify({ age_max: 65, age_min: 18, custom_audiences: [{ id: "120252609561060661", name: "SM_base_completa.csv" }], geo_locations: { custom_locations: [{ distance_unit: "kilometer", latitude: -16.5981, longitude: -49.2741, radius: 10, country: "BR" }] } }) },
  { adsetId: "120252609607970661", adsetNome: "SEMELHANTE 1% | Clientes", campaignId: "120252609607960661", campaignNome: "SHOW MAN | SEMELHANTE 1%", status: "ACTIVE",
    targeting: JSON.stringify({ age_max: 50, age_min: 20, genders: [1], custom_audiences: [{ id: "120252609600000001", name: "Lookalike (BR, 1%) - SM_base_completa.csv" }], excluded_custom_audiences: [{ id: "120252609561060661", name: "SM_base_completa.csv" }], geo_locations: { custom_locations: [{ distance_unit: "kilometer", latitude: -16.6253, longitude: -49.2643, radius: 5, country: "BR" }] }, targeting_automation: { advantage_audience: 1 } }) },
];

/** Cortes simulados: o gasto do dia (o mesmo da campanha) repartido por público, região e posicionamento. Região sem conversas (como no Windsor). */
export function quebrasFixture(dimensao: QuebraBruta["dimensao"], de: string, ate: string, hoje: string): QuebraBruta[] {
  const out: QuebraBruta[] = [];
  for (const d of listarDias(de, ate)) {
    if (d > hoje) continue;
    const g = ANUNCIOS_FIXTURE.reduce((t, a) => t + Number(linhaAnuncio(d, a).spend), 0);
    const base = { date: d, campaign_id: CAMPANHA_FIXTURE.id, campaign_name: CAMPANHA_FIXTURE.nome, dimensao };
    const linha = (fatia: number, taxa: number | null, extra: Partial<QuebraBruta>, semente: string): QuebraBruta => {
      const spend = r2(g * fatia * (0.85 + rnd(`${semente}${d}`) * 0.3));
      const impressions = Math.round(spend * (60 + rnd(`i${semente}${d}`) * 40));
      return { ...base, ...extra, spend, impressions, reach: Math.round(impressions * 0.7), clicks: Math.round(impressions * 0.015), results: taxa == null ? null : Math.round(spend * taxa * (0.6 + rnd(`x${semente}${d}`) * 0.8)) };
    };
    if (dimensao === "idade_genero") for (const [idade, genero, f, t] of PUBLICO_FIXTURE) out.push(linha(f, t, { idade, genero }, `${idade}${genero}`));
    if (dimensao === "regiao") for (const [regiao, f] of REGIOES_FIXTURE) out.push(linha(f, null, { regiao }, regiao));
    if (dimensao === "posicionamento") for (const [plataforma, posicao, f] of POSICOES_FIXTURE) out.push(linha(f, 0.16, { plataforma, posicao }, `${plataforma}${posicao}`));
  }
  return out;
}

const MIDIAS = [
  ["REEL", "Corte + barba sem hora marcada: o Ilimitado por R$69,90"], ["IMAGE", "4 motivos para assinar a barbearia do Floresta"], ["REEL", "Antes e depois: degradê com acabamento na navalha"],
  ["CAROUSEL_ALBUM", "Cardápio de serviços do clube"], ["REEL", "Bastidores: um dia na cadeira"], ["IMAGE", "Promoção do mês para novos assinantes"],
  ["REEL", "Barba modelada em 15 minutos"], ["IMAGE", "Equipe Showman Floresta"], ["REEL", "Como funciona a assinatura ilimitada"], ["IMAGE", "Horários de sábado ampliados"],
  ["REEL", "O corte do mês"], ["IMAGE", "Indique um amigo e ganhe uma barba"],
] as const;

export function criarApiFixture(hoje: string): CanaisApi {
  return {
    async testar(): Promise<ResultadoTeste> {
      return {
        origemToken: "nenhum", ok: true, concedidas: ["ads_read", "read_insights", "instagram_basic", "instagram_manage_insights", "pages_read_engagement"], faltando: [],
        verificacoes: [
          { id: "token", rotulo: "Token válido", ok: true, detalhe: "Dados simulados (CHANNELS_FIXTURE): nenhuma chamada real à Meta." },
          { id: "conta", rotulo: "Conta de anúncios", ok: true, detalhe: "Conta simulada · Ativa · moeda BRL." },
          { id: "campanhas", rotulo: "Acesso às campanhas", ok: true, detalhe: CAMPANHA_FIXTURE.nome },
          { id: "instagram", rotulo: "Instagram", ok: true, detalhe: "@showman.floresta (simulado)" },
        ],
        info: { conta_nome: "Conta simulada", moeda: "BRL", conta_status: "Ativa", ig_username: "showman.floresta" },
      };
    },
    async insightsDiarios({ nivel, de, ate }) {
      const out: InsightBruto[] = [];
      for (const d of listarDias(de, ate)) {
        if (d > hoje) continue;
        const linhas = ANUNCIOS_FIXTURE.map((a) => linhaAnuncio(d, a));
        if (nivel === "ad") { out.push(...linhas); continue; }
        const soma = (k: "spend" | "impressions" | "reach" | "clicks") => linhas.reduce((t, l) => t + Number(l[k] ?? 0), 0);
        const res = linhas.reduce((t, l) => t + Number(l.actions?.[0]?.value ?? 0), 0);
        const spend = r2(soma("spend")), impressions = soma("impressions"), clicks = soma("clicks"), reach = Math.round(soma("reach") * 0.8);
        out.push({
          campaign_id: CAMPANHA_FIXTURE.id, campaign_name: CAMPANHA_FIXTURE.nome, date_start: d, date_stop: d,
          spend: String(spend), impressions: String(impressions), reach: String(reach), clicks: String(clicks),
          ctr: String(impressions ? r2((clicks / impressions) * 100) : 0), cpc: String(clicks ? r2(spend / clicks) : 0), frequency: String(r2(impressions / Math.max(reach, 1))),
          actions: [{ action_type: RESULTADO_PADRAO, value: String(res) }],
        });
      }
      return out;
    },
    async quebras({ dimensao, de, ate }) { return quebrasFixture(dimensao, de, ate, hoje); },
    async segmentacoes() { return SEGMENTACOES_FIXTURE.filter((s) => s.campaignId === CAMPANHA_FIXTURE.id).concat(SEGMENTACOES_FIXTURE.filter((s) => s.campaignId !== CAMPANHA_FIXTURE.id).map((s) => ({ ...s, campaignId: CAMPANHA_FIXTURE.id, campaignNome: CAMPANHA_FIXTURE.nome }))); },
    async anuncios(): Promise<AnuncioInfo[]> {
      return ANUNCIOS_FIXTURE.map((a) => ({ id: a.id, nome: a.nome, campanhaId: CAMPANHA_FIXTURE.id, status: "ACTIVE", statusEfetivo: a.id.endsWith("6") ? "PAUSED" : "ACTIVE", thumb: null, imagem: null, videoId: a.video ? `v${a.id}` : null }));
    },
    async igPerfil() {
      return { username: "showman.floresta", nome: "Showman Barbearia", seguidores: 2480 + Math.round(rnd(`f${hoje}`) * 6), midias: 87, foto: null };
    },
    async igSeguidoresDiarios(_ig, de, ate) {
      const out: Record<string, number> = {};
      for (const d of listarDias(de < addDays(ate, -29) ? addDays(ate, -29) : de, ate)) out[d] = Math.round(2 + rnd(`n${d}`) * 9 - (rnd(`m${d}`) < 0.2 ? 4 : 0));
      return out;
    },
    async igMetricasDia(_ig, dia, excluir) {
      const todas: Record<IgMetricaDia, number> = {
        reach: Math.round(180 + rnd(`ir${dia}`) * 520 + (dow(dia) === 5 ? 160 : 0)),
        views: Math.round(420 + rnd(`iv${dia}`) * 1300),
        profile_views: Math.round(18 + rnd(`ip${dia}`) * 60),
        accounts_engaged: Math.round(12 + rnd(`ie${dia}`) * 55),
        total_interactions: Math.round(30 + rnd(`it${dia}`) * 140),
      };
      const valores: Partial<Record<IgMetricaDia, number>> = {};
      for (const [k, v] of Object.entries(todas)) if (!excluir.has(k as IgMetricaDia)) valores[k as IgMetricaDia] = v;
      return { valores, indisponiveis: [] };
    },
    async igMidias(_ig, desde, limite): Promise<IgMidiaBruta[]> {
      const out: IgMidiaBruta[] = [];
      MIDIAS.forEach(([tipo, legenda], i) => {
        const data = addDays(hoje, -(3 + i * 6));
        if (data < desde || out.length >= limite) return;
        const alcance = Math.round((tipo === "REEL" ? 2600 : 900) * (0.4 + rnd(`ma${i}`) * 1.4));
        const likes = Math.round(alcance * (0.03 + rnd(`ml${i}`) * 0.05));
        out.push({
          id: `1790000000000${i}`, tipo: tipo === "REEL" ? "VIDEO" : tipo, produto: tipo === "REEL" ? "REELS" : "FEED", legenda, permalink: `https://www.instagram.com/p/FIXTURE${i}/`, thumb: null,
          data, timestamp: `${data}T15:00:00+0000`, likes, comentarios: Math.round(likes * 0.08), alcance, salvos: Math.round(likes * 0.12), compartilhamentos: Math.round(likes * 0.1),
          views: tipo === "REEL" ? Math.round(alcance * 1.6) : null, interacoes: Math.round(likes * 1.32),
        });
      });
      return out;
    },
  };
}

// ─── Windsor simulado (só desenvolvimento/capturas/testes): conta e ordem de grandeza reais do Showman, números determinísticos ───────────
const WINDSOR_CONTA = "showmanbarbearia";
const WINDSOR_SEGUIDORES = 1985;

export function criarWindsorFixture(hoje: string): FonteWindsor {
  const faixa = (i: Intervalo): [string, string] => ("preset" in i ? [addDays(hoje, -29), hoje] : [i.de, i.ate]);
  const perfil = async (i: Intervalo): Promise<PerfilWindsor> => {
    const [de, ate] = faixa(i);
    const dias: PerfilWindsor["dias"] = [];
    for (const d of listarDias(de, ate)) {
      if (d > hoje) continue;
      const m: Record<string, number> = { follower_net: Math.round(1 + rnd(`wn${d}`) * 7 - (rnd(`wm${d}`) < 0.18 ? 4 : 0)) };
      if (d < hoje) {
        m.reach = Math.round(260 + rnd(`wr${d}`) * 700 + (dow(d) === 5 ? 220 : 0));
        m.views = Math.round(m.reach * (1.5 + rnd(`wv${d}`) * 1.1));
        m.profile_views = Math.round(14 + rnd(`wp${d}`) * 52);
        m.accounts_engaged = Math.round(10 + rnd(`we${d}`) * 48);
        m.total_interactions = Math.round(28 + rnd(`wt${d}`) * 120);
      } else m.followers = WINDSOR_SEGUIDORES;
      dias.push({ date: d, metrics: m });
    }
    return { conta: WINDSOR_CONTA, contas: [WINDSOR_CONTA], seguidores: WINDSOR_SEGUIDORES, seguidoresDia: hoje, dias, camposComDado: ["accounts_engaged", "follower_count", "followers_count", "profile_views", "reach", "total_interactions", "views"], linhasIgnoradas: 0 };
  };
  return {
    perfil,
    async midias(i, limite): Promise<IgMidiaBruta[]> {
      const [de] = faixa(i);
      const out: IgMidiaBruta[] = [];
      MIDIAS.forEach(([tipo, legenda], k) => {
        const data = addDays(hoje, -(2 + k * 6));
        if (data < de || out.length >= limite) return;
        const reel = tipo === "REEL";
        const alcance = k === 0 ? 1775 : Math.round((reel ? 1700 : 640) * (0.35 + rnd(`wma${k}`) * 1.3));
        const likes = Math.round(alcance * (0.035 + rnd(`wml${k}`) * 0.05));
        out.push({
          id: `1790000000001${k}`, tipo: reel ? "VIDEO" : tipo, produto: reel ? "REELS" : "FEED", legenda, permalink: `https://www.instagram.com/p/SIMULADO${k}/`, thumb: null,
          data, timestamp: `${data}T15:00:00+0000`, likes, comentarios: Math.round(likes * 0.07), alcance, salvos: Math.round(likes * 0.1), compartilhamentos: Math.round(likes * 0.09),
          views: k === 0 ? 2899 : reel ? Math.round(alcance * 1.6) : null, interacoes: Math.round(likes * 1.26),
        });
      });
      return out;
    },
    async audiencia() {
      return { dados: { idade: { "13-17": 12, "18-24": 410, "25-34": 780, "35-44": 520, "45-54": 160, "55-64": 48, "65+": 14 }, genero: { M: 1330, F: 560, U: 54 }, cidades: { "Belo Horizonte, Minas Gerais": 940, "Contagem, Minas Gerais": 130, "Betim, Minas Gerais": 84, "Sabará, Minas Gerais": 52, "Santa Luzia, Minas Gerais": 41 } }, erros: [] };
    },
    async testar() {
      const p = await perfil({ preset: "last_30d" });
      return {
        ok: true, origemChave: "nenhuma" as const,
        verificacoes: [
          { id: "chave", rotulo: "Chave aceita pelo Windsor.ai", ok: true, detalhe: "Dados simulados (CHANNELS_FIXTURE): nenhuma chamada real ao Windsor.ai." },
          { id: "contas", rotulo: "Contas de Instagram no Windsor.ai", ok: true, detalhe: `1 conta(s): @${WINDSOR_CONTA}.` },
          { id: "perfil", rotulo: "Perfil diário (últimos 30 dias)", ok: true, detalhe: `${p.dias.length} dia(s) lidos · ${WINDSOR_SEGUIDORES} seguidores hoje.` },
          { id: "midias", rotulo: "Mídias (últimos 30 dias)", ok: true, detalhe: "5 mídia(s) lidas, 0 com miniatura." },
        ],
        info: { contas: [WINDSOR_CONTA], campos: p.camposComDado, dias: p.dias.length, midias: 5, seguidores: WINDSOR_SEGUIDORES, ig_username: WINDSOR_CONTA },
      };
    },
  };
}
