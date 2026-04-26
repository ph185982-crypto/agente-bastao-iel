const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');

const router = express.Router();

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 20 * 1024 * 1024 },
});

const SYSTEM_PROMPT = `Você é um agente criativo especialista em conteúdo para o perfil @pedro_destrava no Instagram.

Seu papel:
- Analisar documentos, roteiros e referências enviados pelo usuário
- Criar, melhorar e refinar conteúdo com base nesses materiais
- Gerar headlines impactantes, legendas completas e ganchos criativos
- Identificar os ângulos mais interessantes e contraintuitivos de cada material

Tom do perfil: inteligente, aprofundado, baseado em curiosidades e fatos surpreendentes.
Nunca use linguagem genérica, motivacional vazia ou clichês.
Sempre traga ângulos intelectuais, curiosos ou contraintuitivos.

Quando o usuário enviar documentos ou roteiros, analise-os profundamente e use esse contexto em todas as respostas.
Responda sempre em português do Brasil.`;

async function extractFileContent(file) {
  const name = file.originalname || 'arquivo';
  const ext = name.toLowerCase().split('.').pop();
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  if (imageExts.includes(ext) || file.mimetype?.startsWith('image/')) {
    const buffer = fs.readFileSync(file.path);
    const base64 = buffer.toString('base64');
    const mimeType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)
      ? file.mimetype
      : 'image/jpeg';
    return { type: 'image', base64, mimeType, name };
  }

  if (ext === 'pdf' || file.mimetype === 'application/pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(file.path);
      const data = await pdfParse(buffer);
      return { type: 'text', content: data.text, name };
    } catch (e) {
      return { type: 'text', content: `[Não foi possível ler o PDF: ${e.message}]`, name };
    }
  }

  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    return { type: 'text', content, name };
  } catch {
    return { type: 'text', content: '[Arquivo não pôde ser lido]', name };
  }
}

// POST /api/chat — multi-turn conversation with optional file attachments (GPT-4o)
router.post('/', upload.array('files', 10), async (req, res) => {
  const { message, history } = req.body;

  if (!message?.trim()) return res.status(400).json({ error: 'Mensagem é obrigatória' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor' });
  }

  const filePaths = (req.files || []).map((f) => f.path);

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Parse previous turns (role: user | assistant, content: string)
    let parsedHistory = [];
    try { parsedHistory = JSON.parse(history || '[]'); } catch (_) {}

    // Convert history to OpenAI format
    const historyMessages = parsedHistory.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : '',
    }));

    // Build content blocks for the current user turn
    const userContent = [];

    for (const file of req.files || []) {
      try {
        const extracted = await extractFileContent(file);
        if (extracted.type === 'image') {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${extracted.mimeType};base64,${extracted.base64}` },
          });
          userContent.push({ type: 'text', text: `[Imagem: ${extracted.name}]` });
        } else {
          userContent.push({
            type: 'text',
            text: `\n--- DOCUMENTO: ${extracted.name} ---\n${extracted.content}\n--- FIM ---\n`,
          });
        }
      } catch (e) {
        console.error('File extraction error:', e.message);
      }
    }

    userContent.push({ type: 'text', text: message.trim() });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: 'user', content: userContent },
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages,
    });

    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar mensagem' });
  } finally {
    for (const p of filePaths) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
});

module.exports = router;
