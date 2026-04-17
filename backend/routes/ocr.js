const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// POST /api/ocr — extract caption text from an image using Gemini Vision
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });

  if (!process.env.GOOGLE_AI_KEY) {
    return res.status(500).json({ error: 'GOOGLE_AI_KEY não configurada no servidor' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype === 'image/jpg' ? 'image/jpeg' : req.file.mimetype;

    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64Image } },
      'Extraia apenas o texto da legenda visível nessa imagem. Retorne somente o texto puro, sem explicações.',
    ]);

    res.json({ text: result.response.text() });
  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar imagem' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

module.exports = router;
