const express = require('express');
const axios = require('axios');

const router = express.Router();

// POST /api/download — fetch video info from RapidAPI
router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'URL do Instagram é obrigatória' });
  }

  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
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

// GET /api/download/proxy?videoUrl=...&filename=... — proxy any media file for browser download
router.get('/proxy', async (req, res) => {
  const { videoUrl, filename } = req.query;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl é obrigatória' });
  }

  // Sanitise filename to prevent header injection
  const safeFilename = (filename || 'instagram_media').replace(/[^a-zA-Z0-9._\-]/g, '_');

  try {
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.instagram.com/',
      },
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

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
