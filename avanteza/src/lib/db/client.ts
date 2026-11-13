// Camada de dados sobre Postgres (Neon, via HTTP). Expõe o mesmo subconjunto de API de consulta que o
// restante do código usa (from/select/insert/update/upsert/delete + filtros), sempre com parâmetros
// ($1, $2…) — nunca concatenando valores no SQL. Só roda no servidor.
import { neon, types as pgTypes } from "@neondatabase/serverless";

const SCHEMA = "avanteza";
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Identificador inválido: ${name}`);
  return `"${name}"`;
}

// Parsers: numeric/bigint → number; datas → string ISO (mesmo formato que o PostgREST devolvia).
const NUMERIC = 1700, INT8 = 20, DATE = 1082, TIMESTAMPTZ = 1184, TIMESTAMP = 1114;
const toIso = (v: string) => {
  const s = v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};
const types = {
  getTypeParser(oid: number, format?: any) {
    if (oid === NUMERIC || oid === INT8) return (v: string) => (v === null ? null : Number(v));
    if (oid === DATE) return (v: string) => v;
    if (oid === TIMESTAMPTZ || oid === TIMESTAMP) return (v: string) => (v === null ? null : toIso(v));
    return (pgTypes as any).getTypeParser(oid, format); // bool, int4, jsonb, text[]… (padrão do driver)
  },
};

type Row = Record<string, any>;

/** Chave primária de cada tabela (alvo padrão do upsert, como no PostgREST). */
const PRIMARY_KEYS: Record<string, string[]> = {
  admins: ["email"],
  oauth_states: ["state"],
  listings: ["account_id", "external_id"],
  listing_snapshots: ["account_id", "external_id", "snapshot_date"],
  orders: ["account_id", "external_id"],
  questions: ["account_id", "external_id"],
  ads_campaigns: ["account_id", "external_id"],
  daily_snapshots: ["account_id", "snapshot_date"],
};
export interface DbResult<D = any> {
  data: D;
  error: { message: string; code?: string } | null;
  count: number | null;
}

let sqlFn: ReturnType<typeof neon> | null = null;
function sql() {
  if (!sqlFn) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL não configurada");
    sqlFn = neon(url);
  }
  return sqlFn;
}

export async function rawQuery<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params as any[], { types } as any)) as T[];
}

/** Serializa valores: objetos e listas de objetos → JSON (jsonb); listas de textos → array do Postgres (text[]). */
function val(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.some((x) => x !== null && typeof x === "object") ? JSON.stringify(v) : v;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

type Filter = { sql: (p: Params) => string };
class Params {
  values: unknown[] = [];
  add(v: unknown) {
    this.values.push(val(v));
    return `$${this.values.length}`;
  }
}

/** "*, clients(name, contact_phone)" → colunas + subconsultas de relação (muitos-para-um). */
function parseSelect(sel: string, alias: string): string {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts
    .map((p) => {
      if (p === "*") return `${alias}.*`;
      const m = p.match(/^([a-z_]+)\(([^)]*)\)$/);
      if (m) {
        const rel = m[1];
        const fk = rel.replace(/s$/, "") + "_id";
        const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean);
        const obj = cols.map((c) => `'${c}', r.${ident(c)}`).join(", ");
        return `(select json_build_object(${obj}) from ${SCHEMA}.${ident(rel)} r where r.id = ${alias}.${ident(fk)}) as ${ident(rel)}`;
      }
      return `${alias}.${ident(p)}`;
    })
    .join(", ");
}

class Query<D = any[] | null> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private returning: string | null = null;
  private countMode = false;
  private head = false;
  private rows: Row[] = [];
  private patch: Row = {};
  private conflict: string | null = null;
  private ignoreDup = false;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private table: string) {
    ident(table);
  }

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.op === "select") {
      this.columns = cols;
      this.countMode = opts?.count === "exact";
      this.head = Boolean(opts?.head);
    } else this.returning = cols;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.conflict = opts?.onConflict ?? null;
    this.ignoreDup = Boolean(opts?.ignoreDuplicates);
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  private col(c: string) {
    return `t.${ident(c)}`;
  }
  eq(c: string, v: unknown) {
    this.filters.push({ sql: (p) => (v === null ? `${this.col(c)} is null` : `${this.col(c)} = ${p.add(v)}`) });
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push({ sql: (p) => `${this.col(c)} is distinct from ${p.add(v)}` });
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push({ sql: (p) => `${this.col(c)} > ${p.add(v)}` });
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push({ sql: (p) => `${this.col(c)} >= ${p.add(v)}` });
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push({ sql: (p) => `${this.col(c)} < ${p.add(v)}` });
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push({ sql: (p) => `${this.col(c)} <= ${p.add(v)}` });
    return this;
  }
  is(c: string, v: null | boolean) {
    this.filters.push({ sql: () => `${this.col(c)} is ${v === null ? "null" : v ? "true" : "false"}` });
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push({
      sql: (p) => (vs.length ? `${this.col(c)} in (${vs.map((v) => p.add(v)).join(", ")})` : "false"),
    });
    return this;
  }
  /** Subconjunto do formato PostgREST: "a.is.null,a.lt.VALOR,b.eq.VALOR". */
  or(expr: string) {
    const conds = expr.split(",").map((part) => {
      const [c, op, ...rest] = part.split(".");
      const v = rest.join(".");
      return { c, op, v };
    });
    this.filters.push({
      sql: (p) =>
        "(" +
        conds
          .map(({ c, op, v }) => {
            const col = this.col(c);
            if (op === "is") return `${col} is ${v === "null" ? "null" : v === "true" ? "true" : "false"}`;
            const ops: Record<string, string> = { eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };
            if (!ops[op]) throw new Error(`Operador não suportado em or(): ${op}`);
            return `${col} ${ops[op]} ${p.add(v)}`;
          })
          .join(" or ") +
        ")",
    });
    return this;
  }
  order(c: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? "desc" : "asc";
    const nulls = opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`${this.col(c)} ${dir}${nulls}`);
    return this;
  }
  limit(n: number) {
    this.lim = Math.max(0, Math.floor(n));
    return this;
  }
  single(): Query<any> {
    this.mode = "single";
    return this as unknown as Query<any>;
  }
  maybeSingle(): Query<any> {
    this.mode = "maybe";
    return this as unknown as Query<any>;
  }

  private where(p: Params) {
    return this.filters.length ? " where " + this.filters.map((f) => f.sql(p)).join(" and ") : "";
  }

  private build(): { text: string; values: unknown[]; isCount?: boolean } {
    const p = new Params();
    const tbl = `${SCHEMA}.${ident(this.table)}`;
    const ret = this.returning ? ` returning ${parseSelect(this.returning, "t")}` : "";
    switch (this.op) {
      case "select": {
        if (this.head && this.countMode) {
          return { text: `select count(*)::int as count from ${tbl} t${this.where(p)}`, values: p.values, isCount: true };
        }
        let text = `select ${parseSelect(this.columns, "t")} from ${tbl} t${this.where(p)}`;
        if (this.orders.length) text += ` order by ${this.orders.join(", ")}`;
        const lim = this.mode === "many" ? this.lim : this.lim ?? 2;
        if (lim !== null) text += ` limit ${lim}`;
        return { text, values: p.values };
      }
      case "insert":
      case "upsert": {
        if (!this.rows.length) return { text: "select 1 where false", values: [] };
        const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
        const vals = this.rows
          .map((r) => "(" + cols.map((c) => (c in r ? p.add(r[c]) : "default")).join(", ") + ")")
          .join(", ");
        let text = `insert into ${tbl} as t (${cols.map(ident).join(", ")}) values ${vals}`;
        if (this.op === "upsert") {
          const target = (this.conflict ? this.conflict.split(",").map((c) => c.trim()) : PRIMARY_KEYS[this.table] ?? ["id"]).map(ident);
          if (this.ignoreDup) text += ` on conflict (${target.join(", ")}) do nothing`;
          else {
            const upd = cols.filter((c) => !target.includes(ident(c)));
            text += upd.length
              ? ` on conflict (${target.join(", ")}) do update set ${upd.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`
              : ` on conflict (${target.join(", ")}) do nothing`;
          }
        }
        return { text: text + ret, values: p.values };
      }
      case "update": {
        const sets = Object.entries(this.patch)
          .filter(([, v]) => v !== undefined)
          .map(([c, v]) => `${ident(c)} = ${p.add(v)}`);
        if (!sets.length) return { text: "select 1 where false", values: [] };
        return { text: `update ${tbl} as t set ${sets.join(", ")}${this.where(p)}${ret}`, values: p.values };
      }
      case "delete":
        return { text: `delete from ${tbl} as t${this.where(p)}${ret}`, values: p.values };
    }
  }

  async run(): Promise<DbResult<D>> {
    try {
      const q = this.build();
      const rows = await rawQuery(q.text, q.values);
      if (q.isCount) return { data: null as D, error: null, count: Number(rows[0]?.count ?? 0) };
      const hasRows = this.op === "select" || this.returning !== null;
      if (this.mode === "single") {
        if (rows.length !== 1) return { data: null as D, error: { message: rows.length ? "Mais de uma linha" : "Nenhuma linha", code: "PGRST116" }, count: null };
        return { data: rows[0] as D, error: null, count: null };
      }
      if (this.mode === "maybe") {
        if (rows.length > 1) return { data: null as D, error: { message: "Mais de uma linha" }, count: null };
        return { data: (rows[0] ?? null) as D, error: null, count: null };
      }
      return { data: (hasRows ? rows : null) as D, error: null, count: this.countMode ? rows.length : null };
    } catch (err: any) {
      return { data: null as D, error: { message: err?.message ?? String(err), code: err?.code }, count: null };
    }
  }

  then(onfulfilled?: (value: DbResult<D>) => any, onrejected?: (reason: any) => any): Promise<any> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export interface Db {
  from(table: string): Query<any[] | null>;
}

export const db: Db = { from: (table: string) => new Query<any[] | null>(table) };

/** Para testes: gera o SQL sem executar. */
export function __buildForTest(q: Query<any>) {
  return (q as any).build() as { text: string; values: unknown[] };
}
