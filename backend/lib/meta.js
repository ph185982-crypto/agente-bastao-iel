// Cliente da Meta Graph API (Instagram API com Facebook Login) e URLs de mídia assinadas.
//
// Conferido na documentação oficial em 21/10/2026
// (developers.facebook.com/docs/instagram-platform/content-publishing):
//  - host graph.facebook.com, token de Página, permissões instagram_basic,
//    instagram_content_publish e pages_read_engagement;
//  - só JPEG para imagem; carrossel de até 20 itens; legenda até 2.200 caracteres
//    e 30 hashtags; container expira em 24 h; status IN_PROGRESS/FINISHED/ERROR/EXPIRED/PUBLISHED;
//  - limite de publicações por API: a página diz 100 por 24 h em um trecho e 50 em
//    outro. NÃO fixamos o número: lemos content_publishing_limit na hora;
//  - as versões da API aparecem como v26.0 nos exemplos; fica em META_GRAPH_VERSION.
// Segredos (token, app secret, PUBLISH_SECRET) só existem no servidor e nunca saem
// em resposta, log ou mensagem de erro.
const crypto = require('crypto');
const axios = require('axios');

const VERSAO = () => process.env.META_GRAPH_VERSION || 'v26.0';
// A base só pode ser trocada fora da Vercel (testes locais com servidor falso).
const BASE = () => (!process.env.VERCEL && process.env.META_GRAPH_BASE) || 'https://graph.facebook.com';

const config = () => ({
  token: process.env.META_PAGE_ACCESS_TOKEN || '',
  pageId: process.env.META_PAGE_ID || '',
  igId: process.env.META_IG_USER_ID || '',
  appId: process.env.META_APP_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
});

const OBRIGATORIAS = ['META_PAGE_ACCESS_TOKEN', 'META_IG_USER_ID', 'PUBLISH_SECRET'];
const faltando = () => OBRIGATORIAS.filter((k) => !process.env[k]);

// appsecret_proof: prova de que a chamada vem do servidor do app (recomendado pela Meta).
const proof = (token, secret) => crypto.createHmac('sha256', secret).update(token).digest('hex');

// Erro da Meta → { code, subcode, mensagem_original, amigavel, tipo }
function interpretarErro(e) {
  const err = e?.response?.data?.error || {};
  const code = err.code ?? null;
  const sub = err.error_subcode ?? null;
  const original = String(err.message || e?.message || 'Erro desconhecido').replace(/access_token=[^&\s"]+/gi, 'access_token=***').slice(0, 400);
  let tipo = 'outro';
  let amigavel = 'A Meta recusou a publicação. Veja a mensagem original abaixo.';
  if (code === 190 || e?.response?.status === 401) { tipo = 'token'; amigavel = 'O acesso ao Instagram expirou ou foi revogado. Reconecte o Instagram.'; }
  else if ([4, 17, 32, 613].includes(code) || sub === 2207051) { tipo = 'limite'; amigavel = 'A Meta limitou as chamadas ou as publicações por agora. Espere e tente de novo.'; }
  else if (code === 10 || code === 200 || sub === 2207050) { tipo = 'permissao'; amigavel = 'Falta permissão para publicar neste perfil (instagram_content_publish) ou a conta não é Business.'; }
  else if (sub === 2207026 || sub === 2207023) { tipo = 'midia'; amigavel = 'A Meta não aceitou o formato do arquivo. Imagens precisam ser JPEG; vídeos, MP4 (H.264 + AAC).'; }
  else if (sub === 2207003 || sub === 2207020 || /timeout|ECONNABORTED/i.test(original)) { tipo = 'download'; amigavel = 'A Meta não conseguiu baixar a mídia a tempo. Tente de novo.'; }
  else if (sub === 36003 || sub === 2207009) { tipo = 'proporcao'; amigavel = 'A proporção da imagem não é aceita pela Meta (use entre 4:5 e 1,91:1).'; }
  else if (sub === 2207027 || code === 9007) { tipo = 'nao_pronto'; amigavel = 'A mídia ainda estava sendo processada pela Meta. Aguarde e tente de novo.'; }
  else if (e?.code === 'ECONNABORTED' || e?.code === 'ECONNRESET' || !e?.response) { tipo = 'rede'; amigavel = 'Não consegui falar com a Meta agora. Tente de novo em instantes.'; }
  return { code, subcode: sub, fbtrace_id: err.fbtrace_id || null, mensagem_original: original, amigavel, tipo };
}

async function graph(metodo, caminho, params = {}, { semProof = false } = {}) {
  const c = config();
  if (!c.token) throw Object.assign(new Error('META_PAGE_ACCESS_TOKEN não configurado.'), { meta: { tipo: 'config', amigavel: 'O token da Meta não está configurado no servidor.' } });
  const url = `${BASE()}/${VERSAO()}/${String(caminho).replace(/^\//, '')}`;
  const base = { access_token: c.token, ...(c.appSecret && !semProof ? { appsecret_proof: proof(c.token, c.appSecret) } : {}) };
  try {
    const r = await axios.request({
      method: metodo, url, timeout: 20000,
      ...(metodo === 'GET' ? { params: { ...base, ...params } } : { data: new URLSearchParams({ ...base, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    });
    return r.data;
  } catch (e) {
    throw Object.assign(new Error(interpretarErro(e).amigavel), { meta: interpretarErro(e) });
  }
}

// ── URLs de mídia assinadas ─────────────────────────────────────────────────
// A Meta baixa a mídia por URL pública. Em vez de guardar arquivos num serviço
// pago, o servidor desenha o JPEG na hora a partir da versão APROVADA. O token
// amarra a URL ao conteúdo, ao hash da versão aprovada e ao slide, e expira.
const segredoMidia = () => crypto.createHash('sha256').update(`pico-midia|${process.env.PUBLISH_SECRET || ''}`).digest();
const b64 = (s) => Buffer.from(s).toString('base64url');

function assinarMidia({ conteudo, hash, indice, ttlS = 2 * 3600 }) {
  const corpo = b64(JSON.stringify({ c: conteudo, h: hash, i: indice, e: Math.floor(Date.now() / 1000) + ttlS }));
  const mac = crypto.createHmac('sha256', segredoMidia()).update(corpo).digest('base64url');
  return `${corpo}.${mac}`;
}
function verificarMidia(token) {
  if (!process.env.PUBLISH_SECRET || typeof token !== 'string' || !token.includes('.')) return null;
  const [corpo, mac] = token.split('.');
  const esperado = crypto.createHmac('sha256', segredoMidia()).update(corpo).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return p.e > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

module.exports = { graph, config, faltando, interpretarErro, assinarMidia, verificarMidia, proof, VERSAO, OBRIGATORIAS };
