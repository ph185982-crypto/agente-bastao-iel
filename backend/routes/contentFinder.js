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

// ── Job store ─────────────────────────────────────────────────────────────────
const jobs = new Map();

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      for (const r of (job.results || [])) {
        if (r.editOutputPath && fs.existsSync(r.editOutputPath)) {
          try { fs.unlinkSync(r.editOutputPath); } catch {}
        }
      }
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

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

// Resolve Instagram reel URL → direct CDN video URL
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

// Build semi-transparent headline bar PNG (barHeight × W)
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
async function searchHashtag(hashtag) {
  const tag = hashtag.replace(/^#/, '').trim();
  console.log(`[contentFinder] Buscando #${tag}…`);

  const { data } = await axios.get(
    'https://instagram-scraper-api2.p.rapidapi.com/v1/hashtag',
    {
      params: { hashtag: tag },
      headers: {
        'x-rapidapi-host': 'instagram-scraper-api2.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      },
      timeout: 15000,
    }
  );

  const items = data?.data?.items || data?.items || [];

  return items
    .filter(item => {
      const isVideo = item.media_type === 2 || item.is_video === true;
      const likes   = item.like_count   || 0;
      const views   = item.play_count   || item.view_count || 0;
      return isVideo && (views >= 50000 || likes >= 5000);
    })
    .slice(0, 5)
    .map(item => {
      const code = item.code || item.shortcode || '';
      const thumb =
        item.thumbnail_url ||
        item.display_url   ||
        item.image_versions2?.candidates?.[0]?.url ||
        item.image_versions?.items?.[0]?.url ||
        null;
      return {
        url:             `https://www.instagram.com/reel/${code}/`,
        videoUrl:        item.video_url || null,
        thumbnail:       thumb,
        likes:           item.like_count  || 0,
        views:           item.play_count  || item.view_count || 0,
        originalCaption: item.caption?.text || '',
      };
    })
    .filter(item => item.url && item.url !== 'https://www.instagram.com/reel//');
}

// ── Agent 2 — Analisador ──────────────────────────────────────────────────────
async function analyzeContent(candidate) {
  const userContent = [];

  if (candidate.thumbnail) {
    userContent.push({
      type: 'image_url',
      image_url: { url: candidate.thumbnail, detail: 'low' },
    });
  }

  userContent.push({
    type: 'text',
    text: `Caption original: ${candidate.originalCaption || '(sem caption)'}
Likes: ${candidate.likes.toLocaleString('pt-BR')}
Views: ${candidate.views.toLocaleString('pt-BR')}

Analise este conteúdo para o perfil @pedro_destrava.`,
  });

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é um especialista em conteúdo viral do Instagram. Analise este conteúdo e retorne um JSON com:
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

Perfil do criador:
- Nicho: curiosidades de tecnologia, ciência, história e inovação
- Tom: informativo, surpreendente, "o que ninguém te contou"
- Audiência: 175k seguidores brasileiros, adultos
- Conteúdos que mais viralizam: tecnologia retrô vs atual, inovações chinesas, curiosidades históricas, ciência aplicada
- NÃO aprovar: conteúdo político, violento, sexual, músicas famosas (alto risco copyright), humor genérico
- APROVAR apenas se viral_score >= 60 E ban_risk != "alto" E copyright_risk != "alto" E fit_for_profile >= 60`,
      },
      { role: 'user', content: userContent },
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

// ── Agent 4 — Editor de Vídeo ─────────────────────────────────────────────────
async function editVideo(jobId, index) {
  const job = jobs.get(jobId);
  if (!job || !job.results[index]) return;

  const result  = job.results[index];
  const sid     = `${jobId}_${index}`;
  const rawVideo   = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const overlayPng = path.join(os.tmpdir(), `${sid}_overlay.png`);
  const output     = path.join(os.tmpdir(), `${sid}_final.mp4`);

  const cleanTmp = () => [rawVideo, overlayPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  result.editStatus   = 'processing';
  result.editProgress = 0;
  result.editError    = null;

  try {
    // Resolve video URL if we only have the post URL
    console.log(`[contentFinder] Agent 4 — resolvendo vídeo para slot ${index}`);
    let videoUrl = result.videoUrl;
    if (!videoUrl) {
      result.editProgress = 3;
      videoUrl = await resolveInstagramUrl(result.url);
    }

    // Download
    result.editProgress = 8;
    console.log(`[contentFinder] Baixando vídeo ${sid}`);
    await streamDownload(videoUrl, rawVideo);
    result.editProgress = 30;

    // Build overlay + probe in parallel
    const [{ barH }, { hasAudio, duration }] = await Promise.all([
      buildHeadlineOverlay(result.headline, overlayPng),
      getVideoInfo(rawVideo),
    ]);
    result.editProgress = 45;

    const clipDur    = Math.min(duration, 90).toFixed(3);
    const clipDurSec = parseFloat(clipDur);

    // Scale+letterbox video to 1080×1920, overlay headline bar at top
    const filterGraph = [
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[scaled]`,
      `[1:v]loop=loop=-1:size=1:start=0[bar]`,
      `[scaled][bar]overlay=0:0:eof_action=endall[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]',
      '-c:v libx264', '-preset ultrafast', '-crf 28',
      '-r 30', `-t ${clipDur}`, '-pix_fmt yuv420p',
    ];
    if (hasAudio) outputOpts.push('-map 0:a', '-c:a aac', '-b:a 128k');
    else outputOpts.push('-an');

    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(overlayPng)
      .complexFilter(filterGraph)
      .outputOptions(outputOpts)
      .on('progress', info => {
        try {
          const parts = (info.timemark || '').split(':');
          if (parts.length < 3) return;
          const elapsed = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
          result.editProgress = Math.round(45 + Math.min(elapsed / clipDurSec, 1) * 50);
        } catch {}
      });

    await runFFmpeg(cmd, output);

    cleanTmp();
    result.editStatus     = 'done';
    result.editProgress   = 100;
    result.editOutputPath = output;
    console.log(`[contentFinder] Agent 4 concluído — slot ${index}`);
  } catch (err) {
    cleanTmp();
    result.editStatus = 'error';
    result.editError  = err.message;
    console.error(`[contentFinder] Agent 4 erro slot ${index}:`, err.message);
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function runPipeline(jobId, hashtags) {
  const job = jobs.get(jobId);
  if (!job) return;

  const step = (progress, msg) => {
    job.progress    = progress;
    job.currentStep = msg;
    console.log(`[contentFinder][${jobId.slice(0,8)}] ${msg}`);
  };

  try {
    // ── Agent 1: busca ────────────────────────────────────────────────────────
    step(5, '🔍 Agente 1: Buscando vídeos virais…');

    const candidates = [];
    const tried = new Set();

    for (const tag of hashtags) {
      if (candidates.length >= 15 || tried.has(tag)) continue;
      tried.add(tag);
      try {
        const found = await searchHashtag(tag);
        candidates.push(...found);
        console.log(`[contentFinder] #${tag}: ${found.length} candidatos encontrados`);
      } catch (e) {
        console.warn(`[contentFinder] #${tag} falhou:`, e.message);
      }
    }

    // Retry remaining hashtags if not enough results
    if (candidates.length < 3) {
      for (const tag of hashtags) {
        if (candidates.length >= 10 || tried.has(tag)) continue;
        tried.add(tag);
        try { const found = await searchHashtag(tag); candidates.push(...found); } catch {}
      }
    }

    if (candidates.length === 0) {
      job.status      = 'done';
      job.results     = [];
      job.progress    = 100;
      job.currentStep = '✅ Nenhum vídeo encontrado com os filtros aplicados.';
      return;
    }

    // Deduplicate by URL, cap at 10
    const unique = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 10);
    step(20, `🧠 Agente 2: Analisando ${unique.length} vídeos…`);

    // ── Agent 2: análise ──────────────────────────────────────────────────────
    const analyzed = [];
    for (let i = 0; i < unique.length; i++) {
      try {
        const analysis = await analyzeContent(unique[i]);
        analyzed.push({ ...unique[i], ...analysis });
        step(
          Math.round(20 + ((i + 1) / unique.length) * 30),
          `🧠 Agente 2: Analisando vídeo ${i + 1}/${unique.length}…`
        );
      } catch (e) {
        console.warn(`[contentFinder] Análise ${i} falhou:`, e.message);
      }
    }

    const approved = analyzed.filter(a => a.approved === true);
    console.log(`[contentFinder] ${approved.length}/${analyzed.length} aprovados pelo Agente 2`);

    if (approved.length === 0) {
      job.status      = 'done';
      job.results     = [];
      job.progress    = 100;
      job.currentStep = '✅ Nenhum vídeo passou na análise de qualidade.';
      return;
    }

    step(55, `✍️ Agente 3: Gerando copy para ${approved.length} vídeo(s)…`);

    // ── Agent 3: copy ─────────────────────────────────────────────────────────
    const results = [];
    for (let i = 0; i < approved.length; i++) {
      const item = approved[i];
      try {
        const copy = await generateCopy(item, item);
        results.push({
          index:           i,
          url:             item.url,
          videoUrl:        item.videoUrl,
          thumbnail:       item.thumbnail,
          likes:           item.likes,
          views:           item.views,
          originalCaption: item.originalCaption,
          viral_score:     item.viral_score     || 0,
          viral_reasons:   item.viral_reasons   || [],
          ban_risk:        item.ban_risk         || 'baixo',
          ban_reasons:     item.ban_reasons      || [],
          copyright_risk:  item.copyright_risk   || 'baixo',
          copyright_reasons: item.copyright_reasons || [],
          content_category: item.content_category || 'outro',
          fit_for_profile: item.fit_for_profile  || 0,
          headline:        copy.headline,
          caption:         copy.caption,
          editStatus:      'idle',
          editProgress:    0,
          editOutputPath:  null,
          editError:       null,
        });
        step(
          Math.round(55 + ((i + 1) / approved.length) * 35),
          `✍️ Agente 3: Copy ${i + 1}/${approved.length} gerada…`
        );
      } catch (e) {
        console.warn(`[contentFinder] Copy ${i} falhou:`, e.message);
      }
    }

    job.results     = results;
    job.status      = 'done';
    job.progress    = 100;
    job.currentStep = `✅ Concluído! ${results.length} vídeo(s) pronto(s) para edição.`;
  } catch (err) {
    job.status      = 'error';
    job.error       = err.message;
    job.currentStep = `Erro: ${err.message}`;
    console.error(`[contentFinder] Pipeline erro:`, err.message);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/content-finder/search
router.post('/search', async (req, res) => {
  const { hashtags } = req.body;
  if (!Array.isArray(hashtags) || hashtags.length === 0) {
    return res.status(400).json({ error: 'Envie pelo menos uma hashtag' });
  }
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  }

  const jobId = crypto.randomUUID();
  jobs.set(jobId, {
    status:      'processing',
    progress:    0,
    currentStep: 'Iniciando pipeline…',
    results:     [],
    createdAt:   Date.now(),
  });

  runPipeline(jobId, hashtags).catch(err =>
    console.error('[contentFinder] unhandled pipeline error:', err.message)
  );

  res.status(202).json({ jobId, status: 'processing' });
});

