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
// APP_ACCESS_MODE=public permite acesso sem código por escolha explícita do dono.
// Com o app aberto ao público, o dono pode criar o código pelo próprio app (POST /api/auth/definir): o código vira
// hash scrypt no banco e, a partir daí, o app fica protegido (sem precisar mexer na Vercel). APP_ACCESS_CODE da Vercel,
// se existir, continua valendo junto (é o caminho de recuperação se o código do app for esquecido).
//
// Limites e dedupe são em memória por instância da função: protegem de
// loop/duplo clique, não são uma cota global.
const crypto = require('crypto');

const TOKEN_TTL_S = 14 * 24 * 3600;

const MIN_CODIGO = 10;
const code = () => process.env.APP_ACCESS_CODE || '';
const publicado = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';

// ── Código criado no app (fica no banco, separado da configuração da conta) ──
const CONTA_ACESSO = '__acesso';
let dono = null; let donoEm = 0;
// Sem banco durável (computador local, testes) não há o que ler: decide na hora, sem esperar.
function donoEmDia(forcar = false) {
  if (!forcar && Date.now() - donoEm < 30000) return true;
  let a = null; try { a = require('./armazem').armazem(); } catch { /* sem armazém */ }
  if (!a?.duravel) { donoEm = Date.now(); return true; }
  return false;
}
async function carregarDono(forcar = false) {
  if (donoEmDia(forcar)) return dono;
  try {
    const a = require('./armazem').armazem();
    if (a?.duravel) { const c = await a.config.obter(CONTA_ACESSO); dono = c?.dono?.hash ? c.dono : null; }
    donoEm = Date.now();
  } catch (e) { console.error('[acesso] não leu o código do app:', String(e.message).slice(0, 100)); }
  return dono;
}
const hashCodigo = (codigo, sal) => crypto.scryptSync(String(codigo), Buffer.from(sal, 'hex'), 32).toString('hex');

const envValido = () => code().length >= MIN_CODIGO;
const codigoValido = () => envValido() || !!dono;
const acessoPublico = () => process.env.APP_ACCESS_MODE === 'public' && !dono;
const secret = () => crypto.createHash('sha256').update(`pico|${envValido() ? code() : dono?.hash || ''}|${process.env.APP_TOKEN_SALT || ''}`).digest();
const protegido = () => !acessoPublico() && codigoValido();

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
  if (envValido() && crypto.timingSafeEqual(a, b)) return true;
  if (!dono) return false;
  const h = Buffer.from(hashCodigo(String(tentativa || '').slice(0, 200), dono.sal), 'hex');
  return crypto.timingSafeEqual(h, Buffer.from(dono.hash, 'hex'));
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
// /api/publico/midia: a Meta baixa as imagens daqui SEM o código do Pedro; a rota só entrega
// com um token assinado (HMAC) que amarra o conteúdo, o hash aprovado e o slide, e expira.
const ROTAS_LIVRES = [/^\/api\/health$/, /^\/health$/, /^\/api\/auth\//, /^\/api\/publico\/midia\/[\w.-]+\.jpg$/, /^\/api\/publico\/video\/[\w.-]+\.mp4$/, /^\/api\/studio\/worker\/st_[a-f0-9]{24}$/];
// Rotas agendadas na Vercel: só passam com o CRON_SECRET que a própria Vercel envia.
const ROTAS_CRON = [/^\/api\/content-finder\/mine$/, /^\/api\/trending\/mine$/, /^\/api\/publish\/cron$/, /^\/api\/monitor\/tick$/, /^\/api\/radar\/cron$/, /^\/api\/top\/piloto\/rodada$/];

const estadoAcesso = () => (acessoPublico() ? 'aberto_publico' : codigoValido() ? 'protegido' : publicado() ? 'nao_configurado' : 'aberto_local');
const aberto = (estado) => estado === 'aberto_local' || estado === 'aberto_publico';

function exigeAcesso(req, res, next) {
  if (!donoEmDia()) return carregarDono().then(() => decidirAcesso(req, res, next), () => decidirAcesso(req, res, next));
  return decidirAcesso(req, res, next);
}
function decidirAcesso(req, res, next) {
  const path = (req.originalUrl || req.path || req.url || '').split('?')[0];
  if (ROTAS_LIVRES.some((r) => r.test(path))) return next();
  const est = estadoAcesso();
  if (aberto(est)) return next();
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
  r.get('/status', async (req, res) => {
    await carregarDono();
    const est = estadoAcesso();
    res.json({ protected: est === 'protegido', configured: est !== 'nao_configurado', estado: est, authenticated: est === 'protegido' ? !!verify(tokenDe(req)) : aberto(est) });
  });
  r.post('/login', async (req, res) => {
    await carregarDono();
    const est = estadoAcesso();
    if (est === 'nao_configurado') return res.status(503).json({ error: 'Configuração necessária: defina APP_ACCESS_CODE no servidor.', code: 'ACCESS_NOT_CONFIGURED' });
    if (aberto(est)) return res.json({ protected: false });
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
  // Fecha o app pelo próprio app: só enquanto ele está aberto ao público (depois disso, só com o código).
  r.post('/definir', async (req, res) => {
    try {
      const a = require('./armazem').armazem();
      if (!a?.duravel) return res.status(503).json({ error: 'Sem banco de dados no servidor para guardar o código.', code: 'SEM_ARMAZEM' });
      await carregarDono(true);
      if (estadoAcesso() !== 'aberto_publico') return res.status(409).json({ error: 'O app já tem código de acesso. Entre com ele.', code: 'JA_PROTEGIDO' });
      const codigo = String(req.body?.code || '');
      if (codigo.trim().length < MIN_CODIGO || codigo.length > 128) return res.status(400).json({ error: `O código precisa ter de ${MIN_CODIGO} a 128 caracteres.`, code: 'CODIGO_CURTO' });
      const sal = crypto.randomBytes(16).toString('hex');
      const novo = { hash: hashCodigo(codigo, sal), sal, criado_em: new Date().toISOString() };
      await a.config.salvar(CONTA_ACESSO, { dono: novo });
      dono = novo; donoEm = Date.now();
      const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
      res.json({ protected: true, token: sign({ sub: 'pedro', exp }), expires_at: exp });
    } catch (e) { res.status(500).json({ error: 'Não foi possível guardar o código.', code: 'ACESSO' }); }
  });
  app.use('/api/auth', r);
}

module.exports = { exigeAcesso, limita, unica, registrarRotas, protegido, estadoAcesso, carregarDono, sign, verify, codigoConfere, MIN_CODIGO, _zerarDono: () => { dono = null; donoEm = 0; } };
