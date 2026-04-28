const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');

const router = express.Router();

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const SYSTEM_PROMPT = `Você é um especialista em copy para o perfil @pedro_destrava no Instagram.
Tom: inteligente, aprofundado, baseado em curiosidades e fatos surpreendentes.
Nunca use linguagem genérica, motivacional vazia ou clichês.
Sempre traga ângulos intelectuais, curiosos ou contraintuitivos.`;

/**
 * POST /api/analyze-print
 * Receives an image, extracts text, translates to PT-BR if needed,
 * then generates headline + caption — all in a single GPT-4o call.
 */
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor' });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype === 'image/jpg' ? 'image/jpeg' : req.file.mimetype;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            {
              type: 'text',
              text: `Analise esta imagem e execute as tarefas abaixo em ordem:

1. TRANSCRIÇÃO: Extraia todo o texto visível na imagem.
2. TRADUÇÃO: Traduza o texto para português do Brasil. Se já estiver em português, mantenha idêntico.
3. HEADLINE: Crie uma headline de até 10 palavras — impactante, que gere curiosidade intelectual.
4. LEGENDA: Crie uma legenda completa (3 a 5 parágrafos) no tom do @pedro_destrava — com fato surpreendente ou curiosidade no início, aprofundamento no meio, CTA no final pedindo para salvar ou comentar.

Retorne EXATAMENTE neste formato (sem texto adicional fora dele):

TEXTO_ORIGINAL:
[texto extraído da imagem]

TEXTO_PT:
[texto traduzido para português]

HEADLINE: [headline aqui]

LEGENDA:
[legenda aqui]`,
            },
          ],
        },
      ],
    });

    const raw = response.choices[0].message.content || '';

    // Parse the structured response
    const originalMatch = raw.match(/TEXTO_ORIGINAL:\s*([\s\S]+?)(?=\nTEXTO_PT:)/i);
    const ptMatch       = raw.match(/TEXTO_PT:\s*([\s\S]+?)(?=\nHEADLINE:)/i);
    const headlineMatch = raw.match(/HEADLINE:\s*(.+?)(?:\n|$)/i);
    const legendaMatch  = raw.match(/LEGENDA:\s*([\s\S]+)/i);

    res.json({
      original_text: originalMatch ? originalMatch[1].trim() : '',
      portuguese_text: ptMatch ? ptMatch[1].trim() : '',
      headline: headlineMatch ? headlineMatch[1].trim() : '',
      legenda: legendaMatch ? legendaMatch[1].trim() : '',
    });
  } catch (error) {
    console.error('Analyze print error:', error);
    res.status(500).json({ error: error.message || 'Erro ao analisar imagem' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

module.exports = router;
