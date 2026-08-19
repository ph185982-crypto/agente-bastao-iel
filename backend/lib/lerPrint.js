// ── Leitura de print de post (sem IA) ─────────────────────────────────────────
// Recebe o print de um post do Instagram e devolve o GANCHO (o texto que está
// escrito em cima do vídeo) e a LEGENDA (o texto do post). O reconhecimento é
// feito pelo Tesseract, que roda dentro do próprio servidor: não é modelo de
// linguagem, não tem chave, não tem cota e não manda a imagem para lugar nenhum.
//
// A separação entre gancho e legenda é feita pela estrutura da tela, que é
// sempre a mesma: barra de status, card do vídeo com o gancho, linha do perfil
// (foto, nome, botão Seguir) e, embaixo dela, a legenda.

const path = require('path');
const os = require('os');
const { gerarCopyReel } = require('./roboReel');

const ASSETS = path.join(__dirname, '..', 'assets');

// ── Lixo de interface ─────────────────────────────────────────────────────────
// Linhas que fazem parte do aplicativo, não do post. Saem fora antes de qualquer
// decisão — se ficassem, virariam gancho ou entrariam no meio da legenda.
const CHROME = [
  /^\d{1,2}:\d{2}$/,                               // relógio da barra de status
  /^(seguir|seguindo|curtir|compartilhar|enviar|responder)$/i,
  /^gif$/i,
  /^(deixe um coment|participe da conversa|o que voc[êe] acha|adicione um coment|escreva um coment)/i,
  /^\d{1,2} de (janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i,
  /^(ver tradu|traduzir|ver mais|mais)$/i,
  /^[\d.,]+\s*(curtidas|coment[áa]rios|visualiza)/i,
  /^[♫♪🎵]/,                                        // linha da música do reel
  /^[^\p{L}\d]*$/u,                                 // só símbolo/pontuação
];

function ehChrome(linha) {
  const s = linha.trim();
  if (!s) return true;
  return CHROME.some(re => re.test(s));
}

// A OCR às vezes lê "@perfil" como "Operfil" ou "©perfil" — o arroba é o
// caractere que ela mais erra. Esta checagem aceita as três formas.
function ehArroba(linha) {
  return /^[@©O0]\s?[a-z0-9._]{3,30}$/i.test(linha.trim());
}

function nomeDoArroba(linha) {
  const m = linha.trim().match(/^[@©O0]\s?([a-z0-9._]{3,30})$/i);
  return m ? m[1].toLowerCase() : null;
}

// ── Onde a legenda começa ─────────────────────────────────────────────────────
// A linha do perfil é a fronteira: tudo acima dela é o card do vídeo (gancho),
// tudo abaixo é a legenda.
//
// A busca roda nas linhas CRUAS, antes de tirar o lixo de interface: o botão
// "Seguir" é justamente lixo de interface e é também a pista mais confiável de
// onde fica a fronteira. Filtrar antes de procurar apagava a única marca boa e
// jogava tudo no palpite do bloco maior.
function acharLinhaDoPerfil(linhas) {
  const idxSeguir = linhas.findIndex(l => /^(seguir|seguindo)$/i.test(l.trim()));
  if (idxSeguir > 0) return idxSeguir;

  // Nome do perfil repetindo o arroba que aparece no topo do card.
  const arrobas = linhas.map(nomeDoArroba).filter(Boolean);
  if (arrobas.length) {
    const usuario = arrobas[0];
    for (let i = linhas.length - 1; i > 0; i--) {
      const s = linhas[i].trim().toLowerCase().replace(/^[@©o0]\s?/, '');
      if (s === usuario) return i;
    }
  }
  return -1;
}

// Uma palavra só, sem espaço nem pontuação de frase: é nome de perfil, não texto
// do post. Some do fim do gancho, onde a linha do perfil encosta no card.
function ehNomeDePerfil(linha) {
  const s = linha.trim();
  return /^[a-z0-9._]{3,30}$/i.test(s) && !/\s/.test(s);
}

// Junta as linhas de um parágrafo respeitando a quebra por linha em branco.
// A OCR devolve uma linha por linha da tela, então sem isso a legenda sairia
// picotada no meio das frases.
function juntarParagrafos(blocos) {
  return blocos
    .map(b => b.map(l => l.trim()).join(' ').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
}

function blocosPorLinhaVazia(linhasBrutas) {
  const blocos = [];
  let atual = [];
  for (const linha of linhasBrutas) {
    if (!linha.trim()) {
      if (atual.length) { blocos.push(atual); atual = []; }
    } else if (!ehChrome(linha) && !ehArroba(linha)) {
      // O arroba sai aqui, na linha: a marca d'água do autor fica colada no
      // gancho, sem linha em branco separando, e no parágrafo já seria tarde.
      atual.push(linha);
    }
  }
  if (atual.length) blocos.push(atual);
  return blocos;
}

// A legenda copiada costuma começar pedindo pra seguir o perfil ORIGINAL. Isso
// não pode ir pro post de quem está reaproveitando — viraria divulgação do
// concorrente. Some a chamada e as menções.
function limparMencoes(texto, handleProprio) {
  const meu = String(handleProprio || '').replace(/^@/, '').toLowerCase();
  return texto
    .split('\n')
    // Só cai fora a chamada que promove OUTRO perfil. A mesma frase apontando
    // para o seu perfil é exatamente o que a legenda deve manter.
    .filter(l => {
      const m = l.match(/^\s*(siga|segue|follow)\b[^\n]{0,80}?@([a-z0-9._]{3,30})/i);
      return !m || m[2].toLowerCase() === meu;
    })
    .join('\n')
    .replace(/@([a-z0-9._]{3,30})/gi, (m, u) => (u.toLowerCase() === meu ? m : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Corta a legenda onde o print cortou. A última frase quase sempre vem pela
// metade (o texto continua fora da tela); deixar o pedaço truncado é pior que
// não ter, porque vai publicado assim.
function cortarFraseIncompleta(texto) {
  const t = texto.trim();
  if (!t || /[.!?…]$/.test(t)) return t;
  const corte = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  return corte > 40 ? t.slice(0, corte + 1).trim() : t;
}

/**
 * Separa o texto lido do print em gancho e legenda. Função pura — é ela que os
 * testes cobrem, porque é aqui que mora a decisão.
 *
 * @param {string} textoBruto  o texto como a OCR devolveu, com as quebras de linha
 * @param {string} handle      o @ de quem vai publicar, usado no CTA final
 * @returns {{headline: string, caption: string, capturou: {gancho: boolean, legenda: boolean}}}
 */
function separarTextoDoPrint(textoBruto, { handle = '@pedro_destrava' } = {}) {
  const brutas = String(textoBruto || '').split('\n');

  // A fronteira é procurada nas linhas cruas — ver acharLinhaDoPerfil.
  const corte = acharLinhaDoPerfil(brutas);

  let ganchoBruto, legendaBruta;
  if (corte >= 0) {
    ganchoBruto = brutas.slice(0, corte);
    legendaBruta = brutas.slice(corte + 1);
  } else {
    // Sem linha de perfil reconhecível: o maior bloco de texto é a legenda, e o
    // que vier antes dele é o gancho.
    const blocos = blocosPorLinhaVazia(brutas);
    if (!blocos.length) {
      return { headline: '', caption: '', capturou: { gancho: false, legenda: false } };
    }
    let maior = 0;
    blocos.forEach((b, i) => {
      if (b.join(' ').length > blocos[maior].join(' ').length) maior = i;
    });
    ganchoBruto = blocos.slice(0, maior).flatMap(b => [...b, '']);
    legendaBruta = blocos.slice(maior).flatMap(b => [...b, '']);
  }

  // Marca d'água do autor no topo do card e o nome do perfil encostado no fim
  // do gancho não fazem parte do texto do post.
  const paragrafosGancho = juntarParagrafos(blocosPorLinhaVazia(ganchoBruto))
    .filter(p => !ehArroba(p) && !ehNomeDePerfil(p));
  const headline = paragrafosGancho.join(' ').replace(/\s{2,}/g, ' ').trim();

  const paragrafosLegenda = juntarParagrafos(blocosPorLinhaVazia(legendaBruta))
    .filter(p => !ehArroba(p) && !ehNomeDePerfil(p));
  const caption = cortarFraseIncompleta(limparMencoes(paragrafosLegenda.join('\n\n'), handle));

  return {
    headline,
    caption,
    capturou: { gancho: !!headline, legenda: !!caption },
  };
}

/**
 * Monta a copy final a partir do que foi lido no print: mantém o texto original
 * (é o conteúdo de verdade, não vale reescrever no chute) e acrescenta o CTA com
 * o SEU perfil mais as hashtags, que é a parte que precisa mudar de dono.
 */
function montarCopyDoPrint({ headline, caption, handle, tema, variante = 0 }) {
  const robo = gerarCopyReel({
    tema: tema || headline,
    headline: headline || '',
    handle,
    variante,
    marcadores: false,
  });

  // Sem legenda legível no print, o robô escreve uma inteira.
  if (!caption) return { headline: robo.headline, caption: robo.caption, fonte: 'robo' };

  // Com legenda lida, aproveita o texto original e troca só o fecho.
  const linhasRobo = robo.caption.split('\n').filter(l => l.trim());
  const cta = linhasRobo[linhasRobo.length - 2] || '';
  const tags = linhasRobo[linhasRobo.length - 1] || '';

  return {
    headline: headline || robo.headline,
    caption: [caption, '', cta, '', tags].join('\n').trim(),
    fonte: 'print',
  };
}

// ── OCR ───────────────────────────────────────────────────────────────────────
// O worker é criado uma vez e reaproveitado: iniciar custa mais que reconhecer.
let _workerPromise = null;

async function obterWorker() {
  if (!_workerPromise) {
    const { createWorker } = require('tesseract.js');
    _workerPromise = createWorker('por', 1, {
      langPath: ASSETS,      // por.traineddata vem no repositório: nada é baixado
      cachePath: os.tmpdir(),
      gzip: false,
      logger: () => {},
    }).catch(e => { _workerPromise = null; throw e; });
  }
  return _workerPromise;
}

/**
 * Lê um print e devolve gancho e legenda.
 * @param {Buffer|string} imagem  buffer ou caminho do arquivo
 */
async function lerPrint(imagem, { handle = '@pedro_destrava', tema, variante = 0 } = {}) {
  const worker = await obterWorker();
  const { data } = await worker.recognize(imagem);

  const bruto = separarTextoDoPrint(data.text, { handle });
  const copy = montarCopyDoPrint({ ...bruto, handle, tema, variante });

  return {
    ...copy,
    confianca: Math.round(data.confidence || 0),
    capturou: bruto.capturou,
    textoLido: data.text,
  };
}

module.exports = {
  lerPrint,
  // exportados para teste
  separarTextoDoPrint,
  montarCopyDoPrint,
  ehChrome,
  cortarFraseIncompleta,
  limparMencoes,
};
