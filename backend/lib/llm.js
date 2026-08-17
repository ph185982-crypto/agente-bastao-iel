const OpenAI = require('openai');

let _client = null;
let _provider = null;

// Modelos Groq disponíveis (verificados em agosto/2026).
// Ordenados do maior contexto para o menor — 413 faz tentar o próximo.
const GROQ_MODELS_LARGE = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'groq/compound',
];
const GROQ_MODELS_SMALL = [
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'groq/compound-mini',
  'groq/compound',
];

const MODEL_MAP = {
  'gpt-4o':      GROQ_MODELS_LARGE[0],
  'gpt-4o-mini': GROQ_MODELS_SMALL[0],
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

function isQuotaError(err) {
  return err?.status === 429;
}

function isModelNotFoundError(err) {
  if (err?.status === 404) return true;
  // Groq retorna 400 com code 'model_decommissioned' para modelos desativados
  if (err?.status === 400 && err?.error?.code === 'model_decommissioned') return true;
  if (err?.status === 400 && /decommissioned|deprecated|not.*support/i.test(err?.message || '')) return true;
  // 413 = prompt maior que o contexto do modelo → tenta o próximo (com contexto maior)
  if (err?.status === 413) return true;
  return false;
}

// Tenta a chamada no Groq percorrendo a lista de modelos até um funcionar.
async function groqCallWithFallback(groq, opts, requestOptions, modelList) {
  let lastErr;
  for (const model of modelList) {
    try {
      console.warn('[llm] tentando modelo Groq:', model);
      return await groq.chat.completions.create({ ...opts, model }, requestOptions);
    } catch (err) {
      if (isModelNotFoundError(err)) {
        console.warn(`[llm] modelo ${model} não disponível, tentando próximo`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function resolveGroqModelList(requestedModel) {
  if (requestedModel === 'gpt-4o-mini') return GROQ_MODELS_SMALL;
  return GROQ_MODELS_LARGE;
}

function createCompatClient() {
  return {
    chat: {
      completions: {
        create: async (opts, requestOptions) => {
          const { client, provider } = getClient();
          const model = provider === 'groq'
            ? (MODEL_MAP[opts.model] || opts.model || GROQ_MODELS_LARGE[0])
            : (opts.model || 'gpt-4o');

          try {
            if (provider === 'groq') {
              return await groqCallWithFallback(client, opts, requestOptions, resolveGroqModelList(opts.model));
            }
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
              return await groqCallWithFallback(groq, opts, requestOptions, resolveGroqModelList(opts.model));
            }

            if (isQuotaError(err)) {
              // Cota/rate-limit da OpenAI → usa Groq só nessa chamada
              const groq = groqFallbackClient();
              if (!groq) throw err;
              console.warn('[llm] OpenAI quota excedida, usando Groq nesta chamada:', err.message?.slice(0, 120));
              return await groqCallWithFallback(groq, opts, requestOptions, resolveGroqModelList(opts.model));
            }

            throw err;
          }
        },
      },
    },
  };
}

// Traduz erros de LLM em mensagens amigáveis pro usuário final.
function friendlyErrorMessage(err) {
  const status = err?.status;
  if (status === 401) return 'Chave de API inválida. Verifique a configuração no servidor.';
  if (status === 403) return 'Acesso negado pela API de IA. Verifique a configuração de billing/acesso.';
  if (status === 404) return 'O modelo de IA não está disponível no momento. Tente novamente em instantes.';
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
