'use strict';
const express = require('express');
const router  = express.Router();
const { createCompatClient } = require('../lib/llm');

const audioStore = new Map();

const isSandbox      = process.env.NODE_ENV !== 'production';
const SHOTSTACK_KEY  = isSandbox
  ? process.env.SHOTSTACK_SANDBOX_KEY
  : process.env.SHOTSTACK_PROD_KEY;
const SHOTSTACK_BASE = isSandbox
  ? 'https://api.shotstack.io/stage/render'
  : 'https://api.shotstack.io/v1/render';

let _llm = null;
const getLLM = () => (_llm ??= createCompatClient());

async function chamarLLM(prompt) {
  const resp = await getLLM().chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.8,
  });
  const content = resp.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM resposta inválida: ' + JSON.stringify(resp).slice(0, 300));
  }
  return JSON.parse(content);
}

// ── Agente 1 — Pesquisador ────────────────────────────────────────────────────
function promptPesquisador(tema, duracaoSeg) {
  return `Você é um pesquisador de conteúdo viral para redes sociais brasileiras.

Sua tarefa: dado um tema, encontrar os 5 ângulos mais virais e engajantes
para criar um Reel de ${duracaoSeg} segundos.

Para cada ângulo retorne:
- gancho (hook dos primeiros 3 segundos — deve parar o scroll)
- fato_principal (dado ou informação surpreendente)
- por_que_viraliza (explicação da psicologia de engajamento)

Tema: "${tema}"

Retorne APENAS JSON válido:
{
  "angulos": [
    {"gancho":"...","fato_principal":"...","por_que_viraliza":"..."}
  ],
  "melhor_angulo_index": 0
}`;
}

// ── Agente 2 — Roteirista ─────────────────────────────────────────────────────
function promptRoteirista(melhorAngulo, duracaoSeg, maxPalavras) {
  return `Você é um roteirista especialista em Reels virais de empreendedorismo,
marketing digital e vendas online para o público brasileiro.

Com base no ângulo selecionado, crie um roteiro completo para um Reel de ${duracaoSeg} segundos.

Ângulo escolhido: ${JSON.stringify(melhorAngulo)}

Regras:
- Linguagem: informal, direta, brasileira — como se estivesse falando com um amigo
- Hook nos primeiros 3 segundos: deve causar curiosidade ou choque imediato
- Sem enrolação — cada frase precisa ter um motivo pra estar ali
- CTA no final: claro e específico (ex: "Segue aqui pra mais conteúdo assim")
- Máximo ${maxPalavras} palavras no total
- NÃO use emojis — o texto vai virar áudio

Retorne APENAS JSON válido:
{
  "roteiro_completo": "texto completo da narração...",
  "blocos": [
    {"texto":"frase ou bloco","duracao_segundos":5,"broll_query":"english query for Pexels"}
  ],
  "legenda_post": "legenda completa para Instagram com hashtags",
  "titulo_reel": "título curto"
}`;
}

// ── Agente 3 — Revisor de Engajamento ────────────────────────────────────────
function promptRevisor(roteiro_completo) {
  return `Você é um especialista em engajamento de Reels no Instagram brasileiro.
Analise este roteiro e dê uma nota de 0 a 10 em cada critério.
Se qualquer nota for abaixo de 7, reescreva o trecho problemático.

Roteiro: "${roteiro_completo}"

Critérios:
1. Hook (primeiros 3s param o scroll?)
2. Retenção (o conteúdo segura até o final?)
3. CTA (o call-to-action é claro e motivador?)
4. Linguagem (soa natural, brasileiro, sem robótico?)
5. Valor (entrega algo útil ou surpreendente?)

Retorne APENAS JSON válido:
{
  "aprovado": true,
  "notas": {"hook":8,"retencao":7,"cta":9,"linguagem":8,"valor":8},
  "media": 8.0,
  "roteiro_final": "roteiro revisado e aprovado...",
  "blocos_finais": [
    {"texto":"...","duracao_segundos":5,"broll_query":"..."}
  ]
}`;
}

// ── Google Text-to-Speech ─────────────────────────────────────────────────────
async function gerarTTS(texto) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: texto },
        voice: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-B', ssmlGender: 'MALE' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1, pitch: 0.0, volumeGainDb: 2.0 },
      }),
    }
  );
  const data = await res.json();
  if (!data.audioContent) {
    throw new Error('TTS falhou: ' + JSON.stringify(data).slice(0, 200));
  }
  return data.audioContent; // base64 MP3
}

