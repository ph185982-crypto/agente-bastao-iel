// Regras comuns de variação (ML), modelo (Shopee) e SKU (TikTok Shop).
import type { Variation } from "./types";

/** Estado "antes" de uma ação, já focado na variação pedida (para limites diários e auditoria). */
export function stateWithVariation(
  base: { id: string; title: string; status: string; price: number | null; available_quantity: number | null },
  variations: Variation[],
  variationId?: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, has_variations: variations.length > 1 };
  if (variations.length) out.variations = variations.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock }));
  if (variationId) {
    const v = variations.find((x) => x.id === String(variationId));
    if (!v) throw new Error(`Variação ${String(variationId)} não encontrada no anúncio ${base.id}.`);
    out.variation_id = v.id;
    out.variation_name = v.name;
    out.price = v.price;
    out.available_quantity = v.stock;
  }
  return out;
}

/** Estoque precisa de uma variação definida quando há mais de uma. */
export function stockTarget(variations: Variation[], variationId?: unknown): Variation | null {
  if (variations.length === 0) return null;
  if (variationId) {
    const v = variations.find((x) => x.id === String(variationId));
    if (!v) throw new Error(`Variação ${String(variationId)} não encontrada.`);
    return v;
  }
  if (variations.length === 1) return variations[0];
  throw new Error("Anúncio com várias variações: informe qual variação (ID) terá o estoque alterado.");
}
