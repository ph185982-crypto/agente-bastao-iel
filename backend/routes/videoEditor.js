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
const BOTTOM_GAP = 24;         // respiro embaixo do vídeo

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

// ── Onde o vídeo está passando: detecção por MOVIMENTO ────────────────────────
// O sinal mais confiável de "aqui é vídeo" não é cor nem texto: é que a imagem
// MUDA de um frame pro outro. Faixa de título, legenda do post e interface do
// app ficam paradas; só a filmagem se mexe. Comparando vários frames dá pra
// isolar exatamente a região que se move — sem depender do olho da IA.
function extractFrameSeries(videoPath, dir, seconds = 12) {
  return new Promise((resolve, reject) => {
    const pattern = path.join(dir, 'm%03d.jpg');
    const proc = spawn(ffmpegStatic, [
      '-t', String(seconds), '-i', videoPath,
      '-vf', 'fps=2,scale=160:-2', '-q:v', '4', '-y', pattern,
    ]);
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('series timeout')); }, 20000);
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`series exit ${code}`)); });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// Acha a maior faixa contínua de índices "ativos", tolerando pequenos buracos
// (uma linha isolada parada no meio da filmagem não deve quebrar a faixa).
function longestActiveRun(active, maxGap) {
  let best = null, start = -1, lastOn = -1;
  for (let i = 0; i < active.length; i++) {
    if (active[i]) {
      if (start < 0) start = i;
      lastOn = i;
    } else if (start >= 0 && i - lastOn > maxGap) {
      if (!best || lastOn - start > best.end - best.start) best = { start, end: lastOn };
      start = -1;
    }
  }
  if (start >= 0 && (!best || lastOn - start > best.end - best.start)) best = { start, end: lastOn };
  return best;
}

