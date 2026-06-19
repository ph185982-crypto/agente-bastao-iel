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
const vault = require('../lib/vault');
const { PERSONAS: JURY_PERSONAS } = require('./headlineJury'); // 100 personas para pré-veto

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
  // Text centered in the headline zone (below the profile area)
  const textTopY   = PROFILE_H + (HEADLINE_H - totalTextH) / 2;
  const textEls = lines.map((line, i) =>
    `<text x="${W / 2}" y="${textTopY + (i + 1) * TXT_LINE_H}" font-family="${FONT_FAMILY}" font-size="${TXT_FONT_SIZE}" font-weight="bold" fill="#111111" text-anchor="middle">${escXml(line)}</text>`
  ).join('');
  // SVG is the base layer (white background + headline text)
  // Template is composited on top — headline text appears BEHIND the template where it overlaps
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${textEls}
  </svg>`;
  // SVG is base layer — template composited on top so headline text appears behind the template photo.
  // Resize to VIDEO_Y height (not just PROFILE_H) so profile circle at top is never cut.
  // position: 'left top' preserves the top-left corner where the profile circle sits.
  const frameBuf = await sharp(Buffer.from(svg))
    .composite([{
      input: await sharp(templateBuf)
        .resize(W, VIDEO_Y, { fit: 'cover', position: 'left top' })
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

// Semantic spam patterns (score-based, threshold 60 = exclude)
const SPAM_PATTERNS = [
  { re: /marque?\s+\d+\s+amigos?/i,                        score: 40, tag: 'engajamento forçado' },
  { re: /coment[ae]\s+sim\b/i,                             score: 30, tag: 'engajamento forçado' },
  { re: /arrast[ae]?\s+(para\s+cima|pra\s+cima|p[/'`]?cima)/i, score: 25, tag: 'CTA arrasta' },
  { re: /\bwhatsapp\.com\b|\bwa\.me\b/i,                   score: 50, tag: 'WhatsApp redirect' },
  { re: /link\s+(na|no)\s+bio/i,                           score: 25, tag: 'link externo' },
  { re: /R\$\s*\d+|\d+\s*reais\b/i,                       score: 60, tag: 'preço/venda' },
  { re: /\b(sorteio|giveaway|concurso)\b/i,                score: 70, tag: 'sorteio/giveaway' },
  { re: /\b(desconto|promoção|oferta\s+exclusiva)\b/i,     score: 50, tag: 'promoção' },
  { re: /\b(compre|comprar|compra\s+agora)\b/i,            score: 40, tag: 'venda' },
  { re: /\bfrete\s+gr[aá]tis\b|\bentrega\s+gr[aá]tis\b/i, score: 50, tag: 'e-commerce' },
];

function calcSpamScore(text) {
  let score = 0;
  const tags = [];
  for (const p of SPAM_PATTERNS) {
    if (p.re.test(text)) { score += p.score; tags.push(p.tag); }
  }
  return { score: Math.min(score, 100), tags };
}

// Idade do post em horas (null se timestamp ausente/inválido)
function ageHoursOf(takenAt) {
  if (!takenAt || takenAt <= 0) return null;
  const ageH = (Date.now() / 1000 - takenAt) / 3600;
  return ageH > 0 ? ageH : null;
}

// Velocidade viral: views por hora desde a publicação (null se sem timestamp)
function velocityOf(post) {
  const ageH = ageHoursOf(post.takenAt);
  if (ageH === null || !post.views) return null;
  return Math.round(post.views / ageH);
}

