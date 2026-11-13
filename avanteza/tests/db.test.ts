import { test } from "node:test";
import assert from "node:assert/strict";
import { db, __buildForTest } from "../src/lib/db/client";
import { signSession, verifySession, isAllowedAdmin } from "../src/lib/session";

test("db: select com filtros, ordem, limite e relação", () => {
  const q = __buildForTest(
    db.from("actions").select("*, clients(name, contact_phone)").eq("status", "proposed").in("client_id", ["a", "b"]).gte("created_at", "2026-11-01").order("created_at", { ascending: false }).limit(5),
  );
  assert.match(q.text, /^select t\.\*, \(select json_build_object\('name', r\."name", 'contact_phone', r\."contact_phone"\) from avanteza\."clients" r where r\.id = t\."client_id"\) as "clients" from avanteza\."actions" t where t\."status" = \$1 and t\."client_id" in \(\$2, \$3\) and t\."created_at" >= \$4 order by t\."created_at" desc limit 5$/);
  assert.deepEqual(q.values, ["proposed", "a", "b", "2026-11-01"]);
});

test("db: or() estilo PostgREST com timestamp", () => {
  const q = __buildForTest(db.from("marketplace_accounts").update({ refresh_lock_until: "X" }).eq("id", "1").or("refresh_lock_until.is.null,refresh_lock_until.lt.2026-11-13T14:00:00.123Z").select("id"));
  assert.match(q.text, /\(t\."refresh_lock_until" is null or t\."refresh_lock_until" < \$3\)/);
  assert.equal(q.values[2], "2026-11-13T14:00:00.123Z");
  assert.match(q.text, /returning t\."id"$/);
});

test("db: upsert, jsonb e text[]", () => {
  const q = __buildForTest(db.from("listings").upsert([{ account_id: "a", external_id: "MLB1", sub_status: ["out_of_stock"], raw: { x: 1 } }]));
  assert.match(q.text, /on conflict \("account_id", "external_id"\) do update set "sub_status" = excluded\."sub_status", "raw" = excluded\."raw"$/);
  const q2 = __buildForTest(db.from("alert_rules").upsert({ client_id: "c", rule_type: "x", params: {} }, { onConflict: "client_id,rule_type", ignoreDuplicates: true }));
  assert.match(q2.text, /on conflict \("client_id", "rule_type"\) do nothing$/);
  const q3 = __buildForTest(db.from("job_runs").insert({ job: "x", details: [{ ok: true }] }));
  assert.deepEqual(q.values, ["a", "MLB1", ["out_of_stock"], '{"x":1}']);
  assert.equal(q3.values[1], '[{"ok":true}]');
});

test("db: contagem e bloqueio de identificadores inválidos", () => {
  const q = __buildForTest(db.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"));
  assert.equal(q.text, 'select count(*)::int as count from avanteza."alerts" t where t."status" = $1');
  assert.throws(() => db.from("alerts; drop table x"));
  assert.throws(() => __buildForTest(db.from("alerts").eq("status = 1 or 1", 1)));
});

test("sessão: assinatura, expiração e adulteração", async () => {
  const secret = "s".repeat(40);
  const tok = await signSession("Admin@Avanteza.com.br", secret);
  assert.equal(await verifySession(tok, secret), "admin@avanteza.com.br");
  assert.equal(await verifySession(tok, "x".repeat(40)), null);
  const [p, sig] = tok.split(".");
  assert.equal(await verifySession(p + "A." + sig, secret), null);
  assert.equal(await verifySession(await signSession("a@b.c", secret, -10), secret), null);
  process.env.ADMIN_EMAILS = "admin@avanteza.com.br";
  assert.ok(isAllowedAdmin("ADMIN@avanteza.com.br"));
  assert.ok(!isAllowedAdmin("outro@x.com"));
});
