// Gera o logotipo do app (static/logo-app.svg) e os ícones PNG na identidade da marca.
// Marca do app: "[P]" em branco quente sobre azul, colchetes em laranja. Texto convertido em caminho com a Manrope real
// (nada depende de fonte instalada). Uso: node scripts/gerar-icones.js
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const sharp = require('sharp');
const RAIZ = path.join(__dirname, '..');
const AZUL = '#2448FF', PAPEL = '#F6F5F0', LARANJA = '#FF7043';
const fonte = opentype.loadSync(path.join(RAIZ, 'backend/assets/Manrope-ExtraBold.ttf'));

function svg({ tamanho = 512, arredondado = true }) {
  const t = 512;
  const glifo = fonte.getPath('P', 0, 0, 300);
  const b = glifo.getBoundingBox();
  const gx = (t - (b.x2 - b.x1)) / 2 - b.x1, gy = (t - (b.y2 - b.y1)) / 2 - b.y1 + 0;
  const d = fonte.getPath('P', gx, gy, 300).toPathData(2);
  const colchete = (x, dir) => `<path d="M${x + dir * 52} 118H${x}V394H${x + dir * 52}" fill="none" stroke="${LARANJA}" stroke-width="30" stroke-linecap="square" stroke-linejoin="miter"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 ${t} ${t}"><rect width="${t}" height="${t}" ${arredondado ? 'rx="112" ' : ''}fill="${AZUL}"/>${colchete(96, 1)}${colchete(416, -1)}<path d="${d}" fill="${PAPEL}"/></svg>`;
}

(async () => {
  fs.writeFileSync(path.join(RAIZ, 'static/logo-app.svg'), svg({ arredondado: true }));
  // Ícones PNG sem cantos arredondados: o iOS e o Android aplicam a própria máscara.
  const cheio = Buffer.from(svg({ arredondado: false }));
  for (const [nome, px] of [['app-icon-180', 180], ['app-icon-192', 192], ['app-icon-512', 512], ['icon-180', 180], ['icon-192', 192], ['icon-512', 512]]) {
    await sharp(cheio, { density: 300 }).resize(px, px).png().toFile(path.join(RAIZ, 'static', `${nome}.png`));
  }
  console.log('Logotipo e ícones gerados.');
})();
