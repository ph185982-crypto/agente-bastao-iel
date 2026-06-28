const OpenAI = require('openai');

let _client = null;
function getClient() {
  return (_client ??= new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  }));
}

const MODEL_MAP = {
  'gpt-4o':      'llama-3.3-70b-versatile',
  'gpt-4o-mini': 'llama-3.1-8b-instant',
};

function createCompatClient() {
  const client = getClient();
  return {
    chat: {
      completions: {
        create: (opts) => {
          const model = MODEL_MAP[opts.model] || opts.model || 'llama-3.3-70b-versatile';
          return client.chat.completions.create({ ...opts, model });
        },
      },
    },
  };
}

module.exports = { createCompatClient };
