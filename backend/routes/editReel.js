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

// ── Canvas layout ───────────────────────────────────────────────
const W = 1080;
const H = 1920;
const BRAND_H = 380;   // template branding reserved at top
const H_PAD = 50;      // horizontal text padding
const FONT_SIZE = 54;
const LINE_H = 76;

// ── In-memory job store ─────────────────────────────────────────
const jobs = new Map(); // jobId → { status, progress, outputPath, error, createdAt }

// Auto-clean jobs older than 15 min
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

// ── Helpers ─────────────────────────────────────────────────────

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
      reject(new Error('FFmpeg timeout: processamento excedeu 2 minutos'));
    }, timeoutMs);

    cmd
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', (err) => { clearTimeout(timer); reject(err); })
      .save(outputPath);
  });
}

async function buildBackgroundPng(templateBuf, headline, bgPath) {
  // Wrap text (~28 chars per line at this font size and padding)
  const lines = wrapText(headline, 28);
  const textBlockH = 30 + lines.length * LINE_H + 20;
  const videoY = BRAND_H + textBlockH;

  const svgLines = lines.map((line, i) => {
    const y = BRAND_H + 30 + (i + 1) * LINE_H;
    return `<text x="${H_PAD}" y="${y}" font-family="Liberation Sans,DejaVu Sans,Arial,sans-serif" font-size="${FONT_SIZE}" font-weight="bold" fill="#111111">${escXml(line)}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${svgLines}
  </svg>`;

  // Scale template to fill top branding area
  const brandingBuf = await sharp(templateBuf)
    .resize(W, BRAND_H, { fit: 'cover', position: 'north' })
    .toBuffer();

  await sharp({ create: { width: W, height: H, channels: 3, background: 'white' } })
    .composite([
      { input: brandingBuf, top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toFile(bgPath);

  return { videoY, textBlockH, lines: lines.length };
}

async function processReel({ videoUrl, headline, templateBuf, jobId }) {
  const sid = jobId;
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const cropVideo = path.join(os.tmpdir(), `${sid}_crop.mp4`);
  const bgPng = path.join(os.tmpdir(), `${sid}_bg.png`);
  const output = path.join(os.tmpdir(), `${sid}_reel.mp4`);

  const cleanTmp = () => [rawVideo, cropVideo, bgPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  const job = jobs.get(jobId);
  const setProgress = (p) => { if (job) job.progress = p; };

  try {
    // 1. Download video
    setProgress(5);
    const resp = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' },
    });
    fs.writeFileSync(rawVideo, Buffer.from(resp.data));
    setProgress(20);

    // 2. Probe dimensions
    const { width: vw, height: vh, hasAudio } = await getVideoInfo(rawVideo);
    const vAspect = vw / vh;

    // 3. Build background PNG + calculate layout
    const { videoY } = await buildBackgroundPng(templateBuf, headline, bgPng);
    setProgress(35);

    // 4. Smart crop: fill videoArea (W × videoH)
    const videoH = H - videoY - 20;
    const tAspect = W / videoH;
    let cropW, cropH, cropX, cropY;
    if (vAspect > tAspect) {
      cropH = vh;
      cropW = Math.round(vh * tAspect);
      cropX = Math.round((vw - cropW) / 2);
      cropY = 0;
    } else {
      cropW = vw;
      cropH = Math.round(vw / tAspect);
      cropX = 0;
      // Bias 40% from top to keep faces/subjects in frame
      cropY = Math.round((vh - cropH) * 0.4);
    }

    // 5. Crop + scale video
    setProgress(40);
    const cropCmd = ffmpeg(rawVideo)
      .videoFilter([
        `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
        `scale=${W}:${videoH}`,
      ])
      .videoCodec('libx264')
      .outputOptions(['-preset ultrafast', '-crf 26', '-t 60']);
    if (hasAudio) cropCmd.audioCodec('aac').outputOptions(['-b:a 128k']);
    else cropCmd.outputOptions(['-an']);
    await runFFmpeg(cropCmd, cropVideo);
    setProgress(70);

    // 6. Composite background PNG + cropped video → final MP4
    const overlayOpts = [
      '-map [out]',
      '-c:v libx264',
      '-preset ultrafast',
      '-crf 26',
      '-shortest',
    ];
    if (hasAudio) { overlayOpts.push('-map 1:a', '-c:a aac'); }
    else { overlayOpts.push('-an'); }

    const overlayCmd = ffmpeg()
      .input(bgPng).inputOptions(['-loop 1'])
      .input(cropVideo)
      .complexFilter([
        `[0:v]scale=${W}:${H}[bg]`,
        `[1:v]setpts=PTS-STARTPTS[vid]`,
        `[bg][vid]overlay=0:${videoY}[out]`,
      ])
      .outputOptions(overlayOpts);
    await runFFmpeg(overlayCmd, output);
    setProgress(100);

    cleanTmp();
    if (job) { job.status = 'done'; job.outputPath = output; }
  } catch (err) {
    cleanTmp();
    if (job) { job.status = 'error'; job.error = err.message; }
    throw err;
  }
}

// ── Routes ───────────────────────────────────────────────────────

// POST / — start a reel editing job
router.post('/', upload.single('template'), async (req, res) => {
  const { videoUrl, headline } = req.body;
  if (!videoUrl?.trim()) return res.status(400).json({ error: 'videoUrl é obrigatória' });
  if (!headline?.trim()) return res.status(400).json({ error: 'headline é obrigatória' });
  if (!req.file) return res.status(400).json({ error: 'Template é obrigatório' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'processing', progress: 0, createdAt: Date.now() });

  const templateBuf = fs.readFileSync(req.file.path);
  try { fs.unlinkSync(req.file.path); } catch {}

  // Run async — do not await
  processReel({ videoUrl: videoUrl.trim(), headline: headline.trim(), templateBuf, jobId })
    .catch(err => console.error('processReel error:', err.message));

  res.status(202).json({ jobId });
});

// GET /:jobId — poll status
router.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json({ status: job.status, progress: job.progress, error: job.error });
});

// GET /:jobId/download — download the finished reel
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
  stream.on('end', () => {
    try { fs.unlinkSync(job.outputPath); } catch {}
    jobs.delete(req.params.jobId);
  });
});

module.exports = router;
