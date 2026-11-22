// "Por trás da marca": a foto CERTA para cada slide, escolhida pelo CONTEÚDO (padrão aprovado pelo Pedro em 21/11/2026).
// Cada slide mostra o que o texto dele fala, com foto real e marcante (produto em close, gente, loja, campanha), sem
// repetir e sem imagem com texto gravado. Fluxo (retomável, cada fase grava o progresso no documento):
//   enviadas  → as fotos que o Pedro mandou (prioridade: entram sempre, mas no slide que combina com elas)
//   instagram → perfil OFICIAL da marca (Graph business_discovery: @ sugerido pela IA e conferido por seguidores e nome),
//               2 páginas de posts recentes: imagens e imagens de carrossel (vídeo fica de fora). Respeita o freio da cota
//               da Meta (o mesmo da Reciclagem): acima de 85% pula esta fonte, acima de 60% lê uma página só.
//   materia   → fotos da matéria creditadas "Divulgação" e a imagem de compartilhamento (og:image) quando não é de
//               agência/fotógrafo
//   baixar    → baixa (safeFetch), descarta repetida (dHash 8×8) e marca baixa resolução (lado maior < 900 px)
//   commons   → Wikimedia Commons da marca e do fundador, só CC0/domínio público, quando o acervo ficou pequeno
//   descrever → IA gratuita com visão (visaoFotos.js) descreve cada foto: descrição, tags, impacto 0–10, tem texto,
//               marca d'água. Sem visão: a legenda original vira a descrição e a OCR (Tesseract) barra foto com texto
//   casar     → UMA chamada de IA (cascata gratuita) casa slide → foto; o código valida (id existe, sem repetir, fotos do
//               Pedro usadas) e preenche lacunas por palavras em comum
//   lacunas   → slide ainda sem foto: Commons (CC0/domínio público) pelo assunto da tela, depois Pexels; por fim a melhor
//               foto oficial que sobrou; nada serviu → fundo na cor da marca (desenhado pelo código)
//   aplicar   → c.top.fotos_marca[i] (o que a arte usa) e c.top.foto_por_slide[sid] = { id, motivo } (transparência)
// Metadados ficam em c.top.fotos_candidatas; os bytes em pico_arquivos (img:<id> e a miniatura mini:<id>).
// Legenda sem linha de crédito (decisão do Pedro): origem e licença ficam registradas em c.imagens, para rastreio.
const crypto = require('crypto');
const sharp = require('sharp');
const llmJson = require('../llmJson');

const MAX_CANDIDATAS = 30; const MAX_IG = 22; const MAX_MATERIA = 6; const POR_PAGINA = 30;
const LADO_MIN = 900; const PALAVRAS_TEXTO = 12; const DIST_REPETIDA = 6; const SEGUIDORES_MIN = 50000;
// PALAVRAS_TEXTO 12: o OCR conta ruído de foto de comida como palavra (9 a 24); post de promoção sai pela legenda (PROMO).
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const compacto = (s) => norm(s).replace(/[^a-z0-9]/g, '');
const umaLinha = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const OFICIAIS = ['pedro', 'instagram', 'materia', 'google'];
// Post de promoção no Instagram da marca é arte com texto (preço, "Black", "últimos dias"), não foto do negócio.
const PROMO = /(promo[çc][ãa]o|alerta|aten[çc][ãa]o|[úu]ltim[oa]s? (dias|semana|chance)|black (friday|november)|cupom|desconto|% ?off|imperd[íi]vel|sorteio|garant[ae] (j[áa]|o seu)|s[óo] (hoje|at[ée]))/i;
const ESPERA_IG_MAX = 6 * 3600e3; // espera a cota da Meta voltar por até 6 h antes de seguir sem o Instagram oficial
// Busca de banco de imagens que mostraria um LUGAR (fachada, prédio, salão, loja): no carrossel seria lida como a própria
// marca ("prédio europeu como se fosse o Coco Bambu"). Nesses slides vale mais uma foto oficial que sobrou.
const LUGAR = /\b(storefront|store|shop|building|facade|fa[cç]ade|interior|restaurant|restaurante|dining|mall|headquarters|office|factory|warehouse|branch|outlet|location|exterior|loja|fachada|pr[eé]dio|sede|f[aá]brica|unidade)\b/i;

// ── Imagem: hash perceptual, download, miniatura ──────────────────────────────
async function dHash(buf) {
  const { data } = await sharp(buf).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}
function distancia(a, b) { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; }

