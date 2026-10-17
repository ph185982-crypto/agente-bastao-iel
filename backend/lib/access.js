// Controle de acesso, limites de consumo e dedupe de chamadas.
//
// Acesso: um código único (APP_ACCESS_CODE, só no servidor). O login troca o
// código por um token assinado (HMAC) com validade; o código nunca volta pro
// navegador. Trocar o código invalida todos os tokens emitidos.
//
// Em ambiente publicado (Vercel ou NODE_ENV=production), sem código válido a API
// privada fica FECHADA com "configuração necessária" (503): nada que consuma
// IA, leia URLs ou guarde dados roda aberto. Só no computador de quem
// desenvolve (sem VERCEL) a ausência do código deixa a API aberta.
//
// Limites e dedupe são em memória por instância da função: protegem de
// loop/duplo clique, não são uma cota global.
const crypto = require('crypto');

const TOKEN_TTL_S = 14 * 24 * 3600;

const MIN_CODIGO = 10;
const code = () => process.env.APP_ACCESS_CODE || '';
const publicado = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';
const codigoValido = () => code().length >= MIN_CODIGO;
const secret = () => crypto.createHash('sha256').update(`pico|${code()}|${process.env.APP_TOKEN_SALT || ''}`).digest();
const protegido = () => codigoValido();

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
// Rotas agendadas na Vercel: só passam com o CRON_SECRET que a própria Vercel envia.
const ROTAS_CRON = [/^\/api\/content-finder\/mine$/, /^\/api\/trending\/mine$/];

const estadoAcesso = () => (codigoValido() ? 'protegido' : publicado() ? 'nao_configurado' : 'aberto_local');

function exigeAcesso(req, res, next) {
  const path = (req.originalUrl || req.path || req.url || '').split('?')[0];
  if (ROTAS_LIVRES.some((r) => r.test(path))) return next();
  const est = estadoAcesso();
  if (est === 'aberto_local') return next();
  if (est === 'nao_configurado') {
    return res.status(503).json({ error: `Configuração necessária: o servidor está sem código de acesso válido (APP_ACCESS_CODE com pelo menos ${MIN_CODIGO} caracteres). Até isso ser definido, operações privadas ficam bloqueadas.`, code: 'ACCESS_NOT_CONFIGURED' });
  }
  if (process.env.CRON_SECRET && ROTAS_CRON.some((r) => r.test(path)) && req.headers?.authorization === `Bearer ${process.env.CRON_SECRET}`) return next();
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
    const est = estadoAcesso();
    res.json({ protected: est === 'protegido', configured: est !== 'nao_configurado', estado: est, authenticated: est === 'protegido' ? !!verify(tokenDe(req)) : est === 'aberto_local' });
  });
  r.post('/login', (req, res) => {
    const est = estadoAcesso();
    if (est === 'nao_configurado') return res.status(503).json({ error: 'Configuração necessária: defina APP_ACCESS_CODE no servidor.', code: 'ACCESS_NOT_CONFIGURED' });
    if (est === 'aberto_local') return res.json({ protected: false });
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

module.exports = { exigeAcesso, limita, unica, registrarRotas, protegido, estadoAcesso, sign, verify, codigoConfere, MIN_CODIGO };
