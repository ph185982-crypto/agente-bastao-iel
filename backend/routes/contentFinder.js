const express = require('express');
const multer  = require('multer');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(require('ffprobe-static').path);
let _openai = null;
const getOpenAI = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
const router = express.Router();

// ── Layout constants ──────────────────────────────────────────────────────────
const W         = 1080;
const H         = 1920;
const FONT_SIZE = 48;
const LINE_H    = 66;
const H_PAD     = 48;

// Família registrada via fontconfig em backend/fontSetup.js (backend/assets)
const FONT_FAMILY = "'DejaVu Sans', sans-serif";

// ── Shared helpers ────────────────────────────────────────────────────────────

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function streamDownload(url, destPath) {
  return new Promise((resolve, reject) => {
    axios.get(url, {
      responseType: 'stream',
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' },
    }).then(resp => {
      const writer = fs.createWriteStream(destPath);
      resp.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      resp.data.on('error', err => { writer.destroy(); reject(err); });
    }).catch(reject);
  });
}

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const v = meta.streams.find(s => s.codec_type === 'video');
      if (!v) return reject(new Error('No video stream'));
      resolve({
        duration: parseFloat(meta.format.duration) || 30,
        hasAudio: meta.streams.some(s => s.codec_type === 'audio'),
      });
    });
  });
}

function runFFmpeg(cmd, outputPath, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const timer = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch {} reject(new Error('FFmpeg timeout')); }, timeoutMs);
    cmd
      .on('stderr', l => lines.push(l))
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', err => {
        clearTimeout(timer);
        reject(new Error(`${err.message} || ${lines.slice(-5).join(' | ')}`));
      })
      .save(outputPath);
  });
}

async function resolveInstagramUrl(url) {
  const { data } = await axios.get(
    'https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert',
    {
      params: { url: url.trim() },
      headers: {
        'x-rapidapi-host': 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      },
      timeout: 30000,
    }
  );
  if (Array.isArray(data?.media)) {
    const v = data.media.find(m => m.type === 'video' && m.url);
    if (v) return v.url;
  }
  throw new Error('Nenhum vídeo encontrado para este URL');
}

// ── Layout constants for full-frame composite ─────────────────────────────────
const PROFILE_H  = 240;
const HEADLINE_H = 320;
const VIDEO_Y    = PROFILE_H + HEADLINE_H; // 560
const VIDEO_H    = H - VIDEO_Y - 20;       // 1340

