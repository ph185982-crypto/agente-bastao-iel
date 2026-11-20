// Reciclagem › "Em alta no Brasil": o que está bombando AGORA no Brasil, SEM filtro de nicho (entretenimento, notícia,
// esporte, humor, celebridade, tudo), para o Pedro tirar ideia de conteúdo de topo de funil. É separado das contas
// vigiadas (que são de negócio e medem viralidade contra a linha de base de cada conta).
//
// Fontes (todas só leitura; cada uma independente: uma falhar nunca derruba as outras):
//  1. Instagram Graph `business_discovery` nas GRANDES PÁGINAS brasileiras (lista curada e editável abaixo):
//     só posts das últimas 48 h. No máximo 12 contas por rodada, em rodízio (quem foi lida há mais tempo primeiro),
//     e com freio pela cota que a própria Meta informa (meta.uso()): acima de 50% lê só 4, acima de 75% não lê,
//     e se a leitura leve da Reciclagem estiver em pausa por limite, esta também espera. Assim a coleta principal
//     (contas vigiadas) nunca fica sem cota por causa desta.
//     Conta que a Meta recusa ("Invalid user id": @ errado ou perfil não profissional) fica 7 dias fora do rodízio.
//  2. Google Trends Brasil (RSS público, geo=BR): buscas em alta com tráfego aproximado e as notícias ligadas.
//  3. RapidAPI instagram120 `explore_tag` (já integrada em routes/carousels.js): 1 hashtag geral brasileira por
//     rodada, em rodízio. Só roda com RAPIDAPI_KEY_IG120/RAPIDAPI_KEY e se EM_ALTA_RAPIDAPI !== '0'; recusa por cota
//     ou assinatura (403/429) bloqueia a fonte por 24 h.
//  TikTok Creative Center: o endpoint público responde "no permission" sem login (testado em 20/11/2026): fora.
//
// Pontuação "em alta" (favorece o recente):
//   engajamento = curtidas + 3 × comentários (curtidas ocultas: 5% das visualizações no lugar);
//   score = (engajamento ÷ horas desde a publicação, mínimo 1 h) ÷ √(seguidores em milhões, mínimo 0,1).
//   A raiz no denominador é meio-termo: página gigante não ganha só por ser gigante, mas alcance ainda conta.
//   Na leitura, o score vira 0–100 relativo ao maior da mesma fonte (fontes têm escalas diferentes).
//
// Guarda só link, metadados, números públicos e a miniatura (link do CDN): nada de baixar ou republicar mídia.
// Retenção de 72 h pela data de publicação (busca do Google: pela data da coleta). Nenhuma IA aqui.
const crypto = require('crypto');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');

const TIPO = 'reciclagem_em_alta';
const TIPO_ESTADO = 'reciclagem_em_alta_estado';
const JANELA_H = 48;                  // posts mais velhos que isso não entram
const RETENCAO_H = 72;
const MAX_CONTAS = 12;                // chamadas à Meta por rodada (teto duro)
const MAX_CONTAS_COTA_MEDIA = 4;      // quando a Meta diz que já usamos 50% ou mais
const COTA_MEDIA = 50; const COTA_ALTA = 75;
const LIMITE_MIDIAS = 25;
const MAX_INSTAGRAM = 40;             // melhores posts guardados por rodada
const MAX_TRENDS = 25;
const RECUSA_DIAS = 7;
const INTERVALO_MANUAL_MS = 5 * 60000; // "Atualizar agora" seguido não gasta cota de novo
const TRENDS_URL = 'https://trends.google.com/trending/rss?geo=BR';
const IG120_HOST = 'instagram120.p.rapidapi.com';
const FONTES = ['instagram', 'google_trends', 'instagram_hashtag'];

