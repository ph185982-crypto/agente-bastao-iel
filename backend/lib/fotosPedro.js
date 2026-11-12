// Fotos do Pedro para as capas. Ele envia pelo celular em Perfil → Minhas histórias e casos; as linhas próprias (história, como
// fazer, caso) e a opinião usam uma delas na capa, em rodízio (a menos usada primeiro). Foto de banco de imagens trazia gente
// e cenário de fora (nota de dólar, aplicativo em inglês); o rosto dele é o que o público reconhece.
// Guardadas em pico_arquivos: `foto_pedro:<id>` (até 1600 px) e `foto_pedro_mini:<id>` (miniatura da tela).
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const PREFIXO = 'foto_pedro:'; const MINI = 'foto_pedro_mini:'; const MAX_FOTOS = 20; const LADO = 1600;
const conta = () => ACCOUNT.ig_id;
const erro = (msg, status = 400, code = 'FOTO') => Object.assign(new Error(msg), { status, code });
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('As fotos precisam do banco de dados no servidor.', 503, 'SEM_BANCO'); return a; };
const ID = /^[a-f0-9]{12}$/;

async function ids(a) { return (await a.arquivos.listar(conta())).filter((f) => String(f.chave).startsWith(PREFIXO)).map((f) => ({ id: String(f.chave).slice(PREFIXO.length), criado_em: f.criado_em || null, tamanho: f.tamanho })); }
async function usos(a) { return (await a.config.obter(conta())).fotos_pedro_uso || {}; }

async function listar() {
  const a = armazem(); if (!a?.duravel) return { fotos: [], max: MAX_FOTOS };
  const u = await usos(a); const fotos = [];
  for (const f of await ids(a)) {
    const m = await a.arquivos.obter(conta(), `${MINI}${f.id}`).catch(() => null);
    fotos.push({ id: f.id, usos: u[f.id] || 0, criado_em: f.criado_em, mini: m ? `data:image/jpeg;base64,${Buffer.from(m.dados).toString('base64')}` : null });
  }
  return { fotos: fotos.sort((p, q) => String(q.criado_em || '').localeCompare(String(p.criado_em || ''))), max: MAX_FOTOS };
}

// Aceita o arquivo (Buffer) ou um data URL de imagem. Corrige a rotação do celular, limita a 1600 px e grava em JPEG.
async function enviar(entrada) {
  const a = db(); const sharp = require('sharp');
  let buf = entrada;
  if (typeof entrada === 'string') { const m = /^data:image\/(?:jpeg|jpg|png|webp|heic|heif);base64,([A-Za-z0-9+/=]+)$/.exec(entrada); if (!m) throw erro('Envie uma imagem (JPG, PNG ou WebP).'); buf = Buffer.from(m[1], 'base64'); }
  if (!Buffer.isBuffer(buf) || buf.length < 200) throw erro('A imagem veio vazia.');
  if ((await ids(a)).length >= MAX_FOTOS) throw erro(`O limite é de ${MAX_FOTOS} fotos. Apague uma para enviar outra.`, 409, 'LIMITE');
  let foto; let mini; let meta;
  try {
    meta = await sharp(buf).metadata();
    foto = await sharp(buf).rotate().resize({ width: LADO, height: LADO, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    mini = await sharp(buf).rotate().resize(240, 300, { fit: 'cover', position: 'attention' }).jpeg({ quality: 72 }).toBuffer();
  } catch { throw erro('Não consegui ler essa imagem. Tente outra foto ou tire um print dela.'); }
  if (Math.min(meta.width || 0, meta.height || 0) < 600) throw erro('A foto é pequena demais para a capa (mínimo de 600 px no menor lado).');
  const id = crypto.randomBytes(6).toString('hex');
  await a.arquivos.salvar(conta(), `${PREFIXO}${id}`, foto, 'image/jpeg');
  await a.arquivos.salvar(conta(), `${MINI}${id}`, mini, 'image/jpeg');
  return { id, usos: 0, mini: `data:image/jpeg;base64,${mini.toString('base64')}` };
}

async function apagar(id) {
  if (!ID.test(String(id))) throw erro('Identificador inválido.');
  const a = db(); const n = await a.arquivos.apagar(conta(), [`${PREFIXO}${id}`, `${MINI}${id}`]);
  if (!n) throw erro('Foto não encontrada.', 404, 'NAO_ENCONTRADA');
  const u = await usos(a); if (u[id] != null) { delete u[id]; await a.config.salvar(conta(), { fotos_pedro_uso: u }); }
  return { id, apagada: true };
}

// A próxima foto do rodízio: a menos usada (empate: a mais antiga). Devolve no formato das fotos do pipeline, ou null.
async function proxima() {
  const a = armazem(); if (!a?.duravel) return null;
  const lista = await ids(a); if (!lista.length) return null;
  const u = await usos(a);
  const esc = [...lista].sort((p, q) => (u[p.id] || 0) - (u[q.id] || 0) || String(p.criado_em || '').localeCompare(String(q.criado_em || '')))[0];
  const arq = await a.arquivos.obter(conta(), `${PREFIXO}${esc.id}`); if (!arq) return null;
  await a.config.salvar(conta(), { fotos_pedro_uso: { ...u, [esc.id]: (u[esc.id] || 0) + 1 } });
  return { dados: Buffer.from(arq.dados), meta: { id: `fp_${esc.id}`, tipo: 'foto_pedro', autor: null, licenca: 'Foto do próprio Pedro, enviada por ele para uso no perfil', exige_credito: false, origem: 'Acervo do Pedro (enviada em Perfil → Minhas histórias e casos)' } };
}

module.exports = { PREFIXO, MINI, MAX_FOTOS, listar, enviar, apagar, proxima };
