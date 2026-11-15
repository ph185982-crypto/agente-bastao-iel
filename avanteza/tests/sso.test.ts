import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
process.env.SSO_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const require = createRequire(import.meta.url);
const kit = require("../../packages/avanteza-kit/avanteza-sso.js");

test("login único: token emitido pela Central é aceito só pelo aplicativo de destino", async () => {
  const { issueToken, publicJwk, safePath } = await import("../src/lib/sso");
  const sess = { email: "Pedro@Avanteza.com.br".toLowerCase(), role: "admin" as const, apps: [], name: "Pedro" };
  const keys = [publicJwk()];
  const token = issueToken(sess, "crm", "/funil?x=1");
  const u = await kit.verifyAvantezaToken(token, { audience: "crm", keys });
  assert.deepEqual({ email: u.email, name: u.name, role: u.role, returnTo: u.returnTo }, { email: "pedro@avanteza.com.br", name: "Pedro", role: "admin", returnTo: "/funil?x=1" });
  await assert.rejects(kit.verifyAvantezaToken(token, { audience: "vendas", keys }), /outro aplicativo/);
  // adulteração do conteúdo
  const [h, p, s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "intruso@x.com" })).toString("base64url");
  await assert.rejects(kit.verifyAvantezaToken(`${h}.${forged}.${s}`, { audience: "crm", keys }), /assinatura inválida/);
  // chave de outro emissor
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  await assert.rejects(kit.verifyAvantezaToken(token, { audience: "crm", keys: [{ ...other, kid: keys[0].kid }] }), /assinatura inválida/);
  // alg none / malformado
  const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p}.`;
  await assert.rejects(kit.verifyAvantezaToken(none, { audience: "crm", keys }), /algoritmo/);
  assert.equal(safePath("//evil.com"), "/");
  assert.equal(safePath("https://evil.com"), "/");
  assert.equal(safePath("/ok"), "/ok");
});

test("permissões por aplicativo", async () => {
  const { canUseApp } = await import("../src/lib/session");
  process.env.ADMIN_EMAILS = "pedro@avanteza.com.br";
  const s = (role: any, apps: string[] = [], email = "pedro@avanteza.com.br") => ({ email, role, apps, name: "" });
  assert.ok(canUseApp(s("admin"), "crm"));
  assert.ok(!canUseApp(s("admin", [], "x@y.com"), "crm"));
  assert.ok(canUseApp(s("member", ["crm"], "ana@avanteza.com.br"), "crm"));
  assert.ok(!canUseApp(s("member", ["crm"], "ana@avanteza.com.br"), "vendas"));
  assert.ok(canUseApp(s("reviewer", [], "r@x.com"), "marketplaces"));
  assert.ok(!canUseApp(s("reviewer", [], "r@x.com"), "crm"));
});
