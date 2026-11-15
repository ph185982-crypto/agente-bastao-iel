import type { MarketplaceAdapter, MarketplaceId } from "./types";
import { MercadoLivreAdapter } from "./mercadolivre/adapter";
import { ShopeeAdapter } from "./shopee/adapter";
import { TikTokShopAdapter, tiktokConfigured } from "./tiktok/adapter";

const registry: Partial<Record<MarketplaceId, () => MarketplaceAdapter>> = {
  mercadolivre: () => new MercadoLivreAdapter(),
  shopee: () => new ShopeeAdapter(),
  tiktok: () => new TikTokShopAdapter(),
};

export function getAdapter(id: string): MarketplaceAdapter {
  const factory = registry[id as MarketplaceId];
  if (!factory) throw new Error(`Marketplace não suportado ainda: ${id}`);
  return factory();
}

export const MARKETPLACE_LABEL: Record<MarketplaceId, string> = {
  mercadolivre: "Mercado Livre",
  shopee: "Shopee",
  tiktok: "TikTok Shop",
};

/** Marketplaces com credenciais configuradas (para exibir os botões de conexão). */
export function enabledMarketplaces(): MarketplaceId[] {
  const out: MarketplaceId[] = ["mercadolivre"];
  if (process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY) out.push("shopee");
  if (tiktokConfigured()) out.push("tiktok");
  return out;
}