// Páginas gerais com maior audiência no Brasil (lista de 20/11/2026, a conferir na primeira coleta: a Meta só lê perfil
// profissional, e a coleta tira do rodízio por 7 dias quem ela recusar). cat: noticias | entretenimento | esporte | humor | celebridade.
const CONTAS = [
  { handle: 'choquei', nome: 'Choquei', cat: 'entretenimento' },
  { handle: 'gshow', nome: 'gshow', cat: 'entretenimento' },
  { handle: 'g1', nome: 'g1', cat: 'noticias' },
  { handle: 'uol', nome: 'UOL', cat: 'noticias' },
  { handle: 'metropoles', nome: 'Metrópoles', cat: 'noticias' },
  { handle: 'cnnbrasil', nome: 'CNN Brasil', cat: 'noticias' },
  { handle: 'folhadespaulo', nome: 'Folha de S.Paulo', cat: 'noticias' },
  { handle: 'estadao', nome: 'Estadão', cat: 'noticias' },
  { handle: 'jornaloglobo', nome: 'O Globo', cat: 'noticias' },
  { handle: 'tntsportsbr', nome: 'TNT Sports Brasil', cat: 'esporte' },
  { handle: 'geglobo', nome: 'ge', cat: 'esporte' },
  { handle: 'sportv', nome: 'sportv', cat: 'esporte' },
  { handle: 'cazetv', nome: 'CazéTV', cat: 'esporte' },
  { handle: 'flamengo', nome: 'Flamengo', cat: 'esporte' },
  { handle: 'corinthians', nome: 'Corinthians', cat: 'esporte' },
  { handle: 'portalpopline', nome: 'Portal POPline', cat: 'celebridade' },
  { handle: 'hugogloss', nome: 'Hugo Gloss', cat: 'celebridade' },
  { handle: 'alfinetei', nome: 'Alfinetei', cat: 'celebridade' },
  { handle: 'fofoquei', nome: 'Fofoquei', cat: 'celebridade' },
  { handle: 'tvglobo', nome: 'TV Globo', cat: 'entretenimento' },
  { handle: 'sbtonline', nome: 'SBT', cat: 'entretenimento' },
  { handle: 'bbb', nome: 'Big Brother Brasil', cat: 'entretenimento' },
  { handle: 'netflixbrasil', nome: 'Netflix Brasil', cat: 'entretenimento' },
  { handle: 'multishow', nome: 'Multishow', cat: 'entretenimento' },
  { handle: 'quebrandootabu', nome: 'Quebrando o Tabu', cat: 'noticias' },
  { handle: 'portadosfundos', nome: 'Porta dos Fundos', cat: 'humor' },
  { handle: 'naosalvo', nome: 'Não Salvo', cat: 'humor' },
  { handle: 'whinderssonnunes', nome: 'Whindersson Nunes', cat: 'humor' },
  { handle: 'carlinhos', nome: 'Carlinhos Maia', cat: 'humor' },
  { handle: 'virginia', nome: 'Virginia Fonseca', cat: 'celebridade' },
  { handle: 'casimiro', nome: 'Casimiro', cat: 'esporte' },
  { handle: 'felipeneto', nome: 'Felipe Neto', cat: 'entretenimento' },
];
const CATEGORIAS = ['noticias', 'entretenimento', 'esporte', 'humor', 'celebridade', 'outros'];
// Hashtags gerais brasileiras para a fonte RapidAPI (uma por rodada).
const HASHTAGS = ['brasil', 'viralbrasil', 'memesbrasil', 'futebolbrasileiro', 'novela', 'bbb', 'humorbrasileiro', 'noticias'];

const conta = () => ACCOUNT.ig_id;
const iso = (ms) => new Date(ms).toISOString();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const arred = (v, c = 2) => (v == null ? null : Math.round(v * 10 ** c) / 10 ** c);
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const normLink = (u) => String(u || '').trim().toLowerCase().replace(/\?.*$/, '').replace(/\/+$/, '');
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Instagram: o mesmo post (colaboração) aparece em duas páginas com o mesmo permalink → um item só, de qualquer fonte.
const idDe = (fonte, chave) => `ea_${sha1(`${fonte === 'google_trends' ? 'gt' : 'ig'}|${chave}`).slice(0, 16)}`;
const erro = (msg, code, status = 400) => Object.assign(new Error(msg), { code, status });

