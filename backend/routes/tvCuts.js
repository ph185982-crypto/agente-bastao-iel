// Cortes TV — transforma a gravação de um programa de TV (link Drive/YouTube/MP4)
// em reels verticais prontos para postar: transcrição Whisper, seleção de momentos
// virais por IA, corte + reenquadramento 9:16 + legendas + gancho no topo.
//
// Pipeline stateless orquestrado pelo cliente (cada etapa cabe nos 60s da Vercel):
//   POST /probe        { sourceUrl }                          → { directUrl, durationSec, width, height }
//   POST /transcribe   { sourceUrl, offsetSec, windowSec }    → { segments, words }
//   POST /find-moments { segments, durationSec }              → { moments }
//   POST /render-clip  { sourceUrl, startSec, endSec, hook, caption, words } → video/mp4 stream
// transcribe/render-clip re-resolvem sourceUrl a cada invocação (URLs do
// googlevideo são IP-locked); directUrl segue aceito como fallback.
const express = require('express');
const axios = require('axios');
const ytdl = require('@distube/ytdl-core');
const OpenAI = require('openai');
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

const llm = createCompatClient();
const router = express.Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Saída no mesmo perfil das rotas existentes (autoReel/editReel)
const W = 720;
const H = 1280;
const MAX_CLIP_SEC = 90;

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ── Transcrição (OpenAI whisper-1; fallback Groq whisper-large-v3, inclusive
//     quando a chave OpenAI está inválida) ──────────────────────────────────────
let _forceGroqWhisper = false;

async function transcribeAudio(audioPath) {
  const groqAvailable = !!process.env.GROQ_API_KEY;
  const useOpenAI = process.env.OPENAI_API_KEY && !_forceGroqWhisper;

  const attempt = (client, model) => client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model,
    language: 'pt',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
  });

  if (useOpenAI) {
    try {
      return await attempt(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), 'whisper-1');
    } catch (err) {
      if (!groqAvailable || !(err?.status === 401 || err?.status === 403)) throw err;
      console.warn('[tvCuts] OpenAI auth failed, using Groq whisper:', err.message?.slice(0, 120));
      _forceGroqWhisper = true;
    }
  }
  if (!groqAvailable) throw new Error('Nenhuma chave de transcrição válida (OPENAI_API_KEY ou GROQ_API_KEY)');
  return attempt(
    new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' }),
    'whisper-large-v3'
  );
}

// ── Resolução de links ────────────────────────────────────────────────────────

function extractDriveId(url) {
  const m = url.match(/\/file\/d\/([\w-]{20,})/) || url.match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : null;
}

