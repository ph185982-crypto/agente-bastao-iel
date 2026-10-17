// Identidade da conta que a ferramenta serve. Fonte única: nenhum módulo novo
// lê PROFILE_HANDLE/PROFILE_NAME direto do ambiente. Em 16/10/2026 essa
// variável estava como @pedrodestrava (outra conta, 1,7 mil seguidores) em
// produção e o @ errado saiu em artes e em legendas já publicadas. Agora o
// handle é fixo no código e o ambiente só pode CONFIRMAR, nunca trocar.
const axios = require('axios');

const ACCOUNT = Object.freeze({
  username: 'pedro_destrava',
  handle: '@pedro_destrava',
  ig_id: '74541076144',        // id numérico confirmado na API em 17/10/2026
  nome: 'Pedro Martins',
  verified: false,              // is_verified=false na API: nenhum selo pode ser desenhado
});

const SCHEMA_VERSION = 1;

const norm = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

// Detecta o @ errado no ambiente sem trocar a identidade.
function envHandleProblem(env = process.env) {
  const v = env.PROFILE_HANDLE;
  if (v && norm(v) !== ACCOUNT.username) {
    return `PROFILE_HANDLE="${v}" não é ${ACCOUNT.handle}; o código ignora esse valor`;
  }
  const u = env.INSTAGRAM_USERNAME;
  if (u && norm(u) !== ACCOUNT.username) {
    return `INSTAGRAM_USERNAME="${u}" não é ${ACCOUNT.username}; o código ignora esse valor`;
  }
  return null;
}
{
  const p = envHandleProblem();
  if (p) console.error(`[account] ${p}`);
}

// Substitui o @ errado conhecido em qualquer texto. Só usado pra AVISAR e
// bloquear (gates), nunca pra corrigir calado.
const HANDLES_ERRADOS = ['pedrodestrava'];
function achaHandleErrado(texto) {
  const t = String(texto || '').toLowerCase();
  return HANDLES_ERRADOS.filter((h) => new RegExp(`@${h}(?![a-z0-9_])`).test(t));
}

// Confirma na API que o perfil lido é o certo. O resultado carrega a origem
// (usuário, id, quando) e é a ÚNICA forma de um dado do Instagram entrar.
let _conf = null;
async function confirmAccount({ force = false, getProfile } = {}) {
  if (!force && _conf && Date.now() - _conf.checked_at_ms < 6 * 3600e3) return _conf.value;
  const fetchProfile = getProfile || (async () => {
    const key = process.env.RAPIDAPI_KEY_INSTAGRAM || process.env.RAPIDAPI_KEY;
    if (!key) throw new Error('Chave da API do Instagram não configurada.');
    const host = 'instagram-looter2.p.rapidapi.com';
    const { data } = await axios.get(`https://${host}/profile`, {
      params: { username: ACCOUNT.username },
      headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key },
      timeout: 25000,
    });
    if (data?.status === false) throw new Error(data.errorMessage || 'API recusou a consulta');
    return data;
  });
  const d = await fetchProfile();
  const ok = norm(d.username) === ACCOUNT.username && String(d.id) === ACCOUNT.ig_id;
  const value = {
    ok,
    username: d.username,
    ig_id: String(d.id),
    seguidores: d.edge_followed_by?.count ?? null,
    verified: !!d.is_verified,
    esperado: { username: ACCOUNT.username, ig_id: ACCOUNT.ig_id },
    schema: SCHEMA_VERSION,
    checked_at: new Date().toISOString(),
  };
  if (!ok) {
    const e = new Error(`A API devolveu ${d.username} (${d.id}), não ${ACCOUNT.handle} (${ACCOUNT.ig_id}). Nada foi lido.`);
    e.code = 'ACCOUNT_MISMATCH';
    e.detail = value;
    throw e;
  }
  _conf = { value, checked_at_ms: Date.now() };
  return value;
}

// Selo atual da conta: confirmado só se a API acabou de dizer.
const accountTag = (conf) => ({
  username: ACCOUNT.username,
  handle: ACCOUNT.handle,
  ig_id: ACCOUNT.ig_id,
  confirmed_at: conf?.checked_at || null,
  source: conf ? 'api' : 'codigo',
});

module.exports = { ACCOUNT, SCHEMA_VERSION, envHandleProblem, achaHandleErrado, confirmAccount, accountTag, norm };
