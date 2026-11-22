// TikTok: o mesmo conteúdo aprovado para o Instagram sai também no TikTok do Pedro (Content Posting API oficial).
//  - Conexão: Login Kit (OAuth 2.0 v2), escopos user.info.basic, video.publish e video.upload. App criado pelo Pedro em
//    developers.tiktok.com; TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Vercel. Token de acesso vale 24 h e é renovado com o
//    refresh token (vale 1 ano); os dois ficam no banco cifrados com AES-256-GCM.
//  - Publicação: carrossel/imagem vai como POST DE FOTOS (PULL_FROM_URL: o TikTok baixa os JPEGs do domínio verificado
//    https://agente-bastao-iel.vercel.app/); vídeo vai por FILE_UPLOAD (o arquivo final fica no Blob, fora do domínio verificado).
//  - Privacidade: usa a mais aberta que o TikTok permitir para a conta (creator_info). App ainda não auditado só pode postar
//    como "Somente eu" (SELF_ONLY): fica registrado e o Pedro é avisado.
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const REDE = 'tiktok';
const ESCOPOS = 'user.info.basic,video.publish,video.upload';
const API = 'https://open.tiktokapis.com';
const conta = () => ACCOUNT.ig_id;
const erro = (msg, status = 400, code = 'TIKTOK') => Object.assign(new Error(msg), { status, code });
const configurado = () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
// Domínio verificado no TikTok (URL prefix): as fotos do carrossel saem daqui.
const baseMidia = () => String(process.env.TIKTOK_MEDIA_BASE || 'https://agente-bastao-iel.vercel.app').replace(/\/$/, '');
const baseApp = () => String(process.env.TIKTOK_REDIRECT_BASE || 'https://agente-bastao-iel.vercel.app').replace(/\/$/, '');
const redirectUri = () => `${baseApp()}/api/tiktok/callback`;

// ── Segredos ────────────────────────────────────────────────────────────────
const chave = () => crypto.createHash('sha256').update(`tiktok|${process.env.TIKTOK_CLIENT_SECRET || ''}|${process.env.APP_TOKEN_SALT || ''}`).digest();
function cifrar(texto) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${dados.toString('base64url')}`;
}
function decifrar(pacote) {
  try {
    const [iv, tag, dados] = String(pacote || '').split('.');
    const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
function novoState(agora = Date.now()) {
  const corpo = Buffer.from(JSON.stringify({ n: crypto.randomBytes(8).toString('hex'), exp: agora + 15 * 60000 })).toString('base64url');
  return `${corpo}.${crypto.createHmac('sha256', chave()).update(corpo).digest('base64url')}`;
}
function stateValido(state, agora = Date.now()) {
  const [corpo, mac] = String(state || '').split('.'); if (!corpo || !mac) return false;
  const esperado = crypto.createHmac('sha256', chave()).update(corpo).digest('base64url');
  if (mac.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(esperado))) return false;
  try { return JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')).exp > agora; } catch { return false; }
}

// ── Configuração guardada ───────────────────────────────────────────────────
async function lerCfg(a = armazem()) { return a?.duravel ? ((await a.config.obter(conta())).tiktok || {}) : {}; }
async function salvarCfg(patch, a = armazem()) {
  if (!a?.duravel) throw erro('O TikTok precisa do banco de dados no servidor.', 503, 'SEM_BANCO');
  const novo = { ...(await lerCfg(a)), ...patch }; await a.config.salvar(conta(), { tiktok: novo }); return novo;
}

// ── Conexão ─────────────────────────────────────────────────────────────────
function urlConectar() {
  if (!configurado()) throw erro('Falta criar o app do TikTok e pôr TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Vercel.', 503, 'SEM_CONFIG');
  const q = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, response_type: 'code', scope: ESCOPOS, redirect_uri: redirectUri(), state: novoState() });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

async function pedirToken(params, f) {
  const r = await f(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...params }).toString() });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw erro(`O TikTok recusou o acesso: ${t.error_description || t.error || r.status}`, 502, 'TOKEN');
  return t;
}
const guardarToken = (t, agora) => ({
  token: cifrar(t.access_token), refresh: t.refresh_token ? cifrar(t.refresh_token) : null,
  expira_em: new Date(agora + (Number(t.expires_in) || 86400) * 1000).toISOString(),
  refresh_expira_em: new Date(agora + (Number(t.refresh_expires_in) || 31536000) * 1000).toISOString(),
  open_id: t.open_id || null, escopos: t.scope || ESCOPOS,
});

async function concluirConexao({ code, state }, { fetch: f = globalThis.fetch, agora = Date.now() } = {}) {
  if (!stateValido(state, agora)) throw erro('O link de conexão expirou. Toque em "Conectar TikTok" de novo.', 400, 'STATE');
  if (!code) throw erro('O TikTok não devolveu a autorização.', 400, 'SEM_CODE');
  const t = await pedirToken({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() }, f);
  let nome = null;
  try {
    const u = await f(`${API}/v2/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    nome = (await u.json().catch(() => ({})))?.data?.user?.display_name || null;
  } catch { /* nome é só para mostrar */ }
  return salvarCfg({ ...guardarToken(t, agora), nome, conectado_em: new Date(agora).toISOString(), ativo: true });
}

