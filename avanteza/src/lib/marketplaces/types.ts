// Interface comum de marketplace. Mercado Livre hoje; Shopee entra como outro adapter.

export type MarketplaceId = "mercadolivre" | "shopee";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  externalUserId: string;
  scope?: string;
}

export interface SellerProfile {
  externalUserId: string;
  nickname: string;
  siteId: string;
  reputationLevel: string | null;
  powerSellerStatus: string | null;
  claimsRate: number | null;
  delayedRate: number | null;
  cancellationsRate: number | null;
  raw: unknown;
}

export interface Listing {
  externalId: string;
  title: string;
  status: string;
  subStatus: string[];
  price: number | null;
  currencyId: string | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  permalink: string | null;
  thumbnail: string | null;
  listingTypeId: string | null;
  hasVariations: boolean;
  raw: unknown;
}

export interface Order {
  externalId: string;
  status: string;
  totalAmount: number;
  paidAmount: number | null;
  currencyId: string | null;
  units: number;
  dateCreated: string;
  dateClosed: string | null;
  shippingId: string | null;
  raw: unknown;
}

export interface Question {
  externalId: string;
  itemId: string;
  text: string;
  status: string;
  answerText: string | null;
  dateCreated: string;
  raw: unknown;
}

export interface AdsMetrics {
  cost: number | null;
  revenue: number | null; // receita atribuída (total_amount)
  roas: number | null;
  clicks: number | null;
  prints: number | null;
  acos: number | null;
}

export interface AdsCampaign {
  externalId: string;
  name: string;
  status: string;
  budget: number | null;
  strategy: string | null;
  roasTarget: number | null;
  metrics: AdsMetrics;
  raw: unknown;
}

export interface AdsContext {
  advertiserId: string;
  siteId: string;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

/** Ações de escrita suportadas pelo executor. */
export type ActionType =
  | "update_price"
  | "update_stock"
  | "pause_listing"
  | "activate_listing"
  | "update_listing"
  | "answer_question"
  | "update_ads_budget"
  | "update_ads_status"
  | "create_promotion";

export interface WebhookNotification {
  topic: string;
  resource: string;
  externalUserId: string;
  raw: unknown;
}

export interface MarketplaceAdapter {
  readonly id: MarketplaceId;

  // OAuth
  buildAuthorizationUrl(params: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(params: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>;
  refreshToken(refreshToken: string): Promise<TokenSet>;

  // Leitura
  getSeller(token: string, externalUserId: string): Promise<SellerProfile>;
  listListingIds(token: string, externalUserId: string, max: number): Promise<string[]>;
  getListings(token: string, ids: string[]): Promise<Listing[]>;
  getListingVisits(token: string, ids: string[], range: DateRange): Promise<Record<string, number>>;
  getAccountVisits(token: string, externalUserId: string, range: DateRange): Promise<number | null>;
  searchOrders(token: string, externalUserId: string, range: DateRange, max: number): Promise<Order[]>;
  getOrder(token: string, orderId: string): Promise<Order>;
  listUnansweredQuestions(token: string, externalUserId: string, max: number): Promise<Question[]>;
  getQuestion(token: string, questionId: string): Promise<Question>;
  getAdsContext(token: string, externalUserId: string): Promise<AdsContext | null>;
  listAdsCampaigns(token: string, ctx: AdsContext, range: DateRange): Promise<AdsCampaign[]>;

  // Escrita
  getStateForAction(token: string, type: ActionType, targetId: string, ctx?: AdsContext | null): Promise<Record<string, unknown>>;
  executeAction(
    token: string,
    type: ActionType,
    targetId: string,
    payload: Record<string, unknown>,
    ctx?: AdsContext | null,
  ): Promise<Record<string, unknown>>;

  // Webhooks
  parseWebhook(body: unknown): WebhookNotification | null;
}
