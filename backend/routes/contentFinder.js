const express = require('express');
const multer  = require('multer');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { createCompatClient, hasLlmKey, NO_LLM_KEY_MESSAGE } = require('../lib/llm');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vault = require('../lib/vault');
const { PERSONAS: JURY_PERSONAS } = require('./headlineJury'); // 100 personas para pré-veto

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(require('ffprobe-static').path);
let _llm = null;
const getOpenAI = () => (_llm ??= createCompatClient());
const router = express.Router();

// ── Layout constants ──────────────────────────────────────────────────────────
const W         = 1080;
const H         = 1920;
const FONT_SIZE = 48;
const LINE_H    = 66;
const H_PAD     = 48;

// Família registrada via fontconfig em backend/fontSetup.js (backend/assets)
const FONT_FAMILY = "'DejaVu Sans', sans-serif";

// ── Shared helpers ────────────────────────────────────────────────────────────

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const v = meta.streams.find(s => s.codec_type === 'video');
      if (!v) return reject(new Error('No video stream'));
      resolve({
        duration: parseFloat(meta.format.duration) || 30,
        hasAudio: meta.streams.some(s => s.codec_type === 'audio'),
      });
    });
  });
}

function runFFmpeg(cmd, outputPath, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const timer = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch {} reject(new Error('FFmpeg timeout')); }, timeoutMs);
    cmd
      .on('stderr', l => lines.push(l))
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', err => {
        clearTimeout(timer);
        reject(new Error(`${err.message} || ${lines.slice(-5).join(' | ')}`));
      })
      .save(outputPath);
  });
}

async function resolveInstagramUrl(url) {
  // socialkit.dev é o caminho principal: uma chamada só devolve o link direto
  // do vídeo. As APIs de RapidAPI abaixo ficam de reserva.
  if (process.env.SOCIALKIT_API_KEY) {
    try {
      const { resolverViaSocialkit } = require('../lib/socialkit');
      const info = await resolverViaSocialkit(url);
      return info.videoUrl;
    } catch (e) {
      console.warn('[resolveIG] socialkit.dev falhou, caindo pro RapidAPI:', e.message?.slice(0, 120));
    }
  }

  const key = process.env.RAPIDAPI_KEY;
  // Primary: instagram-reels-downloader-api
  try {
    const { data } = await axios.get(
      'https://instagram-reels-downloader-api.p.rapidapi.com/download',
      {
        params: { url: url.trim() },
        headers: {
          'x-rapidapi-host': 'instagram-reels-downloader-api.p.rapidapi.com',
          'x-rapidapi-key': key,
        },
        timeout: 30000,
      }
    );
    if (data?.success && Array.isArray(data?.data?.medias)) {
      const v = data.data.medias.find(m => m.type === 'video' && m.url);
      if (v) return v.url;
    }
  } catch (e) {
    console.warn('[resolveIG] reels-downloader falhou:', e.message);
  }
  // Fallback: instagram-looter2 /post
  const { data: d2 } = await axios.get(
    'https://instagram-looter2.p.rapidapi.com/post',
    {
      params: { url: url.trim() },
      headers: {
        'x-rapidapi-host': 'instagram-looter2.p.rapidapi.com',
        'x-rapidapi-key': key,
      },
      timeout: 30000,
    }
  );
  if (d2?.video_url) return d2.video_url;
  throw new Error('Nenhum vídeo encontrado para este URL');
}

// ── Layout constants for full-frame composite ─────────────────────────────────
const PROFILE_H  = 240;
const HEADLINE_H = 320;
const VIDEO_Y    = PROFILE_H + HEADLINE_H; // 560
const VIDEO_H    = H - VIDEO_Y - 20;       // 1340

