// Fundo gráfico por IA (modo híbrido): a IA gera SÓ o fundo/forma (pincelada, seta, círculo, degrau, textura de
// papel e grão), sem texto, sem número, sem logotipo, sem pessoa e sem rosto. Texto, números, layout e recorte do
// rosto são desenhados pelo código por cima (arte.js) e conferidos por OCR (ocrConferencia.js).
//
// Gasta crédito da OpenAI. Quem chama deve passar por orcamentoImagem.fundoComTeto (teto por carrossel e por mês).
// A chave vem SÓ de process.env.OPENAI_API_KEY (ou do parâmetro, nos testes). Nunca é gravada, logada nem devolvida,
// e o corpo de erro cru da API também não: as mensagens abaixo são fixas.

const URL_IMAGENS = 'https://api.openai.com/v1/images/generations';
const MODELO_PADRAO = 'gpt-image-1.5';
const TIMEOUT_MS = 50000;
const QUALIDADES = ['low', 'medium', 'high', 'auto'];
const TAMANHOS = ['1024x1536', '1536x1024', '1024x1024', 'auto'];

// Custo por imagem em dólar, em 1024x1536 (CONFIRME NO PAINEL DA OPENAI: preços mudam).
// Para os outros tamanhos usamos o mesmo valor (conservador).
const CUSTO_USD = {
  'gpt-image-1.5': { low: 0.013, medium: 0.05, high: 0.2 },
  'gpt-image-1': { low: 0.016, medium: 0.063, high: 0.25 },
  'gpt-image-1-mini': { low: 0.006, medium: 0.015, high: 0.052 },
};

class ErroImagem extends Error {
  constructor(msg, code, extra) { super(msg); this.name = this.constructor.name; this.code = code; Object.assign(this, extra || {}); }
}
class ImagemSemChave extends ErroImagem { constructor() { super('A chave da OpenAI não está configurada no servidor (OPENAI_API_KEY).', 'IMAGEM_SEM_CHAVE'); } }
class ImagemDesligada extends ErroImagem { constructor() { super('A geração de fundo por IA está desligada (IMAGEM_OPENAI_LIGADA).', 'IMAGEM_DESLIGADA'); } }
// A OpenAI recusou o pedido por política de conteúdo. O chamador deve cair para o fundo feito por código.
class ImagemRecusada extends ErroImagem { constructor() { super('A OpenAI recusou este pedido de imagem. Use o fundo feito pelo código.', 'IMAGEM_RECUSADA'); } }
class ImagemTeto extends ErroImagem { constructor(detalhe) { super(`Teto de gasto com imagem atingido (${detalhe?.tipo === 'mes' ? 'do mês' : 'deste carrossel'}). Nada foi gerado.`, 'IMAGEM_TETO', { detalhe }); } }
class ImagemFalhou extends ErroImagem { constructor(motivo, extra) { super(`Não consegui gerar o fundo agora: ${motivo}.`, 'IMAGEM_FALHOU', extra); } }

function custoImagem(modelo, qualidade) {
  const tabela = CUSTO_USD[modelo];
  if (!tabela) return CUSTO_USD[MODELO_PADRAO].high;           // modelo desconhecido: o valor mais alto do 1.5 (conservador)
  return tabela[qualidade] ?? tabela.high;                      // 'auto' custa como 'high'
}

const PROIBIDO = 'SEM texto, SEM letras, SEM números, SEM logotipos, SEM pessoas, SEM rostos, SEM marcas, SEM marca d\'água';
const FORMAS = {
  pincelada: 'uma pincelada larga e irregular, de tinta seca, com bordas ásperas',
  seta_subindo: 'uma seta grossa e irregular subindo na diagonal, em estilo de carimbo de tinta',
  seta_descendo: 'uma seta grossa e irregular descendo na diagonal, em estilo de carimbo de tinta',
  circulo: 'um grande círculo chapado de tinta com borda levemente irregular',
  degrau: 'uma forma de degraus irregulares (gráfico em escada) em tinta',
  nenhuma: 'apenas textura de papel e grão, sem forma',
};
const limpa = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const corValida = (c) => /^#[0-9a-f]{6}$/i.test(String(c || '').trim());

/**
 * Prompt de FUNDO. As proibições vêm sempre por último e por escrito, para valerem sobre qualquer clima/cor pedido.
 * @param {{clima?:string, cores?:string[], forma?:keyof FORMAS}} p
 */
