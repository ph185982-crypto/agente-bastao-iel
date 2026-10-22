// Abre um arquivo de mídia (vídeo/imagem) por link SEM deixar o servidor ser usado
// para ler a rede interna (SSRF). Vale para links que chegam do navegador
// (link direto do vídeo, prévia, aprovar reel).
//  - só http/https nas portas 80/443, sem usuário/senha, sem localhost/IP interno;
//  - o endereço é conferido NA CONEXÃO (DNS que aponta para IP interno é recusado);
//  - redirecionamentos são seguidos à mão e cada destino é revalidado.
const http = require('http');
const https = require('https');
const axios = require('axios');
const { validaUrl, lookupSeguro } = require('./safeFetch');

const MAX_REDIRECTS = 5;

async function abrirStream(url, { timeout = 60000, headers = {}, maxRedirects = MAX_REDIRECTS, resolver } = {}) {
  let atual = String(url || '').trim();
  for (let i = 0; i <= maxRedirects; i++) {
    const u = validaUrl(atual);
    const lookup = lookupSeguro(resolver);
    const resp = await axios.get(u.toString(), {
      responseType: 'stream',
      timeout,
      headers,
      maxRedirects: 0,
      // O DNS deve passar pelo lookup seguro abaixo, nunca pelo proxy do Axios.
      proxy: false,
      validateStatus: (s) => s >= 200 && s < 400,
      httpAgent: new http.Agent({ lookup }),
      httpsAgent: new https.Agent({ lookup }),
    });
    if (resp.status >= 300) {
      const loc = resp.headers.location;
      resp.data.destroy();
      if (!loc) throw Object.assign(new Error('Redirecionamento sem destino.'), { isUrlError: true });
      atual = new URL(loc, u).toString();
      continue;
    }
    return resp;
  }
  throw Object.assign(new Error('Redirecionamentos demais.'), { isUrlError: true });
}

// Baixa para um arquivo. Mesmo contrato dos streamDownload antigos.
function baixarParaArquivo(url, destPath, opts) {
  const fs = require('fs');
  return abrirStream(url, opts).then((resp) => new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    resp.data.on('error', (err) => { writer.destroy(); reject(err); });
  }));
}

module.exports = { abrirStream, baixarParaArquivo };
