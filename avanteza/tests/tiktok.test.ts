import { test } from "node:test";
import assert from "node:assert/strict";
import { ttsSign, ttsVerifyWebhook, parseTikTokBody, TikTokShopAdapter } from "../src/lib/marketplaces/tiktok/adapter";
import { shopeePushValid } from "../src/lib/marketplaces/shopee/adapter";
import { createHmac } from "node:crypto";

// Vetores gerados com a implementação de referência (pacote tiktok-shop, Common.signatureByAppSecret).
test("TikTok Shop: assinatura de requisição igual à referência (GET e POST com corpo)", () => {
  assert.equal(
    ttsSign("segredo-teste", "/product/202502/products/search", { app_key: "abc123", shop_cipher: "ROW_xyz", page_size: "100", timestamp: "1700000000" }, ""),
    "70219baee4f198b960f6f6d39fb60b99cca83c20e2e3b832473ffb22195b56aa",
  );
  assert.equal(
    ttsSign("segredo-teste", "/product/202309/products/deactivate", { app_key: "abc123", shop_cipher: "ROW_xyz", timestamp: "1700000000", access_token: "ignorado", sign: "ignorado" }, JSON.stringify({ product_ids: ["1729"] })),
    "9c91bab06d650f27d09f0e7effeb58d7cd04b56b46a5778fe80efc75961d755e",
  );
});

test("TikTok Shop: webhook assinado, IDs grandes sem perda de precisão e mapeamento", () => {
  const raw = '{"type":1,"shop_id":"7494"}';
  assert.ok(ttsVerifyWebhook("abc123", "segredo-teste", raw, "94a5e6b92e2d0c7cc89e5c1c82bb1519a15e7960a93fe5a7eabe4ba7a0d5c847"));
  assert.ok(!ttsVerifyWebhook("abc123", "segredo-teste", raw + " ", "94a5e6b92e2d0c7cc89e5c1c82bb1519a15e7960a93fe5a7eabe4ba7a0d5c847"));
  assert.ok(!ttsVerifyWebhook("abc123", "segredo-teste", raw, null));
  const body = parseTikTokBody('{"type":1,"shop_id":7494012345678901234,"data":{"order_id":576461413038785752,"order_status":"AWAITING_SHIPMENT"}}');
  const n = new TikTokShopAdapter().parseWebhook(body)!;
  assert.equal(n.externalUserId, "7494012345678901234");
  assert.equal(n.resource, "/orders/576461413038785752");
  const p = new TikTokShopAdapter().parseWebhook(parseTikTokBody('{"type":5,"shop_id":"1","data":{"product_id":"1729"}}'))!;
  assert.equal(p.topic, "items");
});

test("TikTok Shop: URL de autorização do vendedor com service_id e state", () => {
  process.env.TIKTOK_SERVICE_ID = "7123";
  process.env.TIKTOK_APP_KEY = "abc123";
  const u = new URL(new TikTokShopAdapter().buildAuthorizationUrl({ state: "ST", redirectUri: "x" }));
  assert.equal(u.origin + u.pathname, "https://services.tiktokshop.com/open/authorize");
  assert.equal(u.searchParams.get("service_id"), "7123");
  assert.equal(u.searchParams.get("state"), "ST");
});

test("Shopee: verificação do push", () => {
  const url = "https://avanteza.vercel.app/api/webhooks/shopee";
  const raw = '{"shop_id":1,"code":3,"data":{"ordersn":"X"}}';
  const sig = createHmac("sha256", "k").update(`${url}|${raw}`).digest("hex");
  assert.ok(shopeePushValid("k", url, raw, sig));
  assert.ok(!shopeePushValid("k", url, raw, "00"));
});
