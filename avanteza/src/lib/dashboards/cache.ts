// Cache dos dashboards: memória da instância (camada rápida) + tabela avanteza.dashboard_cache no Postgres/Neon (compartilhada
// entre as instâncias serverless da Vercel). Qualquer falha do banco é ignorada: sem cache o painel só chama a fonte de novo.
// Em erro da fonte, devolve o último valor guardado (mesmo vencido) marcado como `desatualizado`.
import { rawQuery } from "@/lib/db/client";

export interface CacheStore {
  get(key: string): Promise<{ valor: unknown; em: number } | null>;
  set(key: string, valor: unknown, em: number): Promise<void>;
}

const memoria = new Map<string, { valor: unknown; em: number }>();
const MAX_ENTRADAS = 200;

export const cacheMemoria: CacheStore = {
  async get(key) { return memoria.get(key) ?? null; },
  async set(key, valor, em) {
    if (memoria.size >= MAX_ENTRADAS) memoria.delete(memoria.keys().next().value as string);
    memoria.set(key, { valor, em });
  },
};

/** Esvazia a memória da instância (testes; simula outra instância serverless). */
export function limparMemoria() { memoria.clear(); }

/** Memória + Postgres. O banco é opcional: erro ou tabela ausente vira "sem cache", nunca quebra o painel. */
export const cacheCompartilhado: CacheStore = {
  async get(key) {
    const m = await cacheMemoria.get(key);
    if (m) return m;
    try {
      const rows = await rawQuery<{ payload: unknown; fetched_ms: string | number }>(
        "select payload, (extract(epoch from fetched_at) * 1000)::bigint as fetched_ms from avanteza.dashboard_cache where key = $1",
        [key],
      );
      if (!rows[0]) return null;
      const v = { valor: rows[0].payload, em: Number(rows[0].fetched_ms) };
      await cacheMemoria.set(key, v.valor, v.em);
      return v;
    } catch { return null; }
  },
  async set(key, valor, em) {
    await cacheMemoria.set(key, valor, em);
    try {
      await rawQuery(
        "insert into avanteza.dashboard_cache (key, payload, fetched_at) values ($1, $2::jsonb, to_timestamp($3 / 1000.0)) on conflict (key) do update set payload = excluded.payload, fetched_at = excluded.fetched_at",
        [key, JSON.stringify(valor), em],
      );
    } catch { /* sem tabela/banco: segue só com a memória */ }
  },
};

export interface ResultadoCache<T> { valor: T; geradoEm: number; desatualizado: boolean }

/** Devolve o valor se tiver menos de `ttlMs`; senão calcula e guarda. Se calcular falhar, usa o guardado (vencido) ou repassa o erro. */
export async function comCache<T>(
  store: CacheStore, key: string, ttlMs: number, calcular: () => Promise<T>, agora: () => number = Date.now,
): Promise<ResultadoCache<T>> {
  const guardado = await store.get(key).catch(() => null);
  if (guardado && agora() - guardado.em < ttlMs) return { valor: guardado.valor as T, geradoEm: guardado.em, desatualizado: false };
  try {
    const valor = await calcular();
    const em = agora();
    await store.set(key, valor, em).catch(() => undefined);
    return { valor, geradoEm: em, desatualizado: false };
  } catch (e) {
    if (guardado) return { valor: guardado.valor as T, geradoEm: guardado.em, desatualizado: true };
    throw e;
  }
}
