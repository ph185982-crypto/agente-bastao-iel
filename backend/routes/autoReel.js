const express = require('express');
const multer = require('multer');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { createCompatClient } = require('../lib/llm');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(require('ffprobe-static').path);

const openai = createCompatClient();

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

// ── Layout constants ──────────────────────────────────────────────────────────
const W         = 720;
const H         = 1280;
const BRAND_H   = 253;
const H_PAD     = 34;
const FONT_SIZE = 36;
const LINE_H    = 50;

const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf');

let FONT_B64 = '';
try { FONT_B64 = fs.readFileSync(FONT_PATH).toString('base64'); } catch {}

// ── Pure helpers ──────────────────────────────────────────────────────────────

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

async function resolveInstagramUrl(instagramUrl) {
  // socialkit.dev é o caminho principal: uma chamada só devolve o link direto
  // do vídeo. A RapidAPI abaixo fica de reserva.
  if (process.env.SOCIALKIT_API_KEY) {
    try {
      const { resolverViaSocialkit } = require('../lib/socialkit');
      const info = await resolverViaSocialkit(instagramUrl);
      return info.videoUrl;
    } catch (e) {
      if (!process.env.RAPIDAPI_KEY) throw e;
      console.warn('[autoReel] socialkit.dev falhou, caindo pro RapidAPI:', e.message?.slice(0, 120));
    }
  }

  if (!process.env.RAPIDAPI_KEY) throw new Error('Nenhum serviço de download configurado (SOCIALKIT_API_KEY ou RAPIDAPI_KEY)');

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

async function extractContent(imageBuf) {
  const base64 = imageBuf.toString('base64');
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é especialista em criar hooks e legendas virais para o Instagram Reels no nicho de empreendedorismo, vendas e marketing digital. Analise o print e retorne JSON com dois campos:

"headline": hook CURTO (máximo 8 palavras) que vai aparecer em CIMA do vídeo editado.
- Formatos que viralizam no nicho: pergunta provocativa ("Você ainda faz isso nas vendas?"), dado surpreendente ("3 erros que matam qualquer negócio"), afirmação contraintuitiva ("Menos clientes = mais lucro")
- Sem aspas, sem hashtags, pode usar 1 emoji no fim
- Desperte CURIOSIDADE ou CHOQUE relacionado ao conteúdo de empreendedorismo/vendas/marketing

"caption": legenda LONGA para o post do Instagram, em português:
Siga para não perder conteúdo sobre empreendedorismo e vendas 🚀

[Uma linha com o assunto principal + emoji]

[Parágrafo 1: descreva o conteúdo com foco em valor prático para empreendedores, 2-3 frases]

[Parágrafo 2: dica de negócios/vendas/marketing aprofundada, 2-3 frases]

[Parágrafo 3 opcional: CTA ou insight motivador para empreendedores, 1-2 frases]

[3 a 5 hashtags relevantes: #empreendedorismo #vendas #marketingdigital #negocios #empreendedor]

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
  if (!raw) throw new Error('LLM não retornou conteúdo');
  const parsed = JSON.parse(raw);
  const headline = (parsed.headline || '').trim().replace(/^["'""'']+|["'""'']+$/g, '');
  const caption  = (parsed.caption  || '').trim();
  if (!headline) throw new Error('LLM não gerou headline');
  if (!caption)  throw new Error('LLM não gerou caption');
  return { headline, caption };
}

// ── 2-layer content region detection ─────────────────────────────────────────

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
        let x1 = Infinity, y1 = Infinity, x2 = 0, y2 = 0;
        for (const m of matches) {
          const [w, h, x, y] = [1, 2, 3, 4].map(i => parseInt(m[i]));
          x1 = Math.min(x1, x);   y1 = Math.min(y1, y);
          x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h);
        }
        resolve({ cropW: x2 - x1, cropH: y2 - y1, cropX: x1, cropY: y1 });
      } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 12000);
  });
}

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

