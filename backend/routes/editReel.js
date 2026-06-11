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
ffmpeg.setFfprobePath(require('ffprobe-static').path);

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } });

const W         = 1080;
const H         = 1920;
const BRAND_H   = 380;
const H_PAD     = 50;
const FONT_SIZE = 54;
const LINE_H    = 76;

const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf');

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
    const stderrLines = [];
    const timer = setTimeout(() => {
      try { cmd.kill('SIGKILL'); } catch {}
      reject(new Error(`FFmpeg timeout (${Math.round(timeoutMs / 1000)}s). Últimas linhas:\n${stderrLines.slice(-10).join('\n')}`));
    }, timeoutMs);
    cmd
      .on('stderr', line => { stderrLines.push(line); })
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', err => {
        clearTimeout(timer);
        const tail = stderrLines.slice(-8).join(' | ');
        reject(new Error(`${err.message}${tail ? ' || ffmpeg: ' + tail : ''}`));
      })
      .save(outputPath);
  });
}

async function buildBackgroundPng(templateBuf, headline, bgPath) {
  const lines = wrapText(headline, 28);
  const textBlockH = 30 + lines.length * LINE_H + 20;
  const videoY = BRAND_H + textBlockH;

  const fontFamily = "'DejaVu Sans', sans-serif"; // registrada via backend/fontSetup.js
  const textEls = lines.map((line, i) => {
    const y = BRAND_H + 30 + (i + 1) * LINE_H;
    return `<text x="${H_PAD}" y="${y}" font-family="${fontFamily}" font-size="${FONT_SIZE}" font-weight="bold" fill="#111111">${escXml(line)}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="white"/>${textEls}</svg>`;

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
      resp.data.on('error', err => { writer.destroy(); reject(err); });
    }).catch(reject);
  });
}

// ── Main pipeline (synchronous) ───────────────────────────────────────────────
async function processReel({ videoUrl, headline, templateBuf, sid }) {
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const bgPng    = path.join(os.tmpdir(), `${sid}_bg.png`);
  const output   = path.join(os.tmpdir(), `${sid}_reel.mp4`);

  const cleanTmp = () => [rawVideo, bgPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  try {
    await streamDownload(videoUrl, rawVideo);

    const [{ videoY }, { width: vw, height: vh, hasAudio, duration }] = await Promise.all([
      buildBackgroundPng(templateBuf, headline, bgPng),
      getVideoInfo(rawVideo),
    ]);

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

    const filterGraph = [
      `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
      `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${W}:${videoH},setpts=PTS-STARTPTS[vid]`,
      `[bg][vid]overlay=0:${videoY}:eof_action=endall[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]', '-c:v libx264', '-preset ultrafast', '-crf 28', '-r 30',
      `-t ${clipDur}`, '-pix_fmt yuv420p',
    ];
    if (hasAudio) { outputOpts.push('-map 0:a', '-c:a aac', '-b:a 128k'); }
    else { outputOpts.push('-an'); }

    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(bgPng)
      .complexFilter(filterGraph)
      .outputOptions(outputOpts);

    await runFFmpeg(cmd, output, 50000);
    cleanTmp();
    return output;
  } catch (err) {
    try { if (fs.existsSync(rawVideo)) fs.unlinkSync(rawVideo); } catch {}
    setTimeout(() => { try { if (fs.existsSync(bgPng)) fs.unlinkSync(bgPng); } catch {} }, 5000);
    throw err;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/', upload.single('template'), async (req, res) => {
  const { videoUrl, headline } = req.body;
  if (!videoUrl?.trim()) return res.status(400).json({ error: 'videoUrl é obrigatória' });
  if (!headline?.trim()) return res.status(400).json({ error: 'headline é obrigatória' });
  if (!req.file) return res.status(400).json({ error: 'Template é obrigatório' });

  const sid = crypto.randomUUID();
  let templateBuf;
  try {
    templateBuf = fs.readFileSync(req.file.path);
  } catch {
    return res.status(500).json({ error: 'Erro ao ler template enviado' });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }

  try {
    const output = await processReel({ videoUrl: videoUrl.trim(), headline: headline.trim(), templateBuf, sid });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="reel_editado.mp4"');

    const stream = fs.createReadStream(output);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(output); } catch {} });
    stream.on('error', err => {
      console.error('[editReel] stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar vídeo' });
    });
  } catch (e) {
    console.error('[editReel] error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
