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

function createCompatClient() {
  const { client, provider } = getClient();
  return {
    chat: {
      completions: {
        create: (opts) => {
          const model = provider === 'groq'
            ? (MODEL_MAP[opts.model] || opts.model || 'llama-3.3-70b-versatile')
            : (opts.model || 'gpt-4o');
          return client.chat.completions.create({ ...opts, model });
        },
      },
    },
  };
}

module.exports = { createCompatClient };