async function resolveDriveUrl(sourceUrl) {
  const id = extractDriveId(sourceUrl);
  if (!id) throw new Error('Não consegui extrair o ID do arquivo do link do Google Drive');

  let direct = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

  // Valida com um GET parcial: se vier HTML, é a página de confirmação de vírus
  const check = await axios.get(direct, {
    headers: { Range: 'bytes=0-2047', 'User-Agent': UA },
    responseType: 'arraybuffer',
    maxRedirects: 5,
    timeout: 20000,
    validateStatus: s => s < 400,
  });
  const ct = String(check.headers['content-type'] || '');
  if (!ct.includes('text/html')) return direct;

  // Página de confirmação: buscar formulário completo e reconstruir a URL
  const page = await axios.get(direct, { headers: { 'User-Agent': UA }, timeout: 20000 });
  const html = typeof page.data === 'string' ? page.data : String(page.data);
  const uuid = html.match(/name="uuid"\s+value="([^"]+)"/)?.[1];
  const confirm = html.match(/name="confirm"\s+value="([^"]+)"/)?.[1] || 't';
  if (!uuid) {
    throw new Error('O Google Drive bloqueou o download direto. Confirme que o link está com acesso "Qualquer pessoa com o link".');
  }
  direct = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${confirm}&uuid=${uuid}`;
  return direct;
}

function extractYouTubeId(url) {
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/(?:shorts|embed|live|v)\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

async function ytViaRapidApi(vid) {
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY não configurada');
  const { data } = await axios.get('https://youtube-media-downloader.p.rapidapi.com/v2/video/details', {
    params: { videoId: vid },
    headers: {
      'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com',
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    },
    timeout: 20000,
  });
  const items = data?.videos?.items || [];
  // Preferir mp4 com áudio, maior resolução ≤1080
  const best = items
    .filter(v => v.url && (v.hasAudio !== false) && String(v.extension || v.mimeType || '').includes('mp4'))
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || items.find(v => v.url);
  if (!best?.url) throw new Error('sem formatos disponíveis');
  return best.url;
}

async function ytViaYtdlCore(vid) {
  const info = await ytdl.getInfo(vid, { requestOptions: { headers: { 'User-Agent': UA } } });
  const formats = (info.formats || []).filter(f =>
    f.url && f.hasAudio && f.hasVideo && String(f.mimeType || f.container || '').includes('mp4'));
  const best = formats
    .filter(f => (f.height || 0) <= 1080)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || formats[0];
  if (!best?.url) throw new Error('sem formato mp4 com áudio');
  return best.url;
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
];

async function ytViaPiped(vid) {
  let lastErr;
  for (const base of PIPED_INSTANCES) {
    try {
      const { data } = await axios.get(`${base}/streams/${vid}`, {
        timeout: 12000,
        headers: { 'User-Agent': UA },
      });
      const streams = (data?.videoStreams || []).filter(s =>
        s.url && s.videoOnly === false && String(s.mimeType || '').includes('mp4'));
      const best = streams.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))[0];
      if (best?.url) return best.url;
      lastErr = new Error(`${base}: sem formatos com áudio`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('todas as instâncias Piped falharam');
}

// Cadeia de fallbacks: RapidAPI (quando a cota permite) → ytdl-core (sem chave)
// → Piped (instâncias públicas). URLs do googlevideo são presas ao IP que as
// resolveu, por isso transcribe/render-clip re-resolvem a cada invocação.
async function resolveYouTubeUrl(sourceUrl) {
  const vid = extractYouTubeId(sourceUrl);
  if (!vid) throw new Error('Não consegui extrair o ID do vídeo do YouTube');
  const strategies = [
    ['rapidapi', ytViaRapidApi],
    ['ytdl-core', ytViaYtdlCore],
    ['piped', ytViaPiped],
  ];
  const errors = [];
  for (const [name, fn] of strategies) {
    try {
      const url = await fn(vid);
      console.log(`[tvCuts] YouTube resolvido via ${name}`);
      return url;
    } catch (e) {
      errors.push(`${name}: ${String(e.message).slice(0, 90)}`);
      console.warn(`[tvCuts] YouTube via ${name} falhou:`, String(e.message).slice(0, 140));
    }
  }
  throw new Error(`Não consegui baixar esse vídeo do YouTube agora (${errors.join(' | ')}). Alternativa garantida: suba o vídeo no Google Drive com acesso "Qualquer pessoa com o link" e cole o link aqui.`);
}

async function resolveSourceUrl(sourceUrl) {
  const url = sourceUrl.trim();
  if (/drive\.google\.com|drive\.usercontent\.google\.com/.test(url)) return resolveDriveUrl(url);
  if (/youtube\.com|youtu\.be/.test(url)) return resolveYouTubeUrl(url);
  if (/^https?:\/\//.test(url)) return url;
  throw new Error('Link inválido. Envie um link do Google Drive, YouTube ou uma URL direta de vídeo.');
}

// URLs do YouTube expiram e são IP-locked → cache curto por invocação/container
const _resolveCache = new Map();
async function resolveForRequest(body) {
  const src = String(body?.sourceUrl || '').trim();
  if (!src) return body?.directUrl;
  const hit = _resolveCache.get(src);
  if (hit && Date.now() - hit.ts < 90000) return hit.url;
  const url = await resolveSourceUrl(src);
  _resolveCache.set(src, { url, ts: Date.now() });
  if (_resolveCache.size > 20) _resolveCache.delete(_resolveCache.keys().next().value);
  return url;
}

function probeRemote(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout ao ler o vídeo (30s). Verifique o link.')), 30000);
    ffmpeg.ffprobe(url, ['-user_agent', UA], (err, meta) => {
      clearTimeout(timer);
      if (err) {
        const tail = String(err.message).split('\n').slice(-6).join(' | ');
        return reject(new Error(`Não consegui ler o vídeo: ${tail.slice(0, 600)}`));
      }
      const v = (meta.streams || []).find(s => s.codec_type === 'video');
      resolve({
        durationSec: Math.round(parseFloat(meta.format?.duration) || 0),
        width: v?.width || 1920,
        height: v?.height || 1080,
      });
    });
  });
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

router.post('/probe', async (req, res) => {
  try {
    const { sourceUrl } = req.body || {};
    if (!sourceUrl?.trim()) return res.status(400).json({ error: 'sourceUrl é obrigatório' });
    const directUrl = await resolveSourceUrl(sourceUrl);
    const info = await probeRemote(directUrl);
    if (!info.durationSec) throw new Error('Não consegui determinar a duração do vídeo');
    res.json({ directUrl, ...info });
  } catch (e) {
    console.error('[tvCuts/probe]', e.message);
    res.status(500).json({ error: e.message });
  }
});

function extractAudioWindow(directUrl, offsetSec, windowSec, outPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', String(offsetSec), '-t', String(windowSec),
      '-user_agent', UA,
      '-i', directUrl,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
      '-y', outPath,
    ];
    const proc = spawn(ffmpegStatic, args);
    const errLines = [];
    proc.stderr.on('data', d => errLines.push(d.toString()));
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      const err = new Error('window_timeout');
      err.retrySmaller = true;
      reject(err);
    }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return resolve();
      const stderr = errLines.join('');
      if (/does not contain any stream|Stream map .* matches no streams/i.test(stderr)) {
        const err = new Error('no_audio');
        err.noAudio = true;
        return reject(err);
      }
      reject(new Error(`Falha ao extrair áudio (exit ${code}): ${stderr.split('\n').filter(l => l.trim()).slice(-5).join(' | ').slice(0, 400)}`));
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

router.post('/transcribe', async (req, res) => {
  const sid = crypto.randomUUID();
  const audioPath = path.join(os.tmpdir(), `${sid}_audio.mp3`);
  try {
    const { offsetSec = 0, windowSec = 300 } = req.body || {};
    const directUrl = await resolveForRequest(req.body);
    if (!directUrl) return res.status(400).json({ error: 'sourceUrl ou directUrl é obrigatório' });
    const offset = Math.max(0, Number(offsetSec) || 0);
    const window = Math.min(180, Math.max(30, Number(windowSec) || 120));

    try {
      await extractAudioWindow(directUrl, offset, window, audioPath, 28000);
    } catch (err) {
      if (err.noAudio) return res.json({ segments: [], words: [] });
      throw err;
    }

    const tr = await transcribeAudio(audioPath);

    const segments = (tr.segments || []).map(s => ({
      start: Math.round((s.start + offset) * 100) / 100,
      end: Math.round((s.end + offset) * 100) / 100,
      text: (s.text || '').trim(),
    })).filter(s => s.text);

    const words = (tr.words || []).map(w => ({
      w: (w.word || '').trim(),
      s: Math.round((w.start + offset) * 100) / 100,
      e: Math.round((w.end + offset) * 100) / 100,
    })).filter(w => w.w);

    res.json({ segments, words });
  } catch (e) {
    console.error('[tvCuts/transcribe]', e.message);
    if (e.retrySmaller) return res.status(504).json({ error: 'window_timeout', retrySmaller: true });
    res.status(500).json({ error: e.message });
  } finally {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
  }
});

const FIND_MOMENTS_SYSTEM = `Você é um editor de cortes virais especializado em transformar programas de TV/podcasts em Reels do Instagram (estilo "cortes de podcast").

