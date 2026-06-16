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

function calcViralScore(post) {
  let score = 0;
  const views    = post.views    || 0;
  const likes    = post.likes    || 0;
  const comments = post.comments || 0;
  const duration = post.duration || 0;

  if (views > 1000000)     score += 40;
  else if (views > 500000) score += 30;
  else if (views > 100000) score += 20;
  else if (views > 50000)  score += 10;

  const ratio = views > 0 ? likes / views : 0;
  if (ratio > 0.05)      score += 20;
  else if (ratio > 0.03) score += 15;
  else if (ratio > 0.01) score += 10;

  if (comments > 1000)     score += 20;
  else if (comments > 500) score += 15;
  else if (comments > 100) score += 10;

  if (duration >= 15 && duration <= 60) score += 20;
  else if (duration > 0 && duration <= 90) score += 10;

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
- approved = true SE: viral_score >= 55 E ban_risk != "alto" E fit_for_profile >= 50 E factual_confidence >= 40 E misleading_caption = false E headline_matches_source = true
- Para fonte TikTok: exigir factual_confidence >= 60
- quality_tier: A (viral_score>80 sem warnings), B (>65), C (>50), D (abaixo)
- NÃO aprovar: político, violento, sexual, músicas famosas (copyright), humor genérico, vlogs
- Headlines style: "O que ninguém te contou sobre…", "A China fez isso e o mundo ignorou"`,
      },
      {
        role: 'user',
        content: `Fonte: ${isTikTok ? 'TikTok (escrutínio extra — exige factual_confidence>=60)' : 'Instagram'}
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
    });
  }

  // Ordena por score, desduplicar por URL, limita a 10 para o GPT
  candidates.sort((a, b) => b.preScore - a.preScore);
  const deduped = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 10);
  console.log(`[A1] ${deduped.length} candidatos após pré-filtro → Agente 2`);

  if (deduped.length === 0) return [];

  // ── A2+A3: análise + fact-check + copy unificados (1 call por candidato) ──
  const analyses = await Promise.allSettled(deduped.map(c => analyzeAndGenerate(c)));
  const analyzed = deduped.map((c, i) => ({
    ...c,
    ...(analyses[i].status === 'fulfilled' ? analyses[i].value : { approved: false }),
  }));
  const approved = analyzed.filter(a => a.approved === true && a.headline);
  console.log(`[A2] ${approved.length}/${analyzed.length} aprovados`);

  if (approved.length === 0) return [];

  // ── Diversificação: máx 3 por nicho, máx 2 por conta ─────────────────────
  const byCat = {};
  const byAcc = {};
  const final = [];

  for (const r of approved) {
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
      index:                  final.length,
      url:                    r.url,
      videoUrl:               r.videoUrl,
      thumbnail:              r.thumbnail,
      likes:                  r.likes,
      views:                  r.views,
      originalCaption:        r.originalCaption,
      viral_score:            r.viral_score            || 0,
      viral_reasons:          r.viral_reasons          || [],
      ban_risk:               r.ban_risk               || 'baixo',
      ban_reasons:            r.ban_reasons            || [],
      copyright_risk:         r.copyright_risk         || 'baixo',
      copyright_reasons:      r.copyright_reasons      || [],
      content_category:       r.content_category       || 'outro',
      fit_for_profile:        r.fit_for_profile        || 0,
      factual_confidence:     r.factual_confidence     ?? 50,
      factual_flags:          r.factual_flags          || [],
      misleading_caption:     r.misleading_caption     || false,
      headline_clickbait_risk:r.headline_clickbait_risk || 'baixo',
      quality_tier:           r.quality_tier           || 'C',
      warnings:               r.warnings               || [],
      headline:               r.headline,
      caption:                r.caption,
      source:                 r.source                 || 'instagram',
      controversy_flag:       r.controversy_flag       || false,
      already_used:           r.already_used           || false,
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
// Accepts multipart/form-data: fields (videoUrl, postUrl, headline, caption, originalCaption) + file (template)
router.post('/approve', upload.single('template'), async (req, res) => {
  const { videoUrl: directUrl, postUrl, headline, caption, originalCaption } = req.body;
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