async function buildHeadlineOverlay(headline, overlayPath) {
  const lines = wrapText(headline, 28);
  const barH = Math.max(140, 36 + lines.length * LINE_H + 24);
  const textEls = lines.map((line, i) =>
    `<text x="${H_PAD}" y="${36 + (i + 1) * LINE_H}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" font-weight="bold" fill="white" stroke="black" stroke-width="1">${escXml(line)}</text>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${barH}">
    <rect width="${W}" height="${barH}" fill="black" fill-opacity="0.72"/>
    ${textEls}
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(overlayPath);
  return { barH };
}

async function buildReelFrame(templateBuf, headline, framePath) {
  const TXT_FONT_SIZE = 58;
  const TXT_LINE_H    = 84;
  const lines = wrapText(headline, 22);
  const totalTextH = lines.length * TXT_LINE_H;
  // Text centered in the headline zone (below the profile area)
  const textTopY   = PROFILE_H + (HEADLINE_H - totalTextH) / 2;
  // Headline text — drawn with a soft white halo (stroke) so it stays readable
  // on top of ANY template, even where the template has imagery/color.
  const textEls = lines.map((line, i) => {
    const y = textTopY + (i + 1) * TXT_LINE_H;
    return (
      `<text x="${W / 2}" y="${y}" font-family="${FONT_FAMILY}" font-size="${TXT_FONT_SIZE}" font-weight="bold" fill="#111111" stroke="#ffffff" stroke-width="8" paint-order="stroke" text-anchor="middle">${escXml(line)}</text>` +
      `<text x="${W / 2}" y="${y}" font-family="${FONT_FAMILY}" font-size="${TXT_FONT_SIZE}" font-weight="bold" fill="#111111" text-anchor="middle">${escXml(line)}</text>`
    );
  }).join('');

  // Base: white full frame. Template covers the top zone (profile + headline area).
  const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="white"/></svg>`;
  // Headline text is its OWN transparent layer, composited ON TOP of the template
  // so it is ALWAYS visible above the video — never hidden behind the template photo.
  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${textEls}</svg>`;

  // Resize template to VIDEO_Y height (profile + headline zone). position 'left top'
  // preserves the profile circle at the top-left corner.
  const frameBuf = await sharp(Buffer.from(baseSvg))
    .composite([
      {
        input: await sharp(templateBuf)
          .resize(W, VIDEO_Y, { fit: 'cover', position: 'left top' })
          .toBuffer(),
        top: 0, left: 0,
      },
      { input: Buffer.from(textSvg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
  await sharp(frameBuf).toFile(framePath);
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ── Agent 1 — Buscador por contas-semente ────────────────────────────────────

// Contas Instagram curadas por tema — foco em empreendedorismo, vendas e marketing digital.
// Lista expandida para cobrir a descoberta sem hashtags.
const SEED_ACCOUNTS = {
  empreendedorismo: [
    'sebrae', 'exame', 'revistapegn', 'endeavorbrasil', 'startups',
    'flavioaugustoo', 'thiago.finch', 'jorgelenilson', 'empreendedores.club',
    'g4educacao', 'portalg4', 'clubeaberto', 'mecontrata', 'jovemempreendedor',
    'empreendedorismonapratica', 'papodempe', 'sebraeoficial',
  ],
  vendas: [
    'thiago.finch', 'isaacpilhado', 'ricardoghisleni', 'jordaovendas',
    'tecnicasdevendas', 'vendamaisoficial', 'mestreasvendas', 'expertodevendas',
    'comovendermais', 'vendedor.profissional', 'treinamentodevendas',
    'lucrocomvendas', 'academiadevendas', 'vendasdigitais',
  ],
  marketing: [
    'neilpatel', 'rockcontent', 'resultadosdigitais', 'mlabs.com.br',
    'socialmediaclub', 'marketingbrasil', 'marketingdigitalbr',
    'trafegopago.br', 'gestordeads', 'copybrasil', 'agenciabrasil',
    'copywritingbr', 'marketingdeconteudo.br', 'mktdigitalbr',
  ],
  mindset: [
    'brendonburchard', 'tonyrobbinsofficial', 'jairoborzino',
    'mindsetsucesso', 'motivacaobr', 'mentalidaderica', 'danielpenin',
    'mindsetdeempreendedor', 'mentalidadedesucesso', 'pensamentomilionario',
    'motivacaodiaria.br', 'crescimentopessoalbr', 'habitosdesucesso',
  ],
  financeiro: [
    'meupoderio', 'saldopositivo', 'conteudofinanceiro', 'ynvestidor',
    'educacaofinanceiraoficial', 'guardadinheiro', 'inversa.org',
    'dinheirosabido', 'educacaofinanceirabr', 'rendaextra.br',
    'investimentosbr', 'financaspessoaisbr', 'independenciafinanceira.br',
  ],
  produtividade: [
    'aliabdaal', 'thomasfrankproject', 'habitos.io',
    'producaointeligente', 'focoempauta', 'produtividadebr',
    'gestaodetempobr', 'organizacaopessoal', 'habitos.sucesso',
    'metodosdeestudo', 'produtividade.real', 'eficienciamax',
  ],
  negocios: [
    'sebrae', 'exame', 'revistapegn', 'startups', 'endeavorbrasil',
    'g1economia', 'meiofio', 'conexaostartupio', 'abrir.empresa',
    'pequenasempresas', 'empresalucrativa', 'negociodigital.br',
    'modelodenegocio', 'franquias.br', 'empreendimentobr',
  ],
  lideranca: [
    'simonsinekbr', 'gestaodelideranca', 'liderancabr',
    'coachingelideranca', 'paulomesquita.lider', 'marcelloortega.oficial',
    'liderancaempresarial', 'gestaoequipes', 'liderdesucesso',
    'culturaorganizacional', 'rh.moderno', 'gestormoderno',
  ],
};

// Keywords de busca no TikTok por tema — nicho empreendedorismo/vendas/marketing
const TIKTOK_KEYWORDS = {
  empreendedorismo: ['empreendedorismo dicas', 'como empreender do zero', 'negócio próprio', 'empreendedor sucesso', 'abrir empresa'],
  vendas:           ['técnica de vendas', 'como vender mais', 'fechamento de vendas', 'script de vendas', 'aumentar vendas'],
  marketing:        ['marketing digital dicas', 'tráfego pago', 'estratégia instagram', 'copywriting dicas', 'funil de vendas'],
  mindset:          ['mindset empreendedor', 'mentalidade de sucesso', 'hábitos milionário', 'crescimento pessoal', 'mindset rico'],
  financeiro:       ['inteligência financeira', 'como ganhar dinheiro', 'renda extra online', 'independência financeira', 'educação financeira'],
  produtividade:    ['produtividade hacks', 'rotina de sucesso', 'gestão de tempo', 'foco e disciplina', 'hábitos produtivos'],
  negocios:         ['modelo de negócio', 'como escalar empresa', 'empresa lucrativa', 'negócio online', 'lucro empresarial'],
  lideranca:        ['liderança empresarial', 'gestão de equipes', 'líderes de sucesso', 'cultura organizacional', 'liderança dicas'],
};

const TIKTOK_HOST = 'tiktok-api23.p.rapidapi.com';
const TIKTOK_KEY  = process.env.RAPIDAPI_KEY_TIKTOK || process.env.RAPIDAPI_KEY;

// Palavras que indicam conteúdo de valor no nicho empreendedorismo/vendas/marketing
const EDUCATION_KEYWORDS = [
  'vendas', 'faturamento', 'lucro', 'cliente', 'negócio', 'empresa', 'empreendedor',
  'marketing', 'estratégia', 'resultado', 'crescimento', 'renda', 'dinheiro',
  'capital', 'investimento', 'produto', 'serviço', 'mercado', 'nicho', 'escalar',
  'conversão', 'lead', 'funil', 'tráfego', 'copy', 'oferta', 'lançamento',
  'sales', 'revenue', 'profit', 'business', 'entrepreneur', 'strategy', 'growth',
  'income', 'investment', 'product', 'conversion', 'funnel', 'traffic', 'launch',
  'branding', 'leadership', 'produtividade', 'mindset', 'mentalidade', 'hábito',
];

// Semantic spam patterns (score-based, threshold 60 = exclude)
// Nota: R$/preços removidos pois são conteúdo legítimo no nicho de empreendedorismo
const SPAM_PATTERNS = [
  { re: /marque?\s+\d+\s+amigos?/i,                        score: 40, tag: 'engajamento forçado' },
  { re: /coment[ae]\s+sim\b/i,                             score: 30, tag: 'engajamento forçado' },
  { re: /arrast[ae]?\s+(para\s+cima|pra\s+cima|p[/'`]?cima)/i, score: 20, tag: 'CTA arrasta' },
  { re: /\bwhatsapp\.com\b|\bwa\.me\b/i,                   score: 50, tag: 'WhatsApp redirect' },
  { re: /\b(sorteio|giveaway|concurso)\b/i,                score: 70, tag: 'sorteio/giveaway' },
  { re: /\bfrete\s+gr[aá]tis\b|\bentrega\s+gr[aá]tis\b/i, score: 50, tag: 'e-commerce' },
  { re: /\b(pirâmide|multinível|mlm)\b/i,                  score: 80, tag: 'pirâmide/MLM' },
];

// Conteúdo que nunca deve aparecer independente do score
const UNSAFE_PATTERNS = [
  { re: /\b(pirâmide|esquema\s+ponzi|multinível|mlm)\b/i,   reason: 'MLM/pirâmide' },
  { re: /\b(apostas?\b|bet\s*365|cassino|jogo\s+de\s+azar)\b/i, reason: 'apostas/jogo' },
  { re: /\b(pornografi|conteúdo\s+adulto|nude|sexo\s+explicit)\b/i, reason: 'conteúdo adulto' },
  { re: /\b(violência\s+explícita|gore|mutilação)\b/i,      reason: 'violência' },
];

function isVideoSafe(post) {
  const text = `${post.caption || ''} ${post.username || ''}`;
  for (const p of UNSAFE_PATTERNS) {
    if (p.re.test(text)) return { safe: false, reason: p.reason };
  }
  return { safe: true };
}

function calcSpamScore(text) {
  let score = 0;
  const tags = [];
  for (const p of SPAM_PATTERNS) {
    if (p.re.test(text)) { score += p.score; tags.push(p.tag); }
  }
  return { score: Math.min(score, 100), tags };
}

// Idade do post em horas (null se timestamp ausente/inválido)
function ageHoursOf(takenAt) {
  if (!takenAt || takenAt <= 0) return null;
  const ageH = (Date.now() / 1000 - takenAt) / 3600;
  return ageH > 0 ? ageH : null;
}

// Velocidade viral: views por hora desde a publicação (null se sem timestamp)
function velocityOf(post) {
  const ageH = ageHoursOf(post.takenAt);
  if (ageH === null || !post.views) return null;
  return Math.round(post.views / ageH);
}