// GET /api/content-finder/status/:jobId
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json({
    status:      job.status,
    progress:    job.progress,
    currentStep: job.currentStep,
    results:     job.results,
    error:       job.error,
  });
});

// POST /api/content-finder/approve/:jobId/:index  — dispara Agent 4
router.post('/approve/:jobId/:index', (req, res) => {
  const { jobId } = req.params;
  const index = parseInt(req.params.index, 10);

  const job = jobs.get(jobId);
  if (!job)               return res.status(404).json({ error: 'Job não encontrado' });
  if (!job.results[index]) return res.status(404).json({ error: 'Resultado não encontrado' });

  const result = job.results[index];
  if (result.editStatus === 'processing') {
    return res.status(409).json({ error: 'Vídeo já está sendo processado' });
  }

  // Apply user edits before editing
  if (req.body?.headline) result.headline = String(req.body.headline).trim();
  if (req.body?.caption)  result.caption  = String(req.body.caption).trim();

  editVideo(jobId, index).catch(err =>
    console.error('[contentFinder] editVideo unhandled:', err.message)
  );

  res.json({ status: 'processing' });
});

// GET /api/content-finder/download/:jobId/:index
router.get('/download/:jobId/:index', (req, res) => {
  const { jobId } = req.params;
  const index = parseInt(req.params.index, 10);

  const job = jobs.get(jobId);
  if (!job)                return res.status(404).json({ error: 'Job não encontrado' });
  const result = job.results?.[index];
  if (!result)             return res.status(404).json({ error: 'Resultado não encontrado' });
  if (result.editStatus !== 'done') return res.status(400).json({ error: 'Vídeo ainda não está pronto' });
  if (!result.editOutputPath || !fs.existsSync(result.editOutputPath)) {
    return res.status(410).json({ error: 'Arquivo expirado' });
  }

  const stat = fs.statSync(result.editOutputPath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="reel_reciclado_${index + 1}.mp4"`);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(result.editOutputPath);
  stream.pipe(res);
  stream.on('error', err => {
    console.error('Download stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar arquivo' });
  });
  stream.on('end', () => {
    try { fs.unlinkSync(result.editOutputPath); } catch {}
    result.editOutputPath = null;
    result.editStatus     = 'downloaded';
  });
});

module.exports = router;
