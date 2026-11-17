// Adapter do TikTok Shop (Open API, versões 202309/202502/202507).
// Caminhos, campos e assinatura conferidos no cliente gerado a partir da especificação oficial
// (pacote "tiktok-shop-api"): assinatura = HMAC-SHA256(app_secret, app_secret + path + pares
// key+value ordenados (sem sign e access_token) + body + app_secret), token no header
// x-tts-access-token, loja identificada por shop_cipher.
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchJson } from "../../http";
import { env, envOptional } from "../../env";
import { stateWithVariation, stockTarget } from "../variations";
import { firstImage, imageList } from "../images";
import type {
  ActionType,
  Variation,
  AdsCampaign,
  AdsContext,
  DateRange,
  Listing,
  MarketplaceAdapter,
  Order,
  Question,
  SellerProfile,
  TokenSet,
  WebhookNotification,
} from "../types";

type Json = Record<string, any>;

export const TTS_API = "https://open-api.tiktokglobalshop.com";
export const TTS_AUTH = "https://auth.tiktok-shops.com";
export const TTS_SELLER_AUTHORIZE = "https://services.tiktokshop.com/open/authorize";

/** Texto assinado: secret + path + pares ordenados + body + secret. */
export function ttsStringToSign(secret: string, path: string, query: Record<string, string>, body: string): string {
  const pairs = Object.entries(query)
    .filter(([k]) => k !== "sign" && k !== "access_token")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let s = secret + path;
  for (const [k, v] of pairs) s += k + v;
  return s + body + secret;
}

export function ttsSign(secret: string, path: string, query: Record<string, string>, body: string): string {
  return createHmac("sha256", secret).update(ttsStringToSign(secret, path, query, body), "utf8").digest("hex");
}

/** Webhook: header Authorization = hex(HMAC-SHA256(app_secret, app_key + corpo bruto)). */
export function ttsVerifyWebhook(appKey: string, appSecret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", appSecret).update(appKey, "utf8").update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATUS_MAP: Record<string, string> = {
  ACTIVATE: "active",
  SELLER_DEACTIVATED: "paused",
  PLATFORM_DEACTIVATED: "paused",
  FREEZE: "paused",
  DRAFT: "draft",
  PENDING: "under_review",
  FAILED: "inactive",
  DELETED: "closed",
};

function mapSkus(p: Json): Variation[] {
  return ((p.skus ?? []) as Json[]).map((sku) => ({
    id: String(sku.id),
    name: ((sku.sales_attributes ?? []) as Json[]).map((a) => a.value_name).filter(Boolean).join(" / ") || sku.seller_sku || String(sku.id),
    price: sku.price?.sale_price != null ? Number(sku.price.sale_price) : sku.price?.tax_exclusive_price != null ? Number(sku.price.tax_exclusive_price) : null,
    stock: ((sku.inventory ?? []) as Json[]).reduce((t, inv) => t + Number(inv.quantity ?? 0), 0),
    sku: sku.seller_sku ?? null,
  }));
}

function mapProduct(p: Json): Listing {
  const skus: Json[] = p.skus ?? [];
  const first = skus[0]?.price ?? {};
  const stock = skus.reduce(
    (s, sku) => s + ((sku.inventory ?? []) as Json[]).reduce((t, inv) => t + Number(inv.quantity ?? 0), 0),
    0,
  );
  const raw = String(p.status ?? "");
  const main: Json | undefined = (p.main_images ?? [])[0];
  return {
    externalId: String(p.id),
    title: p.title ?? "",
    status: STATUS_MAP[raw] ?? raw.toLowerCase(),
    subStatus: raw && STATUS_MAP[raw] === "paused" ? [raw.toLowerCase()] : stock === 0 && skus.length ? ["out_of_stock"] : [],
    price: first.sale_price != null ? Number(first.sale_price) : first.tax_exclusive_price != null ? Number(first.tax_exclusive_price) : null,
    currencyId: first.currency ?? "BRL",
    availableQuantity: skus.length ? stock : null,
    soldQuantity: null,
    permalink: null,
    thumbnail: firstImage(main?.thumb_urls?.[0], main?.urls?.[0]),
    imageUrls: imageList(((p.main_images ?? []) as Json[]).map((i) => i?.urls?.[0] ?? i?.thumb_urls?.[0])),
    listingTypeId: null,
    hasVariations: skus.length > 1,
    variations: skus.length > 1 ? mapSkus(p) : [],
    raw: null,
  };
}

