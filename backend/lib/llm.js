const OpenAI = require('openai');

let _client = null;
let _provider = null;

const MODEL_MAP = {
  'gpt-4o':      'llama3-70b-8192',
  'gpt-4o-mini': 'llama3-8b-8192',
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

// Quota/rate-limit: cai pro Groq só nessa chamada (não troca o provider global,
// porque quota da OpenAI volta — ao contrário de uma chave inválida).
function isQuotaError(err) {
  return err?.status === 429;
}

function createCompatClient() {
  return {
    chat: {
      completions: {
        // requestOptions (2º argumento) é passado direto pro SDK — usado pra
        // limitar `timeout` sem contaminar o body da requisição.
        create: async (opts, requestOptions) => {
          const { client, provider } = getClient();
          const model = provider === 'groq'
            ? (MODEL_MAP[opts.model] || opts.model || 'llama-3.3-70b-versatile')
            : (opts.model || 'gpt-4o');
          try {
            return await client.chat.completions.create({ ...opts, model }, requestOptions);
          } catch (err) {
            if (provider !== 'openai') throw err;

            if (isAuthError(err)) {
              // Chave OpenAI inválida/revogada → troca definitivamente pro Groq
              const groq = groqFallbackClient();
              if (!groq) throw err;
              console.warn('[llm] OpenAI auth failed, switching to Groq:', err.message?.slice(0, 120));
              _client = groq;
              _provider = 'groq';
              const groqModel = MODEL_MAP[opts.model] || 'llama-3.3-70b-versatile';
              return await groq.chat.completions.create({ ...opts, model: groqModel }, requestOptions);
            }

            if (isQuotaError(err)) {
              // Cota/rate-limit da OpenAI → usa Groq só nessa chamada, mantém OpenAI ativa
              const groq = groqFallbackClient();
              if (!groq) throw err;
              console.warn('[llm] OpenAI quota excedida, usando Groq nesta chamada:', err.message?.slice(0, 120));
              const groqModel = MODEL_MAP[opts.model] || 'llama-3.3-70b-versatile';
              return await groq.chat.completions.create({ ...opts, model: groqModel }, requestOptions);
            }

            throw err;
          }
        },
      },
    },
  };
}

// Traduz erros de LLM (OpenAI/Groq) em mensagens amigáveis pro usuário final —
// nunca expor stack trace, chave ou texto técnico do provedor.
function friendlyErrorMessage(err) {
  const status = err?.status;
  if (status === 401) return 'Chave de API inválida. Verifique a configuração no servidor.';
  if (status === 403) return 'Acesso negado pela API de IA. Verifique a configuração de billing/acesso.';
  if (status === 404) return 'O modelo de IA configurado não está disponível. Entre em contato com o suporte.';
  if (status === 429) return 'Os modelos de IA estão sobrecarregados no momento. Tente novamente em alguns instantes.';
  if (status >= 500) return 'O serviço de IA está instável no momento. Tente novamente em alguns instantes.';
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return 'A geração demorou demais e foi cancelada. Tente novamente.';
  }
  if (/JSON|Unexpected token/i.test(err?.message || '')) {
    return 'A IA retornou uma resposta inválida. Tente novamente.';
  }
  return 'Não foi possível gerar o conteúdo agora. Tente novamente em instantes.';
}

module.exports = { createCompatClient, friendlyErrorMessage };