Analise a transcrição com timestamps e encontre TODOS os momentos com potencial viral. Um bom corte tem:
- Uma frase de impacto, revelação, opinião forte, história pessoal, dado surpreendente, humor ou emoção
- Início que prende em 2 segundos (entra direto no assunto, sem contexto arrastado)
- Sentido completo sozinho (quem nunca viu o programa entende)
- Duração ideal entre 20 e 75 segundos

Para CADA momento retorne:
- "startSec": segundo de início (número). Comece EXATAMENTE onde a fala forte começa, nunca no meio de uma palavra
- "endSec": segundo de fim (número). Termine numa conclusão natural da fala
- "hook": frase-gancho de NO MÁXIMO 8 palavras para aparecer no topo do vídeo. Regras: curiosity gap (nunca entrega a resposta), palavras de ativação (segredo, ninguém, erro, verdade, chocou), pode terminar com 1 emoji. Ex: "O que ele revelou chocou o estúdio 😱"
- "caption": legenda completa para o post no Instagram em português (2-3 parágrafos curtos + 4 hashtags relevantes)
- "score": potencial viral de 0 a 10 (10 = altíssimo)
- "reason": por que esse trecho viraliza (1 frase)

IMPORTANTE: seja generoso! Inclua TODOS os momentos com score >= 4. Para cada 5 minutos de transcrição deve haver pelo menos 1 corte. Prefira cortes de 30-60 segundos (não muito curtos). Se o programa for rico, retorne MUITOS cortes — 5 a 10 cortes é o ideal para um programa de 30 min.
Responda APENAS JSON válido: {"moments":[{...},{...}]}`;

function formatSegments(segs) {
  return segs.map(s =>
    `[${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')} → ${Math.floor(s.end / 60)}:${String(Math.floor(s.end % 60)).padStart(2, '0')}] (${Math.round(s.start)}s-${Math.round(s.end)}s) ${s.text}`
  ).join('\n');
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeMoments(raw) {
  return raw
    .map(m => ({
      startSec: Math.max(0, Math.round(Number(m.startSec) || 0)),
      endSec: Math.round(Number(m.endSec) || 0),
      hook: String(m.hook || '').trim(),
      caption: String(m.caption || '').trim(),
      score: Math.min(10, Math.max(0, Number(m.score) || 0)),
      reason: String(m.reason || '').trim(),
    }))
    .filter(m => m.endSec > m.startSec && m.hook)
    .map(m => ({ ...m, endSec: Math.min(m.endSec, m.startSec + MAX_CLIP_SEC) }))
    .filter(m => m.endSec - m.startSec >= 8);
}

function deduplicateMoments(moments) {
  const sorted = [...moments].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const m of sorted) {
    const overlaps = kept.some(k =>
      Math.min(k.endSec, m.endSec) - Math.max(k.startSec, m.startSec) > (m.endSec - m.startSec) * 0.5);
    if (!overlaps) kept.push(m);
  }
  return kept;
}

