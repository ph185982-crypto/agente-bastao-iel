const express = require('express');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(require('ffprobe-static').path);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

// ── Layout constants ──────────────────────────────────────────────────────────
const W         = 1080;
const H         = 1920;
const FONT_SIZE = 48;
const LINE_H    = 66;
const H_PAD     = 48;

const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf');
let FONT_B64 = '';
try { FONT_B64 = fs.readFileSync(FONT_PATH).toString('base64'); } catch {}

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

async function buildHeadlineOverlay(headline, overlayPath) {
  const lines = wrapText(headline, 28);
  const barH = Math.max(140, 36 + lines.length * LINE_H + 24);

  const fontFaceDecl = FONT_B64
    ? `<defs><style>@font-face{font-family:'H';src:url('data:font/truetype;base64,${FONT_B64}')}</style></defs>`
    : '';
  const fontFamily = FONT_B64 ? 'H' : 'sans-serif';

  const textEls = lines.map((line, i) =>
    `<text x="${H_PAD}" y="${36 + (i + 1) * LINE_H}" font-family="${fontFamily}" font-size="${FONT_SIZE}" font-weight="bold" fill="white" stroke="black" stroke-width="1">${escXml(line)}</text>`
  ).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${barH}">
    ${fontFaceDecl}
    <rect width="${W}" height="${barH}" fill="black" fill-opacity="0.72"/>
    ${textEls}
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(overlayPath);
  return { barH };
}

