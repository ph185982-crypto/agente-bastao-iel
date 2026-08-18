// ── Trending Topics Discovery Agent ───────────────────────────────────────────
// Descobre automaticamente assuntos em alta no Brasil via Serper.dev + GPT-4o.
// Resultados guardados no cofre (Upstash Redis) e servidos ao frontend.
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const { createCompatClient, hasLlmKey, NO_LLM_KEY_MESSAGE } = require('../lib/llm');
const vault = require('../lib/vault');

const router = express.Router();
let _llm = null;
const getOpenAI = () => (_llm ??= createCompatClient());

const TRENDING_KEY      = 'vault:trending';
const TRENDING_META_KEY = 'vault:trending:meta';
const TRENDING_MAX      = 15;
const TRENDING_TTL_MS   = 48 * 3600 * 1000;

// ── Serper web search ────────────────────────────────────────────────────────
async function fetchSerperSearch(query, num = 10) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const { data } = await axios.post('https://google.serper.dev/search',
      { q: query, num, gl: 'br', hl: 'pt-br' },
      { headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, timeout: 10000 },
    );
    return (data.organic || []).map(r => ({
      title: r.title || '',
      snippet: r.snippet || '',
      link: r.link || '',
    }));
  } catch (e) {
    console.warn('[trending] serper search failed:', e.response?.data?.message || e.message);
    return [];
  }
}

// ── GPT-4o trend analysis ────────────────────────────────────────────────────
const TREND_SYSTEM_PROMPT = `Voce e um agente de descoberta de tendencias para um perfil brasileiro de Instagram.
Analise os resultados de busca abaixo e extraia 12-15 topicos DISTINTOS em alta no Brasil AGORA.

Para cada topico, retorne:
{
  "title": "titulo curto e impactante (max 8 palavras)",
  "category": "ciencia"|"tecnologia"|"saude"|"cultura"|"curiosidade"|"esporte"|"natureza"|"viral"|"historia"|"economia",
  "description": "1 frase explicando o que esta acontecendo (max 20 palavras)",
  "whyTrending": "por que as pessoas estao falando disso agora (max 15 palavras)",
  "engagementPotential": 1-10,
  "carouselAngle": "sugestao de angulo para carrossel informativo (max 15 palavras)",
  "suggestedSlideCount": 7-10
}

Regras:
- EVITE: politica partidaria, violencia, conteudo sexual, polemicas com pessoas especificas
- PREFIRA: descobertas cientificas, eventos culturais, fenomenos virais, curiosidades, tecnologia, esportes, saude
- Topicos devem ser VISUAIS — faceis de explicar com imagens em um carrossel
- Linguagem SIMPLES — qualquer pessoa entende
- Cada topico deve ter potencial de viralizar no Instagram (publico 18-45 anos)
- NAO invente noticias — baseie-se nos resultados de busca fornecidos
- Retorne APENAS JSON: { "topics": [...] }`;

