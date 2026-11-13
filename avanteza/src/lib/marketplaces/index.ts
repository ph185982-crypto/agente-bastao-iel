import type { MarketplaceAdapter, MarketplaceId } from "./types";
import { MercadoLivreAdapter } from "./mercadolivre/adapter";

const registry: Partial<Record<MarketplaceId, () => MarketplaceAdapter>> = {
  mercadolivre: () => new MercadoLivreAdapter(),
  // shopee: () => new ShopeeAdapter(),  ← Fase 3: implementar a mesma interface.
};

export function getAdapter(id: string): MarketplaceAdapter {
  const factory = registry[id as MarketplaceId];
  if (!factory) throw new Error(`Marketplace não suportado ainda: ${id}`);
  return factory();
}

export const MARKETPLACE_LABEL: Record<MarketplaceId, string> = {
  mercadolivre: "Mercado Livre",
  shopee: "Shopee",
};
