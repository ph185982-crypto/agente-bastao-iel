// Imagens do Radar. Ordem de preferência (pedido do Pedro): 1) imagem de divulgação do site oficial da empresa;
// 2) fotografia publicada pela própria empresa; 3) captura de tela do produto; 4) foto documental do problema;
// 5) banco de imagens, só quando não há material real; 6) IA só como ilustração, nunca como prova.
// Este módulo faz o item 1 (a imagem que o próprio site oficial declara para divulgação: og:image / twitter:image) e,
// opcionalmente, o item 5 (Pexels, marcado "imagem ilustrativa"). Não há captura de tela nem imagem gerada por IA.
// Cada imagem guarda a ORIGEM (página, endereço da imagem, data, hash) e nada que não seja do negócio vira "foto do negócio".
const sharp = require('sharp');
const crypto = require('crypto');
const { safeFetch } = require('../safeFetch');
const feeds = require('../feeds');
const U = require('./util');

const TIPOS_IMG = [/^image\/(jpeg|jpg|png|webp)/i, /^application\/octet-stream/i];
const LADO_MIN = 600;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const attr = (tag, nome) => { const m = String(tag).match(new RegExp(`${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? feeds.decodifica(m[2] ?? m[3] ?? m[4] ?? '').trim() : ''; };

// Endereços de imagem de divulgação declarados na página, em ordem de preferência.
function imagensDeDivulgacao(html, base) {
  const achadas = [];
  const re = /<(meta|link)\b[^>]*>/gi; let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const chave = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || attr(tag, 'rel')).toLowerCase();
    const valor = attr(tag, m[1].toLowerCase() === 'link' ? 'href' : 'content');
    if (!valor) continue;
    const peso = { 'og:image:secure_url': 1, 'og:image': 2, 'twitter:image': 3, 'twitter:image:src': 3, image: 4, image_src: 5 }[chave];
    if (!peso) continue;
    try { achadas.push({ url: new URL(valor, base).toString(), peso }); } catch { /* endereço inválido */ }
  }
  return [...new Map(achadas.sort((a, b) => a.peso - b.peso).map((a) => [a.url, a])).values()].map((a) => a.url).slice(0, 4);
}

// Aceita só imagem de verdade: formato comum, tamanho suficiente, proporção de foto (não ícone nem faixa).
async function validar(buf) {
  let meta;
  try { meta = await sharp(buf, { limitInputPixels: 60e6 }).metadata(); } catch { return { ok: false, motivo: 'o arquivo não é uma imagem válida' }; }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) return { ok: false, motivo: `formato não aceito (${meta.format})` };
  const [w, h] = meta.orientation && meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (Math.max(w, h) < LADO_MIN || Math.min(w, h) < 315) return { ok: false, motivo: `imagem pequena demais (${w}×${h})` };
  const prop = w / h;
  if (prop < 0.55 || prop > 2.8) return { ok: false, motivo: 'proporção que não é de fotografia' };
  return { ok: true, largura: w, altura: h, formato: meta.format };
}

async function baixarImagem(url, { fetcher = safeFetch } = {}) {
  const r = await fetcher(url, { timeoutMs: 10000, maxBytes: 8 * 1024 * 1024, tipos: TIPOS_IMG, binario: true, accept: 'image/avif,image/webp,image/jpeg,image/png;q=0.9' });
  if (r.status >= 400 || r.acesso_negado) throw new Error(`HTTP ${r.status}`);
  return Buffer.isBuffer(r.corpo) ? r.corpo : Buffer.from(r.corpo || '', 'binary');
}

// Item 1: imagem do site oficial já verificado. `cand.verificacao.fontes` traz as páginas lidas; só uma página classe 'oficial' vale.
async function doSiteOficial(cand, { deps = {}, agora = Date.now() } = {}) {
  const pagina = (cand.verificacao?.fontes || []).find((f) => f.classe === 'oficial' && f.papel === 'oficial');
  if (!pagina) return { ok: false, motivo: 'não há página oficial confirmada para tirar a imagem' };
  const fetcher = deps.fetcher || safeFetch;
  let html;
  try { const r = await fetcher(pagina.url, { timeoutMs: 10000, maxBytes: 1.5 * 1024 * 1024 }); if (r.status >= 400) throw new Error(`HTTP ${r.status}`); html = r.corpo; } catch (e) { return { ok: false, motivo: `não consegui reabrir o site oficial (${U.limita(e.message, 60)})` }; }
  const candidatos = imagensDeDivulgacao(html, pagina.url);
  if (!candidatos.length) return { ok: false, motivo: 'o site oficial não declara imagem de divulgação' };
  const recusadas = [];
  for (const url of candidatos) {
    try {
      const buf = await baixarImagem(url, { fetcher });
      const v = await validar(buf);
      if (!v.ok) { recusadas.push({ url, motivo: v.motivo }); continue; }
      const marca = /logo|brand|wordmark|favicon|icon/i.test(url.split('?')[0].split('/').pop() || '');
      return {
        ok: true, buf,
        imagem: {
          tipo: marca ? 'oficial_marca' : 'oficial_pagina',
          descricao: marca ? 'Arte de divulgação do site oficial (parece ser a marca da empresa, não uma foto)' : 'Imagem de divulgação publicada no site oficial da empresa',
          origem: { url_imagem: url, url_pagina: pagina.url, dominio: pagina.dominio || U.host(pagina.url), consultado_em: new Date(agora).toISOString(), sha256: sha256(buf), largura: v.largura, altura: v.altura, formato: v.formato },
          licenca: 'Imagem publicada pelo próprio site da empresa. Confirme o direito de uso antes de postar; use somente para ilustrar este negócio.',
          credito: pagina.dominio || U.host(pagina.url), real: !marca, recusadas,
        },
      };
    } catch (e) { recusadas.push({ url, motivo: U.limita(e.message, 80) }); }
  }
  return { ok: false, motivo: 'nenhuma imagem do site oficial passou na conferência', recusadas };
}

// Item 5 (opcional): Pexels, só com a chave configurada. Sempre "imagem ilustrativa" e nunca na capa nem como produto.
async function doBanco(consulta, { deps = {}, agora = Date.now() } = {}) {
  const chave = deps.pexelsKey !== undefined ? deps.pexelsKey : process.env.PEXELS_API_KEY;
  if (!chave) return { ok: false, motivo: 'banco de imagens não configurado' };
  try {
    const fetcher = deps.fetcherBanco || require('axios').get;
    const r = await fetcher(`https://api.pexels.com/v1/search?query=${encodeURIComponent(consulta)}&per_page=3&orientation=landscape`, { headers: { Authorization: chave }, timeout: 8000 });
    const foto = (r.data?.photos || [])[0];
    if (!foto) return { ok: false, motivo: 'o banco não devolveu foto' };
    const url = foto.src?.large2x || foto.src?.large;
    const buf = deps.baixar ? await deps.baixar(url) : (await require('axios').get(url, { responseType: 'arraybuffer', timeout: 10000 })).data;
    const b = Buffer.from(buf); const v = await validar(b);
    if (!v.ok) return { ok: false, motivo: v.motivo };
    return { ok: true, buf: b, imagem: { tipo: 'banco_de_imagens', descricao: 'Imagem ilustrativa de banco de imagens (não mostra o negócio)', origem: { url_imagem: url, url_pagina: foto.url, dominio: 'pexels.com', consultado_em: new Date(agora).toISOString(), sha256: sha256(b), largura: v.largura, altura: v.altura }, licenca: 'Licença Pexels (uso livre, crédito apreciado).', credito: `${foto.photographer || 'Pexels'} / Pexels`, real: false } };
  } catch (e) { return { ok: false, motivo: `banco de imagens indisponível (${U.limita(e.message, 60)})` }; }
}

// Busca a melhor imagem disponível. `papel: 'negocio'` = precisa mostrar o negócio (só vale item 1); `papel: 'ilustracao'` aceita banco.
async function buscar(cand, { papel = 'negocio', deps = {}, agora = Date.now() } = {}) {
  const oficial = await doSiteOficial(cand, { deps, agora });
  if (oficial.ok) return oficial;
  if (papel === 'ilustracao') { const b = await doBanco(cand.problema || cand.resumo || cand.nome, { deps, agora }); if (b.ok) return b; return { ok: false, motivo: `${oficial.motivo}; ${b.motivo}`, recusadas: oficial.recusadas }; }
  return oficial;
}

// Guarda uma cópia reduzida (JPEG) no armazém e devolve o registro sem o buffer.
async function guardar(store, opId, achado) {
  const jpg = await sharp(achado.buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const chave = `img:${opId}.jpg`;
  await store.arquivoSalvar(chave, jpg, 'image/jpeg');
  return { ...achado.imagem, arquivo: chave, bytes: jpg.length, buf_ok: true };
}

// A imagem combina com o negócio? Regra de código: só vale a que veio do site oficial confirmado ou o banco rotulado ilustrativo.
function relacionada(imagem, cand, { slide = 1 } = {}) {
  if (!imagem || !imagem.arquivo) return { ok: false, motivo: 'sem imagem' };
  if (imagem.tipo === 'banco_de_imagens') return slide === 1 || slide === 3 ? { ok: false, motivo: 'imagem de banco não pode representar o negócio na capa nem na tela do produto' } : { ok: true, ilustrativa: true };
  const dominioPagina = imagem.origem?.dominio;
  const oficial = (cand.verificacao?.fontes || []).some((f) => f.classe === 'oficial' && f.papel === 'oficial' && (f.dominio === dominioPagina || U.host(f.url) === dominioPagina));
  if (!oficial) return { ok: false, motivo: 'a imagem não vem do site oficial confirmado do negócio' };
  return { ok: true, ilustrativa: false };
}

module.exports = { buscar, guardar, relacionada, validar, imagensDeDivulgacao, doSiteOficial, doBanco, baixarImagem };