// ── Agent 1 — Buscador ────────────────────────────────────────────────────────
async function searchUserReels(username) {
  const user = username.replace(/^@/, '').trim();
  console.log(`[contentFinder] Buscando reels de @${user}…`);

  const { data } = await axios.post(
    'https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_reels.php',
    new URLSearchParams({ username_or_url: user, amount: '12' }).toString(),
    {
      headers: {
        'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY_STABLE,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    }
  );

  const reels = data?.reels || [];

  return reels
    .map(r => {
      const m = r?.node?.media || r?.node || {};
      const code  = m.code || '';
      const likes = m.like_count  || 0;
      const views = m.play_count  || m.view_count || 0;
      return { code, likes, views, username: user };
    })
    .filter(r => r.code && (r.views >= 50000 || r.likes >= 5000))
    .slice(0, 5)
    .map(r => ({
      url:             `https://www.instagram.com/reel/${r.code}/`,
      videoUrl:        null,
      thumbnail:       null,
      likes:           r.likes,
      views:           r.views,
      originalCaption: `Reel do perfil @${r.username} — ${r.views.toLocaleString()} views, ${r.likes.toLocaleString()} likes`,
      sourceUsername:  r.username,
    }));
}

// ── Agent 2 — Analisador ──────────────────────────────────────────────────────
async function analyzeContent(candidate) {
  const res = await openai.chat.completions.create({
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
  "content_category": "tecnologia" | "curiosidade" | "história" | "ciência" | "negócios" | "outro",
  "fit_for_profile": número de 0 a 100
}

Perfil do criador (@pedro_destrava):
- Nicho: curiosidades de tecnologia, ciência, história e inovação
- Tom: informativo, surpreendente, "o que ninguém te contou"
- Audiência: 175k seguidores brasileiros, adultos
- Conteúdos que mais viralizam: tecnologia retrô vs atual, inovações chinesas, curiosidades históricas, ciência aplicada
- NÃO aprovar: conteúdo político, violento, sexual, músicas famosas (alto risco copyright), humor genérico
- APROVAR se viral_score >= 55 E ban_risk != "alto" E fit_for_profile >= 50
- Perfis de mídia/ciência/tecnologia têm conteúdo geralmente seguro — assuma baixo risco se não há indicação contrária`,
      },
      {
        role: 'user',
        content: `Perfil de origem: @${candidate.sourceUsername || 'desconhecido'}
Views: ${(candidate.views || 0).toLocaleString('pt-BR')}
Likes: ${(candidate.likes || 0).toLocaleString('pt-BR')}
Contexto: ${candidate.originalCaption || '(sem caption)'}

Com base no perfil de origem e métricas, avalie o potencial viral e adequação para @pedro_destrava.`,
      },
    ],
    max_tokens: 400,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(res.choices[0].message.content || '{}');
}

// ── Agent 3 — Criador de Copy ─────────────────────────────────────────────────
async function generateCopy(candidate, analysis) {
  const res = await openai.chat.completions.create({
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

// ── Main search pipeline (synchronous, parallel) ──────────────────────────────
async function runSearch(usernames) {
  // Agent 1: search all accounts in parallel
  const searchResults = await Promise.allSettled(usernames.map(u => searchUserReels(u)));

  const candidates = [];
  for (const r of searchResults) {
    if (r.status === 'fulfilled') candidates.push(...r.value);
    else console.warn('[contentFinder] hashtag search failed:', r.reason?.message);
  }

  if (candidates.length === 0) return [];

  // Deduplicate by URL, cap at 10
  const unique = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 10);
  console.log(`[contentFinder] ${unique.length} candidatos únicos para analisar`);

  // Agent 2: analyze all in parallel
  const analyses = await Promise.allSettled(unique.map(c => analyzeContent(c)));
  const analyzed = unique.map((c, i) => ({
    ...c,
    ...(analyses[i].status === 'fulfilled' ? analyses[i].value : { approved: false }),
  }));

  const approved = analyzed.filter(a => a.approved === true);
  console.log(`[contentFinder] ${approved.length}/${analyzed.length} aprovados pelo Agente 2`);

  if (approved.length === 0) return [];

  // Agent 3: generate copy for all approved in parallel
  const copies = await Promise.allSettled(approved.map(c => generateCopy(c, c)));

  const results = [];
  for (let i = 0; i < approved.length; i++) {
    const item = approved[i];
    if (copies[i].status !== 'fulfilled') continue;
    const copy = copies[i].value;
    if (!copy.headline) continue;

    results.push({
      index:            results.length,
      url:              item.url,
      videoUrl:         item.videoUrl,
      thumbnail:        item.thumbnail,
      likes:            item.likes,
      views:            item.views,
      originalCaption:  item.originalCaption,
      viral_score:      item.viral_score      || 0,
      viral_reasons:    item.viral_reasons    || [],
      ban_risk:         item.ban_risk         || 'baixo',
      ban_reasons:      item.ban_reasons      || [],
      copyright_risk:   item.copyright_risk   || 'baixo',
      copyright_reasons: item.copyright_reasons || [],
      content_category: item.content_category || 'outro',
      fit_for_profile:  item.fit_for_profile  || 0,
      headline:         copy.headline,
      caption:          copy.caption,
    });
  }

  return results;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/content-finder/search — runs full pipeline synchronously, returns JSON
router.post('/search', async (req, res) => {
  const { usernames, hashtags } = req.body;
  const targets = usernames || hashtags; // backward-compat
  if (!Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: 'Envie pelo menos um perfil (@usuario)' });
  }
  if (!process.env.RAPIDAPI_KEY_STABLE) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY_STABLE não configurada no servidor' });
  }

  try {
    const results = await runSearch(targets);
    res.json({ results });
  } catch (e) {
    console.error('[contentFinder] search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content-finder/approve — Agent 4: edits video, streams MP4 directly
router.post('/approve', async (req, res) => {
  const { videoUrl: directUrl, postUrl, headline, caption } = req.body;
  if (!headline?.trim()) return res.status(400).json({ error: 'headline é obrigatória' });
  if (!directUrl && !postUrl) return res.status(400).json({ error: 'videoUrl ou postUrl é obrigatório' });

  if (!process.env.RAPIDAPI_KEY && !directUrl) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  }

  const sid        = crypto.randomUUID();
  const rawVideo   = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const overlayPng = path.join(os.tmpdir(), `${sid}_overlay.png`);
  const output     = path.join(os.tmpdir(), `${sid}_final.mp4`);

  const cleanTmp = () => [rawVideo, overlayPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  try {
    let videoUrl = directUrl;
    if (!videoUrl) videoUrl = await resolveInstagramUrl(postUrl);

    await streamDownload(videoUrl, rawVideo);

    const [, { hasAudio, duration }] = await Promise.all([
      buildHeadlineOverlay(headline.trim(), overlayPng),
      getVideoInfo(rawVideo),
    ]);

    const clipDur = Math.min(duration, 20).toFixed(3);

    const filterGraph = [
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[scaled]`,
      `[1:v]loop=loop=-1:size=1:start=0[bar]`,
      `[scaled][bar]overlay=0:0:eof_action=endall[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]', '-c:v libx264', '-preset ultrafast', '-crf 28',
      '-r 30', `-t ${clipDur}`, '-pix_fmt yuv420p',
    ];
    if (hasAudio) outputOpts.push('-map 0:a', '-c:a aac', '-b:a 128k');
    else outputOpts.push('-an');

    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(overlayPng)
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
