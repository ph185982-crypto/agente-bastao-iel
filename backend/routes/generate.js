const express = require('express');
const OpenAI = require('openai');

const router = express.Router();

const SYSTEM_PROMPT = `Você é um especialista em copy para redes sociais do perfil @pedro_destrava no Instagram.
IMPORTANTE: Responda SEMPRE em português do Brasil — headline e legenda devem estar 100% em português, sem palavras em inglês.
O perfil tem tom inteligente, profundo, baseado em curiosidades e conhecimento.
O conteúdo é voltado para reciclagem de vídeos virais com novas perspectivas.
Nunca use linguagem genérica, motivacional vazia ou frases clichê.
Sempre traga um ângulo intelectual, curioso ou contraintuitivo.`;

// POST /api/generate — generate headline + Instagram caption using GPT-4o
router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text?.trim()) return res.status(400).json({ error: 'Texto é obrigatório' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor' });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Com base no seguinte texto extraído de um vídeo viral, gere:

1. HEADLINE (em português, máximo 12 palavras, use um dos formatos de alta retenção abaixo — escolha o que melhor encaixa no conteúdo):
   • "Por que [fato contraintuitivo]?"
   • "O que ninguém te contou sobre [tema]"
   • "A razão pela qual [crença comum] está errada"
   • "[Número] coisas que [grupo] nunca vai te dizer"
   • "Como [resultado surpreendente] acontece sem você perceber"
   • "O erro que [grupo] comete ao pensar em [tema]"
   • "[Afirmação chocante ou fato pouco conhecido]"
   Regras: 100% em português, sem clichês motivacionais, crie gap de curiosidade que force o clique e gere seguidores.
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

    const content = response.choices[0].message.content;

    const headlineMatch = content.match(/HEADLINE:\s*(.+?)(?:\n|$)/i);
    const legendaMatch = content.match(/LEGENDA:\s*([\s\S]+)/i);

    res.json({
      headline: headlineMatch ? headlineMatch[1].trim() : '',
      legenda: legendaMatch ? legendaMatch[1].trim() : content,
    });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message || 'Erro ao gerar conteúdo' });
  }
});

module.exports = router;