async function buildHeadlineOverlay(headline, overlayPath) {
  const lines = wrapText(headline, 28);
  const barH = Math.max(140, 36 + lines.length * LINE_H + 24);
  const textEls = lines.map((line, i) =>
    `<text x="${H_PAD}" y="${36 + (i + 1) * LINE_H}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" font-weight="bold" fill="white" stroke="black" stroke-width="1">${escXml(line)}</text>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${barH}">
    <rect width="${W}" height="${barH}" fill="black" fill-opacity="0.72"/>
    ${textEls}
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(overlayPath);
  return { barH };
}

async function buildReelFrame(templateBuf, headline, framePath) {
  const TXT_FONT_SIZE = 58;
  const TXT_LINE_H    = 84;
  const lines = wrapText(headline, 22);
  const totalTextH = lines.length * TXT_LINE_H;
  const textTopY   = PROFILE_H + (HEADLINE_H - totalTextH) / 2;
  const textEls = lines.map((line, i) =>
    `<text x="${W / 2}" y="${textTopY + (i + 1) * TXT_LINE_H}" font-family="${FONT_FAMILY}" font-size="${TXT_FONT_SIZE}" font-weight="bold" fill="#111111" text-anchor="middle">${escXml(line)}</text>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${textEls}
  </svg>`;
  const frameBuf = await sharp(Buffer.from(svg))
    .composite([{
      input: await sharp(templateBuf)
        .resize(W, PROFILE_H, { fit: 'cover', position: 'top' })
        .toBuffer(),
      top: 0, left: 0,
    }])
    .png()
    .toBuffer();
  await sharp(frameBuf).toFile(framePath);
}

// ── Agent 1 — Buscador por contas-semente ────────────────────────────────────

// Contas Instagram curadas por tema (validadas na instagram120 API)
const SEED_ACCOUNTS = {
  ciencia:      ['natgeo', 'sciencechannel', 'bbcearth', 'discovery', 'smithsonian', 'newscientist'],
  tecnologia:   ['tecmundo', 'canaltech', 'tech', 'mrwhosetheboss', 'hashem.alghaili'],
  historia:     ['dw_stories', 'smithsonian', 'natgeo', 'discovery'],
  espaco:       ['nasa', 'spacex', 'europeanspaceagency'],
  china:        ['cgtn', 'dw_stories', 'discovery', 'natgeo'],
  engenharia:   ['interestingengineering', 'hashem.alghaili', 'futurism', 'tech'],
  curiosidades: ['unilad', 'didyouknowpage', 'discovery', 'natgeo', 'bbcearth'],
  invencoes:    ['interestingengineering', 'futurism', 'hashem.alghaili', 'tech'],
};

// Keywords de busca no TikTok por tema
const TIKTOK_KEYWORDS = {
  ciencia:      ['ciencia incrivel', 'science facts', 'descoberta cientifica'],
  tecnologia:   ['technology innovation', 'tech gadgets 2024', 'tecnologia futuro'],
  historia:     ['history facts', 'curiosidade historica', 'fatos historicos'],
  espaco:       ['space discovery', 'nasa news', 'universe facts'],
  china:        ['china technology', 'china innovation', 'made in china'],
  engenharia:   ['engineering amazing', 'mega construction', 'engenharia impressionante'],
  curiosidades: ['did you know', 'voce sabia', 'mind blowing facts'],
  invencoes:    ['invention amazing', 'cool gadgets', 'genius invention'],
};

const TIKTOK_HOST = 'tiktok-api23.p.rapidapi.com';
const TIKTOK_KEY  = process.env.RAPIDAPI_KEY_TIKTOK || process.env.RAPIDAPI_KEY;

// Palavras que indicam conteúdo educativo/informativo (PT + EN)
const EDUCATION_KEYWORDS = [
  'você sabia', 'ninguém te contou', 'descoberta', 'incrível', 'impressionante',
  'a china', 'a nasa', 'a ciência', 'engenharia', 'tecnologia', 'sabia que',
  'fato', 'história real', 'antes de', 'o segredo', 'pesquisa', 'estudo',
  'scientist', 'engineer', 'innovation', 'technology', 'history', 'science',
  'discovery', 'invention', 'amazing', 'incredible', 'never knew', 'did you know',
];

// Palavras que indicam spam/comercial — excluir antes do GPT
const SPAM_WORDS = [
  'sorteio', 'giveaway', 'link na bio para comprar', 'promoção',
  'desconto', 'venda', 'preço', 'oferta', 'compre agora', 'whatsapp',
  'clique no link', 'acesse o link',
];

function calcViralScore(post) {
  let score = 0;
  const views    = post.views    || 0;
  const likes    = post.likes    || 0;
  const comments = post.comments || 0;
  const duration = post.duration || 0;

  // Views
  if (views > 1000000)     score += 40;
  else if (views > 500000) score += 30;
  else if (views > 100000) score += 20;
  else if (views > 50000)  score += 10;

  // Ratio likes/views (engajamento)
  const ratio = views > 0 ? likes / views : 0;
  if (ratio > 0.05)      score += 20;
  else if (ratio > 0.03) score += 15;
  else if (ratio > 0.01) score += 10;

  // Comentários (debate/curiosidade)
  if (comments > 1000)     score += 20;
  else if (comments > 500) score += 15;
  else if (comments > 100) score += 10;

  // Duração ideal para Reels (15–60s)
  if (duration >= 15 && duration <= 60) score += 20;
  else if (duration > 0 && duration <= 90) score += 10;

  return score; // máximo ~100
}

// Retorna motivo de exclusão ou null se aprovado
function shouldExclude(post) {
  const cap = (post.caption || '').toLowerCase();

  if (SPAM_WORDS.some(w => cap.includes(w)))
    return `spam/comercial`;

  // Mais de 10 emojis = baixa qualidade
  const emojiCount = (cap.match(/\p{Emoji_Presentation}/gu) || []).length;
  if (emojiCount > 10)
    return `excesso de emojis (${emojiCount})`;

  if (post.duration > 0 && post.duration < 10)
    return `vídeo muito curto (${post.duration.toFixed(1)}s)`;

  if (post.followers > 0 && post.followers < 1000)
    return `conta pequena (${post.followers} seguidores)`;

  if (post.is_ad)
    return 'é anúncio (is_ad)';

  return null;
}

// Heurística simples de idioma PT
function isPtContent(caption) {
  const text = caption || '';
  if (/[áéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]/.test(text)) return true;
  if (/\b(você|com|não|mas|para|que|uma|esse|essa|isso|por|como|mais|também|são|foi|era|tem|ser|fazer|ver|quando|onde)\b/i.test(text)) return true;
  return false;
}

function rapidApiError(e) {
  const msg = e.response?.data?.message || e.message;
  if (e.response?.status === 429) return new Error(`Cota mensal da API esgotada: ${msg}`);
  if (e.response?.status === 403) return new Error(`Chave não assinada nesta API (${msg})`);
  return new Error(msg);
}

const IG120_HOST = 'instagram120.p.rapidapi.com';
const IG120_KEY  = process.env.RAPIDAPI_KEY_IG120 || process.env.RAPIDAPI_KEY;
const ig120Headers = () => ({
  'Content-Type': 'application/json',
  'x-rapidapi-host': IG120_HOST,
  'x-rapidapi-key': IG120_KEY,
});

// Busca reels de uma conta (retorna play_count mas sem video_versions)
async function fetchReels(username) {
  console.log(`[A1] Buscando reels de @${username}…`);
  const { data } = await axios.post(
    `https://${IG120_HOST}/api/instagram/reels`,
    { username, maxId: '' },
    { headers: ig120Headers(), timeout: 20000 }
  );
  const edges = data?.result?.edges || [];
  return edges.map(e => {
    const m = e.node?.media || e.node || {};
    return {
      code:      m.code || '',
      views:     m.play_count || 0,
      likes:     m.like_count || 0,
      comments:  m.comment_count || 0,
      username,
    };
  }).filter(p => p.code);
}

