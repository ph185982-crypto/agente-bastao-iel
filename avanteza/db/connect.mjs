// Conexão para os scripts de banco (apply, seed). Postgres local usa `pg`; o resto usa o driver da Neon.
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

export async function connect(url = process.env.DATABASE_URL ?? process.env.NEON_URL) {
  if (!url) throw new Error("Defina DATABASE_URL");
  if (isLocalUrl(url)) {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: url });
    return { query: (t, p) => pool.query(t, p), end: () => pool.end(), local: true };
  }
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  return { query: (t, p) => pool.query(t, p), end: () => pool.end(), local: false };
}
