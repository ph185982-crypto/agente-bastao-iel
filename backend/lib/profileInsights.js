// Leitura do próprio perfil (@pedro_destrava) pela API pública instagram-looter2.
// Aprende com os posts reais: qual formato rende, quais ganchos venceram e
// em que dia/hora o público responde melhor. Isso alimenta pautas e redator.
// Cota grátis da API é 150 chamadas/mês: cada leitura gasta 2 (perfil em
// cache) e o resultado fica guardado em memória e no aparelho.
const axios = require('axios');

const HOST = 'instagram-looter2.p.rapidapi.com';
const TIPO = { 1: 'imagem', 2: 'video', 8: 'carrossel' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const apiKey = () => process.env.RAPIDAPI_KEY_INSTAGRAM || process.env.RAPIDAPI_KEY;
// Usuário do Instagram que a ferramenta estuda. Separado do PROFILE_HANDLE
// (que só aparece impresso nos posts) pra um erro lá não fazer ler a conta errada.
const username = () => String(process.env.INSTAGRAM_USERNAME || 'pedro_destrava').replace('@', '').trim();

async function looter(path, params) {
  const { data } = await axios.get(`https://${HOST}/${path}`, {
    params,
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': apiKey() },
    timeout: 25000,
  });
  if (data?.status === false) throw new Error(data.errorMessage || 'API recusou a consulta');
  return data;
}

let _perfil = null;
async function perfil() {
  if (_perfil) return _perfil;
  const d = await looter('profile', { username: username() });
  _perfil = { id: d.id, seguidores: d.edge_followed_by?.count || 0, nome: d.full_name, bio: d.biography };
  return _perfil;
}

// Converte um item cru da API no formato que o resto do código usa.
function normalizePost(it) {
  const cap = (it.caption && it.caption.text) || '';
  return {
    id: String(it.pk || it.id),
    code: it.code,
    url: it.code ? `https://www.instagram.com/p/${it.code}/` : '',
    tipo: TIPO[it.media_type] || 'outro',
    likes: Number(it.like_count) || 0,
    comments: Number(it.comment_count) || 0,
    views: Number(it.play_count || it.ig_play_count) || 0,
    telas: Number(it.carousel_media_count) || (it.media_type === 1 ? 1 : 0),
    taken_at: Number(it.taken_at) || 0,
    pinned: Array.isArray(it.timeline_pinned_user_ids) && it.timeline_pinned_user_ids.length > 0,
    caption: cap,
    gancho: cap.split('\n').map((l) => l.trim()).find(Boolean) || '',
  };
}

async function fetchPosts(pages = 2) {
  const t0 = Date.now();
  const p = await perfil();
  const posts = [];
  let maxId = null;
  for (let i = 0; i < pages; i++) {
    // A Vercel corta em 60s: segunda página só se ainda houver folga.
    if (i > 0 && Date.now() - t0 > 28000) break;
    const d = await looter('user-feeds', maxId ? { id: p.id, max_id: maxId } : { id: p.id });
    posts.push(...(d.items || []).map(normalizePost));
    maxId = d.next_max_id;
    if (!d.more_available || !maxId) break;
  }
  const seen = new Set();
  return { seguidores: p.seguidores, posts: posts.filter((x) => !seen.has(x.id) && seen.add(x.id)) };
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// Hora local de São Paulo (UTC-3, sem horário de verão desde 2019).
function horaSP(ts) {
  const d = new Date((ts - 3 * 3600) * 1000);
  return { dia: d.getUTCDay(), hora: d.getUTCHours() };
}

// Pura: recebe posts normalizados + seguidores e devolve o que aprendeu.
function computeInsights(posts, seguidores) {
  const fol = Math.max(1, seguidores || 1);
  const eng = (p) => ((p.likes + p.comments) / fol) * 100;
  const base = posts.filter((p) => p.tipo !== 'outro');

  const porFormato = {};
  for (const tipo of ['imagem', 'carrossel', 'video']) {
    const ps = base.filter((p) => p.tipo === tipo);
    if (!ps.length) continue;
    porFormato[tipo] = {
      n: ps.length,
      eng_mediana: round(median(ps.map(eng))),
      curtidas_mediana: Math.round(median(ps.map((p) => p.likes))),
      telas_mediana: tipo === 'carrossel' ? median(ps.map((p) => p.telas)) : null,
    };
  }
  const melhorFormato = Object.entries(porFormato).sort((a, b) => b[1].eng_mediana - a[1].eng_mediana)[0]?.[0] || null;

  const medGeral = median(base.map(eng)) || 0.0001;
  const ranked = [...base].sort((a, b) => eng(b) - eng(a));
  const top = ranked.slice(0, 5).map((p) => ({
    tipo: p.tipo, gancho: p.gancho.slice(0, 180), likes: p.likes, comments: p.comments, telas: p.telas,
    eng: round(eng(p), 2), vezes_mediana: Math.round(eng(p) / medGeral), url: p.url,
  }));
  const piores = ranked.slice(-3).reverse().map((p) => ({ tipo: p.tipo, gancho: p.gancho.slice(0, 140), eng: round(eng(p), 3) }));

  // Dia e faixa de horário: mediana de engajamento por grupo (mín. 2 posts).
  const grupo = (keyFn) => {
    const g = {};
    for (const p of base.filter((x) => x.taken_at && !x.pinned)) {
      const k = keyFn(horaSP(p.taken_at));
      (g[k] ||= []).push(eng(p));
    }
    return Object.entries(g).filter(([, v]) => v.length >= 2)
      .map(([k, v]) => ({ chave: k, n: v.length, eng_mediana: round(median(v)) }))
      .sort((a, b) => b.eng_mediana - a.eng_mediana);
  };
  const faixa = ({ hora }) => (hora < 6 ? 'madrugada' : hora < 12 ? 'manhã (6h-12h)' : hora < 18 ? 'tarde (12h-18h)' : 'noite (18h-24h)');
  const dias = grupo(({ dia }) => DIAS[dia]);
  const horarios = grupo(faixa);

  // O que os vencedores têm em comum.
  const topN = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 4)));
  const restoN = ranked.slice(topN.length);
  const pct = (arr, fn) => (arr.length ? Math.round((arr.filter(fn).length / arr.length) * 100) : 0);
  const comNumero = (p) => /\d|r\$|%/i.test(p.gancho);
  const ganchoCurto = (p) => p.gancho.split(/\s+/).length <= 14;
  const padroes = {
    gancho_com_numero: { vencedores: pct(topN, comNumero), demais: pct(restoN, comNumero) },
    gancho_curto: { vencedores: pct(topN, ganchoCurto), demais: pct(restoN, ganchoCurto) },
  };

  const ts = base.filter((p) => p.taken_at && !p.pinned).map((p) => p.taken_at).sort();
  const semanas = ts.length > 1 ? Math.max(1, (ts[ts.length - 1] - ts[0]) / (7 * 86400)) : 1;

  return {
    atualizado_em: new Date().toISOString(),
    seguidores: fol,
    amostra: base.length,
    posts_por_semana: round(ts.length / semanas, 1),
    eng_mediana_geral: round(medGeral),
    por_formato: porFormato,
    melhor_formato: melhorFormato,
    top,
    piores,
    melhores_dias: dias.slice(0, 3),
    melhores_horarios: horarios.slice(0, 2),
    padroes,
  };
}