async function analyzeTrends(searchResults) {
  const combined = searchResults
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`)
    .join('\n\n');

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: 2500,
    messages: [
      { role: 'system', content: TREND_SYSTEM_PROMPT },
      { role: 'user', content: `Resultados de busca do Google Brasil (coletados agora):\n\n${combined}\n\nExtraia 12-15 topicos em alta.` },
    ],
  });

  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  return Array.isArray(parsed.topics) ? parsed.topics : [];
}

// ── GPT-4o fallback (when Serper is unavailable) ─────────────────────────────
const FALLBACK_PROMPT = `Voce e um agente de tendencias para Instagram no Brasil.
Gere 10 topicos que provavelmente estao em alta AGORA baseado no seu conhecimento de tendencias recorrentes, cultura brasileira e ciclos de noticias.

Retorne APENAS JSON: { "topics": [...] } com o mesmo formato:
title, category, description, whyTrending, engagementPotential (1-10), carouselAngle, suggestedSlideCount (7-10).

Foque em: ciencia, tecnologia, saude, curiosidades, cultura pop, esportes, natureza.
EVITE: politica, violencia, polemicas.`;

async function generateFallbackTopics() {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.9,
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    messages: [
      { role: 'system', content: FALLBACK_PROMPT },
      { role: 'user', content: 'Gere 10 topicos em alta no Brasil agora.' },
    ],
  });
  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  return (Array.isArray(parsed.topics) ? parsed.topics : []).map(t => ({ ...t, fallback: true }));
}

// ── Normalize title for dedup ────────────────────────────────────────────────
function normalizeTitle(title) {
  return String(title || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim();
}

// ── Hardcoded evergreen topics (when vault is empty) ─────────────────────────
const EVERGREEN_TOPICS = [
  { id: 'ev-ciencia', title: 'Descobertas Cientificas Recentes', category: 'ciencia', description: 'Novas descobertas que mudaram o que sabemos', whyTrending: 'Ciencia sempre gera curiosidade', engagementPotential: 8, carouselAngle: 'Top 5 descobertas que vao te surpreender', suggestedSlideCount: 7, fallback: true, discoveredAt: Date.now() },
  { id: 'ev-tech', title: 'Inteligencia Artificial no Dia a Dia', category: 'tecnologia', description: 'Como a IA ja esta mudando sua rotina', whyTrending: 'IA e o assunto do momento', engagementPotential: 9, carouselAngle: '5 formas que a IA ja muda sua vida', suggestedSlideCount: 7, fallback: true, discoveredAt: Date.now() },
  { id: 'ev-saude', title: 'Habitos que Mudam sua Saude', category: 'saude', description: 'Pequenas mudancas com grande impacto', whyTrending: 'Saude e bem-estar sempre engajam', engagementPotential: 8, carouselAngle: 'Habitos simples que mudam tudo', suggestedSlideCount: 8, fallback: true, discoveredAt: Date.now() },
  { id: 'ev-curiosidade', title: 'Fatos que Ninguem te Contou', category: 'curiosidade', description: 'Coisas surpreendentes sobre o mundo', whyTrending: 'Curiosidades viralizam naturalmente', engagementPotential: 9, carouselAngle: 'Fatos loucos que voce nunca imaginou', suggestedSlideCount: 8, fallback: true, discoveredAt: Date.now() },
  { id: 'ev-historia', title: 'Historias Incriveis do Passado', category: 'historia', description: 'Eventos historicos que parecem filme', whyTrending: 'Historia com narrativa forte viraliza', engagementPotential: 7, carouselAngle: 'Historias reais que parecem ficcao', suggestedSlideCount: 8, fallback: true, discoveredAt: Date.now() },
  { id: 'ev-natureza', title: 'Lugares Incriveis do Planeta', category: 'natureza', description: 'Paisagens e fenomenos que impressionam', whyTrending: 'Natureza gera salvamentos e compartilhamentos', engagementPotential: 8, carouselAngle: 'Lugares que voce precisa conhecer', suggestedSlideCount: 7, fallback: true, discoveredAt: Date.now() },
];

// ── Mine endpoint (cron, every 12h) ──────────────────────────────────────────
router.get('/mine', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'nao autorizado' });
    }
  }

  if (!hasLlmKey()) {
    return res.status(500).json({ error: NO_LLM_KEY_MESSAGE });
  }

  try {
    let topics = [];
    let source = 'serper+gpt4o';

    if (process.env.SERPER_API_KEY) {
      const queries = [
        'assuntos em alta hoje Brasil',
        'trending topics Brasil redes sociais hoje',
        'o que esta bombando hoje no Brasil',
      ];
      const results = await Promise.all(queries.map(q => fetchSerperSearch(q)));
      const allResults = results.flat();
      console.log(`[trending] serper returned ${allResults.length} results from ${queries.length} queries`);

      if (allResults.length > 0) {
        topics = await analyzeTrends(allResults);
      }
    }

    if (topics.length < 5) {
      console.log('[trending] serper insufficient, using GPT-4o fallback');
      topics = await generateFallbackTopics();
      source = 'gpt4o-fallback';
    }

    const now = Date.now();
    topics = topics.slice(0, TRENDING_MAX).map(t => ({
      ...t,
      id: t.id || crypto.randomUUID(),
      discoveredAt: now,
      fallback: t.fallback || false,
    }));

    if (vault.enabled()) {
      const existing = (await vault.getJSON(TRENDING_KEY)) || [];
      const existingMap = new Map(existing.map(t => [normalizeTitle(t.title), t]));

      for (const t of topics) {
        const key = normalizeTitle(t.title);
        if (existingMap.has(key)) {
          const old = existingMap.get(key);
          existingMap.set(key, { ...old, discoveredAt: now, engagementPotential: t.engagementPotential });
        } else {
          existingMap.set(key, t);
        }
      }

      const merged = [...existingMap.values()]
        .filter(t => (t.discoveredAt || 0) > now - TRENDING_TTL_MS)
        .sort((a, b) => (b.engagementPotential || 0) - (a.engagementPotential || 0))
        .slice(0, TRENDING_MAX);

      await vault.setJSON(TRENDING_KEY, merged);
      await vault.setJSON(TRENDING_META_KEY, {
        updatedAt: now,
        topicsFound: topics.length,
        vaultSize: merged.length,
        source,
      });

      console.log(`[trending] mined ${topics.length} topics, vault now has ${merged.length}`);
      res.json({ ok: true, topicsFound: topics.length, vaultSize: merged.length, source });
    } else {
      res.json({ ok: true, topicsFound: topics.length, vaultSize: 0, source, note: 'vault disabled — topics not persisted' });
    }
  } catch (e) {
    console.error('[trending] mine error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Feed endpoint (frontend reads) ───────────────────────────────────────────
router.get('/feed', async (req, res) => {
  try {
    if (!vault.enabled()) {
      return res.json({ topics: EVERGREEN_TOPICS, meta: null, enabled: false });
    }
    const [topics, meta] = await Promise.all([
      vault.getJSON(TRENDING_KEY).then(v => v || []),
      vault.getJSON(TRENDING_META_KEY),
    ]);

    if (topics.length === 0) {
      return res.json({ topics: EVERGREEN_TOPICS, meta, enabled: true });
    }

    res.json({
      topics: topics.sort((a, b) => (b.engagementPotential || 0) - (a.engagementPotential || 0)),
      meta,
      enabled: true,
    });
  } catch (e) {
    console.error('[trending] feed error:', e.message);
    res.json({ topics: EVERGREEN_TOPICS, meta: null, enabled: false });
  }
});

// ── Refresh endpoint (manual, user-triggered) ────────────────────────────────
router.post('/refresh', async (req, res) => {
  req.headers.authorization = `Bearer ${process.env.CRON_SECRET || ''}`;
  // Reuse mine logic by forwarding internally
  try {
    let topics = [];
    let source = 'serper+gpt4o';

    if (!hasLlmKey()) {
      return res.status(500).json({ error: NO_LLM_KEY_MESSAGE });
    }

    if (process.env.SERPER_API_KEY) {
      const queries = [
        'assuntos em alta hoje Brasil',
        'trending topics Brasil redes sociais hoje',
        'o que esta bombando hoje no Brasil',
      ];
      const results = await Promise.all(queries.map(q => fetchSerperSearch(q)));
      const allResults = results.flat();

      if (allResults.length > 0) {
        topics = await analyzeTrends(allResults);
      }
    }

    if (topics.length < 5) {
      topics = await generateFallbackTopics();
      source = 'gpt4o-fallback';
    }

    const now = Date.now();
    topics = topics.slice(0, TRENDING_MAX).map(t => ({
      ...t,
      id: t.id || crypto.randomUUID(),
      discoveredAt: now,
      fallback: t.fallback || false,
    }));

    if (vault.enabled()) {
      await vault.setJSON(TRENDING_KEY, topics);
      await vault.setJSON(TRENDING_META_KEY, {
        updatedAt: now,
        topicsFound: topics.length,
        vaultSize: topics.length,
        source,
      });
    }

    res.json({
      topics: topics.sort((a, b) => (b.engagementPotential || 0) - (a.engagementPotential || 0)),
      meta: { updatedAt: now, topicsFound: topics.length },
      enabled: vault.enabled(),
    });
  } catch (e) {
    console.error('[trending] refresh error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
