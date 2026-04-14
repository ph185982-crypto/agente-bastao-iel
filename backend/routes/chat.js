const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const router = express.Router();

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB por arquivo
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'application/pdf',
      'text/plain', 'text/markdown',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Accept unknown types as text — user might upload .txt with wrong MIME
      cb(null, true);
    }
  },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um agente criativo especialista em conteúdo para o perfil @pedro_destrava no Instagram.

Seu papel:
- Analisar documentos, roteiros e referências enviados pelo usuário
- Criar, melhorar e refinar conteúdo com base nesses materiais
- Gerar headlines impactantes, legendas completas e ganchos criativos
- Identificar os ângulos mais interessantes e contraintuitivos de cada material

Tom do perfil: inteligente, aprofundado, baseado em curiosidades e fatos surpreendentes.
Nunca use linguagem genérica, motivacional vazia ou clichês.
Sempre traga ângulos intelectuais, curiosos ou contraintuitivos.

Quando o usuário enviar documentos ou roteiros, analise-os profundamente e use esse contexto em todas as respostas subsequentes.
Responda sempre em português do Brasil.`;

async function extractFileContent(file) {
  const name = file.originalname || 'arquivo';
  const ext = name.toLowerCase().split('.').pop();
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  if (imageExts.includes(ext) || file.mimetype?.startsWith('image/')) {
    const buffer = fs.readFileSync(file.path);
    const base64 = buffer.toString('base64');
    const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)
      ? file.mimetype
      : 'image/jpeg';
    return { type: 'image', base64, mediaType, name };
  }

  if (ext === 'pdf' || file.mimetype === 'application/pdf') {
    try {
      // Lazy-require pdf-parse — avoids issues if package not installed yet
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(file.path);
      const data = await pdfParse(buffer);
      return { type: 'text', content: data.text, name };
    } catch (e) {
      // Fallback: include raw warning
      return { type: 'text', content: `[Não foi possível extrair texto do PDF: ${e.message}]`, name };
    }
  }

  // Default: read as UTF-8 text
  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    return { type: 'text', content, name };
  } catch {
    return { type: 'text', content: '[Arquivo não pôde ser lido]', name };
  }
}

// POST /api/chat — multi-turn conversation with optional file attachments
router.post('/', upload.array('files', 10), async (req, res) => {
  const { message, history } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Mensagem é obrigatória' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' });
  }

  const filePaths = (req.files || []).map((f) => f.path);

  try {
    // Parse conversation history sent from frontend
    let parsedHistory = [];
    try {
      parsedHistory = JSON.parse(history || '[]');
    } catch (_) {}

    // Build content blocks for this user turn
    const userContent = [];

    for (const file of req.files || []) {
      try {
        const extracted = await extractFileContent(file);
        if (extracted.type === 'image') {
          userContent.push({
            type: 'image',
            source: { type: 'base64', media_type: extracted.mediaType, data: extracted.base64 },
          });
          userContent.push({ type: 'text', text: `[Imagem anexada: ${extracted.name}]` });
        } else {
          userContent.push({
            type: 'text',
            text: `\n--- DOCUMENTO: ${extracted.name} ---\n${extracted.content}\n--- FIM DO DOCUMENTO ---\n`,
          });
        }
      } catch (e) {
        console.error('Error processing file:', file.originalname, e.message);
      }
    }

    userContent.push({ type: 'text', text: message.trim() });

    // Convert frontend history to Anthropic messages format
    const messages = [
      ...parsedHistory.map((m) => ({
        role: m.role,
        content: [{ type: 'text', text: typeof m.content === 'string' ? m.content : String(m.content) }],
      })),
      { role: 'user', content: userContent },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    });

    res.json({ response: response.content[0].text });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar mensagem' });
  } finally {
    // Clean up temp files
    for (const p of filePaths) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
});

module.exports = router;
