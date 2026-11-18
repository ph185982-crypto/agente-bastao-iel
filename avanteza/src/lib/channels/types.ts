// Canais do cliente (painel de mídia e tráfego): tipos compartilhados entre coletor, provedores, relatório e telas.
// Tudo aqui é somente leitura em relação à Meta. Nada neste arquivo guarda segredo.

export const PERMISSOES_NECESSARIAS = ["ads_read", "read_insights", "instagram_basic", "instagram_manage_insights", "pages_read_engagement"] as const;
/** Só os anúncios (Meta Ads) exigem ads_read e read_insights. O Instagram vem do Windsor.ai; as demais são só para o Instagram pela Meta (opcional). */
export const PERMISSOES_ANUNCIOS = ["ads_read", "read_insights"] as const;
export const PERMISSOES_INSTAGRAM_META = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"] as const;
export const RESULTADO_PADRAO = "onsite_conversion.messaging_conversation_started_7d";
/** Gasto mínimo (R$) no período para um anúncio entrar no ranking de criativos (evita ruído de poucos centavos). */
export const MIN_GASTO_RANKING = 30;
/** Dias coletados na carga inicial/“Atualizar agora” e na rotina diária (reprocessa a janela recente: a atribuição da Meta muda por até 7 dias). */
export const DIAS_BACKFILL = 90;
export const DIAS_ROTINA = 7;

export type KindSnapshot = "campaign_daily" | "ad_daily" | "ig_daily" | "ig_media" | "ig_audience" | "ads_breakdown" | "adset_targeting";
export type StatusCanal = "pendente" | "ativo" | "erro" | "desconectado";
/** Duas fontes independentes: tráfego/anúncios e mídias/Instagram. Cada uma tem credencial, coleta, status e erro próprios. */
export type FonteAnuncios = "meta" | "windsor" | "none";
export type FonteInstagram = "meta" | "windsor" | "none";
/** Origem gravada em cada snapshot (channel_snapshots.source). */
export type OrigemDado = "meta" | "windsor";
export const ROTULO_FONTE: Record<OrigemDado, string> = { meta: "Meta Ads", windsor: "Windsor.ai" };
export const ROTULO_FONTE_IG: Record<OrigemDado, string> = { meta: "Meta (Instagram)", windsor: "Windsor.ai" };

export interface CanalConfig {
  clientId: string;
  adAccountId: string | null;
  campaignIds: string[];
  /** Filtro opcional por nome da campanha (contém, sem caixa/acento). Ex.: Showman = "SHOW MAN". */
  campaignNameFilter: string | null;
  igUserId: string | null;
  pageId: string | null;
  resultActionType: string;
  adsSource: FonteAnuncios;
  igSource: FonteInstagram;
  /** Filtro opcional por account_name no Windsor (ex.: showmanbarbearia). */
  windsorAccountName: string | null;
}

