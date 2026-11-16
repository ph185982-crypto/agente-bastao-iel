// Indicadores de marketplace a partir dos snapshots diários que o coletor já grava (daily_snapshots).
export interface SnapRow {
  snapshot_date: string;
  revenue: number | null;
  orders_count: number | null;
  units_sold: number | null;
  visits: number | null;
  ads_cost: number | null;
  ads_revenue: number | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export function sumPeriod(rows: SnapRow[], from: string, to: string) {
  const r = rows.filter((x) => x.snapshot_date >= from && x.snapshot_date <= to);
  const revenue = r.reduce((t, x) => t + n(x.revenue), 0);
  const orders = r.reduce((t, x) => t + n(x.orders_count), 0);
  const adsCost = r.reduce((t, x) => t + n(x.ads_cost), 0);
  const adsRevenue = r.reduce((t, x) => t + n(x.ads_revenue), 0);
  const visits = r.reduce((t, x) => t + n(x.visits), 0);
  return {
    revenue,
    orders,
    adsCost,
    adsRevenue,
    visits,
    ticket: orders > 0 ? revenue / orders : null,
    roas: adsCost > 0 ? adsRevenue / adsCost : null,
  };
}

export const variation = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
