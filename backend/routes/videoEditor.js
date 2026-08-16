// ── Editor de Vídeo ───────────────────────────────────────────────────────────
// Recebe um link de vídeo do Instagram e devolve o reel PRONTO PARA POSTAR:
// baixa o vídeo, recorta a região de conteúdo, monta o frame vertical
// (cabeçalho do perfil + gancho no topo + vídeo embaixo) e gera a legenda.
//
// Pipeline em 2 etapas (cada uma cabe nos 60s da função Vercel):
//   POST /analyze  { instagramUrl }                    → { headline, caption, durationSec }
//   POST /render   { instagramUrl, headline, caption } → video/mp4 + header X-Caption
//
// A etapa /analyze entende o VÍDEO (transcrição do áudio + leitura do frame) e
// escreve gancho e legenda. O usuário pode editar o gancho antes de renderizar.
require('../fontSetup');
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { createCompatClient, friendlyErrorMessage } = require('../lib/llm');
const { PEDRO_DNA, LINGUAGEM_LEIGO, PROFILE_HANDLE, PROFILE_NAME } = require('../lib/pedroDna');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(require('ffprobe-static').path);

const llm = createCompatClient();
const router = express.Router();

// Erro técnico de provedor (OpenAI/Groq/axios) vira mensagem amigável; erro de
// negócio (já escrito em português por este arquivo) passa direto.
function safeErrorMessage(e) {
  if (e?.status) return friendlyErrorMessage(e);
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')) {
    return 'Isso demorou mais que o esperado. Tente novamente ou use um vídeo mais curto.';
  }
  return e?.message || 'Não foi possível processar o vídeo agora. Tente novamente.';
}

// Selo de verificado no cabeçalho. Ligado por padrão (o perfil é verificado);
// dá pra desligar com PROFILE_VERIFIED=false.
const PROFILE_VERIFIED = String(process.env.PROFILE_VERIFIED || 'true').toLowerCase() !== 'false';

// ── Layout (mesmo perfil de saída das outras rotas de vídeo) ──────────────────
const W = 720;
const H = 1280;
const MAX_CLIP_SEC = 45;

const FONT_BLACK = "'Poppins ExtraBold', sans-serif";
const FONT_BOLD  = "'Poppins', sans-serif";
const FONT_BODY  = "'Poppins SemiBold', sans-serif";

// Cabeçalho do perfil
const AV_D = 116;              // diâmetro do avatar
const AV_X = 96;
const AV_Y = 60;
const NAME_X = AV_X + AV_D + 28;
const HEADER_BOTTOM = AV_Y + AV_D + 42;

const H_PAD = 52;
const HEAD_FONT = 44;
const HEAD_LINE = 58;

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A fonte do gancho (Poppins) não tem glifos de emoji — sem isso, emoji vira
// um quadrado/retângulo vazio ("tofu") no PNG. O gancho é só tipografia; emoji
// fica na legenda, que é texto normal do Instagram e renderiza certo lá.
function stripEmoji(text) {
  return String(text)
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function wrapText(text, maxCharsPerLine) {
  const words = String(text).split(' ');
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

// Diminui a fonte até o texto caber na caixa. charRatio 0.60 = largura média de
// caractere do Poppins ExtraBold (fonte geométrica, mais larga que o normal).
function fitText(text, { maxFont, minFont, boxW, boxH, charRatio = 0.60, lineRatio = 1.32 }) {
  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 2) {
    const maxChars = Math.max(6, Math.floor(boxW / (fontSize * charRatio)));
    const lines = wrapText(text, maxChars);
    const lineH = fontSize * lineRatio;
    if (lines.length * lineH <= boxH) return { fontSize, lines, lineH };
  }
  // Nem no fontSize mínimo coube — trunca (com reticências) em vez de deixar
  // o bloco de texto invadir o espaço reservado ao vídeo.
  const maxChars = Math.max(6, Math.floor(boxW / (minFont * charRatio)));
  const lineH = minFont * lineRatio;
  const maxLines = Math.max(1, Math.floor(boxH / lineH));
  let lines = wrapText(text, maxChars);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '').trim() + '…';
  }
  return { fontSize: minFont, lines, lineH };
}

// ── Avatar do perfil ──────────────────────────────────────────────────────────
// Ordem: backend/assets/avatar.(jpg|png|…) → env AVATAR_URL (baixada uma vez e
// cacheada em /tmp) → círculo com a inicial. O reel sai nos três casos.
const AVATAR_CANDIDATES = ['avatar.jpg', 'avatar.jpeg', 'avatar.png', 'avatar.webp']
  .map(f => path.join(__dirname, '..', 'assets', f));

const AVATAR_CACHE = path.join(os.tmpdir(), 'profile_avatar_cache');

