// ── Cofre persistente (Upstash Redis via REST) ────────────────────────────────
// Wrapper minimalista sobre a REST API do Upstash. Usa axios (já é dependência),
// então não adiciona nada ao bundle. Degrada graciosamente: se as env vars não
// estiverem configuradas, enabled() === false e o app continua funcionando sem cofre.
const axios = require('axios');

const URL   = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const enabled = () => !!(URL && TOKEN);

async function cmd(command) {
  if (!enabled()) throw new Error('Cofre (Upstash) não configurado');
  const { data } = await axios.post(URL, command, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  if (data?.error) throw new Error(`Upstash: ${data.error}`);
  return data?.result;
}

async function getJSON(key) {
  if (!enabled()) return null;
  try {
    const raw = await cmd(['GET', key]);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn(`[vault] getJSON(${key}) falhou: ${e.message}`);
    return null;
  }
}

async function setJSON(key, value) {
  if (!enabled()) return false;
  try {
    await cmd(['SET', key, JSON.stringify(value)]);
    return true;
  } catch (e) {
    console.warn(`[vault] setJSON(${key}) falhou: ${e.message}`);
    return false;
  }
}

module.exports = { enabled, getJSON, setJSON, cmd };
