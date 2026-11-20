// Ilustração da CENA do carrossel "diálogo ilustrado" (OpenAI). DESLIGADA por padrão, igual ao fundo por IA:
// liga com IMAGEM_OPENAI_LIGADA=1 + OPENAI_API_KEY e passa pelos mesmos tetos de gasto (orcamentoImagem, por carrossel
// e por mês). Ver docs/CARROSSEIS_DIALOGO_E_PAPEL.md.
//
// Diferença para o fundoIA: aqui a imagem TEM pessoas (dois personagens genéricos, de costas ou à distância), porque a
// cena é o próprio formato. Continua proibido: texto, letras, números, logotipos, marcas, rosto reconhecível e pessoa
// real. Os balões e todo o texto são desenhados depois pelo código (arteDialogo.js).
//
// Uma imagem por carrossel. Ela passa por leitura (OCR): se vier com letra ou número, é descartada; há UMA nova
// tentativa e, depois, o carrossel sai com a cena desenhada pelo código. Falha, recusa, teto ou desligado NUNCA
// derrubam a criação: a função devolve { aviso } e quem chama usa a cena feita por código.
const { ACCOUNT } = require('./account');
const Orc = require('./orcamentoImagem');
const Ocr = require('./ocrConferencia');
const { temTexto } = require('./fundoIA');

const conta = () => ACCOUNT.ig_id;
const limpa = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const PROIBIDO_CENA = 'SEM texto, SEM letras, SEM números, SEM placas ou cartazes legíveis, SEM rótulos legíveis em embalagens, SEM logotipos, SEM marcas comerciais, SEM marca d\'água, SEM balões de fala, SEM pessoa real ou famosa, SEM rosto reconhecível';
// Tempo para a 2ª tentativa: a função da Vercel tem 60 s; se a 1ª já gastou mais que isso, não arrisca outra.
const PRAZO_RETENTATIVA_MS = 25000;

/**
 * Prompt da ilustração. A descrição vem do Pedro (ou da fábrica), mas as regras vêm sempre por último e por escrito.
 * @param {{descricao:string, ancoras?:{a:{x:number,y:number},b:{x:number,y:number}}}} p
 */
function montarPromptCena({ descricao, ancoras } = {}) {
  const lado = (p, padrao) => (!p ? padrao : p.x < 40 ? 'à esquerda' : p.x > 60 ? 'à direita' : 'no centro');
  const partes = [
    'Ilustração editorial vertical (proporção 4:5), estilo romance gráfico pintado à mão, pinceladas visíveis, luz suave e cores quentes, aparência de livro ilustrado. Nada de fotografia.',
    `Cena: ${limpa(descricao, 300) || 'um lugar do dia a dia'}.`,
    `Dois personagens genéricos, anônimos, vistos de costas ou à distância (o rosto não aparece): um ${lado(ancoras?.a, 'à esquerda')} e outro ${lado(ancoras?.b, 'à direita')}, os dois no terço de baixo da imagem.`,
    'O terço de cima da imagem fica calmo e sem detalhes importantes (parede, teto, céu ou fundo desfocado): balões de fala serão colocados ali depois.',
    'Produtos, placas e embalagens, se aparecerem, são lisos e sem nenhuma escrita. Não imite o estilo de nenhum artista ou obra específica.',
    `Regras obrigatórias: ${PROIBIDO_CENA}. Nenhum símbolo que pareça letra ou número.`,
  ];
  return partes.join('\n');
}

/**
 * Gera (ou reaproveita) a ilustração da cena de um carrossel.
 * @param {{id:string}} c  conteúdo (o id entra no teto por carrossel e na chave do arquivo)
 * @param {{descricao:string, ancoras?:object}} cena
 * @param {object} deps  injetáveis: armazem, ligada, fundoComTeto, orcamento, ocr, qualidade, agora, prazoRetentativaMs
 * @returns {Promise<{buffer:Buffer, chave:string, custo_usd:number, modelo:string, tentativas:number, prompt:string}|{aviso:string|null, custo_usd?:number}>}
 */
async function gerar(c, cena, deps = {}) {
  const A = deps.armazem !== undefined ? deps.armazem : require('./armazem').armazem();
  const chave = `cena:${c.id}`;
  const agora = deps.agora || Date.now;
  let custo = 0; let modelo = null;
  const arred = (n) => Math.round(n * 1000) / 1000;
  try {
    const guardado = A?.arquivos && await A.arquivos.obter(conta(), chave);
    if (guardado) return { buffer: Buffer.from(guardado.dados), chave, reaproveitado: true, custo_usd: 0, tentativas: 0 };
    if (!(deps.ligada ? deps.ligada() : Orc.ligada())) return { aviso: null }; // desligada: caminho normal, sem aviso
    const prompt = montarPromptCena(cena || {});
    const inicio = agora();
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      if (tentativa === 2 && agora() - inicio > (deps.prazoRetentativaMs ?? PRAZO_RETENTATIVA_MS)) {
        return { aviso: 'A ilustração veio com letras ou números e não havia tempo para outra tentativa; o carrossel saiu com a cena desenhada pelo código.', custo_usd: arred(custo), modelo };
      }
      const r = await (deps.fundoComTeto || Orc.fundoComTeto)({ conteudo_id: c.id, prompt, qualidade: deps.qualidade || 'medium', tamanho: '1024x1536', deps: deps.orcamento });
      custo += r.custo_usd || 0; modelo = r.modelo;
      const lido = await (deps.ocr || (async (b) => (await Ocr.conferirTexto(b, [])).lido))(r.png);
      if (!temTexto(lido)) {
        if (A?.arquivos) await A.arquivos.salvar(conta(), chave, r.png, 'image/png');
        return { buffer: r.png, chave, custo_usd: arred(custo), modelo, tentativas: tentativa, prompt };
      }
    }
    return { aviso: 'A IA devolveu a ilustração com letras ou números duas vezes; o carrossel saiu com a cena desenhada pelo código.', custo_usd: arred(custo), modelo };
  } catch (e) {
    const porCodigo = { ImagemRecusada: 'A OpenAI recusou gerar a ilustração', ImagemTeto: 'O teto de gasto com imagens foi atingido', ImagemSemChave: 'Falta a chave da OpenAI', ImagemFalhou: 'A OpenAI não gerou a ilustração' }[e.name] || ({ IMAGEM_RECUSADA: 'A OpenAI recusou gerar a ilustração', IMAGEM_TETO: 'O teto de gasto com imagens foi atingido', IMAGEM_SEM_CHAVE: 'Falta a chave da OpenAI', IMAGEM_FALHOU: 'A OpenAI não gerou a ilustração' }[e.code]);
    // Motivo fixo do módulo de imagem (nunca o corpo cru da API nem a chave): ajuda a saber se foi tempo, chave, saldo ou modelo.
    const motivo = (e.name === 'ImagemFalhou' || e.code === 'IMAGEM_FALHOU') && typeof e.message === 'string' && e.message.length < 140 && !/sk-|Bearer/i.test(e.message) ? ` (${e.message})` : '';
    return { aviso: `${porCodigo || 'Não consegui gerar a ilustração'}${motivo}; o carrossel saiu com a cena desenhada pelo código.`, custo_usd: arred(custo), modelo };
  }
}

module.exports = { gerar, montarPromptCena, PROIBIDO_CENA, PRAZO_RETENTATIVA_MS };
