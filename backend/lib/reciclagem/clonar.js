// Clone autorizado: traduz um post de outra conta e remonta no formato da ferramenta, mantendo a mesma estrutura (mesmo
// número de slides, mesma ordem, mesmo texto traduzido e a foto de cada slide). O Pedro combina com cada autor por fora;
// o crédito ao autor entra na legenda e nada vai ao Instagram sem a aprovação do Pedro.
//
// Custo de IA mínimo: o texto dos slides sai por OCR (Tesseract, já no servidor, de graça); a tradução é UMA chamada por
// post e só pelas IAs gratuitas (pago: 'nunca'). Nada passa pela OpenAI.
//
// Etapas (cada chamada de `passo` cabe no limite da função; o app chama de novo até terminar):
//   buscar  → lê o post na Graph API (legenda e imagem de cada slide) e baixa as imagens;
//   ler     → OCR de cada slide (título e corpo pela altura da letra) e recorte da faixa sem texto como foto;
//   traduzir→ uma chamada à IA gratuita com todos os slides e a legenda;
//   arte    → desenha os slides no formato tweet (texto + foto), com o crédito;
//   fim     → portões de publicação e "Para aprovar".
const crypto = require('crypto');
const M = require('../../../static/contentModel');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const Coletar = require('./coletar');

const conta = () => ACCOUNT.ig_id;
const erro = (msg, status = 400, code = 'CLONE') => Object.assign(new Error(msg), { status, code });
const MAX_SLIDES = 10; const FAIXA_MIN = 0.35; // a faixa sem texto precisa de 35% da altura para virar foto
const ETAPAS = ['buscar', 'ler', 'traduzir', 'arte', 'fim'];
const CANAIS = ['DM do Instagram', 'WhatsApp', 'E-mail', 'Pessoalmente', 'Outro'];
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('O clone precisa do banco de dados no servidor.', 503, 'SEM_BANCO'); return a; };
const normLink = (u) => String(u || '').trim().toLowerCase().replace(/\?.*$/, '').replace(/\/+$/, '');

// ── Autorização ─────────────────────────────────────────────────────────────
async function autorizar(itemId, { autor, canal, data, prova, credito } = {}, { agora = Date.now() } = {}) {
  const item = await Coletar.obter(itemId); if (!item) throw erro('Item não encontrado.', 404, 'NAO_ENCONTRADO');
  const a = String(autor || '').trim().replace(/^@?/, '@').slice(0, 40);
  if (a.length < 3) throw erro('Diga quem autorizou (o @ do autor).');
  if (!CANAIS.includes(canal)) throw erro(`Diga onde a autorização foi dada: ${CANAIS.join(', ')}.`);
  const p = String(prova || '').trim().slice(0, 600);
  if (p.length < 10) throw erro('Descreva a prova da autorização (o que ele escreveu, ou o link/print de onde está).');
  const d = String(data || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Date.parse(d) > agora + 86400000) throw erro('Data da autorização inválida.');
  const cred = String(credito || '').trim().slice(0, 160) || `Conteúdo original de ${a}, traduzido e publicado com autorização.`;
  const autorizacao = { autor: a, canal, data: d, prova: p, credito: cred, registrada_em: new Date(agora).toISOString() };
  await db().radar.salvar(conta(), Coletar.TIPO, item.id, { ...item, autorizacao });
  return autorizacao;
}