async function preparar(buf) {
  const s = sharp(buf, { limitInputPixels: 60e6 }).rotate();
  const m = await sharp(buf, { limitInputPixels: 60e6 }).metadata();
  const [w, h] = m.orientation && m.orientation >= 5 ? [m.height, m.width] : [m.width, m.height];
  const dados = await s.resize({ width: 1350, height: 1350, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const mini = await sharp(dados).resize({ width: 360, height: 450, fit: 'inside' }).jpeg({ quality: 68 }).toBuffer();
  return { dados, mini, largura: w || 0, altura: h || 0, dhash: await dHash(dados) };
}

async function baixar(url, carregar) {
  const r = await carregar(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 10000, tipos: [/^image\//, /^application\/octet-stream/], binario: true, accept: 'image/jpeg,image/png,image/webp' });
  if (r.status !== 200) throw new Error(`o site respondeu ${r.status}`);
  return { ...(await preparar(Buffer.isBuffer(r.corpo) ? r.corpo : Buffer.from(r.corpo || ''))), url_final: r.url_final || url };
}

// ── Matéria: fotos "Divulgação" e og:image ───────────────────────────────────
const attr = (tag, nome) => { const m = String(tag).match(new RegExp(`\\b${nome}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? (m[2] ?? m[3] ?? '').replace(/&amp;/g, '&').trim() : ''; };
const semTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function creditoDe(txt) {
  const t = norm(txt);
  if (/divulga/.test(t)) return 'divulgacao';
  if (/(reuters|afp|getty|associated press|ap photo|folhapress|estadao conteudo|agencia o globo|agencia brasil|agencia estado|shutterstock|istock|alamy|\befe\b|bloomberg|reproducao|foto\s*:|fotos\s*:|credito\s*:|imagem\s*:|\/\s*[a-z]+\s*$)/.test(t)) return 'terceiro';
  return 'desconhecido';
}
const maiorDoSrcset = (s) => { const it = String(s || '').split(',').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 })); return it.sort((a, b) => b.w - a.w)[0]?.u || ''; };
function imagensDaMateria(html, base) {
  const out = []; const abs = (u) => { try { return new URL(u, base).toString(); } catch { return null; } };
  const arquivo = (u) => String(u || '').split('?')[0].split('/').pop();
  const figuras = [];
  for (const f of String(html || '').match(/<figure\b[\s\S]*?<\/figure>/gi) || []) {
    const img = (f.match(/<img\b[^>]*>/i) || [])[0]; if (!img) continue;
    const src = abs(maiorDoSrcset(attr(img, 'data-srcset') || attr(img, 'srcset')) || attr(img, 'data-src') || attr(img, 'src'));
    if (!src || !/^https?:/.test(src)) continue;
    const legenda = umaLinha(`${semTags((f.match(/<figcaption\b[\s\S]*?<\/figcaption>/i) || [''])[0])} ${attr(img, 'alt')} ${attr(img, 'title')}`, 300);
    figuras.push({ url: src, legenda, credito: creditoDe(legenda) });
  }
  const og = require('../radar/imagens').imagensDeDivulgacao(html, base)[0];
  if (og) {
    const fig = figuras.find((x) => arquivo(x.url) && arquivo(x.url) === arquivo(og));
    const credito = fig ? fig.credito : 'desconhecido';
    if (credito !== 'terceiro' || process.env.FOTOS_SO_LIVRE !== '1') out.push({ url: og, legenda: fig?.legenda || '', credito, og: true });
  }
  // sem filtro de direito de uso (decisão do Pedro, 21/11): toda foto da matéria é candidata; as "Divulgação" vêm primeiro
  const ordem = process.env.FOTOS_SO_LIVRE === '1' ? figuras.filter((f) => f.credito === 'divulgacao') : [...figuras.filter((f) => f.credito === 'divulgacao'), ...figuras.filter((f) => f.credito !== 'divulgacao')];
  for (const f of ordem) if (!out.some((x) => arquivo(x.url) === arquivo(f.url))) out.push(f);
  return out.slice(0, MAX_MATERIA);
}

// ── Instagram oficial ─────────────────────────────────────────────────────────
// Confere que o perfil é da marca: seguidores ≥ 50 mil e o nome da marca no @, no nome ou na bio.
function confereMarca(bd, marca, { forcado = false } = {}) {
  if (!bd?.username) return false;
  if (forcado) return true;
  if ((Number(bd.followers_count) || 0) < SEGUIDORES_MIN) return false;
  const alvo = compacto(marca); const onde = compacto(`${bd.username} ${bd.name || ''}`); const bio = norm(`${bd.name || ''} ${bd.biography || ''}`);
  const partes = norm(marca).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
  return (alvo.length >= 3 && onde.includes(alvo)) || (partes.length > 0 && partes.every((p) => bio.includes(p)));
}
const camposIg = (h, depois) => `business_discovery.username(${h}){username,name,biography,followers_count,media${depois ? `.after(${depois})` : ''}.limit(${POR_PAGINA}){id,media_type,caption,permalink,timestamp,like_count,media_url,children{id,media_type,media_url}}}`;
function midiasDe(bd) {
  const out = [];
  for (const m of bd?.media?.data || []) {
    const base = { permalink: m.permalink || null, legenda: umaLinha(m.caption, 400), curtidas: Number(m.like_count) || 0, data: m.timestamp || null };
    if (m.media_type === 'IMAGE' && m.media_url) out.push({ ...base, ig_id: String(m.id), url: m.media_url });
    else if (m.media_type === 'CAROUSEL_ALBUM') for (const ch of m.children?.data || []) if (ch.media_type === 'IMAGE' && ch.media_url) out.push({ ...base, ig_id: String(ch.id || `${m.id}_${out.length}`), url: ch.media_url });
  }
  return out;
}
// Lê o perfil oficial: tenta os @ na ordem, até 2 páginas. Devolve { handle, seguidores, itens, pausado?, erro? }.
async function lerInstagram({ marca, handles, forcado = false, graph, igId, freio, paginas = 2 }) {
  const f0 = freio();
  if (f0.pausar) return { pausado: true, itens: [], erro: `cota da Meta em ${f0.pct}%: fonte pulada` };
  let ultimo = null;
  for (const h of handles.slice(0, 3)) {
    try {
      const d = await graph('GET', igId, { fields: camposIg(h) });
      const bd = d?.business_discovery;
      if (!confereMarca(bd, marca, { forcado })) continue;
      const itens = midiasDe(bd); let depois = bd.media?.paging?.cursors?.after;
      for (let p = 1; p < paginas && depois && !freio().leve; p++) {
        const d2 = await graph('GET', igId, { fields: camposIg(h, depois) }).catch(() => null);
        if (!d2) break; itens.push(...midiasDe(d2.business_discovery)); depois = d2.business_discovery?.media?.paging?.cursors?.after;
      }
      return { handle: bd.username, seguidores: Number(bd.followers_count) || null, itens };
    } catch (e) {
      if (e?.meta?.tipo === 'limite' || e?.meta?.tipo === 'token') return { pausado: e.meta.tipo === 'limite', itens: [], erro: String(e.message).slice(0, 160) };
      // @ inexistente ou que não é conta profissional: tenta o próximo (guarda o motivo para o diagnóstico)
      ultimo = `@${h}: ${String(e?.meta?.mensagem_original ? `${e.meta.mensagem_original} (code ${e.meta.code}/${e.meta.subcode})` : e?.message || 'falhou').slice(0, 160)}`;
    }
  }
  return { itens: [], erro: ultimo || `nenhum perfil oficial confirmado (${handles.slice(0, 3).map((h) => `@${h}`).join(', ') || 'sem sugestão'})` };
}
const HANDLE = /^[a-z0-9._]{2,30}$/;
async function sugerirHandles(c, ctx, marca) {
  const out = [];
  try {
    const { dados } = await ctx.ia({ sistema: `Você indica o @ do perfil OFICIAL no Instagram de uma marca (a conta da empresa, não de fã, franqueado ou funcionário). Devolva de 1 a 3 palavras de usuário prováveis, sem @, da mais provável para a menos. Responda APENAS JSON: {"handles":["..."]}\n\n${llmJson.REGRAS_DADOS}`, usuario: `MARCA: ${marca}\n${llmJson.dado('MATERIA', `${c.fonte_principal?.titulo || ''}\n${String(c.fonte_principal?.texto || '').slice(0, 1500)}`, 2000).bloco}`, maxTokens: 200, temperatura: 0.1, pago: 'nunca' });
    for (const h of Array.isArray(dados?.handles) ? dados.handles : []) { const x = String(h).replace(/^@/, '').trim().toLowerCase(); if (HANDLE.test(x)) out.push(x); }
  } catch { /* sem sugestão da IA: fica o palpite pelo nome */ }
  const palpite = compacto(marca);
  if (HANDLE.test(palpite)) out.push(palpite);
  return [...new Set(out)].slice(0, 3);
}

// ── Casamento slide → foto ────────────────────────────────────────────────────
const PARADAS = new Set('para como mais isso essa esse esta este pela pelo pelos pelas sobre quando entre onde porque nao sim sem com uma umas uns dos das nos nas que quem sua seu suas seus ele ela eles elas voce voces cada todo toda todos todas ainda muito muita tambem depois antes hoje marca dono foto fotos imagem'.split(' '));
const tokens = (s, fora = []) => [...new Set(norm(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !PARADAS.has(p) && !fora.includes(p)))];
const parecidas = (a, b) => { if (a === b) return true; const [c1, l1] = a.length <= b.length ? [a, b] : [b, a]; return (c1.length >= 4 && l1.startsWith(c1) && l1.length - c1.length <= 3) || (c1.length >= 5 && a.slice(0, 5) === b.slice(0, 5)); };
function emComum(slide, cand, fora) {
  const ts = tokens(slide.texto, fora); const tc = tokens(`${cand.descricao || ''} ${(cand.tags || []).join(' ')}`, fora);
  return ts.filter((a) => tc.some((b) => parecidas(a, b)));
}
const BONUS = { pedro: 3, instagram: 1, materia: 0.5, google: 0.8, commons: 0, pexels: -0.5 };
const nota = (slide, cand, fora) => emComum(slide, cand, fora).length * 2 + (cand.impacto ?? 5) / 5 + (BONUS[cand.origem] || 0) - (cand.baixa_resolucao ? 2 : 0);
const usavel = (x) => !x.descartada;

const CASAR = `Você é editor de fotografia do carrossel "POR TRÁS DA MARCA". Para CADA slide escolha a foto que MOSTRA o que o texto do slide fala (não só "da marca": o ASSUNTO da tela). Exemplos do padrão aprovado: "o dono decide sozinho" → o fundador; "o tamanho hoje" → fachada de loja; "da rede social pra loja" → celular fotografando o produto; "o delivery paga a conta" → entregador com a bolsa; "o erro que virou produto" → o produto em close.
Regras:
1. Sem repetir foto.
2. CAPA (s1): a capa tem de fazer quem passa RECONHECER a marca na hora: produto da marca, fachada/loja oficial, embalagem ou fundador famoso. NUNCA ponha na capa pessoa desconhecida (paciente, funcionário, executivo, foto de banco) nem foto com texto de outra coisa. Sem foto assim, devolva "foto": null (a capa usa a cor e o logo da marca). Nos demais slides: a de MAIOR impacto entre as que combinam com o assunto.
3. Fotos de origem "pedro" foram escolhidas pelo dono do perfil: use TODAS, cada uma no slide que mais combina com ela.
4. Prefira foto oficial (pedro, instagram, materia) a banco de imagens; nunca escolha foto com texto gravado.
5. Se nenhuma foto mostra o assunto do slide, devolva "foto": null e em "busca" 2 a 4 palavras em INGLÊS para procurar uma foto do conceito (ex.: "delivery courier bag", "smartphone photo food").
6. A "busca" é só para CONCEITO (objeto, gesto, pessoa genérica). Nunca peça lugar (fachada, prédio, salão, interior, loja, restaurante): uma foto de banco seria lida como a própria marca. Se o slide fala da loja/unidade/sede da marca, use uma foto oficial da marca, mesmo que menos exata.
"motivo": uma frase curta em português dizendo por que a foto combina com o texto.
Responda APENAS JSON: {"slides":[{"slide":"s1","foto":"c1","motivo":"","busca":""}]}`;

function slidesDoCarrossel(c) {
  const v = c.top.versoes[c.top.escolha.versao];
  const capa = v.capas?.[c.top.escolha.capas?.[0] ?? 0]?.texto || '';
  // "Quem é ele?": não há capa à parte (a 1ª aposta é a capa); slide i = tela i
  if (c.top.entrada?.estilo === 'revelacao') {
    // apostas e revelação mostram a PESSOA (o rosto prende e esconde o nome); as outras telas, a cena do texto
    const quem = c.top.angulo?.marca || v.quem || '';
    return v.telas.map((t, k) => ({ sid: `s${k + 1}`, i: k, papel: t.papel, texto: ['aposta', 'revelacao'].includes(t.papel) ? `foto de ${quem} (a pessoa, rosto aparecendo)` : [t.titulo, t.texto].filter(Boolean).join(' — '), busca: '' }));
  }
  return [{ sid: 's1', i: 0, papel: 'capa', texto: capa.replace(/\*\*/g, ''), busca: c.top.angulo?.imagem?.busca || '' },
    ...v.telas.map((t, k) => ({ sid: `s${k + 2}`, i: k + 1, papel: t.papel, texto: [t.titulo, t.texto].filter(Boolean).join(' — '), busca: t.imagem_busca || '' }))];
}

// Valida a resposta da IA e completa: ids conhecidos, sem repetir, fotos do Pedro todas usadas, lacunas por palavras em comum.
function validarCasamento(slides, candidatas, resposta, { marca = '' } = {}) {
  const fora = tokens(marca); const ok = candidatas.filter(usavel); const porId = new Map(ok.map((x) => [x.id, x]));
  const atrib = {}; const buscas = {}; const usados = new Set();
  const lista = Array.isArray(resposta?.slides) ? resposta.slides : [];
  for (const s of slides) {
    const r = lista.find((x) => String(x?.slide) === s.sid);
    if (r?.busca) buscas[s.sid] = umaLinha(String(r.busca).replace(/[^\p{L}\p{N}\s-]/gu, ' '), 60);
    const id = r?.foto == null ? null : String(r.foto);
    if (id && porId.has(id) && !usados.has(id)) { atrib[s.sid] = { id, motivo: umaLinha(r.motivo, 200) || 'escolhida pela IA', por: 'ia' }; usados.add(id); }
  }
  // fotos do Pedro: todas entram, no slide em que mais combinam
  for (const p of ok.filter((x) => x.origem === 'pedro' && !usados.has(x.id))) {
    const livres = slides.filter((s) => !atrib[s.sid]);
    const trocaveis = slides.filter((s) => atrib[s.sid] && porId.get(atrib[s.sid].id)?.origem !== 'pedro');
    const alvo = (livres.length ? livres : trocaveis).sort((a, b) => nota(b, p, fora) - nota(a, p, fora) - (livres.length ? 0 : (a.i === 0) - (b.i === 0)))[0];
    if (!alvo) break;
    if (atrib[alvo.sid]) usados.delete(atrib[alvo.sid].id);
    atrib[alvo.sid] = { id: p.id, motivo: 'foto enviada por você, no slide que mais combina com ela', por: 'pedro' }; usados.add(p.id);
  }
  // lacunas: o melhor PAR (slide sem foto, foto livre) primeiro — mais palavras em comum, depois a nota —, até acabar
  for (;;) {
    const pares = [];
    for (const s of slides.filter((y) => !atrib[y.sid])) for (const x of ok.filter((y) => !usados.has(y.id))) { const comum = emComum(s, x, fora); if (comum.length) pares.push({ s, x, comum, n: nota(s, x, fora) }); }
    const melhor = pares.sort((a, b) => b.comum.length - a.comum.length || b.n - a.n)[0];
    if (!melhor) break;
    atrib[melhor.s.sid] = { id: melhor.x.id, motivo: `palavras em comum com o texto: ${melhor.comum.slice(0, 4).join(', ')}`, por: 'tags' }; usados.add(melhor.x.id);
  }
  return { atrib, buscas };
}

// ── Fases ──────────────────────────────────────────────────────────────────────
const FASES = ['enviadas', 'instagram', 'materia', 'google', 'baixar', 'commons', 'descrever', 'casar', 'lacunas', 'aplicar', 'pronto'];

function metaDe(c, cand, ig) {
  const marca = c.top.angulo?.marca || c.top.entrada?.marca || 'a marca'; const veiculo = c.fonte_principal?.veiculo || 'a matéria';
  if (cand.origem === 'instagram') return { id: cand.id, tipo: 'foto_divulgacao', origem: cand.permalink || `https://www.instagram.com/${ig?.handle || ''}/`, url_imagem: cand.url, autor: ig?.handle ? `@${ig.handle}` : null, licenca: `Divulgação/${marca} (perfil oficial${ig?.handle ? ` @${ig.handle}` : ''} no Instagram)`, exige_credito: false, alt: umaLinha(cand.descricao || cand.legenda || `Foto do perfil oficial de ${marca}`, 240) };
  if (cand.origem === 'google') return { id: cand.id, tipo: 'foto_divulgacao', origem: cand.pagina || cand.url, url_imagem: cand.url, autor: null, licenca: `Foto de imprensa/divulgação encontrada no Google Imagens${cand.fonte ? ` (${cand.fonte})` : ''}`, exige_credito: false, alt: umaLinha(cand.descricao || cand.legenda || `Foto de ${marca}`, 240) };
  if (cand.origem === 'materia') return { id: cand.id, tipo: 'foto_divulgacao', origem: c.fonte_principal?.url_final || c.fonte_principal?.url || cand.url, url_imagem: cand.url, autor: null, licenca: cand.credito === 'divulgacao' ? `Divulgação/${marca} (publicada em ${veiculo})` : `Imagem de compartilhamento da matéria (${veiculo}); crédito não informado na página`, exige_credito: false, alt: umaLinha(cand.descricao || cand.legenda || `Foto de ${marca}`, 240) };
  return { ...(cand.meta || {}), id: cand.id };
}

async function etapa(c, ctx, { salvarArquivo, lerArquivo, slots }) {
  const d = ctx.deps || {}; const st = c.top.fotos_marca_estado; st.fase ||= 'enviadas';
  const C = (c.top.fotos_candidatas ||= []);
  const marca = c.top.angulo?.marca || c.top.entrada?.marca || '';
  const tempo = (ms = 12000) => ctx.restante() > ms;
  const carregar = d.carregar || require('../safeFetch').safeFetch;
  // Guarda uma candidata (bytes + miniatura) se não for repetida de outra já guardada.
  const registrar = async (cand, img) => {
    if (C.some((x) => x.id === cand.id)) return C.find((x) => x.id === cand.id);
    const rep = cand.origem !== 'pedro' && C.find((x) => !x.descartada && x.dhash && distancia(x.dhash, img.dhash) <= DIST_REPETIDA);
    const novo = { ...cand, largura: img.largura, altura: img.altura, dhash: img.dhash, baixa_resolucao: Math.max(img.largura, img.altura) < LADO_MIN, descricao: cand.descricao || null, tags: cand.tags || [], impacto: null, tem_texto: null, marca_dagua: null, descrita_por: null, descartada: rep ? `repetida de ${rep.id}` : null };
    if (!rep) { await salvarArquivo(`img:${cand.id}`, img.dados); await salvarArquivo(`mini:${cand.id}`, img.mini); }
    C.push(novo); return novo;
  };
  const deFora = async (f, origem) => registrar({ id: f.meta.id, origem, url: f.meta.src || f.meta.origem || null, legenda: umaLinha(f.meta.alt || f.meta.titulo || '', 300), meta: { ...f.meta, exige_credito: false } }, { ...(await preparar(f.dados)), dados: f.dados });

  while (st.fase !== 'pronto') {
    const fase = st.fase;
    if (fase === 'enviadas') {
      for (const [i, url] of (c.top.entrada?.fotos || []).slice(0, slots).entries()) {
        if (st.tentadas.includes(`link:${i}`)) continue;
        if (!tempo()) return { concluida: false };
        st.tentadas.push(`link:${i}`);
        try {
          const img = await baixar(url, carregar);
          const id = `dada_${sha(url)}`;
          await registrar({ id, origem: 'pedro', url, legenda: '', meta: { id, tipo: 'foto_fornecida', origem: img.url_final || url, url_enviada: url, autor: null, licenca: 'Fornecida pelo Pedro (ele responde pelo direito de uso)', exige_credito: false, fornecida_por: 'pedro', alt: `Foto ${i + 1} enviada pelo Pedro` } }, img);
        } catch (e) { st.falhas.push(`Foto ${i + 1} enviada não abriu (${String(e.message).slice(0, 80)}).`); }
      }
    } else if (fase === 'instagram') {
      const meta = require('../meta');
      const graph = d.graph !== undefined ? d.graph : (meta.faltando().filter((k) => k !== 'PUBLISH_SECRET').length ? null : meta.graph);
      if (graph && marca) {
        if (!tempo(20000)) return { concluida: false };
        const forcado = String(c.top.entrada?.instagram || '').replace(/^@/, '').trim().toLowerCase();
        const freio = () => meta.freio((d.metaUso || meta.uso)());
        // cota da Meta no limite: nem pede o @ à IA
        const handles = freio().pausar ? [] : HANDLE.test(forcado) ? [forcado] : await sugerirHandles(c, ctx, marca);
        const agoraMs = (d.agora || Date.now)();
        if (st.ig_espera_ate && agoraMs < st.ig_espera_ate) return { concluida: false, aguardando: 'cota da Meta' };
        const r = await lerInstagram({ marca, handles, forcado: HANDLE.test(forcado), graph, igId: d.igId || meta.config().igId, freio });
        st.ig = { handle: r.handle || null, seguidores: r.seguidores || null, lidas: r.itens.length, pausado: !!r.pausado, erro: r.erro || null };
        // Meta no limite: as fotos oficiais são o que dá o padrão aprovado. Espera a cota voltar (até ESPERA_IG_MAX) em vez de
        // completar o post com banco de imagens que não mostra a marca.
        if (r.pausado) {
          st.ig_desde ||= agoraMs;
          if (agoraMs - st.ig_desde < ESPERA_IG_MAX) {
            st.ig_espera_ate = agoraMs + Math.max(15, Number(freio().regain_min) || 0) * 60000;
            st.ig.aguardando = `Instagram oficial: cota da Meta no limite, nova tentativa às ${new Date(st.ig_espera_ate).toISOString().slice(11, 16)} UTC`;
            return { concluida: false, aguardando: 'cota da Meta' };
          }
          st.falhas.push('A Meta limitou a leitura do Instagram oficial da marca por várias horas: o post saiu sem as fotos do perfil.');
        }
        delete st.ig_espera_ate;
        const vistos = new Set();
        st.fila = [...(st.fila || []), ...r.itens.filter((x) => !vistos.has(x.url) && vistos.add(x.url)).sort((a, b) => b.curtidas - a.curtidas).slice(0, MAX_IG)
          .filter((x) => !PROMO.test(x.legenda || '')).map((x) => ({ id: `ig_${sha(x.ig_id)}`, origem: 'instagram', url: x.url, permalink: x.permalink, legenda: x.legenda, curtidas: x.curtidas }))];
      } else st.ig = { handle: null, erro: graph ? 'sem nome da marca' : 'Instagram não configurado no servidor' };
    } else if (fase === 'materia') {
      const url = c.fonte_principal?.url_final || c.fonte_principal?.url;
      if (url && c.fonte_principal?.tipo !== 'texto') {
        if (!tempo()) return { concluida: false };
        try {
          const html = d.lerHtml ? await d.lerHtml(url) : await (async () => { const r = await require('../safeFetch').safeFetch(url, { timeoutMs: 10000, maxBytes: 3 * 1024 * 1024 }); return r.status === 200 ? r.corpo : ''; })();
          const achadas = imagensDaMateria(html, url);
          st.materia = { achadas: achadas.length };
          st.fila = [...achadas.map((x) => ({ id: `mat_${sha(x.url)}`, origem: 'materia', url: x.url, legenda: x.legenda, credito: x.credito })), ...(st.fila || [])];
        } catch (e) { st.materia = { erro: String(e.message).slice(0, 120) }; }
      }
    } else if (fase === 'google') {
      // Google Imagens: fotos reais da marca (ou da pessoa, no "Quem é ele?") em sites de notícia e da própria marca
      const G = d.google || require('./googleImagens');
      if (marca && (d.google || G.disponivel()) && !st.tentadas.includes('google')) {
        if (!tempo(20000)) return { concluida: false };
        st.tentadas.push('google');
        const fundador = c.top.angulo?.fundador;
        const consultas = c.top.entrada?.estilo === 'revelacao' ? [marca, `${marca} evento`] : [`${marca} produto embalagem`, `${marca} loja`, marca, ...(fundador ? [fundador] : [])];   // produto primeiro: é o que faz a capa ser reconhecida na hora
        const achadas = [];
        for (const q of consultas) {
          try { achadas.push(...(await G.buscar(q)).slice(0, 8)); } catch (e) { st.falhas.push(String(e.message).slice(0, 160)); if (e.cota || e.semAssinatura) break; }
        }
        const vistos = new Set((st.fila || []).map((x) => x.url));
        st.google = { achadas: achadas.length };
        st.fila = [...(st.fila || []), ...achadas.filter((x) => !vistos.has(x.url) && vistos.add(x.url)).slice(0, 14).map((x) => ({ id: `gg_${sha(x.url)}`, origem: 'google', url: x.url, legenda: x.titulo, pagina: x.pagina, fonte: x.fonte }))];
      }
    } else if (fase === 'baixar') {
      while ((st.fila || []).length && C.length < MAX_CANDIDATAS) {
        if (!tempo(14000)) return { concluida: false };
        const lote = st.fila.splice(0, 4);
        await Promise.all(lote.map(async (x) => { try { await registrar(x, await baixar(x.url, carregar)); } catch { st.nao_baixadas = (st.nao_baixadas || 0) + 1; } }));
      }
      st.fila = [];
    } else if (fase === 'commons') {
      // acervo pequeno: fotos da marca e do fundador no Commons (só CC0/domínio público: a legenda não leva crédito)
      if (C.filter(usavel).length < slots + 2 && marca) {
        if (!st.tentadas.includes('commons')) {
          if (!tempo()) return { concluida: false };
          st.tentadas.push('commons');
          try { for (const f of await (d.fotosDaMarca || require('./fotos').fotosDaMarca)(marca, { max: 4, excluir: C.map((x) => x.id), soLivre: true }) || []) await deFora(f, 'commons'); }
          catch (e) { st.falhas.push(`Busca no Wikimedia Commons falhou (${String(e.message).slice(0, 60)}).`); }
        }
        const fundador = c.top.angulo?.fundador;
        if (fundador && !st.tentadas.includes('fundador')) {
          if (!tempo()) return { concluida: false };
          st.tentadas.push('fundador');
          try { const f = await (d.fotoDe || require('./fotos').fotoDe)(fundador, { soLivre: true }); if (f) await deFora({ ...f, meta: { ...f.meta, alt: `Foto de ${fundador}` } }, 'commons'); } catch { /* segue */ }
        }
      }
    } else if (fase === 'descrever') {
      const visao = d.visao !== undefined ? d.visao : (require('./visaoFotos').disponivel() ? require('./visaoFotos').descrever : null);
      const pendentes = () => C.filter((x) => usavel(x) && !x.descrita_por);
      if (visao && st.visao !== 'indisponivel') {
        while (pendentes().length) {
          if (!tempo(30000)) return { concluida: false };
          const lote = pendentes().slice(0, 6);
          try {
            const arq = await Promise.all(lote.map(async (x) => ({ id: x.id, dados: Buffer.from((await lerArquivo(`mini:${x.id}`)) || []), contexto: x.legenda })));
            const r = await visao(arq.filter((a) => a.dados.length));
            for (const it of r.itens || []) {
              const x = C.find((y) => y.id === it.id); if (!x) continue;
              Object.assign(x, { descricao: it.descricao || x.legenda || null, tags: it.tags || [], impacto: it.impacto, tem_texto: it.tem_texto, marca_dagua: it.marca_dagua, descrita_por: r.modelo ? `visao:${r.modelo}` : 'visao' });
              if (x.origem !== 'pedro' && it.tem_texto) x.descartada = 'texto gravado na foto';
              else if (x.origem !== 'pedro' && it.marca_dagua) x.descartada = "marca d'água";
            }
            for (const x of lote) if (!x.descrita_por) x.descrita_por = 'sem_resposta';
            st.visao = 'ok';
          } catch (e) {
            if (e.status === 429 && (st.visao_cota = (st.visao_cota || 0) + 1) < 3) return { concluida: false }; // cota: tenta na próxima rodada
            st.visao = 'indisponivel'; st.visao_erro = String(e.message).slice(0, 160); break;
          }
        }
      } else st.visao = 'indisponivel';
      // sem visão: a legenda original vira a descrição e a OCR barra a foto com texto gravado
      const ocr = d.ocr !== undefined ? d.ocr : async (buf) => (await require('../lerPrint').lerTexto(buf)).text;
      for (const x of C.filter((y) => usavel(y) && (!y.descrita_por || y.descrita_por === 'sem_resposta'))) {
        if (!x.descricao) { x.descricao = x.legenda || null; x.tags = tokens(x.legenda).slice(0, 8); }
        x.descrita_por = 'legenda';
        if (x.origem === 'pedro' || !ocr || x.ocr_palavras != null) continue;
        if (!tempo(14000)) return { concluida: false };
        try {
          const buf = await sharp(Buffer.from((await lerArquivo(`img:${x.id}`)) || [])).resize({ width: 1000, height: 1000, fit: 'inside' }).grayscale().png().toBuffer();
          x.ocr_palavras = (String(await ocr(buf) || '').match(/\p{L}{3,}/gu) || []).length;
          if (x.ocr_palavras > PALAVRAS_TEXTO) x.descartada = `texto gravado na foto (${x.ocr_palavras} palavras)`;
        } catch { x.ocr_palavras = -1; }
      }
    } else if (fase === 'casar') {
      const slides = slidesDoCarrossel(c); let resposta = null;
      if (C.some(usavel)) {
        if (!tempo(20000)) return { concluida: false };
        const fotos = C.filter(usavel).map((x) => `${x.id} [${x.origem}${x.impacto != null ? `, impacto ${x.impacto}` : ''}${x.baixa_resolucao ? ', baixa resolução' : ''}]: ${umaLinha(x.descricao || x.legenda || 'sem descrição', 200)}${x.tags?.length ? ` (tags: ${x.tags.join(', ')})` : ''}`).join('\n');
        try {
          const r = await ctx.ia({ sistema: `${CASAR}\n\n${llmJson.REGRAS_DADOS}`, usuario: `MARCA: ${marca}\nSLIDES:\n${slides.map((s) => `${s.sid} (${s.papel}): ${s.texto}`).join('\n')}\n\nFOTOS:\n${llmJson.dado('FOTOS', fotos, 9000).bloco}`, maxTokens: 1200, temperatura: 0.2, pago: 'nunca' });
          resposta = r?.dados || null; st.casou_por = r?.llm?.model || 'ia';
        } catch (e) { st.casou_por = `sem IA (${String(e.message).slice(0, 80)})`; }
      }
      const v = validarCasamento(slides, C, resposta, { marca });
      st.atrib = v.atrib; st.buscas = v.buscas;
    } else if (fase === 'lacunas') {
      const slides = slidesDoCarrossel(c); const fora = tokens(marca);
      for (const s of slides) {
        if (st.atrib[s.sid] || st.tentadas.includes(`lacuna:${s.sid}`)) continue;
        if (!tempo()) return { concluida: false };
        st.tentadas.push(`lacuna:${s.sid}`);
        const q = st.buscas?.[s.sid] || s.busca || c.top.angulo?.imagem?.busca || '';
        if (!q) continue;
        if (LUGAR.test(q)) {
          const usadosAgora = new Set(Object.values(st.atrib).map((a) => a.id));
          const r = C.filter((x) => usavel(x) && OFICIAIS.includes(x.origem) && !usadosAgora.has(x.id) && (s.papel !== 'capa' || ['instagram', 'pedro'].includes(x.origem))).sort((a, b) => nota(s, b, fora) - nota(s, a, fora))[0];
          if (r) st.atrib[s.sid] = { id: r.id, motivo: 'foto oficial da marca (lugar não se busca em banco de imagens)', por: 'reserva' };
          continue; // sem oficial: fica a cor da marca, nunca um lugar qualquer
        }
        let f = null; let origem = 'commons';
        try { f = (await (d.fotosDoConceito || require('./fotos').fotosDoConceito)(q, { max: 1, excluir: C.map((x) => x.id), soLivre: true }) || [])[0] || null; } catch { /* segue para o Pexels */ }
        if (!f && (d.buscarFoto || process.env.PEXELS_API_KEY)) {
          origem = 'pexels';
          try { f = await (d.buscarFoto || require('../fotosStudio').buscarFoto)(q, { excluir: C.map((x) => x.id) }); } catch { f = null; }
        }
        if (!f || C.some((x) => x.id === f.meta.id)) continue;
        const cand = await deFora(f, origem);
        cand.descricao = cand.descricao || cand.legenda; cand.descrita_por = cand.descrita_por || 'legenda';
        if (!cand.descartada) st.atrib[s.sid] = { id: cand.id, motivo: `foto de "${q}" (${origem === 'commons' ? 'Wikimedia Commons, domínio público' : 'Pexels'})`, por: 'busca' };
      }
      // o que sobrou: a melhor foto oficial ainda não usada (melhor do que só a cor da marca)
      const usados = new Set(Object.values(st.atrib).map((a) => a.id));
      for (const s of slides) {
        if (st.atrib[s.sid]) continue;
        const r = C.filter((x) => usavel(x) && OFICIAIS.includes(x.origem) && !usados.has(x.id) && (s.papel !== 'capa' || ['instagram', 'pedro'].includes(x.origem))).sort((a, b) => nota(s, b, fora) - nota(s, a, fora))[0];
        if (r) { st.atrib[s.sid] = { id: r.id, motivo: 'reserva: a foto oficial mais marcante que sobrou', por: 'reserva' }; usados.add(r.id); }
      }
    } else if (fase === 'aplicar') {
      const slides = slidesDoCarrossel(c);
      aplicar(c, slides.map((s) => [s, st.atrib[s.sid]]));
    }
    st.fase = FASES[FASES.indexOf(fase) + 1];
  }
}

// Põe a atribuição no documento: c.top.fotos_marca[i] (arte), c.top.foto_por_slide[sid] (motivo) e a meta em c.imagens.
function aplicar(c, pares) {
  const C = c.top.fotos_candidatas || []; const ig = c.top.fotos_marca_estado?.ig;
  c.top.fotos_marca ||= {}; c.top.foto_por_slide ||= {};
  for (const [s, a] of pares) {
    const cand = a && C.find((x) => x.id === a.id);
    if (!cand) { delete c.top.fotos_marca[s.i]; delete c.top.foto_por_slide[s.sid]; continue; }
    c.top.fotos_marca[s.i] = cand.id;
    c.top.foto_por_slide[s.sid] = { id: cand.id, motivo: a.motivo || '', por: a.por || 'manual', origem: cand.origem };
  }
  const usadas = new Set(Object.values(c.top.fotos_marca).filter(Boolean)); const ids = new Set(C.map((x) => x.id));
  const motivoDe = (id) => Object.values(c.top.foto_por_slide).find((x) => x.id === id)?.motivo || '';
  c.imagens = [...(c.imagens || []).filter((i) => !ids.has(i.id) || usadas.has(i.id)).filter((i) => !usadas.has(i.id)),
    ...C.filter((x) => usadas.has(x.id)).map((x) => ({ ...metaDe(c, x, ig), relevancia: 'alta', motivo: motivoDe(x.id) }))];
}

module.exports = { PROMO, LUGAR, ESPERA_IG_MAX, etapa, aplicar, validarCasamento, imagensDaMateria, creditoDe, confereMarca, lerInstagram, midiasDe, dHash, distancia, preparar, baixar, slidesDoCarrossel, metaDe, tokens, FASES, MAX_CANDIDATAS, LADO_MIN, PALAVRAS_TEXTO, CASAR };
