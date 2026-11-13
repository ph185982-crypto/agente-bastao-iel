// Implementação do MarketplaceAdapter para o Mercado Livre (site MLB).
// Endpoints conforme developers.mercadolivre.com.br. Pontos marcados com "VERIFICAR" têm
// documentação pública incompleta e devem ser validados em modo simulação antes do uso real.
import { fetchJson, ApiError } from "../../http";
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

export const ML_API = "https://api.mercadolibre.com";
export const ML_AUTH = "https://auth.mercadolivre.com.br/authorization";

const ITEM_ATTRIBUTES =
  "id,title,status,sub_status,price,currency_id,available_quantity,sold_quantity,permalink,thumbnail,listing_type_id,variations";

type Json = Record<string, any>;

function auth(token: string, extra: Record<string, string> = {}): RequestInit {
  return { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra } };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

function toTokenSet(r: Json): TokenSet {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    // Margem de 5 min; o access token do ML vale 6 h (expires_in = 21600).
    expiresAt: new Date(Date.now() + (Number(r.expires_in ?? 21600) - 300) * 1000),
    externalUserId: String(r.user_id),
    scope: r.scope,
  };
}

function mapListing(b: Json): Listing {
  return {
    externalId: b.id,
    title: b.title,
    status: b.status,
    subStatus: Array.isArray(b.sub_status) ? b.sub_status : [],
    price: num(b.price),
    currencyId: b.currency_id ?? null,
    availableQuantity: num(b.available_quantity),
    soldQuantity: num(b.sold_quantity),
    permalink: b.permalink ?? null,
    thumbnail: b.thumbnail ?? null,
    listingTypeId: b.listing_type_id ?? null,
    hasVariations: Array.isArray(b.variations) && b.variations.length > 0,
    raw: b,
  };
}

function mapOrder(o: Json): Order {
  const units = Array.isArray(o.order_items)
    ? o.order_items.reduce((s: number, it: Json) => s + Number(it.quantity ?? 0), 0)
    : 0;
  return {
    externalId: String(o.id),
    status: o.status,
    totalAmount: Number(o.total_amount ?? 0),
    paidAmount: num(o.paid_amount),
    currencyId: o.currency_id ?? null,
    units,
    dateCreated: o.date_created,
    dateClosed: o.date_closed ?? null,
    shippingId: o.shipping?.id ? String(o.shipping.id) : null,
    raw: o,
  };
}

function mapQuestion(q: Json): Question {
  return {
    externalId: String(q.id),
    itemId: q.item_id,
    text: q.text,
    status: q.status,
    answerText: q.answer?.text ?? null,
    dateCreated: q.date_created,
    raw: q,
  };
}

export class MercadoLivreAdapter implements MarketplaceAdapter {
  readonly id = "mercadolivre" as const;

  // ───────────── OAuth ─────────────
  buildAuthorizationUrl({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }) {
    const u = new URL(ML_AUTH);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", env("ML_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    if (codeChallenge) {
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
    }
    return u.toString();
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenSet> {
    const r = await fetchJson<Json>(
      `${ML_API}/oauth/token`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      },
      { retries: 2 },
    );
    return toTokenSet(r);
  }

  exchangeCode({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }) {
    const body: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: env("ML_CLIENT_ID"),
      client_secret: env("ML_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
    };
    if (codeVerifier) body.code_verifier = codeVerifier;
    return this.tokenRequest(body);
  }

  /** O refresh token do ML é de USO ÚNICO: cada renovação devolve um novo, que precisa ser salvo. */
  refreshToken(refreshToken: string) {
    return this.tokenRequest({
      grant_type: "refresh_token",
      client_id: env("ML_CLIENT_ID"),
      client_secret: env("ML_CLIENT_SECRET"),
      refresh_token: refreshToken,
    });
  }