// ── Pontuação ───────────────────────────────────────────────────────────────────
function engajamento({ curtidas, comentarios, visualizacoes }) {
  if (curtidas == null && comentarios == null && visualizacoes == null) return null;
  return (curtidas ?? 0.05 * (visualizacoes || 0)) + 3 * (comentarios || 0);
}
function pontuar(p, seguidores, agora = Date.now()) {
  const t = Date.parse(p.publicado_em); if (!Number.isFinite(t)) return null;
  const horas = Math.max(1, (agora - t) / 3600000);
  const eng = engajamento(p); if (eng == null) return null;
  const porHora = eng / horas;
  const escala = Math.sqrt(Math.max(0.1, (seguidores || 1000000) / 1000000)); // sem seguidores (hashtag): neutro (1 mi)
  return { engajamento: Math.round(eng), por_hora: Math.round(porHora), horas: arred(horas, 1), score: arred(porHora / escala, 2) };
}
// "200.000+", "2 mil+", "1 mi+", "2K+", "1M+", "100+" → número.
function trafego(s) {
  const t = semAcento(s).replace(/\+/g, '').trim(); if (!t) return null;
  const m = /^([\d.,]+)\s*(k|mil|m|mi|mi\.|milhao|milhoes|b|bi)?$/.exec(t.replace(/\s+/g, ' ')); if (!m) return null;
  const mult = { k: 1e3, mil: 1e3, m: 1e6, mi: 1e6, 'mi.': 1e6, milhao: 1e6, milhoes: 1e6, b: 1e9, bi: 1e9 }[m[2]] || 1;
  // separador: "200.000" (milhar) ou "1,5" / "1.5" com multiplicador (decimal)
  const base = mult > 1 ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(base) ? Math.round(base * mult) : null;
}

