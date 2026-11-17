// Cache compartilhado dos dashboards no Postgres local de teste (TEST_DATABASE_URL). Sem a variável, é ignorado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HAS_DB, resetSchema, closeDb } from "./_mapa-fixtures";

test("cache no Postgres: grava, lê de outra 'instância' (sem memória), atualiza e tolera tabela ausente", { skip: !HAS_DB && "defina TEST_DATABASE_URL" }, async () => {
  await resetSchema();
  const { cacheCompartilhado, limparMemoria } = await import("../src/lib/dashboards/cache");
  const { rawQuery } = await import("../src/lib/db/client");
  try {
    const em = Date.now();
    await cacheCompartilhado.set("meta:teste", { gasto: 12.5, contas: ["a"] }, em);
    limparMemoria(); // outra instância serverless não tem a memória da primeira
    const lido = await cacheCompartilhado.get("meta:teste");
    assert.deepEqual(lido?.valor, { gasto: 12.5, contas: ["a"] });
    assert.equal(lido?.em, em);
    await rawQuery("delete from avanteza.dashboard_cache");
    await cacheCompartilhado.set("meta:teste2", { n: 1 }, em);
    await cacheCompartilhado.set("meta:teste2", { n: 2 }, em + 1000);
    const n = await rawQuery<{ c: string }>("select count(*) c from avanteza.dashboard_cache where key = 'meta:teste2'");
    assert.equal(Number(n[0].c), 1, "upsert, não duplica");
    await rawQuery("drop table avanteza.dashboard_cache");
    assert.equal(await cacheCompartilhado.get("meta:nao-existe"), null, "sem tabela vira 'sem cache'");
    await cacheCompartilhado.set("meta:x", { ok: true }, em); // não lança
  } finally { await closeDb(); }
});