// Resumo em texto pro prompt da IA.
function insightsParaPrompt(ins) {
  if (!ins || !ins.top?.length) return '';
  const top = ins.top.slice(0, 3).map((t) => `- [${t.tipo}${t.telas > 1 ? `, ${t.telas} telas` : ''}] "${t.gancho}" → ${t.eng}% dos seguidores (${t.vezes_mediana}x a mediana)`).join('\n');
  const piores = (ins.piores || []).map((t) => `- [${t.tipo}] "${t.gancho}"`).join('\n');
  return `DADOS REAIS DO PERFIL (${ins.seguidores} seguidores, mediana ${ins.eng_mediana_geral}%):
POSTS QUE MAIS RENDERAM (imite o mecanismo, não o tema):
${top}
POSTS QUE MENOS RENDERAM (evite esse tipo):
${piores}
Melhor formato hoje: ${ins.melhor_formato || 'sem dado'}. Ganchos com número: ${ins.padroes?.gancho_com_numero?.vencedores ?? '?'}% dos vencedores vs ${ins.padroes?.gancho_com_numero?.demais ?? '?'}% dos demais.`;
}

let _cache = null;
async function getInsights({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.at < 6 * 3600e3) return _cache.data;
  if (!apiKey()) throw new Error('Chave da API do Instagram não configurada (RAPIDAPI_KEY_INSTAGRAM).');
  const { seguidores, posts } = await fetchPosts(2);
  const data = { ...computeInsights(posts, seguidores), posts: posts.map(({ caption, ...p }) => ({ ...p, legenda: caption.slice(0, 300) })) };
  _cache = { at: Date.now(), data };
  return data;
}

const lastInsights = () => _cache?.data || null;

module.exports = { getInsights, lastInsights, computeInsights, insightsParaPrompt, normalizePost };
