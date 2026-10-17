// Controle de acesso, limites de consumo e dedupe de chamadas.
//
// Acesso: um código único (APP_ACCESS_CODE, só no servidor). O login troca o
// código por um token assinado (HMAC) com validade; o código nunca volta pro
// navegador. Sem APP_ACCESS_CODE configurado o acesso fica ABERTO e a API
// avisa isso (status.protected=false), porque travar a ferramenta no deploy
// sem o Pedro ter definido o código o deixaria de fora.
//
// Limites e dedupe são em memória por instância da função: protegem de
// loop/duplo clique, não são uma cota global.
const crypto = require('crypto');

const TOKEN_TTL_S = 14 * 24 * 3600;

const code = () => process.env.APP_ACCESS_CODE || '';
const secret = () => crypto.createHash('sha256').update(`pico|${code()}|${process.env.APP_TOKEN_SALT || ''}`).digest();
const protegido = () => !!code();

const b64 = (b) => Buffer.from(b).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const esperado = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function codigoConfere(tentativa) {
  const a = crypto.createHash('sha256').update(String(tentativa || '')).digest();
  const b = crypto.createHash('sha256').update(code()).digest();
  return crypto.timingSafeEqual(a, b);
}

const tokenDe = (req) => {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

const ipDe = (req) => String(req.headers?.['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '?').split(',')[0].trim();

// ── Limite de tentativas de login ────────────────────────────────────────────
const falhas = new Map(); // ip -> { n, ate }
function loginBloqueado(ip) {
  const f = falhas.get(ip);
  return !!(f && f.n >= 5 && f.ate > Date.now());
}
function registraFalha(ip) {
  const f = falhas.get(ip) || { n: 0, ate: 0 };
  f.n += 1;
  f.ate = Date.now() + 15 * 60e3;
  falhas.set(ip, f);
}

// ── Middleware ──────────────────────────────────────────────────────────────
const ROTAS_LIVRES = [/^\/api\/health$/, /^\/health$/, /^\/api\/auth\//];

function exigeAcesso(req, res, next) {
  if (!protegido()) return next();
  const path = req.path.startsWith('/api') ? req.path : req.originalUrl.split('?')[0];
  if (ROTAS_LIVRES.some((r) => r.test(path))) return next();
  if (verify(tokenDe(req))) return next();
  return res.status(401).json({ error: 'Acesso restrito. Entre com o código de acesso.', code: 'AUTH_REQUIRED' });
}

// ── Limite de consumo por cliente ───────────────────────────────────────────
const janelas = new Map(); // chave -> [timestamps]
function limita({ max, janelaMs, nome }) {
  return (req, res, next) => {
    const quem = verify(tokenDe(req))?.sub || ipDe(req);
    const chave = `${nome}|${quem}`;
    const agora = Date.now();
    const lista = (janelas.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= max) {
      res.set('Retry-After', String(Math.ceil(janelaMs / 1000)));
      return res.status(429).json({ error: `Muitas chamadas seguidas (${nome}). Espere um minuto e tente de novo.`, code: 'RATE_LIMIT' });
    }
    lista.push(agora);
    janelas.set(chave, lista);
    next();
  };
}

// ── Chamada duplicada: mesmo request_id devolve o mesmo resultado ───────────
const recentes = new Map(); // id -> { at, promise }
function unica(id, fn, ttlMs = 120000) {
  const agora = Date.now();
  for (const [k, v] of recentes) if (agora - v.at > ttlMs) recentes.delete(k);
  if (!id) return fn();
  const hit = recentes.get(id);
  if (hit) return hit.promise;
  const promise = Promise.resolve().then(fn);
  recentes.set(id, { at: agora, promise });
  // Falha não fica em cache: permite tentar de novo.
  promise.catch(() => recentes.delete(id));
  return promise;
}

function registrarRotas(app) {
  const express = require('express');
  const r = express.Router();
  r.get('/status', (req, res) => {
    res.json({ protected: protegido(), authenticated: protegido() ? !!verify(tokenDe(req)) : true });
  });
  r.post('/login', (req, res) => {
    if (!protegido()) return res.json({ protected: false });
    const ip = ipDe(req);
    if (loginBloqueado(ip)) return res.status(429).json({ error: 'Muitas tentativas. Tente de novo em 15 minutos.' });
    if (!codigoConfere(req.body?.code)) {
      registraFalha(ip);
      return res.status(401).json({ error: 'Código incorreto.' });
    }
    falhas.delete(ip);
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
    res.json({ protected: true, token: sign({ sub: 'pedro', exp }), expires_at: exp });
  });
  app.use('/api/auth', r);
}

module.exports = { exigeAcesso, limita, unica, registrarRotas, protegido, sign, verify, codigoConfere };