function calcViralScore(post) {
  let score = 0;
  const views    = post.views    || 0;
  const likes    = post.likes    || 0;
  const comments = post.comments || 0;
  const duration = post.duration || 0;

  // ── Sinal absoluto (alcance bruto) ──────────────────────────────────────────
  if (views > 1000000)     score += 30;
  else if (views > 500000) score += 22;
  else if (views > 100000) score += 15;
  else if (views > 50000)  score += 8;

  const ratio = views > 0 ? likes / views : 0;
  if (ratio > 0.05)      score += 18;
  else if (ratio > 0.03) score += 13;
  else if (ratio > 0.01) score += 8;

  if (comments > 1000)     score += 15;
  else if (comments > 500) score += 11;
  else if (comments > 100) score += 7;

  if (duration >= 15 && duration <= 60) score += 18;
  else if (duration > 0 && duration <= 90) score += 9;

  // ── Velocidade viral (views/hora) — o sinal de "está bombando AGORA" ────────
  const vph = velocityOf(post);
  if (vph !== null) {
    if (vph > 20000)      score += 35;   // explodindo
    else if (vph > 8000)  score += 26;
    else if (vph > 3000)  score += 18;
    else if (vph > 1000)  score += 10;
    else if (vph > 300)   score += 4;
  }

  // ── Frescor — repostar coisa do momento ─────────────────────────────────────
  const ageH = ageHoursOf(post.takenAt);
  if (ageH !== null) {
    const days = ageH / 24;
    if (days <= 3)       score += 16;
    else if (days <= 7)  score += 11;
    else if (days <= 14) score += 6;
    else if (days > 90)  score -= 12;    // conteúdo velho, penaliza
    else if (days > 45)  score -= 5;
  }

  // TikTok needs higher viral signal to compensate for lower trust
  if (post.source === 'tiktok') score -= 10;

  return Math.max(0, score);
}

// Retorna motivo de exclusão ou null se aprovado
function shouldExclude(post) {
  const { score: spamScore, tags } = calcSpamScore(post.caption || '');
  if (spamScore >= 60)
    return `spam/comercial (score ${spamScore}: ${tags.join(', ')})`;

  const emojiCount = ((post.caption || '').match(/\p{Emoji_Presentation}/gu) || []).length;
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

// In-memory session dedup — persists across warm serverless invocations
const usedVideoUrls = new Set();

// ── Aprendizado/descoberta de contas (in-memory, warm lambda) ─────────────────
// Guarda o melhor preScore já visto por conta, para enriquecer buscas futuras
// com fontes que historicamente entregam vídeos quentes (Fase 1 — efêmero).
const accountScores = new Map(); // username -> { best, count, source }

function recordAccountPerformance(username, score, source) {
  if (!username) return;
  const cur = accountScores.get(username) || { best: 0, count: 0, source };
  cur.best   = Math.max(cur.best, score);
  cur.count += 1;
  cur.source = source;
  accountScores.set(username, cur);
}

// Top contas aprendidas de uma fonte que ainda não estão na lista atual
function topLearnedAccounts(source, exclude, n) {
  return [...accountScores.entries()]
    .filter(([u, v]) => v.source === source && v.best >= 60 && !exclude.includes(u))
    .sort((a, b) => b[1].best - a[1].best)
    .slice(0, n)
    .map(([u]) => u);
}

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
      takenAt:   n.taken_at || n.taken_at_timestamp || (typeof cap === 'object' ? cap.created_at : 0) || 0,
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
      takenAt:   post.takenAt || 0,
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
        takenAt:   item.createTime || 0,
        source:    'tiktok',
      };
    })
    .filter(p => p.code && p.videoUrl);
  console.log(`[A1-TT] "${keyword}": ${posts.length} vídeos encontrados`);
  return posts;
}