function findAvatarFile() {
  for (const p of AVATAR_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  try {
    if (fs.existsSync(AVATAR_CACHE) && fs.statSync(AVATAR_CACHE).size > 512) return AVATAR_CACHE;
  } catch {}
  return null;
}

async function fetchAvatarFromUrl() {
  if (!process.env.AVATAR_URL) return null;
  try {
    const { data } = await axios.get(process.env.AVATAR_URL, {
      responseType: 'arraybuffer',
      timeout: 12000,
      maxContentLength: 8 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const buf = Buffer.from(data);
    // valida que é imagem antes de cachear
    await sharp(buf).metadata();
    fs.writeFileSync(AVATAR_CACHE, buf);
    return AVATAR_CACHE;
  } catch (e) {
    console.warn('[videoEditor] AVATAR_URL falhou:', e.message?.slice(0, 120));
    return null;
  }
}

async function buildAvatarCircle(diameter) {
  const d = Math.round(diameter);
  const r = Math.round(d / 2);
  const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${r}" cy="${r}" r="${r}" fill="white"/></svg>`);

  const file = findAvatarFile() || await fetchAvatarFromUrl();
  if (file) {
    try {
      return await sharp(file)
        .resize(d, d, { fit: 'cover', position: 'attention' })
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch (e) {
      console.warn('[videoEditor] avatar falhou, usando fallback:', e.message);
    }
  }

  const initial = escXml((PROFILE_NAME || 'P').trim().charAt(0).toUpperCase());
  const fallback = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">
    <defs><linearGradient id="av" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3B5BFD"/><stop offset="1" stop-color="#7C3AED"/>
    </linearGradient></defs>
    <rect width="${d}" height="${d}" fill="url(#av)"/>
    <text x="${r}" y="${r + d * 0.19}" font-family="${FONT_BLACK}" font-size="${Math.round(d * 0.52)}"
      fill="white" text-anchor="middle">${initial}</text>
  </svg>`);
  return sharp(fallback).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

// Selo verificado (círculo serrilhado azul + check), desenhado em SVG
function verifiedBadgeSvg(cx, cy, r) {
  const points = [];
  const spikes = 12;
  for (let i = 0; i < spikes * 2; i++) {
    const rad = (i * Math.PI) / spikes;
    const rr = i % 2 === 0 ? r : r * 0.86;
    points.push(`${(cx + rr * Math.sin(rad)).toFixed(1)},${(cy - rr * Math.cos(rad)).toFixed(1)}`);
  }
  const c = r * 0.46;
  return `<polygon points="${points.join(' ')}" fill="#1D9BF0"/>` +
    `<path d="M${(cx - c).toFixed(1)},${cy.toFixed(1)} L${(cx - c * 0.15).toFixed(1)},${(cy + c * 0.62).toFixed(1)} L${(cx + c).toFixed(1)},${(cy - c * 0.55).toFixed(1)}" ` +
    `stroke="white" stroke-width="${Math.max(3, r * 0.22).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Monta o PNG de fundo: cabeçalho do perfil + gancho. Devolve o Y onde o vídeo entra.
async function buildFramePng(headline, bgPath) {
  const fit = fitText(stripEmoji(headline), {
    maxFont: HEAD_FONT, minFont: 30,
    boxW: W - H_PAD * 2,        // largura útil real, com as margens dos dois lados
    boxH: 4 * HEAD_LINE,        // até 4 linhas
  });
  const lines = fit.lines;
  const headTop = HEADER_BOTTOM + 46;
  const headBlockH = lines.length * fit.lineH;
  // Reserva um mínimo de altura pro vídeo mesmo num cenário extremo de texto —
  // segunda camada de defesa além do truncamento em fitText().
  const MIN_VIDEO_H = 500;
  const videoY = Math.min(Math.round(headTop + headBlockH + 34), H - MIN_VIDEO_H);

  const nameSize = 42;
  const handleSize = 32;
  const nameY = AV_Y + 50;
  const handleY = nameY + 50;
  // largura aproximada do nome pra posicionar o selo logo depois
  const nameW = String(PROFILE_NAME).length * nameSize * 0.60;
  const badgeR = 23;

  const headEls = lines.map((line, i) =>
    `<text x="${H_PAD}" y="${(headTop + i * fit.lineH + fit.fontSize * 0.86).toFixed(1)}" font-family="${FONT_BLACK}" ` +
    `font-size="${fit.fontSize}" fill="#111111">${escXml(line)}</text>`
  ).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    <text x="${NAME_X}" y="${nameY}" font-family="${FONT_BLACK}" font-size="${nameSize}" fill="#0A0A0A">${escXml(PROFILE_NAME)}</text>
    ${PROFILE_VERIFIED ? verifiedBadgeSvg(NAME_X + nameW + badgeR + 14, nameY - nameSize * 0.34, badgeR) : ''}
    <text x="${NAME_X}" y="${handleY}" font-family="${FONT_BODY}" font-size="${handleSize}" fill="#3C3C43">${escXml(PROFILE_HANDLE)}</text>
    ${headEls}
  </svg>`;

  const avatar = await buildAvatarCircle(AV_D);

  await sharp({ create: { width: W, height: H, channels: 3, background: 'white' } })
    .composite([
      { input: Buffer.from(svg), top: 0, left: 0 },
      { input: avatar, top: AV_Y, left: AV_X },
    ])
    .png()
    .toFile(bgPath);

  return { videoY };
}

// ── Instagram ─────────────────────────────────────────────────────────────────
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
  throw new Error('Nenhum vídeo encontrado nesse link. Confirme que o post é público.');
}

function streamDownload(url, destPath, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    axios.get(url, {
      responseType: 'stream',
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.instagram.com/' },
    }).then(resp => {
      const writer = fs.createWriteStream(destPath);
      resp.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      resp.data.on('error', err => { writer.destroy(); reject(err); });
    }).catch(reject);
  });
}

// Cache do vídeo baixado, reaproveitado entre /analyze e /render — o frontend
// chama os dois em sequência para o mesmo link, e sem isso cada etapa baixava
// o vídeo do zero (dobrava o tempo de espera à toa). Best-effort: só ajuda
// quando as duas chamadas caem no mesmo container "quente" da Vercel; se não
// caírem, cada rota baixa normalmente.
function rawVideoCachePath(instagramUrl) {
  const key = crypto.createHash('sha1').update(instagramUrl.trim()).digest('hex');
  return path.join(os.tmpdir(), `ve_raw_${key}.mp4`);
}

// Varredura best-effort do /tmp: apaga caches de vídeo abandonados (sessão que
// fez /analyze mas nunca chegou no /render) — sem isso, ficam até o container reciclar.
function sweepStaleVideoCache() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith('ve_raw_')) continue;
      const p = path.join(os.tmpdir(), name);
      try {
        if (now - fs.statSync(p).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

async function getOrDownloadVideo(instagramUrl, destPath) {
  sweepStaleVideoCache();
  const cachePath = rawVideoCachePath(instagramUrl);
  try {
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      if (stat.size > 10000 && Date.now() - stat.mtimeMs < 4 * 60 * 1000) {
        fs.copyFileSync(cachePath, destPath);
        return;
      }
    }
  } catch {}

  const cdnUrl = await resolveInstagramUrl(instagramUrl);
  await streamDownload(cdnUrl, destPath);
  try { fs.copyFileSync(destPath, cachePath); } catch {}
}

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const v = (meta.streams || []).find(s => s.codec_type === 'video');
      if (!v) return reject(new Error('Nenhum stream de vídeo encontrado'));
      resolve({
        width: v.width,
        height: v.height,
        duration: parseFloat(meta.format?.duration) || 30,
        hasAudio: (meta.streams || []).some(s => s.codec_type === 'audio'),
      });
    });
  });
}

function runFFmpeg(cmd, outputPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const stderrLines = [];
    const timer = setTimeout(() => {
      try { cmd.kill('SIGKILL'); } catch {}
      reject(new Error(`Renderização passou de ${Math.round(timeoutMs / 1000)}s. Tente um vídeo mais curto.`));
    }, timeoutMs);
    cmd
      .on('stderr', line => { stderrLines.push(line); })
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', err => {
        clearTimeout(timer);
        reject(new Error(`${err.message} || ffmpeg: ${stderrLines.slice(-6).join(' | ')}`));
      })
      .save(outputPath);
  });
}

// ── Recorte: acha a região com o conteúdo real do vídeo ───────────────────────
function cropDetect(videoPath) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegStatic, [
      '-ss', '0', '-t', '4', '-i', videoPath,
      '-vf', 'cropdetect=24:16:0', '-f', 'null', '-',
    ]);
    const lines = [];
    proc.stderr.on('data', d => lines.push(d.toString()));
    proc.on('close', () => {
      try {
        const matches = [...lines.join('').matchAll(/\bcrop=(\d+):(\d+):(\d+):(\d+)/g)];
        if (!matches.length) return resolve(null);
        let x1 = Infinity, y1 = Infinity, x2 = 0, y2 = 0;
        for (const m of matches) {
          const [w, h, x, y] = [1, 2, 3, 4].map(i => parseInt(m[i]));
          x1 = Math.min(x1, x); y1 = Math.min(y1, y);
          x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h);
        }
        resolve({ cropW: x2 - x1, cropH: y2 - y1, cropX: x1, cropY: y1 });
      } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 12000);
  });
}

function extractFrame(videoPath, atSec, framePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, [
      '-ss', String(atSec), '-i', videoPath, '-vframes', '1', '-q:v', '3', '-y', framePath,
    ]);
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('frame timeout')); }, 15000);
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`frame exit ${code}`)); });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// Lê UM frame e resolve duas coisas de uma vez:
//  1. o gancho que o autor original já escreveu queimado no vídeo (quando existe);
//  2. o retângulo com a mídia pura, pra cortar fora essa faixa de texto.
// São a mesma pergunta na prática — pra excluir a faixa, o modelo precisa achá-la
// e ler o que está escrito nela. Por isso vale uma chamada só.
async function readFramePlan(videoPath, vw, vh, sid) {
  const empty = { region: null, bakedHeadline: '' };
  if (!process.env.OPENAI_API_KEY) return empty;   // Groq/llama não aceita imagem

  const framePath = path.join(os.tmpdir(), `${sid}_plan.jpg`);
  try {
    await extractFrame(videoPath, 1, framePath);
    const base64 = fs.readFileSync(framePath).toString('base64');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25000 });
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You analyze one frame from a short vertical video.

This clip is often a "repost": someone's edit where an editorial HEADLINE was written on a solid-color band (white, black, or any other flat color — no picture visible behind the text) stacked above or below the actual footage. We rebuild that layout with our own branding, so we need two things from this frame.

Return JSON:
{"headline": string, "top": number, "bottom": number, "left": number, "right": number}

"headline" — the editorial headline/title text baked onto a solid band in this frame, transcribed EXACTLY as written (keep original wording, accents, emoji and capitalization; join wrapped lines with a single space).
- Only text that reads as a written headline/title about the content.
- NOT the username/handle/@, NOT "seguir"/"follow" buttons, NOT UI labels, NOT timestamps.
- NOT subtitles that sit ON TOP of the visible footage picture.
- If there is no such headline band, return "".

"top"/"bottom"/"left"/"right" — the rectangle of the pure footage (photo/video), as integers 0-100 percent of the frame; top/bottom measured from the TOP edge, left/right from the LEFT edge.

The KEY test to decide what's "footage" vs. "band": can you see picture/scene behind the text?
- If text sits on a FLAT, solid-color rectangle with NO picture visible around or behind it (any color — white, black, gray, brand color), that whole rectangle is a caption/title BAND. EXCLUDE it, however short or long, however many lines, with or without emoji.
- If text is overlaid directly on top of the visible photo/video picture (you can see the scene behind/around the letters, even if there's a semi-transparent dark box just tightly hugging the text) — that's a subtitle and IS part of the footage. KEEP it.
- Also EXCLUDE: black bars, solid margins, app chrome (status bar, avatar+username row, navigation).
- Never crop INTO the footage itself once you've found where it starts/ends — never cut off a head or face.
- If the footage already fills the frame with zero bands: top 0, bottom 100, left 0, right 100.
- A frame can have a band at the top AND still have subtitles further down sitting on the footage — only cut the band, keep the footage (subtitles included) intact.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' } },
            { type: 'text', text: 'Transcribe the baked-in headline (if any) and give the footage rectangle.' },
          ],
        },
      ],
    });

    const p = JSON.parse(res.choices[0].message.content || '{}');

    const num = (v, dflt) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : dflt);
    let top = Math.max(0, Math.min(100, num(p.top, 0)));
    let bottom = Math.max(0, Math.min(100, num(p.bottom, 100)));
    let left = Math.max(0, Math.min(100, num(p.left, 0)));
    let right = Math.max(0, Math.min(100, num(p.right, 100)));
    if (bottom <= top) { top = 0; bottom = 100; }
    if (right <= left) { left = 0; right = 100; }

    let region = {
      cropX: Math.round(vw * left / 100),
      cropY: Math.round(vh * top / 100),
      cropW: Math.round(vw * (right - left) / 100),
      cropH: Math.round(vh * (bottom - top) / 100),
    };

    // Guarda-chuva contra alucinação: recorte que joga fora mais da metade da
    // imagem quase sempre é erro do modelo — nesses casos é melhor usar o frame
    // inteiro (sobra texto) do que entregar um vídeo com o rosto cortado.
    const areaRatio = (region.cropW * region.cropH) / (vw * vh);
    if (areaRatio < 0.45) {
      console.warn(`[videoEditor] recorte da vision descartado (área ${(areaRatio * 100).toFixed(0)}%)`);
      region = null;
    }

    // Segunda passada: o primeiro palpite às vezes deixa passar uma faixa
    // (ex: fundo preto confundido com legenda-sobre-vídeo). Confere o recorte
    // já feito e aperta mais se ainda sobrou banda de texto.
    if (region) region = await verifyCropIsClean(client, framePath, region, vw, vh);

    return { region, bakedHeadline: cleanBakedHeadline(p.headline) };
  } catch (e) {
    console.warn('[videoEditor] leitura do frame falhou:', e.message);
    return empty;
  } finally {
    try { if (fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch {}
  }
}

// Confere o recorte já proposto: corta o frame original pra essa região e
// pergunta de novo, olhando só o resultado, se ainda sobrou faixa de legenda
// nas bordas. Pega os casos em que o primeiro palpite classificou errado uma
// banda escura como "legenda sobre o vídeo" (que deveria ficar).
async function verifyCropIsClean(client, framePath, region, vw, vh) {
  try {
    const cropped = await sharp(framePath)
      .extract({ left: region.cropX, top: region.cropY, width: region.cropW, height: region.cropH })
      .resize({ width: 640, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const base64 = cropped.toString('base64');
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 80,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `This image was already cropped to keep only footage. Check the TOP and BOTTOM edges for a leftover caption/title band — text sitting on a flat solid-color strip with NO picture visible behind it (any color). Text overlaid directly on visible footage (subtitles) is fine and NOT a band.

Return JSON: {"trimTopPct": number, "trimBottomPct": number} — percent (0-40) of THIS image's height still to shave off the top/bottom to remove a leftover band. 0 if that edge is already clean.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Any leftover caption band at the top or bottom?' },
          ],
        },
      ],
    }, { timeout: 15000 });
    const p = JSON.parse(res.choices[0].message.content || '{}');
    const trimTop = Math.max(0, Math.min(40, parseFloat(p.trimTopPct) || 0));
    const trimBottom = Math.max(0, Math.min(40, parseFloat(p.trimBottomPct) || 0));
    if (!trimTop && !trimBottom) return region;

    const cutTop = Math.round(region.cropH * trimTop / 100);
    const cutBottom = Math.round(region.cropH * trimBottom / 100);
    const newH = region.cropH - cutTop - cutBottom;
    if (newH < region.cropH * 0.4) return region; // corte agressivo demais — não confia

    console.log(`[videoEditor] verificação apertou o recorte (topo -${trimTop.toFixed(0)}%, base -${trimBottom.toFixed(0)}%)`);
    return { cropX: region.cropX, cropY: region.cropY + cutTop, cropW: region.cropW, cropH: newH };
  } catch (e) {
    console.warn('[videoEditor] verificação de recorte falhou, mantendo o primeiro palpite:', e.message);
    return region;
  }
}