function montarPrompt({ clima, cores, forma } = {}) {
  const desc = FORMAS[forma] || FORMAS.pincelada;
  const paleta = (Array.isArray(cores) ? cores : []).filter(corValida).slice(0, 4).map((c) => c.toUpperCase());
  const partes = [
    'Fundo gráfico para um slide de carrossel de reportagem econômica, formato vertical 4:5, estilo editorial documental.',
    `Elemento gráfico: ${desc}, em tinta, com grão e textura de papel impresso.`,
    clima ? `Clima: ${limpa(clima, 120)}.` : '',
    paleta.length ? `Paleta (só estas cores, mais tons de papel claro): ${paleta.join(', ')}.` : 'Paleta: azul-marinho, amarelo, vermelho e tons de papel claro.',
    'Deixe uma área ampla e limpa para texto; o elemento gráfico fica em um canto ou na borda, sem cobrir o centro.',
    `Regras obrigatórias: ${PROIBIDO}. Nenhum símbolo que pareça letra ou número.`,
  ];
  return partes.filter(Boolean).join('\n');
}

function ehRecusa(status, corpo) {
  const e = corpo?.error || {};
  const alvo = `${e.code || ''} ${e.type || ''} ${e.message || ''}`.toLowerCase();
  return /content_policy|moderation|safety system|safety_violation|policy violation/.test(alvo) || (status === 400 && /blocked|rejected/.test(alvo) && /safety|policy/.test(alvo));
}

/**
 * @param {{prompt:string, qualidade?:'low'|'medium'|'high'|'auto', tamanho?:string, modelo?:string, fetcher?:Function, chave?:string, timeoutMs?:number}} p
 * @returns {Promise<{png:Buffer, custo_usd:number, modelo:string}>}
 * @throws ImagemSemChave | ImagemRecusada | ImagemFalhou
 */
async function gerarFundo({ prompt, qualidade = 'medium', tamanho = '1024x1536', modelo, fetcher, chave, timeoutMs = TIMEOUT_MS } = {}) {
  const apiKey = chave || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ImagemSemChave();
  if (!prompt || typeof prompt !== 'string') throw new ImagemFalhou('pedido sem descrição');
  if (!QUALIDADES.includes(qualidade)) throw new ImagemFalhou('qualidade inválida');
  if (!TAMANHOS.includes(tamanho)) throw new ImagemFalhou('tamanho inválido');
  const m = modelo || process.env.OPENAI_IMAGE_MODEL || MODELO_PADRAO;
  const f = fetcher || globalThis.fetch;

  let resp;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(Object.assign(new Error('tempo esgotado'), { name: 'TimeoutError' })), timeoutMs);
  try {
    resp = await f(URL_IMAGENS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: m, prompt, n: 1, size: tamanho, quality: qualidade, output_format: 'png' }),
      signal: controle.signal,
    });
  } catch (e) {
    const tempo = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    clearTimeout(relogio);
    throw new ImagemFalhou(tempo ? 'a OpenAI demorou mais que o esperado' : 'sem conexão com a OpenAI', { tempo_esgotado: tempo });
  }

  let corpo = null;
  try { corpo = await resp.json(); } catch { /* corpo não é JSON: tratado abaixo, sem ecoar */ } finally { clearTimeout(relogio); }
  if (!resp.ok) {
    if (ehRecusa(resp.status, corpo)) throw new ImagemRecusada();
    if (resp.status === 401 || resp.status === 403) throw new ImagemFalhou('a OpenAI não aceitou a chave ou o modelo (confira a chave e a verificação da organização)', { status: resp.status });
    if (resp.status === 429) throw new ImagemFalhou('limite de uso ou de saldo da OpenAI', { status: 429 });
    throw new ImagemFalhou(`erro ${resp.status} da OpenAI`, { status: resp.status });
  }
  const b64 = corpo?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || !b64) throw new ImagemFalhou('a resposta veio sem imagem');
  const png = Buffer.from(b64, 'base64');
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new ImagemFalhou('a imagem recebida não é um PNG válido');
  return { png, custo_usd: custoImagem(m, qualidade), modelo: m };
}

module.exports = {
  gerarFundo, montarPrompt, custoImagem,
  ImagemSemChave, ImagemDesligada, ImagemRecusada, ImagemTeto, ImagemFalhou, ErroImagem,
  CUSTO_USD, MODELO_PADRAO, FORMAS, PROIBIDO, TIMEOUT_MS,
};