// ── Agent 2+3 — Analista Unificado (análise + fact-check + copy em 1 call) ────
async function analyzeAndGenerate(candidate) {
  const isTikTok = candidate.source === 'tiktok';
  const controversyNote = candidate.controversy_flag
    ? `\n⚠️ ATENÇÃO: ratio comentários/likes=${candidate.controversy_ratio?.toFixed(2)} (anormalmente alto — pode ser conteúdo polêmico).`
    : '';

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é agente de curadoria para @pedro_destrava (175k seguidores BR, nicho tech/ciência/curiosidades/história).

Analise o candidato e retorne JSON completo com análise, fact-check, copy e veredito:
{
  "viral_score": 0-100,
  "viral_reasons": ["reason"],
  "content_category": "tecnologia"|"curiosidade"|"história"|"ciência"|"engenharia"|"espaço"|"negócios"|"outro",
  "fit_for_profile": 0-100,
  "ban_risk": "baixo"|"médio"|"alto",
  "ban_reasons": [],
  "copyright_risk": "baixo"|"médio"|"alto",
  "copyright_reasons": [],
  "factual_confidence": 0-100,
  "factual_flags": [],
  "misleading_caption": false,
  "headline": "máx 8 palavras, impactante",
  "caption": "legenda completa para postar — começa com fato surpreendente, parágrafos curtos, termina com 'Segue o @pedro_destrava'",
  "headline_matches_source": true,
  "headline_clickbait_risk": "baixo"|"médio"|"alto",
  "approved": true|false,
  "reject_reason": null,
  "quality_tier": "A"|"B"|"C"|"D",
  "warnings": []
}

Regras de aprovação:
- approved = true SE: viral_score >= 50 E ban_risk != "alto" E fit_for_profile >= 40 E factual_confidence >= 30 E misleading_caption = false
- Seja generoso com conteúdo de ciência, tecnologia, curiosidades, história, engenharia e espaço — esses são os nichos do perfil
- quality_tier: A (viral_score>80 sem warnings), B (>65), C (>50), D (abaixo)
- NÃO aprovar: político partidário, violento, sexual, músicas famosas (copyright), vlogs pessoais
- Headlines style: "O que ninguém te contou sobre…", "A China fez isso e o mundo ignorou"`,
      },
      {
        role: 'user',
        content: `Fonte: ${isTikTok ? 'TikTok (verifique factual_confidence com cuidado)' : 'Instagram'}
Perfil: @${candidate.sourceUsername || 'desconhecido'}
Views: ${(candidate.views || 0).toLocaleString('pt-BR')}
Likes: ${(candidate.likes || 0).toLocaleString('pt-BR')}
Comentários: ${(candidate.comments || 0).toLocaleString('pt-BR')}
Caption original (até 600 chars): ${(candidate.originalCaption || '(sem caption)').slice(0, 600)}${controversyNote}`,
      },
    ],
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  if (parsed.headline) {
    parsed.headline = parsed.headline.trim().replace(/^["'""'']+|["'""'']+$/g, '');
  }
  return parsed;
}

// ── Mini-Júri (10 personas, 1 rodada, gpt-4o-mini, GATING) ───────────────────
const MINI_JURY_PERSONAS = [
  { id:  1, name: 'João',    age: 22, desc: 'Estudante universitário de TI, atenção curtíssima, passa o dedo se não entender em 2 segundos.' },
  { id: 10, name: 'Bruna',   age: 26, desc: 'Recepcionista, faz scroll compulsivo no almoço, headline precisa ser irresistível para ela parar.' },
  { id: 41, name: 'Sérgio',  age: 44, desc: 'Construtor civil, celular só à noite, gosta de curiosidades práticas e diretas.' },
  { id: 55, name: 'Luiz',    age: 42, desc: 'Gerente de TI, exigente com qualidade, detecta conteúdo raso na hora.' },
  { id: 61, name: 'Bianca',  age: 31, desc: 'Analista de dados, adora fatos e números concretos, desconfia de generalizações.' },
  { id: 72, name: 'Gustavo', age: 34, desc: 'Arquiteto cloud, entusiasta de tecnologia, engaja quando vê inovação genuína.' },
  { id: 81, name: 'Geraldo', age: 55, desc: 'Engenheiro aposentado, lê com calma, detecta inconsistência técnica facilmente.' },
  { id: 86, name: 'Lúcia',   age: 44, desc: 'Advogada, cética, pesquisa antes de compartilhar, não tolera sensacionalismo.' },
  { id: 91, name: 'Rafa',    age: 31, desc: 'Jornalista investigativo, detecta clickbait em milissegundos, denuncia conteúdo enganoso.' },
  { id: 96, name: 'Clara',   age: 25, desc: 'Doutoranda em ciências sociais, analisa retórica e manipulação, imune a sensacionalismo.' },
];

async function runMiniJury(headline, originalCaption) {
  const results = await Promise.all(
    MINI_JURY_PERSONAS.map(async (persona) => {
      try {
        const res = await getOpenAI().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é ${persona.name}, ${persona.age} anos. ${persona.desc} Está scrollando Instagram agora.`,
            },
            {
              role: 'user',
              content: `Headline: "${headline}"
Conteúdo original: "${(originalCaption || '').slice(0, 300)}"

Avalie brevemente. Retorne JSON:
{ "parou": boolean, "problema": "string descrevendo problema sério OU null se ok", "factual_issue": boolean }`,
            },
          ],
          max_tokens: 120,
          response_format: { type: 'json_object' },
          temperature: 0.8,
        });
        const r = JSON.parse(res.choices[0].message.content || '{}');
        return { persona, parou: !!r.parou, problema: r.problema || null, factual_issue: !!r.factual_issue };
      } catch {
        return { persona, parou: false, problema: null, factual_issue: false };
      }
    })
  );

  const stoppedCount    = results.filter(r => r.parou).length;
  const factualIssues   = results.filter(r => r.factual_issue && r.problema);
  const problemMessages = results.filter(r => r.problema).map(r => r.problema);

  if (factualIssues.length > 0) {
    return {
      verdict: 'BLOCK',
      reason: `${factualIssues.length} persona(s) detectaram problema factual: ${factualIssues.map(r => r.problema).join('; ')}`,
      stopped: stoppedCount,
      total: 10,
    };
  }

  if (stoppedCount < 4) {
    return {
      verdict: 'WARN',
      reason: `Apenas ${stoppedCount}/10 personas pararam — engajamento esperado baixo`,
      stopped: stoppedCount,
      total: 10,
    };
  }

  return {
    verdict: 'OK',
    reason: `${stoppedCount}/10 personas aprovaram`,
    stopped: stoppedCount,
    total: 10,
  };
}