// ── Pexels Videos ─────────────────────────────────────────────────────────────
async function buscarBroll(query, duracaoSeg) {
  try {
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait`,
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    const data = await res.json();
    if (!data.videos?.length) return null;
    const vid = data.videos.find(v => v.duration >= duracaoSeg) || data.videos[0];
    const file = vid.video_files
      .filter(f => f.quality === 'hd' && f.width <= 1080)
      .sort((a, b) => b.width - a.width)[0];
    return file?.link || vid.video_files[0]?.link || null;
  } catch {
    return null;
  }
}

// ── Shotstack ─────────────────────────────────────────────────────────────────
async function submeterShotstack({ blocos, audioUrl, avatarUrl }) {
  const duracaoTotal = blocos.reduce((s, b) => s + b.duracao_segundos, 0);

  // B-roll clips (top 50%)
  const brollClips = [];
  let t = 0;
  for (const b of blocos) {
    const src = await buscarBroll(b.broll_query, b.duracao_segundos);
    if (src) {
      brollClips.push({
        asset: { type: 'video', src, volume: 0 },
        start: t,
        length: b.duracao_segundos,
        position: 'topCenter',
        scale: 0.5,
        offset: { x: 0, y: 0.25 },
      });
    }
    t += b.duracao_segundos;
  }

  // Legenda animada (bottom 50%)
  let ct = 0;
  const legendaClips = blocos.map(b => {
    const start = ct;
    ct += b.duracao_segundos;
    return {
      asset: {
        type: 'html',
        html: `<p style="font-family:Arial Black,sans-serif;font-size:38px;font-weight:900;color:#FFFFFF;text-align:center;text-shadow:2px 2px 8px rgba(0,0,0,.9);padding:0 40px;line-height:1.2">${b.texto}</p>`,
        width: 1080,
        height: 220,
        background: 'transparent',
      },
      start,
      length: b.duracao_segundos,
      position: 'bottomCenter',
      offset: { x: 0, y: 0.12 },
    };
  });

  const payload = {
    timeline: {
      background: '#000000',
      tracks: [
        { clips: legendaClips },
        { clips: [{
          asset: {
            type: 'html',
            html: '<div style="width:1080px;height:4px;background:#FF0000"></div>',
            width: 1080, height: 4, background: 'transparent',
          },
          start: 0, length: duracaoTotal, position: 'center',
        }] },
        ...(brollClips.length ? [{ clips: brollClips }] : []),
        { clips: [{
          asset: { type: 'image', src: avatarUrl },
          start: 0, length: duracaoTotal,
          position: 'bottomCenter', scale: 0.5,
          offset: { x: 0, y: -0.25 },
        }] },
        { clips: [{
          asset: { type: 'audio', src: audioUrl },
          start: 0, length: duracaoTotal,
        }] },
      ],
    },
    output: { format: 'mp4', resolution: 'hd', aspectRatio: '9:16', fps: 30 },
  };

  const res = await fetch(SHOTSTACK_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SHOTSTACK_KEY },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.response?.id) {
    throw new Error('Shotstack submit falhou: ' + JSON.stringify(data).slice(0, 300));
  }
  return data.response.id;
}

// ── Route: servir áudio temporariamente ──────────────────────────────────────
router.get('/audio/:id', (req, res) => {
  const b64 = audioStore.get(req.params.id);
  if (!b64) return res.status(404).json({ error: 'áudio não encontrado ou expirado' });
  const buf = Buffer.from(b64, 'base64');
  res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
  res.send(buf);
  // Limpar após 15 min (Shotstack já deve ter baixado)
  setTimeout(() => audioStore.delete(req.params.id), 15 * 60 * 1000);
});

// ── Route: polling do status do render ───────────────────────────────────────
router.get('/status/:renderId', async (req, res) => {
  try {
    const r = await fetch(`${SHOTSTACK_BASE}/${req.params.renderId}`, {
      headers: { 'x-api-key': SHOTSTACK_KEY },
    });
    const data = await r.json();
    res.json({ status: data.response?.status, url: data.response?.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Route: gerar vídeo completo ───────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { tema, duracao = '30s' } = req.body;
  if (!tema?.trim()) return res.status(400).json({ error: 'tema é obrigatório' });

  const duracaoSeg  = duracao === '60s' ? 60 : 30;
  const maxPalavras = duracao === '60s' ? 150 : 80;

  try {
    // Agente 1 — Pesquisador
    const pesquisa = await chamarLLM(promptPesquisador(tema, duracaoSeg));
    const melhorAngulo = pesquisa.angulos[pesquisa.melhor_angulo_index ?? 0];

    // Agente 2 — Roteirista
    const roteiro = await chamarLLM(promptRoteirista(melhorAngulo, duracaoSeg, maxPalavras));

    // Agente 3 — Revisor
    const revisao = await chamarLLM(promptRevisor(roteiro.roteiro_completo));
    const blocosFinals = revisao.blocos_finais?.length ? revisao.blocos_finais : roteiro.blocos;
    const roteiroFinal = revisao.roteiro_final || roteiro.roteiro_completo;

    // Google TTS
    const audioBase64 = await gerarTTS(roteiroFinal);

    // Guardar áudio em memória com UUID
    const audioId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    audioStore.set(audioId, audioBase64);

    const proto   = req.headers['x-forwarded-proto'] || 'https';
    const host    = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = process.env.BASE_URL || `${proto}://${host}`;

    const audioUrl  = `${baseUrl}/api/video/audio/${audioId}`;
    const avatarUrl = `${baseUrl}/pedro-avatar.jpg`;

    // Submeter render ao Shotstack (busca b-roll do Pexels internamente)
    const renderId = await submeterShotstack({ blocos: blocosFinals, audioUrl, avatarUrl });

    res.json({
      success: true,
      renderId,
      legenda: roteiro.legenda_post,
      titulo:  roteiro.titulo_reel,
      notas:   revisao.notas,
      media_engajamento: revisao.media,
    });

  } catch (e) {
    console.error('Erro geração vídeo:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