function calcViralScore(post) {
  let score = 0;
  const views    = post.views    || 0;
  const likes    = post.likes    || 0;
  const comments = post.comments || 0;
  const duration = post.duration || 0;

  // ── Sinal absoluto (alcance bruto) ──────────────────────────────────────────
  if (views > 1000000)     score += 30;
  else if (views > 500000) score += 22;
  else if (views > 100000) score += 15;
  else if (views > 50000)  score += 8;

  const ratio = views > 0 ? likes / views : 0;
  if (ratio > 0.05)      score += 18;
  else if (ratio > 0.03) score += 13;
  else if (ratio > 0.01) score += 8;

  if (comments > 1000)     score += 15;
  else if (comments > 500) score += 11;
  else if (comments > 100) score += 7;

  if (duration >= 15 && duration <= 60) score += 18;
  else if (duration > 0 && duration <= 90) score += 9;

  // ── Velocidade viral (views/hora) — o sinal de "está bombando AGORA" ────────
  const vph = velocityOf(post);
  if (vph !== null) {
    if (vph > 20000)      score += 35;   // explodindo
    else if (vph > 8000)  score += 26;
    else if (vph > 3000)  score += 18;
    else if (vph > 1000)  score += 10;
    else if (vph > 300)   score += 4;
  }

  // ── Frescor — repostar coisa do momento ─────────────────────────────────────
  const ageH = ageHoursOf(post.takenAt);
  if (ageH !== null) {
    const days = ageH / 24;
    if (days <= 3)       score += 16;
    else if (days <= 7)  score += 11;
    else if (days <= 14) score += 6;
    else if (days > 90)  score -= 12;    // conteúdo velho, penaliza
    else if (days > 45)  score -= 5;
  }

  // TikTok needs higher viral signal to compensate for lower trust
  if (post.source === 'tiktok') score -= 10;

  return Math.max(0, score);
}

// Retorna motivo de exclusão ou null se aprovado
function shouldExclude(post) {
  const { score: spamScore, tags } = calcSpamScore(post.caption || '');
  if (spamScore >= 60)
    return `spam/comercial (score ${spamScore}: ${tags.join(', ')})`;

  const emojiCount = ((post.caption || '').match(/\p{Emoji_Presentation}/gu) || []).length;
  if (emojiCount > 10)
    return `excesso de emojis (${emojiCount})`;

  if (post.duration > 0 && post.duration < 10)
    return `vídeo muito curto (${post.duration.toFixed(1)}s)`;

  if (post.followers > 0 && post.followers < 1000)
    return `conta pequena (${post.followers} seguidores)`;

  if (post.is_ad)
    return 'é anúncio (is_ad)';

  return null;
}

// Heurística simples de idioma PT
function isPtContent(caption) {
  const text = caption || '';
  if (/[áéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]/.test(text)) return true;
  if (/\b(você|com|não|mas|para|que|uma|esse|essa|isso|por|como|mais|também|são|foi|era|tem|ser|fazer|ver|quando|onde)\b/i.test(text)) return true;
  return false;
}

function rapidApiError(e) {
  const msg = e.response?.data?.message || e.message;
  if (e.response?.status === 429) return new Error(`Cota mensal da API esgotada: ${msg}`);
  if (e.response?.status === 403) return new Error(`Chave não assinada nesta API (${msg})`);
  return new Error(msg);
}

const LOOTER2_HOST = 'instagram-looter2.p.rapidapi.com';
const looter2Headers = () => ({
  'x-rapidapi-host': LOOTER2_HOST,
  'x-rapidapi-key': process.env.RAPIDAPI_KEY,
});

// ── Dedup persistente (Upstash + cache em memória) ────────────────────────────
const usedVideoUrls = new Set();          // cache rápido (warm lambda)
const USED_KEY = 'used:urls';
const USED_MAX = 500;                      // guarda os 500 mais recentes

async function loadUsedSet() {
  const arr = (await vault.getJSON(USED_KEY)) || [];
  arr.forEach(u => usedVideoUrls.add(u));  // funde no cache em memória
  return usedVideoUrls;
}

async function markUsed(url) {
  if (!url) return;
  usedVideoUrls.add(url);
  if (!vault.enabled()) return;
  const arr = (await vault.getJSON(USED_KEY)) || [];
  if (!arr.includes(url)) {
    arr.push(url);
    await vault.setJSON(USED_KEY, arr.slice(-USED_MAX));
  }
}

// ── Aprendizado/descoberta de contas (persistente em Upstash) ─────────────────
// Acumula o melhor preScore já visto por conta, para enriquecer buscas futuras
// com fontes que historicamente entregam vídeos quentes. NÃO reseta no cold start.
const LEARN_KEY = 'learn:accounts';

async function loadLearned() {
  return (await vault.getJSON(LEARN_KEY)) || {};
}

async function saveLearned(map) {
  if (!vault.enabled()) return;
  // Mantém o mapa enxuto: top 100 contas por melhor score
  const trimmed = Object.fromEntries(
    Object.entries(map).sort((a, b) => (b[1].best || 0) - (a[1].best || 0)).slice(0, 100)
  );
  await vault.setJSON(LEARN_KEY, trimmed);
}

function recordIntoMap(map, username, score, source) {
  if (!username) return;
  const cur = map[username] || { best: 0, count: 0, source };
  cur.best     = Math.max(cur.best, score);
  cur.count   += 1;
  cur.source   = source;
  cur.lastSeen = Date.now();
  map[username] = cur;
}

// Top contas aprendidas de uma fonte que ainda não estão na lista atual
function topLearnedAccounts(map, source, exclude, n) {
  return Object.entries(map)
    .filter(([u, v]) => v.source === source && v.best >= 60 && !exclude.includes(u))
    .sort((a, b) => b[1].best - a[1].best)
    .slice(0, n)
    .map(([u]) => u);
}

// Hashtags do Instagram por tema — nicho empreendedorismo/vendas/marketing
const IG_HASHTAGS = {
  empreendedorismo: ['empreendedorismo', 'empreendedor', 'negocioproprio', 'empreendedorismodigital', 'comoempreender'],
  vendas:           ['vendas', 'tecnicasdevendas', 'vendedores', 'comovendermais', 'fechamentodevendas'],
  marketing:        ['marketingdigital', 'trafegopago', 'copywriting', 'marketingdeconteudo', 'estrategiadigital'],
  mindset:          ['mindset', 'mentalidadedesucesso', 'desenvolvimentopessoal', 'crescimentopessoal', 'habitosdosucesso'],
  financeiro:       ['educacaofinanceira', 'inteligenciafinanceira', 'independenciafinanceira', 'rendaextra', 'financaspessoais'],
  produtividade:    ['produtividade', 'gestaodetempo', 'habitossaudaveis', 'focoempauta', 'rotunadesucesso'],
  negocios:         ['negocios', 'negociosdigitais', 'abrirempresa', 'empreendaagora', 'empresalucrativa'],
  lideranca:        ['lideranca', 'liderancaempresarial', 'gestaoequipes', 'liderdesucesso', 'culturaorganizacional'],
};

