const express = require('express');
const axios = require('axios');
const { resolverViaSocialkit } = require('../lib/socialkit');

const router = express.Router();

// POST /api/download — resolve o link direto do vídeo de um post do Instagram.
// socialkit.dev é o caminho principal; a RapidAPI (se configurada) fica de
// reserva e devolve a resposta bruta dela (formato diferente — nenhum
// consumidor atual depende do formato exato desta rota).
router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'URL do Instagram é obrigatória' });
  }

  if (process.env.SOCIALKIT_API_KEY) {
    try {
      const info = await resolverViaSocialkit(url);
      return res.json({ success: true, data: info });
    } catch (e) {
      if (!process.env.RAPIDAPI_KEY) {
        return res.status(500).json({ error: e.message });
      }
      console.warn('[download] socialkit.dev falhou, caindo pro RapidAPI:', e.message?.slice(0, 120));
    }
  }

  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'Nenhum serviço de download configurado (SOCIALKIT_API_KEY ou RAPIDAPI_KEY)' });
  }

  try {
    const response = await axios.get(
      'https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert',
      {
        params: { url: url.trim() },
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host':
            'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        },
        timeout: 30000,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Download error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Erro ao processar URL do Instagram',
      details: error.response?.data || error.message,
    });
  }
});

// GET /api/download/proxy?videoUrl=...&filename=... — repassa um arquivo de mídia para
// o navegador baixar. Só aceita https nos CDNs da Meta (Instagram/Facebook): antes
// aceitava qualquer endereço e dava para ler a rede interna do servidor (SSRF).
// Valida o endereço no momento da conexão e não segue redirecionamento.
const CDN_META = /(^|\.)(cdninstagram\.com|fbcdn\.net|fbsbx\.com)$/i;
const { validaUrl, lookupSeguro } = require('../lib/safeFetch');

function urlDeMidia(texto) {
  const u = validaUrl(texto);
  if (u.protocol !== 'https:') throw Object.assign(new Error('Só links https são aceitos.'), { isUrlError: true });
  if (!CDN_META.test(u.hostname)) throw Object.assign(new Error('Só arquivos dos servidores do Instagram e do Facebook podem ser baixados por aqui.'), { isUrlError: true });
  return u;
}

router.get('/proxy', async (req, res) => {
  const { videoUrl, filename } = req.query;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl é obrigatória' });
  }

  let alvo;
  try { alvo = urlDeMidia(videoUrl); } catch (e) { return res.status(400).json({ error: e.message }); }

  // Sanitise filename to prevent header injection
  const safeFilename = String(filename || 'instagram_media').replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120);

  try {
    const response = await axios.get(alvo.toString(), {
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 0,
      httpsAgent: new (require('https').Agent)({ lookup: lookupSeguro() }),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.instagram.com/',
      },
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    if (!/^(video|image|audio)\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
      response.data.destroy();
      return res.status(415).json({ error: 'O endereço não é um arquivo de vídeo ou imagem.' });
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy download error:', error.message);
    res.status(500).json({ error: 'Erro ao baixar o arquivo' });
  }
});

module.exports = router;
