// Banco DESCARTÁVEL para os testes do Mapa. Só roda em Postgres local cujo nome contém "test".
// Uso: TEST_DATABASE_URL=postgres://postgres@localhost:54329/mapa_test npm test
import { readFileSync } from "node:fs";
import { rawQuery, closeLocalPool } from "../src/lib/db/client";
import bcrypt from "bcryptjs";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "";
export const HAS_DB = Boolean(TEST_URL);

export function usePostgres() {
  const u = new URL(TEST_URL);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !/test/i.test(u.pathname)) throw new Error("TEST_DATABASE_URL precisa ser um Postgres local de teste (nome com 'test')");
  process.env.DATABASE_URL = TEST_URL;
}

export async function resetSchema() {
  usePostgres();
  await rawQuery("drop schema if exists avanteza cascade");
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
}
export const closeDb = closeLocalPool;

export async function mkClient(name: string, o: { kind?: string; slug?: string; group?: string; start?: string; active?: boolean } = {}) {
  const [r] = await rawQuery<{ id: string }>(
    "insert into avanteza.clients (name, slug, kind, group_slug, start_date, active) values ($1,$2,$3,$4,$5,$6) returning id",
    [name, o.slug ?? name.toLowerCase().replace(/\W+/g, "-"), o.kind ?? "marketplace", o.group ?? null, o.start ?? "2026-01-15", o.active ?? true],
  );
  return r.id;
}

export async function mkUser(email: string, clientId: string, o: { password?: string; extra?: string[]; active?: boolean } = {}) {
  await rawQuery("insert into avanteza.admins (email, role, client_id, password_hash, active, apps) values ($1,'client',$2,$3,$4,'{}')", [email, clientId, await bcrypt.hash(o.password ?? "senha-de-teste-123", 4), o.active ?? true]);
  for (const id of [clientId, ...(o.extra ?? [])]) await rawQuery("insert into avanteza.client_user_clients (user_email, client_id) values ($1,$2) on conflict do nothing", [email, id]);
}

/** Dados de cada tipo para um cliente: ação, reunião, arquivo (visível e oculto), conta de marketplace com snapshot, alerta. */
export async function mkData(clientId: string, tag: string) {
  const [phase] = await rawQuery<{ id: string }>("insert into avanteza.plan_phases (client_id, position, name, start_month, end_month, starts_on, ends_on) values ($1,1,$2,1,2,'2026-01-15','2026-03-14') returning id", [clientId, `Fase ${tag}`]);
  const [action] = await rawQuery<{ id: string }>("insert into avanteza.plan_actions (client_id, phase_id, title, owner, due_date) values ($1,$2,$3,'cliente','2026-02-01') returning id", [clientId, phase.id, `Ação ${tag}`]);
  const [action2] = await rawQuery<{ id: string }>("insert into avanteza.plan_actions (client_id, phase_id, title, owner, due_date) values ($1,$2,$3,'avanteza','2026-02-02') returning id", [clientId, phase.id, `Ação Avanteza ${tag}`]);
  const [meeting] = await rawQuery<{ id: string }>("insert into avanteza.meetings (client_id, title, held_at, summary, transcript_text, status) values ($1,$2,'2026-02-01T15:00:00Z',$3,$4,'analisada') returning id", [clientId, `Reunião ${tag}`, `Resumo ${tag}`, `SEGREDO-TRANSCRICAO-${tag}`]);
  await rawQuery("update avanteza.plan_actions set meeting_id = $1, origin = 'reuniao' where id = $2", [meeting.id, action2.id]);
  const [file] = await rawQuery<{ id: string }>("insert into avanteza.client_files (client_id, title, url, visible) values ($1,$2,'https://x.test/a',true) returning id", [clientId, `Arquivo ${tag}`]);
  const [hidden] = await rawQuery<{ id: string }>("insert into avanteza.client_files (client_id, title, url, visible) values ($1,$2,'https://x.test/b',false) returning id", [clientId, `Oculto ${tag}`]);
  const [acc] = await rawQuery<{ id: string }>("insert into avanteza.marketplace_accounts (client_id, marketplace, external_user_id, nickname, access_token_enc, refresh_token_enc) values ($1,'mercadolivre',$2,$3,'TOKEN-SECRETO','REFRESH-SECRETO') returning id", [clientId, `u-${tag}`, `Loja ${tag}`]);
  await rawQuery("insert into avanteza.daily_snapshots (account_id, snapshot_date, revenue, orders_count, ads_cost, ads_revenue) values ($1,$2,1000,10,100,500)", [acc.id, new Date().toISOString().slice(0, 10)]);
  await rawQuery("insert into avanteza.listings (account_id, external_id, title, status) values ($1,$2,$3,'active')", [acc.id, `MLB-${tag}`, `Anúncio ${tag}`]);
  await rawQuery("insert into avanteza.alerts (client_id, rule_type, title, dedup_key) values ($1,'x',$2,$3)", [clientId, `Alerta ${tag}`, `d-${tag}`]);
  return { phase: phase.id, action: action.id, action2: action2.id, meeting: meeting.id, file: file.id, hidden: hidden.id, account: acc.id };
}
