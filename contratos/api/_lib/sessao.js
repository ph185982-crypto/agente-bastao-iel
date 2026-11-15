// Sessão local da ferramenta Contratos (cookie assinado, sem banco e sem dependências).
// Valor do cookie: <payload em base64url>.<HMAC-SHA256 em base64url>, assinado com SESSION_SECRET.
// O payload guarda e-mail, nome e a expiração (em segundos desde 1970).
const crypto = require('node:crypto');

const NOME_COOKIE = 'avz_contratos';
const DURACAO_S = 12 * 60 * 60; // 12 horas
const TAMANHO_MINIMO_SEGREDO = 32;

/** Segredo da sessão; null quando ausente ou curto demais (login único indisponível). */
function segredoSessao() {
  const s = process.env.SESSION_SECRET || '';
  return s.length >= TAMANHO_MINIMO_SEGREDO ? s : null;
}

const hmac = (texto, segredo) => crypto.createHmac('sha256', segredo).update(texto).digest('base64url');

/** Comparação em tempo constante de dois textos (compara os resumos, então o tamanho não vaza). */
function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Monta o valor assinado do cookie. `agora` em milissegundos (injetável nos testes). */
function assinarSessao({ email, nome }, segredo = segredoSessao(), agora = Date.now()) {
  if (!segredo) throw new Error('SESSION_SECRET ausente');
  if (!email) throw new Error('sessão sem e-mail');
  const exp = Math.floor(agora / 1000) + DURACAO_S;
  const payload = Buffer.from(JSON.stringify({ email, nome: nome || '', exp }), 'utf8').toString('base64url');
  return `${payload}.${hmac(payload, segredo)}`;
}

/** Confere assinatura e validade de um valor de cookie. Devolve { email, nome, exp } ou null. */
function lerValorSessao(valor, segredo = segredoSessao(), agora = Date.now()) {
  if (!segredo || typeof valor !== 'string') return null;
  const partes = valor.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  if (!iguais(partes[1], hmac(partes[0], segredo))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!p || typeof p.email !== 'string' || !p.email) return null;
  if (typeof p.exp !== 'number' || p.exp <= Math.floor(agora / 1000)) return null;
  return { email: p.email, nome: typeof p.nome === 'string' ? p.nome : '', exp: p.exp };
}

/** Lê os cookies do cabeçalho da requisição. */
function cookies(req) {
  const out = {};
  const bruto = (req && req.headers && req.headers.cookie) || '';
  for (const parte of String(bruto).split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (nome && !(nome in out)) out[nome] = parte.slice(i + 1).trim();
  }
  return out;
}

/** Sessão válida da requisição ({ email, nome, exp }) ou null. */
function lerSessao(req) {
  return lerValorSessao(cookies(req)[NOME_COOKIE]);
}

const ATRIBUTOS = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const cookieDeSessao = (valor) => `${NOME_COOKIE}=${valor}; ${ATRIBUTOS}; Max-Age=${DURACAO_S}`;
const cookieDeSaida = () => `${NOME_COOKIE}=; ${ATRIBUTOS}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

/** true quando o cabeçalho x-nexo-pin confere com NEXO_PIN (acesso de reserva). */
function pinConfere(req) {
  const pin = process.env.NEXO_PIN;
  const enviado = req && req.headers && req.headers['x-nexo-pin'];
  if (!pin || typeof enviado !== 'string' || !enviado) return false;
  return iguais(enviado, pin);
}

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corpo));
}

/**
 * Libera a requisição com sessão válida OU com o PIN correto.
 * Devolve { tipo: 'sessao', email, nome } ou { tipo: 'pin' }; se negar, já responde (401/500) e devolve null.
 */
function exigirAcesso(req, res) {
  const sessao = lerSessao(req);
  if (sessao) return { tipo: 'sessao', email: sessao.email, nome: sessao.nome };
  if (pinConfere(req)) return { tipo: 'pin' };
  if (!segredoSessao() && !process.env.NEXO_PIN) {
    responder(res, 500, { error: 'server_not_configured', message: 'Configure SESSION_SECRET (login único) ou NEXO_PIN na Vercel.' });
    return null;
  }
  const mandouPin = !!(req.headers && req.headers['x-nexo-pin']);
  responder(res, 401, mandouPin
    ? { error: 'invalid_pin', message: 'PIN inválido.' }
    : { error: 'nao_autenticado', message: 'Entre com Avanteza ou informe o PIN.' });
  return null;
}

module.exports = {
  NOME_COOKIE, DURACAO_S, segredoSessao, assinarSessao, lerValorSessao, lerSessao,
  cookieDeSessao, cookieDeSaida, pinConfere, exigirAcesso,
};