function mapOrder(o: Json): Order {
  const st = String(o.status ?? "").toUpperCase();
  return {
    externalId: String(o.id),
    status: st === "CANCELLED" ? "cancelled" : st.toLowerCase(),
    totalAmount: Number(o.payment?.total_amount ?? 0),
    paidAmount: o.payment?.total_amount != null ? Number(o.payment.total_amount) : null,
    currencyId: o.payment?.currency ?? "BRL",
    units: Array.isArray(o.line_items) ? o.line_items.length : 0, // cada line item é 1 unidade no TikTok Shop
    dateCreated: new Date(Number(o.create_time) * 1000).toISOString(),
    dateClosed: o.paid_time ? new Date(Number(o.paid_time) * 1000).toISOString() : null,
    shippingId: o.packages?.[0]?.id ? String(o.packages[0].id) : null,
    raw: null,
  };
}

export class TikTokShopAdapter implements MarketplaceAdapter {
  readonly id = "tiktok" as const;
  private appKey = () => env("TIKTOK_APP_KEY");
  private appSecret = () => env("TIKTOK_APP_SECRET");
  private productCache = new Map<string, Json>();

  /** Token interno: "access_token|shop_cipher" (a loja precisa do cipher em toda chamada). */
  private split(token: string): [string, string] {
    const i = token.lastIndexOf("|");
    return [token.slice(0, i), token.slice(i + 1)];
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    accessToken: string,
    opts: { cipher?: string; query?: Record<string, string | number>; body?: unknown } = {},
  ): Promise<Json> {
    const query: Record<string, string> = { app_key: this.appKey(), timestamp: String(Math.floor(Date.now() / 1000)) };
    if (opts.cipher) query.shop_cipher = opts.cipher;
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") query[k] = String(v);
    const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
    query.sign = ttsSign(this.appSecret(), path, query, body);
    const url = `${TTS_API}${path}?${new URLSearchParams(query).toString()}`;
    const r = await fetchJson<Json>(url, {
      method,
      headers: { "x-tts-access-token": accessToken, "Content-Type": "application/json", Accept: "application/json" },
      ...(method === "POST" ? { body: body || "{}" } : {}),
    });
    if (r?.code !== 0) throw new Error(`TikTok Shop: ${r?.message ?? "erro"} (código ${r?.code})`);
    return r.data ?? {};
  }

  // ───────────── OAuth ─────────────
  buildAuthorizationUrl({ state }: { state: string; redirectUri: string }) {
    // O endereço de retorno é o cadastrado no Partner Center (não vai na URL).
    const u = new URL(TTS_SELLER_AUTHORIZE);
    u.searchParams.set("service_id", env("TIKTOK_SERVICE_ID"));
    u.searchParams.set("state", state);
    return u.toString();
  }

  private async tokenRequest(endpoint: "get" | "refresh", extra: Record<string, string>): Promise<Json> {
    const params = new URLSearchParams({ app_key: this.appKey(), app_secret: this.appSecret(), ...extra });
    const r = await fetchJson<Json>(`${TTS_AUTH}/api/v2/token/${endpoint}?${params.toString()}`, { method: "GET" }, { retries: 2 });
    if (r?.code !== 0) throw new Error(`TikTok Shop token: ${r?.message ?? "erro"} (código ${r?.code})`);
    return r.data;
  }

  private async pickShop(accessToken: string, shopId?: string): Promise<Json> {
    const data = await this.call("GET", "/authorization/202309/shops", accessToken);
    const shops: Json[] = data.shops ?? [];
    const shop = shopId ? shops.find((s) => String(s.id) === shopId) : shops.find((s) => s.region === "BR") ?? shops[0];
    if (!shop) throw new Error("Nenhuma loja autorizada nesta conta do TikTok Shop");
    return shop;
  }

  private toTokens(d: Json, shop: Json): TokenSet {
    const exp = Number(d.access_token_expire_in ?? 0);
    // access_token_expire_in é um instante (Unix, segundos); margem de 5 min.
    const expiresAt = exp > 1e9 ? new Date((exp - 300) * 1000) : new Date(Date.now() + ((exp || 86400) - 300) * 1000);
    return { accessToken: `${d.access_token}|${shop.cipher}`, refreshToken: d.refresh_token, expiresAt, externalUserId: String(shop.id) };
  }