// Busca posts de uma conta (retorna video_versions + caption)
async function fetchPosts(username) {
  console.log(`[A1] Buscando posts de @${username}…`);
  const { data } = await axios.post(
    `https://${IG120_HOST}/api/instagram/posts`,
    { username, maxId: '' },
    { headers: ig120Headers(), timeout: 20000 }
  );
  const edges = data?.result?.edges || [];
  const map = {};
  for (const e of edges) {
    const n = e.node || {};
    if (!n.video_versions?.length) continue;
    const cap = n.caption || {};
    map[n.code] = {
      videoUrl:  n.video_versions[0].url,
      caption:   typeof cap === 'object' ? (cap.text || '') : String(cap || ''),
      duration:  n.video_duration || 0,
      hasAudio:  n.has_audio ?? true,
      is_ad:     n.is_paid_partnership || false,
    };
  }
  return map;
}

// Busca completa de uma conta: reels (métricas) + posts (vídeo/caption), cruzando por code
async function searchAccount(username) {
  const [reels, postsMap] = await Promise.all([
    fetchReels(username).catch(e => { console.warn(`[A1] reels @${username} falhou: ${e.message}`); return []; }),
    fetchPosts(username).catch(e => { console.warn(`[A1] posts @${username} falhou: ${e.message}`); return {}; }),
  ]);

  const merged = [];
  for (const reel of reels) {
    const post = postsMap[reel.code];
    if (!post) continue; // sem video_versions → pula
    merged.push({
      code:      reel.code,
      views:     reel.views,
      likes:     reel.likes,
      comments:  reel.comments,
      duration:  post.duration,
      caption:   post.caption,
      videoUrl:  post.videoUrl,
      username:  reel.username,
      followers: 0,
      is_ad:     post.is_ad,
    });
  }
  console.log(`[A1] @${username}: ${reels.length} reels, ${Object.keys(postsMap).length} vídeo-posts, ${merged.length} cruzados`);
  return merged;
}