router.post('/find-moments', async (req, res) => {
  try {
    const { segments, durationSec } = req.body || {};
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'segments é obrigatório' });
    }

    // Chunk segments to stay within Groq free-tier TPM (12k tokens).
    // ~80 segments ≈ 6-8k tokens of transcript + system prompt fits under 12k.
    const CHUNK_SIZE = 80;
    const chunks = chunkArray(segments, CHUNK_SIZE);
    const allMoments = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const transcript = formatSegments(chunks[ci]);
      const chunkStart = Math.round(chunks[ci][0].start);
      const chunkEnd = Math.round(chunks[ci][chunks[ci].length - 1].end);

      if (ci > 0) await new Promise(r => setTimeout(r, 1500));

      console.log(`[tvCuts] find-moments chunk ${ci + 1}/${chunks.length} (${chunkStart}s-${chunkEnd}s, ${chunks[ci].length} segs)`);
      const response = await llm.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: FIND_MOMENTS_SYSTEM },
          {
            role: 'user',
            content: `Duração total do programa: ${Math.round((durationSec || 0) / 60)} min. Este trecho vai de ${chunkStart}s a ${chunkEnd}s.\n\nTRANSCRIÇÃO:\n${transcript}`,
          },
        ],
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      const chunkMoments = normalizeMoments(Array.isArray(parsed.moments) ? parsed.moments : []);
      allMoments.push(...chunkMoments);
    }

    const kept = deduplicateMoments(allMoments);
    res.json({ moments: kept });
  } catch (e) {
    console.error('[tvCuts/find-moments]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Render ────────────────────────────────────────────────────────────────────

function extractFrame(directUrl, atSec, framePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, [
      '-ss', String(atSec), '-user_agent', UA, '-i', directUrl,
      '-vframes', '1', '-q:v', '3', '-y', framePath,
    ]);
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('frame timeout')); }, 15000);
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`frame exit ${code}`)); });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// Centro horizontal do rosto de quem fala (para o crop 9:16).
// Usa GPT-4o vision quando disponível; senão tenta detecção por
// brilho/contraste no frame (heurística que favorece rostos em estúdio).
async function detectFaceCenter(directUrl, atSec, sid) {
  const framePath = path.join(os.tmpdir(), `${sid}_frame.jpg`);
  try {
    await extractFrame(directUrl, atSec, framePath);

    // Groq/llama não aceita imagem — só tenta vision se OpenAI estiver ativa
    if (process.env.OPENAI_API_KEY && !_forceGroqWhisper) {
      try {
        const base64 = fs.readFileSync(framePath).toString('base64');
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const r = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'This is a frame from a TV show. Find the main speaker (the person talking or most prominent face). Return JSON {"centerPct": n} where n (integer 0-100) is the HORIZONTAL position of that person\'s face center, measured from the left edge. If unsure, return 50.',
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
                { type: 'text', text: 'Where is the main speaker?' },
              ],
            },
          ],
          max_tokens: 40,
          response_format: { type: 'json_object' },
        });
        const parsed = JSON.parse(r.choices[0].message.content || '{}');
        const pct = parseInt(parsed.centerPct);
        if (Number.isFinite(pct)) return Math.min(100, Math.max(0, pct));
      } catch (e) {
        console.warn('[tvCuts] vision failed:', e.message?.slice(0, 100));
      }
    }

    // Fallback: análise de brilho por sharp — região mais clara costuma ser o rosto
    const { data, info } = await sharp(framePath)
      .greyscale().resize(80, null).raw().toBuffer({ resolveWithObject: true });
    const cols = info.width;
    const thirds = [0, 0, 0];
    for (let i = 0; i < data.length; i++) {
      const col = i % cols;
      if (col < cols / 3) thirds[0] += data[i];
      else if (col < 2 * cols / 3) thirds[1] += data[i];
      else thirds[2] += data[i];
    }
    const maxThird = thirds.indexOf(Math.max(...thirds));
    return [25, 50, 75][maxThird];
  } catch (e) {
    console.warn('[tvCuts] face detect failed, using center:', e.message);
    return 50;
  } finally {
    try { if (fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch {}
  }
}

async function buildHookPng(hook, outPath) {
  const lines = wrapText(hook, 20).slice(0, 3);
  const fontSize = 48;
  const lineH = 62;
  const padY = 30;
  const boxH = padY * 2 + lines.length * lineH;
  const boxY = 84;
  const fontFamily = "'DejaVu Sans', sans-serif";

  const textEls = lines.map((line, i) => {
    const y = boxY + padY + (i + 1) * lineH - 16;
    return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" fill="#FFFFFF">${escXml(line)}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="hookGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(8,8,14,0.92)"/>
        <stop offset="1" stop-color="rgba(8,8,14,0.70)"/>
      </linearGradient>
    </defs>
    <rect x="22" y="${boxY + 4}" width="${W - 44}" height="${boxH}" rx="20" fill="rgba(0,0,0,0.45)"/>
    <rect x="24" y="${boxY}" width="${W - 48}" height="${boxH}" rx="20" fill="url(#hookGrad)" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
    ${textEls}
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

// Agrupa palavras em blocos de legenda (2-3 palavras, estilo viral)
function groupCaptionChunks(words, clipStart, clipDur) {
  const chunks = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      text: cur.map(w => w.w).join(' ').toUpperCase(),
      start: Math.max(0, cur[0].s - clipStart),
      end: Math.min(clipDur, cur[cur.length - 1].e - clipStart + 0.15),
    });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const joined = cur.map(x => x.w).join(' ');
    if (cur.length >= 3 || joined.length >= 16) flush();
  }
  flush();
  // Limita a 70 blocos para manter o comando ffmpeg dentro do razoável
  if (chunks.length > 70) {
    const merged = [];
    for (let i = 0; i < chunks.length; i += 2) {
      const a = chunks[i], b = chunks[i + 1];
      merged.push(b ? { text: `${a.text} ${b.text}`, start: a.start, end: b.end } : a);
    }
    return merged.slice(0, 70);
  }
  return chunks.filter(c => c.end > c.start);
}

async function buildCaptionPng(text, outPath) {
  const lines = wrapText(text, 14).slice(0, 2);
  const fontSize = 62;
  const lineH = 76;
  const fontFamily = "'DejaVu Sans', sans-serif";
  const totalH = 190;
  const baseY = totalH / 2 - ((lines.length - 1) * lineH) / 2 + fontSize / 3;

  // Palavra mais longa do bloco em amarelo (estilo CapCut/Opus Clip)
  const highlight = String(text).split(' ').reduce((a, b) => (b.length > a.length ? b : a), '');

  const textEls = lines.map((line, i) => {
    const y = baseY + i * lineH;
    const parts = line.split(' ');
    const tspans = parts.map((w, j) => {
      const fill = w === highlight ? '#FFE14D' : '#FFFFFF';
      const chunk = j < parts.length - 1 ? `${w} ` : w;
      return `<tspan fill="${fill}">${escXml(chunk)}</tspan>`;
    }).join('');
    return `<text x="${W / 2}" y="${y}" xml:space="preserve" text-anchor="middle" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" stroke="#000000" stroke-width="13" paint-order="stroke" stroke-linejoin="round">${tspans}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}">${textEls}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

function runFFmpeg(cmd, outputPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const stderrLines = [];
    const timer = setTimeout(() => {
      try { cmd.kill('SIGKILL'); } catch {}
      reject(new Error(`FFmpeg timeout (${Math.round(timeoutMs / 1000)}s). Últimas linhas:\n${stderrLines.slice(-8).join('\n')}`));
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

router.post('/render-clip', async (req, res) => {
  const sid = crypto.randomUUID();
  const tmpFiles = [];
  const output = path.join(os.tmpdir(), `${sid}_reel.mp4`);
  try {
    const { startSec, endSec, hook, caption, words = [], srcWidth, srcHeight, showHook = true, showCaptions = true } = req.body || {};
    const directUrl = await resolveForRequest(req.body);
    if (!directUrl || startSec == null || endSec == null) {
      return res.status(400).json({ error: 'sourceUrl/directUrl, startSec e endSec são obrigatórios' });
    }
    const start = Math.max(0, Number(startSec));
    const dur = Math.min(MAX_CLIP_SEC, Number(endSec) - start);
    if (!(dur > 3)) return res.status(400).json({ error: 'Trecho inválido' });

    const vw = Number(srcWidth) || 1920;
    const vh = Number(srcHeight) || 1080;

    // 1. Vision/heurística: onde está o rosto de quem fala
    const centerPct = await detectFaceCenter(directUrl, start + dur / 2, sid);

    // Composição 9:16: fundo desfocado (blur do próprio vídeo) + vídeo
    // centralizado no rosto por cima. Estilo profissional de cortes de podcast.
    const srcAR = vw / vh;
    const outAR = W / H; // 9/16 = 0.5625
    // Se fonte é mais larga que 9:16 (widescreen), crop centrado no rosto
    const idealCropW = 2 * Math.round(vh * 9 / 32);
    const canCropClean = idealCropW <= vw && srcAR > 1.0;

    // 2. Overlays condicionais: gancho + legendas
    let hookPng = null;
    if (showHook && hook) {
      hookPng = path.join(os.tmpdir(), `${sid}_hook.png`);
      tmpFiles.push(hookPng);
      await buildHookPng(hook, hookPng);
    }

    const chunks = [];
    if (showCaptions) {
      const clipWords = words
        .filter(w => w && w.w && Number.isFinite(Number(w.s)) && Number(w.s) >= start - 0.5 && Number(w.s) <= start + dur)
        .map(w => ({ w: String(w.w), s: Number(w.s), e: Number(w.e) || Number(w.s) + 0.4 }));
      chunks.push(...groupCaptionChunks(clipWords, start, dur));
      for (let i = 0; i < chunks.length; i++) {
        const p = path.join(os.tmpdir(), `${sid}_cap${i}.png`);
        tmpFiles.push(p);
        await buildCaptionPng(chunks[i].text, p);
        chunks[i].png = p;
      }
    }

    // 3. ffmpeg: corte remoto (input-seek) + composição 9:16 + overlays
    const cmd = ffmpeg()
      .input(directUrl)
      .inputOptions(['-ss', String(start), '-t', dur.toFixed(2), '-user_agent', UA]);
    if (hookPng) cmd.input(hookPng);
    chunks.forEach(c => cmd.input(c.png));

    const fadeOutStart = Math.max(0, dur - 0.35).toFixed(2);

    const filters = [];
    if (canCropClean) {
      // Widescreen: crop 9:16 centrado no rosto + escala
      const cropW = Math.min(vw, idealCropW);
      const cropX = Math.min(vw - cropW, Math.max(0, Math.round(vw * centerPct / 100 - cropW / 2)));
      filters.push(
        `[0:v]crop=${cropW}:${vh}:${cropX}:0,scale=${W}:${H},setpts=PTS-STARTPTS,` +
          `eq=contrast=1.06:saturation=1.15,unsharp=5:5:0.4,` +
          `fade=t=in:d=0.3,fade=t=out:st=${fadeOutStart}:d=0.3[v0]`
      );
    } else {
      // Fonte estreita/quadrada: fundo blur + vídeo centralizado por cima
      filters.push(
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=25,setpts=PTS-STARTPTS[bg]`,
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,setpts=PTS-STARTPTS[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,` +
          `eq=contrast=1.06:saturation=1.15,unsharp=5:5:0.4,` +
          `fade=t=in:d=0.3,fade=t=out:st=${fadeOutStart}:d=0.3[v0]`
      );
    }

    // Overlay hook (se ativado)
    let last = 'v0';
    let inputIdx = 1;
    if (hookPng) {
      filters.push(`[${last}][${inputIdx}:v]overlay=0:0[v_hook]`);
      last = 'v_hook';
      inputIdx++;
    }

    // Overlay legendas (se ativadas)
    chunks.forEach((c, i) => {
      const next = `v_cap${i}`;
      filters.push(`[${last}][${inputIdx + i}:v]overlay=0:${H - 420}:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[${next}]`);
      last = next;
    });

    // Áudio: normalização broadcast (loudnorm) + fades
    const audioChain = `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.25,afade=t=out:st=${fadeOutStart}:d=0.3`;

    cmd.complexFilter(filters.join(';'))
      .outputOptions([
        `-map [${last}]`, '-map 0:a?',
        '-c:v libx264', '-preset ultrafast', '-crf 27', '-r 30', '-pix_fmt yuv420p',
        '-c:a aac', '-b:a 128k', '-af', audioChain,
        '-movflags +faststart',
      ]);

    console.log(`[tvCuts] render start=${start}s dur=${dur.toFixed(1)}s crop=${cropW}x${vh}@${cropX} captions=${chunks.length}`);
    await runFFmpeg(cmd, output, 45000);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="corte_reel.mp4"');
    res.setHeader('X-Headline', encodeURIComponent(hook));
    res.setHeader('X-Caption', encodeURIComponent(caption || ''));
    res.setHeader('Access-Control-Expose-Headers', 'X-Headline, X-Caption');

    const stream = fs.createReadStream(output);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(output); } catch {} });
    stream.on('error', err => {
      console.error('[tvCuts] stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar vídeo' });
    });
  } catch (e) {
    console.error('[tvCuts/render-clip]', e.message);
    try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {}
    if (!res.headersSent) res.status(500).json({ error: e.message });
  } finally {
    tmpFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
  }
});

module.exports = router;
