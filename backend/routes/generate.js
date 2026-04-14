const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/generate — generate headline + Instagram caption from extracted text
router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Texto é obrigatório' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `Você é um especialista em copy para redes sociais do perfil @pedro_destrava no Instagram.
O perfil tem tom inteligente, profundo, baseado em curiosidades e conhecimento.
O conteúdo é voltado para reciclagem de vídeos virais com novas perspectivas.
Nunca use linguagem genérica, motivacional vazia ou frases clichê.
Sempre traga um ângulo intelectual, curioso ou contraintuitivo.`,
      messages: [
        {
          role: 'user',
          content: `Com base no seguinte texto extraído de um vídeo viral, gere:

1. HEADLINE (máximo 10 palavras, impactante, que gere curiosidade intelectual)
2. LEGENDA COMPLETA (3 a 5 parágrafos, tom do @pedro_destrava: inteligente, aprofundado, com curiosidade ou fato surpreendente no início, CTA no final pedindo para salvar ou comentar)

Texto do vídeo: ${text.trim()}

Retorne apenas a headline e a legenda. Nada mais.

Formato obrigatório:
HEADLINE: [headline aqui]

LEGENDA:
[legenda aqui]`,
        },
      ],
    });

    const content = response.content[0].text;

    const headlineMatch = content.match(/HEADLINE:\s*(.+?)(?:\n|$)/i);
    const legendaMatch = content.match(/LEGENDA:\s*([\s\S]+)/i);

    const headline = headlineMatch ? headlineMatch[1].trim() : '';
    const legenda = legendaMatch ? legendaMatch[1].trim() : content;

    res.json({ headline, legenda });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message || 'Erro ao gerar conteúdo' });
  }
});

module.exports = router;
