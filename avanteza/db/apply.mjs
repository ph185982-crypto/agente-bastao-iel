// Aplica db/schema.sql no banco apontado por DATABASE_URL (ou NEON_URL). Uso: node db/apply.mjs
// Idempotente. Para um Postgres local descartável: DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev
import { readFileSync } from "node:fs";
import { connect } from "./connect.mjs";

const db = await connect();
const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
await db.query(sql);
const { rows } = await db.query("select count(*)::int n from information_schema.tables where table_schema = 'avanteza'");
console.log(`schema aplicado: ${rows[0].n} tabelas`);
await db.end();