// Token de 24 h: renova sozinho quando falta menos de 10 min.
async function tokenAtual({ fetch: f = globalThis.fetch, agora = Date.now(), a = armazem() } = {}) {
  const cfg = await lerCfg(a);
  if (!cfg.token) throw erro('Conecte o TikTok em Perfil → Conexões.', 409, 'NAO_CONECTADO');
  if (Date.parse(cfg.expira_em) - agora > 10 * 60000) { const tk = decifrar(cfg.token); if (tk) return { token: tk, cfg }; }
  const rf = decifrar(cfg.refresh);
  if (!rf || Date.parse(cfg.refresh_expira_em) <= agora) throw erro('O acesso ao TikTok venceu. Conecte de novo em Perfil → Conexões.', 401, 'TOKEN_VENCIDO');
  const t = await pedirToken({ grant_type: 'refresh_token', refresh_token: rf }, f);
  const novo = await salvarCfg(guardarToken(t, agora), a);
  return { token: t.access_token, cfg: novo };
}

async function estado({ agora = Date.now() } = {}) {
  const c = await lerCfg();
  const conectado = !!(c.token && (Date.parse(c.refresh_expira_em) > agora || Date.parse(c.expira_em) > agora));
  return {
    configurado: configurado(), conectado, nome: c.nome || null, ativo: !!c.ativo && conectado,
    venceu: !!c.token && !conectado, redirect_uri: redirectUri(), privacidade: c.ultima_privacidade || null,
  };
}
async function definirAtivo(ativo) { const c = await lerCfg(); if (ativo && !c.token) throw erro('Conecte o TikTok primeiro.', 409, 'NAO_CONECTADO'); return salvarCfg({ ativo: !!ativo }); }
async function desconectar() { return salvarCfg({ token: null, refresh: null, open_id: null, nome: null, expira_em: null, refresh_expira_em: null, ativo: false }); }

