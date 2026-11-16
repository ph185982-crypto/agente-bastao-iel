// Dados simulados SÓ para desenvolvimento e capturas de tela (CHANNELS_FIXTURE=1). Ignorado com NODE_ENV=production ou
// VERCEL_ENV=production. Não há nenhum dado real aqui: os nomes dos anúncios são os do cliente de demonstração e todos os
// números são inventados de forma determinística. Sem imagens remotas: os criativos usam o fallback da tela.
import { addDays } from "@/lib/dates";
import { listarDias } from "@/lib/dashboards/periodo";
import type { AnuncioInfo, CanaisApi, IgMetricaDia, IgMidiaBruta, InsightBruto, ResultadoTeste } from "./types";
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