// ── Júri de pré-veto (100 personas, 1 rodada, gpt-4o-mini) ───────────────────
// Roda no fundo sobre os vídeos do cofre, ANTES do usuário escolher.
async function askPersona(persona, headline, originalCaption) {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Você é ${persona.name}, ${persona.age} anos. ${persona.desc} Está scrollando Instagram agora.`,
      },
      {
        role: 'user',
        content: `Headline: "${headline}"
Conteúdo original: "${(originalCaption || '').slice(0, 300)}"

Responda em JSON:
{ "parou": boolean, "factual_issue": boolean, "problema": "string curta OU null" }

REGRAS:
- "parou": você pararia o dedo para assistir? (engajamento)
- "factual_issue": TRUE *apenas* se a headline faz afirmação factualmente FALSA, inventada ou claramente enganosa/sensacionalista que distorce o conteúdo original. NÃO marque true só porque achou o conteúdo chato, genérico, comum ou pouco atrativo — isso é "parou": false, não factual_issue.`,
      },
    ],
    max_tokens: 80,
    response_format: { type: 'json_object' },
    temperature: 0.8,
  });
  const r = JSON.parse(res.choices[0].message.content || '{}');
  return { parou: !!r.parou, factual_issue: !!r.factual_issue, problema: r.problema || null };
}

async function runVettingJury(headline, originalCaption) {
  // Concorrência limitada (25 por vez) para não se auto-estrangular no rate limit
  const CONCURRENCY = 25;
  const results = [];
  let errorCount = 0;
  for (let i = 0; i < JURY_PERSONAS.length; i += CONCURRENCY) {
    const batch = JURY_PERSONAS.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map(async (persona) => {
      // 1 retry rápido em caso de erro transitório (ex: 429)
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return await askPersona(persona, headline, originalCaption); }
        catch { if (attempt === 0) await new Promise(r => setTimeout(r, 400)); }
      }
      errorCount++;
      return { parou: false, factual_issue: false, problema: null, _error: true };
    }));
    results.push(...settled);
  }

  // Se muitas personas falharam, o resultado é não-confiável → aborta para re-tentar
  if (errorCount > JURY_PERSONAS.length * 0.3) {
    throw new Error(`júri instável: ${errorCount}/${JURY_PERSONAS.length} falharam (rate limit?)`);
  }

  const valid       = results.filter(r => !r._error);
  const total       = valid.length;
  const stopped     = valid.filter(r => r.parou).length;
  const factual     = valid.filter(r => r.factual_issue);
  const approvalPct = total > 0 ? Math.round((stopped / total) * 100) : 0;
  const factualPct  = total > 0 ? Math.round((factual.length / total) * 100) : 0;
  // só consideramos "problemas" os de quem realmente marcou factual_issue
  const problems    = [...new Set(factual.filter(r => r.problema).map(r => r.problema))].slice(0, 3);

  let verdict, reason;
  if (factualPct >= 30) {
    // reprovação factual exige consenso real (≥30% do júri), não algumas vozes
    verdict = 'REJECTED';
    reason  = `${factualPct}% do júri apontou problema factual/enganoso`;
  } else if (approvalPct >= 55) {
    verdict = 'APPROVED';
    reason  = `${approvalPct}% do júri pararia para assistir`;
  } else if (approvalPct >= 35) {
    verdict = 'WARN';
    reason  = `Júri dividido — ${approvalPct}% pararia`;
  } else {
    verdict = 'REJECTED';
    reason  = `Só ${approvalPct}% pararia — engajamento baixo`;
  }

  return { verdict, reason, approvalPct, factualPct, stopped, total, factualIssues: factual.length, problems };
}

// ── Main search pipeline ──────────────────────────────────────────────────────
async function runSearch({ themes = [], minViews = 50000, minEngagement = 0, lang = 'any' }) {
  // ── A1: busca paralela em Instagram (contas-semente) + TikTok (keywords) ──
  const allAccounts = themes.flatMap(t => SEED_ACCOUNTS[t] || []);
  if (allAccounts.length === 0) Object.values(SEED_ACCOUNTS).forEach(a => allAccounts.push(a[0]));
  const uniqueAccounts = [...new Set(allAccounts)];
  let igAccounts = uniqueAccounts.sort(() => Math.random() - 0.5).slice(0, 7);

  // Descoberta: injeta até 2 contas aprendidas (que já entregaram vídeos quentes)
  const learnedIg = topLearnedAccounts('instagram', igAccounts, 2);
  if (learnedIg.length) {
    console.log(`[A1][descoberta] contas aprendidas: ${learnedIg.map(u => '@' + u).join(', ')}`);
    igAccounts = [...igAccounts, ...learnedIg];
  }

  const allKeywords = themes.flatMap(t => TIKTOK_KEYWORDS[t] || []);
  if (allKeywords.length === 0) Object.values(TIKTOK_KEYWORDS).forEach(k => allKeywords.push(k[0]));
  const ttKeywords = [...new Set(allKeywords)].sort(() => Math.random() - 0.5).slice(0, 6);

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

    // 6. Score preliminar (TikTok penalty already inside calcViralScore)
    const preScore = calcViralScore(post) + (hasEduKw ? 10 : 0);
    console.log(`[A1] ${post.code}: preScore=${preScore}, edu=${hasEduKw}, views=${post.views.toLocaleString()}, eng=${(ratio * 100).toFixed(1)}%`);

    if (preScore < 40) {
      console.log(`[A1][score] ${post.code}: score ${preScore} < 40, descartado`);
      continue;
    }

    // 7. Controversy flag (comments/likes ratio unusually high)
    const controversyRatio = post.likes > 0 ? post.comments / post.likes : 0;
    const controversyFlag  = controversyRatio > 0.15;
    if (controversyFlag)
      console.log(`[A1][controversy] ${post.code}: comments/likes=${controversyRatio.toFixed(2)} — possível conteúdo polêmico`);

    const isTikTok = post.source === 'tiktok';
    const postUrl  = isTikTok
      ? `https://www.tiktok.com/@${post.username}/video/${post.code}`
      : `https://www.instagram.com/reel/${post.code}/`;

    // 8. Dedup check
    const alreadyUsed = usedVideoUrls.has(postUrl);

    candidates.push({
      url:               postUrl,
      videoUrl:          post.videoUrl,
      thumbnail:         null,
      likes:             post.likes,
      views:             post.views,
      comments:          post.comments,
      preScore,
      originalCaption:   post.caption
        ? `Caption original: "${post.caption.slice(0, 400)}" — @${post.username}, ${post.views.toLocaleString()} views, ${post.likes.toLocaleString()} likes`
        : `Reel de @${post.username} — ${post.views.toLocaleString()} views, ${post.likes.toLocaleString()} likes`,
      sourceUsername:    post.username,
      source:            isTikTok ? 'tiktok' : 'instagram',
      controversy_flag:  controversyFlag,
      controversy_ratio: controversyRatio,
      already_used:      alreadyUsed,
      takenAt:           post.takenAt || 0,
      velocity:          velocityOf(post),
      age_hours:         ageHoursOf(post.takenAt),
    });
  }

  // Ordena por score, desduplicar por URL, limita a 30 (sem GPT nesta fase)
  candidates.sort((a, b) => b.preScore - a.preScore);
  const deduped = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 30);
  console.log(`[A1] ${deduped.length} candidatos após pré-filtro (sem GPT)`);

  if (deduped.length === 0) return [];

  // Diversificação leve: máx 6 por conta (sem GPT não temos category ainda)
  const byAcc = {};
  const final = [];

  for (const c of deduped) {
    const acc = c.sourceUsername || '';
    if ((byAcc[acc] || 0) >= 6) continue;
    byAcc[acc] = (byAcc[acc] || 0) + 1;

    // Derive a rough content_category from the theme that was searched
    // (best effort — GPT will refine this in the approve step)
    const capLower = (c.originalCaption || '').toLowerCase();
    let content_category = 'outro';
    if (/tecnolog|tech|gadget|inovação|innovation/.test(capLower)) content_category = 'tecnologia';
    else if (/ciência|science|descoberta|discovery|scientist/.test(capLower)) content_category = 'ciência';
    else if (/história|history|historical|fato histórico/.test(capLower)) content_category = 'história';
    else if (/espaço|space|nasa|universe|cosmos/.test(capLower)) content_category = 'espaço';
    else if (/china|chinês|chinese/.test(capLower)) content_category = 'china';
    else if (/engenharia|engineering|construção|construction/.test(capLower)) content_category = 'engenharia';
    else if (/curiosidade|did you know|você sabia|amazing|incrível/.test(capLower)) content_category = 'curiosidades';
    else if (/invenção|invention|invented|inventor/.test(capLower)) content_category = 'invencoes';

    const ageDays = c.age_hours !== null && c.age_hours !== undefined
      ? Math.round(c.age_hours / 24 * 10) / 10
      : null;

    final.push({
      index:           final.length,
      url:             c.url,
      videoUrl:        c.videoUrl,
      thumbnail:       c.thumbnail,
      likes:           c.likes,
      views:           c.views,
      comments:        c.comments,
      originalCaption: c.originalCaption,
      viral_score:     c.preScore,
      velocity:        c.velocity ?? null,
      age_days:        ageDays,
      content_category,
      source:          c.source          || 'instagram',
      sourceUsername:  c.sourceUsername  || '',
      controversy_flag:c.controversy_flag || false,
      already_used:    c.already_used    || false,
    });

    // Aprendizado: registra a performance desta conta para buscas futuras
    recordAccountPerformance(c.sourceUsername, c.preScore, c.source || 'instagram');

    if (final.length >= 30) break;
  }

  console.log(`[pipeline] ${final.length} resultados finais (sem GPT) — ${accountScores.size} contas no mapa de aprendizado`);
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

