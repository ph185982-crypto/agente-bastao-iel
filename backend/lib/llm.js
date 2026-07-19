const OpenAI = require('openai');

let _client = null;
let _provider = null;

const MODEL_MAP = {
  'gpt-4o':      'llama-3.3-70b-versatile',
  'gpt-4o-mini': 'llama-3.1-8b-instant',
};

function getClient() {
  if (_client) return { client: _client, provider: _provider };

  if (process.env.OPENAI_API_KEY) {
    _provider = 'openai';
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } else if (process.env.GROQ_API_KEY) {
    _provider = 'groq';
    _client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  } else {
    throw new Error('Neither OPENAI_API_KEY nor GROQ_API_KEY is configured');
  }

  return { client: _client, provider: _provider };
}

function groqFallbackClient() {
  if (!process.env.GROQ_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
}

function isAuthError(err) {
  return err?.status === 401 || err?.status === 403;
}

function createCompatClient() {
  return {
    chat: {
      completions: {
        create: async (opts) => {
          const { client, provider } = getClient();
          const model = provider === 'groq'
            ? (MODEL_MAP[opts.model] || opts.model || 'llama-3.3-70b-versatile')
            : (opts.model || 'gpt-4o');
          try {
            return await client.chat.completions.create({ ...opts, model });
          } catch (err) {
            // Chave OpenAI inválida/revogada → cai para Groq (se configurado) e memoriza
            const groq = provider === 'openai' && isAuthError(err) ? groqFallbackClient() : null;
            if (!groq) throw err;
            console.warn('[llm] OpenAI auth failed, falling back to Groq:', err.message?.slice(0, 120));
            _client = groq;
            _provider = 'groq';
            const groqModel = MODEL_MAP[opts.model] || 'llama-3.3-70b-versatile';
            // Groq (llama) não aceita mensagens com imagem — deixa o chamador tratar
            return await groq.chat.completions.create({ ...opts, model: groqModel });
          }
        },
      },
    },
  };
}

module.exports = { createCompatClient };
