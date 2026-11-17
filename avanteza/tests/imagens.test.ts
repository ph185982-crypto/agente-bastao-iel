// Fotos dos anúncios: sanitização de URL e mapeamento pelos três adaptadores (sem chamada extra de API).
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeImageUrl, firstImage, imageList } from "../src/lib/marketplaces/images";
import { MercadoLivreAdapter } from "../src/lib/marketplaces/mercadolivre/adapter";
import { ShopeeAdapter } from "../src/lib/marketplaces/shopee/adapter";
import { TikTokShopAdapter } from "../src/lib/marketplaces/tiktok/adapter";

test("safeImageUrl: só http/https; http vira https; lixo e esquemas perigosos viram null", () => {
  assert.equal(safeImageUrl("http://http2.mlstatic.com/D_1-I.jpg"), "https://http2.mlstatic.com/D_1-I.jpg");
  assert.equal(safeImageUrl("https://down-br.img.susercontent.com/file/abc"), "https://down-br.img.susercontent.com/file/abc");
  assert.equal(safeImageUrl("//p16-oec-sg.ibyteimg.com/x.jpeg"), "https://p16-oec-sg.ibyteimg.com/x.jpeg");
  assert.equal(safeImageUrl("  https://a.b/c.jpg  "), "https://a.b/c.jpg");
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://a.b/x.jpg", "file:///etc/passwd", "https://u:p@a.b/x.jpg", "nao é url", "", "https://a.b/x\"onerror=1", "https://a.b/" + "x".repeat(3000), null, undefined, 42, {}]) {
    assert.equal(safeImageUrl(bad), null, String(bad));
  }
});

test("firstImage e imageList: primeira válida, sem repetição, limite", () => {
  assert.equal(firstImage(null, "javascript:x", "http://a.b/1.jpg"), "https://a.b/1.jpg");
  assert.equal(firstImage(), null);
  assert.deepEqual(imageList(["http://a.b/1.jpg", "https://a.b/1.jpg", "x:y", "https://a.b/2.jpg"]), ["https://a.b/1.jpg", "https://a.b/2.jpg"]);
  assert.equal(imageList(Array.from({ length: 20 }, (_, i) => `https://a.b/${i}.jpg`)).length, 6);
});

function stubFetch(handler: (url: string) => unknown) {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(handler(url)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = real; } };
}

test("Mercado Livre: multiget pede thumbnail/secure_thumbnail/pictures numa única chamada e mapeia a foto", async () => {
  const f = stubFetch(() => [
    { code: 200, body: { id: "MLB1", title: "A", status: "active", thumbnail: "http://http2.mlstatic.com/D_1-I.jpg", secure_thumbnail: "https://http2.mlstatic.com/D_1-I.jpg", pictures: [{ secure_url: "https://http2.mlstatic.com/D_1-O.jpg" }, { url: "http://http2.mlstatic.com/D_1b-O.jpg" }, { secure_url: "javascript:1" }] } },
    { code: 200, body: { id: "MLB2", title: "B", status: "active", thumbnail: "http://http2.mlstatic.com/D_2-I.jpg" } },
    { code: 200, body: { id: "MLB3", title: "C", status: "active", pictures: [{ secure_url: "https://http2.mlstatic.com/D_3-O.jpg" }] } },
    { code: 200, body: { id: "MLB4", title: "D", status: "active", thumbnail: "" } },
  ]);
  try {
    const l = await new MercadoLivreAdapter().getListings("t", ["MLB1", "MLB2", "MLB3", "MLB4"]);
    assert.equal(f.urls.length, 1, "sem chamada extra por foto");
    assert.match(decodeURIComponent(f.urls[0]), /attributes=.*secure_thumbnail,pictures/);
    assert.equal(l[0].thumbnail, "https://http2.mlstatic.com/D_1-I.jpg");
    assert.deepEqual(l[0].imageUrls, ["https://http2.mlstatic.com/D_1-O.jpg", "https://http2.mlstatic.com/D_1b-O.jpg"]);
    assert.equal(l[1].thumbnail, "https://http2.mlstatic.com/D_2-I.jpg", "http vira https");
    assert.deepEqual(l[1].imageUrls, []);
    assert.equal(l[2].thumbnail, "https://http2.mlstatic.com/D_3-O.jpg", "sem thumbnail, cai para a 1ª foto");
    assert.equal(l[3].thumbnail, null);
  } finally { f.restore(); }
});

test("Shopee: get_item_base_info → image.image_url_list vira miniatura e fotos (sem chamada extra)", async () => {
  process.env.SHOPEE_PARTNER_ID = "123"; process.env.SHOPEE_PARTNER_KEY = "chave";
  const f = stubFetch(() => ({ response: { item_list: [
    { item_id: 11, item_name: "Tênis", item_status: "NORMAL", image: { image_url_list: ["https://down-br.img.susercontent.com/file/a", "http://down-br.img.susercontent.com/file/b"] } },
    { item_id: 12, item_name: "Sem foto", item_status: "UNLIST" },
    { item_id: 13, item_name: "Foto ruim", item_status: "NORMAL", image: { image_url_list: ["javascript:alert(1)"] } },
  ] } }));
  try {
    const l = await new ShopeeAdapter().getListings("tok|9", ["11", "12", "13"]);
    assert.equal(f.urls.length, 1);
    assert.equal(l[0].thumbnail, "https://down-br.img.susercontent.com/file/a");
    assert.deepEqual(l[0].imageUrls, ["https://down-br.img.susercontent.com/file/a", "https://down-br.img.susercontent.com/file/b"]);
    assert.equal(l[1].thumbnail, null); assert.deepEqual(l[1].imageUrls, []);
    assert.equal(l[2].thumbnail, null);
  } finally { f.restore(); }
});

test("TikTok Shop: main_images[].thumb_urls/urls viram miniatura e fotos", async () => {
  process.env.TIKTOK_APP_KEY = "abc123"; process.env.TIKTOK_APP_SECRET = "segredo";
  const products: Record<string, any> = {
    "1": { id: "1", title: "Bolsa", status: "ACTIVATE", skus: [], main_images: [{ urls: ["https://p16-oec-sg.ibyteimg.com/full1.jpeg"], thumb_urls: ["https://p16-oec-sg.ibyteimg.com/thumb1.jpeg"] }, { urls: ["http://p16-oec-sg.ibyteimg.com/full2.jpeg"] }] },
    "2": { id: "2", title: "Só urls", status: "ACTIVATE", skus: [], main_images: [{ urls: ["//p16-oec-sg.ibyteimg.com/only.jpeg"] }] },
    "3": { id: "3", title: "Sem imagem", status: "ACTIVATE", skus: [] },
  };
  const f = stubFetch((url) => ({ code: 0, data: products[new URL(url).pathname.split("/").pop()!] }));
  try {
    const l = await new TikTokShopAdapter().getListings("tok|cipher", ["1", "2", "3"]);
    assert.equal(f.urls.length, 3, "uma chamada por produto, como antes");
    assert.equal(l[0].thumbnail, "https://p16-oec-sg.ibyteimg.com/thumb1.jpeg");
    assert.deepEqual(l[0].imageUrls, ["https://p16-oec-sg.ibyteimg.com/full1.jpeg", "https://p16-oec-sg.ibyteimg.com/full2.jpeg"]);
    assert.equal(l[1].thumbnail, "https://p16-oec-sg.ibyteimg.com/only.jpeg");
    assert.equal(l[2].thumbnail, null); assert.deepEqual(l[2].imageUrls, []);
  } finally { f.restore(); }
});