// ── Fonte 1: Instagram (grandes páginas) ────────────────────────────────────────
const tipoIg = (m) => (m.media_product_type === 'REELS' || m.media_type === 'VIDEO' ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carrossel' : 'imagem');
function itemIg(m, c, seguidores, agora, coletadoEm) {
  if (!m?.permalink || !m?.timestamp) return null;
  const publicado = Date.parse(m.timestamp); if (!Number.isFinite(publicado) || agora - publicado > JANELA_H * 3600000) return null;
  const filhos = Array.isArray(m.children?.data) ? m.children.data : [];
  const metricas = { curtidas: num(m.like_count), comentarios: num(m.comments_count), visualizacoes: num(m.view_count), seguidores };
  const pts = pontuar({ ...metricas, publicado_em: m.timestamp }, seguidores, agora); if (!pts) return null;
  const imagens = (filhos.length ? filhos : [m]).filter((x) => x.media_type === 'IMAGE' && x.media_url).map((x) => String(x.media_url)).slice(0, 10);
  return {
    id: idDe('instagram', normLink(m.permalink)), fonte: 'instagram', tipo: tipoIg(m),
    conta: { handle: c.handle, nome: c.nome || c.handle, cat: c.cat || 'outros' },
    titulo: String(m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
    legenda: String(m.caption || '').trim().slice(0, 2200) || null,
    permalink: String(m.permalink), thumbnail: String(m.thumbnail_url || imagens[0] || m.media_url || '') || null, midias: imagens,
    publicado_em: new Date(publicado).toISOString(),
    metricas: { ...metricas, engajamento: pts.engajamento, por_hora: pts.por_hora, horas: pts.horas }, score: pts.score, coletado_em: coletadoEm,
  };
}
async function coletarInstagram({ contas, graph, igId, agora = Date.now(), orcamentoMs = 25000, concorrencia = 4 } = {}) {
  const fila = [...(contas || [])]; const itens = []; const resumo = []; const inicio = Date.now(); let parcial = false; const coletadoEm = iso(agora);
  const campos = (n) => `business_discovery.username(%H){username,followers_count,media.limit(${n}){like_count,comments_count,view_count,caption,permalink,media_type,media_product_type,timestamp,media_url,thumbnail_url,children.limit(10){media_type,media_url}}}`;
  const trabalhador = async () => {
    while (fila.length) {
      if (Date.now() - inicio > orcamentoMs) { parcial = true; return; }
      const c = fila.shift();
      try {
        let d;
        try { d = await graph('GET', igId, { fields: campos(LIMITE_MIDIAS).replace('%H', c.handle) }); }
        catch (e1) {
          // Página grande: a Meta pede "reduce the amount of data". Uma segunda tentativa com menos mídias.
          if (!/reduce the amount|amount of data|too large|An unknown error/i.test(`${e1?.meta?.mensagem_original || ''} ${e1?.message || ''}`) || ['limite', 'token'].includes(e1?.meta?.tipo)) throw e1;
          d = await graph('GET', igId, { fields: campos(10).replace('%H', c.handle) });
        }
        const bd = d?.business_discovery || {}; const seguidores = num(bd.followers_count);
        const daConta = (bd.media?.data || []).map((m) => itemIg(m, c, seguidores, agora, coletadoEm)).filter(Boolean);
        itens.push(...daConta);
        resumo.push({ handle: c.handle, ok: true, seguidores, recentes: daConta.length });
      } catch (e) {
        const original = String(e?.meta?.mensagem_original || '').slice(0, 200);
        resumo.push({ handle: c.handle, ok: false, erro: String(e?.meta?.amigavel || e?.message || 'erro').slice(0, 160), original: original || null, tipo: e?.meta?.tipo || null, invalida: /invalid user id|cannot be found|does not exist|nonexisting/i.test(original) });
        if (['token', 'limite'].includes(e?.meta?.tipo)) { parcial = true; fila.length = 0; return; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, fila.length)) }, trabalhador));
  return { itens, contas: resumo, parcial, chamadas: resumo.length };
}

// ── Fonte 2: Google Trends Brasil ──────────────────────────────────────────────
const desEntidade = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const httpLink = (u) => (/^https?:\/\//i.test(u || '') ? String(u).slice(0, 400) : null);
function parseTrends(xml, { agora = Date.now() } = {}) {
  const tag = (b, n) => { const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(b); return m ? desEntidade(m[1]) : ''; };
  const itens = []; const vistos = new Set(); const coletadoEm = iso(agora);
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = m[1]; const titulo = tag(b, 'title').slice(0, 140); if (!titulo) continue;
    const chave = semAcento(titulo).replace(/[^a-z0-9]+/g, ' ').trim(); if (vistos.has(chave)) continue; vistos.add(chave);
    const noticias = [...b.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi)].map((n) => ({ titulo: tag(n[1], 'ht:news_item_title').slice(0, 200), url: httpLink(tag(n[1], 'ht:news_item_url')), fonte: tag(n[1], 'ht:news_item_source').slice(0, 60) || null })).filter((n) => n.titulo).slice(0, 3);
    const trafegoTxt = tag(b, 'ht:approx_traffic') || null; const busca = trafego(trafegoTxt);
    const pub = Date.parse(tag(b, 'pubDate'));
    itens.push({
      id: idDe('google_trends', chave), fonte: 'google_trends', tipo: 'busca', conta: null, titulo, legenda: null,
      permalink: noticias[0]?.url || `https://www.google.com/search?q=${encodeURIComponent(titulo)}&hl=pt-BR&gl=BR`,
      thumbnail: httpLink(tag(b, 'ht:picture')), midias: [], noticias,
      publicado_em: Number.isFinite(pub) ? new Date(pub).toISOString() : coletadoEm,
      metricas: { trafego: trafegoTxt, buscas: busca }, score: busca ?? 0, coletado_em: coletadoEm,
    });
    if (itens.length >= MAX_TRENDS) break;
  }
  return itens;
}
async function coletarTrends({ fetcher, agora = Date.now() } = {}) {
  const r = await (fetcher || globalThis.fetch)(TRENDS_URL, { headers: { accept: 'application/rss+xml,text/xml,*/*' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Google Trends respondeu HTTP ${r.status}`);
  return parseTrends(await r.text(), { agora });
}

// ── Fonte 3: RapidAPI instagram120 explore_tag (top de uma hashtag geral) ───────
function itemHashtag(n, tag, agora, coletadoEm) {
  const m = n?.media || n; if (!m?.code) return null;
  const t = Number(m.taken_at || m.taken_at_timestamp || 0) * 1000; if (!t || agora - t > JANELA_H * 3600000) return null;
  const cap = m.caption && typeof m.caption === 'object' ? m.caption.text : (m.edge_media_to_caption?.edges?.[0]?.node?.text || m.caption || '');
  const metricas = { curtidas: num(m.like_count ?? m.edge_liked_by?.count), comentarios: num(m.comment_count ?? m.edge_media_to_comment?.count), visualizacoes: num(m.play_count ?? m.ig_play_count ?? m.video_view_count), seguidores: null };
  const pts = pontuar({ ...metricas, publicado_em: iso(t) }, null, agora); if (!pts) return null;
  const tipo = m.media_type === 8 ? 'carrossel' : m.media_type === 2 ? 'reel' : 'imagem';
  const capa = m.image_versions2?.candidates?.[0]?.url || m.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url || m.display_url || m.thumbnail_src || null;
  const permalink = `https://www.instagram.com/${tipo === 'reel' ? 'reel' : 'p'}/${m.code}/`;
  const user = m.user?.username || m.owner?.username || null;
  return {
    id: idDe('instagram', normLink(permalink)), fonte: 'instagram_hashtag', tipo,
    conta: { handle: user || `#${tag}`, nome: user ? `@${user} (via #${tag})` : `#${tag}`, cat: 'outros', hashtag: tag },
    titulo: String(cap || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null, legenda: String(cap || '').trim().slice(0, 2200) || null,
    permalink, thumbnail: httpLink(capa), midias: [], publicado_em: iso(t),
    metricas: { ...metricas, engajamento: pts.engajamento, por_hora: pts.por_hora, horas: pts.horas }, score: pts.score, coletado_em: coletadoEm,
  };
}
async function coletarHashtag({ tag, chave, fetcher, agora = Date.now() } = {}) {
  const u = new URL(`https://${IG120_HOST}/api/instagram/explore_tag`); u.search = new URLSearchParams({ hashtag: tag, maxId: '' }).toString();
  const r = await (fetcher || globalThis.fetch)(u.toString(), { headers: { 'x-rapidapi-host': IG120_HOST, 'x-rapidapi-key': chave, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error(`RapidAPI respondeu HTTP ${r.status}`), { status: r.status });
  const data = await r.json(); const coletadoEm = iso(agora);
  const secoes = data?.result?.sections || data?.sections || [];
  const nodes = secoes.flatMap((s) => s?.layout_content?.medias || s?.medias || []).concat(data?.result?.edges || data?.edges || []);
  return nodes.map((n) => itemHashtag(n?.node || n, tag, agora, coletadoEm)).filter(Boolean);
}

// ── Armazém ─────────────────────────────────────────────────────────────────────
function db() { const a = armazem(); if (!a?.duravel || !a.radar) throw erro('O "Em alta no Brasil" precisa do banco de dados no servidor (Cópia no servidor).', 'SEM_BANCO', 503); return a; }
const disponivel = () => { const a = armazem(); return !!(a?.duravel && a.radar); };
async function listarDocs() { return (await db().radar.listar(conta(), TIPO, { limite: 1000 })).map((r) => r.doc); }
async function obter(id) { const r = await db().radar.obter(conta(), TIPO, String(id)); return r ? r.doc : null; }
async function lerEstado() { const r = disponivel() ? await db().radar.obter(conta(), TIPO_ESTADO, 'estado') : null; return r?.doc || {}; }
async function salvarEstado(patch) { const novo = { ...(await lerEstado()), ...patch }; await db().radar.salvar(conta(), TIPO_ESTADO, 'estado', novo); return novo; }

// Lista editável: curada + { adicionar: [{handle, nome, cat}], remover: [handle] } guardado no armazém.
async function lerConfig() { const r = disponivel() ? await db().radar.obter(conta(), TIPO_ESTADO, 'config') : null; return { adicionar: r?.doc?.adicionar || [], remover: r?.doc?.remover || [] }; }
const HANDLE = /^[a-z0-9._]{2,30}$/;
async function salvarConfig(cfg = {}) {
  const adicionar = []; const vistos = new Set();
  for (const x of Array.isArray(cfg.adicionar) ? cfg.adicionar : []) {
    const handle = String(x?.handle || '').trim().replace(/^@/, '').toLowerCase(); if (!HANDLE.test(handle)) throw erro(`Handle inválido: ${String(x?.handle || '').slice(0, 40)}`, 'ENTRADA');
    if (vistos.has(handle)) continue; vistos.add(handle);
    adicionar.push({ handle, nome: String(x.nome || handle).trim().slice(0, 80), cat: CATEGORIAS.includes(x.cat) ? x.cat : 'outros' });
  }
  const remover = [...new Set((Array.isArray(cfg.remover) ? cfg.remover : []).map((h) => String(h || '').trim().replace(/^@/, '').toLowerCase()).filter((h) => HANDLE.test(h)))];
  if (adicionar.length > 60 || remover.length > 100) throw erro('Lista grande demais.', 'ENTRADA');
  await db().radar.salvar(conta(), TIPO_ESTADO, 'config', { adicionar, remover });
  return carregarContas();
}
async function carregarContas() {
  const cfg = await lerConfig(); const rem = new Set(cfg.remover); const vistos = new Set(); const lista = [];
  for (const c of [...CONTAS, ...cfg.adicionar.map((x) => ({ ...x, adicionada: true }))]) if (!rem.has(c.handle) && !vistos.has(c.handle)) { vistos.add(c.handle); lista.push(c); }
  const est = await lerEstado();
  return { contas: lista.map((c) => ({ ...c, lida_em: est.lidas_em?.[c.handle] || null, recusada: est.recusadas?.[c.handle] || null })), removidas: cfg.remover, config: cfg, categorias: CATEGORIAS, max_por_rodada: MAX_CONTAS };
}

// Guarda os novos (dedupe por id), atualiza números de quem já existe e apaga o que passou de 72 h.
async function guardar(itens, { agora = Date.now() } = {}) {
  const existentes = new Map((await listarDocs()).map((d) => [d.id, d]));
  const porId = new Map();
  for (const i of itens) { const ant = porId.get(i.id); if (!ant || (i.score ?? 0) > (ant.score ?? 0)) porId.set(i.id, i); }
  let novos = 0; let atualizados = 0; let removidos = 0;
  for (const i of porId.values()) {
    const ant = existentes.get(i.id);
    const doc = { ...(ant || {}), ...i, thumbnail: i.thumbnail || ant?.thumbnail || null, midias: i.midias?.length ? i.midias : (ant?.midias || []), primeira_coleta_em: ant?.primeira_coleta_em || i.coletado_em, levado: ant?.levado || null };
    await db().radar.salvar(conta(), TIPO, doc.id, doc); existentes.set(doc.id, doc);
    if (ant) atualizados += 1; else novos += 1;
  }
  const limite = agora - RETENCAO_H * 3600000;
  for (const d of existentes.values()) {
    const ref = d.fonte === 'google_trends' ? (d.coletado_em || d.publicado_em) : (d.publicado_em || d.coletado_em);
    if (!(Date.parse(ref) >= limite)) { await db().radar.apagar(conta(), TIPO, d.id); removidos += 1; }
  }
  return { novos, atualizados, removidos };
}

// ── Coleta (cron a cada 3 h ou botão "Atualizar agora") ──────────────────────────
// deps (testes): graph, igId, meta, uso, fetcher (Trends), fetcherRapid, rapidKey, contas, estadoReciclagem.
async function coletar({ deps = {}, origem = 'manual', agora = Date.now() } = {}) {
  db();
  const estado = await lerEstado();
  if (estado.coletando_ate && Date.parse(estado.coletando_ate) > agora) return { ok: true, ocupado: true, motivo: 'Uma coleta já está em andamento.' };
  if (origem === 'manual' && estado.ultima?.em && agora - Date.parse(estado.ultima.em) < INTERVALO_MANUAL_MS) return { ok: true, recente: true, ...estado.ultima };
  await salvarEstado({ coletando_ate: iso(agora + 90000) });
  const fontes = {}; const avisos = []; const itens = [];
  const lidasEm = { ...(estado.lidas_em || {}) }; const recusadas = { ...(estado.recusadas || {}) };
  let pausaMeta = estado.meta_pausa_ate || null;
  try {
    // As três fontes rodam em paralelo (a função da Vercel tem 60 s) e cada uma cuida do próprio erro.
    // 1) Instagram — com freio de cota.
    const fonteInstagram = async () => { try {
      const meta = deps.meta || require('../meta');
      const temMeta = !!deps.graph || meta.faltando().filter((k) => k !== 'PUBLISH_SECRET').length === 0;
      const uso = (deps.uso || meta.uso || (() => ({})))(); const pct = uso.pct;
      const principal = deps.estadoReciclagem || (await require('./coletar').lerEstado().catch(() => ({})));
      const pausadaPrincipal = principal.leve_pausa_ate && Date.parse(principal.leve_pausa_ate) > agora;
      const pausadaAqui = pausaMeta && Date.parse(pausaMeta) > agora;
      if (!temMeta) fontes.instagram = { ok: false, pulado: 'Instagram não configurado (META_PAGE_ACCESS_TOKEN / META_IG_USER_ID).' };
      else if (pct != null && pct >= COTA_ALTA) fontes.instagram = { ok: false, pulado: `Cota da Meta em ${pct}%: esta rodada não lê, para sobrar para as contas vigiadas.` };
      else if (pausadaPrincipal || pausadaAqui) fontes.instagram = { ok: false, pulado: `Meta em pausa por limite até ${pausadaAqui ? pausaMeta : principal.leve_pausa_ate}.` };
      else {
        const max = pct != null && pct >= COTA_MEDIA ? MAX_CONTAS_COTA_MEDIA : MAX_CONTAS;
        const todas = deps.contas || (await carregarContas()).contas;
        const fila = todas.filter((c) => !(recusadas[c.handle] && Date.parse(recusadas[c.handle].ate) > agora)).sort((a, b) => Date.parse(lidasEm[a.handle] || 0) - Date.parse(lidasEm[b.handle] || 0)).slice(0, max);
        const r = await coletarInstagram({ contas: fila, graph: deps.graph || meta.graph, igId: deps.igId || meta.config().igId, agora, orcamentoMs: deps.orcamentoMs ?? 25000 });
        for (const c of r.contas) {
          lidasEm[c.handle] = iso(agora); // recusada também anda na fila
          if (c.ok) delete recusadas[c.handle];
          else if (c.invalida || c.tipo === 'permissao') recusadas[c.handle] = { erro: c.original || c.erro, ate: iso(agora + RECUSA_DIAS * 86400000) };
        }
        if (r.contas.some((c) => c.tipo === 'limite')) pausaMeta = iso(agora + Math.max(30, uso.regain_min || 0) * 60000);
        const melhores = [...r.itens].sort((a, b) => b.score - a.score).slice(0, MAX_INSTAGRAM);
        itens.push(...melhores);
        fontes.instagram = { ok: r.contas.some((c) => c.ok), contas_lidas: r.contas.filter((c) => c.ok).length, chamadas: r.chamadas, max_por_rodada: max, uso_meta_pct: pct ?? null, recusadas: r.contas.filter((c) => !c.ok).map((c) => ({ handle: c.handle, erro: c.erro })), itens: melhores.length, parcial: r.parcial };
      }
    } catch (e) { fontes.instagram = { ok: false, erro: String(e.message).slice(0, 160) }; } };
    // 2) Google Trends.
    const fonteTrends = async () => {
      try { const t = await coletarTrends({ fetcher: deps.fetcher, agora }); itens.push(...t); fontes.google_trends = { ok: true, itens: t.length }; }
      catch (e) { fontes.google_trends = { ok: false, erro: String(e.message).slice(0, 160) }; }
    };
    // 3) RapidAPI (opcional).
    const chave = deps.rapidKey ?? (process.env.RAPIDAPI_KEY_IG120 || process.env.RAPIDAPI_KEY || '');
    const bloqueio = estado.rapidapi_bloqueio_ate && Date.parse(estado.rapidapi_bloqueio_ate) > agora;
    let rapidBloqueio = estado.rapidapi_bloqueio_ate || null; const tagsEm = { ...(estado.hashtags_em || {}) };
    const fonteRapid = async () => { if (!chave) fontes.instagram_hashtag = { ok: false, pulado: 'Sem RAPIDAPI_KEY.' };
    else if (process.env.EM_ALTA_RAPIDAPI === '0' && !deps.rapidKey) fontes.instagram_hashtag = { ok: false, pulado: 'Desligado (EM_ALTA_RAPIDAPI=0).' };
    else if (bloqueio) fontes.instagram_hashtag = { ok: false, pulado: `RapidAPI recusou antes; tenta de novo depois de ${estado.rapidapi_bloqueio_ate}.` };
    else {
      const tag = [...HASHTAGS].sort((a, b) => Date.parse(tagsEm[a] || 0) - Date.parse(tagsEm[b] || 0))[0];
      try { const h = await coletarHashtag({ tag, chave, fetcher: deps.fetcherRapid, agora }); tagsEm[tag] = iso(agora); itens.push(...h); fontes.instagram_hashtag = { ok: true, hashtag: tag, itens: h.length }; }
      catch (e) {
        tagsEm[tag] = iso(agora);
        if ([401, 403, 429].includes(e.status)) rapidBloqueio = iso(agora + 86400000);
        fontes.instagram_hashtag = { ok: false, hashtag: tag, erro: String(e.message).slice(0, 160) };
      }
    } };
    await Promise.all([fonteInstagram(), fonteTrends(), fonteRapid()]);
    const g = await guardar(itens, { agora });
    for (const [k, v] of Object.entries(fontes)) if (v.pulado) avisos.push(`${k}: ${v.pulado}`);
    const resumo = { em: iso(agora), origem, fontes, ...g, avisos };
    await salvarEstado({ coletando_ate: null, ultima: resumo, lidas_em: lidasEm, recusadas, meta_pausa_ate: pausaMeta, rapidapi_bloqueio_ate: rapidBloqueio, hashtags_em: tagsEm });
    return { ok: true, ...resumo };
  } catch (e) { await salvarEstado({ coletando_ate: null }).catch(() => {}); throw e; }
}

// ── Leitura ─────────────────────────────────────────────────────────────────────
// score bruto → 0–100 relativo ao maior da mesma fonte; ordem pelo relativo (empate: o mais novo).
async function listar({ fonte = null, limite = 80, agora = Date.now() } = {}) {
  if (!disponivel()) return { itens: [], total: 0, sem_banco: true };
  const limiteMs = agora - RETENCAO_H * 3600000;
  const docs = (await listarDocs()).filter((d) => Date.parse(d.fonte === 'google_trends' ? (d.coletado_em || d.publicado_em) : d.publicado_em) >= limiteMs && (!fonte || d.fonte === fonte));
  const max = {}; for (const d of docs) max[d.fonte] = Math.max(max[d.fonte] || 0, d.score || 0);
  const itens = docs.map((d) => ({ ...d, score_bruto: d.score ?? 0, score: max[d.fonte] > 0 ? Math.round((100 * (d.score || 0)) / max[d.fonte]) : 0 }));
  itens.sort((a, b) => b.score - a.score || b.score_bruto - a.score_bruto || Date.parse(b.publicado_em) - Date.parse(a.publicado_em));
  const porFonte = {}; for (const d of docs) porFonte[d.fonte] = (porFonte[d.fonte] || 0) + 1;
  return { itens: itens.slice(0, Math.min(200, Math.max(1, Number(limite) || 80))), total: itens.length, por_fonte: porFonte };
}

// Leva um post do Instagram para a lista principal da Reciclagem (mesmo id derivado do permalink que a coleta usa),
// para usar o "Reciclar" (clone traduzido/nosso formato) que já existe. Só carrossel e imagem.
async function levarParaReciclagem(id, { agora = Date.now() } = {}) {
  const d = await obter(id); if (!d) throw erro('Item não encontrado.', 'NAO_ENCONTRADO', 404);
  if (!['instagram', 'instagram_hashtag'].includes(d.fonte)) throw erro('Só posts do Instagram podem ser reciclados.', 'REDE', 409);
  if (!['carrossel', 'imagem'].includes(d.tipo)) throw erro('O Reciclar funciona com carrossel e post de imagem (reel ainda não).', 'TIPO', 409);
  const Coletar = require('./coletar');
  const rcId = Coletar.idDe(d.permalink); const ant = await Coletar.obter(rcId);
  const h = String(d.conta?.handle || '').replace(/^[@#]/, '');
  const doc = {
    ...(ant || {}), id: rcId, rede: 'instagram', origem: 'em_alta', conta: ant?.conta || { handle: h, nome: d.conta?.nome || h, pais: 'BR', idioma: 'pt' },
    permalink: d.permalink, publicado_em: d.publicado_em, tipo: d.tipo, curtidas: d.metricas?.curtidas ?? null, comentarios: d.metricas?.comentarios ?? null, visualizacoes: d.metricas?.visualizacoes ?? null,
    seguidores: d.metricas?.seguidores ?? null, midias: d.midias?.length ? d.midias : (ant?.midias || []), midias_em: d.midias?.length ? iso(agora) : (ant?.midias_em || null), n_slides: ant?.n_slides ?? (d.midias?.length || null),
    legenda: d.legenda || ant?.legenda || null, vl: ant?.vl ?? null, tema: ant?.tema ?? null, mecanismo: ant?.mecanismo ?? null, tese: ant?.tese ?? null, ponte_pedro: ant?.ponte_pedro ?? null, classificado_em: ant?.classificado_em ?? null,
    coletado_em: iso(agora), primeira_coleta_em: ant?.primeira_coleta_em || iso(agora), reciclado: ant?.reciclado || [],
  };
  await db().radar.salvar(conta(), Coletar.TIPO, rcId, doc);
  await db().radar.salvar(conta(), TIPO, d.id, { ...d, levado: { id: rcId, em: iso(agora) } });
  return { id: rcId, item: doc };
}

module.exports = {
  TIPO, TIPO_ESTADO, JANELA_H, RETENCAO_H, MAX_CONTAS, MAX_CONTAS_COTA_MEDIA, COTA_MEDIA, COTA_ALTA, CONTAS, CATEGORIAS, HASHTAGS, FONTES, TRENDS_URL, INTERVALO_MANUAL_MS,
  engajamento, pontuar, trafego, idDe, itemIg, coletarInstagram, parseTrends, coletarTrends, itemHashtag, coletarHashtag,
  guardar, coletar, listar, obter, lerEstado, disponivel, carregarContas, salvarConfig, levarParaReciclagem,
};
