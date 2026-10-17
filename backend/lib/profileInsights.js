// Leitura do próprio perfil pela API pública instagram-looter2.
//
// Regras desta camada (todas nasceram de falhas reais):
//  - Só entra dado de uma conta CONFIRMADA (username + id numérico). Todo
//    resultado carrega a origem (conta, id, quando, versão do esquema).
//  - O cache é por identidade+versão. Cache sem origem não é usado.
//  - Colaborações de outra conta não entram na conta do Pedro.
//  - Posts jovens (menos de 72 h) não entram em comparações: ainda estão
//    acumulando curtidas.
//  - O que a API não entrega fica listado como indisponível. Ausência não é zero.
//  - Comparações com amostra pequena ou desbalanceada viram hipótese marcada
//    como insuficiente, nunca "vencedor".
// Cota grátis da API: 150 chamadas/mês. Uma leitura gasta 2 a 3.
const axios = require('axios');
const { ACCOUNT, SCHEMA_VERSION, confirmAccount } = require('./account');

const HOST = 'instagram-looter2.p.rapidapi.com';
const TIPO = { 1: 'imagem', 2: 'video', 8: 'carrossel' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const JANELA_MADURA_S = 72 * 3600;
const MIN_POR_GRUPO = 5;

const apiKey = () => process.env.RAPIDAPI_KEY_INSTAGRAM || process.env.RAPIDAPI_KEY;

const CAMPOS = {
  disponiveis: [
    { campo: 'curtidas', definicao: 'like_count no momento da leitura', origem: 'instagram-looter2/user-feeds' },
    { campo: 'comentarios', definicao: 'comment_count no momento da leitura', origem: 'instagram-looter2/user-feeds' },
    { campo: 'visualizacoes_video', definicao: 'play_count (só vídeos)', origem: 'instagram-looter2/user-feeds' },
    { campo: 'reposts', definicao: 'media_repost_count; não confirmei se inclui envios por DM', origem: 'instagram-looter2/user-feeds' },
    { campo: 'seguidores', definicao: 'contagem atual do perfil (não o valor na data do post)', origem: 'instagram-looter2/profile' },
  ],
  indisponiveis: ['alcance', 'impressões', 'salvamentos', 'envios por DM', 'visitas ao perfil', 'seguidores atribuídos a cada post', 'impulsionamento'],
};

async function looter(path, params) {
  const { data } = await axios.get(`https://${HOST}/${path}`, {
    params,
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': apiKey() },
    timeout: 25000,
  });
  if (data?.status === false) throw new Error(data.errorMessage || 'API recusou a consulta');
  return data;
}

// Converte um item cru da API no formato interno.
function normalizePost(it) {
  const cap = (it.caption && it.caption.text) || '';
  const autor = it.user?.username || null;
  return {
    id: String(it.pk || it.id),
    code: it.code,
    url: it.code ? `https://www.instagram.com/p/${it.code}/` : '',
    tipo: TIPO[it.media_type] || 'outro',
    likes: Number(it.like_count) || 0,
    comments: Number(it.comment_count) || 0,
    views: Number(it.play_count || it.ig_play_count) || 0,
    reposts: it.media_repost_count == null ? null : Number(it.media_repost_count),
    telas: Number(it.carousel_media_count) || (it.media_type === 1 ? 1 : 0),
    taken_at: Number(it.taken_at) || 0,
    pinned: Array.isArray(it.timeline_pinned_user_ids) && it.timeline_pinned_user_ids.length > 0,
    autor,
    // Sem autor informado, assume a própria conta; com autor diferente é colaboração.
    colab: !!autor && autor.toLowerCase() !== ACCOUNT.username,
    coautores: (it.coauthor_producers || []).map((c) => c.username).filter(Boolean),
    caption: cap,
    gancho: cap.split('\n').map((l) => l.trim()).find(Boolean) || '',
  };
}

async function fetchPosts(profile, pages = 2) {
  const t0 = Date.now();
  const posts = [];
  let maxId = null;
  for (let i = 0; i < pages; i++) {
    // A Vercel corta em 60s: segunda página só se ainda houver folga.
    if (i > 0 && Date.now() - t0 > 28000) break;
    const d = await looter('user-feeds', maxId ? { id: profile.id, max_id: maxId } : { id: profile.id });
    posts.push(...(d.items || []).map(normalizePost));
    maxId = d.next_max_id;
    if (!d.more_available || !maxId) break;
  }
  const seen = new Set();
  return posts.filter((x) => !seen.has(x.id) && seen.add(x.id));
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

// Pura: recebe posts normalizados e seguidores atuais.
// agora (segundos) é parâmetro só pra teste ser determinístico.
function computeInsights(posts, seguidores, { agora = Math.floor(Date.now() / 1000) } = {}) {
  const fol = Math.max(1, seguidores || 1);
  const eng = (p) => ((p.likes + p.comments) / fol) * 100;

  const proprios = posts.filter((p) => p.tipo !== 'outro' && !p.colab);
  const colabs = posts.filter((p) => p.colab);
  const maduros = proprios.filter((p) => agora - p.taken_at >= JANELA_MADURA_S);
  const imaturos = proprios.length - maduros.length;

  const porFormato = {};
  for (const tipo of ['imagem', 'carrossel', 'video']) {
    const ps = maduros.filter((p) => p.tipo === tipo);
    if (!ps.length) continue;
    porFormato[tipo] = {
      n: ps.length,
      eng_mediana: round(median(ps.map(eng))),
      curtidas_mediana: Math.round(median(ps.map((p) => p.likes))),
      telas_mediana: tipo === 'carrossel' ? median(ps.map((p) => p.telas)) : null,
    };
  }

  const medGeral = median(maduros.map(eng)) || 0.0001;
  const ranked = [...maduros].sort((a, b) => eng(b) - eng(a));
  const top = ranked.slice(0, 5).map((p) => ({
    tipo: p.tipo, gancho: p.gancho.slice(0, 180), likes: p.likes, comments: p.comments, telas: p.telas,
    reposts: p.reposts, eng: round(eng(p), 2), vezes_mediana: Math.round(eng(p) / medGeral), url: p.url,
    publicado_em: new Date(p.taken_at * 1000).toISOString().slice(0, 10),
  }));
  const piores = ranked.slice(-3).reverse().map((p) => ({ tipo: p.tipo, gancho: p.gancho.slice(0, 140), eng: round(eng(p), 3), url: p.url }));

  // Hipóteses: cada uma diz quantos posts a sustentam e se a amostra basta.
  const hipoteses = [];
  const formatos = Object.entries(porFormato);
  if (formatos.length >= 2) {
    const ord = [...formatos].sort((a, b) => b[1].eng_mediana - a[1].eng_mediana);
    const suficiente = ord.every(([, v]) => v.n >= MIN_POR_GRUPO);
    hipoteses.push({
      id: 'formato',
      texto: `Maior mediana de engajamento: ${ord[0][0]} (${ord[0][1].eng_mediana}%), contra ${ord[ord.length - 1][0]} (${ord[ord.length - 1][1].eng_mediana}%).`,
      evidencia: Object.fromEntries(formatos.map(([k, v]) => [k, { n: v.n, mediana: v.eng_mediana }])),
      suficiente,
      limitacoes: suficiente
        ? 'Janela curta, temas diferentes por formato e sem separar impulsionamento.'
        : `Amostra insuficiente: algum formato tem menos de ${MIN_POR_GRUPO} posts. Não trate como resultado.`,
    });
  }
  const dias = {};
  for (const p of maduros.filter((x) => !x.pinned)) (dias[DIAS[horaSP(p.taken_at).dia]] ||= []).push(eng(p));
  const diasArr = Object.entries(dias).map(([k, v]) => ({ chave: k, n: v.length, mediana: round(median(v)) })).sort((a, b) => b.mediana - a.mediana);
  if (diasArr.length >= 2) {
    const suficiente = diasArr.every((d) => d.n >= MIN_POR_GRUPO);
    hipoteses.push({
      id: 'dia',
      texto: `Dia com maior mediana: ${diasArr[0].chave} (${diasArr[0].mediana}%, ${diasArr[0].n} posts).`,
      evidencia: Object.fromEntries(diasArr.map((d) => [d.chave, { n: d.n, mediana: d.mediana }])),
      suficiente,
      limitacoes: suficiente ? 'Não separa tema nem formato.' : `Amostra insuficiente: dias com menos de ${MIN_POR_GRUPO} posts. Não escolha o dia por isso.`,
    });
  }

  const ts = maduros.filter((p) => !p.pinned).map((p) => p.taken_at).sort();
  const semanas = ts.length > 1 ? Math.max(1, (ts[ts.length - 1] - ts[0]) / (7 * 86400)) : 1;

  return {
    schema: SCHEMA_VERSION,
    atualizado_em: new Date().toISOString(),
    seguidores: fol,
    amostra: maduros.length,
    excluidos: { colaboracoes: colabs.length, com_menos_de_72h: imaturos },
    periodo: ts.length ? { de: new Date(ts[0] * 1000).toISOString().slice(0, 10), ate: new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) } : null,
    posts_por_semana: round(ts.length / semanas, 1),
    eng_mediana_geral: round(medGeral),
    por_formato: porFormato,
    top,
    piores,
    hipoteses,
    campos: CAMPOS,
    metodo: 'engajamento = (curtidas + comentários) ÷ seguidores atuais, em posts com 72 h ou mais, só da própria conta',
  };
}

// Texto pro prompt: só o que a amostra sustenta.
function insightsParaPrompt(ins) {
  if (!ins || !ins.top?.length) return '';
  const top = ins.top.slice(0, 3).map((t) => `- [${t.tipo}${t.telas > 1 ? `, ${t.telas} telas` : ''}] "${t.gancho}" (${t.eng}% dos seguidores, ${t.vezes_mediana}x a mediana)`).join('\n');
  const piores = (ins.piores || []).map((t) => `- [${t.tipo}] "${t.gancho}"`).join('\n');
  const hip = (ins.hipoteses || []).filter((h) => h.suficiente).map((h) => `- ${h.texto} (${h.limitacoes})`).join('\n');
  return `DADOS REAIS DO PERFIL ${ACCOUNT.handle} (${ins.seguidores} seguidores; ${ins.amostra} posts de ${ins.periodo?.de} a ${ins.periodo?.ate}):
POSTS COM MAIOR ENGAJAMENTO (observe o mecanismo, não copie o tema):
${top}
POSTS COM MENOR ENGAJAMENTO:
${piores}
${hip ? `PADRÕES COM AMOSTRA SUFICIENTE:\n${hip}` : 'Nenhum padrão de formato/dia tem amostra suficiente ainda; não afirme que algo "funciona melhor".'}`;
}

// Cache por identidade + versão do esquema. Cache sem origem não é aceito.
let _cache = null;
const cacheKey = () => `${ACCOUNT.ig_id}:v${SCHEMA_VERSION}`;

async function getInsights({ force = false } = {}) {
  if (!force && _cache && _cache.key === cacheKey() && Date.now() - _cache.at < 6 * 3600e3) return _cache.data;
  if (!apiKey()) throw new Error('Chave da API do Instagram não configurada.');
  const profile = await looter('profile', { username: ACCOUNT.username });
  // Confirma ANTES de ler posts: se a conta não bate, nada é lido.
  const conta = await confirmAccount({ force: true, getProfile: async () => profile });
  const posts = await fetchPosts(profile, 2);
  const ins = computeInsights(posts, conta.seguidores);
  const data = {
    ...ins,
    conta,
    posts: posts.map(({ caption, ...p }) => ({ ...p, legenda: caption.slice(0, 300) })),
  };
  _cache = { key: cacheKey(), at: Date.now(), data };
  return data;
}

const lastInsights = () => (_cache && _cache.key === cacheKey() ? _cache.data : null);

// Valida um insights vindo de fora (ex.: guardado no navegador).
function insightsValido(ins) {
  return !!(ins && ins.schema === SCHEMA_VERSION && ins.conta && ins.conta.ok === true
    && ins.conta.ig_id === ACCOUNT.ig_id && String(ins.conta.username).toLowerCase() === ACCOUNT.username);
}

// Só usa dado com origem confirmada: o que veio do cliente sem origem é ignorado.
const insightsConfiaveis = (ins) => (insightsValido(ins) ? ins : lastInsights());

module.exports = { insightsConfiaveis, getInsights, lastInsights, computeInsights, insightsParaPrompt, insightsValido, normalizePost, CAMPOS };