// O gancho lido do vídeo só serve se for mesmo uma frase editorial — descarta
// @, sobra de interface e textos curtos/longos demais pra caber no layout.
function cleanBakedHeadline(raw) {
  const text = stripEmoji(String(raw || '')).replace(/\s+/g, ' ').trim().replace(/^["“”']|["“”']$/g, '').trim();
  if (text.length < 12 || text.length > 140) return '';
  if (/^@/.test(text)) return '';
  if (!/\s/.test(text)) return '';                       // uma palavra só não é gancho
  if (/^(seguir|follow|inscreva|compartilhar|curtir)\b/i.test(text)) return '';
  return text;
}

// Recorte usado na renderização. Se o /analyze já mandou o retângulo (caminho
// normal), usa direto — a vision já rodou lá. Senão resolve aqui.
async function detectContentRegion(videoPath, vw, vh, sid) {
  const { region } = await readFramePlan(videoPath, vw, vh, sid);
  if (region) return region;
  const detected = await cropDetect(videoPath);
  return detected || { cropW: vw, cropH: vh, cropX: 0, cropY: 0 };
}

// Valida um retângulo vindo do cliente antes de deixar entrar no ffmpeg.
function sanitizeCropRegion(crop, vw, vh) {
  if (!crop || typeof crop !== 'object') return null;
  const int = v => (Number.isFinite(parseInt(v)) ? parseInt(v) : NaN);
  const cropX = int(crop.cropX), cropY = int(crop.cropY);
  const cropW = int(crop.cropW), cropH = int(crop.cropH);
  if ([cropX, cropY, cropW, cropH].some(Number.isNaN)) return null;
  if (cropX < 0 || cropY < 0 || cropW < 16 || cropH < 16) return null;
  if (cropX + cropW > vw || cropY + cropH > vh) return null;
  if ((cropW * cropH) / (vw * vh) < 0.45) return null;
  return { cropX, cropY, cropW, cropH };
}

// ── Entender o vídeo: transcrição do áudio ────────────────────────────────────
function extractAudio(videoPath, seconds, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, [
      '-t', String(seconds), '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-y', outPath,
    ]);
    const errLines = [];
    proc.stderr.on('data', d => errLines.push(d.toString()));
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('audio timeout')); }, 20000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return resolve();
      reject(new Error('sem áudio utilizável'));
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function transcribeAudio(audioPath) {
  const attempt = (client, model) => client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model,
    language: 'pt',
    response_format: 'text',
  });

  if (process.env.OPENAI_API_KEY) {
    try {
      return await attempt(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 }), 'whisper-1');
    } catch (err) {
      if (!process.env.GROQ_API_KEY) throw err;
      console.warn('[videoEditor] OpenAI whisper falhou, tentando Groq:', err.message?.slice(0, 120));
    }
  }
  if (!process.env.GROQ_API_KEY) throw new Error('Nenhuma chave de transcrição configurada');
  return attempt(
    new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1', timeout: 30000 }),
    'whisper-large-v3'
  );
}

