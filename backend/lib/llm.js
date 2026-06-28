const { GoogleGenerativeAI } = require('@google/generative-ai');

let _genAI = null;
const getGenAI = () => (_genAI ??= new GoogleGenerativeAI(process.env.GOOGLE_API_KEY));

const MODEL_MAP = {
  'gpt-4o':      'gemini-2.0-flash',
  'gpt-4o-mini': 'gemini-2.0-flash-lite',
};

function mapModel(openaiModel) {
  return MODEL_MAP[openaiModel] || 'gemini-2.0-flash';
}

function buildContents(messages) {
  const contents = [];
  let systemInstruction;
  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = m.content;
    } else {
      const parts = [];
      if (typeof m.content === 'string') {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === 'text') parts.push({ text: c.text });
          else if (c.type === 'image_url') {
            const url = c.image_url?.url || '';
            if (url.startsWith('data:')) {
              const [meta, data] = url.split(',');
              const mimeType = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
              parts.push({ inlineData: { mimeType, data } });
            }
          }
        }
      }
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
  }
  return { contents, systemInstruction };
}

async function chatComplete({ model, messages, max_tokens, response_format, temperature, tools }) {
  const geminiModel = mapModel(model);
  const { contents, systemInstruction } = buildContents(messages);

  const generationConfig = {};
  if (max_tokens) generationConfig.maxOutputTokens = max_tokens;
  if (temperature != null) generationConfig.temperature = temperature;
  if (response_format?.type === 'json_object') {
    generationConfig.responseMimeType = 'application/json';
  }

  const modelConfig = { model: geminiModel };
  if (systemInstruction) modelConfig.systemInstruction = systemInstruction;

  const genModel = getGenAI().getGenerativeModel(modelConfig);

  const result = await genModel.generateContent({
    contents,
    generationConfig,
  });

  const text = result.response.text();
  return {
    choices: [{ message: { content: text, role: 'assistant' } }],
  };
}

function createCompatClient() {
  return {
    chat: {
      completions: {
        create: chatComplete,
      },
    },
  };
}

module.exports = { createCompatClient, chatComplete };
