// Aplica db/schema.sql no banco apontado por DATABASE_URL (ou NEON_URL). Uso: node db/apply.mjs
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL ?? process.env.NEON_URL;
if (!url) throw new Error("Defina DATABASE_URL");
const pool = new Pool({ connectionString: url });
const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
await pool.query(sql);
const { rows } = await pool.query("select count(*)::int n from information_schema.tables where table_schema = 'avanteza'");
console.log(`schema aplicado: ${rows[0].n} tabelas`);
await pool.end();