// Busca posts de vídeo de uma conta via instagram-looter2 /profile
async function searchUserPosts(username) {
  console.log(`[A1] Buscando posts de @${username}…`);
  const { data } = await axios.get(
    `https://${LOOTER2_HOST}/profile`,
    {
      params: { username },
      headers: looter2Headers(),
      timeout: 20000,
    }
  );
  if (!data?.status) {
    throw new Error(`looter2 profile @${username}: ${data?.errorMessage || 'erro desconhecido'}`);
  }
  const edges = data?.edge_owner_to_timeline_media?.edges || [];
  const posts = [];
  for (const e of edges) {
    const n = e.node || {};
    if (!n.is_video || !n.video_url) continue;
    const captionEdges = n.edge_media_to_caption?.edges || [];
    const caption = captionEdges[0]?.node?.text || '';
    posts.push({
      code:      n.shortcode || n.id || '',
      views:     n.video_view_count || 0,
      likes:     n.edge_liked_by?.count || n.edge_media_preview_like?.count || 0,
      comments:  n.edge_media_to_comment?.count || 0,
      duration:  0,
      caption,
      videoUrl:  n.video_url,
      username:  n.owner?.username || username,
      followers: 0,
      is_ad:     false,
      takenAt:   n.taken_at_timestamp || 0,
      source:    'instagram',
    });
  }
  console.log(`[A1] @${username}: ${posts.length} vídeos encontrados`);
  return posts;
}

// Alias para compatibilidade com runSearch
const searchAccount = searchUserPosts;

// TikTok desativado (plano atual não tem acesso ao tiktok-api23)
async function searchTikTok(_keyword) {
  return [];
}

// ── Agent 2+3 — Analista Unificado (análise + fact-check + copy em 1 call) ────
async function analyzeAndGenerate(candidate) {
  const isTikTok = candidate.source === 'tiktok';
  const controversyNote = candidate.controversy_flag
    ? `\n⚠️ ATENÇÃO: ratio comentários/likes=${candidate.controversy_ratio?.toFixed(2)} (anormalmente alto — pode ser conteúdo polêmico).`
    : '';

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é agente de curadoria para um perfil de empreendedorismo, vendas e marketing digital (nicho: negócios, vendas, mindset, finanças, produtividade, liderança).

Analise o candidato e retorne JSON completo com análise, fact-check, copy e veredito:
{
  "viral_score": 0-100,
  "viral_reasons": ["reason"],
  "content_category": "empreendedorismo"|"vendas"|"marketing"|"mindset"|"financeiro"|"produtividade"|"negócios"|"liderança"|"outro",
  "fit_for_profile": 0-100,
  "ban_risk": "baixo"|"médio"|"alto",
  "ban_reasons": [],
  "copyright_risk": "baixo"|"médio"|"alto",
  "copyright_reasons": [],
  "factual_confidence": 0-100,
  "factual_flags": [],
  "misleading_caption": false,
  "headline": "máx 8 palavras — hook viral para empreendedores brasileiros, linguagem direta e impactante",
  "caption": "legenda completa para postar — abre com insight de negócios, parágrafos curtos com valor prático, termina com CTA e hashtags",
  "headline_matches_source": true,
  "headline_clickbait_risk": "baixo"|"médio"|"alto",
  "approved": true|false,
  "reject_reason": null,
  "quality_tier": "A"|"B"|"C"|"D",
  "warnings": []
}

Regras de aprovação:
- approved = true SE: viral_score >= 50 E ban_risk != "alto" E fit_for_profile >= 40 E factual_confidence >= 30 E misleading_caption = false
- Seja generoso com conteúdo de empreendedorismo, vendas, marketing digital, mindset, finanças e produtividade — esses são os nichos do perfil
- NÃO aprovar: político partidário, violento, sexual, esquemas de pirâmide/MLM, apostas, vlogs pessoais sem valor educativo
- quality_tier: A (viral_score>80 sem warnings), B (>65), C (>50), D (abaixo)
- HEADLINE (regra mais importante): SEMPRE em português do Brasil. Formatos que viralizam no nicho: pergunta provocativa ("Você ainda faz isso nas vendas?"), dado surpreendente ("Fiz R$50k em 30 dias com isso"), afirmação contraintuitiva ("Trabalhar menos pode dobrar seu faturamento"), revelação ("O segredo que os gurus não te contam"). Use linguagem simples, direta, sem jargões. Pode usar 1 emoji. Proibido: inglês, clichês vazios, exagero sem base.
- Modelos de headline: "Esse erro mata a maioria das empresas 💀", "Ninguém te conta como funciona de verdade", "Aprendi isso e triplicou meu faturamento", "Por que 90% dos empreendedores desistem?", "Essa técnica de vendas salvou meu negócio", "O que os ricos fazem diferente 🧠"`,
      },
      {
        role: 'user',
        content: `Fonte: ${isTikTok ? 'TikTok (verifique factual_confidence com cuidado)' : 'Instagram'}
Perfil: @${candidate.sourceUsername || 'desconhecido'}
Views: ${(candidate.views || 0).toLocaleString('pt-BR')}
Likes: ${(candidate.likes || 0).toLocaleString('pt-BR')}
Comentários: ${(candidate.comments || 0).toLocaleString('pt-BR')}
Caption original (até 600 chars): ${(candidate.originalCaption || '(sem caption)').slice(0, 600)}${controversyNote}`,
      },
    ],
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  if (parsed.headline) {
    parsed.headline = parsed.headline.trim().replace(/^["'""'']+|["'""'']+$/g, '');
  }
  return parsed;
}

// ── Mini-Júri (10 personas, 1 rodada, gpt-4o-mini, GATING) ───────────────────
const MINI_JURY_PERSONAS = [
  { id:  1, name: 'João',    age: 22, desc: 'Estudante universitário de TI, atenção curtíssima, passa o dedo se não entender em 2 segundos.' },
  { id: 10, name: 'Bruna',   age: 26, desc: 'Recepcionista, faz scroll compulsivo no almoço, headline precisa ser irresistível para ela parar.' },
  { id: 41, name: 'Sérgio',  age: 44, desc: 'Construtor civil, celular só à noite, gosta de curiosidades práticas e diretas.' },
  { id: 55, name: 'Luiz',    age: 42, desc: 'Gerente de TI, exigente com qualidade, detecta conteúdo raso na hora.' },
  { id: 61, name: 'Bianca',  age: 31, desc: 'Analista de dados, adora fatos e números concretos, desconfia de generalizações.' },
  { id: 72, name: 'Gustavo', age: 34, desc: 'Arquiteto cloud, entusiasta de tecnologia, engaja quando vê inovação genuína.' },
  { id: 81, name: 'Geraldo', age: 55, desc: 'Engenheiro aposentado, lê com calma, detecta inconsistência técnica facilmente.' },
  { id: 86, name: 'Lúcia',   age: 44, desc: 'Advogada, cética, pesquisa antes de compartilhar, não tolera sensacionalismo.' },
  { id: 91, name: 'Rafa',    age: 31, desc: 'Jornalista investigativo, detecta clickbait em milissegundos, denuncia conteúdo enganoso.' },
  { id: 96, name: 'Clara',   age: 25, desc: 'Doutoranda em ciências sociais, analisa retórica e manipulação, imune a sensacionalismo.' },
];

async function runMiniJury(headline, originalCaption) {
  const results = await Promise.all(
    MINI_JURY_PERSONAS.map(async (persona) => {
      try {
        const res = await getOpenAI().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é ${persona.name}, ${persona.age} anos. ${persona.desc} Está scrollando Instagram agora.`,
            },
            {
              role: 'user',
              content: `Headline: "${headline}"
Conteúdo original: "${(originalCaption || '').slice(0, 300)}"

Avalie brevemente. Retorne JSON:
{ "parou": boolean, "problema": "string descrevendo problema sério OU null se ok", "factual_issue": boolean }`,
            },
          ],
          max_tokens: 120,
          response_format: { type: 'json_object' },
          temperature: 0.8,
        });
        const r = JSON.parse(res.choices[0].message.content || '{}');
        return { persona, parou: !!r.parou, problema: r.problema || null, factual_issue: !!r.factual_issue };
      } catch {
        return { persona, parou: false, problema: null, factual_issue: false };
      }
    })
  );

  const stoppedCount    = results.filter(r => r.parou).length;
  const factualIssues   = results.filter(r => r.factual_issue && r.problema);
  const problemMessages = results.filter(r => r.problema).map(r => r.problema);

  if (factualIssues.length > 0) {
    return {
      verdict: 'BLOCK',
      reason: `${factualIssues.length} persona(s) detectaram problema factual: ${factualIssues.map(r => r.problema).join('; ')}`,
      stopped: stoppedCount,
      total: 10,
    };
  }

  if (stoppedCount < 4) {
    return {
      verdict: 'WARN',
      reason: `Apenas ${stoppedCount}/10 personas pararam — engajamento esperado baixo`,
      stopped: stoppedCount,
      total: 10,
    };
  }

  return {
    verdict: 'OK',
    reason: `${stoppedCount}/10 personas aprovaram`,
    stopped: stoppedCount,
    total: 10,
  };
}

