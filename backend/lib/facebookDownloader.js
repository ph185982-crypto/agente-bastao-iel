// ── Download de Reels/vídeos do Facebook via RapidAPI ─────────────────────────
// Complementa o socialkit.dev (que só resolve Instagram): quando o link colado
// é do facebook.com/fb.watch, entra por aqui.
//
// Particularidade da API: link inválido, vídeo privado ou post sem vídeo
// devolvem HTTP 200 com success:false — não é erro de transporte, é o corpo
// da resposta que avisa. Por isso a checagem de sucesso é sobre o CONTEÚDO,
// não só o status HTTP (mesmo padrão do socialkit.js).

const axios = require('axios');

const BASE_URL = 'https://facebook-reel-and-video-downloader.p.rapidapi.com/app/main.php';
const HOST = 'facebook-reel-and-video-downloader.p.rapidapi.com';

// Erro de negócio já em português, pronto pra sair pro usuário — mesmo padrão
// usado em socialkit.js e videoEditor.js (isDownloadError evita que a
// mensagem seja traduzida de novo como se fosse erro de IA).
function erroDownload(msg) {
  const e = new Error(msg);
  e.isDownloadError = true;
  return e;
}

// Traduz um erro de TRANSPORTE (a chamada HTTP falhou) pra mensagem em
// português. Função pura — não faz rede, só olha o formato do erro do axios.
function interpretarErroHttp(err) {
  const status = err?.response?.status;

  if (status === 401 || status === 403) {
    return erroDownload('A chave da API do Facebook foi recusada. Verifique a RAPIDAPI_KEY_FACEBOOK.');
  }
  if (status === 429) {
    return erroDownload('A API do Facebook está recebendo pedidos demais ou a cota acabou. Espere um pouco, ou renove o plano no RapidAPI.');
  }
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return erroDownload('O download demorou demais pra responder. Tente de novo.');
  }
  return erroDownload('Não consegui falar com o serviço de download do Facebook agora. Tente de novo em instantes.');
}

// Traduz o CORPO da resposta (a chamada HTTP deu certo) pro formato que o
// resto do app usa, ou lança erro em português quando não veio vídeo.
// Função pura — é aqui que mora a particularidade de success:false sem
// status HTTP de erro, e as várias formas que a API tem de devolver o link
// (media[].hd_url/sd_url, ou o mapa "links").
function interpretarResposta(data) {
  if (data?.error) {
    throw erroDownload(`Download recusado: ${data.error}`);
  }
  if (!data?.success) {
    throw erroDownload('Não encontrei vídeo nesse link. Confirme que o post é público e que o link está certo.');
  }

  const media = Array.isArray(data.media) ? data.media[0] : null;
  const links = data.links || {};
  const videoUrl =
    media?.hd_url || media?.sd_url ||
    links['Download High Quality'] || links['Download Low Quality'] ||
    Object.values(links)[0] || '';

  if (!videoUrl) {
    throw erroDownload('Não encontrei vídeo nesse link. Confirme que o post é público e que o link está certo.');
  }

  return {
    videoUrl,
    thumbnail: data.thumbnail || '',
    caption: data.title || '',
    width: media?.width || 0,
    height: media?.height || 0,
  };
}

/**
 * Resolve um link de post/reel do Facebook pro link direto do vídeo, via
 * RapidAPI (facebook-reel-and-video-downloader). Lança erroDownload() com
 * mensagem em português pronta pro usuário quando não dá certo.
 *
 * @param {string} facebookUrl
 * @returns {Promise<{videoUrl: string, thumbnail: string, caption: string, width: number, height: number}>}
 */
async function resolverViaFacebook(facebookUrl) {
  const key = process.env.RAPIDAPI_KEY_FACEBOOK || process.env.RAPIDAPI_KEY;
  if (!key) throw erroDownload('RAPIDAPI_KEY_FACEBOOK não configurada no servidor.');

  let resp;
  try {
    resp = await axios.get(BASE_URL, {
      params: { url: facebookUrl.trim() },
      headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': key },
      timeout: 25000,
    });
  } catch (err) {
    throw interpretarErroHttp(err);
  }

  return interpretarResposta(resp.data);
}

module.exports = {
  resolverViaFacebook,
  erroDownload,
  // exportados para teste
  interpretarErroHttp,
  interpretarResposta,
};
