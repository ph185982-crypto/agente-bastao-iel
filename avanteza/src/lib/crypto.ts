// Criptografia simétrica AES-256-GCM para tokens dos clientes.
// Formato armazenado: "v1:<iv base64>:<tag base64>:<cifra base64>".
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

function getKey(raw?: string): Buffer {
  const value = raw ?? process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("ENCRYPTION_KEY não configurada");
  // Aceita base64 (recomendado: `openssl rand -base64 32`) ou hex de 64 caracteres.
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes (base64 ou hex)");
  return key;
}

export function encrypt(plain: string, rawKey?: string): string {
  const key = getKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string, rawKey?: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Formato de cifra inválido");
  const key = getKey(rawKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Comparação em tempo constante (para CRON_SECRET etc.). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
