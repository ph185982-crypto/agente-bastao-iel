const express = require('express');
const multer = require('multer');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { OpenAI } = require('openai');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegStatic);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

// ── Layout constants ─────────────────────────────────────────────────────────
// 720×1280 (56% menos pixels que 1080p) → FFmpeg ~3× mais rápido no e2-micro
const W        = 720;
const H        = 1280;
const BRAND_H  = 253;
const H_PAD    = 34;
const FONT_SIZE = 36;
const LINE_H   = 50;

// Font bundled with the repo — no system font dependency
const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf');

// Pre-load font as base64 at startup so every request avoids a disk read
let FONT_B64 = '';
try { FONT_B64 = fs.readFileSync(FONT_PATH).toString('base64'); } catch {}

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

// ── Pure helpers ─────────────────────────────────────────────────────────────

function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxCharsPerLine && current) { lines.push(current); current = word; }
    else { current = test; }
  }
  if (current) lines.push(current);
  return lines;
}

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// Attaches listeners BEFORE .save() to avoid race-condition where FFmpeg
// finishes before listeners are registered. Kills the process on timeout.
function runFFmpeg(cmd, outputPath, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const stderrLines = [];
    const timer = setTimeout(() => {
      try { cmd.kill('SIGKILL'); } catch {}
      reject(new Error(`FFmpeg timeout (${Math.round(timeoutMs/1000)}s). Últimas linhas:\n${stderrLines.slice(-10).join('\n')}`));
    }, timeoutMs);
    cmd
      .on('stderr', line => { stderrLines.push(line); })
      .on('end',   () => { clearTimeout(timer); resolve(); })
      .on('error', (err) => {
        clearTimeout(timer);
        const tail = stderrLines.slice(-8).join(' | ');
        reject(new Error(`${err.message}${tail ? ' || ffmpeg: ' + tail : ''}`));
      })
      .save(outputPath);
  });
}

