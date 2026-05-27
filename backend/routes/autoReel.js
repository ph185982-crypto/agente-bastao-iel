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

// ── Content extractor ─────────────────────────────────────────────────────────
// Returns { headline, caption, cropBias } from a single GPT-4o call.
// headline  → short viral text rendered on the video frame
// caption   → long Instagram post caption with paragraphs + hashtags
// cropBias  → 0.0–1.0: where to start the vertical crop in the source video
//             0.0 = start from the very top (content fills whole frame / starts at top)
//             0.8 = start 80% down (content is in the bottom portion of the frame)
async function extractContent(imageBuf) {
  const base64 = imageBuf.toString('base64');
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você cria conteúdo para o Instagram do @pedro_destrava. Analise o print e retorne um JSON com três campos:

"headline": texto CURTO que vai aparecer em CIMA do vídeo editado.
- tudo em minúsculas
- tom informal, de pessoa real
- crie curiosidade ou humor sobre o conteúdo do vídeo
- termine com CTA ("segue", "salva", "basta me seguir")
- máximo 2 frases curtas
- EXEMPLOS: "finalmente achei o video de como sacar o pino do coquilho traseiro do guindaste zulaine 75 😂" / "pouca gente entende porque niloças tesla foi silenciado. segue para ver oque quase ninguem nota"

"caption": legenda LONGA para o post do Instagram, em português, seguindo EXATAMENTE esta estrutura:
SIGA @pedro_destrava para não perder nenhum conteúdo incrível 🌱🚀

[Uma linha com o assunto principal do vídeo + emoji relacionado]

[Parágrafo 1: descreva o que acontece no vídeo de forma clara e envolvente, 2-3 frases]

[Parágrafo 2: aprofunde com um fato curioso, processo ou dado interessante sobre o assunto, 2-3 frases]

[Parágrafo 3 opcional: conclusão inspiradora ou gancho emocional, 1-2 frases]

[3 a 5 hashtags relevantes em português]

"cropBias": número de 0.0 a 1.0 indicando DE ONDE COMEÇAR O CORTE VERTICAL no vídeo fonte.
- Analise ONDE está o conteúdo visual interessante no print:
- Use 0.05 a 0.20 se o conteúdo começa PERTO DO TOPO (ex: print mostra tweet/post completo com texto + vídeo embutido, e você quer mostrar tudo desde o início do post)
- Use 0.40 a 0.60 se o conteúdo está no MEIO do frame
- Use 0.70 a 0.90 se o vídeo principal está na PARTE INFERIOR (ex: vídeo de natureza/ação no fundo, texto sobreposto no topo)
- REGRA: se o print mostra um tweet/screenshot de rede social com vídeo embutido abaixo do texto, use 0.10 a 0.25 para capturar o post inteiro

Responda APENAS o JSON, sem markdown. Formato: {"headline":"...","caption":"...","cropBias":0.15}`,
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' } },
          { type: 'text', text: 'Analise esse print e gere o headline, caption e cropBias.' },
        ],
      },
    ],
    max_tokens: 700,
    response_format: { type: 'json_object' },
  });
  const raw = res.choices[0].message.content;
  if (!raw) throw new Error('OpenAI não retornou conteúdo');
  const parsed = JSON.parse(raw);
  const headline = (parsed.headline || '').trim().replace(/^["'""'']+|["'""'']+$/g, '');
  const caption  = (parsed.caption  || '').trim();
  const cropBias = typeof parsed.cropBias === 'number'
    ? Math.max(0, Math.min(1, parsed.cropBias))
    : 0.5;
  if (!headline) throw new Error('OpenAI não gerou headline');
  if (!caption)  throw new Error('OpenAI não gerou caption');
  return { headline, caption, cropBias };
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
async function processAutoReel({ instagramUrl, printBuf, templateBuf, jobId, preHeadline, preCaption, preCropBias }) {
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

    // 2. Download video (+ extract content if not pre-computed)
    setProgress(15, 'Baixando o vídeo…');
    let headline = preHeadline || null;
    let caption  = preCaption  || null;
    let cropBias = typeof preCropBias === 'number' ? preCropBias : null;
    const tasks = [streamDownload(cdnUrl, rawVideo)];
    if (!headline || !caption || cropBias === null) {
      setProgress(15, 'Analisando o print e baixando o vídeo…');
      tasks.push(extractContent(printBuf).then(({ headline: h, caption: c, cropBias: b }) => {
        if (!headline)       headline = h;
        if (!caption)        caption  = c;
        if (cropBias === null) cropBias = b;
      }));
    }
    await Promise.all(tasks);

    // 3. Build background PNG (template + headline text via SVG with embedded font)
    setProgress(40, 'Montando o fundo com a headline…');
    const { videoY } = await buildBackgroundPng(templateBuf, headline, bgPng);

    // 4. Probe video
    setProgress(50, 'Analisando o vídeo…');
    const { width: vw, height: vh, hasAudio, duration } = await getVideoInfo(rawVideo);
    const clipDur = Math.min(duration, 15).toFixed(3);
    const videoH  = H - videoY - 20;

    // 5. Calculate smart crop
    const vAspect = vw / vh;
    const tAspect = W / videoH;
    let cropW, cropH, cropX, cropY;
    if (vAspect > tAspect) {
      // Landscape → crop sides, center horizontally
      cropH = vh; cropW = Math.round(vh * tAspect);
      cropX = Math.round((vw - cropW) / 2); cropY = 0;
    } else {
      // Portrait → use GPT-determined cropBias to start the crop at the right vertical position.
      // cropBias=0.1 → start near top (tweet/post from the beginning)
      // cropBias=0.8 → start near bottom (video content in lower portion)
      cropW = vw; cropH = Math.round(vw / tAspect);
      cropX = 0; cropY = Math.round((vh - cropH) * cropBias);
    }

    // 6. FFmpeg: vídeo como input 0, imagem de fundo como input 1.
    //    loop=-1 torna a imagem infinita. eof_action=endall para quando
    //    o vídeo (overlay) termina. -t no output é hard cap de segurança.
    setProgress(55, 'Processando e montando o Reel…');
    console.log(`[autoReel] FFmpeg iniciando — clip=${clipDur}s crop=${cropW}x${cropH} videoH=${videoH} videoY=${videoY}`);

    const filterGraph = [
      `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
      `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${W}:${videoH},setpts=PTS-STARTPTS[vid]`,
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
          job.progress = Math.round(55 + pct * 40);
          job.message = `Codificando vídeo… ${Math.round(pct * 100)}%`;
          console.log(`[autoReel] progresso ${job.progress}% (${elapsed.toFixed(1)}s / ${clipDurSec}s)`);
        } catch {}
      });

    await runFFmpeg(cmd, output, 300000);

    setProgress(100, 'Concluído!');
    cleanTmp();
    console.log(`[autoReel] concluído — headline="${headline?.slice(0,40)}" cropBias=${cropBias}`);
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
      const { headline, caption, cropBias } = await extractContent(printBuf);
      res.json({ headline, caption, cropBias });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  '/',
  upload.fields([{ name: 'print', maxCount: 1 }, { name: 'template', maxCount: 1 }]),
  async (req, res) => {
    const { instagramUrl, headline: preHeadline, caption: preCaption, cropBias: preCropBiasRaw } = req.body;
    const preCropBias = preCropBiasRaw !== undefined ? parseFloat(preCropBiasRaw) : null;
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
      preCropBias: isNaN(preCropBias) ? null : preCropBias,
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