// ── Buscar o original ───────────────────────────────────────────────────────
// Caminho rápido: as imagens que a coleta já guardou (links do CDN do Instagram, válidos por alguns dias). Se algum
// link venceu, cai na busca pela Graph.
async function baixarGuardadas(item, f) {
  if (!item.midias?.length) return null;
  try {
    const imagens = [];
    for (const u of item.midias.slice(0, MAX_SLIDES)) { const r = await f(u); if (!r.ok) return null; imagens.push(Buffer.from(await r.arrayBuffer())); }
    return { legenda: String(item.legenda || ''), imagens };
  } catch { return null; }
}
async function buscarOriginal(item, { graph, igId, fetch: f = globalThis.fetch } = {}) {
  if (item.rede !== 'instagram') throw erro('Por enquanto o clone é só para posts do Instagram.', 409, 'REDE');
  if (!['carrossel', 'imagem'].includes(item.tipo)) throw erro('Por enquanto o clone é só para carrossel e post de imagem (reel ainda não).', 409, 'TIPO');
  const guardadas = await baixarGuardadas(item, f); if (guardadas) return guardadas;
  const meta = require('../meta');
  const g = graph || meta.graph; const ig = igId || meta.config().igId;
  const h = String(item.conta?.handle || '').replace(/^@/, '');
  const d = await g('GET', ig, { fields: `business_discovery.username(${h}){media.limit(50){permalink,caption,media_type,media_url,children{media_type,media_url}}}` });
  const m = (d?.business_discovery?.media?.data || []).find((x) => normLink(x.permalink) === normLink(item.permalink));
  if (!m) throw erro('Não achei o post entre os 50 mais recentes da conta. A Meta só deixa ler os recentes.', 404, 'NAO_ACHEI');
  const urls = (m.children?.data?.length ? m.children.data : [m]).filter((x) => x.media_type === 'IMAGE' && x.media_url).map((x) => x.media_url).slice(0, MAX_SLIDES);
  if (!urls.length) throw erro('A Meta não liberou as imagens deste post (ou ele só tem vídeos).', 409, 'SEM_IMAGEM');
  const imagens = [];
  for (const u of urls) { const r = await f(u); if (!r.ok) throw erro(`Não consegui baixar uma imagem do post (${r.status}).`, 502, 'DOWNLOAD'); imagens.push(Buffer.from(await r.arrayBuffer())); }
  return { legenda: String(m.caption || '').slice(0, 2200), imagens };
}

// ── Ler um slide ────────────────────────────────────────────────────────────
// Maior faixa horizontal sem texto (pelas linhas da OCR): vira a foto do slide, se tiver altura suficiente.
function faixaSemTexto(linhas, altura) {
  const ocup = linhas.filter((l) => l.y1 > l.y0).map((l) => [Math.max(0, l.y0 - 12), Math.min(altura, l.y1 + 12)]).sort((a, b) => a[0] - b[0]);
  let melhor = { y: 0, h: 0 }; let cursor = 0;
  for (const [a, b] of ocup) { if (a - cursor > melhor.h) melhor = { y: cursor, h: a - cursor }; cursor = Math.max(cursor, b); }
  if (altura - cursor > melhor.h) melhor = { y: cursor, h: altura - cursor };
  return melhor.h >= altura * FAIXA_MIN ? melhor : null;
}

const TT = require('./trocaTexto');

async function lerSlide(buf, { ocr, sharp = require('sharp') } = {}) {
  const meta = await sharp(buf).metadata();
  const r = await (ocr || require('../lerPrint').lerLinhas)(buf);
  const linhas = (r.linhas || []).filter((l) => (l.confianca ?? 100) >= 40);
  const sep = require('../lerCarrossel').separarTelaDeCarrossel({ linhas, text: r.text });
  const faixa = faixaSemTexto(linhas, meta.height || 1350);
  const foto = faixa ? await sharp(buf).extract({ left: 0, top: Math.round(faixa.y), width: meta.width, height: Math.round(faixa.h) }).jpeg({ quality: 88 }).toBuffer() : null;
  // Parágrafos com caixa: a cópia fiel troca cada um no lugar, em cima da imagem original.
  const paragrafos = (r.trechos || r.paragrafos || []).filter(TT.ehTexto).slice(0, 30).map((p) => ({ texto: p.texto.slice(0, 600), x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, altura_linha: p.altura_linha, confianca: p.confianca }));
  return { titulo: String(sep.title || '').trim(), corpo: String(sep.body || '').trim(), texto_ocr: String(r.text || '').trim().slice(0, 1500), foto, paragrafos };
}

