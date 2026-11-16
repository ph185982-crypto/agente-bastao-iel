// Tráfego pago e mídias (V2: Windsor.ai). Na V1 só existe a interface e o provedor "vazio":
// a tela Canais mostra o estado honesto "Conectando fontes de dados". Dados simulados existem só em testes.
export const CHANNELS = ["instagram", "meta", "google", "facebook"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { instagram: "Instagram", meta: "Meta Ads", google: "Google Ads", facebook: "Facebook" };

export interface ChannelMetrics {
  channel: Channel;
  /** Investimento em R$. */
  spend: number;
  /** Faturamento atribuído em R$. */
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
}
export interface TrafficSummary {
  from: string;
  to: string;
  channels: ChannelMetrics[];
}
export interface TrafficProvider {
  readonly name: string;
  /** O cliente já tem fontes conectadas? */
  isConnected(clientId: string): Promise<boolean>;
  /** Resumo do período; null quando não há dados. O clientId SEMPRE vem do escopo da sessão. */
  summary(clientId: string, period: { from: string; to: string }): Promise<TrafficSummary | null>;
}

export class NoTrafficProvider implements TrafficProvider {
  readonly name = "nenhum";
  async isConnected() {
    return false;
  }
  async summary() {
    return null;
  }
}

let provider: TrafficProvider = new NoTrafficProvider();
export const getTrafficProvider = () => provider;
/** Troca o provedor (V2 registra o Windsor.ai; testes registram um falso). */
export function setTrafficProvider(p: TrafficProvider) {
  provider = p;
}

export function totalsOf(s: TrafficSummary) {
  const spend = s.channels.reduce((t, c) => t + c.spend, 0);
  const revenue = s.channels.reduce((t, c) => t + c.revenue, 0);
  const conversions = s.channels.reduce((t, c) => t + c.conversions, 0);
  return { spend, revenue, conversions, roas: spend > 0 ? revenue / spend : null, cpa: conversions > 0 ? spend / conversions : null };
}