// ── TikTok search via tiktok-api23 ──────────────────────────────────────────
async function searchTikTok(keyword) {
  console.log(`[A1-TT] Buscando TikTok: "${keyword}"…`);
  const { data } = await axios.get(
    `https://${TIKTOK_HOST}/api/search/general`,
    {
      params: { keyword, count: 15 },
      headers: {
        'x-rapidapi-host': TIKTOK_HOST,
        'x-rapidapi-key': TIKTOK_KEY,
      },
      timeout: 20000,
    }
  );
  const items = data?.item_list || [];
  const posts = items
    .filter(item => {
      const vid = item?.video;
      return vid && (vid.playAddr || vid.downloadAddr);
    })
    .map(item => {
      const stats = item.stats || {};
      const vid   = item.video || {};
      const author = item.author || {};
      const durMs = vid.duration || 0;
      return {
        code:      item.id || '',
        views:     stats.playCount || 0,
        likes:     stats.diggCount || 0,
        comments:  stats.commentCount || 0,
        duration:  durMs > 1000 ? Math.round(durMs / 1000) : durMs,
        caption:   item.desc || '',
        videoUrl:  vid.downloadAddr || vid.playAddr || null,
        username:  author.uniqueId || author.nickname || '',
        followers: 0,
        is_ad:     item.isAd || false,
        source:    'tiktok',
      };
    })
    .filter(p => p.code && p.videoUrl);
  console.log(`[A1-TT] "${keyword}": ${posts.length} vídeos encontrados`);
  return posts;
}