// ── Traduzir (uma chamada, só IA gratuita) ──────────────────────────────────
const SISTEMA_TRADUCAO = `Você traduz um carrossel de Instagram para o português do Brasil, com AUTORIZAÇÃO do autor original. Seja FIEL: mesma ideia, mesma ordem, mesmo tom, mesmo tamanho aproximado de texto. Não acrescente nem invente nada; números, valores e nomes ficam exatamente iguais. Corrija só erros evidentes de leitura (OCR). Se o texto já estiver em português, mantenha e só corrija a leitura.
Tire do texto: @ e nome do autor, marca d'água, contador de slides ("3/8"), "arraste/swipe", e pedidos para seguir, comentar ou salvar o PERFIL DO AUTOR (o crédito ao autor vai na legenda, pelo sistema).
Responda APENAS JSON: {"slides":[{"i":0,"titulo":"","texto":""}],"legenda":""}`;

// Cópia fiel: traduz parágrafo por parágrafo (cada um volta para o mesmo lugar da imagem original).
const SISTEMA_TRADUCAO_FIEL = `Você traduz para o português do Brasil o texto que aparece nas imagens de um post de Instagram, parágrafo por parágrafo. Cada parágrafo vai ser escrito NO MESMO LUGAR da imagem original, então: tradução fiel, natural e do MESMO TAMANHO ou mais curta (é texto de imagem: prefira a forma curta). Números, valores e nomes ficam iguais. Corrija só erros evidentes de leitura (OCR).
Devolva "texto" igual ao original (sem traduzir) quando o parágrafo for: @ ou nome de perfil, marca d'água, assinatura, nome próprio, onomatopeia, ou lixo de leitura sem sentido.
Responda APENAS JSON: {"blocos":[{"id":"0.0","texto":""}],"legenda":""}`;

async function traduzirFiel(slides, legenda, pedir) {
  const usuario = `PARÁGRAFOS LIDOS DAS IMAGENS (id = slide.parágrafo):\n${slides.flatMap((s, i) => (s.paragrafos || []).map((p, j) => `[${i}.${j}] ${p.texto}`)).join('\n')}\n\nLEGENDA ORIGINAL:\n${legenda || '(sem legenda)'}`;
  const { dados } = await pedir({ sistema: SISTEMA_TRADUCAO_FIEL, usuario, maxTokens: 3000, temperatura: 0.2, pago: 'nunca', etapa: 'clone_traducao' });
  const por = new Map((Array.isArray(dados?.blocos) ? dados.blocos : []).map((x) => [String(x.id), String(x.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)]));
  return {
    fiel: true,
    slides: slides.map((s, i) => {
      const blocos = (s.paragrafos || []).map((p, j) => { const t = por.get(`${i}.${j}`); return { ...p, novo: t && t.toLowerCase() !== p.texto.toLowerCase() ? t : null }; });
      const textos = blocos.map((b) => b.novo || b.texto);
      return { titulo: (textos[0] || '').slice(0, 160), texto: textos.slice(1).join(' ').slice(0, 700), blocos };
    }),
    legenda: (String(dados?.legenda || '').trim() || String(legenda || '').trim()).slice(0, 1900),
  };
}

async function traduzir(slides, legenda, { pedirJson } = {}) {
  const pedir = pedirJson || require('../llmJson').pedirJson;
  if (slides.some((s) => (s.paragrafos || []).length)) return traduzirFiel(slides, legenda, pedir);
  const usuario = `SLIDES (texto lido da imagem):\n${slides.map((s, i) => `[${i}] TÍTULO: ${s.titulo || '(vazio)'}\nCORPO: ${s.corpo || '(vazio)'}`).join('\n\n')}\n\nLEGENDA ORIGINAL:\n${legenda || '(sem legenda)'}`;
  const { dados } = await pedir({ sistema: SISTEMA_TRADUCAO, usuario, maxTokens: 3000, temperatura: 0.2, pago: 'nunca', etapa: 'clone_traducao' });
  const por = new Map((Array.isArray(dados?.slides) ? dados.slides : []).map((x) => [Number(x.i), x]));
  return {
    slides: slides.map((s, i) => ({ titulo: String(por.get(i)?.titulo ?? '').trim().slice(0, 160), texto: String(por.get(i)?.texto ?? '').trim().slice(0, 700) })),
    legenda: (String(dados?.legenda || '').trim() || String(legenda || '').trim()).slice(0, 1900), // IA devolveu vazio: fica a original
  };
}