async function detectMotionRegion(videoPath, vw, vh, sid) {
  const dir = path.join(os.tmpdir(), `mo_${sid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    await extractFrameSeries(videoPath, dir);

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
    if (files.length < 3) return null;

    const frames = [];
    for (const f of files) {
      const { data, info } = await sharp(path.join(dir, f))
        .greyscale().raw().toBuffer({ resolveWithObject: true });
      frames.push({ data, w: info.width, h: info.height });
    }
    const { w, h } = frames[0];
    if (!w || !h || frames.some(f => f.w !== w || f.h !== h)) return null;

    // Acumula quanto cada linha e cada coluna mudam ao longo do tempo
    const rowDiff = new Float64Array(h);
    const colDiff = new Float64Array(w);
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1].data, b = frames[k].data;
      for (let y = 0; y < h; y++) {
        const off = y * w;
        for (let x = 0; x < w; x++) {
          const d = Math.abs(a[off + x] - b[off + x]);
          if (d > 8) { rowDiff[y] += d; colDiff[x] += d; }   // ignora ruído de compressão
        }
      }
    }

    // Normaliza pra "mudança média por pixel, por par de frames". Medido em
    // vídeos reais: texto e interface parados dão exatamente 0.00; filmagem
    // nunca fica abaixo de ~0.35, mesmo numa cena calma. Por isso o corte é
    // por limiar ABSOLUTO perto de zero — separa parado de filmado. Um limiar
    // relativo ao máximo (o que eu tinha antes) cortava trecho calmo de vídeo
    // normal, achando que era texto.
    const pairs = frames.length - 1;
    const ATIVO = 0.15;
    const rowNorm = Array.from(rowDiff, v => v / (w * pairs));
    const colNorm = Array.from(colDiff, v => v / (h * pairs));
    if (!rowNorm.some(v => v > ATIVO)) return null;          // vídeo totalmente parado

    // Eixo VERTICAL é o confiável: faixa de título, legenda do post e barras da
    // interface são sempre tiras horizontais — linhas inteiras paradas.
    const rowRun = longestActiveRun(rowNorm.map(v => v > ATIVO), Math.max(2, Math.round(h * 0.03)));
    if (!rowRun) return null;

    // Eixo HORIZONTAL é traiçoeiro: um vídeo pode ter uma faixa lateral parada
    // (parede, céu, fundo fixo) sem deixar de ser vídeo. Só aceita cortar a
    // lateral se ainda sobrar a maior parte da largura — aí é margem de
    // verdade, não cena parada.
    const colRun = longestActiveRun(colNorm.map(v => v > ATIVO), Math.max(4, Math.round(w * 0.08)));
    let left = 0, right = 1;
    if (colRun) {
      const cw = (colRun.end + 1 - colRun.start) / w;
      if (cw >= 0.6) { left = colRun.start / w; right = (colRun.end + 1) / w; }
      else console.log(`[videoEditor] corte lateral ignorado (só ${(cw * 100).toFixed(0)}% da largura se mexe)`);
    }

    const top = rowRun.start / h, bottom = (rowRun.end + 1) / h;

    const region = {
      cropX: Math.round(vw * left),
      cropY: Math.round(vh * top),
      cropW: Math.round(vw * (right - left)),
      cropH: Math.round(vh * (bottom - top)),
    };

    const areaRatio = (region.cropW * region.cropH) / (vw * vh);
    const shape = region.cropW / region.cropH;
    if (areaRatio < 0.08 || shape < 0.2 || shape > 5) return null;

    console.log(
      `[videoEditor] movimento: vídeo em ${(top * 100).toFixed(0)}%–${(bottom * 100).toFixed(0)}% ` +
      `da altura, ${(left * 100).toFixed(0)}%–${(right * 100).toFixed(0)}% da largura`
    );
    return region;
  } catch (e) {
    console.warn('[videoEditor] detecção por movimento falhou:', e.message);
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Resolve as duas perguntas do vídeo de origem:
//  1. onde a filmagem está passando (recorte) — pelo MOVIMENTO, que é medida
//     direta e não opinião: texto e interface ficam parados, filmagem se mexe;
//  2. o gancho que o autor já escreveu queimado no vídeo (quando existe) — aí
//     sim precisa da IA, porque é leitura de texto.
// A visão só decide o recorte se a medição por movimento não conseguir (vídeo
// praticamente estático, por exemplo).
async function readFramePlan(videoPath, vw, vh, sid) {
  const motionRegion = await detectMotionRegion(videoPath, vw, vh, sid);

  const empty = { region: motionRegion, bakedHeadline: '' };
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
          content: `You analyze one frame from a short vertical video and isolate the ACTUAL FOOTAGE — the moving picture itself — discarding every piece of text, banner and app interface around it.

Two common shapes:
(a) "Repost edit": an editorial HEADLINE typed on a solid-color band (white, black, any flat color) stacked above or below the footage.
(b) "Screen recording" of Instagram/TikTok/YouTube: someone filmed their phone screen, so the footage is a rectangle embedded in app interface.

Return JSON:
{"headline": string, "top": number, "bottom": number, "left": number, "right": number}

"headline" — the editorial headline/title text typed on a solid band in this frame, transcribed EXACTLY as written (keep wording, accents, emoji, capitalization; join wrapped lines with one space).
- Only text that reads as a written headline/title about the content.
- NOT the username/handle/@, NOT "Seguir"/"Follow", NOT like/comment counts, NOT UI labels, NOT timestamps, NOT the post's own caption at the bottom of the app.
- NOT subtitles sitting ON TOP of the footage picture.
- If there is no such headline band, return "".

"top"/"bottom"/"left"/"right" — the rectangle of the footage ONLY, as integers 0-100 percent of the frame; top/bottom from the TOP edge, left/right from the LEFT edge.

EXCLUDE, always — none of this is footage:
- Headline/caption bands: text on a FLAT solid-color rectangle with no picture visible behind it (any color, any number of lines, emoji or not).
- Phone status bar (clock, wifi, battery), and any home-indicator bar.
- App chrome of a screen recording: the "Reels"/"Para você"/tab row at the top; the account row (profile picture + @handle + "Seguir"); the right-hand action rail (heart/comment/share/save icons and their counts); the post caption and music row at the bottom; the bottom navigation bar; progress/seek bars.
- Black bars and flat solid margins.

KEEP — this IS footage:
- The moving picture rectangle itself, whole and uncut.
- Subtitles/captions burned ON TOP of that picture (you can see the scene behind or around the letters, even inside a small box hugging the text). Keep them; they belong to the footage.

The decisive test: can you see photographic/video scene behind it? Scene visible → footage. Flat color or app UI → cut.

More rules:
- The footage can be a small part of the frame (a screen recording often leaves it under half the image) — that is normal and expected. Report it truthfully; do not inflate the rectangle to cover more of the frame.
- Once you locate the footage edges, do not crop further into it — never cut off a head or face.
- If the footage genuinely fills the whole frame with no bands or UI: top 0, bottom 100, left 0, right 100.
- A frame can have a band on top AND subtitles inside the footage below — cut only the band.`,
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

    // Guarda-chuva contra alucinação. Gravação de tela do Instagram deixa o
    // vídeo em ~30% do frame (o resto é interface), então área pequena É o
    // caso normal aqui — a trava antiga em 45% descartava justamente o
    // recorte certo. Agora só barra o que é fisicamente implausível: um
    // pedaço minúsculo ou uma tira muito fina.
    const areaRatio = (region.cropW * region.cropH) / (vw * vh);
    const shape = region.cropW / region.cropH;
    if (areaRatio < 0.10 || shape < 0.25 || shape > 4) {
      console.warn(`[videoEditor] recorte implausível descartado (área ${(areaRatio * 100).toFixed(0)}%, proporção ${shape.toFixed(2)})`);
      region = null;
    }

    // Movimento é medição, visão é palpite: onde o movimento resolveu, ele manda.
    if (motionRegion) {
      console.log('[videoEditor] recorte definido pelo movimento (visão usada só pro gancho)');
      return { region: motionRegion, bakedHeadline: cleanBakedHeadline(p.headline) };
    }

    // Sem movimento utilizável: usa o palpite da visão, conferido uma segunda vez
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
          content: `This image was already cropped to keep only video footage. Check the TOP and BOTTOM edges for anything left over that is NOT footage:
- a caption/title band: text on a flat solid-color strip with no picture behind it (any color);
- app interface from a screen recording: phone status bar, "Reels"/tab row, account row (profile picture + @handle + "Seguir"), post caption row, navigation bar, progress bar;
- a flat solid margin or black bar.

Text sitting directly on top of the visible footage picture (subtitles) is fine — that is NOT leftover, leave it alone.

Return JSON: {"trimTopPct": number, "trimBottomPct": number} — percent (0-40) of THIS image's height still to shave off each edge to remove leftovers. 0 if that edge is already clean footage.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Anything left at the top or bottom that is not footage?' },
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
  const motion = await detectMotionRegion(videoPath, vw, vh, sid);
  if (motion) return motion;
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
  // mesmo critério do readFramePlan: gravação de tela deixa o vídeo pequeno
  const shape = cropW / cropH;
  if ((cropW * cropH) / (vw * vh) < 0.10 || shape < 0.25 || shape > 4) return null;
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
  const availableH = H - videoY - BOTTOM_GAP;

  // REGRA: o vídeo SEMPRE ocupa a largura inteira. Nunca tarja preta nem
  // borrada nas laterais — isso é reenquadrar, não recortar.
  //  - Cabe na altura disponível → entra inteiro, sobra branco embaixo
  //    (é o visual de post: mídia cheia no topo, respiro embaixo).
  //  - Não cabe → corta em cima/embaixo, puxando pro topo, que é onde
  //    normalmente estão rosto e começo do conteúdo.
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  const naturalH = Math.round(W * cropH / cropW);   // altura em largura cheia
  const needsVerticalCrop = naturalH > availableH;
  const videoH = even(needsVerticalCrop ? availableH : naturalH);

  console.log(
    `[videoEditor] clip=${clipDur}s src=${vw}x${vh} crop=${cropW}x${cropH}@${cropX},${cropY} ` +
    `→ ${W}x${videoH} (natural ${W}x${naturalH}, disponível ${availableH}) ` +
    `${needsVerticalCrop ? `corte vertical -${(100 - availableH / naturalH * 100).toFixed(0)}%` : 'inteiro'}`
  );

  const prep = `[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY},` +
    `eq=contrast=1.05:saturation=1.12,setpts=PTS-STARTPTS`;

  const videoChain = needsVerticalCrop
    // largura cheia e corta o excesso de altura, ancorado mais pro topo
    ? `${prep},scale=${W}:-2,crop=${W}:${videoH}:0:(ih-${videoH})*0.25[vid]`
    : `${prep},scale=${W}:${videoH}[vid]`;

  const filterGraph = [
    `[1:v]loop=loop=-1:size=1:start=0,scale=${W}:${H}[bg]`,
    videoChain,
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
  detectMotionRegion, detectContentRegion, longestActiveRun,
};