// ── Background PNG ───────────────────────────────────────────────────────────
// Renders template + headline text into a 1080×1920 PNG using Sharp/librsvg.
// The font is embedded as a base64 data URI so no system fonts are required.
async function buildBackgroundPng(templateBuf, headline, bgPath) {
  const lines = wrapText(headline, 28);
  const textBlockH = 30 + lines.length * LINE_H + 20;
  const videoY = BRAND_H + textBlockH;

  const fontFaceDecl = FONT_B64
    ? `<defs><style>@font-face{font-family:'H';src:url('data:font/truetype;base64,${FONT_B64}')}</style></defs>`
    : '';

  const fontFamily = fontFaceDecl ? 'H' : 'sans-serif';
  const textEls = lines.map((line, i) => {
    const y = BRAND_H + 30 + (i + 1) * LINE_H;
    return `<text x="${H_PAD}" y="${y}" font-family="${fontFamily}" font-size="${FONT_SIZE}" font-weight="bold" fill="#111111">${escXml(line)}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${fontFaceDecl}<rect width="${W}" height="${H}" fill="white"/>${textEls}</svg>`;

  const layers = [{ input: Buffer.from(svg), top: 0, left: 0 }];

  if (templateBuf) {
    const brandBuf = await sharp(templateBuf)
      .resize(W, BRAND_H, { fit: 'cover', position: 'north' })
      .toBuffer();
    layers.push({ input: brandBuf, top: 0, left: 0 });
  }

  await sharp({ create: { width: W, height: H, channels: 3, background: 'white' } })
    .composite(layers)
    .png()
    .toFile(bgPath);

  return { videoY };
}

// ── Instagram URL resolver ────────────────────────────────────────────────────
async function resolveInstagramUrl(instagramUrl) {
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY não configurada no servidor');

  const { data } = await axios.get(
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

  if (Array.isArray(data?.media)) {
    const video = data.media.find(m => m.type === 'video' && m.url);
    if (video) return video.url;
    const any = data.media.find(m => m.url);
    if (any) return any.url;
  }
  throw new Error('Nenhum vídeo encontrado. Verifique se o post é público.');
}

// ── Content extractor (print → headline + caption only) ───────────────────────
async function extractContent(imageBuf) {
  const base64 = imageBuf.toString('base64');
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você cria conteúdo para o Instagram do @pedro_destrava. Analise o print e retorne JSON com dois campos:

"headline": texto CURTO que vai aparecer em CIMA do vídeo editado.
- tudo em minúsculas, tom informal, pessoa real
- crie curiosidade ou humor sobre o conteúdo
- termine com CTA ("segue", "salva", "basta me seguir")
- máximo 2 frases curtas
- EXEMPLOS: "finalmente achei o video de como sacar o pino do coquilho traseiro do guindaste zulaine 75 😂" / "pouca gente entende porque niloças tesla foi silenciado. segue para ver oque quase ninguem nota"

"caption": legenda LONGA para o post do Instagram, em português:
SIGA @pedro_destrava para não perder nenhum conteúdo incrível 🌱🚀

[Uma linha com o assunto principal + emoji]

[Parágrafo 1: descreva o conteúdo de forma clara e envolvente, 2-3 frases]

[Parágrafo 2: fato curioso ou aprofundamento, 2-3 frases]

[Parágrafo 3 opcional: conclusão inspiradora, 1-2 frases]

[3 a 5 hashtags em português]

Responda APENAS o JSON. Formato: {"headline":"...","caption":"..."}`,
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' } },
          { type: 'text', text: 'Gere headline e caption para esse conteúdo.' },
        ],
      },
    ],
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });
  const raw = res.choices[0].message.content;
  if (!raw) throw new Error('OpenAI não retornou conteúdo');
  const parsed = JSON.parse(raw);
  const headline = (parsed.headline || '').trim().replace(/^["'""'']+|["'""'']+$/g, '');
  const caption  = (parsed.caption  || '').trim();
  if (!headline) throw new Error('OpenAI não gerou headline');
  if (!caption)  throw new Error('OpenAI não gerou caption');
  return { headline, caption };
}

// ── 2-layer content region detection (runs on the REAL downloaded video) ──────

// Layer 1: FFmpeg cropdetect — finds black-bar letterboxing in <2s, zero API cost.
// Returns { cropW, cropH, cropX, cropY } or null if no significant black bars found.
function cropDetect(videoPath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegStatic, [
      '-ss', '0', '-t', '4',
      '-i', videoPath,
      '-vf', 'cropdetect=24:16:0',
      '-f', 'null', '-',
    ]);
    const lines = [];
    proc.stderr.on('data', d => lines.push(d.toString()));
    proc.on('close', () => {
      try {
        const out = lines.join('');
        const matches = [...out.matchAll(/\bcrop=(\d+):(\d+):(\d+):(\d+)/g)];
        if (!matches.length) return resolve(null);
        // Union across all detected frames so we never clip content
        let x1 = Infinity, y1 = Infinity, x2 = 0, y2 = 0;
        for (const m of matches) {
          const [w, h, x, y] = [1,2,3,4].map(i => parseInt(m[i]));
          x1 = Math.min(x1, x);   y1 = Math.min(y1, y);
          x2 = Math.max(x2, x+w); y2 = Math.max(y2, y+h);
        }
        resolve({ cropW: x2-x1, cropH: y2-y1, cropX: x1, cropY: y1 });
      } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 12000);
  });
}

// Layer 2: GPT-4o analyzes an actual frame extracted from the downloaded video.
// Much more accurate than analyzing the user's print because we see the real content.
async function analyzeVideoFrame(videoPath, sid) {
  const framePath = path.join(os.tmpdir(), `${sid}_frame.jpg`);
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegStatic, [
        '-ss', '1', '-i', videoPath,
        '-vframes', '1', '-q:v', '3', '-y', framePath,
      ]);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`frame exit ${code}`)));
      proc.on('error', reject);
      setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('frame timeout')); }, 15000);
    });

    const base64 = fs.readFileSync(framePath).toString('base64');
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Analyze this video frame and return the vertical region containing the main visual content.
Return JSON: {"startPct": number, "endPct": number} (integers 0-100, measured from the TOP of the frame).
Rules:
- Ignore black bars, white/gray margins, and app chrome (status bar, navigation).
- If a tweet or social post is shown, include the FULL post (avatar + text + embedded video).
- If the frame is mostly one video filling the screen: start=0, end=100.
- Be precise: if the coin mechanism video occupies 60%-92% of the frame height, return start=60, end=92.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Where is the main content in this frame?' },
          ],
        },
      ],
      max_tokens: 60,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    const startPct = Math.max(0,  Math.min(99,  parseInt(parsed.startPct) || 0));
    const endPct   = Math.max(1,  Math.min(100, parseInt(parsed.endPct)   || 100));
    console.log(`[frameAnalysis] content=${startPct}%-${endPct}% of actual video frame`);
    return { startPct, endPct };
  } catch (e) {
    console.warn('[analyzeVideoFrame] failed, using full frame:', e.message);
    return { startPct: 0, endPct: 100 };
  } finally {
    try { if (fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch {}
  }
}

// Combines both layers: returns precise { cropW, cropH, cropX, cropY }.
async function detectContentRegion(videoPath, vw, vh, sid) {
  // Layer 1 — fast, free
  const detected = await cropDetect(videoPath);
  if (detected) {
    const areaRatio = (detected.cropW * detected.cropH) / (vw * vh);
    if (areaRatio < 0.92) {
      console.log(`[cropdetect] black bars found → crop=${detected.cropW}x${detected.cropH}@${detected.cropX},${detected.cropY} (${((1-areaRatio)*100).toFixed(0)}% black)`);
      return detected;
    }
  }

  // Layer 2 — GPT vision on real frame
  const { startPct, endPct } = await analyzeVideoFrame(videoPath, sid);
  const cropY = Math.max(0,  Math.round(vh * startPct / 100));
  const cropH = Math.max(50, Math.round(vh * (endPct - startPct) / 100));
  return { cropW: vw, cropH, cropX: 0, cropY };
}

// ── Video download ────────────────────────────────────────────────────────────
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
      resp.data.on('error', (err) => { writer.destroy(); reject(err); });
    }).catch(reject);
  });
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function processAutoReel({ instagramUrl, printBuf, templateBuf, jobId, preHeadline, preCaption }) {
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
    // 1. Resolve Instagram URL
    setProgress(5, 'Resolvendo URL do Instagram…');
    const cdnUrl = await resolveInstagramUrl(instagramUrl);

    // 2. Download video + extract headline/caption in parallel
    setProgress(15, 'Baixando o vídeo e analisando o print…');
    let headline = preHeadline || null;
    let caption  = preCaption  || null;
    const dlTasks = [streamDownload(cdnUrl, rawVideo)];
    if (!headline || !caption) {
      dlTasks.push(extractContent(printBuf).then(({ headline: h, caption: c }) => {
        if (!headline) headline = h;
        if (!caption)  caption  = c;
      }));
    }
    await Promise.all(dlTasks);

    // 3. Probe video dimensions
    setProgress(35, 'Lendo metadados do vídeo…');
    const { width: vw, height: vh, hasAudio, duration } = await getVideoInfo(rawVideo);
    const clipDur = Math.min(duration, 15).toFixed(3);

    // 4. Detect content region from the real video (2-layer: cropdetect → GPT frame)
    setProgress(42, 'Detectando região do conteúdo…');
    const { cropW, cropH, cropX, cropY } = await detectContentRegion(rawVideo, vw, vh, sid);

    // 5. Build background PNG (headline + template)
    setProgress(52, 'Montando o fundo com a headline…');
    const { videoY } = await buildBackgroundPng(templateBuf, headline, bgPng);
    const videoH = H - videoY - 20;

    // 6. FFmpeg: fill+center-crop detected region → output slot (W × videoH)
    setProgress(58, 'Processando e montando o Reel…');
    console.log(`[autoReel] clip=${clipDur}s vídeo=${vw}x${vh} crop=${cropW}x${cropH}@${cropX},${cropY} slot=${W}x${videoH}`);

    const filterGraph = [
      `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
      // Scale detected region to fill slot (zoom+center-crop handles any aspect ratio)
      `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH}:(iw-${W})/2:(ih-${videoH})/2,setpts=PTS-STARTPTS[vid]`,
      `[bg][vid]overlay=0:${videoY}:eof_action=endall[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]',
      '-c:v libx264',
      '-preset ultrafast',
      '-crf 30',
      '-r 30',
      `-t ${clipDur}`,
      '-pix_fmt yuv420p',
    ];
    if (hasAudio) { outputOpts.push('-map 0:a', '-c:a aac', '-b:a 96k'); }
    else { outputOpts.push('-an'); }

    const clipDurSec = parseFloat(clipDur);
    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(bgPng)
      .complexFilter(filterGraph)
      .outputOptions(outputOpts)
      .on('progress', (info) => {
        if (!job) return;
        try {
          const parts = (info.timemark || '').split(':');
          if (parts.length < 3) return;
          const h = parseFloat(parts[0]);
          const m = parseFloat(parts[1]);
          const s = parseFloat(parts[2]);
          if (isNaN(h) || isNaN(m) || isNaN(s)) return;
          const elapsed = h * 3600 + m * 60 + s;
          const pct = Math.min(elapsed / clipDurSec, 1);
          job.progress = Math.round(58 + pct * 37);
          job.message = `Codificando vídeo… ${Math.round(pct * 100)}%`;
          console.log(`[autoReel] progresso ${job.progress}% (${elapsed.toFixed(1)}s / ${clipDurSec}s)`);
        } catch {}
      });

    await runFFmpeg(cmd, output, 300000);

    setProgress(100, 'Concluído!');
    cleanTmp();
    console.log(`[autoReel] concluído — headline="${headline?.slice(0,40)}"`);
    if (job) { job.status = 'done'; job.outputPath = output; job.headline = headline; job.caption = caption; }
  } catch (err) {
    cleanTmp();
    if (job) { job.status = 'error'; job.error = err.message; }
    throw err;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /extract-headline — pre-extract headline from print BEFORE the main job.
// Called as soon as the user selects a print image, removing GPT latency from critical path.
router.post(
  '/extract-headline',
  upload.single('print'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Print é obrigatório' });
    let printBuf;
    try {
      printBuf = fs.readFileSync(req.file.path);
    } catch {
      return res.status(500).json({ error: 'Erro ao ler imagem' });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    try {
      const { headline, caption } = await extractContent(printBuf);
      res.json({ headline, caption });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  '/',
  upload.fields([{ name: 'print', maxCount: 1 }, { name: 'template', maxCount: 1 }]),
  async (req, res) => {
    const { instagramUrl, headline: preHeadline, caption: preCaption } = req.body;
    if (!instagramUrl?.trim()) return res.status(400).json({ error: 'URL do Instagram é obrigatória' });
    if (!req.files?.print)     return res.status(400).json({ error: 'O print é obrigatório' });

    const jobId = crypto.randomUUID();
    jobs.set(jobId, { status: 'processing', progress: 0, message: 'Iniciando…', createdAt: Date.now() });

    let printBuf, templateBuf = null;
    try {
      printBuf    = fs.readFileSync(req.files.print[0].path);
      templateBuf = req.files?.template ? fs.readFileSync(req.files.template[0].path) : null;
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao ler arquivos enviados' });
    } finally {
      [req.files.print[0], req.files.template?.[0]].forEach(f => {
        if (f) try { fs.unlinkSync(f.path); } catch {}
      });
    }

    processAutoReel({
      instagramUrl: instagramUrl.trim(),
      printBuf,
      templateBuf,
      jobId,
      preHeadline: preHeadline?.trim() || null,
      preCaption:  preCaption?.trim()  || null,
    }).catch(err => console.error('autoReel error:', err.message));

    res.status(202).json({ jobId });
  }
);

router.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json({ status: job.status, progress: job.progress, message: job.message, error: job.error, headline: job.headline, caption: job.caption });
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
  stream.on('error', (err) => {
    console.error('Download stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar arquivo' });
  });
  stream.on('end', () => {
    try { fs.unlinkSync(job.outputPath); } catch {}
    jobs.delete(req.params.jobId);
  });
});

module.exports = router;