// ── Montar a versão ─────────────────────────────────────────────────────────
function montar(c, item) {
  const cl = c.clone; const aut = item.autorizacao || cl.autorizacao;
  const claims = []; const evidencias = [];
  const slides = cl.traducao.slides.map((t, i) => {
    const txt = i === 0 ? [t.titulo, t.texto].filter(Boolean).join(' ') : (t.titulo ? `**${t.titulo}** ${t.texto}`.trim() : t.texto);
    let claim_ids = [];
    if (M.extrairNumeros(txt).length && !cl.traducao.fiel) { // número traduzido: ligado ao texto lido do post original (a fonte autorizada)
      const id = `k${i + 1}`; claim_ids = [id];
      claims.push({ id, texto: txt.replace(/\*/g, '').slice(0, 400), tipo: 'fato', natureza: 'fato', central: true, estado: 'sustentada', evidencias: [`e_${id}`], valores: M.extrairNumeros(txt).map((n) => ({ valor: n.valor })), risco: 'baixo', revisao: {}, origem: 'clone' });
      evidencias.push({ id: `e_${id}`, tipo: 'secundaria', autoridade: 'autor_original', correspondencia: 'integral', relacao: 'sustenta', trecho: cl.slides[i].texto_ocr.slice(0, 600), origem: aut.autor, titulo: `Post original de ${aut.autor}`, url: item.permalink, consultada_em: cl.lido_em, fonte_principal: true });
    }
    // Cópia fiel: a imagem original com o texto trocado no lugar (desenho, cores e layout iguais ao original).
    if (cl.traducao.fiel) return { id: `s${i + 1}`, funcao: i === 0 ? 'capa' : 'explicacao', layout: 'foto_inteira', tema_visual: 'foto', titulo: null, texto: '', imagem_id: cl.slides[i].pt_id || cl.slides[i].inteira_id, claim_ids: [] };
    // Sem texto traduzido (post de foto, ou a leitura só achou ruído): o slide é a imagem original inteira.
    if (!txt.replace(/\*/g, '').trim()) return { id: `s${i + 1}`, funcao: i === 0 ? 'capa' : 'explicacao', layout: 'foto_inteira', tema_visual: 'foto', titulo: null, texto: '', imagem_id: cl.slides[i].inteira_id || cl.slides[i].foto_id || null, claim_ids: [] };
    return { id: `s${i + 1}`, funcao: i === 0 ? 'capa' : 'explicacao', layout: 'tweet', tema_visual: 'tweet', titulo: null, texto: txt || ' ', imagem_id: cl.slides[i].foto_id || null, claim_ids };
  });
  // Números da legenda: ligados à legenda original (também material autorizado).
  const legTrad = cl.traducao.legenda || '';
  if (M.extrairNumeros(legTrad).length) {
    claims.push({ id: 'kL', texto: legTrad.slice(0, 400), tipo: 'fato', natureza: 'fato', central: false, estado: 'sustentada', evidencias: ['e_kL'], valores: M.extrairNumeros(legTrad).map((n) => ({ valor: n.valor })), risco: 'baixo', revisao: {}, origem: 'clone' });
    evidencias.push({ id: 'e_kL', tipo: 'secundaria', autoridade: 'autor_original', correspondencia: 'integral', relacao: 'sustenta', trecho: String(cl.legenda_original || '').slice(0, 600), origem: aut.autor, titulo: `Legenda original de ${aut.autor}`, url: item.permalink, consultada_em: cl.lido_em, fonte_principal: true });
  }
  c.claims = claims; c.evidencias = evidencias;
  c.imagens = cl.slides.flatMap((s) => [s.foto_id, s.inteira_id, s.pt_id]).filter(Boolean).map((fid) => ({ id: fid })).map((s) => ({ id: s.id, tipo: 'foto_autorizada', autor: aut.autor, licenca: `Uso autorizado por ${aut.autor} (${aut.canal}, ${aut.data})`, exige_credito: false, origem: item.permalink }));
  const legenda = [cl.traducao.legenda, aut.credito].filter(Boolean).join('\n\n').slice(0, 2200);
  M.criarVersao(c, { slides, legenda, legenda_claim_ids: claims.map((k) => k.id), cta: '', hashtags: [] }, { quem: 'sistema', rotulo: `clone autorizado de ${aut.autor}` });
}