// ── Júri de pré-veto (100 personas, 1 rodada, gpt-4o-mini) ───────────────────
// Roda no fundo sobre os vídeos do cofre, ANTES do usuário escolher.
async function askPersona(persona, headline, originalCaption) {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Você é ${persona.name}, ${persona.age} anos. ${persona.desc} Está scrollando Instagram agora.`,
      },
      {
        role: 'user',
        content: `Headline: "${headline}"
Conteúdo original: "${(originalCaption || '').slice(0, 300)}"

Responda em JSON:
{ "parou": boolean, "factual_issue": boolean, "problema": "string curta OU null" }

REGRAS:
- "parou": você pararia o dedo para assistir? (engajamento)
- "factual_issue": TRUE *apenas* se a headline faz afirmação factualmente FALSA, inventada ou claramente enganosa/sensacionalista que distorce o conteúdo original. NÃO marque true só porque achou o conteúdo chato, genérico, comum ou pouco atrativo — isso é "parou": false, não factual_issue.`,
      },
    ],
    max_tokens: 80,
    response_format: { type: 'json_object' },
    temperature: 0.8,
  });
  const r = JSON.parse(res.choices[0].message.content || '{}');
  return { parou: !!r.parou, factual_issue: !!r.factual_issue, problema: r.problema || null };
}

async function runVettingJury(headline, originalCaption) {
  // Concorrência limitada (25 por vez) para não se auto-estrangular no rate limit
  const CONCURRENCY = 25;
  const results = [];
  let errorCount = 0;
  for (let i = 0; i < JURY_PERSONAS.length; i += CONCURRENCY) {
    const batch = JURY_PERSONAS.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map(async (persona) => {
      // 1 retry rápido em caso de erro transitório (ex: 429)
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return await askPersona(persona, headline, originalCaption); }
        catch { if (attempt === 0) await new Promise(r => setTimeout(r, 400)); }
      }
      errorCount++;
      return { parou: false, factual_issue: false, problema: null, _error: true };
    }));
    results.push(...settled);
  }

  // Se muitas personas falharam, o resultado é não-confiável → aborta para re-tentar
  if (errorCount > JURY_PERSONAS.length * 0.3) {
    throw new Error(`júri instável: ${errorCount}/${JURY_PERSONAS.length} falharam (rate limit?)`);
  }

  const valid       = results.filter(r => !r._error);
  const total       = valid.length;
  const stopped     = valid.filter(r => r.parou).length;
  const factual     = valid.filter(r => r.factual_issue);
  const approvalPct = total > 0 ? Math.round((stopped / total) * 100) : 0;
  const factualPct  = total > 0 ? Math.round((factual.length / total) * 100) : 0;
  // só consideramos "problemas" os de quem realmente marcou factual_issue
  const problems    = [...new Set(factual.filter(r => r.problema).map(r => r.problema))].slice(0, 3);

  let verdict, reason;
  if (factualPct >= 30) {
    // reprovação factual exige consenso real (≥30% do júri), não algumas vozes
    verdict = 'REJECTED';
    reason  = `${factualPct}% do júri apontou problema factual/enganoso`;
  } else if (approvalPct >= 55) {
    verdict = 'APPROVED';
    reason  = `${approvalPct}% do júri pararia para assistir`;
  } else if (approvalPct >= 35) {
    verdict = 'WARN';
    reason  = `Júri dividido — ${approvalPct}% pararia`;
  } else {
    verdict = 'REJECTED';
    reason  = `Só ${approvalPct}% pararia — engajamento baixo`;
  }

  return { verdict, reason, approvalPct, factualPct, stopped, total, factualIssues: factual.length, problems };
}

// ── Main search pipeline ──────────────────────────────────────────────────────
async function runSearch({ themes = [], minViews = 50000, minEngagement = 0, lang = 'any', manualKeyword = '' }) {
  // Carrega estado persistente (dedup + aprendizado) em paralelo
  const [, learnedMap] = await Promise.all([loadUsedSet(), loadLearned()]);

  // ── A1: monta lista de contas, hashtags e keywords por tema ──────────────
  const allAccounts = themes.flatMap(t => SEED_ACCOUNTS[t] || []);
  if (allAccounts.length === 0) Object.values(SEED_ACCOUNTS).forEach(a => allAccounts.push(a[0]));
  const uniqueAccounts = [...new Set(allAccounts)];
  // Sorteia 8 contas-semente (base expandida, sem hashtags)
  let igAccounts = uniqueAccounts.sort(() => Math.random() - 0.5).slice(0, 8);

  // Descoberta 1: injeta até 2 contas aprendidas (que já entregaram vídeos quentes)
  const learnedIg = topLearnedAccounts(learnedMap, 'instagram', igAccounts, 2);
  if (learnedIg.length) {
    console.log(`[A1][aprendidas] ${learnedIg.map(u => '@' + u).join(', ')}`);
    igAccounts = [...igAccounts, ...learnedIg];
  }

  // Palavra-chave manual: injeta conta relacionada se houver
  if (manualKeyword) {
    console.log(`[A1][manual] Palavra-chave customizada: "${manualKeyword}"`);
    const kw = manualKeyword.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/gi, '');
    if (kw && !igAccounts.includes(kw)) igAccounts.push(kw);
  }

  console.log(`[A1] Contas IG: ${igAccounts.map(u => '@' + u).join(', ')}`);

  // Busca paralela: contas IG via looter2/profile
  const igPromises = igAccounts.map(async u => {
    try { return await searchAccount(u); }
    catch (e) { console.warn(`[A1][skip] @${u}: ${e.message}`); return []; }
  });

  const allResults = await Promise.allSettled([...igPromises]);

  const rawPosts = [];
  let anyOk = false;
  let firstError = null;
  for (const r of allResults) {
    if (r.status === 'fulfilled' && r.value.length > 0) { rawPosts.push(...r.value); anyOk = true; }
    else if (r.status === 'rejected' && !firstError) firstError = r.reason;
  }
  if (!anyOk && firstError) throw firstError;
  if (!anyOk) throw new Error('Nenhuma fonte retornou resultados. Tente novamente ou selecione outros temas.');
  console.log(`[A1] Total bruto: ${rawPosts.length} posts (contas IG + hashtags IG + TikTok)`);

  // ── Pré-filtros (antes do GPT-4o) ────────────────────────────────────────
  const candidates = [];
  for (const post of rawPosts) {
    // 0. Verificação de segurança do conteúdo
    const safety = isVideoSafe(post);
    if (!safety.safe) {
      console.log(`[A1][unsafe] ${post.code}: ${safety.reason}`);
      continue;
    }

    // 1. Filtros de exclusão automática
    const excl = shouldExclude(post);
    if (excl) {
      console.log(`[A1][excl] ${post.code}: ${excl}`);
      continue;
    }

    // 2. Views mínimas
    if (post.views < minViews) {
      console.log(`[A1][views] ${post.code}: ${post.views.toLocaleString()} < mín ${minViews.toLocaleString()}`);
      continue;
    }

    // 3. Engajamento mínimo
    const ratio = post.views > 0 ? post.likes / post.views : 0;
    if (ratio < minEngagement) {
      console.log(`[A1][eng] ${post.code}: ${(ratio * 100).toFixed(1)}% < mín ${(minEngagement * 100).toFixed(1)}%`);
      continue;
    }

    // 4. Filtro de idioma
    if (lang === 'pt' && !isPtContent(post.caption)) {
      console.log(`[A1][lang] ${post.code}: conteúdo não-PT ignorado`);
      continue;
    }

    // 5. Keywords educativas (boost de score)
    const capLower = (post.caption || '').toLowerCase();
    const hasEduKw = EDUCATION_KEYWORDS.some(k => capLower.includes(k));

    // 6. Score preliminar (TikTok penalty already inside calcViralScore)
    const preScore = calcViralScore(post) + (hasEduKw ? 10 : 0);
    console.log(`[A1] ${post.code}: preScore=${preScore}, edu=${hasEduKw}, views=${post.views.toLocaleString()}, eng=${(ratio * 100).toFixed(1)}%`);

    if (preScore < 40) {
      console.log(`[A1][score] ${post.code}: score ${preScore} < 40, descartado`);
      continue;
    }

    // 7. Controversy flag (comments/likes ratio unusually high)
    const controversyRatio = post.likes > 0 ? post.comments / post.likes : 0;
    const controversyFlag  = controversyRatio > 0.15;
    if (controversyFlag)
      console.log(`[A1][controversy] ${post.code}: comments/likes=${controversyRatio.toFixed(2)} — possível conteúdo polêmico`);

    const isTikTok = post.source === 'tiktok';
    const postUrl  = isTikTok
      ? `https://www.tiktok.com/@${post.username}/video/${post.code}`
      : `https://www.instagram.com/reel/${post.code}/`;

    // 8. Descoberta agressiva: conta que entregou vídeo quente entra no pool agora
    // (não só no próximo ciclo — assim buscas longas se auto-alimentam)
    if (preScore >= 55 && post.username) {
      recordIntoMap(learnedMap, post.username, preScore, post.source || 'instagram');
    }

    // 9. Dedup check
    const alreadyUsed = usedVideoUrls.has(postUrl);

    candidates.push({
      url:               postUrl,
      videoUrl:          post.videoUrl,
      thumbnail:         null,
      likes:             post.likes,
      views:             post.views,
      comments:          post.comments,
      preScore,
      originalCaption:   post.caption
        ? `Caption original: "${post.caption.slice(0, 400)}" — @${post.username}, ${post.views.toLocaleString()} views, ${post.likes.toLocaleString()} likes`
        : `Reel de @${post.username} — ${post.views.toLocaleString()} views, ${post.likes.toLocaleString()} likes`,
      sourceUsername:    post.username,
      source:            isTikTok ? 'tiktok' : 'instagram',
      controversy_flag:  controversyFlag,
      controversy_ratio: controversyRatio,
      already_used:      alreadyUsed,
      takenAt:           post.takenAt || 0,
      velocity:          velocityOf(post),
      age_hours:         ageHoursOf(post.takenAt),
    });
  }

  // Ordena por score, desduplicar por URL, limita a 30 (sem GPT nesta fase)
  candidates.sort((a, b) => b.preScore - a.preScore);
  const deduped = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 30);
  console.log(`[A1] ${deduped.length} candidatos após pré-filtro (sem GPT)`);

  if (deduped.length === 0) return [];

  // Diversificação leve: máx 6 por conta (sem GPT não temos category ainda)
  const byAcc = {};
  const final = [];

  for (const c of deduped) {
    const acc = c.sourceUsername || '';
    if ((byAcc[acc] || 0) >= 6) continue;
    byAcc[acc] = (byAcc[acc] || 0) + 1;

    // Derive a rough content_category from the theme that was searched
    // (best effort — GPT will refine this in the approve step)
    const capLower = (c.originalCaption || '').toLowerCase();
    let content_category = 'outro';
    if (/vend[ae]|fechamento|script\s+de\s+venda|prospect|cliente|proposta/.test(capLower)) content_category = 'vendas';
    else if (/marketing|tráfego|trafego|copy|funil|lead|anúncio|anuncio|instagram\s+ads|facebook\s+ads/.test(capLower)) content_category = 'marketing';
    else if (/mindset|mentalidade|hábito|habito|disciplina|foco|motivação|motivacao/.test(capLower)) content_category = 'mindset';
    else if (/financ|invest|renda|dinheiro|faturamento|lucro|capital|patrimônio/.test(capLower)) content_category = 'financeiro';
    else if (/produtividade|gestão\s+de\s+tempo|rotina|eficiência|eficiencia/.test(capLower)) content_category = 'produtividade';
    else if (/liderança|lideranca|gestão|equipe|cultura|delegação/.test(capLower)) content_category = 'liderança';
    else if (/empreende|negócio|empresa|startup|escalar|modelo\s+de\s+negócio/.test(capLower)) content_category = 'empreendedorismo';
    else if (/negócio|business|empresa|corporativo|mercado/.test(capLower)) content_category = 'negócios';

    const ageDays = c.age_hours !== null && c.age_hours !== undefined
      ? Math.round(c.age_hours / 24 * 10) / 10
      : null;

    final.push({
      index:           final.length,
      url:             c.url,
      videoUrl:        c.videoUrl,
      thumbnail:       c.thumbnail,
      likes:           c.likes,
      views:           c.views,
      comments:        c.comments,
      originalCaption: c.originalCaption,
      viral_score:     c.preScore,
      velocity:        c.velocity ?? null,
      age_days:        ageDays,
      content_category,
      source:          c.source          || 'instagram',
      sourceUsername:  c.sourceUsername  || '',
      controversy_flag:c.controversy_flag || false,
      already_used:    c.already_used    || false,
    });

    // Aprendizado: registra a performance desta conta para buscas futuras
    recordIntoMap(learnedMap, c.sourceUsername, c.preScore, c.source || 'instagram');

    if (final.length >= 30) break;
  }

  // Persiste o mapa de aprendizado atualizado (não bloqueia o retorno)
  saveLearned(learnedMap).catch(e => console.warn('[learn] save falhou:', e.message));

  console.log(`[pipeline] ${final.length} resultados finais (sem GPT) — ${Object.keys(learnedMap).length} contas no mapa de aprendizado`);
  return final;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/content-finder/search
