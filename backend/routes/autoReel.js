const express = require('express');
const multer = require('multer');
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
const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Layout ──────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const BRAND_H = 380;
const H_PAD = 50;
const FONT_SIZE = 54;
const LINE_H = 76;

const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf');

// ── Job store ────────────────────────────────────────────────────────────────
const jobs = new Map();

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        try { fs.unlinkSync(job.outputPath); } catch {}
      }
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ── Helpers ──────────────────────────────────────────────────────────────────

function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}


function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const v = meta.streams.find(s => s.codec_type === 'video');
      if (!v) return reject(new Error('Nenhum stream de vídeo encontrado'));
      resolve({
        width: v.width,
        height: v.height,
        duration: parseFloat(meta.format.duration) || 30,
        hasAudio: meta.streams.some(s => s.codec_type === 'audio'),
      });
    });
  });
}

function runFFmpeg(cmd, outputPath, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { cmd.kill('SIGKILL'); } catch {}
      reject(new Error('FFmpeg timeout: processamento excedeu 2 minutos'));
    }, timeoutMs);

    cmd
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', (err) => { clearTimeout(timer); reject(err); })
      .save(outputPath);
  });
}

// Builds a plain white background with the template branding at the top.
// Headline text is rendered later by FFmpeg drawtext (avoids system font dependency).
async function buildBackgroundPng(templateBuf, bgPath) {
  if (templateBuf) {
    const brandingBuf = await sharp(templateBuf)
      .resize(W, BRAND_H, { fit: 'cover', position: 'north' })
      .toBuffer();
    await sharp({ create: { width: W, height: H, channels: 3, background: 'white' } })
      .composite([{ input: brandingBuf, top: 0, left: 0 }])
      .png()
      .toFile(bgPath);
  } else {
    await sharp({ create: { width: W, height: H, channels: 3, background: 'white' } })
      .png()
      .toFile(bgPath);
  }
}

// Returns the video Y offset and drawtext filters for the headline.
function headlineLayout(headline) {
  const lines = wrapText(headline, 28);
  const textBlockH = 30 + lines.length * LINE_H + 20;
  const videoY = BRAND_H + textBlockH;

  // Escape text for FFmpeg drawtext filter expression
  const escape = (s) => s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '’')   // typographic apostrophe avoids filter-quoting issues
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%');

  const drawFilters = lines.map((line, i) => {
    const y = BRAND_H + 30 + (i + 1) * LINE_H - 10;
    return `drawtext=fontfile='${FONT_PATH}':text='${escape(line)}':x=${H_PAD}:y=${y}:fontsize=${FONT_SIZE}:fontcolor=0x111111`;
  }).join(',');

  return { videoY, drawFilters };
}

async function resolveInstagramUrl(instagramUrl) {
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY não configurada');

  const response = await axios.get(
    'https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert',
    {
      params: { url: instagramUrl.trim() },
      headers: {
        'x-rapidapi-host': 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      },
      timeout: 30000,
    }
  );

  const data = response.data;
  if (Array.isArray(data?.media)) {
    const video = data.media.find(m => m.type === 'video' && m.url);
    if (video) return video.url;
    // fallback: any item with a url
    const any = data.media.find(m => m.url);
    if (any) return any.url;
  }
  throw new Error('Nenhum vídeo encontrado para essa URL do Instagram. Verifique se o post é público.');
}

async function extractHeadline(imageBuf) {
  const base64 = imageBuf.toString('base64');
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é especialista em copy de altíssima retenção para o Instagram do @pedro_destrava.
Analise o print/screenshot fornecido, entenda o tema central e crie UMA headline irresistível em PORTUGUÊS DO BRASIL.
Use obrigatoriamente um destes formatos de máxima retenção:
• "Por que [fenômeno surpreendente]..."
• "O que ninguém te contou sobre..."
• "A verdade que [autoridade/sistema] esconde..."
• "[Número] fatos que vão mudar como você vê..."
• "Como [pessoa comum] descobriu..."
• "O erro que 99% das pessoas cometem ao..."
• "Isso foi censurado porque..."
A headline deve ser curiosa, instigante, específica — NUNCA genérica.
Máximo 15 palavras. Responda APENAS com a headline, sem aspas, sem explicações.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          },
          { type: 'text', text: 'Crie a headline em português do Brasil para este conteúdo.' },
        ],
      },
    ],
    max_tokens: 120,
  });
  return response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
}

// ── Main pipeline ────────────────────────────────────────────────────────────

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
      resp.data.on('error', reject);
    }).catch(reject);
  });
}

