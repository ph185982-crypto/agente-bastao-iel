// Fundo por IA do tema "reportagem" (modo híbrido). DESLIGADO por padrão (gasta crédito da OpenAI):
// liga com IMAGEM_OPENAI_LIGADA=1 + OPENAI_API_KEY (ver docs/IMAGENS_OPENAI.md).
//
// O que a IA faz: SÓ uma textura/forma de fundo, sem letra, número, logotipo ou pessoa. O que o código faz: todo o texto,
// os números, o rosto (recorte do Pedro) e as cores. Mesmo assim o fundo passa por leitura de imagem (OCR): se vier com
// letra ou número, é descartado (uma nova tentativa; depois cai para o fundo feito por código). Falha, recusa ou teto de
// gasto NUNCA derrubam a produção: o carrossel sai com as formas desenhadas por código.
const crypto = require('crypto');
const { ACCOUNT } = require('./account');
const Orc = require('./orcamentoImagem');
const Img = require('./imagemOpenAI');
const Ocr = require('./ocrConferencia');

const conta = () => ACCOUNT.ig_id;
const CORES = ['#F5F2EA', '#F2B01A', '#D71920', '#0B1D3A'];

// Resto de letra ou número na imagem = a IA desenhou texto. Palavras de 4+ letras e qualquer número de 2+ dígitos reprovam.
function temTexto(lido) {
  const t = Ocr.normalizar(lido);
  if (/\d{2,}/.test(t)) return true;
  return (t.match(/[a-z]{4,}/g) || []).length > 0;
}

// c: conteúdo; v: versão ativa. Devolve { buffer, chave, custo_usd, modelo, tentativas } ou { aviso } (nunca lança).
async function gerar(c, v, deps = {}) {
  const A = deps.armazem || require('./armazem').armazem();
  const chave = `fundo:${c.id}:${v.id}`;
  try {
    const guardado = A?.arquivos && await A.arquivos.obter(conta(), chave);
    if (guardado) return { buffer: guardado.dados, chave, reaproveitado: true };
    if (!(deps.ligada ? deps.ligada() : Orc.ligada())) return { aviso: null }; // desligado: caminho normal, sem aviso
    const prompt = Img.montarPrompt({ clima: 'reportagem política e econômica, papel impresso, tinta e grão', cores: CORES, forma: deps.forma || 'pincelada' });
    let custo = 0; let modelo = null;
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await (deps.fundoComTeto || Orc.fundoComTeto)({ conteudo_id: c.id, prompt, qualidade: deps.qualidade || 'medium', deps: deps.orcamento });
      custo += r.custo_usd || 0; modelo = r.modelo;
      const lido = await (deps.ocr || (async (b) => (await Ocr.conferirTexto(b, [])).lido))(r.png);
      if (!temTexto(lido)) {
        if (A?.arquivos) await A.arquivos.salvar(conta(), chave, r.png, 'image/png');
        return { buffer: r.png, chave, custo_usd: Math.round(custo * 1000) / 1000, modelo, tentativas: tentativa };
      }
    }
    return { aviso: 'A IA devolveu um fundo com letras ou números duas vezes; o carrossel saiu com o fundo feito por código.', custo_usd: Math.round(custo * 1000) / 1000, modelo };
  } catch (e) {
    const porCodigo = { ImagemRecusada: 'A OpenAI recusou gerar o fundo', ImagemTeto: 'O teto de gasto com imagens foi atingido', ImagemSemChave: 'Falta a chave da OpenAI', ImagemFalhou: 'A OpenAI não respondeu a tempo' }[e.code || e.name];
    return { aviso: `${porCodigo || 'Não consegui gerar o fundo por IA'}; o carrossel saiu com o fundo feito por código.` };
  }
}

module.exports = { gerar, temTexto, hashDe: (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12) };
