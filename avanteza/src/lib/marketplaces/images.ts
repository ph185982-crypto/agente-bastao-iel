// Fotos de produto vindas das APIs dos marketplaces: só URLs http/https válidas, sempre normalizadas para https.
// Nada de javascript:, data:, credenciais embutidas ou URLs gigantes — o valor vai direto para <img src>.

const MAX_URL = 2048;

/** Retorna a URL em https ou null se não for uma URL de imagem aceitável. */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s || s.length > MAX_URL || /[\s<>"'`\\]/.test(s)) return null;
  if (s.startsWith("//")) s = `https:${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !u.hostname) return null;
  u.protocol = "https:";
  return u.toString();
}

/** Primeira URL válida da lista (a miniatura). */
export function firstImage(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = safeImageUrl(c);
    if (s) return s;
  }
  return null;
}

/** Até `max` URLs válidas, sem repetição, na ordem original. */
export function imageList(candidates: unknown[], max = 6): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    const s = safeImageUrl(c);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
