// Avanteza ID — verificador do login único (SSO). Sem dependências (Node 18+).
// A Central (app.avanteza.com.br) assina um JWT ES256 de curta duração (60 s) para UM aplicativo (aud).
// Cada aplicativo confere a assinatura com a chave pública publicada em /.well-known/jwks.json,
// e então cria a própria sessão local. Nenhum segredo é compartilhado entre os aplicativos.
//
// Uso (qualquer backend Node):
//   const { verifyAvantezaToken, authorizeUrl } = require("./avanteza-sso");
//   const user = await verifyAvantezaToken(token, { audience: "crm" });  // { email, name, role, returnTo }
//   // sem sessão local → redirecione para authorizeUrl("crm", "/caminho/de/volta")
const crypto = require("node:crypto");

const HUB = (process.env.AVANTEZA_HUB_URL || "https://app.avanteza.com.br").replace(/\/$/, "");
const ISSUER = "avanteza-id";
let cache = { at: 0, keys: [] };

async function getKeys(force) {
  if (!force && cache.keys.length && Date.now() - cache.at < 10 * 60 * 1000) return cache.keys;
  const res = await fetch(`${HUB}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS indisponível (${res.status})`);
  const body = await res.json();
  cache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  return cache.keys;
}

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/** Confere assinatura, emissor, destinatário e validade. Lança erro se algo não bater. */
async function verifyAvantezaToken(token, { audience, keys } = {}) {
  if (!audience) throw new Error("audience obrigatório");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("token malformado");
  const header = b64json(parts[0]);
  if (header.alg !== "ES256") throw new Error("algoritmo não aceito");
  const find = (list) => list.find((k) => k.kid === header.kid && k.kty === "EC" && k.crv === "P-256");
  let jwk = find(keys || (await getKeys(false)));
  if (!jwk && !keys) jwk = find(await getKeys(true)); // chave trocada: busca de novo
  if (!jwk) throw new Error("chave desconhecida");
  const ok = crypto.verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: crypto.createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new Error("assinatura inválida");
  const p = b64json(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== ISSUER) throw new Error("emissor inválido");
  if (p.aud !== audience) throw new Error("token emitido para outro aplicativo");
  if (typeof p.exp !== "number" || p.exp < now - 5) throw new Error("token expirado");
  if (typeof p.iat === "number" && p.iat > now + 60) throw new Error("token do futuro");
  if (!p.sub) throw new Error("token sem usuário");
  const ret = typeof p.ret === "string" && p.ret.startsWith("/") && !p.ret.startsWith("//") ? p.ret : "/";
  return { email: String(p.sub).toLowerCase(), name: p.name || "", role: p.role || "member", returnTo: ret, jti: p.jti };
}

/** Endereço da Central que inicia o login para este aplicativo. */
function authorizeUrl(appId, returnTo = "/") {
  const u = new URL(`${HUB}/sso/authorize`);
  u.searchParams.set("app", appId);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

module.exports = { verifyAvantezaToken, authorizeUrl, HUB, ISSUER };