  // ───────────── Leitura ─────────────
  async getSeller(token: string, userId: string): Promise<SellerProfile> {
    const u = await fetchJson<Json>(`${ML_API}/users/${userId}`, auth(token));
    const rep = u.seller_reputation ?? {};
    const m = rep.metrics ?? {};
    return {
      externalUserId: String(u.id),
      nickname: u.nickname,
      siteId: u.site_id,
      reputationLevel: rep.level_id ?? null,
      powerSellerStatus: rep.power_seller_status ?? null,
      claimsRate: num(m.claims?.rate),
      delayedRate: num(m.delayed_handling_time?.rate),
      cancellationsRate: num(m.cancellations?.rate),
      raw: { id: u.id, nickname: u.nickname, site_id: u.site_id, seller_reputation: rep },
    };
  }

  /** Lista IDs com search_type=scan (paginação por scroll_id, sem limite de offset). */
  async listListingIds(token: string, userId: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let scrollId: string | undefined;
    while (ids.length < max) {
      const u = new URL(`${ML_API}/users/${userId}/items/search`);
      u.searchParams.set("search_type", "scan");
      u.searchParams.set("limit", "100");
      if (scrollId) u.searchParams.set("scroll_id", scrollId);
      const r = await fetchJson<Json>(u.toString(), auth(token));
      const results: string[] = r.results ?? [];
      if (results.length === 0) break;
      ids.push(...results);
      scrollId = r.scroll_id;
      if (!scrollId) break;
    }
    return ids.slice(0, max);
  }

  /** Multiget: até 20 IDs por chamada. */
  async getListings(token: string, ids: string[]): Promise<Listing[]> {
    const out: Listing[] = [];
    for (const group of chunk(ids, 20)) {
      const r = await fetchJson<Json[]>(
        `${ML_API}/items?ids=${group.join(",")}&attributes=${ITEM_ATTRIBUTES}`,
        auth(token),
      );
      for (const entry of r) if (entry.code === 200 && entry.body) out.push(mapListing(entry.body));
    }
    return out;
  }

