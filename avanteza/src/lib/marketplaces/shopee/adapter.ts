// Adapter da Shopee (Open Platform v2) — Fase 3.
// Assinatura e fluxo de tokens seguem o padrão v2: HMAC-SHA256(partner_key) sobre
// partner_id + path + timestamp (+ access_token + shop_id nas rotas de loja).
// VERIFICAR: confirmar caminhos/campos de leitura e escrita na documentação oficial
// (open.shopee.com) assim que o cadastro de desenvolvedor estiver aprovado, em modo simulação.
import { createHmac } from "node:crypto";
import { fetchJson } from "../../http";
import { env, envOptional } from "../../env";
import type {
  ActionType,
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

export function shopeeHost(): string {
  return envOptional("SHOPEE_API_HOST") ?? "https://partner.shopeemobile.com";
}

export function shopeeSign(partnerKey: string, parts: (string | number)[]): string {
  return createHmac("sha256", partnerKey).update(parts.join("")).digest("hex");
}

const ts = () => Math.floor(Date.now() / 1000);

export class ShopeeAdapter implements MarketplaceAdapter {
  readonly id = "shopee" as const;
  private partnerId = () => Number(env("SHOPEE_PARTNER_ID"));
  private partnerKey = () => env("SHOPEE_PARTNER_KEY");

  private publicUrl(path: string, extra: Record<string, string> = {}) {
    const t = ts();
    const u = new URL(shopeeHost() + path);
    u.searchParams.set("partner_id", String(this.partnerId()));
    u.searchParams.set("timestamp", String(t));
    u.searchParams.set("sign", shopeeSign(this.partnerKey(), [this.partnerId(), path, t]));
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return u;
  }

  private shopUrl(path: string, token: string, shopId: string, extra: Record<string, string | number> = {}) {
    const t = ts();
    const u = new URL(shopeeHost() + path);
    u.searchParams.set("partner_id", String(this.partnerId()));
    u.searchParams.set("timestamp", String(t));
    u.searchParams.set("access_token", token);
    u.searchParams.set("shop_id", shopId);
    u.searchParams.set("sign", shopeeSign(this.partnerKey(), [this.partnerId(), path, t, token, shopId]));
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
    return u;
  }

  private async call(u: URL, init: RequestInit = {}): Promise<Json> {
    const r = await fetchJson<Json>(u.toString(), { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (r?.error) throw new Error(`Shopee: ${r.error} ${r.message ?? ""}`.trim());
    return r;
  }

  // O token da Shopee carrega o shop_id junto; usamos "token|shop_id" internamente.
  private split(token: string): [string, string] {
    const i = token.lastIndexOf("|");
    return [token.slice(0, i), token.slice(i + 1)];
  }

  // ───────────── OAuth ─────────────
  buildAuthorizationUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("state", state); // a Shopee devolve code e shop_id; o state volta pela própria URL
    return this.publicUrl("/api/v2/shop/auth_partner", { redirect: redirect.toString() }).toString();
  }

  private toTokens(r: Json, shopId: string): TokenSet {
    return {
      accessToken: `${r.access_token}|${shopId}`,
      refreshToken: r.refresh_token,
      expiresAt: new Date(Date.now() + (Number(r.expire_in ?? 14400) - 300) * 1000),
      externalUserId: shopId,
    };
  }

  async exchangeCode({ code, extra }: { code: string; redirectUri: string; codeVerifier?: string; extra?: Record<string, string> }) {
    const shopId = extra?.shop_id;
    if (!shopId) throw new Error("shop_id ausente no retorno da Shopee");
    const r = await this.call(this.publicUrl("/api/v2/auth/token/get"), {
      method: "POST",
      body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: this.partnerId() }),
    });
    return this.toTokens(r, shopId);
  }

  async refreshToken(refreshToken: string, externalUserId?: string) {
    if (!externalUserId) throw new Error("shop_id necessário para renovar token da Shopee");
    const r = await this.call(this.publicUrl("/api/v2/auth/access_token/get"), {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken, shop_id: Number(externalUserId), partner_id: this.partnerId() }),
    });
    return this.toTokens(r, externalUserId);
  }

  // ───────────── Leitura ─────────────
  async getSeller(token: string): Promise<SellerProfile> {
    const [t, shopId] = this.split(token);
    const r = await this.call(this.shopUrl("/api/v2/shop/get_shop_info", t, shopId));
    return {
      externalUserId: shopId,
      nickname: r.shop_name ?? `Shopee ${shopId}`,
      siteId: r.region ?? "BR",
      reputationLevel: null,
      powerSellerStatus: null,
      claimsRate: null,
      delayedRate: null,
      cancellationsRate: null,
      raw: { shop_name: r.shop_name, region: r.region, status: r.status },
    };
  }

  async listListingIds(token: string, _uid: string, max: number): Promise<string[]> {
    const [t, shopId] = this.split(token);
    const ids: string[] = [];
    for (const status of ["NORMAL", "UNLIST"]) {
      let offset = 0;
      while (ids.length < max) {
        const r = await this.call(this.shopUrl("/api/v2/product/get_item_list", t, shopId, { offset, page_size: 100, item_status: status }));
        const items: Json[] = r.response?.item ?? [];
        ids.push(...items.map((i) => String(i.item_id)));
        if (!r.response?.has_next_page) break;
        offset = Number(r.response.next_offset);
      }
    }
    return ids.slice(0, max);
  }

  async getListings(token: string, ids: string[]): Promise<Listing[]> {
    const [t, shopId] = this.split(token);
    const out: Listing[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.call(this.shopUrl("/api/v2/product/get_item_base_info", t, shopId, { item_id_list: ids.slice(i, i + 50).join(",") }));
      for (const it of (r.response?.item_list ?? []) as Json[]) {
        const status = it.item_status === "NORMAL" ? "active" : it.item_status === "UNLIST" ? "paused" : String(it.item_status ?? "").toLowerCase();
        out.push({
          externalId: String(it.item_id),
          title: it.item_name,
          status,
          subStatus: [],
          price: it.price_info?.[0]?.current_price ?? null,
          currencyId: it.price_info?.[0]?.currency ?? "BRL",
          availableQuantity: it.stock_info_v2?.summary_info?.total_available_stock ?? null,
          soldQuantity: null,
          permalink: null,
          thumbnail: it.image?.image_url_list?.[0] ?? null,
          listingTypeId: null,
          hasVariations: Boolean(it.has_model),
          raw: null,
        });
      }
    }
    return out;
  }

  async getListingVisits(): Promise<Record<string, number>> {
    return {}; // VERIFICAR: métricas de visitas por item na API de shop performance
  }

  async getAccountVisits(): Promise<number | null> {
    return null;
  }

  private mapOrder(o: Json): Order {
    const units = ((o.item_list ?? []) as Json[]).reduce((s, it) => s + Number(it.model_quantity_purchased ?? 0), 0);
    const st = String(o.order_status ?? "").toUpperCase();
    return {
      externalId: String(o.order_sn),
      status: st === "CANCELLED" ? "cancelled" : st.toLowerCase(),
      totalAmount: Number(o.total_amount ?? 0),
      paidAmount: null,
      currencyId: o.currency ?? "BRL",
      units,
      dateCreated: new Date(Number(o.create_time) * 1000).toISOString(),
      dateClosed: null,
      shippingId: null,
      raw: null,
    };
  }

  async searchOrders(token: string, _uid: string, range: DateRange, max: number): Promise<Order[]> {
    const [t, shopId] = this.split(token);
    const from = Math.floor(new Date(`${range.from}T00:00:00-03:00`).getTime() / 1000);
    const to = Math.floor(new Date(`${range.to}T23:59:59-03:00`).getTime() / 1000);
    const sns: string[] = [];
    let cursor = "";
    while (sns.length < max) {
      const r = await this.call(this.shopUrl("/api/v2/order/get_order_list", t, shopId, {
        time_range_field: "create_time", time_from: from, time_to: to, page_size: 100, cursor,
      }));
      sns.push(...((r.response?.order_list ?? []) as Json[]).map((o) => String(o.order_sn)));
      if (!r.response?.more) break;
      cursor = String(r.response.next_cursor ?? "");
    }
    const out: Order[] = [];
    for (let i = 0; i < sns.length && i < max; i += 50) {
      const r = await this.call(this.shopUrl("/api/v2/order/get_order_detail", t, shopId, {
        order_sn_list: sns.slice(i, i + 50).join(","), response_optional_fields: "total_amount,item_list,currency",
      }));
      out.push(...((r.response?.order_list ?? []) as Json[]).map((o) => this.mapOrder(o)));
    }
    return out;
  }

  async getOrder(token: string, orderId: string): Promise<Order> {
    const [t, shopId] = this.split(token);
    const r = await this.call(this.shopUrl("/api/v2/order/get_order_detail", t, shopId, {
      order_sn_list: orderId, response_optional_fields: "total_amount,item_list,currency",
    }));
    const o = r.response?.order_list?.[0];
    if (!o) throw new Error("Pedido não encontrado");
    return this.mapOrder(o);
  }

  // A Shopee não tem perguntas públicas como o Mercado Livre (o contato é pelo chat).
  async listUnansweredQuestions(): Promise<Question[]> {
    return [];
  }
  async getQuestion(): Promise<Question> {
    throw new Error("Shopee não possui perguntas de anúncio");
  }
  async getAdsContext(): Promise<AdsContext | null> {
    return null; // VERIFICAR: Shopee Ads API
  }
  async listAdsCampaigns(): Promise<AdsCampaign[]> {
    return [];
  }

  // ───────────── Escrita ─────────────
  async getStateForAction(token: string, type: ActionType, targetId: string) {
    if (!["update_price", "update_stock", "pause_listing", "activate_listing"].includes(type)) {
      throw new Error(`Ação ${type} ainda não suportada na Shopee`);
    }
    const [l] = await this.getListings(token, [targetId]);
    if (!l) throw new Error("Anúncio não encontrado na Shopee");
    return { id: l.externalId, title: l.title, status: l.status, price: l.price, available_quantity: l.availableQuantity, has_variations: l.hasVariations };
  }

  async executeAction(token: string, type: ActionType, targetId: string, payload: Record<string, unknown>) {
    const [t, shopId] = this.split(token);
    const post = (path: string, body: unknown) => this.call(this.shopUrl(path, t, shopId), { method: "POST", body: JSON.stringify(body) });
    const item_id = Number(targetId);
    switch (type) {
      case "update_price":
        await post("/api/v2/product/update_price", { item_id, price_list: [{ original_price: Number(payload.price) }] });
        return { price: payload.price };
      case "update_stock":
        await post("/api/v2/product/update_stock", { item_id, stock_list: [{ seller_stock: [{ stock: Number(payload.available_quantity) }] }] });
        return { available_quantity: payload.available_quantity };
      case "pause_listing":
      case "activate_listing":
        await post("/api/v2/product/unlist_item", { item_list: [{ item_id, unlist: type === "pause_listing" }] });
        return { status: type === "pause_listing" ? "paused" : "active" };
      default:
        throw new Error(`Ação ${type} ainda não suportada na Shopee`);
    }
  }

  parseWebhook(_body: unknown): WebhookNotification | null {
    return null; // VERIFICAR: push da Shopee (assinatura no header Authorization)
  }
}
