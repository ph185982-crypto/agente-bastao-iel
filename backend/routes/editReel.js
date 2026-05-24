const express = require('express');
const multer = require('multer');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } });

const W        = 1080;
const H        = 1920;
const BRAND_H  = 380;
const H_PAD    = 50;
const FONT_SIZE = 54;
const LINE_H   = 76;

const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf');

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

function runFFmpeg(cmd, outputPath, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { cmd.kill('SIGKILL'); } catch {}
      reject(new Error('FFmpeg timeout: processamento excedeu 5 minutos. Tente um vídeo mais curto.'));
    }, timeoutMs);
    cmd
      .on('end',   () => { clearTimeout(timer); resolve(); })
      .on('error', (err) => { clearTimeout(timer); reject(err); })
      .save(outputPath);
  });
}

async function buildBackgroundPng(templateBuf, headline, bgPath) {
  const lines = wrapText(headline, 28);
  const textBlockH = 30 + lines.length * LINE_H + 20;
  const videoY = BRAND_H + textBlockH;

  let fontFaceDecl = '';
  try {
    const fontB64 = fs.readFileSync(FONT_PATH).toString('base64');
    fontFaceDecl = `<defs><style>@font-face{font-family:'H';src:url('data:font/truetype;base64,${fontB64}')}</style></defs>`;
  } catch {}

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

async function processReel({ videoUrl, headline, templateBuf, jobId }) {
  const sid = jobId;
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const bgPng    = path.join(os.tmpdir(), `${sid}_bg.png`);
  const output   = path.join(os.tmpdir(), `${sid}_reel.mp4`);

  const cleanTmp = () => [rawVideo, bgPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  const job = jobs.get(jobId);
  const setProgress = (p) => { if (job) job.progress = p; };

  try {
    // 1. Download video
    setProgress(5);
    await streamDownload(videoUrl, rawVideo);
    setProgress(20);

    // 2. Build background PNG + probe video in parallel
    const [{ videoY }, { width: vw, height: vh, hasAudio, duration }] = await Promise.all([
      buildBackgroundPng(templateBuf, headline, bgPng),
      getVideoInfo(rawVideo),
    ]);
    setProgress(45);

    const clipDur = Math.min(duration, 60).toFixed(3);
    const videoH  = H - videoY - 20;

    // 3. Smart crop
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

    // 4. Single FFmpeg pass: scale bg + crop/scale video + overlay
    //    -loop 1 -t clipDur on image input prevents infinite-loop hang.
    //    eof_action=endall terminates the moment the video stream ends.
    setProgress(55);

    const filterGraph = [
      `[0:v]scale=${W}:${H}[bg]`,
      `[1:v]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${W}:${videoH},setpts=PTS-STARTPTS[vid]`,
      `[bg][vid]overlay=0:${videoY}:eof_action=endall[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]',
      '-c:v libx264',
      '-preset ultrafast',
      '-crf 26',
      `-t ${clipDur}`,
    ];
    if (hasAudio) { outputOpts.push('-map 1:a', '-c:a aac', '-b:a 128k'); }
    else { outputOpts.push('-an'); }

    const clipDurSec = parseFloat(clipDur);
    const cmd = ffmpeg()
      .input(bgPng).inputOptions(['-loop 1', `-t ${clipDur}`])
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .complexFilter(filterGraph)
      .outputOptions(outputOpts)
      .on('progress', (info) => {
        if (!job) return;
        try {
          const parts = (info.timemark || '').split(':');
          const secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
          job.progress = Math.round(55 + Math.min(secs / clipDurSec, 1) * 40);
        } catch {}
      });

    await runFFmpeg(cmd, output, 300000);

    setProgress(100);
    cleanTmp();
    if (job) { job.status = 'done'; job.outputPath = output; }
  } catch (err) {
    // rawVideo is fully written (await streamDownload resolved) — safe to delete immediately.
    // bgPng may still be in-flight from a parallel buildBackgroundPng; delay cleanup to avoid leak.
    try { if (fs.existsSync(rawVideo)) fs.unlinkSync(rawVideo); } catch {}
    setTimeout(() => { try { if (fs.existsSync(bgPng)) fs.unlinkSync(bgPng); } catch {} }, 5000);
    if (job) { job.status = 'error'; job.error = err.message; }
    throw err;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/', upload.single('template'), async (req, res) => {
  const { videoUrl, headline } = req.body;
  if (!videoUrl?.trim()) return res.status(400).json({ error: 'videoUrl é obrigatória' });
  if (!headline?.trim()) return res.status(400).json({ error: 'headline é obrigatória' });
  if (!req.file) return res.status(400).json({ error: 'Template é obrigatório' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'processing', progress: 0, createdAt: Date.now() });

  let templateBuf;
  try {
    templateBuf = fs.readFileSync(req.file.path);
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao ler template enviado' });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }

  processReel({ videoUrl: videoUrl.trim(), headline: headline.trim(), templateBuf, jobId })
    .catch(err => console.error('editReel error:', err.message));

  res.status(202).json({ jobId });
});

router.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json({ status: job.status, progress: job.progress, error: job.error });
});

router.get('/:jobId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  if (job.status !== 'done') return res.status(400).json({ error: 'Vídeo ainda não está pronto' });
  if (!fs.existsSync(job.outputPath)) return res.status(410).json({ error: 'Arquivo expirado' });

  const stat = fs.statSync(job.outputPath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="reel_editado.mp4"');
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