// ── Agent 2 — Analisador ──────────────────────────────────────────────────────
async function analyzeContent(candidate) {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é um especialista em conteúdo viral do Instagram. Analise este conteúdo com base nas métricas e contexto fornecidos e retorne um JSON com:
{
  "viral_score": número de 0 a 100,
  "viral_reasons": ["motivo1", "motivo2"],
  "ban_risk": "baixo" | "médio" | "alto",
  "ban_reasons": [],
  "copyright_risk": "baixo" | "médio" | "alto",
  "copyright_reasons": [],
  "approved": true | false,
  "reject_reason": "string ou null",
  "content_category": "tecnologia" | "curiosidade" | "história" | "ciência" | "engenharia" | "espaço" | "negócios" | "outro",
  "fit_for_profile": número de 0 a 100
}

Perfil do criador (@pedro_destrava):
- Nicho: curiosidades de tecnologia, ciência, história e inovação
- Tom: informativo, surpreendente, "o que ninguém te contou"
- Audiência: 175k seguidores brasileiros, adultos
- Conteúdos que mais viralizam: tecnologia retrô vs atual, inovações chinesas, curiosidades históricas, ciência aplicada
- NÃO aprovar: conteúdo político, violento, sexual, músicas famosas (alto risco copyright), humor genérico, vlogs pessoais
- APROVAR se viral_score >= 55 E ban_risk != "alto" E fit_for_profile >= 50
- Perfis de mídia/ciência/tecnologia são geralmente seguros — assuma baixo risco se não há indicação contrária`,
      },
      {
        role: 'user',
        content: `Perfil de origem: @${candidate.sourceUsername || 'desconhecido'}
Views: ${(candidate.views || 0).toLocaleString('pt-BR')}
Likes: ${(candidate.likes || 0).toLocaleString('pt-BR')}
Comentários: ${(candidate.comments || 0).toLocaleString('pt-BR')}
Contexto/Caption: ${candidate.originalCaption || '(sem caption)'}

Com base no perfil e métricas, avalie o potencial viral e adequação para @pedro_destrava.`,
      },
    ],
    max_tokens: 400,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(res.choices[0].message.content || '{}');
}

// ── Agent 3 — Criador de Copy ─────────────────────────────────────────────────
async function generateCopy(candidate, analysis) {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é especialista em copy viral para Instagram Reels brasileiro.
Estilo do criador @pedro_destrava:
- Headlines: curtas, impactantes, geram curiosidade. Ex: "O que ninguém te contou sobre…", "Isso mudou o mundo e ninguém percebeu", "A China fez isso e o mundo ignorou"
- Legendas: começam com fato surpreendente, explicam em parágrafos curtos, terminam com CTA "Segue o @pedro_destrava"
- Tom: informativo, direto, surpreendente
- Sem hashtags genéricas em excesso

Retorne JSON:
{
  "headline": "texto curto para sobrepor no vídeo (máximo 8 palavras)",
  "caption": "legenda completa pronta para postar no Instagram"
}`,
      },
      {
        role: 'user',
        content: `Conteúdo original: ${candidate.originalCaption || '(sem caption)'}
Categoria: ${analysis.content_category}
Motivos virais: ${(analysis.viral_reasons || []).join(', ')}
Viral score: ${analysis.viral_score}

Gere headline impactante e legenda longa para este conteúdo.`,
      },
    ],
    max_tokens: 800,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  return {
    headline: (parsed.headline || '').trim().replace(/^["'""'']+|["'""'']+$/g, ''),
    caption:  (parsed.caption  || '').trim(),
  };
}

// ── Main search pipeline ──────────────────────────────────────────────────────
async function runSearch({ themes = [], minViews = 50000, minEngagement = 0, lang = 'any' }) {
  // ── A1: busca paralela em Instagram (contas-semente) + TikTok (keywords) ──
  const allAccounts = themes.flatMap(t => SEED_ACCOUNTS[t] || []);
  if (allAccounts.length === 0) Object.values(SEED_ACCOUNTS).forEach(a => allAccounts.push(a[0]));
  const uniqueAccounts = [...new Set(allAccounts)];
  const igAccounts = uniqueAccounts.sort(() => Math.random() - 0.5).slice(0, 3);

  const allKeywords = themes.flatMap(t => TIKTOK_KEYWORDS[t] || []);
  if (allKeywords.length === 0) Object.values(TIKTOK_KEYWORDS).forEach(k => allKeywords.push(k[0]));
  const ttKeywords = [...new Set(allKeywords)].sort(() => Math.random() - 0.5).slice(0, 2);

  console.log(`[A1] Instagram: ${igAccounts.map(u => '@' + u).join(', ')}`);
  console.log(`[A1] TikTok: ${ttKeywords.map(k => '"' + k + '"').join(', ')}`);

  // Busca paralela em ambas as plataformas
  const igPromises = igAccounts.map(async u => {
    try { return await searchAccount(u); }
    catch (e) { console.warn(`[A1][skip] @${u}: ${rapidApiError(e).message}`); return []; }
  });
  const ttPromises = ttKeywords.map(async k => {
    try { return await searchTikTok(k); }
    catch (e) { console.warn(`[A1-TT][skip] "${k}": ${rapidApiError(e).message}`); return []; }
  });

  const allResults = await Promise.allSettled([...igPromises, ...ttPromises]);

  const rawPosts = [];
  let anyOk = false;
  let firstError = null;
  for (const r of allResults) {
    if (r.status === 'fulfilled' && r.value.length > 0) { rawPosts.push(...r.value); anyOk = true; }
    else if (r.status === 'rejected' && !firstError) firstError = r.reason;
  }
  if (!anyOk && firstError) throw firstError;
  if (!anyOk) throw new Error('Nenhuma fonte retornou resultados. Tente novamente ou selecione outros temas.');
  console.log(`[A1] Total bruto: ${rawPosts.length} posts (IG + TikTok)`);

  // ── Pré-filtros (antes do GPT-4o) ────────────────────────────────────────
  const candidates = [];
  for (const post of rawPosts) {
    // 1. Filtros de exclusão automática
    const excl = shouldExclude(post);
    if (excl) {
      console.log(`[A1][excl] ${post.code}: ${excl}`);
      continue;
    }

    // 2. Views mínimas
    if (post.views < minViews) {
      console.log(`[A1][views] ${post.code}: ${post.views.toLocaleString()} < mín ${minViews.toLocaleString()}`);
      continue;
    }

    // 3. Engajamento mínimo
    const ratio = post.views > 0 ? post.likes / post.views : 0;
    if (ratio < minEngagement) {
      console.log(`[A1][eng] ${post.code}: ${(ratio * 100).toFixed(1)}% < mín ${(minEngagement * 100).toFixed(1)}%`);
      continue;
    }

    // 4. Filtro de idioma
    if (lang === 'pt' && !isPtContent(post.caption)) {
      console.log(`[A1][lang] ${post.code}: conteúdo não-PT ignorado`);
      continue;
    }

    // 5. Keywords educativas (boost de score)
    const capLower = (post.caption || '').toLowerCase();
    const hasEduKw = EDUCATION_KEYWORDS.some(k => capLower.includes(k));

    // 6. Score preliminar
    const preScore = calcViralScore(post) + (hasEduKw ? 10 : 0);
    console.log(`[A1] ${post.code}: preScore=${preScore}, edu=${hasEduKw}, views=${post.views.toLocaleString()}, eng=${(ratio * 100).toFixed(1)}%`);

    if (preScore < 40) {
      console.log(`[A1][score] ${post.code}: score ${preScore} < 40, descartado`);
      continue;
    }

    const isTikTok = post.source === 'tiktok';
    candidates.push({
      url:             isTikTok
        ? `https://www.tiktok.com/@${post.username}/video/${post.code}`
        : `https://www.instagram.com/reel/${post.code}/`,
      videoUrl:        post.videoUrl,
      thumbnail:       null,
      likes:           post.likes,
      views:           post.views,
      comments:        post.comments,
      preScore,
      originalCaption: post.caption
        ? `Caption original: "${post.caption.slice(0, 400)}" — @${post.username}, ${post.views.toLocaleString()} views, ${post.likes.toLocaleString()} likes`
        : `Reel de @${post.username} — ${post.views.toLocaleString()} views, ${post.likes.toLocaleString()} likes`,
      sourceUsername:  post.username,
      source:          isTikTok ? 'tiktok' : 'instagram',
    });
  }

  // Ordena por score, desduplicar por URL, limita a 10 para o GPT
  candidates.sort((a, b) => b.preScore - a.preScore);
  const deduped = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 10);
  console.log(`[A1] ${deduped.length} candidatos após pré-filtro → Agente 2`);

  if (deduped.length === 0) return [];

  // ── A2: análise paralela com GPT-4o ──────────────────────────────────────
  const analyses = await Promise.allSettled(deduped.map(c => analyzeContent(c)));
  const analyzed = deduped.map((c, i) => ({
    ...c,
    ...(analyses[i].status === 'fulfilled' ? analyses[i].value : { approved: false }),
  }));
  const approved = analyzed.filter(a => a.approved === true);
  console.log(`[A2] ${approved.length}/${analyzed.length} aprovados`);

  if (approved.length === 0) return [];

  // ── A3: geração de copy paralela ──────────────────────────────────────────
  const copies = await Promise.allSettled(approved.map(c => generateCopy(c, c)));

  const withCopy = [];
  for (let i = 0; i < approved.length; i++) {
    if (copies[i].status !== 'fulfilled') continue;
    const copy = copies[i].value;
    if (!copy.headline) continue;
    withCopy.push({ ...approved[i], headline: copy.headline, caption: copy.caption });
  }

  // ── Diversificação: máx 3 por nicho, máx 2 por conta ─────────────────────
  const byCat = {};
  const byAcc = {};
  const final = [];

  for (const r of withCopy) {
    const cat = r.content_category || 'outro';
    const acc = r.sourceUsername   || '';

    if ((byCat[cat] || 0) >= 3) {
      console.log(`[diversify] skip: já 3 do nicho "${cat}"`);
      continue;
    }
    if ((byAcc[acc] || 0) >= 2) {
      console.log(`[diversify] skip: já 2 da conta @${acc}`);
      continue;
    }

    byCat[cat] = (byCat[cat] || 0) + 1;
    byAcc[acc] = (byAcc[acc] || 0) + 1;

    final.push({
      index:             final.length,
      url:               r.url,
      videoUrl:          r.videoUrl,
      thumbnail:         r.thumbnail,
      likes:             r.likes,
      views:             r.views,
      originalCaption:   r.originalCaption,
      viral_score:       r.viral_score       || 0,
      viral_reasons:     r.viral_reasons     || [],
      ban_risk:          r.ban_risk          || 'baixo',
      ban_reasons:       r.ban_reasons       || [],
      copyright_risk:    r.copyright_risk    || 'baixo',
      copyright_reasons: r.copyright_reasons || [],
      content_category:  r.content_category  || 'outro',
      fit_for_profile:   r.fit_for_profile   || 0,
      headline:          r.headline,
      caption:           r.caption,
      source:            r.source             || 'instagram',
    });

    if (final.length >= 10) break;
  }

  console.log(`[pipeline] ${final.length} resultados finais`);
  return final;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/content-finder/search
router.post('/search', async (req, res) => {
  const { themes, minViews, minEngagement, lang } = req.body;

  if (!Array.isArray(themes) || themes.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos um tema' });
  }
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  }

  try {
    const results = await runSearch({
      themes,
      minViews:      Number(minViews)      || 50000,
      minEngagement: Number(minEngagement) || 0,
      lang:          lang || 'any',
    });
    res.json({ results });
  } catch (e) {
    console.error('[contentFinder] search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content-finder/approve — Agent 4: edits video, streams MP4 directly
// Accepts multipart/form-data: fields (videoUrl, postUrl, headline, caption) + file (template)
router.post('/approve', upload.single('template'), async (req, res) => {
  const { videoUrl: directUrl, postUrl, headline, caption } = req.body;
  if (!headline?.trim()) return res.status(400).json({ error: 'headline é obrigatória' });
  if (!directUrl && !postUrl) return res.status(400).json({ error: 'videoUrl ou postUrl é obrigatório' });

  if (!process.env.RAPIDAPI_KEY && !directUrl) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  }

  const templateBuf = req.file?.buffer || null;
  const sid         = crypto.randomUUID();
  const rawVideo    = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const framePng    = path.join(os.tmpdir(), `${sid}_frame.png`);
  const output      = path.join(os.tmpdir(), `${sid}_final.mp4`);

  const cleanTmp = () => [rawVideo, framePng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  try {
    const downloadVideo = async () => {
      if (directUrl) {
        try { await streamDownload(directUrl, rawVideo); return; }
        catch (e) {
          console.warn('[contentFinder] URL direta falhou, resolvendo via API:', e.message);
          if (!postUrl) throw e;
        }
      }
      const resolved = await resolveInstagramUrl(postUrl);
      await streamDownload(resolved, rawVideo);
    };

    const [{ hasAudio, duration }] = await Promise.all([
      downloadVideo().then(() => getVideoInfo(rawVideo)),
      templateBuf
        ? buildReelFrame(templateBuf, headline.trim(), framePng)
        : buildHeadlineOverlay(headline.trim(), framePng),
    ]);

    const clipDur = Math.min(duration, 20).toFixed(3);
    let filterGraph;

    if (templateBuf) {
      filterGraph = [
        `[0:v]scale=${W}:-2,crop=${W}:${VIDEO_H}:0:(ih-${VIDEO_H})/2,setpts=PTS-STARTPTS[vid]`,
        `[1:v]loop=loop=-1:size=1:start=0[frame]`,
        `[frame][vid]overlay=0:${VIDEO_Y}:eof_action=endall[out]`,
      ].join(';');
    } else {
      filterGraph = [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[scaled]`,
        `[1:v]loop=loop=-1:size=1:start=0[bar]`,
        `[scaled][bar]overlay=0:0:eof_action=endall[out]`,
      ].join(';');
    }

    const outputOpts = [
      '-map [out]', '-c:v libx264', '-preset ultrafast', '-crf 28',
      '-r 30', `-t ${clipDur}`, '-pix_fmt yuv420p',
    ];
    if (hasAudio) outputOpts.push('-map 0:a', '-c:a aac', '-b:a 128k');
    else outputOpts.push('-an');

    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(framePng)
      .complexFilter(filterGraph)
      .outputOptions(outputOpts);

    await runFFmpeg(cmd, output, 50000);
    cleanTmp();

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="reel_reciclado.mp4"');
    res.setHeader('Access-Control-Expose-Headers', 'X-Headline, X-Caption');
    res.setHeader('X-Headline', encodeURIComponent(headline || ''));
    res.setHeader('X-Caption',  encodeURIComponent(caption  || ''));

    const stream = fs.createReadStream(output);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(output); } catch {} });
    stream.on('error', err => {
      console.error('[contentFinder] stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar vídeo' });
    });
  } catch (e) {
    cleanTmp();
    console.error('[contentFinder] approve error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