// ── Passo a passo ───────────────────────────────────────────────────────────
async function iniciar(itemId, { agora = Date.now() } = {}) {
  const item = await Coletar.obter(itemId); if (!item) throw erro('Item não encontrado.', 404, 'NAO_ENCONTRADO');
  // Sem etapa de registro (decisão do Pedro: ele combina com cada autor por fora). O crédito ao autor entra na legenda e pode ser
  // editado na aprovação.
  const h = `@${String(item.conta?.handle || 'autor').replace(/^@/, '')}`;
  item.autorizacao = item.autorizacao || { autor: h, canal: 'combinado pelo Pedro', data: new Date(agora).toISOString().slice(0, 10), prova: null, credito: `Conteúdo original de ${h}.` };
  await db().radar.salvar(conta(), Coletar.TIPO, item.id, item);
  const c = M.novoConteudo({ titulo: `Cópia de @${String(item.conta?.handle || '').replace(/^@/, '')}${item.tema ? `: ${item.tema}` : ''}`.slice(0, 140), formato: 'carrossel', origem: { tipo: 'clone_autorizado', url: item.permalink } });
  c.clone = { item_id: item.id, etapa: 'buscar', estado: 'em_andamento', autorizacao: item.autorizacao, slides: [], criado_em: new Date(agora).toISOString(), erros: [] };
  c.studio = { estado: 'gerando', origem: 'clone' };
  await db().conteudos.salvar(conta(), c.id, c, 0);
  try { await Coletar.marcarReciclado(item.id, { formato: 'clone', conteudo_id: c.id }); } catch { /* cortesia */ }
  return c;
}

