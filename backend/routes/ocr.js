const express = require('express');
const multer = require('multer');
const { createCompatClient, hasLlmKey, NO_LLM_KEY_MESSAGE } = require('../lib/llm');
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

// POST /api/ocr — extract caption text from an image using GPT-4o Vision
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });

  if (!hasLlmKey()) {
    return res.status(500).json({ error: NO_LLM_KEY_MESSAGE });
  }

  try {
    const openai = createCompatClient();

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype === 'image/jpg' ? 'image/jpeg' : req.file.mimetype;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            {
              type: 'text',
              text: 'Extraia apenas o texto da legenda visível nessa imagem. Retorne somente o texto puro, sem explicações.',
            },
          ],
        },
      ],
    });

    res.json({ text: response.choices[0].message.content });
  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar imagem' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

module.exports = router;