const ALL_THEMES = ['ciencia', 'tecnologia', 'historia', 'espaco', 'china', 'engenharia', 'curiosidades', 'invencoes'];
const VAULT_KEY      = 'vault:feed';
const VAULT_META_KEY = 'vault:meta';
const VAULT_MAX      = 60;                 // máximo de itens guardados no cofre
const VAULT_TTL_MS   = 7 * 24 * 3600 * 1000; // descarta itens minerados há mais de 7 dias

// GET /api/content-finder/feed — frontend lê o cofre pré-minerado
router.get('/feed', async (req, res) => {
  if (!vault.enabled()) {
    return res.json({ results: [], meta: null, enabled: false });
  }
  try {
    const feed = (await vault.getJSON(VAULT_KEY)) || [];
    const meta = await vault.getJSON(VAULT_META_KEY);
    // remove já-usados e reprovados pelo júri; mantém aprovados/avisos/pendentes
    const results = feed
      .filter(x => !usedVideoUrls.has(x.url))
      .filter(x => x.vetVerdict !== 'REJECTED')
      .map(x => ({ ...x, already_used: usedVideoUrls.has(x.url) }))
      .slice(0, 30);
    res.json({ results, meta, enabled: true });
  } catch (e) {
    console.error('[feed] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/content-finder/mine — minerador autônomo (chamado pelo Vercel Cron)
// Protegido por CRON_SECRET se configurado. Minera temas rotativos e enche o cofre.
router.get('/mine', async (req, res) => {
  // Autenticação: Vercel Cron envia "Authorization: Bearer <CRON_SECRET>"
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'não autorizado' });
    }
  }
  if (!vault.enabled()) {
    return res.status(503).json({ error: 'Cofre (Upstash) não configurado — defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN' });
  }
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada' });
  }

  try {
    // Temas rotativos: a cada janela de 6h, minera 3 temas diferentes,
    // cobrindo todos os 8 ao longo do dia.
    const bucket = Math.floor(Date.now() / (6 * 3600 * 1000));
    const start  = (bucket * 3) % ALL_THEMES.length;
    const themes = [0, 1, 2].map(i => ALL_THEMES[(start + i) % ALL_THEMES.length]);
    console.log(`[mine] ciclo bucket=${bucket}, temas: ${themes.join(', ')}`);

    const mined = await runSearch({ themes, minViews: 50000, minEngagement: 0, lang: 'any' });

    // Mescla com o cofre existente, dedup por URL, mantém o dado mais fresco
    const existing = (await vault.getJSON(VAULT_KEY)) || [];
    const map = new Map(existing.map(x => [x.url, x]));
    const now = Date.now();
    for (const r of mined) {
      map.set(r.url, { ...r, minedAt: now, themes });
    }

    let merged = [...map.values()]
      .filter(x => (x.minedAt || 0) > now - VAULT_TTL_MS)   // expira itens velhos
      .filter(x => !usedVideoUrls.has(x.url))                // remove já usados
      .sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0))
      .slice(0, VAULT_MAX);

    await vault.setJSON(VAULT_KEY, merged);
    await vault.setJSON(VAULT_META_KEY, {
      updatedAt: now,
      lastThemes: themes,
      minedThisRun: mined.length,
      vaultSize: merged.length,
    });

    console.log(`[mine] +${mined.length} minerados, cofre agora com ${merged.length} vídeos`);
    res.json({ ok: true, themes, minedThisRun: mined.length, vaultSize: merged.length });
  } catch (e) {
    console.error('[mine] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const VET_BATCH = 2; // vídeos vetados por execução (cabe nos 60s do Vercel)

// GET /api/content-finder/vet — pré-veto autônomo: 100 personas analisam os
// melhores vídeos ainda não vetados do cofre. Chamado por cron a cada ~15min.
router.get('/vet', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'não autorizado' });
    }
  }
  if (!vault.enabled()) {
    return res.status(503).json({ error: 'Cofre (Upstash) não configurado' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
  }

  try {
    const feed = (await vault.getJSON(VAULT_KEY)) || [];
    // Pendentes: ainda não vetados, melhores (viral_score) primeiro
    const pending = feed
      .map((item, idx) => ({ item, idx }))
      .filter(x => !x.item.vetted)
      .sort((a, b) => (b.item.viral_score || 0) - (a.item.viral_score || 0))
      .slice(0, VET_BATCH);

    if (pending.length === 0) {
      return res.json({ ok: true, vetted: 0, message: 'Nada pendente — cofre todo vetado' });
    }

    const startMs = Date.now();
    let done = 0;
    for (const { item, idx } of pending) {
      if (Date.now() - startMs > 45000) break; // guarda de tempo (limite Vercel 60s)
      try {
        // 1. Gera headline/legenda + análise (se ainda não houver)
        let headline = item.headline;
        let caption  = item.caption;
        let analysis = null;
        if (!headline) {
          analysis = await analyzeAndGenerate({
            url:             item.url,
            views:           item.views,
            likes:           item.likes,
            comments:        item.comments,
            originalCaption: item.originalCaption,
            sourceUsername:  item.sourceUsername,
            source:          item.source,
            controversy_flag: item.controversy_flag,
          });
          headline = analysis.headline || 'Reel incrível';
          caption  = analysis.caption || '';
        }

        // 2. Júri de 100 personas
        const jury = await runVettingJury(headline, item.originalCaption || '');

        // 3. Grava o veredito de volta no item
        feed[idx] = {
          ...item,
          headline,
          caption,
          quality_tier:    analysis?.quality_tier || item.quality_tier || null,
          vetVerdict:      jury.verdict,
          juryApprovalPct: jury.approvalPct,
          juryReason:      jury.reason,
          juryProblems:    jury.problems,
          vetted:          true,
          vettedAt:        Date.now(),
        };
        done++;
        console.log(`[vet] ${item.url}: ${jury.verdict} (${jury.approvalPct}%)`);
      } catch (e) {
        const attempts = (item.vetAttempts || 0) + 1;
        feed[idx] = { ...item, vetAttempts: attempts, vetted: attempts >= 3 };
        console.warn(`[vet] falha (${attempts}/3) em ${item.url}: ${e.message}`);
      }
    }

    await vault.setJSON(VAULT_KEY, feed);
    const totalVetted = feed.filter(x => x.vetted).length;
    const prevMeta = (await vault.getJSON(VAULT_META_KEY)) || {};
    await vault.setJSON(VAULT_META_KEY, { ...prevMeta, vettedCount: totalVetted, lastVetAt: Date.now() });

    res.json({ ok: true, vetted: done, totalVetted, vaultSize: feed.length });
  } catch (e) {
    console.error('[vet] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content-finder/preview-video — proxy video stream (bypass CORS)
router.post('/preview-video', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl é obrigatório' });

  try {
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.instagram.com/',
      },
    });
    const contentType = response.headers['content-type'] || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    response.data.pipe(res);
    response.data.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  } catch (e) {
    console.error('[preview-video] error:', e.message);
    if (!res.headersSent) res.status(502).json({ error: 'Não foi possível carregar o vídeo' });
  }
});

