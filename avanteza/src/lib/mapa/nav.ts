// Menu do Mapa por tipo de cliente: marketplace, midia ou ambos (união).
export function navFor(kind: string) {
  const items = [{ href: "/mapa", label: "Início" }, { href: "/mapa/plano", label: "Plano" }];
  if (kind === "marketplace" || kind === "ambos") items.push({ href: "/mapa/marketplaces", label: "Marketplaces" });
  if (kind === "midia" || kind === "ambos") items.push({ href: "/mapa/canais", label: "Canais" });
  items.push({ href: "/mapa/reunioes", label: "Reuniões" }, { href: "/mapa/arquivos", label: "Arquivos" }, { href: "/mapa/conta", label: "Conta" });
  return items;
}

/** Módulos que o tipo de cliente enxerga (usado também para bloquear páginas de outro tipo). */
export const hasMarketplaces = (kind: string) => kind === "marketplace" || kind === "ambos";
export const hasChannels = (kind: string) => kind === "midia" || kind === "ambos";