router.post('/search', async (req, res) => {
  const { themes, minViews, minEngagement, lang, manualKeyword } = req.body;

  if (!Array.isArray(themes) || themes.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos um tema' });
  }
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  }

  try {
    const results = await runSearch({
      themes,
      minViews:      Number(minViews)      || 50000,
      minEngagement: Number(minEngagement) || 0,
      lang:          lang || 'any',
      manualKeyword: (manualKeyword || '').trim(),
    });
    res.json({ results });
  } catch (e) {
    console.error('[contentFinder] search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const ALL_THEMES = ['empreendedorismo', 'vendas', 'marketing', 'mindset', 'financeiro', 'produtividade', 'negocios', 'lideranca'];
const VAULT_KEY      = 'vault:feed';
const VAULT_META_KEY = 'vault:meta';
const VAULT_MAX      = 60;                 // máximo de itens guardados no cofre
const VAULT_TTL_MS   = 7 * 24 * 3600 * 1000; // descarta itens minerados há mais de 7 dias

// GET /api/content-finder/feed — frontend lê o cofre pré-minerado
router.get('/feed', async (req, res) => {
  if (!vault.enabled()) {
    return res.json({ results: [], meta: null, enabled: false });
  }
  try {
    const [feed, meta, used] = await Promise.all([
      vault.getJSON(VAULT_KEY).then(v => v || []),
      vault.getJSON(VAULT_META_KEY),
      loadUsedSet(),
    ]);
    // remove já-usados e reprovados pelo júri; mantém aprovados/avisos/pendentes
    const results = feed
      .filter(x => !used.has(x.url))
      .filter(x => x.vetVerdict !== 'REJECTED')
      .slice(0, 30);
    res.json({ results, meta, enabled: true });
  } catch (e) {
    console.error('[feed] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/content-finder/mine — minerador autônomo (chamado pelo Vercel Cron)
// Protegido por CRON_SECRET se configurado. Minera temas rotativos e enche o cofre.
router.get('/mine', async (req, res) => {
  // Autenticação: Vercel Cron envia "Authorization: Bearer <CRON_SECRET>"
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'não autorizado' });
    }
  }
  if (!vault.enabled()) {
    return res.status(503).json({ error: 'Cofre (Upstash) não configurado — defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN' });
  }
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada' });
  }

  try {
    // Temas rotativos: a cada janela de 6h, minera 3 temas diferentes,
    // cobrindo todos os 8 ao longo do dia.
    const bucket = Math.floor(Date.now() / (6 * 3600 * 1000));
    const start  = (bucket * 3) % ALL_THEMES.length;
    const themes = [0, 1, 2].map(i => ALL_THEMES[(start + i) % ALL_THEMES.length]);
    console.log(`[mine] ciclo bucket=${bucket}, temas: ${themes.join(', ')}`);

    const mined = await runSearch({ themes, minViews: 50000, minEngagement: 0, lang: 'any' });

    // Mescla com o cofre existente, dedup por URL, mantém o dado mais fresco
    const existing = (await vault.getJSON(VAULT_KEY)) || [];
    const map = new Map(existing.map(x => [x.url, x]));
    const now = Date.now();
    for (const r of mined) {
      map.set(r.url, { ...r, minedAt: now, themes });
    }

    const used = await loadUsedSet();
    const ranked = [...map.values()]
      .filter(x => (x.minedAt || 0) > now - VAULT_TTL_MS)   // expira itens velhos
      .filter(x => !used.has(x.url))                         // remove já usados (persistente)
      .sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0));

    // Diversidade de fontes: no máx PER_ACCOUNT por conta (evita cofre 90% @natgeo)
    const PER_ACCOUNT = 5;
    const perAcc = {};
    const merged = [];
    for (const item of ranked) {
      const acc = item.sourceUsername || '?';
      if ((perAcc[acc] || 0) >= PER_ACCOUNT) continue;
      perAcc[acc] = (perAcc[acc] || 0) + 1;
      merged.push(item);
      if (merged.length >= VAULT_MAX) break;
    }

    await vault.setJSON(VAULT_KEY, merged);
    await vault.setJSON(VAULT_META_KEY, {
      updatedAt: now,
      lastThemes: themes,
      minedThisRun: mined.length,
      vaultSize: merged.length,
      distinctAccounts: Object.keys(perAcc).length,
    });

    console.log(`[mine] +${mined.length} minerados, cofre agora com ${merged.length} vídeos`);
    res.json({ ok: true, themes, minedThisRun: mined.length, vaultSize: merged.length });
  } catch (e) {
    console.error('[mine] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const VET_BATCH = 2; // vídeos vetados por execução (cabe nos 60s do Vercel)

// GET /api/content-finder/vet — pré-veto autônomo: 100 personas analisam os
// melhores vídeos ainda não vetados do cofre. Chamado por cron a cada ~15min.
router.get('/vet', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'não autorizado' });
    }
  }
  if (!vault.enabled()) {
    return res.status(503).json({ error: 'Cofre (Upstash) não configurado' });
  }
  if (!hasLlmKey()) {
    return res.status(500).json({ error: NO_LLM_KEY_MESSAGE });
  }

  try {
    const feed = (await vault.getJSON(VAULT_KEY)) || [];
    // Pendentes: ainda não vetados, melhores (viral_score) primeiro
    const pending = feed
      .map((item, idx) => ({ item, idx }))
      .filter(x => !x.item.vetted)
      .sort((a, b) => (b.item.viral_score || 0) - (a.item.viral_score || 0))
      .slice(0, VET_BATCH);

    if (pending.length === 0) {
      return res.json({ ok: true, vetted: 0, message: 'Nada pendente — cofre todo vetado' });
    }

    const startMs = Date.now();
    let done = 0;
    for (const { item, idx } of pending) {
      if (Date.now() - startMs > 45000) break; // guarda de tempo (limite Vercel 60s)
      try {
        // 1. Gera headline/legenda + análise (se ainda não houver)
        let headline = item.headline;
        let caption  = item.caption;
        let analysis = null;
        if (!headline) {
          analysis = await analyzeAndGenerate({
            url:             item.url,
            views:           item.views,
            likes:           item.likes,
            comments:        item.comments,
            originalCaption: item.originalCaption,
            sourceUsername:  item.sourceUsername,
            source:          item.source,
            controversy_flag: item.controversy_flag,
          });
          headline = analysis.headline || 'Reel incrível';
          caption  = analysis.caption || '';
        }

        // 2. Júri de 100 personas
        const jury = await runVettingJury(headline, item.originalCaption || '');

        // 3. Grava o veredito de volta no item
        feed[idx] = {
          ...item,
          headline,
          caption,
          quality_tier:      analysis?.quality_tier || item.quality_tier || null,
          copyright_risk:    analysis?.copyright_risk || item.copyright_risk || null,
          copyright_reasons: analysis?.copyright_reasons || item.copyright_reasons || [],
          vetVerdict:        jury.verdict,
          juryApprovalPct: jury.approvalPct,
          juryReason:      jury.reason,
          juryProblems:    jury.problems,
          vetted:          true,
          vettedAt:        Date.now(),
        };
        done++;
        console.log(`[vet] ${item.url}: ${jury.verdict} (${jury.approvalPct}%)`);
      } catch (e) {
        const attempts = (item.vetAttempts || 0) + 1;
        feed[idx] = { ...item, vetAttempts: attempts, vetted: attempts >= 3 };
        console.warn(`[vet] falha (${attempts}/3) em ${item.url}: ${e.message}`);
      }
    }

    await vault.setJSON(VAULT_KEY, feed);
    const totalVetted = feed.filter(x => x.vetted).length;
    const prevMeta = (await vault.getJSON(VAULT_META_KEY)) || {};
    await vault.setJSON(VAULT_META_KEY, { ...prevMeta, vettedCount: totalVetted, lastVetAt: Date.now() });

    res.json({ ok: true, vetted: done, totalVetted, vaultSize: feed.length });
  } catch (e) {
    console.error('[vet] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content-finder/preview-video — proxy video stream (bypass CORS)
router.post('/preview-video', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl é obrigatório' });

  try {
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.instagram.com/',
      },
    });
    const contentType = response.headers['content-type'] || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    response.data.pipe(res);
    response.data.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  } catch (e) {
    console.error('[preview-video] error:', e.message);
    if (!res.headersSent) res.status(502).json({ error: 'Não foi possível carregar o vídeo' });
  }
});

