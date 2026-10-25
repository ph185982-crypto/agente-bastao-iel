// Foto aprovada do Pedro para o encerramento do padrão minimalista. Ordem:
//   1) foto enviada e aprovada pelo Pedro no app (guardada no banco, com data de aprovação);
//   2) a foto de perfil já aprovada do app (backend/assets/pedro-perfil.png), em recorte retangular DENTRO do círculo,
//      sem filtro, sem retoque e sem mexer no rosto (só recorte e redimensionamento).
// Se nenhuma estiver disponível, devolve null e o encerramento sai tipográfico, com aviso.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const store = require('./store');

const CHAVE = 'radar:foto-pedro.img';
const ASSET = path.join(__dirname, '..', '..', 'assets', 'pedro-perfil.png');
// recorte 4:5 inscrito no círculo de 600 px (cantos dentro do círculo: nada do fundo branco aparece)
const RECORTE_ASSET = Object.freeze({ left: 135, top: 50, width: 330, height: 412 });

let _asset;
async function obter() {
  try {
    const cfg = await store.config();
    if (cfg?.foto_pedro?.aprovada_em && cfg.foto_pedro.desativada !== true) {
      const a = await store.arquivoObter(CHAVE);
      if (a?.dados) return { buf: a.dados, recorte: cfg.foto_pedro.recorte || null, origem: 'enviada', aprovada_em: cfg.foto_pedro.aprovada_em };
    }
    if (cfg?.foto_pedro?.desativada === true) return null;
  } catch { /* sem banco: segue para a foto do app */ }
  try { _asset ||= fs.readFileSync(ASSET); return { buf: _asset, recorte: RECORTE_ASSET, origem: 'perfil_do_app', aprovada_em: null }; } catch { return null; }
}

// Envio de uma nova foto aprovada (só o Pedro, pelo app). Remove metadados (EXIF/GPS) e guarda o original normalizado.
async function salvar({ buf, recorte = null, agora = Date.now() }) {
  const m = await sharp(buf, { limitInputPixels: 60e6 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(m.format)) throw Object.assign(new Error('Envie a foto em JPG, PNG ou WebP.'), { status: 400, code: 'ENTRADA' });
  if (Math.min(m.width, m.height) < 500) throw Object.assign(new Error(`A foto tem ${m.width}×${m.height} px. Envie uma com pelo menos 500 px no menor lado.`), { status: 400, code: 'ENTRADA' });
  const limpa = await sharp(buf).rotate().jpeg({ quality: 94 }).toBuffer();
  await store.arquivoSalvar(CHAVE, limpa, 'image/jpeg');
  await store.salvarConfig({ foto_pedro: { aprovada_em: new Date(agora).toISOString(), recorte, desativada: false, bytes: limpa.length } });
  return obter();
}

module.exports = { obter, salvar, RECORTE_ASSET, CHAVE };
