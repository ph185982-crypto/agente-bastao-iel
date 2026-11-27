// Raio-X do perfil: leitura COMPLETA e só de leitura dos posts e da conta direto da Meta (Graph API), para o diagnóstico de
// conteúdo. Não grava nada, não publica nada. É chamado pelo workflow .github/workflows/raio-x.yml (token OIDC do runner).
//
// O repositório é PÚBLICO: o log do GitHub Actions também é. Por isso a resposta sai SEMPRE cifrada com a chave pública de quem
// pediu (RSA-OAEP embrulha uma chave AES-256-GCM; o JSON vai comprimido dentro). No log só aparece texto cifrado.
const crypto = require('crypto');
const zlib = require('zlib');
const meta = require('./meta');
const MI = require('./meuInstagram');

const CAMPOS = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url,children{id}';
// Do mais completo para o mais básico: a Meta recusa a lista inteira se UMA métrica não vale para aquele post.
const TENTATIVAS = {
  feed: [['reach', 'saved', 'shares', 'total_interactions', 'views', 'follows', 'profile_visits', 'likes', 'comments', 'reposts'], ['reach', 'saved', 'shares', 'total_interactions', 'views', 'follows', 'profile_visits', 'likes', 'comments'], MI.FEED, ['reach', 'saved', 'shares', 'total_interactions', 'views'], ['reach', 'saved', 'shares', 'total_interactions'], ['reach']],
  reel: [['reach', 'saved', 'shares', 'total_interactions', 'views', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate', 'reposts', 'likes', 'comments'], ['reach', 'saved', 'shares', 'total_interactions', 'views', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'likes', 'comments'], MI.REEL, ['reach', 'saved', 'shares', 'total_interactions', 'views'], ['reach', 'saved', 'shares', 'total_interactions'], ['reach']],
};
const DIA = 86400;
const curto = (e) => String(e?.meta?.mensagem_original || e?.meta?.amigavel || e?.message || e || '').slice(0, 180);

function cifrar(obj, chaveB64) {
  let pub;
  try { pub = crypto.createPublicKey({ key: Buffer.from(String(chaveB64 || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64'), format: 'der', type: 'spki' }); } catch { throw Object.assign(new Error('Chave pública inválida (esperado SPKI DER em base64).'), { status: 400 }); }
  if (pub.asymmetricKeyType !== 'rsa' || (pub.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw Object.assign(new Error('A chave pública precisa ser RSA de 2048 bits ou mais.'), { status: 400 });
  const k = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const dados = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'))), c.final()]);
  const ek = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, k);
  return [ek, iv, c.getAuthTag(), dados].map((b) => b.toString('base64')).join('.');
}
function decifrar(texto, chavePrivadaPem) {
  const [ek, iv, tag, dados] = String(texto).split('.').map((x) => Buffer.from(x, 'base64'));
  const k = crypto.privateDecrypt({ key: chavePrivadaPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ek);
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag);
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(dados), d.final()])).toString('utf8'));
}

async function insights(m, tipo, grafo) {
  const listas = tipo === 'reel' || tipo === 'video' ? TENTATIVAS.reel : TENTATIVAS.feed;
  let erro = null;
  for (const lista of listas) {
    try { return { v: MI.lerValores(await grafo('GET', `${m.id}/insights`, { metric: lista.join(',') })), pedidas: lista.length, erro: null }; } catch (e) {
      erro = curto(e); const t = e.meta?.tipo;
      if (t === 'token' || t === 'permissao' || t === 'limite') break;
    }
  }
  return { v: {}, pedidas: 0, erro };
}
async function emParalelo(itens, n, fn) {
  const out = new Array(itens.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; out[k] = await fn(itens[k]); } }));
  return out;
}

// De que linha da ferramenta saiu cada post (só o que a ferramenta publicou tem ficha).
function tipoDoConteudo(c) {
  if (!c) return null;
  if (c.video) return 'video_editado';
  if (c.frase || c.formato_visual === 'frase') return 'frase';
  if (c.top?.formato === 'marca') return c.top?.entrada?.estilo === 'revelacao' ? 'quem_e_ele' : 'por_tras_da_marca';
  if (c.reciclagem) return 'reciclagem';
  if (c.top) return ['opiniao', 'historia', 'como_fazer', 'caso'].includes(c.top.entrada?.modo) ? `proprio_${c.top.entrada.modo}` : `noticia_${c.top.formato || 'x'}`;
  if (c.formato_visual) return String(c.formato_visual);
  return String(c.origem?.formato || c.origem?.tipo || 'outro');
}

async function fichas(deps = {}, ids = null) {
  const porMidia = new Map();
  try {
    const { armazem } = require('./armazem'); const { ACCOUNT } = require('./account');
    const a = deps.armazem || armazem(); if (!a?.duravel) return porMidia;
    const pubs = await (deps.listarPublicacoes || (() => require('./publicador').listarPublicacoes()))();
    const quero = ids ? new Set([...ids].map(String)) : null;
    const alvo = pubs.filter((p) => p.estado === 'publicada' && p.ig_media_id && (!quero || quero.has(String(p.ig_media_id)))).slice(-700);
    await emParalelo(alvo, 6, async (p) => {
      try {
        const c = (await a.conteudos.obter(ACCOUNT.ig_id, p.content_id))?.doc;
        porMidia.set(String(p.ig_media_id), { tipo: tipoDoConteudo(c), titulo: String(c?.titulo || '').slice(0, 120), origem: c?.top?.origem || c?.origem?.tipo || null, objetivo: c?.objetivo || null, serie: c?.serie || null, nota_juri: Number.isFinite(c?.top?.escolha?.nota) ? c.top.escolha.nota : null, marca: c?.top?.entrada?.marca || null, autor_frase: c?.frase?.autor || null, teste: c?.video?.teste === true });
      } catch { porMidia.set(String(p.ig_media_id), { tipo: 'sem_registro' }); }
    });
  } catch { /* sem banco: os posts saem sem ficha */ }
  return porMidia;
}

// Uma página de posts (até 50) com as métricas de cada um. `after` é o cursor da página anterior.
async function posts({ after = null, limite = 50, grafo = meta.graph, igId = meta.config().igId, agora = Date.now(), fichasPorMidia = null, deps = {} } = {}) {
  const r = await grafo('GET', `${igId}/media`, { fields: CAMPOS, limit: Math.max(1, Math.min(50, limite)), ...(after ? { after } : {}) });
  const midias = (r.data || []).map((m) => ({ ...m, tipo: MI.tipoDe(m) })).filter((m) => m.tipo);
  const fx = fichasPorMidia || await fichas(deps, midias.map((m) => m.id));
  let limiteAtingido = false;
  const lista = await emParalelo(midias, 5, async (m) => {
    const ins = limiteAtingido ? { v: {}, pedidas: 0, erro: 'pulado: limite da Meta' } : await insights(m, m.tipo, grafo);
    if (/limit/i.test(ins.erro || '')) limiteAtingido = true;
    const v = ins.v; const idadeH = Math.max(0, (agora - Date.parse(m.timestamp)) / 3600000);
    return {
      id: m.id, tipo: m.tipo, em: m.timestamp, idade_h: Math.round(idadeH), link: m.permalink || null,
      legenda: String(m.caption || '').slice(0, 700), slides: m.children?.data?.length || null,
      capa: m.tipo === 'reel' || m.tipo === 'video' ? (m.thumbnail_url || null) : (m.media_url || null),
      curtidas: Number.isFinite(m.like_count) ? m.like_count : (v.likes ?? null), comentarios: Number.isFinite(m.comments_count) ? m.comments_count : (v.comments ?? null),
      alcance: v.reach ?? null, views: v.views ?? null, salvos: v.saved ?? null, envios: v.shares ?? null, interacoes: v.total_interactions ?? null,
      seguidores: v.follows ?? null, visitas: v.profile_visits ?? null,
      tempo_medio_ms: v.ig_reels_avg_watch_time ?? null, tempo_total_ms: v.ig_reels_video_view_total_time ?? null,
      pulou_3s_pct: v.reels_skip_rate == null ? null : (v.reels_skip_rate <= 1 ? v.reels_skip_rate * 100 : v.reels_skip_rate), reposts: v.reposts ?? null,   // % das views que saíram nos 3 primeiros segundos (só Reels)
      erro: ins.erro, ficha: fx.get(String(m.id)) || null,
    };
  });
  const proximo = r.paging?.next ? (r.paging?.cursors?.after || null) : null;
  return { posts: lista, proximo, fim: !proximo, limite_atingido: limiteAtingido };
}

const totalCom = (resp) => (resp?.data || []).map((d) => ({
  metrica: d.name, total: d.total_value?.value ?? null,
  cortes: (d.total_value?.breakdowns || []).map((b) => ({ por: (b.dimension_keys || []).join('+'), itens: (b.results || []).map((x) => ({ valor: (x.dimension_values || []).join(' '), n: x.value })) })),
}));

// A conta: seguidores, séries diárias, janelas de 30 dias (alcance de seguidores × não seguidores, quem seguiu × quem saiu) e demografia.
async function conta({ grafo = meta.graph, igId = meta.config().igId, agora = Date.now(), janelas = 3 } = {}) {
  const out = { lido_em: new Date(agora).toISOString(), erros: [] };
  const tenta = async (rotulo, fn) => { try { return await fn(); } catch (e) { out.erros.push(`${rotulo}: ${curto(e)}`); return null; } };
  out.perfil = await tenta('perfil', () => grafo('GET', igId, { fields: 'username,name,biography,followers_count,follows_count,media_count,website' }));
  const ate = Math.floor(agora / 1000);
  out.serie_30d = await tenta('serie diária', async () => {
    const r = await grafo('GET', `${igId}/insights`, { metric: 'reach,follower_count', period: 'day', since: ate - 29 * DIA, until: ate });
    return Object.fromEntries((r.data || []).map((d) => [d.name, (d.values || []).map((x) => [String(x.end_time).slice(0, 10), x.value ?? null])]));
  });
  out.janelas = await Promise.all(Array.from({ length: janelas }, async (_, j) => {
    const fim = ate - j * 30 * DIA; const ini = fim - 30 * DIA; const w = { de: new Date(ini * 1000).toISOString().slice(0, 10), ate: new Date(fim * 1000).toISOString().slice(0, 10), m: {} };
    const base = { period: 'day', metric_type: 'total_value', since: ini, until: fim };
    const um = async (metric, breakdowns) => {
      for (const b of breakdowns) { try { return totalCom(await grafo('GET', `${igId}/insights`, { ...base, metric, ...(b ? { breakdown: b } : {}) })); } catch (e) { w.m[`${metric}_erro`] = curto(e); } }
      return null;
    };
    const pares = [['reach', ['follow_type', 'media_product_type', null]], ['views', ['follower_type', 'follow_type', 'media_product_type', null]], ['follows_and_unfollows', ['follow_type', null]],
      ['total_interactions', ['media_product_type', null]], ['accounts_engaged', [null]], ['likes', [null]], ['comments', [null]], ['shares', [null]], ['saves', [null]], ['profile_links_taps', [null]]];
    await Promise.all(pares.map(async ([metric, bs]) => { const r = await um(metric, bs); if (r) { w.m[metric] = r[0] || null; delete w.m[`${metric}_erro`]; } }));
    // alcance também por formato (só na janela mais recente, para não gastar chamadas)
    if (j === 0) { const r = await tenta('alcance por formato', async () => totalCom(await grafo('GET', `${igId}/insights`, { ...base, metric: 'reach', breakdown: 'media_product_type' }))); if (r) w.m.reach_por_formato = r[0]; }
    return w;
  }));
  out.demografia = {};
  await Promise.all([['follower_demographics', ['this_month', 'last_90_days', null]], ['engaged_audience_demographics', ['this_month', 'this_week', null]]].map(async ([metrica, tfs]) => {
    out.demografia[metrica] = {};
    await Promise.all(['age', 'gender', 'country', 'city'].map(async (b) => {
      let ult = null;
      for (const tf of tfs) {
        try {
          const r = totalCom(await grafo('GET', `${igId}/insights`, { metric: metrica, period: 'lifetime', metric_type: 'total_value', breakdown: b, ...(tf ? { timeframe: tf } : {}) }));
          out.demografia[metrica][b] = (r[0]?.cortes?.[0]?.itens || []).sort((x, y) => y.n - x.n).slice(0, 12); return;
        } catch (e) { ult = curto(e); }
      }
      out.erros.push(`${metrica}/${b}: ${ult}`);
    }));
  }));
  out.online = await tenta('seguidores online', async () => {
    const r = await grafo('GET', `${igId}/insights`, { metric: 'online_followers', period: 'lifetime' });
    return (r.data?.[0]?.values || []).slice(-3).map((x) => ({ fim: x.end_time, por_hora: x.value }));
  });
  return out;
}

module.exports = { cifrar, decifrar, posts, conta, fichas, tipoDoConteudo, insights, CAMPOS };