  async getListingVisits(token: string, ids: string[], range: DateRange): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of ids) {
      try {
        const u = new URL(`${ML_API}/items/visits`);
        u.searchParams.set("ids", id);
        u.searchParams.set("date_from", range.from);
        u.searchParams.set("date_to", range.to);
        const r = await fetchJson<Json[] | Json>(u.toString(), auth(token), { retries: 2 });
        const rows = Array.isArray(r) ? r : [r];
        for (const row of rows) if (row?.item_id) out[row.item_id] = Number(row.total_visits ?? 0);
      } catch {
        /* visitas são informativas: não interrompem a coleta */
      }
    }
    return out;
  }

  async getAccountVisits(token: string, userId: string, range: DateRange): Promise<number | null> {
    try {
      const u = new URL(`${ML_API}/users/${userId}/items_visits`);
      u.searchParams.set("date_from", `${range.from}T00:00:00.000-03:00`);
      u.searchParams.set("date_to", `${range.to}T23:59:59.999-03:00`);
      const r = await fetchJson<Json>(u.toString(), auth(token), { retries: 2 });
      return num(r.total_visits);
    } catch {
      return null;
    }
  }

  async searchOrders(token: string, userId: string, range: DateRange, max: number): Promise<Order[]> {
    const out: Order[] = [];
    let offset = 0;
    while (out.length < max) {
      const u = new URL(`${ML_API}/orders/search`);
      u.searchParams.set("seller", userId);
      u.searchParams.set("order.date_created.from", `${range.from}T00:00:00.000-03:00`);
      u.searchParams.set("order.date_created.to", `${range.to}T23:59:59.999-03:00`);
      u.searchParams.set("sort", "date_desc");
      u.searchParams.set("limit", "50");
      u.searchParams.set("offset", String(offset));
      const r = await fetchJson<Json>(u.toString(), auth(token));
      const results: Json[] = r.results ?? [];
      out.push(...results.map(mapOrder));
      offset += results.length;
      const total = Number(r.paging?.total ?? 0);
      if (results.length === 0 || offset >= total) break;
    }
    return out.slice(0, max);
  }

  async getOrder(token: string, orderId: string): Promise<Order> {
    return mapOrder(await fetchJson<Json>(`${ML_API}/orders/${orderId}`, auth(token)));
  }

  async listUnansweredQuestions(token: string, userId: string, max: number): Promise<Question[]> {
    const out: Question[] = [];
    let offset = 0;
    while (out.length < max) {
      const u = new URL(`${ML_API}/questions/search`);
      u.searchParams.set("seller_id", userId);
      u.searchParams.set("status", "UNANSWERED");
      u.searchParams.set("api_version", "4");
      u.searchParams.set("limit", "50");
      u.searchParams.set("offset", String(offset));
      const r = await fetchJson<Json>(u.toString(), auth(token));
      const qs: Json[] = r.questions ?? [];
      out.push(...qs.map(mapQuestion));
      offset += qs.length;
      if (qs.length === 0 || offset >= Number(r.total ?? 0)) break;
    }
    return out.slice(0, max);
  }

  async getQuestion(token: string, questionId: string): Promise<Question> {
    return mapQuestion(await fetchJson<Json>(`${ML_API}/questions/${questionId}?api_version=4`, auth(token)));
  }

  /** Product Ads: descobre o anunciante (product_id=PADS, Api-Version 1). */
  async getAdsContext(token: string, userId: string): Promise<AdsContext | null> {
    try {
      const r = await fetchJson<Json>(
        `${ML_API}/advertising/advertisers?product_id=PADS`,
        auth(token, { "Api-Version": "1" }),
        { retries: 2 },
      );
      const list: Json[] = r.advertisers ?? [];
      const adv = list.find((a) => String(a.site_id) === "MLB") ?? list[0];
      void userId;
      return adv ? { advertiserId: String(adv.advertiser_id), siteId: String(adv.site_id ?? "MLB") } : null;
    } catch (err) {
      if (err instanceof ApiError && [401, 403, 404].includes(err.status)) return null;
      throw err;
    }
  }

  /** Campanhas + métricas no período (api-version: 2). */
  async listAdsCampaigns(token: string, ctx: AdsContext, range: DateRange): Promise<AdsCampaign[]> {
    const out: AdsCampaign[] = [];
    let offset = 0;
    for (let page = 0; page < 10; page++) {
      const u = new URL(
        `${ML_API}/advertising/${ctx.siteId}/advertisers/${ctx.advertiserId}/product_ads/campaigns/search`,
      );
      u.searchParams.set("limit", "50");
      u.searchParams.set("offset", String(offset));
      u.searchParams.set("date_from", range.from);
      u.searchParams.set("date_to", range.to);
      u.searchParams.set("metrics", "clicks,prints,cost,cpc,acos,roas,total_amount,units_quantity");
      const r = await fetchJson<Json>(u.toString(), auth(token, { "api-version": "2" }));
      const results: Json[] = r.results ?? [];
      for (const c of results) {
        const m = c.metrics ?? {};
        out.push({
          externalId: String(c.id),
          name: c.name,
          status: c.status,
          budget: num(c.budget),
          strategy: c.strategy ?? null,
          roasTarget: num(c.roas_target),
          metrics: {
            cost: num(m.cost),
            revenue: num(m.total_amount),
            roas: num(m.roas),
            clicks: num(m.clicks),
            prints: num(m.prints),
            acos: num(m.acos),
          },
          raw: c,
        });
      }
      offset += results.length;
      if (results.length === 0 || offset >= Number(r.paging?.total ?? 0)) break;
    }
    return out;
  }

  // ───────────── Escrita ─────────────
  async getStateForAction(token: string, type: ActionType, targetId: string, ctx?: AdsContext | null) {
    switch (type) {
      case "update_price":
      case "update_stock":
      case "pause_listing":
      case "activate_listing":
      case "update_listing":
      case "create_promotion": {
        const it = await fetchJson<Json>(`${ML_API}/items/${targetId}?attributes=${ITEM_ATTRIBUTES}`, auth(token));
        return {
          id: it.id,
          title: it.title,
          status: it.status,
          price: it.price,
          available_quantity: it.available_quantity,
          has_variations: Array.isArray(it.variations) && it.variations.length > 0,
        };
      }
      case "answer_question": {
        const q = await this.getQuestion(token, targetId);
        return { id: q.externalId, item_id: q.itemId, text: q.text, status: q.status, answer: q.answerText };
      }
      case "update_ads_budget":
      case "update_ads_status": {
        if (!ctx) throw new Error("Conta sem Product Ads");
        const camps = await this.listAdsCampaigns(token, ctx, {
          from: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
          to: new Date().toISOString().slice(0, 10),
        });
        const c = camps.find((x) => x.externalId === targetId);
        if (!c) throw new Error(`Campanha ${targetId} não encontrada`);
        return { id: c.externalId, name: c.name, status: c.status, budget: c.budget };
      }
    }
  }

  async executeAction(
    token: string,
    type: ActionType,
    targetId: string,
    payload: Record<string, unknown>,
    ctx?: AdsContext | null,
  ): Promise<Record<string, unknown>> {
    const put = (url: string, body: unknown, extra: Record<string, string> = {}) =>
      fetchJson<Json>(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...extra },
        body: JSON.stringify(body),
      }, { retries: 2 });
    const post = (url: string, body: unknown, extra: Record<string, string> = {}) =>
      fetchJson<Json>(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...extra },
        body: JSON.stringify(body),
      }, { retries: 1 });

    switch (type) {
      case "update_price": {
        const r = await put(`${ML_API}/items/${targetId}`, { price: Number(payload.price) });
        return { price: r.price, status: r.status };
      }
      case "update_stock": {
        const r = await put(`${ML_API}/items/${targetId}`, { available_quantity: Number(payload.available_quantity) });
        return { available_quantity: r.available_quantity, status: r.status };
      }
      case "pause_listing": {
        const r = await put(`${ML_API}/items/${targetId}`, { status: "paused" });
        return { status: r.status };
      }
      case "activate_listing": {
        const r = await put(`${ML_API}/items/${targetId}`, { status: "active" });
        return { status: r.status };
      }
      case "update_listing": {
        const after: Record<string, unknown> = {};
        if (typeof payload.title === "string") {
          const r = await put(`${ML_API}/items/${targetId}`, { title: payload.title });
          after.title = r.title;
        }
        if (typeof payload.description === "string") {
          await put(`${ML_API}/items/${targetId}/description`, { plain_text: payload.description });
          after.description = "atualizada";
        }
        return after;
      }
      case "answer_question": {
        const r = await post(`${ML_API}/answers`, { question_id: Number(targetId), text: String(payload.text) });
        return { status: r.status ?? "ANSWERED", answer: r.answer?.text ?? payload.text };
      }
      case "update_ads_budget":
      case "update_ads_status": {
        if (!ctx) throw new Error("Conta sem Product Ads");
        // VERIFICAR: rota de escrita de campanhas (Product Ads v2). Validar em simulação antes.
        const body = type === "update_ads_budget" ? { budget: Number(payload.budget) } : { status: String(payload.status) };
        const r = await put(
          `${ML_API}/marketplace/advertising/${ctx.siteId}/product_ads/campaigns/${targetId}`,
          body,
          { "api-version": "2" },
        );
        return { budget: r.budget, status: r.status };
      }
      case "create_promotion": {
        // VERIFICAR: desconto individual (PRICE_DISCOUNT) em /seller-promotions, app_version v2.
        const r = await post(`${ML_API}/seller-promotions/items/${targetId}?app_version=v2`, {
          promotion_type: "PRICE_DISCOUNT",
          deal_price: Number(payload.deal_price),
          start_date: payload.start_date,
          finish_date: payload.finish_date,
        });
        return { promotion: r };
      }
    }
  }

  // ───────────── Webhooks ─────────────
  parseWebhook(body: unknown): WebhookNotification | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Json;
    if (!b.topic || !b.resource || b.user_id === undefined) return null;
    const expected = envOptional("ML_CLIENT_ID");
    if (expected && b.application_id !== undefined && String(b.application_id) !== expected) return null;
    return { topic: String(b.topic), resource: String(b.resource), externalUserId: String(b.user_id), raw: b };
  }
}