// POST /api/content-finder/approve — Agent 4: edits video, streams MP4 directly
// Accepts multipart/form-data: fields (videoUrl, postUrl, headline, caption, originalCaption) + file (template)
router.post('/approve', upload.single('template'), async (req, res) => {
  let { videoUrl: directUrl, postUrl, headline, caption, originalCaption } = req.body;
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
    // ── If no headline provided, run GPT analysis first ──────────────────────
    if (!headline?.trim()) {
      console.log('[approve] Sem headline — rodando analyzeAndGenerate…');
      const candidate = {
        url:             postUrl || directUrl || '',
        videoUrl:        directUrl || null,
        views:           Number(req.body.views)    || 0,
        likes:           Number(req.body.likes)    || 0,
        comments:        Number(req.body.comments) || 0,
        originalCaption: originalCaption || '',
        sourceUsername:  req.body.sourceUsername  || '',
        source:          req.body.source          || 'instagram',
        controversy_flag: false,
        controversy_ratio: 0,
      };
      try {
        const analysis = await analyzeAndGenerate(candidate);
        headline = analysis.headline || 'Reel incrível';
        if (!caption?.trim()) caption = analysis.caption || '';
        console.log(`[approve] headline gerada: "${headline}"`);
      } catch (e) {
        console.warn('[approve] analyzeAndGenerate falhou:', e.message);
        headline = 'Descubra isso agora';
      }
    }

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

    // Run video download + overlay build + mini-jury in parallel
    const [[{ hasAudio, duration }], juryResult] = await Promise.all([
      Promise.all([
        downloadVideo().then(() => getVideoInfo(rawVideo)),
        templateBuf
          ? buildReelFrame(templateBuf, headline.trim(), framePng)
          : buildHeadlineOverlay(headline.trim(), framePng),
      ]),
      runMiniJury(headline.trim(), originalCaption || ''),
    ]);

    // Mini-jury gating
    if (juryResult.verdict === 'BLOCK') {
      cleanTmp();
      console.log(`[miniJury] BLOCK: ${juryResult.reason}`);
      return res.json({ blocked: true, reason: juryResult.reason, juryResult });
    }
    if (juryResult.verdict === 'WARN') {
      console.log(`[miniJury] WARN: ${juryResult.reason}`);
    }

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
    res.setHeader('X-Headline',          encodeURIComponent(headline || ''));
    res.setHeader('X-Caption',           encodeURIComponent(caption  || ''));
    res.setHeader('X-Mini-Jury-Verdict', juryResult.verdict);
    res.setHeader('X-Mini-Jury-Stopped', `${juryResult.stopped}/${juryResult.total}`);
    if (juryResult.verdict === 'WARN') {
      res.setHeader('X-Mini-Jury-Reason', encodeURIComponent(juryResult.reason));
    }

    // Mark this URL as used (dedup for future searches in this session)
    const videoKey = postUrl || directUrl || '';
    if (videoKey) usedVideoUrls.add(videoKey);

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