  async exchangeCode({ code }: { code: string; redirectUri: string }) {
    const d = await this.tokenRequest("get", { auth_code: code, grant_type: "authorized_code" });
    return this.toTokens(d, await this.pickShop(d.access_token));
  }

  async refreshToken(refreshToken: string, externalUserId?: string) {
    const d = await this.tokenRequest("refresh", { refresh_token: refreshToken, grant_type: "refresh_token" });
    return this.toTokens(d, await this.pickShop(d.access_token, externalUserId));
  }

  // ───────────── Leitura ─────────────
  async getSeller(token: string, externalUserId: string): Promise<SellerProfile> {
    const [t] = this.split(token);
    const shop = await this.pickShop(t, externalUserId);
    return {
      externalUserId: String(shop.id),
      nickname: shop.name ?? `TikTok Shop ${shop.id}`,
      siteId: shop.region ?? "BR",
      reputationLevel: null,
      powerSellerStatus: null,
      claimsRate: null,
      delayedRate: null,
      cancellationsRate: null,
      raw: { id: shop.id, name: shop.name, region: shop.region, seller_type: shop.seller_type },
    };
  }

  async listListingIds(token: string, _uid: string, max: number): Promise<string[]> {
    const [t, cipher] = this.split(token);
    const ids: string[] = [];
    let pageToken = "";
    for (let page = 0; page < 50 && ids.length < max; page++) {
      const data = await this.call("POST", "/product/202502/products/search", t, {
        cipher,
        query: { page_size: 100, page_token: pageToken },
        body: {},
      });
      for (const p of (data.products ?? []) as Json[]) {
        this.productCache.set(String(p.id), p);
        ids.push(String(p.id));
      }
      pageToken = data.next_page_token ?? "";
      if (!pageToken) break;
    }
    return ids.slice(0, max);
  }

  private async getProduct(token: string, id: string): Promise<Json> {
    const [t, cipher] = this.split(token);
    return this.call("GET", `/product/202309/products/${encodeURIComponent(id)}`, t, { cipher });
  }

  async getListings(token: string, ids: string[]): Promise<Listing[]> {
    const out: Listing[] = [];
    for (const id of ids) {
      const p = this.productCache.get(id) ?? (await this.getProduct(token, id).catch(() => null));
      if (p) out.push(mapProduct(p));
    }
    return out;
  }

  async getListingVisits(): Promise<Record<string, number>> {
    return {}; // métricas de visitas ficam na API de Analytics (fora do escopo inicial)
  }

  async getAccountVisits(): Promise<number | null> {
    return null;
  }

  async searchOrders(token: string, _uid: string, range: DateRange, max: number): Promise<Order[]> {
    const [t, cipher] = this.split(token);
    const from = Math.floor(new Date(`${range.from}T00:00:00-03:00`).getTime() / 1000);
    const to = Math.floor(new Date(`${range.to}T23:59:59-03:00`).getTime() / 1000) + 1;
    const out: Order[] = [];
    let pageToken = "";
    for (let page = 0; page < 40 && out.length < max; page++) {
      const data = await this.call("POST", "/order/202309/orders/search", t, {
        cipher,
        query: { page_size: 50, page_token: pageToken, sort_field: "create_time", sort_order: "DESC" },
        body: { create_time_ge: from, create_time_lt: to },
      });
      out.push(...((data.orders ?? []) as Json[]).map(mapOrder));
      pageToken = data.next_page_token ?? "";
      if (!pageToken) break;
    }
    return out.slice(0, max);
  }

  async getOrder(token: string, orderId: string): Promise<Order> {
    const [t, cipher] = this.split(token);
    const data = await this.call("GET", "/order/202507/orders", t, { cipher, query: { ids: orderId } });
    const o = (data.orders ?? [])[0];
    if (!o) throw new Error("Pedido não encontrado no TikTok Shop");
    return mapOrder(o);
  }

  // O TikTok Shop não tem perguntas públicas de anúncio (o contato é pelo chat).
  async listUnansweredQuestions(): Promise<Question[]> {
    return [];
  }
  async getQuestion(): Promise<Question> {
    throw new Error("TikTok Shop não possui perguntas de anúncio");
  }
  async getAdsContext(): Promise<AdsContext | null> {
    return null; // anúncios do TikTok ficam no TikTok for Business (integração separada)
  }
  async listAdsCampaigns(): Promise<AdsCampaign[]> {
    return [];
  }