// POST /api/content-finder/approve — Agent 4: edits video, streams MP4 directly
// Accepts multipart/form-data: fields (videoUrl, postUrl, headline, caption, originalCaption) + file (template)
router.post('/approve', upload.single('template'), async (req, res) => {
  let { videoUrl: directUrl, postUrl, headline, caption, originalCaption } = req.body;
  if (!directUrl && !postUrl) return res.status(400).json({ error: 'videoUrl ou postUrl é obrigatório' });

  if (!process.env.RAPIDAPI_KEY && !directUrl) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  }

  let   copyrightRisk  = req.body.copyrightRisk || null;
  let   copyrightReasons = [];
  try { if (req.body.copyrightReasons) copyrightReasons = JSON.parse(req.body.copyrightReasons); } catch {}

  const templateBuf = req.file?.buffer || null;
  const sid         = crypto.randomUUID();
  const rawVideo    = path.join(os.tmpdir(), `${sid}_raw.mp4`);
  const framePng    = path.join(os.tmpdir(), `${sid}_frame.png`);
  const output      = path.join(os.tmpdir(), `${sid}_final.mp4`);

  const cleanTmp = () => [rawVideo, framePng].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  try {
    // ── If no headline provided, run GPT analysis first ──────────────────────
    if (!headline?.trim()) {
      console.log('[approve] Sem headline — rodando analyzeAndGenerate…');
      const candidate = {
        url:             postUrl || directUrl || '',
        videoUrl:        directUrl || null,
        views:           Number(req.body.views)    || 0,
        likes:           Number(req.body.likes)    || 0,
        comments:        Number(req.body.comments) || 0,
        originalCaption: originalCaption || '',
        sourceUsername:  req.body.sourceUsername  || '',
        source:          req.body.source          || 'instagram',
        controversy_flag: false,
        controversy_ratio: 0,
      };
      try {
        const analysis = await analyzeAndGenerate(candidate);
        headline = analysis.headline || 'Reel incrível';
        if (!caption?.trim()) caption = analysis.caption || '';
        if (!copyrightRisk) copyrightRisk = analysis.copyright_risk || null;
        if (analysis.copyright_reasons?.length) copyrightReasons = analysis.copyright_reasons;
        console.log(`[approve] headline gerada: "${headline}" | copyright: ${copyrightRisk}`);
      } catch (e) {
        console.warn('[approve] analyzeAndGenerate falhou:', e.message);
        headline = 'Descubra isso agora';
      }
    }

    const downloadVideo = async () => {
      if (directUrl) {
        try { await streamDownload(directUrl, rawVideo); return; }
        catch (e) {
          console.warn('[contentFinder] URL direta falhou, resolvendo via API:', e.message);
          if (!postUrl) throw e;
        }
      }
      const resolved = await resolveInstagramUrl(postUrl);
      await streamDownload(resolved, rawVideo);
    };

    // Run video download + overlay build + mini-jury in parallel
    const [[{ hasAudio, duration }], juryResult] = await Promise.all([
      Promise.all([
        downloadVideo().then(() => getVideoInfo(rawVideo)),
        templateBuf
          ? buildReelFrame(templateBuf, headline.trim(), framePng)
          : buildHeadlineOverlay(headline.trim(), framePng),
      ]),
      runMiniJury(headline.trim(), originalCaption || ''),
    ]);

    // O vídeo SEMPRE é entregue. A verificação séria (100 agentes) já foi feita
    // no cofre ANTES da escolha. Aqui o mini-júri é apenas informativo — nunca bloqueia.
    if (juryResult.verdict !== 'OK') {
      console.log(`[miniJury] aviso (não bloqueia): ${juryResult.reason}`);
    }

    const clipDurNum = Math.min(duration, 20);
    const clipDur    = clipDurNum.toFixed(3);

    let filterGraph;
    if (templateBuf) {
      filterGraph = [
        `[0:v]scale=${W}:-2,crop=${W}:${VIDEO_H}:0:(ih-${VIDEO_H})/2,setpts=PTS-STARTPTS[vid]`,
        `[1:v]loop=loop=-1:size=1:start=0[frame]`,
        `[frame][vid]overlay=0:${VIDEO_Y}:eof_action=endall[out]`,
      ].join(';');
    } else {
      filterGraph = [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[scaled]`,
        `[1:v]loop=loop=-1:size=1:start=0[bar]`,
        `[scaled][bar]overlay=0:0:eof_action=endall[out]`,
      ].join(';');
    }

    const outputOpts = [
      '-map [out]', '-c:v libx264', '-preset ultrafast', '-crf 28',
      '-r 30', `-t ${clipDur}`, '-pix_fmt yuv420p',
    ];
    if (hasAudio) outputOpts.push('-map 0:a', '-c:a aac', '-b:a 128k');
    else outputOpts.push('-an');

    const cmd = ffmpeg()
      .input(rawVideo).inputOptions([`-t ${clipDur}`])
      .input(framePng)
      .complexFilter(filterGraph)
      .outputOptions(outputOpts);

    await runFFmpeg(cmd, output, 50000);
    cleanTmp();

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="reel_reciclado.mp4"');
    res.setHeader('X-Headline',          encodeURIComponent(headline || ''));
    res.setHeader('X-Caption',           encodeURIComponent(caption  || ''));
    res.setHeader('X-Captions-Burned',   '0');
    res.setHeader('X-Copyright-Risk',    copyrightRisk || 'desconhecido');
    if (copyrightReasons.length) res.setHeader('X-Copyright-Reasons', encodeURIComponent(copyrightReasons.join(' · ')));
    // BLOCK vira WARN (apenas aviso) — nunca impede o download
    res.setHeader('X-Mini-Jury-Verdict', juryResult.verdict === 'BLOCK' ? 'WARN' : juryResult.verdict);
    res.setHeader('X-Mini-Jury-Stopped', `${juryResult.stopped}/${juryResult.total}`);
    if (juryResult.verdict !== 'OK') {
      res.setHeader('X-Mini-Jury-Reason', encodeURIComponent(juryResult.reason));
    }

    // Marca URL como usada (dedup persistente — não reaparece em buscas futuras)
    const videoKey = postUrl || directUrl || '';
    if (videoKey) markUsed(videoKey).catch(e => console.warn('[markUsed] falhou:', e.message));

    const stream = fs.createReadStream(output);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(output); } catch {} });
    stream.on('error', err => {
      console.error('[contentFinder] stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao enviar vídeo' });
    });
  } catch (e) {
    cleanTmp();
    console.error('[contentFinder] approve error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
