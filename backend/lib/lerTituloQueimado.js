// ── Ler o título queimado no vídeo (sem IA) ────────────────────────────────────
// Muitos vídeos de repost já vêm com um título/gancho editorial escrito numa
// banda de cor sólida acima ou abaixo da filmagem (ex: uma faixa branca com uma
// citação). O objetivo aqui é LER esse texto e devolvê-lo tal como está — o
// usuário quer copiar, não reescrever.
//
// A peça que faltava já existia: detectMotionRegion() (em videoEditor.js) acha
// onde a FILMAGEM está, por movimento — texto e faixa de título ficam parados,
// filmagem se mexe. O que sobra fora dessa região é candidato a título. Só
// precisa ler esse pedaço com OCR — não precisa de IA de visão pra isso.

const sharp = require('sharp');
const { ehChrome, lerLinhas } = require('./lerPrint');

// Banda menor que isso da altura do frame não vale a pena ler — normalmente é
// só a barra de status do celular, não cabe título nenhum ali.
const FRACAO_MINIMA_BANDA = 0.03;

/**
 * Calcula as bandas (fora da região onde o vídeo passa) que valem a pena ler.
 * Função pura — não abre imagem nenhuma, só faz conta com os números da região
 * já detectada por movimento.
 *
 * @param {number} vh               altura do frame original
 * @param {{cropY:number, cropH:number}|null} regiaoConteudo  onde a filmagem está
 * @returns {Array<{top:number, height:number, posicao:'topo'|'base'}>}
 */
function calcularBandas(vh, regiaoConteudo) {
  if (!regiaoConteudo || !vh) return [];
  const { cropY, cropH } = regiaoConteudo;
  const minima = Math.round(vh * FRACAO_MINIMA_BANDA);
  const bandas = [];

  if (cropY >= minima) bandas.push({ top: 0, height: cropY, posicao: 'topo' });

  const alturaBase = vh - (cropY + cropH);
  if (alturaBase >= minima) bandas.push({ top: cropY + cropH, height: alturaBase, posicao: 'base' });

  return bandas;
}

// Marca d'água do autor (@perfil) e hashtag solta não são título — mesmo lixo
// que o leitor de print já sabe filtrar, mais os dois casos específicos daqui.
function ehLixoDeVideo(linha) {
  const s = String(linha || '').trim();
  if (!s) return true;
  if (ehChrome(s)) return true;
  if (/^[@©O0]\s?[a-z0-9._]{3,30}$/i.test(s)) return true;   // @perfil sozinho
  if (/^#[\wà-ú]+$/i.test(s)) return true;                    // hashtag sozinha
  if (/^\d{1,2}\s*\/\s*\d{1,2}$/.test(s)) return true;        // contador de carrossel
  return false;
}

/**
 * Junta as linhas lidas de UMA banda no texto candidato a título. Função pura.
 * @param {Array<{texto:string}>} linhas  saída de lerLinhas().linhas
 */
function montarCandidato(linhas) {
  const uteis = (linhas || [])
    .map(l => String(l.texto || '').trim())
    .filter(t => t && !ehLixoDeVideo(t));
  return uteis.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Lê o título queimado no frame, se houver. Devolve o texto cru (sem os
 * filtros finais de tamanho/formato — isso fica por conta de quem chama,
 * como já faz cleanBakedHeadline() em videoEditor.js) ou '' quando não achou
 * banda que valha a pena ler, ou quando não sobrou texto de verdade nela.
 *
 * @param {string} framePath        caminho do frame extraído do vídeo
 * @param {number} vw               largura do frame
 * @param {number} vh               altura do frame
 * @param {{cropY:number, cropH:number}|null} regiaoConteudo
 * @returns {Promise<string>}
 */
async function lerTituloQueimado(framePath, vw, vh, regiaoConteudo) {
  const bandas = calcularBandas(vh, regiaoConteudo);
  if (!bandas.length) return '';

  let melhor = '';
  for (const banda of bandas) {
    try {
      const buf = await sharp(framePath)
        .extract({ left: 0, top: banda.top, width: vw, height: banda.height })
        .toBuffer();
      const { linhas } = await lerLinhas(buf);
      const candidato = montarCandidato(linhas);
      if (candidato.length > melhor.length) melhor = candidato;
    } catch (e) {
      console.warn(`[lerTituloQueimado] banda "${banda.posicao}" falhou:`, e.message?.slice(0, 100));
    }
  }
  return melhor;
}

module.exports = {
  lerTituloQueimado,
  // exportados para teste
  calcularBandas,
  montarCandidato,
  ehLixoDeVideo,
};
