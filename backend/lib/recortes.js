// Biblioteca de recortes (rostos em PNG com fundo transparente) para o tema "reportagem".
// O Pedro envia os recortes, com crédito e licença; o app NUNCA gera nem altera um rosto: só escolhe um recorte
// existente pelo nome da pessoa citada na pauta e o aplica em preto e branco (arteReportagem.js).
// Guardado no armazém do servidor (arquivo `recorte:<id>` + índice na configuração da conta).
const crypto = require('crypto');
const sharp = require('sharp');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORTES = 60;
const LADO_MIN = 600;
const LADO_MAX = 1800;
const erro = (msg, code = 'RECORTE', status = 400) => Object.assign(new Error(msg), { code, status });
const conta = () => ACCOUNT.ig_id;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function arm() {
  const a = armazem();
  if (!a || !a.duravel) throw erro('Os recortes precisam do banco de dados no servidor (Cópia no servidor).', 'SEM_BANCO', 409);
  return a;
}

async function listar() {
  const a = armazem();
  if (!a || !a.duravel) return { guardado: false, recortes: [] };
  const cfg = await a.config.obter(conta());
  return { guardado: true, recortes: (cfg.recortes || []).map(({ id, nome, credito, licenca, origem_url, exige_credito, criado_em, largura, altura }) => ({ id, nome, credito, licenca, origem_url, exige_credito, criado_em, largura, altura })) };
}

async function adicionar({ nome, credito, licenca, origem_url = '', exige_credito = true, png }) {
  const a = arm();
  const n = String(nome || '').trim().slice(0, 60);
  if (norm(n).length < 3) throw erro('Diga o nome da pessoa (como aparece nas pautas).');
  const cred = String(credito || '').trim().slice(0, 120);
  const lic = String(licenca || '').trim().slice(0, 120);
  if (!cred || !lic) throw erro('Informe o crédito do fotógrafo e a licença da foto. Sem isso o recorte não entra.');
  if (origem_url && !/^https:\/\//.test(origem_url)) throw erro('O link de origem deve começar com https://.');
  if (!Buffer.isBuffer(png) || !png.length) throw erro('Falta o arquivo do recorte.');
  if (png.length > MAX_BYTES) throw erro('O recorte passa de 8 MB. Reduza o arquivo.');
  let meta;
  try { meta = await sharp(png, { limitInputPixels: 40e6 }).metadata(); } catch { throw erro('O arquivo não é uma imagem válida.'); }
  if (!['png', 'webp'].includes(meta.format)) throw erro('Envie PNG (ou WebP) com fundo transparente.');
  if (!meta.hasAlpha) throw erro('O recorte precisa ter fundo transparente. Use um PNG com o fundo já removido.');
  if (Math.max(meta.width, meta.height) < LADO_MIN) throw erro(`O recorte é pequeno demais (mínimo de ${LADO_MIN} px no lado maior).`);
  let img = sharp(png).ensureAlpha();
  if (Math.max(meta.width, meta.height) > LADO_MAX) img = img.resize(LADO_MAX, LADO_MAX, { fit: 'inside' });
  let saida = await img.png({ compressionLevel: 9 }).toBuffer();
  if (saida.length > 7.5 * 1024 * 1024) saida = await sharp(saida).resize(1400, 1400, { fit: 'inside' }).png({ compressionLevel: 9 }).toBuffer();
  if (saida.length > 7.5 * 1024 * 1024) throw erro('O recorte ficou grande demais mesmo reduzido. Envie um arquivo menor.');
  // Precisa ter transparência de verdade (não um retângulo opaco com canal alfa).
  const { data, info } = await sharp(saida).resize(64, 64, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  let transp = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 20) transp += 1;
  if (transp / (data.length / info.channels) < 0.05) throw erro('O fundo não está transparente (menos de 5% da imagem). Remova o fundo antes de enviar.');
  const id = crypto.createHash('sha1').update(saida).digest('hex').slice(0, 12);
  const cfg = await a.config.obter(conta());
  const lista = (cfg.recortes || []).filter((r) => r.id !== id);
  if (lista.length >= MAX_RECORTES) throw erro(`O limite é de ${MAX_RECORTES} recortes. Remova algum antes.`);
  const m2 = await sharp(saida).metadata();
  const reg = { id, nome: n, credito: cred, licenca: lic, origem_url: String(origem_url || ''), exige_credito: exige_credito !== false, criado_em: new Date().toISOString(), largura: m2.width, altura: m2.height };
  await a.arquivos.salvar(conta(), `recorte:${id}`, saida, 'image/png');
  await a.config.salvar(conta(), { recortes: [...lista, reg] });
  return reg;
}

async function obter(id) {
  const a = armazem();
  if (!a || !a.duravel || !/^[a-f0-9]{12}$/.test(String(id || ''))) return null;
  return (await a.arquivos.obter(conta(), `recorte:${id}`))?.dados || null;
}

async function remover(id) {
  const a = arm();
  const cfg = await a.config.obter(conta());
  await a.config.salvar(conta(), { recortes: (cfg.recortes || []).filter((r) => r.id !== id) });
  // O arquivo fica no armazém (o armazém não tem remoção); sai do índice, então nunca mais é escolhido.
  return { ok: true };
}

// Recortes cuja pessoa é citada no título ou nas afirmações do conteúdo (nome inteiro, em palavras completas).
// Mais de um recorte da mesma pessoa gira entre os slides. Sem nenhum, devolve [] (a arte sai só com a forma).
async function escolherPara(c) {
  const { recortes } = await listar();
  if (!recortes.length) return [];
  const texto = ` ${norm([c.titulo, ...(c.claims || []).map((x) => x.texto), c.fonte_principal && c.fonte_principal.titulo].filter(Boolean).join(' '))} `;
  return recortes.filter((r) => texto.includes(` ${norm(r.nome)} `)).sort((x, y) => String(x.criado_em).localeCompare(String(y.criado_em)));
}

module.exports = { listar, adicionar, obter, remover, escolherPara, norm };
