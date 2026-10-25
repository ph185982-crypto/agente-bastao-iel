// Imagens da série "Negócios que você não viu". Ordem de preferência (pedido do Pedro):
//   1. produto ou estabelecimento real          → imagens publicadas no site oficial da empresa
//   2. fotografia oficial de uso ou operação    → idem (páginas de imprensa/divulgação) e arquivos de licença aberta do Wikimedia Commons
//   3. print verdadeiro do aplicativo ou site   → capturas que a própria empresa publica na App Store
//   4. documento ou reportagem pertinente       → enviado pelo Pedro, com a origem
//   5. ilustração, só quando necessária         → foto de licença aberta, rotulada "ilustrativa" (não mostra a empresa)
// Nunca há imagem gerada por IA fingindo ser print ou foto documental. Cada imagem guarda URL de origem, crédito, licença e se a
// permissão de uso está confirmada. Material acessível na internet não significa uso livre: o que não tem licença aberta fica
// marcado "verificar permissão" e aparece como sugestão até o Pedro confirmar.
const sharp = require('sharp');
const crypto = require('crypto');
const { safeFetch } = require('../safeFetch');
const feeds = require('../feeds');
const Ev = require('../evidence');
const U = require('./util');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const TIPOS_IMG = [/^image\/(jpeg|jpg|png|webp)/i, /^application\/octet-stream/i];
const UA_API = 'PedroDestravaBot/1.0 (+https://agente-bastao-iel.vercel.app; leitura de licenças abertas)';
const LICENCAS_ABERTAS = /^(cc0|cc[- ]by(?!-nc)(?!.*nc)(?!.*nd)|cc[- ]by[- ]sa(?!.*nc)(?!.*nd)|public domain|pd[- ]|domínio público|dominio publico)/i;
const NOME_RUIM = /(logo|icon|favicon|sprite|badge|avatar|pixel|tracking|placeholder|1x1|blank|\.svg)/i;

