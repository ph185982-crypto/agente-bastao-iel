// Web Push (PWA): UMA notificação por lote, não uma por item.
// Gratuito (sem serviço contratado). As assinaturas ficam no banco do servidor.
// No iPhone só funciona com o app adicionado à Tela de Início (iOS 16.4+).
// Chaves VAPID só no servidor (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const MAX_ASSINATURAS = 10;
const conta = () => ACCOUNT.ig_id;

const configurado = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const chavePublica = () => process.env.VAPID_PUBLIC_KEY || null;

function assinaturaValida(s) {
  if (!s || typeof s !== 'object') return null;
  let u;
  try { u = new URL(String(s.endpoint || '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
  if (s.keys.p256dh.length > 200 || s.keys.auth.length > 100 || String(s.endpoint).length > 1000) return null;
  return { endpoint: String(s.endpoint), keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

async function lista() {
  const a = armazem();
  if (!a) return [];
  return (await a.config.obter(conta())).push_subs || [];
}

async function salvarAssinatura(s) {
  const a = armazem();
  if (!a?.duravel) throw Object.assign(new Error('Notificações precisam do banco de dados no servidor para lembrar o aparelho.'), { status: 503 });
  const ok = assinaturaValida(s);
  if (!ok) throw Object.assign(new Error('Assinatura de notificação inválida.'), { status: 400 });
  const atuais = (await lista()).filter((x) => x.endpoint !== ok.endpoint);
  const novas = [{ ...ok, criada_em: new Date().toISOString() }, ...atuais].slice(0, MAX_ASSINATURAS);
  await a.config.salvar(conta(), { push_subs: novas });
  return novas.length;
}

async function removerAssinatura(endpoint) {
  const a = armazem();
  if (!a) return 0;
  const novas = (await lista()).filter((x) => x.endpoint !== endpoint);
  await a.config.salvar(conta(), { push_subs: novas });
  return novas.length;
}

// sender é injetável nos testes; em produção usa a biblioteca web-push.
async function notificarLote(n, { sender } = {}) {
  if (!configurado()) return { enviadas: 0, motivo: 'VAPID não configurado' };
  const envio = sender || (() => {
    const wp = require('web-push');
    wp.setVapidDetails(process.env.VAPID_SUBJECT || (process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL : 'mailto:contato@exemplo.invalid'), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    return (sub, payload) => wp.sendNotification(sub, payload, { TTL: 6 * 3600 });
  })();
  const quantos = Math.max(1, Math.min(99, Number(n) || 1));
  const payload = JSON.stringify({
    titulo: 'Pedro Destrava',
    corpo: quantos === 1 ? '1 conteúdo novo para aprovar' : `${quantos} conteúdos novos para aprovar`,
    url: '/?tab=central', n: quantos, tag: 'lote-aprovacao',
  });
  const subs = await lista();
  let enviadas = 0; const mortas = [];
  for (const s of subs) {
    try { await envio(s, payload); enviadas += 1; }
    catch (e) { if ([404, 410].includes(e.statusCode)) mortas.push(s.endpoint); }
  }
  if (mortas.length) { const a = armazem(); await a.config.salvar(conta(), { push_subs: subs.filter((s) => !mortas.includes(s.endpoint)) }); }
  return { enviadas, removidas: mortas.length };
}

module.exports = { configurado, chavePublica, salvarAssinatura, removerAssinatura, notificarLote, assinaturaValida, lista };