async function processAutoReel({ instagramUrl, printBuf, templateBuf, jobId }) {
  const sid = jobId;
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const bgPng    = path.join(os.tmpdir(), `${sid}_bg.png`);
  const output   = path.join(os.tmpdir(), `${sid}_reel.mp4`);

  const cleanTmp = () => [rawVideo, bgPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  const job = jobs.get(jobId);
  const setProgress = (p, msg) => { if (job) { job.progress = p; job.message = msg; } };

  try {
    setProgress(5, 'Resolvendo URL do Instagram…');
    const cdnUrl = await resolveInstagramUrl(instagramUrl);

    setProgress(15, 'Analisando o print e baixando o vídeo…');
    let headline;
    await Promise.all([
      extractHeadline(printBuf).then(h => { headline = h; }),
      streamDownload(cdnUrl, rawVideo),
    ]);

    setProgress(40, 'Montando o fundo…');
    const { videoY, drawFilters } = headlineLayout(headline);
    await buildBackgroundPng(templateBuf, bgPng);

    setProgress(50, 'Calculando corte do vídeo…');
    const { width: vw, height: vh, hasAudio, duration } = await getVideoInfo(rawVideo);
    const clipDur = Math.min(duration, 30).toFixed(3);
    const videoH  = H - videoY - 20;
    const vAspect = vw / vh;
    const tAspect = W / videoH;

    let cropW, cropH, cropX, cropY;
    if (vAspect > tAspect) {
      cropH = vh; cropW = Math.round(vh * tAspect);
      cropX = Math.round((vw - cropW) / 2); cropY = 0;
    } else {
      cropW = vw; cropH = Math.round(vw / tAspect);
      cropX = 0; cropY = Math.round((vh - cropH) * 0.4);
    }

    // Single FFmpeg pass: background + video overlay + headline text via drawtext.
    // Image input is duration-capped so -loop 1 never hangs. eof_action=endall
    // terminates the overlay the moment the video stream ends.
    setProgress(55, 'Processando e montando o Reel…');
    const filterGraph = [
      `[0:v]scale=${W}:${H}[bg]`,
      `[1:v]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${W}:${videoH},setpts=PTS-STARTPTS[vid]`,
      `[bg][vid]overlay=0:${videoY}:eof_action=endall[ov]`,
      `[ov]${drawFilters}[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]',
      '-c:v libx264',
      '-preset ultrafast',
      '-crf 28',
      `-t ${clipDur}`,
    ];
    if (hasAudio) { outputOpts.push('-map 1:a', '-c:a aac', '-b:a 96k'); }
    else { outputOpts.push('-an'); }

    const cmd = ffmpeg()
      .input(bgPng).inputOptions(['-loop 1', `-t ${clipDur}`])
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .complexFilter(filterGraph)
      .outputOptions(outputOpts);
    await runFFmpeg(cmd, output);

    setProgress(100, 'Concluído!');
    cleanTmp();
    if (job) { job.status = 'done'; job.outputPath = output; job.headline = headline; }
  } catch (err) {
    cleanTmp();
    if (job) { job.status = 'error'; job.error = err.message; }
    throw err;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.post(
  '/',
  upload.fields([{ name: 'print', maxCount: 1 }, { name: 'template', maxCount: 1 }]),
  async (req, res) => {
    const { instagramUrl } = req.body;
    if (!instagramUrl?.trim()) return res.status(400).json({ error: 'URL do Instagram é obrigatória' });
    if (!req.files?.print) return res.status(400).json({ error: 'O print é obrigatório' });

    const jobId = crypto.randomUUID();
    jobs.set(jobId, { status: 'processing', progress: 0, message: 'Iniciando…', createdAt: Date.now() });

    const printBuf    = fs.readFileSync(req.files.print[0].path);
    const templateBuf = req.files?.template ? fs.readFileSync(req.files.template[0].path) : null;
    [req.files.print[0], req.files.template?.[0]].forEach(f => {
      if (f) try { fs.unlinkSync(f.path); } catch {}
    });

    processAutoReel({ instagramUrl: instagramUrl.trim(), printBuf, templateBuf, jobId })
      .catch(err => console.error('autoReel error:', err.message));

    res.status(202).json({ jobId });
  }
);

router.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json({ status: job.status, progress: job.progress, message: job.message, error: job.error, headline: job.headline });
});

router.get('/:jobId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  if (job.status !== 'done') return res.status(400).json({ error: 'Vídeo ainda não está pronto' });
  if (!fs.existsSync(job.outputPath)) return res.status(410).json({ error: 'Arquivo expirado' });

  const stat = fs.statSync(job.outputPath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="reel_pronto.mp4"');
  res.setHeader('Content-Length', stat.size);
  const stream = fs.createReadStream(job.outputPath);
  stream.pipe(res);
  stream.on('end', () => {
    try { fs.unlinkSync(job.outputPath); } catch {}
    jobs.delete(req.params.jobId);
  });
});

module.exports = router;
