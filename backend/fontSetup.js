// Vercel serverless não tem fontes de sistema, então o texto dos SVGs do
// sharp/librsvg sai como quadradinhos. Este módulo aponta o fontconfig para
// as fontes do repositório (backend/assets) antes de qualquer render.
// Deve ser carregado ANTES do primeiro uso de texto no sharp.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'assets');
const CACHE_DIR  = path.join(os.tmpdir(), 'fonts-cache');
const CONF_PATH  = path.join(os.tmpdir(), 'fonts.conf');

if (!process.env.FONTCONFIG_FILE) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CONF_PATH, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${ASSETS_DIR}</dir>
  <cachedir>${CACHE_DIR}</cachedir>
</fontconfig>
`);
    process.env.FONTCONFIG_FILE = CONF_PATH;
  } catch (e) {
    console.warn('[fontSetup] não foi possível configurar fontes:', e.message);
  }
}