const attr = (tag, nome) => { const m = String(tag).match(new RegExp(`${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? feeds.decodifica(m[2] ?? m[3] ?? m[4] ?? '').trim() : ''; };

// Validação de uma imagem: formato comum e tamanho útil. `permitirRetrato`: capturas de celular são altas e estreitas.
async function validar(buf, { permitirRetrato = false, ladoMin = 700 } = {}) {
  let meta; try { meta = await sharp(buf, { limitInputPixels: 80e6 }).metadata(); } catch { return { ok: false, motivo: 'o arquivo não é uma imagem válida' }; }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) return { ok: false, motivo: `formato não aceito (${meta.format})` };
  const [w, h] = meta.orientation && meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (Math.max(w, h) < ladoMin || Math.min(w, h) < 315) return { ok: false, motivo: `imagem pequena demais (${w}×${h})` };
  const prop = w / h;
  if (prop < (permitirRetrato ? 0.3 : 0.55) || prop > 3) return { ok: false, motivo: 'proporção que não é de fotografia' };
  return { ok: true, largura: w, altura: h, formato: meta.format };
}
async function baixar(url, { fetcher = safeFetch } = {}) {
  const r = await fetcher(url, { timeoutMs: 12000, maxBytes: 9 * 1024 * 1024, tipos: TIPOS_IMG, binario: true, accept: 'image/webp,image/jpeg,image/png;q=0.9', headers: { 'User-Agent': UA_API } });
  if (r.status >= 400 || r.acesso_negado) throw new Error(`HTTP ${r.status}`);
  return Buffer.isBuffer(r.corpo) ? r.corpo : Buffer.from(r.corpo || '', 'binary');
}

// ── 1 e 2: imagens declaradas ou visíveis na página oficial ───────────────────
function imagensDaPagina(html, base) {
  const achadas = []; const add = (valor, peso, dica = 0) => { if (!valor) return; try { const u = new URL(valor.trim().split(/\s+/)[0], base).toString(); if (/^https?:/i.test(u) && !NOME_RUIM.test(u.split('?')[0])) achadas.push({ url: u, peso, dica }); } catch { /* endereço inválido */ } };
  const h = String(html || ''); let m;
  const reMeta = /<(meta|link)\b[^>]*>/gi;
  while ((m = reMeta.exec(h))) {
    const chave = (attr(m[0], 'property') || attr(m[0], 'name') || attr(m[0], 'itemprop') || attr(m[0], 'rel')).toLowerCase();
    const peso = { 'og:image:secure_url': 1, 'og:image': 1, 'twitter:image': 2, 'twitter:image:src': 2, image: 3, image_src: 3 }[chave]; if (!peso) continue;
    add(attr(m[0], m[1].toLowerCase() === 'link' ? 'href' : 'content'), peso);
  }
  const reLd = /"image"\s*:\s*(\[[^\]]*\]|"[^"]+")/g;
  while ((m = reLd.exec(h))) { try { const v = JSON.parse(m[1]); (Array.isArray(v) ? v : [v]).forEach((x) => add(typeof x === 'string' ? x : x?.url, 3)); } catch { /* json-ld quebrado */ } }
  const reImg = /<(img|source)\b[^>]*>/gi;
  while ((m = reImg.exec(h))) {
    const tag = m[0]; const largura = Number(attr(tag, 'width')) || 0;
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    if (srcset) { const melhor = srcset.split(',').map((p) => p.trim().split(/\s+/)).map(([u, d]) => ({ u, w: Number(String(d || '').replace(/\D/g, '')) || 0 })).sort((a, b) => b.w - a.w)[0]; if (melhor) add(melhor.u, 5, melhor.w); }
    const src = attr(tag, 'src') || attr(tag, 'data-src'); if (src && !/^data:/.test(src)) add(src, 5, largura);
  }
  const vistos = new Set();
  return achadas.sort((a, b) => a.peso - b.peso || b.dica - a.dica).filter((a) => { const k = a.url.split('?')[0]; if (vistos.has(k)) return false; vistos.add(k); return true; }).map((a) => a.url);
}

async function doSiteOficial(op, { deps = {}, agora = Date.now(), max = 4, paginas = 2 } = {}) {
  const fontes = (op.verificacao?.fontes || []).filter((f) => f.classe === 'oficial' && f.papel !== 'fundador' && /^https?:/.test(f.url));
  const fetcher = deps.fetcher || safeFetch; const out = []; const avisos = [];
  if (!fontes.length) return { imagens: [], avisos: ['Não há página oficial confirmada para tirar imagens.'] };
  for (const pagina of fontes.slice(0, paginas)) {
    let html; try { const r = await fetcher(pagina.url, { timeoutMs: 12000, maxBytes: 2.5 * 1024 * 1024 }); if (r.status >= 400 || r.acesso_negado) throw new Error(`HTTP ${r.status}`); html = r.corpo; } catch (e) { avisos.push(`Não consegui reabrir ${U.host(pagina.url)} (${U.limita(e.message, 60)}).`); continue; }
    const urls = imagensDaPagina(html, pagina.url).slice(0, 18);
    for (const url of urls) {
      if (out.length >= max) break;
      try {
        const buf = await (deps.baixar ? deps.baixar(url) : baixar(url, { fetcher })); const v = await validar(buf, { ladoMin: 800 });
        if (!v.ok) continue;
        if (out.some((o) => o.origem.sha256 === sha256(buf))) continue;
        out.push({ buf, tipo: 'oficial_pagina', papel: 'foto', relacao: 'negocio', descricao: `Imagem publicada no site oficial (${pagina.dominio || U.host(pagina.url)})`,
          origem: { url_imagem: url, url_pagina: pagina.url, dominio: pagina.dominio || U.host(pagina.url), consultado_em: new Date(agora).toISOString(), sha256: sha256(buf), largura: v.largura, altura: v.altura },
          licenca: 'Imagem do site da própria empresa. Confirme o direito de uso antes de postar; use só para ilustrar este negócio.', credito: `Foto: ${pagina.dominio || U.host(pagina.url)}`, permissao: 'verificar' });
      } catch { /* imagem inacessível: tenta a próxima */ }
    }
  }
  if (!out.length) avisos.push('O site oficial não entregou imagem utilizável (bloqueio de leitura automática ou só imagens pequenas).');
  return { imagens: out, avisos };
}

// ── 3: capturas de tela que a própria empresa publica na App Store ────────────
async function capturasDaLoja(op, { deps = {}, agora = Date.now(), max = 2 } = {}) {
  const fetcher = deps.fetcher || safeFetch; const avisos = [];
  try {
    const r = await fetcher(`https://itunes.apple.com/search?term=${encodeURIComponent(op.nome)}&entity=software&country=${deps.pais || 'us'}&limit=6`, { timeoutMs: 9000, maxBytes: 900000, accept: 'application/json', tipos: [/^(application|text)\//i] });
    if (r.status >= 400) return { imagens: [], avisos: ['A App Store não respondeu.'] };
    const j = JSON.parse(r.corpo); const alvo = U.norm(op.nome).replace(/\s+/g, '');
    const dom = op.verificacao?.fonte_oficial?.url ? Ev.dominioRegistravel(op.verificacao.fonte_oficial.url) : (op.chave?.dominio || '');
    const app = (j.results || []).find((a) => { const nome = U.norm(a.trackName).replace(/\s+/g, ''); if (!(nome === alvo || nome.startsWith(alvo))) return false; const siteDev = a.sellerUrl ? Ev.dominioRegistravel(a.sellerUrl) : ''; return (dom && siteDev === dom) || U.norm(a.sellerName || a.artistName).replace(/\s+/g, '').includes(alvo.slice(0, 8)); });
    if (!app) return { imagens: [], avisos: ['Não encontrei o aplicativo oficial na App Store.'] };
    const out = [];
    for (const url of (app.screenshotUrls || []).slice(0, max + 1)) {
      if (out.length >= max) break;
      try {
        const grande = url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/1290x2796bb.$1'); let buf;
        try { buf = await (deps.baixar ? deps.baixar(grande) : baixar(grande, { fetcher })); } catch { buf = await (deps.baixar ? deps.baixar(url) : baixar(url, { fetcher })); }
        const v = await validar(buf, { permitirRetrato: true, ladoMin: 600 }); if (!v.ok) continue;
        out.push({ buf, tipo: 'loja_print', papel: 'print', relacao: 'negocio', descricao: `Captura de tela do aplicativo, publicada pela empresa na App Store (${app.trackName})`,
          origem: { url_imagem: url, url_pagina: app.trackViewUrl.split('?')[0], dominio: 'apps.apple.com', consultado_em: new Date(agora).toISOString(), sha256: sha256(buf), largura: v.largura, altura: v.altura },
          licenca: 'Captura publicada pela própria empresa na página do aplicativo. Confirme o direito de uso antes de postar.', credito: `Captura: App Store · ${U.limita(app.sellerName || app.artistName || op.nome, 22)}`, permissao: 'verificar' });
      } catch { /* captura inacessível */ }
    }
    if (!out.length) avisos.push('O aplicativo não tem captura de tela utilizável.');
    return { imagens: out, avisos };
  } catch (e) { return { imagens: [], avisos: [`A App Store não respondeu (${U.limita(e.message, 50)}).`] }; }
}

// ── 2 e 5: Wikimedia Commons, só com licença aberta ───────────────────────────
const semHtml = (s) => feeds.decodifica(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
async function commons(consulta, { exigirNome = null, deps = {}, agora = Date.now(), max = 3, relacao = 'negocio', descricaoBase = '' } = {}) {
  const fetcher = deps.fetcher || safeFetch; const avisos = [];
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(consulta)}&gsrlimit=20&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600`;
  let j = null;
  for (let t = 0; t < 3 && !j; t++) {
    try { const r = await fetcher(url, { timeoutMs: 12000, maxBytes: 1.5 * 1024 * 1024, accept: 'application/json', headers: { 'User-Agent': UA_API } }); if (r.status === 429 || /too many requests/i.test(String(r.corpo).slice(0, 80))) { await new Promise((x) => setTimeout(x, 1500 * (t + 1))); continue; } if (r.status >= 400) throw new Error(`HTTP ${r.status}`); j = JSON.parse(r.corpo); }
    catch (e) { if (t === 2) return { imagens: [], avisos: [`Wikimedia Commons indisponível (${U.limita(e.message, 50)}).`] }; await new Promise((x) => setTimeout(x, 1200)); }
  }
  if (!j) return { imagens: [], avisos: ['Wikimedia Commons limitou o número de consultas; tente de novo em alguns minutos.'] };
  const paginas = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = []; const nomeN = exigirNome ? U.norm(exigirNome).replace(/\s+/g, '') : null;
  for (const p of paginas) {
    if (out.length >= max) break;
    const info = p.imageinfo?.[0]; if (!info || !/^image\/(jpeg|png|webp)/.test(info.mime || '')) continue;
    const m = info.extmetadata || {}; const lic = semHtml(m.LicenseShortName?.value || m.License?.value);
    if (!LICENCAS_ABERTAS.test(lic)) continue;
    const titulo = semHtml(p.title).replace(/^File:/, ''); const desc = semHtml(m.ImageDescription?.value);
    // logotipo, ícone e bandeira não mostram operação nem produto: ficam fora da busca de fotos
    if (/logo|wordmark|icon|flag|bandeira|\.svg$/i.test(`${titulo} ${desc.slice(0, 120)}`)) continue;
    // a empresa precisa estar no nome do arquivo, no início da descrição ou nas categorias do arquivo: citada de passagem num texto longo não vale
    const cats = semHtml(String(m.Categories?.value || '').replace(/\|/g, ' '));
    if (nomeN && !U.norm(`${titulo} ${desc.slice(0, 160)} ${cats}`).replace(/\s+/g, '').includes(nomeN)) continue;
    if (info.width < 900 || info.height < 500) continue;
    try {
      const buf = await (deps.baixar ? deps.baixar(info.thumburl || info.url) : baixar(info.thumburl || info.url, { fetcher })); const v = await validar(buf, { ladoMin: 900 }); if (!v.ok) continue;
      const autor = U.limita(semHtml(m.Artist?.value) || 'autor não informado', 26);
      out.push({ buf, tipo: 'commons', papel: 'foto', relacao, descricao: relacao === 'negocio' ? `${U.limita(desc || titulo, 110)} (Wikimedia Commons)` : `Foto ilustrativa${descricaoBase ? ` de ${descricaoBase}` : ''} (não é da empresa): ${U.limita(titulo.replace(/\.[a-z]{3,4}$/i, '').replace(/[_]+/g, ' '), 70)}`,
        origem: { url_imagem: info.url, url_pagina: info.descriptionurl, dominio: 'commons.wikimedia.org', consultado_em: new Date(agora).toISOString(), sha256: sha256(buf), largura: v.largura, altura: v.altura, arquivo: titulo, autor: semHtml(m.Artist?.value) },
        licenca: `${lic}${m.LicenseUrl?.value ? ` · ${m.LicenseUrl.value}` : ''}. Crédito ao autor obrigatório (vai na legenda e na ficha).`, credito: `Foto: ${autor} · ${U.limita(lic, 14)}${relacao === 'negocio' ? '' : ' · ilustrativa'}`, permissao: 'confirmada' });
    } catch { /* arquivo inacessível */ }
  }
  if (!out.length) avisos.push(`Wikimedia Commons: nenhuma foto de licença aberta para “${consulta}”.`);
  return { imagens: out, avisos };
}

// Junta o que existe, em ordem de preferência. Falha de uma fonte vira aviso: o carrossel continua e mostra o que faltou.
async function reunir(op, { deps = {}, agora = Date.now(), ilustracao = null } = {}) {
  const todas = []; const avisos = []; const tarefas = [
    ['oficial', () => doSiteOficial(op, { deps, agora })],
    ['loja', () => capturasDaLoja(op, { deps, agora })],
    ['commons', () => commons(`"${op.nome}"`, { exigirNome: op.nome, deps, agora })],
  ];
  if (ilustracao) tarefas.push(['ilustracao', async () => {
    // consulta curta funciona melhor: tenta a frase inteira e, se não vier nada, as duas primeiras palavras
    const palavras = String(ilustracao.consulta).split(/\s+/).filter(Boolean); let r = await commons(ilustracao.consulta, { deps, agora, relacao: 'ilustrativa', descricaoBase: ilustracao.descricao || '', max: 2 });
    if (!r.imagens.length && palavras.length > 2) r = await commons(palavras.slice(0, 2).join(' '), { deps, agora, relacao: 'ilustrativa', descricaoBase: ilustracao.descricao || '', max: 2 });
    return r;
  }]);
  const rs = await Promise.all(tarefas.map(async ([nome, fn]) => { try { return [nome, await fn()]; } catch (e) { return [nome, { imagens: [], avisos: [`${nome}: ${U.limita(e.message, 80)}`] }]; } }));
  for (const [, r] of rs) { todas.push(...r.imagens); avisos.push(...r.avisos); }
  const vistos = new Set(); return { imagens: todas.filter((i) => { if (vistos.has(i.origem.sha256)) return false; vistos.add(i.origem.sha256); return true; }), avisos };
}

// Guarda uma cópia reduzida (JPEG) e devolve o registro sem o buffer.
// Guarda a cópia de TRABALHO (girada pelo EXIF, no máximo 1800×2000, sem metadados: EXIF/GPS saem) e, separado, o ORIGINAL
// recebido (até 7 MB), com o registro de cada transformação e os hashes dos dois. Recorte de produto com fundo transparente fica em PNG.
const TAM_ORIGINAL = 7 * 1024 * 1024;
async function guardar(store, carrosselId, achado, id) {
  const m = await sharp(achado.buf, { limitInputPixels: 60e6 }).metadata();
  const alfa = !!m.hasAlpha && m.format === 'png';
  let pipe = sharp(achado.buf, { limitInputPixels: 60e6 }).rotate().resize({ width: 1800, height: 2000, fit: 'inside', withoutEnlargement: true });
  pipe = alfa ? pipe.png() : pipe.jpeg({ quality: 90 });
  const { data: trabalho, info } = await pipe.toBuffer({ resolveWithObject: true });
  const ext = alfa ? 'png' : 'jpg';
  const chave = `carrossel:${carrosselId}:img-${id}.${ext}`;
  await store.arquivoSalvar(chave, trabalho, alfa ? 'image/png' : 'image/jpeg');
  let original = null;
  if (achado.buf.length <= TAM_ORIGINAL) { original = `carrossel:${carrosselId}:img-${id}.original`; await store.arquivoSalvar(original, achado.buf, `image/${m.format === 'jpg' ? 'jpeg' : m.format}`); }
  const transformacoes = [m.orientation && m.orientation !== 1 ? 'girada conforme a orientação EXIF' : null, (m.width > 1800 || m.height > 2000) ? `reduzida de ${m.width}×${m.height} para ${info.width}×${info.height}` : null, alfa ? 'mantida em PNG (fundo transparente)' : `convertida de ${m.format} para JPEG (qualidade 90)`, 'metadados removidos (EXIF/GPS/perfil)'].filter(Boolean);
  const { buf, ...resto } = achado;
  return { id, ...resto, arquivo: chave, arquivo_original: original, bytes: trabalho.length, largura: info.width, altura: info.height, recorte_transparente: alfa, sha256_original: sha256(achado.buf), sha256_trabalho: sha256(trabalho), transformacoes, adicionada_em: new Date().toISOString() };
}

// Imagem enviada pelo Pedro (arquivo) ou buscada por link. A origem e a permissão são dele; ficam registradas.
async function deUsuario({ buf, url = null, descricao = '', credito = '', licenca = '', pagina = '', permissao = false, papel = 'foto', tipo = 'enviada', declaracao = null, agora = Date.now() }) {
  const v = await validar(buf, { permitirRetrato: papel === 'print', ladoMin: papel === 'print' ? 400 : 500 }); // recorte de print é pequeno por natureza; o render recusa ampliação exagerada
  if (!v.ok) throw U.erro(`Imagem recusada: ${v.motivo}.`, 'IMAGEM', 422);
  const dominio = url ? U.host(url) : (pagina ? U.host(pagina) : 'enviada por você');
  const papelOk = ['foto', 'print', 'documento', 'ilustracao'].includes(papel) ? papel : 'foto';
  return { buf, tipo, papel: papelOk, relacao: papelOk === 'ilustracao' ? 'ilustrativa' : 'negocio', descricao: U.limita(descricao || 'Imagem enviada pelo Pedro', 140),
    origem: { url_imagem: url || null, url_pagina: pagina || null, dominio, consultado_em: new Date(agora).toISOString(), sha256: sha256(buf), largura: v.largura, altura: v.altura, declaracao: declaracao || (url || pagina ? undefined : 'Arquivo enviado pelo Pedro; origem declarada por ele.') },
    licenca: U.limita(licenca || (permissao ? 'Uso confirmado por você.' : 'Origem e permissão ainda não confirmadas.'), 220), credito: U.limita(credito, 56), permissao: permissao ? 'confirmada' : 'verificar' };
}

module.exports = { reunir, doSiteOficial, capturasDaLoja, commons, deUsuario, guardar, validar, baixar, imagensDaPagina, LICENCAS_ABERTAS };