async function detectContentRegion(videoPath, vw, vh, sid) {
  const detected = await cropDetect(videoPath);
  if (detected) {
    const areaRatio = (detected.cropW * detected.cropH) / (vw * vh);
    if (areaRatio < 0.92) {
      console.log(`[cropdetect] black bars found → crop=${detected.cropW}x${detected.cropH}@${detected.cropX},${detected.cropY}`);
      return detected;
    }
  }
  const { startPct, endPct } = await analyzeVideoFrame(videoPath, sid);
  const cropY = Math.max(0,  Math.round(vh * startPct / 100));
  const cropH = Math.max(50, Math.round(vh * (endPct - startPct) / 100));
  return { cropW: vw, cropH, cropX: 0, cropY };
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
async function processAutoReel({ instagramUrl, printBuf, templateBuf, sid, preHeadline, preCaption }) {
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const bgPng    = path.join(os.tmpdir(), `${sid}_bg.png`);
  const output   = path.join(os.tmpdir(), `${sid}_reel.mp4`);

  const cleanTmp = () => [rawVideo, bgPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  try {
    const cdnUrl = await resolveInstagramUrl(instagramUrl);

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

    const { width: vw, height: vh, hasAudio, duration } = await getVideoInfo(rawVideo);
    const clipDur = Math.min(duration, 15).toFixed(3);

    const { cropW, cropH, cropX, cropY } = await detectContentRegion(rawVideo, vw, vh, sid);

    const { videoY } = await buildBackgroundPng(templateBuf, headline, bgPng);
    const videoH = H - videoY - 20;

    console.log(`[autoReel] clip=${clipDur}s vídeo=${vw}x${vh} crop=${cropW}x${cropH}@${cropX},${cropY} slot=${W}x${videoH}`);

    const filterGraph = [
      `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
      `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH}:(iw-${W})/2:(ih-${videoH})/2,setpts=PTS-STARTPTS[vid]`,
      `[bg][vid]overlay=0:${videoY}:eof_action=endall[out]`,
    ].join(';');

    const outputOpts = [
      '-map [out]', '-c:v libx264', '-preset ultrafast', '-crf 30', '-r 30',
      `-t ${clipDur}`, '-pix_fmt yuv420p',
    ];
    if (hasAudio) { outputOpts.push('-map 0:a', '-c:a aac', '-b:a 96k'); }
    else { outputOpts.push('-an'); }

    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(bgPng)
      .complexFilter(filterGraph)
      .outputOptions(outputOpts);

    await runFFmpeg(cmd, output, 50000);
    cleanTmp();
    return { headline, caption, output };
  } catch (err) {
    cleanTmp();
    throw err;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

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

    const sid = crypto.randomUUID();
    let printBuf, templateBuf = null;
    try {
      printBuf    = fs.readFileSync(req.files.print[0].path);
      templateBuf = req.files?.template ? fs.readFileSync(req.files.template[0].path) : null;
    } catch {
      return res.status(500).json({ error: 'Erro ao ler arquivos enviados' });
    } finally {
      [req.files.print[0], req.files.template?.[0]].forEach(f => {
        if (f) try { fs.unlinkSync(f.path); } catch {}
      });
    }

    try {
      const { headline, caption, output } = await processAutoReel({
        instagramUrl: instagramUrl.trim(),
        printBuf, templateBuf, sid,
        preHeadline: preHeadline?.trim() || null,
        preCaption:  preCaption?.trim()  || null,
      });

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="reel_pronto.mp4"');
      res.setHeader('X-Headline', encodeURIComponent(headline || ''));
      res.setHeader('X-Caption',  encodeURIComponent(caption  || ''));
      res.setHeader('Access-Control-Expose-Headers', 'X-Headline, X-Caption');

      const stream = fs.createReadStream(output);
      stream.pipe(res);
      stream.on('end', () => { try { fs.unlinkSync(output); } catch {} });
      stream.on('error', err => {
        console.error('[autoReel] stream error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar vídeo' });
      });
    } catch (e) {
      console.error('[autoReel] error:', e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  }
);

module.exports = router;
