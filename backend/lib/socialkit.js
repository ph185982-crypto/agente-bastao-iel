// ── Download de Reels via socialkit.dev ───────────────────────────────────────
// Substitui as APIs de download do Instagram na RapidAPI (que paravam de
// funcionar sem aviso — cota esgotada, assinatura cancelada, endpoint fora do
// ar). Uma chamada só devolve o link direto do vídeo (CDN da Meta) e os
// metadados do post — não precisa de uma segunda chamada pra resolver nada.
//
// Particularidade importante da API: link inválido, post privado ou post sem
// vídeo (foto solta) devolvem HTTP 200 com success:true, só que com os campos
// vazios. Erro de verdade (chave errada, cota estourada) é que vem com
// success:false ou status HTTP de erro. Por isso a checagem de sucesso aqui é
// sobre o CONTEÚDO da resposta, não só o status HTTP.

const axios = require('axios');

const BASE_URL = 'https://api.socialkit.dev/instagram/stats';

// Erro de negócio já em português, pronto pra sair pro usuário — mesmo padrão
// usado em videoEditor.js (isDownloadError evita que a mensagem seja traduzida
// de novo como se fosse erro de IA).
function erroDownload(msg) {
  const e = new Error(msg);
  e.isDownloadError = true;
  return e;
}

// Traduz um erro de TRANSPORTE (a chamada HTTP falhou) pra mensagem em
// português. Função pura — não faz rede, só olha o formato do erro do axios.
function interpretarErroHttp(err) {
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.message || '').toLowerCase();

  if (status === 401 || /access key|unauthorized/.test(msg)) {
    return erroDownload('A chave da socialkit.dev foi recusada. Verifique a SOCIALKIT_API_KEY.');
  }
  if (status === 429 || /rate limit|too many/.test(msg)) {
    return erroDownload('A socialkit.dev está recebendo pedidos demais no momento. Espere um pouco e tente de novo.');
  }
  if (status === 402 || /credit|quota|insufficient/.test(msg)) {
    return erroDownload('A cota da socialkit.dev acabou. É preciso renovar o plano pra voltar a baixar.');
  }
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return erroDownload('O download demorou demais pra responder. Tente de novo.');
  }
  return erroDownload('Não consegui falar com o serviço de download agora. Tente de novo em instantes.');
}

// Traduz o CORPO da resposta (a chamada HTTP deu certo) pro formato que o
// resto do app usa, ou lança erro em português quando não veio vídeo. Função
// pura — é aqui que mora a particularidade de success:true com campos vazios.
function interpretarResposta(data) {
  if (!data?.success) {
    throw erroDownload(data?.message ? `Download recusado: ${data.message}` : 'Não consegui processar esse link.');
  }

  const info = data.data || {};
  if (!info.videoUrl) {
    if (info.isVideo === false && info.contentType && info.contentType !== 'reel') {
      throw erroDownload('Esse link não é de um vídeo — é um post de foto. Cole o link de um Reels ou vídeo.');
    }
    throw erroDownload('Não encontrei vídeo nesse link. Confirme que o post é público e que o link está certo.');
  }

  const [min, sec] = String(info.duration || '0:0').split(':').map(Number);
  return {
    videoUrl: info.videoUrl,
    thumbnail: info.thumbnail || '',
    durationSec: (Number.isFinite(min) ? min * 60 : 0) + (Number.isFinite(sec) ? sec : 0),
    caption: info.description || '',
    author: info.author || '',
  };
}

/**
 * Resolve um link de post/reel do Instagram pro link direto do vídeo, via
 * socialkit.dev. Lança erroDownload() com mensagem em português pronta pro
 * usuário quando não dá certo.
 *
 * @param {string} instagramUrl
 * @returns {Promise<{videoUrl: string, thumbnail: string, durationSec: number, caption: string, author: string}>}
 */
async function resolverViaSocialkit(instagramUrl) {
  const key = process.env.SOCIALKIT_API_KEY;
  if (!key) throw erroDownload('SOCIALKIT_API_KEY não configurada no servidor.');

  let resp;
  try {
    resp = await axios.get(BASE_URL, {
      params: { access_key: key, url: instagramUrl.trim() },
      timeout: 25000,
    });
  } catch (err) {
    throw interpretarErroHttp(err);
  }

  return interpretarResposta(resp.data);
}

module.exports = {
  resolverViaSocialkit,
  erroDownload,
  // exportados para teste
  interpretarErroHttp,
  interpretarResposta,
};