// Descreve o vídeo pela imagem quando não há áudio aproveitável
async function describeFrame(videoPath, atSec, sid) {
  if (!process.env.OPENAI_API_KEY) return '';
  const framePath = path.join(os.tmpdir(), `${sid}_desc.jpg`);
  try {
    await extractFrame(videoPath, atSec, framePath);
    const base64 = fs.readFileSync(framePath).toString('base64');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000 });
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          { type: 'text', text: 'Descreva em português, em até 3 frases, o que está acontecendo neste frame de vídeo. Se houver texto na imagem, transcreva.' },
        ],
      }],
    });
    return res.choices[0].message.content || '';
  } catch (e) {
    console.warn('[videoEditor] descrição do frame falhou:', e.message);
    return '';
  } finally {
    try { if (fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch {}
  }
}

const WRITER_BASE = `Você escreve ganchos e legendas de Reels virais do Instagram para o perfil ${PROFILE_HANDLE}.

${PEDRO_DNA}

${LINGUAGEM_LEIGO}

Você recebe o conteúdo de um vídeo (transcrição da fala e/ou descrição da imagem).`;

const REGRAS_HEADLINE = `"headline" — o GANCHO que aparece em cima do vídeo. Regras:
- No MÁXIMO 12 palavras. Uma frase só.
- Português básico. Palavra do dia a dia. Nada de termo difícil.
- Cria curiosidade mas NUNCA entrega a resposta — quem lê precisa assistir pra descobrir.
- Fale direto com a pessoa usando "você" quando couber.
- Use número concreto se o vídeo tiver um (ex: "em 3 segundos", "90% das pessoas").
- PROIBIDO: "você não vai acreditar", "chocante", "imperdível", "olha isso", "impressionante".
- Sem emoji, sem hashtag, sem aspas.`;

const REGRAS_CAPTION = `"caption" — a legenda do post. Regras:
- Primeira linha: uma frase de impacto que puxa a pessoa pra ler o resto.
- Depois: 2 a 3 parágrafos CURTOS dando o CONTEXTO — o que é isso, por que acontece, por que importa. Explique como se estivesse contando pra um amigo. Aqui a pessoa tem que aprender algo de verdade, não pode ser texto vazio.
- Se houver uma ligação natural com negócios, comportamento ou marketing, faça em 1 parágrafo. Se não houver, não force.
- Termine com um CTA claro pedindo pra SEGUIR o perfil, escrito de forma natural (ex: "Segue ${PROFILE_HANDLE} que todo dia tem um assim por aqui"). O CTA de seguir é obrigatório.
- Pode usar emoji na legenda (com moderação, 2 a 4 no total).
- Fecha com 4 a 6 hashtags em português, relevantes ao tema.`;

// Modo 1: a IA escreve gancho e legenda
const WRITER_SYSTEM = `${WRITER_BASE} Escreva:

1. ${REGRAS_HEADLINE}
   Se a FALA do vídeo já abrir com um gancho forte, pronto e dentro dessas regras, reaproveite esse gancho (pode limpar pontuação/repetição, sem mudar o sentido) em vez de inventar um novo. Só reaproveite se ele for realmente bom pelas mesmas regras acima — na dúvida, escreva um gancho novo do zero.

2. ${REGRAS_CAPTION}

Responda APENAS JSON: {"headline":"...","caption":"..."}`;

// Modo 2: o autor já escreveu o gancho — a IA só faz a legenda, coerente com ele
const WRITER_SYSTEM_CAPTION_ONLY = `${WRITER_BASE}

O AUTOR JÁ ESCREVEU O GANCHO. Não altere, não corrija e não sugira outro gancho — ele será usado exatamente como está. Sua tarefa é escrever APENAS a legenda, coerente com esse gancho: a legenda precisa entregar o que o gancho promete.

${REGRAS_CAPTION}

Responda APENAS JSON: {"caption":"..."}`;

router.post('/analyze', async (req, res) => {
  const sid = crypto.randomUUID();
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const audioPath = path.join(os.tmpdir(), `${sid}_audio.mp3`);
  const cleanup = () => [rawVideo, audioPath].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  try {
    const { instagramUrl, headline: userHeadline } = req.body || {};
    if (!instagramUrl?.trim()) return res.status(400).json({ error: 'Cole o link do vídeo do Instagram' });

    // Gancho escrito pelo usuário é respeitado como está; vazio = a IA escreve (podendo
    // reaproveitar um gancho forte que já exista na fala do vídeo — ver WRITER_SYSTEM)
    const ownHeadline = String(userHeadline || '').trim().slice(0, 140);

    await getOrDownloadVideo(instagramUrl.trim(), rawVideo);

    const info = await getVideoInfo(rawVideo);

    // Entende o conteúdo: fala (transcrição) e, se faltar, a imagem
    let transcript = '';
    if (info.hasAudio) {
      try {
        await extractAudio(rawVideo, Math.min(30, info.duration), audioPath);
        transcript = String(await transcribeAudio(audioPath)).trim();
      } catch (e) {
        console.warn('[videoEditor] transcrição indisponível:', e.message);
      }
    }
    // Gancho manual só pode ter texto de verdade — não pode ser só emoji
    if (ownHeadline && !stripEmoji(ownHeadline).trim()) {
      throw new Error('O gancho não pode ser só emoji — adicione texto.');
    }

    // Uma leitura do frame resolve o gancho já queimado no vídeo E o recorte.
    // O recorte volta pro cliente e é repassado ao /render, que então não
    // precisa rodar visão de novo.
    const { region, bakedHeadline } = await readFramePlan(rawVideo, info.width, info.height, sid);

    const visual = transcript.length > 80
      ? ''
      : await describeFrame(rawVideo, Math.min(2, info.duration / 2), sid);

    if (!transcript && !visual && !bakedHeadline) {
      throw new Error('Não consegui entender o conteúdo desse vídeo (sem fala e sem leitura de imagem disponível).');
    }

    // Gancho que o autor original escreveu no vídeo vale como gancho pronto:
    // é uma frase editorial de verdade, não um pedaço solto da fala.
    const givenHeadline = ownHeadline || bakedHeadline;

    const ai = await llm.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.85,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: givenHeadline ? WRITER_SYSTEM_CAPTION_ONLY : WRITER_SYSTEM },
        {
          role: 'user',
          content: [
            givenHeadline ? `GANCHO (use exatamente assim):\n${givenHeadline}` : '',
            transcript ? `TRANSCRIÇÃO DA FALA DO VÍDEO:\n${transcript.slice(0, 4000)}` : '',
            visual ? `DESCRIÇÃO DA IMAGEM DO VÍDEO:\n${visual}` : '',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    }, { timeout: 25000 });

    const parsed = JSON.parse(ai.choices[0].message.content || '{}');
    const headline = givenHeadline || String(parsed.headline || '').trim();
    const caption = String(parsed.caption || '').trim();
    if (!headline || !stripEmoji(headline).trim()) {
      throw new Error('A IA não conseguiu escrever o gancho. Tente de novo.');
    }

    cleanup();
    res.json({
      headline,
      headlineFromUser: !!ownHeadline,
      headlineFromVideo: !ownHeadline && !!bakedHeadline,
      caption,
      crop: region,
      durationSec: Math.round(info.duration),
      willTrim: info.duration > MAX_CLIP_SEC,
      maxClipSec: MAX_CLIP_SEC,
    });
  } catch (e) {
    cleanup();
    console.error('[videoEditor/analyze]', e.message);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

// Monta o reel final: recorta a região de conteúdo do vídeo e encaixa no frame
// (cabeçalho + gancho). Devolve o caminho do MP4 gerado.
async function composeReel({ videoPath, headline, bgPng, output, sid, crop }) {
  const { width: vw, height: vh, hasAudio, duration } = await getVideoInfo(videoPath);
  const clipDur = Math.min(duration, MAX_CLIP_SEC).toFixed(3);

  // Recorte já resolvido no /analyze chega pronto — evita rodar visão duas vezes
  const preset = sanitizeCropRegion(crop, vw, vh);
  const { cropW, cropH, cropX, cropY } = preset || await detectContentRegion(videoPath, vw, vh, sid);
  if (preset) console.log('[videoEditor] usando recorte vindo do /analyze');
  const { videoY } = await buildFramePng(headline, bgPng);
  const videoH = H - videoY - 24;

  console.log(`[videoEditor] clip=${clipDur}s src=${vw}x${vh} crop=${cropW}x${cropH}@${cropX},${cropY} slot=${W}x${videoH}`);

  // Como encaixar o clipe no espaço disponível:
  //  - Se preencher a caixa toda (cover) descartar POUCO do conteúdo, faz isso —
  //    fica cheio, sem tarja, e a perda é irrelevante.
  //  - Se cover fosse cortar muito (clipe 9:16 numa caixa mais baixa, por ex.),
  //    encaixa o vídeo INTEIRO e preenche a sobra com uma cópia borrada dele.
  //    Cortar no centro nesse caso dava zoom absurdo, decepando rosto e a
  //    legenda queimada do clipe.
  const coverScale = Math.max(W / cropW, videoH / cropH);
  const coverLoss = 1 - (W * videoH) / (cropW * coverScale * cropH * coverScale);
  const useCover = coverLoss <= 0.18;

  console.log(`[videoEditor] encaixe=${useCover ? 'cover' : 'fit+blur'} perda=${(coverLoss * 100).toFixed(0)}%`);

  const prep = `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},` +
    `eq=contrast=1.05:saturation=1.12,setpts=PTS-STARTPTS`;

  const videoChain = useCover
    ? [
        `${prep},scale=${W}:${videoH}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${videoH}:(iw-${W})/2:(ih-${videoH})/2[vid]`,
      ]
    : (() => {
        // blur barato: reduz, borra pequeno, amplia de volta
        const blurW = Math.max(2, Math.round(W / 8 / 2) * 2);
        const blurH = Math.max(2, Math.round(videoH / 8 / 2) * 2);
        return [
          `${prep},split=2[src][blursrc]`,
          `[blursrc]scale=${blurW}:${blurH}:force_original_aspect_ratio=increase,` +
            `crop=${blurW}:${blurH},gblur=sigma=4,` +
            `scale=${W}:${videoH},eq=brightness=-0.08[blurbg]`,
          `[src]scale=${W}:${videoH}:force_original_aspect_ratio=decrease:force_divisible_by=2[fit]`,
          `[blurbg][fit]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[vid]`,
        ];
      })();

  const filterGraph = [
    `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
    ...videoChain,
    `[bg][vid]overlay=0:${videoY}:eof_action=endall[out]`,
  ].join(';');

  const outputOpts = [
    '-map [out]', '-c:v libx264', '-preset ultrafast', '-crf 28', '-r 30',
    `-t ${clipDur}`, '-pix_fmt yuv420p', '-movflags +faststart',
  ];
  if (hasAudio) {
    outputOpts.push('-map 0:a', '-c:a aac', '-b:a 128k',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  } else {
    outputOpts.push('-an');
  }

  const cmd = ffmpeg()
    .input(videoPath).inputOptions([`-t ${clipDur}`])
    .input(bgPng)
    .complexFilter(filterGraph)
    .outputOptions(outputOpts);

  await runFFmpeg(cmd, output, 45000);
  return output;
}

router.post('/render', async (req, res) => {
  const sid = crypto.randomUUID();
  const rawVideo = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const bgPng = path.join(os.tmpdir(), `${sid}_bg.png`);
  const output = path.join(os.tmpdir(), `${sid}_reel.mp4`);
  const cleanTmp = () => [rawVideo, bgPng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  const cleanOutput = () => { try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {} };

  try {
    const { instagramUrl, headline, caption, crop } = req.body || {};
    if (!instagramUrl?.trim()) return res.status(400).json({ error: 'Cole o link do vídeo do Instagram' });
    if (!String(headline || '').trim()) return res.status(400).json({ error: 'O gancho é obrigatório' });
    if (!stripEmoji(headline).trim()) return res.status(400).json({ error: 'O gancho não pode ser só emoji — adicione texto.' });

    await getOrDownloadVideo(instagramUrl.trim(), rawVideo);

    await composeReel({ videoPath: rawVideo, headline, bgPng, output, sid, crop });
    try { fs.unlinkSync(rawVideoCachePath(instagramUrl.trim())); } catch {}
    cleanTmp();

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="reel_pronto.mp4"');

    // Se o cliente cancelar (fechar aba, perder conexão) no meio do envio, o
    // arquivo temporário não pode ficar órfão em /tmp.
    res.on('close', cleanOutput);

    const stream = fs.createReadStream(output);
    stream.pipe(res);
    stream.on('end', () => { res.removeListener('close', cleanOutput); cleanOutput(); });
    stream.on('error', err => {
      console.error('[videoEditor] stream error:', err.message);
      cleanOutput();
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar o vídeo' });
    });
  } catch (e) {
    cleanTmp();
    cleanOutput();
    console.error('[videoEditor/render]', e.message);
    if (!res.headersSent) res.status(500).json({ error: safeErrorMessage(e) });
  }
});

module.exports = router;
// Exposto para inspecionar layout e composição sem depender do Instagram
module.exports._internals = {
  buildFramePng, composeReel, stripEmoji, getOrDownloadVideo, rawVideoCachePath,
  cleanBakedHeadline, sanitizeCropRegion, readFramePlan,
};
