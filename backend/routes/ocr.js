const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const router = express.Router();

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos JPEG e PNG são permitidos'));
    }
  },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/ocr — extract caption text from an image using Claude Vision
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' });
  }

  try {
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    // Normalise mimetype — 'image/jpg' is not a valid media_type for Anthropic
    const mediaType =
      req.file.mimetype === 'image/jpg' ? 'image/jpeg' : req.file.mimetype;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: 'Extraia apenas o texto da legenda visível nessa imagem. Retorne somente o texto puro, sem explicações.',
            },
          ],
        },
      ],
    });

    const extractedText = response.content[0].text;
    res.json({ text: extractedText });
  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar imagem' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

module.exports = router;