/** Linha de insights da Meta (nível campanha ou anúncio, por dia). Valores vêm como texto. */
export interface InsightBruto {
  campaign_id?: string; campaign_name?: string; ad_id?: string; ad_name?: string;
  date_start?: string; date_stop?: string;
  spend?: string; impressions?: string; reach?: string; clicks?: string; ctr?: string; cpc?: string; frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

export interface AnuncioInfo {
  id: string; nome: string; campanhaId: string | null; status: string | null; statusEfetivo: string | null;
  thumb: string | null; imagem: string | null; videoId: string | null;
  /** Conjunto (público) do anúncio e o criativo em si: título, texto, chamada para ação e links (só https de fb.me/facebook.com/instagram.com). */
  conjuntoId?: string | null; conjuntoNome?: string | null;
  titulo?: string | null; texto?: string | null; cta?: string | null; previa?: string | null; instagram?: string | null;
}

export interface IgPerfil { username: string | null; nome: string | null; seguidores: number | null; midias: number | null; foto: string | null }
export const IG_METRICAS_DIA = ["reach", "views", "profile_views", "accounts_engaged", "total_interactions"] as const;
export type IgMetricaDia = (typeof IG_METRICAS_DIA)[number];
export interface IgMidiaBruta {
  id: string; tipo: string; produto: string | null; legenda: string | null; permalink: string | null; thumb: string | null; data: string; timestamp: string;
  likes: number | null; comentarios: number | null; alcance: number | null; salvos: number | null; compartilhamentos: number | null; views: number | null; interacoes: number | null;
}

export interface VerificacaoTeste { id: string; rotulo: string; ok: boolean | null; detalhe: string }
export interface ResultadoTeste {
  origemToken: "cliente" | "plataforma" | "nenhum";
  verificacoes: VerificacaoTeste[];
  concedidas: string[];
  faltando: string[];
  /** true quando nenhuma verificação falhou (as puladas não contam). */
  ok: boolean;
  /** Dados não secretos para guardar no canal (nome da conta, moeda, @ do Instagram, ids sugeridos). */
  info: { conta_nome?: string; moeda?: string; conta_status?: string; ig_username?: string; ig_sugerido?: string };
}

/** Cortes de público/localização dos anúncios, pedidos UM POR CONSULTA (Windsor e Meta não aceitam misturar). */
export type DimensaoQuebra = "idade_genero" | "regiao" | "posicionamento";
export const DIMENSOES_QUEBRA: readonly DimensaoQuebra[] = ["idade_genero", "regiao", "posicionamento"];
/** Linha de um corte, por dia e campanha. `results` null = a fonte não trouxe a métrica neste corte (nunca vira zero). */
export interface QuebraBruta {
  dimensao: DimensaoQuebra; date: string; campaign_id: string; campaign_name?: string;
  idade?: string; genero?: string; regiao?: string; plataforma?: string; posicao?: string;
  spend: number; impressions: number; reach: number | null; clicks: number | null; results: number | null;
}
/** Segmentação (targeting) de um conjunto de anúncios como veio da fonte (objeto ou texto JSON). */
export interface SegmentacaoBruta { adsetId: string | null; adsetNome: string; campaignId: string | null; campaignNome: string | null; status: string | null; targeting: unknown }

/** Tudo o que o coletor e a tela de teste precisam da Meta. Implementações: Graph real (graph.ts) e simulada (fixture.ts, testes). */
export interface CanaisApi {
  testar(cfg: Pick<CanalConfig, "adAccountId" | "campaignIds" | "igUserId" | "pageId">): Promise<ResultadoTeste>;
  insightsDiarios(p: { contaId: string; nivel: "campaign" | "ad"; de: string; ate: string; campanhas: string[] }): Promise<InsightBruto[]>;
  anuncios(p: { contaId: string; campanhas: string[] }): Promise<AnuncioInfo[]>;
  /** Um corte (idade×gênero, região ou posicionamento) por dia e campanha. Opcional: fonte sem suporte simplesmente não tem a seção. */
  quebras?(p: { contaId: string; dimensao: DimensaoQuebra; de: string; ate: string; campanhas: string[]; tipo?: string }): Promise<QuebraBruta[]>;
  /** Segmentação atual de cada conjunto de anúncios (só leitura). */
  segmentacoes?(p: { contaId: string; campanhas: string[]; de?: string; ate?: string }): Promise<SegmentacaoBruta[]>;
  igPerfil(igId: string): Promise<IgPerfil>;
  /** Variação líquida de seguidores por dia (a API só devolve os últimos ~30 dias). */
  igSeguidoresDiarios(igId: string, de: string, ate: string): Promise<Record<string, number>>;
  /** Métricas do dia (total_value). `excluir` = métricas já sabidas como indisponíveis. */
  igMetricasDia(igId: string, dia: string, excluir: ReadonlySet<IgMetricaDia>): Promise<{ valores: Partial<Record<IgMetricaDia, number>>; indisponiveis: IgMetricaDia[] }>;
  igMidias(igId: string, desde: string, limite: number, pode: () => boolean): Promise<IgMidiaBruta[]>;
}

// Formato guardado em channel_snapshots.metrics ───────────────────────────────
export interface MetricasCampanhaDia { nome: string; spend: number; impressions: number; reach: number; clicks: number; ctr: number | null; cpc: number | null; frequency: number | null; results: number }
export interface MetricasAnuncioDia extends MetricasCampanhaDia {
  campaign_id?: string; campaign_name?: string; status?: string | null; effective_status?: string | null;
  thumb?: string | null; image?: string | null; video_id?: string | null;
  adset_id?: string | null; adset_name?: string | null;
  title?: string | null; body?: string | null; cta?: string | null; preview_url?: string | null; ig_url?: string | null;
}
/** ads_breakdown: key = "<dimensão>|<campanha>|<valores>"; uma linha por dia. */
export interface MetricasQuebra {
  dimensao: DimensaoQuebra; campaign_id: string; campaign_name?: string;
  idade?: string; genero?: string; regiao?: string; plataforma?: string; posicao?: string;
  spend: number; impressions: number; reach: number | null; clicks: number | null; results: number | null;
}
/** adset_targeting: key = id do conjunto (ou "nome:<nome>"); date = dia da coleta; vale o último estado. Só o administrador vê o bruto. */
export interface MetricasSegmentacao { adset_name: string; campaign_id: string | null; campaign_name: string | null; status: string | null; targeting: unknown }
export interface MetricasIgDia {
  reach?: number; views?: number; profile_views?: number; accounts_engaged?: number; total_interactions?: number;
  follower_net?: number; followers?: number; indisponiveis?: string[];
}
/** Audiência do Instagram (Windsor): rótulo → quantidade, por dimensão. */
export interface MetricasIgAudiencia { idade?: Record<string, number>; genero?: Record<string, number>; cidades?: Record<string, number>; paises?: Record<string, number> }
export interface MetricasIgMidia {
  type: string; product?: string | null; caption?: string | null; permalink?: string | null; thumb?: string | null; timestamp: string;
  likes?: number | null; comments?: number | null; reach?: number | null; saved?: number | null; shares?: number | null; views?: number | null; interactions?: number | null;
}