async function passo(id, { orcamentoMs = 45000, deps = {} } = {}) {
  const inicio = Date.now(); const resta = () => orcamentoMs - (Date.now() - inicio);
  const a = db(); const reg = await a.conteudos.obter(conta(), id); if (!reg?.doc?.clone) throw erro('Clone não encontrado.', 404, 'NAO_ENCONTRADO');
  const c = reg.doc; let rev = reg.rev; const cl = c.clone;
  const gravar = async () => { c.updated_at = new Date().toISOString(); rev = (await a.conteudos.salvar(conta(), c.id, c, rev)).rev; };
  if (cl.estado !== 'em_andamento') return resumo(c);
  const item = await Coletar.obter(cl.item_id);
  try {
    while (cl.estado === 'em_andamento' && resta() > 8000) {
      if (cl.etapa === 'buscar') {
        const o = await buscarOriginal(item, deps);
        cl.legenda_original = o.legenda; cl.n = o.imagens.length; cl.lido_em = new Date().toISOString();
        for (const [i, b] of o.imagens.entries()) await a.arquivos.salvar(conta(), `clone_orig:${c.id}:${i}`, b, 'image/jpeg');
        cl.etapa = 'ler';
      } else if (cl.etapa === 'ler') {
        while (cl.slides.length < cl.n && resta() > 8000) {
          const i = cl.slides.length; const arq = await a.arquivos.obter(conta(), `clone_orig:${c.id}:${i}`);
          const s = await lerSlide(Buffer.from(arq.dados), { ocr: deps.ocr });
          let foto_id = null; if (s.foto) { foto_id = `clone_${c.id}_${i}`; await a.arquivos.salvar(conta(), `img:${foto_id}`, s.foto, 'image/jpeg'); }
          // A imagem inteira também fica: slide sem texto de verdade (só foto) sai igual ao original.
          const inteira_id = `clone_${c.id}_${i}_inteira`; await a.arquivos.salvar(conta(), `img:${inteira_id}`, await TT.encaixar45(Buffer.from(arq.dados)), 'image/jpeg');
          cl.slides.push({ titulo: s.titulo, corpo: s.corpo, texto_ocr: s.texto_ocr, foto_id, inteira_id, paragrafos: s.paragrafos || [] });
        }
        if (cl.slides.length < cl.n) break;
        
        cl.etapa = 'traduzir';
      } else if (cl.etapa === 'traduzir') {
        const Visao = require('./visaoTexto');
        if (deps.visao || (!deps.pedirJson && Visao.disponivel())) {
          // Leitura com IA que enxerga: texto conferido na imagem (sem erro de OCR), tradução e assinatura do autor marcada.
          cl.visao = cl.visao || [];
          const handle = String(item?.conta?.handle || '').replace(/^@/, '');
          while (cl.visao.length < cl.n && resta() > 14000) {
            const i = cl.visao.length; const arq = await a.arquivos.obter(conta(), `clone_orig:${c.id}:${i}`);
            const r = await (deps.visao || Visao.chamar)({ imagem: Buffer.from(arq.dados), handle, legenda: i === 0 ? cl.legenda_original : null, prazoMs: Math.min(30000, resta() - 9000) });
            cl.visao.push({ elementos: r.dados.elementos, legenda: String(r.dados.legenda || '').trim(), provedor: r.provedor || null, modelo: r.modelo || null });
          }
          if (cl.visao.length < cl.n) break;
          const slides = [];
          for (const [i, s] of cl.slides.entries()) {
            const arq = await a.arquivos.obter(conta(), `clone_orig:${c.id}:${i}`); const m = await require('sharp')(Buffer.from(arq.dados)).rotate().metadata();
            const blocos = Visao.blocosDaVisao(cl.visao[i], { largura: m.autoOrient?.width || m.width, altura: m.autoOrient?.height || m.height, trechos: s.paragrafos || [] });
            const textos = blocos.filter((b) => b.novo).map((b) => b.novo);
            slides.push({ titulo: (textos[0] || '').slice(0, 160), texto: textos.slice(1).join(' ').slice(0, 700), blocos });
          }
          const tirarAutor = (t) => String(t || '').replace(new RegExp(`@?${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '').replace(/[ \t]{2,}/g, ' ').trim();
          cl.traducao = { fiel: true, visao: true, slides, legenda: (handle ? tirarAutor(cl.visao[0]?.legenda) : cl.visao[0]?.legenda) || cl.legenda_original || '' };
        } else {
          cl.traducao = await traduzir(cl.slides, cl.legenda_original, { pedirJson: deps.pedirJson });
        }
        // Cópia fiel: escreve a tradução em cima da imagem original, no lugar de cada parágrafo (sem IA).
        if (cl.traducao.fiel) {
          for (const [i, t] of cl.traducao.slides.entries()) {
            if (!t.blocos.some((b) => b.novo || b.apagar)) continue;
            const arq = await a.arquivos.obter(conta(), `clone_orig:${c.id}:${i}`); if (!arq) continue;
            const { buffer, trocados } = await TT.substituir(Buffer.from(arq.dados), t.blocos);
            if (!trocados.length) continue;
            const pt_id = `clone_${c.id}_${i}_pt`; await a.arquivos.salvar(conta(), `img:${pt_id}`, await TT.encaixar45(buffer), 'image/jpeg');
            cl.slides[i].pt_id = pt_id; cl.slides[i].trocados = trocados.length;
          }
        }
        c.titulo = (cl.traducao.slides[0]?.titulo || cl.traducao.slides[0]?.texto || c.titulo || '').replace(/\*/g, '').slice(0, 140) || c.titulo;
        montar(c, item); cl.arte_indice = 0; c.arte = { renders: [] };
        cl.etapa = 'arte';
      } else if (cl.etapa === 'arte') {
        const v = M.versaoAtiva(c); const arte = deps.arte || require('../arte');
        while (cl.arte_indice < v.slides.length && resta() > 6000) {
          const s = v.slides[cl.arte_indice];
          const imagem = s.imagem_id ? (await a.arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados : null;
          const r = await arte.renderizarSlide(s, { indice: cl.arte_indice + 1, total: v.slides.length, imagem: imagem ? Buffer.from(imagem) : null });
          const key = `render:${c.id}:${v.id}:${s.id}:${M.hashRender(s)}`;
          const previa = await require('sharp')(r.png).flatten({ background: '#FFFFFF' }).jpeg({ quality: 84 }).toBuffer().catch(() => null);
          await a.arquivos.salvar(conta(), key, previa || r.png, previa ? 'image/jpeg' : 'image/png');
          c.arte.renders.push({ slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), blob_key: key, indice: cl.arte_indice + 1, metrics: r.metrics });
          cl.arte_indice += 1;
        }
        if (cl.arte_indice < v.slides.length) break;
        cl.etapa = 'fim';
      } else if (cl.etapa === 'fim') {
        const G = require('../../../static/qualityGates');
        const copia = M.clone(c); (copia.claims || []).forEach((k) => { k.revisao = { ...(k.revisao || {}), confirmada_por_pedro: true }; });
        const bl = G.avaliar(copia, { conta: M.ACCOUNT_PIN }).bloqueios;
        const naoCabe = c.arte.renders.filter((r) => r.metrics?.cabe === false).length;
        cl.aviso = [naoCabe ? `${naoCabe} slide(s) com texto grande demais: encurte antes de aprovar.` : null, ...bl.map((b) => b.titulo)].filter(Boolean).join(' · ') || null;
        c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: new Date().toISOString(), origem: 'clone' };
        cl.estado = 'concluido'; cl.concluido_em = new Date().toISOString();
        await a.arquivos.apagar(conta(), Array.from({ length: cl.n || 0 }, (_, i) => `clone_orig:${c.id}:${i}`)).catch(() => {}); // o original baixado não fica guardado
        M.registrar(c, 'sistema', 'clone', `Cópia de ${cl.autorizacao.autor} pronta para aprovar.`);
      }
    }
  } catch (e) {
    const cota = e.status === 429 || /\b429\b|rate.?limit|quota/i.test(String(e.message));
    cl.erros = [...(cl.erros || []), { etapa: cl.etapa, em: new Date().toISOString(), mensagem: String(e.message).slice(0, 900), codigo: e.code || (cota ? 'COTA_IA' : null) }].slice(-8);
    if (!cota) { cl.estado = 'erro'; cl.motivo = String(e.message).slice(0, 900); c.studio = { estado: 'erro', erro: cl.motivo, origem: 'clone' }; 
      await a.arquivos.apagar(conta(), Array.from({ length: cl.n || 0 }, (_, i) => `clone_orig:${c.id}:${i}`)).catch(() => {}); }
  }
  await gravar();
  return resumo(c);
}

const resumo = (c) => ({ id: c.id, titulo: c.titulo, estado: c.clone?.estado, etapa: c.clone?.etapa, slides: c.clone?.n ?? null, lidos: c.clone?.slides?.length ?? 0, aviso: c.clone?.aviso || null, motivo: c.clone?.motivo || null, erro: (c.clone?.erros || []).slice(-1)[0] || null, concluido: c.clone?.estado !== 'em_andamento' });

module.exports = { SISTEMA_TRADUCAO_FIEL, CANAIS, ETAPAS, autorizar, buscarOriginal, faixaSemTexto, lerSlide, traduzir, montar, iniciar, passo, resumo, SISTEMA_TRADUCAO };