  // ───────────── Escrita ─────────────
  async getStateForAction(token: string, type: ActionType, targetId: string, _ctx?: AdsContext | null, payload?: Record<string, unknown>) {
    if (!["update_price", "update_stock", "pause_listing", "activate_listing"].includes(type)) {
      throw new Error(`Ação ${type} ainda não suportada no TikTok Shop`);
    }
    const p = await this.getProduct(token, targetId);
    const l = mapProduct(p);
    return stateWithVariation(
      { id: l.externalId, title: l.title, status: l.status, price: l.price, available_quantity: l.availableQuantity },
      mapSkus(p).length > 1 ? mapSkus(p) : [],
      ["update_price", "update_stock"].includes(type) ? payload?.variation_id : undefined,
    );
  }

  async executeAction(token: string, type: ActionType, targetId: string, payload: Record<string, unknown>) {
    const [t, cipher] = this.split(token);
    const id = encodeURIComponent(targetId);
    switch (type) {
      case "update_price":
      case "update_stock": {
        const p = await this.getProduct(token, targetId);
        const skus: Json[] = p.skus ?? [];
        if (!skus.length) throw new Error("Produto sem SKUs no TikTok Shop.");
        const vars = mapSkus(p);
        if (type === "update_price") {
          // Sem SKU escolhido, o preço vale para todos os SKUs do produto.
          const chosen = payload.variation_id ? skus.filter((s) => String(s.id) === String(payload.variation_id)) : skus;
          if (!chosen.length) throw new Error(`SKU ${String(payload.variation_id)} não encontrado.`);
          await this.call("POST", `/product/202309/products/${id}/prices/update`, t, {
            cipher,
            body: { skus: chosen.map((s) => ({ id: String(s.id), price: { amount: Number(payload.price).toFixed(2), currency: s.price?.currency ?? "BRL" } })) },
          });
          return { price: payload.price, skus_atualizados: chosen.length };
        }
        const target = stockTarget(vars, payload.variation_id)!;
        const sku = skus.find((s) => String(s.id) === target.id)!;
        const warehouse = sku.inventory?.[0]?.warehouse_id;
        await this.call("POST", `/product/202309/products/${id}/inventory/update`, t, {
          cipher,
          body: { skus: [{ id: target.id, inventory: [{ ...(warehouse ? { warehouse_id: String(warehouse) } : {}), quantity: Number(payload.available_quantity) }] }] },
        });
        return { available_quantity: payload.available_quantity, variation_id: target.id, variation_name: target.name };
      }
      case "pause_listing":
        await this.call("POST", "/product/202309/products/deactivate", t, { cipher, body: { product_ids: [targetId] } });
        return { status: "paused" };
      case "activate_listing":
        await this.call("POST", "/product/202309/products/activate", t, { cipher, body: { product_ids: [targetId] } });
        return { status: "active" };
      default:
        throw new Error(`Ação ${type} ainda não suportada no TikTok Shop`);
    }
  }

  // ───────────── Webhooks ─────────────
  /** Corpo já verificado. shop_id vem como texto (extraído do corpo bruto para não perder precisão). */
  parseWebhook(body: unknown): WebhookNotification | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Json;
    const shopId = b.shop_id != null ? String(b.shop_id) : "";
    const d = (b.data ?? {}) as Json;
    if (!shopId) return null;
    if (d.order_id) return { topic: "orders", resource: `/orders/${d.order_id}`, externalUserId: shopId, raw: b };
    if (d.product_id) return { topic: "items", resource: `/items/${d.product_id}`, externalUserId: shopId, raw: b };
    return { topic: `tiktok_${b.type ?? "evento"}`, resource: "", externalUserId: shopId, raw: b };
  }
}

/** Extrai números grandes (IDs de 64 bits) como texto antes do JSON.parse. */
export function parseTikTokBody(raw: string): Json {
  const safe = raw.replace(/"(shop_id|order_id|product_id|sku_id|id)"\s*:\s*(\d{15,})/g, '"$1":"$2"');
  return JSON.parse(safe);
}

export function tiktokConfigured(): boolean {
  return Boolean(envOptional("TIKTOK_APP_KEY") && envOptional("TIKTOK_APP_SECRET") && envOptional("TIKTOK_SERVICE_ID"));
}
