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
const { createCompatClient } = require('../lib/llm');
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
  const maxChars = Math.max(6, Math.floor(boxW / (minFont * charRatio)));
  return { fontSize: minFont, lines: wrapText(text, maxChars), lineH: minFont * lineRatio };
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
  const videoY = Math.round(headTop + headBlockH + 34);

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
    ${verifiedBadgeSvg(NAME_X + nameW + badgeR + 14, nameY - nameSize * 0.34, badgeR)}
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

async function getOrDownloadVideo(instagramUrl, destPath) {
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

// Região visual do conteúdo: barras pretas primeiro (barato), depois vision
async function detectContentRegion(videoPath, vw, vh, sid) {
  const detected = await cropDetect(videoPath);
  if (detected) {
    const areaRatio = (detected.cropW * detected.cropH) / (vw * vh);
    if (areaRatio < 0.92) return detected;
  }
  // Groq/llama não aceita imagem — só tenta vision com OpenAI
  if (!process.env.OPENAI_API_KEY) return { cropW: vw, cropH: vh, cropX: 0, cropY: 0 };

  const framePath = path.join(os.tmpdir(), `${sid}_crop.jpg`);
  try {
    await extractFrame(videoPath, 1, framePath);
    const base64 = fs.readFileSync(framePath).toString('base64');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Analyze this video frame and return the vertical region containing the main visual content.
Return JSON: {"startPct": number, "endPct": number} (integers 0-100, measured from the TOP).
Rules:
- Ignore black bars, white/gray margins, and app chrome (status bar, navigation).
- If a social post is shown, include the FULL post (avatar + text + embedded media).
- If one video fills the screen: start=0, end=100.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Where is the main content?' },
          ],
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    const startPct = Math.max(0, Math.min(99, parseInt(parsed.startPct) || 0));
    const endPct = Math.max(1, Math.min(100, parseInt(parsed.endPct) || 100));
    return {
      cropW: vw,
      cropH: Math.max(50, Math.round(vh * (endPct - startPct) / 100)),
      cropX: 0,
      cropY: Math.max(0, Math.round(vh * startPct / 100)),
    };
  } catch (e) {
    console.warn('[videoEditor] crop vision falhou, usando frame inteiro:', e.message);
    return { cropW: vw, cropH: vh, cropX: 0, cropY: 0 };
  } finally {
    try { if (fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch {}
  }
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
      return await attempt(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), 'whisper-1');
    } catch (err) {
      if (!process.env.GROQ_API_KEY) throw err;
      console.warn('[videoEditor] OpenAI whisper falhou, tentando Groq:', err.message?.slice(0, 120));
    }
  }
  if (!process.env.GROQ_API_KEY) throw new Error('Nenhuma chave de transcrição configurada');
  return attempt(
    new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' }),
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
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

2. ${REGRAS_CAPTION}

Responda APENAS JSON: {"headline":"...","caption":"..."}`;

// Modo 2: o autor já escreveu o gancho — a IA só faz a legenda, coerente com ele
const WRITER_SYSTEM_CAPTION_ONLY = `${WRITER_BASE}

O AUTOR JÁ ESCREVEU O GANCHO. Não altere, não corrija e não sugira outro gancho — ele será usado exatamente como está. Sua tarefa é escrever APENAS a legenda, coerente com esse gancho: a legenda precisa entregar o que o gancho promete.

${REGRAS_CAPTION}

Responda APENAS JSON: {"caption":"..."}`;

// Extrai primeira frase da transcrição para usar como headline quando não houver input manual
function extractFirstSentence(text) {
  if (!text) return '';
  const match = text.match(/^([^.!?]+[.!?])/);
  if (!match) return '';
  const sentence = match[1].trim();
  // Só usa se tiver entre 10 e 120 chars (gancho nem muito curto nem muito longo)
  if (sentence.length >= 10 && sentence.length <= 120) return sentence;
  return '';
}

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

    // Gancho escrito pelo usuário é respeitado como está; vazio = tenta extrair da transcrição ou a IA escreve
    const ownHeadline = String(userHeadline || '').trim();

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
    const visual = transcript.length > 80
      ? ''
      : await describeFrame(rawVideo, Math.min(2, info.duration / 2), sid);

    if (!transcript && !visual) {
      throw new Error('Não consegui entender o conteúdo desse vídeo (sem fala e sem leitura de imagem disponível).');
    }

    // Se usuário não preencheu headline, tenta usar a primeira frase da transcrição
    let headlineFromTranscript = '';
    if (!ownHeadline && transcript) {
      headlineFromTranscript = extractFirstSentence(transcript);
    }
    const finalHeadline = ownHeadline || headlineFromTranscript;

    const ai = await llm.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.85,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: finalHeadline ? WRITER_SYSTEM_CAPTION_ONLY : WRITER_SYSTEM },
        {
          role: 'user',
          content: [
            finalHeadline ? `GANCHO (use exatamente assim):\n${finalHeadline}` : '',
            transcript ? `TRANSCRIÇÃO DA FALA DO VÍDEO:\n${transcript.slice(0, 4000)}` : '',
            visual ? `DESCRIÇÃO DA IMAGEM DO VÍDEO:\n${visual}` : '',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    });

    const parsed = JSON.parse(ai.choices[0].message.content || '{}');
    const headline = finalHeadline || String(parsed.headline || '').trim();
    const caption = String(parsed.caption || '').trim();
    if (!headline) throw new Error('A IA não conseguiu escrever o gancho. Tente de novo.');

    cleanup();
    res.json({
      headline,
      headlineFromUser: !!ownHeadline,
      headlineFromTranscript: !!headlineFromTranscript,
      caption,
      durationSec: Math.round(info.duration),
      willTrim: info.duration > MAX_CLIP_SEC,
      maxClipSec: MAX_CLIP_SEC,
    });
  } catch (e) {
    cleanup();
    console.error('[videoEditor/analyze]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Monta o reel final: recorta a região de conteúdo do vídeo e encaixa no frame
// (cabeçalho + gancho). Devolve o caminho do MP4 gerado.
async function composeReel({ videoPath, headline, bgPng, output, sid }) {
  const { width: vw, height: vh, hasAudio, duration } = await getVideoInfo(videoPath);
  const clipDur = Math.min(duration, MAX_CLIP_SEC).toFixed(3);

  const { cropW, cropH, cropX, cropY } = await detectContentRegion(videoPath, vw, vh, sid);
  const { videoY } = await buildFramePng(headline, bgPng);
  const videoH = H - videoY - 24;

  console.log(`[videoEditor] clip=${clipDur}s src=${vw}x${vh} crop=${cropW}x${cropH}@${cropX},${cropY} slot=${W}x${videoH}`);

  const filterGraph = [
    `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
    `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},` +
      `scale=${W}:${videoH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${videoH}:(iw-${W})/2:(ih-${videoH})/2,` +
      `eq=contrast=1.05:saturation=1.12,setpts=PTS-STARTPTS[vid]`,
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

  try {
    const { instagramUrl, headline, caption } = req.body || {};
    if (!instagramUrl?.trim()) return res.status(400).json({ error: 'Cole o link do vídeo do Instagram' });
    if (!String(headline || '').trim()) return res.status(400).json({ error: 'O gancho é obrigatório' });

    await getOrDownloadVideo(instagramUrl.trim(), rawVideo);

    await composeReel({ videoPath: rawVideo, headline, bgPng, output, sid });
    try { fs.unlinkSync(rawVideoCachePath(instagramUrl.trim())); } catch {}
    cleanTmp();

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="reel_pronto.mp4"');
    res.setHeader('X-Headline', encodeURIComponent(headline));
    res.setHeader('X-Caption', encodeURIComponent(caption || ''));
    res.setHeader('Access-Control-Expose-Headers', 'X-Headline, X-Caption');

    const stream = fs.createReadStream(output);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(output); } catch {} });
    stream.on('error', err => {
      console.error('[videoEditor] stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar o vídeo' });
    });
  } catch (e) {
    cleanTmp();
    try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {}
    console.error('[videoEditor/render]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
// Exposto para inspecionar layout e composição sem depender do Instagram
module.exports._internals = { buildFramePng, composeReel, stripEmoji, getOrDownloadVideo, rawVideoCachePath };
