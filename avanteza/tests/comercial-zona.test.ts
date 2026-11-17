// Comercial sob a Central (F5/C6): app.avanteza.com.br/comercial/* = Vendedor IA por reescrita.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { origemVendedoria, reescritasComercial, redirecionamentosComercial, ZONA_PUBLICA, zonaComercialLigada } from "../src/lib/comercial/zona";

test("zona: reescrita para VENDEDORIA_URL, só abaixo de /comercial (a entrada /comercial é desta Central)", () => {
  assert.equal(origemVendedoria({}), "https://nexo-vendedoria.vercel.app");
  assert.equal(origemVendedoria({ VENDEDORIA_URL: "http://127.0.0.1:3200/ " }), "http://127.0.0.1:3200");
  assert.deepEqual(reescritasComercial("http://x"), [{ source: "/comercial/:path+", destination: "http://x/comercial/:path+" }]);
  // /crm/* perdido numa tela do Vendedor IA vai para a zona (redirecionamento temporário)
  assert.deepEqual(redirecionamentosComercial().map((r) => [r.source, r.destination, r.permanent]), [["/crm", "/comercial/crm", false], ["/crm/:path*", "/comercial/crm/:path*", false]]);
  const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(cfg, /reescritasComercial\(origemVendedoria\(\)\)/);
  assert.match(cfg, /afterFiles/, "afterFiles: a página /comercial da Central continua vencendo");
  assert.ok(!/\/api\/webhooks/.test(cfg), "webhooks do WhatsApp/ClickSign não passam pela Central");
});

test("zona: sem sessão da Central, só estáticos e a proposta pública passam", () => {
  const publico = (p: string) => ZONA_PUBLICA.some((r) => r.test(p));
  for (const p of ["/comercial/_next/static/chunks/a.js", "/comercial/_next/image?url=x", "/comercial/fonts/Manrope-Bold.ttf", "/comercial/icon-192.png", "/comercial/manifest.json",
    "/comercial/p/abcdefabcdefabcdefabcdefabcdefab", "/comercial/api/comercial/publico/propostas/abc"]) assert.ok(publico(p), p);
  for (const p of ["/comercial", "/comercial/oportunidades", "/comercial/api/comercial/oportunidades", "/comercial/api/graphql", "/comercial/p", "/comercial/p/x/y",
    "/comercial/api/auth/session", "/comercial/conversas", "/comercial/api/webhooks/whatsapp"]) assert.ok(!publico(p), p);
  const mw = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.match(mw, /ZONA_PUBLICA\.some/);
  assert.match(mw, /role === "client" && !isMapaPath/, "cliente do Mapa continua sem acesso à zona");
});

test("zona: apps.ts aponta o Vendedor IA para /comercial; o login único volta para a entrada da zona", async () => {
  const antes = { a: process.env.APP_VENDAS_URL, u: process.env.APP_URL, z: process.env.COMERCIAL_ZONA };
  try {
    delete process.env.APP_VENDAS_URL; delete process.env.COMERCIAL_ZONA; process.env.APP_URL = "https://app.avanteza.com.br";
    const { getApp } = await import("../src/lib/apps");
    assert.equal(getApp("vendas")!.url, "https://app.avanteza.com.br/comercial");
    assert.equal(new URL(getApp("vendas")!.url + getApp("vendas")!.callback).pathname, "/comercial/api/sso/callback");
    process.env.COMERCIAL_ZONA = "0";
    assert.equal(zonaComercialLigada(), false);
    assert.equal(getApp("vendas")!.url, "https://nexo-vendedoria.vercel.app");
    process.env.APP_VENDAS_URL = "https://outro.exemplo";
    assert.equal(getApp("vendas")!.url, "https://outro.exemplo", "APP_VENDAS_URL ainda vence");
  } finally {
    for (const [k, v] of [["APP_VENDAS_URL", antes.a], ["APP_URL", antes.u], ["COMERCIAL_ZONA", antes.z]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const rota = readFileSync(new URL("../src/app/sso/authorize/route.ts", import.meta.url), "utf8");
  assert.match(rota, /ret === "\/" && base \? base : ret/, "sem destino: volta para /comercial, não para / da Central");
});