// ── Texto ───────────────────────────────────────────────────────────────────
// Legenda do Instagram serve no TikTok, sem "link na bio" e sem chamar para seguir no Instagram.
function textoTikTok(legenda, max = 2200) {
  return String(legenda || '').replace(/\r/g, '').split('\n').filter((l) => !/link na bio/i.test(l)).join('\n')
    .replace(/segue o @pedro_destrava/gi, 'segue o perfil').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
const titulo = (t) => String(t || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

// ── API ─────────────────────────────────────────────────────────────────────
async function chamar(f, token, caminho, corpo) {
  const r = await f(`${API}${caminho}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(corpo || {}) });
  const d = await r.json().catch(() => ({}));
  const code = d?.error?.code;
  if (!r.ok || (code && code !== 'ok')) {
    const msg = code === 'unaudited_client_can_only_post_to_private_accounts' ? 'O app do TikTok ainda não foi auditado: só posta em conta privada. Deixe a conta privada para testar ou envie o app para auditoria.'
      : code === 'spam_risk_too_many_posts' ? 'O TikTok limitou: posts demais hoje nesta conta.'
      : code === 'url_ownership_unverified' ? 'O TikTok não reconhece o domínio das imagens: verifique o prefixo https://agente-bastao-iel.vercel.app/ no app do TikTok.'
      : r.status === 401 || code === 'access_token_invalid' ? 'O acesso ao TikTok venceu ou foi revogado. Conecte de novo em Perfil → Conexões.'
      : `TikTok respondeu ${r.status}${code ? ` (${code})` : ''}: ${String(d?.error?.message || '').slice(0, 160)}`;
    throw erro(msg, r.status >= 400 ? r.status : 502, code || 'TIKTOK');
  }
  return d.data || {};
}
const PREFERENCIA = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
function escolherPrivacidade(opcoes) { const o = Array.isArray(opcoes) ? opcoes : []; return PREFERENCIA.find((p) => o.includes(p)) || 'SELF_ONLY'; }

// Publica o conteúdo aprovado no TikTok. Idempotente (registro em pico_publicacoes, rede 'tiktok').
async function publicar(id, { hash, deps = {} } = {}) {
  const P = require('./publicador'); const a = deps.armazem || armazem(); const f = deps.fetch || globalThis.fetch;
  const { token, cfg } = await tokenAtual({ fetch: f, a });
  const { c, v } = await (deps.carregarAprovado || P.carregarAprovado)(id, hash);
  const existente = await a.publicacoes.obter(conta(), id, REDE);
  if (existente && existente.estado === 'publicada') return P.resposta(existente);
  const dados = { versao: v.id, hash_versao: v.hash, n_slides: v.slides.length, erro: null };
  if (existente) await a.publicacoes.reiniciar(conta(), id, REDE, dados); else { const r = await a.publicacoes.iniciar(conta(), id, REDE, dados); if (!r.criada) return P.resposta(r.pub); }
  try {
    const info = await chamar(f, token, '/v2/post/publish/creator_info/query/', {});
    const privacidade = escolherPrivacidade(info.privacy_level_options);
    const legenda = textoTikTok((deps.montarLegenda || P.montarLegenda)(v));
    let pub;
    if (c.formato === 'reels') {
      const url = c.motion?.url || c.video?.final?.url || null;
      if (!url) throw erro('Vídeo sem arquivo final para mandar ao TikTok.', 409, 'SEM_VIDEO');
      const bytes = Buffer.from(await (await f(url)).arrayBuffer());
      if (bytes.length > 64 * 1048576) throw erro('Vídeo grande demais para um envio (máx. 64 MB).', 413, 'VIDEO_GRANDE');
      pub = await chamar(f, token, '/v2/post/publish/video/init/', { post_info: { title: legenda, privacy_level: privacidade, disable_comment: info.comment_disabled === true, disable_duet: false, disable_stitch: false }, source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 } });
      const up = await f(pub.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes });
      if (!up.ok) throw erro(`Envio do vídeo ao TikTok falhou (${up.status}).`, 502, 'UPLOAD');
    } else {
      const fotos = v.slides.slice(0, 35).map((_, i) => (deps.urlMidia || P.urlMidia)(baseMidia(), c.id, v.hash, i));
      pub = await chamar(f, token, '/v2/post/publish/content/init/', { post_info: { title: titulo(c.titulo || v.slides[0]?.texto), description: legenda.slice(0, 4000), privacy_level: privacidade, disable_comment: info.comment_disabled === true, auto_add_music: true }, source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: fotos }, post_mode: 'DIRECT_POST', media_type: 'PHOTO' });
    }
    if (cfg.ultima_privacidade !== privacidade) await salvarCfg({ ultima_privacidade: privacidade }, a).catch(() => {});
    return P.resposta(await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'publicada', { ig_media_id: pub.publish_id || null, permalink: null, publicada_em: new Date().toISOString(), privacidade }));
  } catch (e) {
    await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'erro', { erro: { amigavel: e.message, codigo: e.code || null } });
    throw e;
  }
}

module.exports = { REDE, ESCOPOS, configurado, redirectUri, baseMidia, urlConectar, concluirConexao, tokenAtual, estado, definirAtivo, desconectar, lerCfg, salvarCfg, publicar, textoTikTok, escolherPrivacidade, cifrar, decifrar, novoState, stateValido };
