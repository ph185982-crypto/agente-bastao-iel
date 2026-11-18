// Links de anúncios mostrados ao cliente ("ver prévia", "ver no Instagram"): só https e só hosts da Meta. Qualquer outra coisa vira null.
const HOSTS = ["fb.me", "facebook.com", "instagram.com"];

export function linkMetaSeguro(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 2000 || /[\s<>"'`\\]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (!HOSTS.some((x) => h === x || h.endsWith(`.${x}`))) return null;
  return u.toString();
}

/** call_to_action_type da Meta → texto do botão em português. */
const CTA: Record<string, string> = {
  WHATSAPP_MESSAGE: "Conversar no WhatsApp", MESSAGE_PAGE: "Enviar mensagem", SEND_MESSAGE: "Enviar mensagem", INSTAGRAM_MESSAGE: "Enviar Direct",
  LEARN_MORE: "Saiba mais", SHOP_NOW: "Comprar agora", BUY_NOW: "Comprar agora", SIGN_UP: "Cadastre-se", SUBSCRIBE: "Assinar", BOOK_NOW: "Reservar",
  BOOK_TRAVEL: "Reservar", CONTACT_US: "Fale conosco", CALL_NOW: "Ligar agora", GET_OFFER: "Ver oferta", GET_QUOTE: "Pedir orçamento", ORDER_NOW: "Pedir agora",
  APPLY_NOW: "Inscreva-se", DOWNLOAD: "Baixar", WATCH_MORE: "Assistir mais", GET_DIRECTIONS: "Como chegar", NO_BUTTON: "Sem botão", SEE_MENU: "Ver cardápio",
};
export function rotuloCta(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const k = v.trim().toUpperCase();
  return CTA[k] ?? k.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
