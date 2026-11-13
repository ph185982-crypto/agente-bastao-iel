// Radar de Reciclagem: coleta o que viralizou nas contas vigiadas, mede, classifica e guarda.
//
// Fontes (todas só leitura, nenhuma raspagem):
//  - Instagram Graph `business_discovery`: 1 chamada por conta (uma página de até 40 mídias), no máximo 40 contas por
//    coleta. Cabe folgado no limite de 200 chamadas/hora da Meta. Conta que a Meta recusa (não é Business/Creator,
//    handle errado) só registra o erro e a coleta segue.
//  - YouTube Data API v3, SÓ com YOUTUBE_API_KEY: channels.list + playlistItems + videos.list (3 unidades por canal),
//    teto de 300 unidades por dia (a cota gratuita é 10.000).
//  - Google Trends RSS (assuntos do dia no Brasil), parse de XML simples; falha vira lista vazia, nunca erro.
//
// Índice de viralidade (VL), comparável entre contas de tamanhos diferentes:
//   ER do post = (curtidas + 3 × comentários) ÷ seguidores da conta no dia da coleta;
//   VL = ER do post ÷ MEDIANA do ER dos posts da conta (mediana, para o próprio viral não puxar a base);
//   só posts com 72 h ou mais (a maior parte das visualizações chega nos 3 primeiros dias);
//   para Reels, visualizações ÷ seguidores com a mesma lógica (curtidas podem estar ocultas).
//   VL ≥ 3 = viral para aquela conta; VL ≥ 5 = outlier forte.
//
// A legenda original fica guardada para o Pedro ver o post no app e para a cópia traduzida (decisão dele, 15/11/2026).
// Na classificação ela entra na IA só como DADO, para tirar tema, mecanismo e tese.
const crypto = require('crypto');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const Contas = require('./contas');
const llmJson = require('../llmJson');

const TIPO = 'reciclagem';                 // itens, um documento por post (id derivado do permalink)
const TIPO_ESTADO = 'reciclagem_estado';   // documento único com a última coleta, tendências e controle do push
const MATURIDADE_H = 72;
const RETENCAO_DIAS = 30;
const MAX_CONTAS = 70;                     // 1 chamada por conta; 3 coletas por dia, em rodízio
const LIMITE_MIDIAS = 50;
const LOTE_IA = 15;
const MAX_CLASSIFICAR = 45;                // 3 lotes por coleta
const VL_CANDIDATO = 1.5;                  // abaixo disso nem entra no armazém
const VL_CLASSIFICAR = 2;
const VL_ALTA = 3;
const MAX_GUARDAR = 600;
const COTA_YOUTUBE = 300;
const TRENDS_URL = 'https://trends.google.com/trending/rss?geo=BR';

const conta = () => ACCOUNT.ig_id;
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const idDe = (permalink) => `rc_${sha1(String(permalink).trim().toLowerCase().replace(/\/+$/, '')).slice(0, 16)}`;
const iso = (ms) => new Date(ms).toISOString();
const diaBRT = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(0, 10); // Brasília é UTC−3 o ano todo
const erro = (msg, code, status = 400) => Object.assign(new Error(msg), { code, status });
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const arred = (v, c = 3) => (v == null ? null : Math.round(v * 10 ** c) / 10 ** c);

// ── Métrica ─────────────────────────────────────────────────────────────────────
function mediana(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
// ER com comentário ponderado (×3): comentar custa mais que curtir. Sem seguidores ou sem nenhuma métrica → null.
function er({ curtidas, comentarios }, seguidores) {
  if (!(seguidores > 0)) return null;
  if (curtidas == null && comentarios == null) return null;
  return ((curtidas || 0) + 3 * (comentarios || 0)) / seguidores;
}
const maduro = (publicadoEm, agora) => { const t = Date.parse(publicadoEm); return Number.isFinite(t) && agora - t >= MATURIDADE_H * 3600000; };

// Pontua os posts de UMA conta: só os maduros entram; VL relativo à mediana da própria conta.
function pontuar(posts, seguidores, { agora = Date.now() } = {}) {
  const maduros = posts.filter((p) => maduro(p.publicado_em, agora));
  const comEr = maduros.map((p) => ({ ...p, er: er(p, seguidores), vps: p.visualizacoes != null && seguidores > 0 ? p.visualizacoes / seguidores : null }));
  // Linha de base da conta: mediana só dos posts com engajamento visível (curtidas ocultas dão ER 0 e derrubariam a
  // mediana, inflando o índice para centenas de vezes). Piso de 0,01% de ER e teto de 50× para o índice ficar comparável.
  const PISO_ER = 0.0001; const TETO_VL = 50;
  // Conta que esconde curtidas em quase tudo (menos de 3 posts visíveis) não tem linha de base própria: usa a base
  // nominal de 0,3% de ER (típica de contas com mais de 1 milhão de seguidores) e marca `base_estimada`.
  const BASE_NOMINAL = 0.003;
  const visiveis = comEr.filter((p) => p.er != null && p.er > 0).map((p) => p.er);
  const baseEstimada = visiveis.length < 3;
  // Base = 75º percentil do ER visível (e não a mediana): o feed dessas contas é de cauda longa (a maioria dos posts rende
  // pouco e uns poucos rendem 50×), e uma mediana minúscula daria 50× para qualquer post bom. Contra o p75, VL ≥ 3 é outlier de verdade.
  const percentil = (xs, q) => { const o = [...xs].sort((a, b) => a - b); if (!o.length) return 0; const i = (o.length - 1) * q; const lo = Math.floor(i); const hi = Math.ceil(i); return o[lo] + (o[hi] - o[lo]) * (i - lo); };
  const medEr = baseEstimada ? BASE_NOMINAL : Math.max(PISO_ER, visiveis.length >= 12 ? percentil(visiveis, 0.75) : (mediana(visiveis) || 0));  // amostra pequena: mediana
  const medVps = Math.max(0.01, mediana(comEr.map((p) => p.vps).filter((v) => v != null && v > 0)) || 0);
  const limita = (v) => (v == null ? null : Math.min(TETO_VL, v));
  return comEr.map((p) => {
    const vl_er = limita(p.er != null && p.er > 0 ? p.er / medEr : null);
    const vl_views = limita(p.vps != null && p.vps > 0 ? p.vps / medVps : null);
    return { ...p, seguidores, er: arred(p.er, 6), visualizacoes_por_seguidor: arred(p.vps, 4), vl_er: arred(vl_er), vl_views: arred(vl_views), vl: arred(vl_er ?? vl_views), mediana_er: arred(medEr, 6), base_estimada: baseEstimada, n_base: comEr.length };
  });
}

// ── Instagram (Graph business_discovery) ────────────────────────────────────────
const tipoIg = (m) => (m.media_product_type === 'REELS' || m.media_type === 'VIDEO' ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carrossel' : 'imagem');
function normalizarMidiaIg(m) {
  if (!m?.permalink || !m?.timestamp) return null;
  return { permalink: String(m.permalink), publicado_em: String(m.timestamp), tipo: tipoIg(m), curtidas: num(m.like_count), comentarios: num(m.comments_count), visualizacoes: num(m.view_count), n_slides: Array.isArray(m.children?.data) ? m.children.data.length || null : null, midias: (Array.isArray(m.children?.data) && m.children.data.length ? m.children.data : [m]).filter((x) => x.media_type === 'IMAGE' && x.media_url).map((x) => String(x.media_url)).slice(0, 20), legenda: String(m.caption || '').trim().slice(0, 2200) };
}
async function coletarInstagram({ contas, graph, igId, agora = Date.now(), maxContas = MAX_CONTAS, orcamentoMs = 40000, concorrencia = 7 } = {}) {
  const lista = (contas || []).slice(0, maxContas); const itens = []; const resumo = []; const inicio = Date.now(); let parcial = false;
  const fila = [...lista];
  const trabalhador = async () => {
    while (fila.length) {
      if (Date.now() - inicio > orcamentoMs) { parcial = true; return; }
      const c = fila.shift(); const h = c.handle;
      try {
        const campos = (n) => `business_discovery.username(${h}){username,followers_count,media.limit(${n}){like_count,comments_count,view_count,caption,permalink,media_type,timestamp,media_product_type,media_url,thumbnail_url,children.limit(20){media_type,media_url}}}`;
        let d;
        try { d = await graph('GET', igId, { fields: campos(LIMITE_MIDIAS) }); }
        catch (e1) {
          // Conta grande: a Meta pede "reduce the amount of data". Repete com menos mídias antes de desistir.
          if (!/reduce the amount|amount of data|too large|1\b.*unknown error|An unknown error/i.test(`${e1?.meta?.mensagem_original || ''} ${e1?.message || ''}`) || e1?.meta?.tipo === 'limite' || e1?.meta?.tipo === 'token') throw e1;
          d = await graph('GET', igId, { fields: campos(15) });
        }
        const bd = d?.business_discovery || {}; const seguidores = num(bd.followers_count);
        const posts = (bd.media?.data || []).map(normalizarMidiaIg).filter(Boolean);
        const pontuados = pontuar(posts, seguidores, { agora });
        for (const p of pontuados) itens.push({ ...p, rede: 'instagram', conta: { handle: h, nome: c.nome || h, pais: c.pais || '??', idioma: c.idioma || 'pt' } });
        resumo.push({ handle: h, ok: true, seguidores, lidos: posts.length, maduros: pontuados.length });
      } catch (e) {
        // Conta que a Meta recusa (não é profissional, handle errado, permissão) só fica registrada: as outras seguem.
        resumo.push({ handle: h, ok: false, erro: String(e?.meta?.amigavel || e?.message || 'erro').slice(0, 160), original: String(e?.meta?.mensagem_original || '').slice(0, 200) || null, tipo: e?.meta?.tipo || null });
        if (e?.meta?.tipo === 'token' || e?.meta?.tipo === 'limite') { parcial = true; fila.length = 0; return; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, lista.length)) }, trabalhador));
  return { itens, contas: resumo, parcial, chamadas: resumo.length };
}

// ── YouTube Data API v3 (só com chave) ──────────────────────────────────────────
const YT = 'https://www.googleapis.com/youtube/v3';
const segundosISO = (d) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(d || '')); return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : null; };
async function coletarYoutube({ canais, chave, fetcher, agora = Date.now(), cota = COTA_YOUTUBE, orcamentoMs = 25000, concorrencia = 3 } = {}) {
  if (!chave) return { itens: [], canais: [], pulado: 'sem YOUTUBE_API_KEY', unidades: 0 };
  const f = fetcher || globalThis.fetch;
  const pegar = async (recurso, params) => {
    const u = new URL(`${YT}/${recurso}`); u.search = new URLSearchParams({ ...params, key: chave }).toString();
    const r = await f(u.toString(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error?.message || m; } catch { /* sem corpo */ } throw new Error(m); }
    return r.json();
  };
  const itens = []; const resumo = []; const inicio = Date.now(); let unidades = 0; let parcial = false;
  const fila = [...(canais || [])];
  const trabalhador = async () => {
    while (fila.length) {
      if (Date.now() - inicio > orcamentoMs || unidades + 3 > cota) { parcial = true; return; }
      const c = fila.shift();
      try {
        unidades += 3; // reservado antes das chamadas: a cota é o limite duro
        const ch = await pegar('channels', { part: 'contentDetails,statistics', ...(c.canal.startsWith('@') ? { forHandle: c.canal } : { id: c.canal }) });
        const canal = ch.items?.[0]; if (!canal) throw new Error('canal não encontrado');
        const uploads = canal.contentDetails?.relatedPlaylists?.uploads; const inscritos = num(canal.statistics?.subscriberCount);
        if (!uploads) throw new Error('canal sem lista de envios');
        const pl = await pegar('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '15' });
        const ids = (pl.items || []).map((x) => x.contentDetails?.videoId).filter(Boolean);
        if (!ids.length) { resumo.push({ canal: c.canal, ok: true, inscritos, lidos: 0, maduros: 0 }); continue; }
        const vs = await pegar('videos', { part: 'statistics,snippet,contentDetails', id: ids.join(',') });
        const posts = (vs.items || []).map((v) => ({
          permalink: `https://www.youtube.com/watch?v=${v.id}`, publicado_em: v.snippet?.publishedAt, tipo: (segundosISO(v.contentDetails?.duration) ?? 999) <= 60 ? 'short' : 'video',
          curtidas: num(v.statistics?.likeCount), comentarios: num(v.statistics?.commentCount), visualizacoes: num(v.statistics?.viewCount),
          legenda: `${v.snippet?.title || ''} ${String(v.snippet?.description || '').slice(0, 300)}`.replace(/\s+/g, ' ').trim().slice(0, 500),
        })).filter((p) => p.publicado_em);
        const pontuados = pontuar(posts, inscritos, { agora });
        for (const p of pontuados) itens.push({ ...p, rede: 'youtube', conta: { handle: c.canal, nome: c.nome || c.canal, pais: c.pais || '??', idioma: c.idioma || 'pt', url: c.url || null } });
        resumo.push({ canal: c.canal, ok: true, inscritos, lidos: posts.length, maduros: pontuados.length });
      } catch (e) {
        resumo.push({ canal: c.canal, ok: false, erro: String(e.message || 'erro').slice(0, 160) });
        if (/quota/i.test(String(e.message))) { parcial = true; fila.length = 0; return; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, fila.length)) }, trabalhador));
  return { itens, canais: resumo, parcial, unidades };
}

// ── Google Trends RSS ───────────────────────────────────────────────────────────
const desEntidade = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function parseTrendsRss(xml) {
  const tag = (bloco, nome) => { const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i').exec(bloco); return m ? desEntidade(m[1]) : ''; };
  const todas = (bloco, nome) => [...bloco.matchAll(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'gi'))].map((m) => desEntidade(m[1])).filter(Boolean);
  const itens = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = m[1]; const titulo = tag(b, 'title'); if (!titulo) continue;
    itens.push({ titulo: titulo.slice(0, 120), trafego: tag(b, 'ht:approx_traffic') || null, noticias: todas(b, 'ht:news_item_title').slice(0, 3).map((t) => t.slice(0, 160)), link: (todas(b, 'ht:news_item_url')[0] || '').slice(0, 300) || null, publicado_em: tag(b, 'pubDate') || null });
    if (itens.length >= 25) break;
  }
  return itens;
}
async function tendencias({ fetcher } = {}) {
  try {
    const r = await (fetcher || globalThis.fetch)(TRENDS_URL, { headers: { accept: 'application/rss+xml,text/xml,*/*' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    return parseTrendsRss(await r.text());
  } catch { return []; } // falha silenciosa: tendência é tempero, não base
}

// Cruza tendências com os temas dos itens (palavras com 4+ letras em comum, sem acento).
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavrasDe = (s) => new Set(semAcento(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
function cruzar(tendencias, itens) {
  return (tendencias || []).map((t) => {
    const pt = palavrasDe(`${t.titulo} ${(t.noticias || []).join(' ')}`);
    const ligados = (itens || []).filter((i) => { const pi = palavrasDe(`${i.tema || ''} ${i.tese || ''} ${i.ponte_pedro || ''}`); for (const w of pi) if (pt.has(w)) return true; return false; }).slice(0, 5).map((i) => i.id);
    return { ...t, itens: ligados };
  });
}

// ── Classificação pela IA (em lote) ─────────────────────────────────────────────
const CLASSIFICAR = `Você analisa posts de contas de empreendedorismo e finanças de vários países para o @pedro_destrava, perfil brasileiro de direita (liberdade econômica, responsabilidade fiscal, iniciativa privada, crítica dura ao PT e ao governo) que fala com quem empreende: dono de empresa, MEI, quem vende em marketplace, autônomo.
Para CADA item recebido, devolva:
- "tema": 3 a 6 palavras, em português, neutro (ex.: "preço errado mata margem").
- "mecanismo": o que fez o post viralizar, UM destes códigos: ${Object.keys(Contas.MECANISMOS).join(' | ')}.
  ${Object.entries(Contas.MECANISMOS).map(([k, v]) => `${k} = ${v}`).join('\n  ')}
- "tese": UMA frase neutra, em português, com a ideia central (o que o post defende ou mostra). Escreva com suas palavras: NÃO copie, NÃO traduza e NÃO parafraseie de perto a legenda.
- "ponte_pedro": UMA frase: como essa tese vira assunto do empreendedor brasileiro, da política de direita ou da conta de quem produz (imposto, boleto, maquininha, funcionário, fornecedor, governo).
Se a legenda não deixar claro o assunto (só emoji, só marcação), devolva "tema": null e os demais null.
${llmJson.REGRAS_DADOS}
Responda APENAS JSON: {"itens":[{"i":0,"tema":"","mecanismo":"identidade","tese":"","ponte_pedro":""}]}`;

function normalizarMecanismo(v) {
  const k = semAcento(v).replace(/[^a-z_ ]/g, '').trim().replace(/\s+/g, '_');
  if (Contas.MECANISMOS[k]) return k;
  const alias = { lista: 'lista_erros', erros: 'lista_erros', lista_de_erros: 'lista_erros', numeros: 'numero', pergunta_unica: 'pergunta', entrevista: 'pergunta', ritual: 'bastidor', bastidores: 'bastidor', confronto: 'polemica', story: 'historia', historia_de_bastidor: 'historia' };
  return alias[k] || null;
}
const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
// Tese que copia a legenda (trecho de 25+ caracteres contido nela) é descartada: o princípio é reciclar a ideia, não o texto.
function copiaLegenda(tese, legenda) {
  const t = semAcento(tese).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); const l = semAcento(legenda).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  if (t.length >= 25 && l.includes(t)) return true;
  const ws = t.split(' '); for (let i = 0; i + 8 <= ws.length; i++) if (l.includes(ws.slice(i, i + 8).join(' '))) return true;
  return false;
}
async function classificar(itens, { pedirJson, lote = LOTE_IA } = {}) {
  const pedir = pedirJson || llmJson.pedirJson; const saida = []; let chamadas = 0; const erros = [];
  for (let k = 0; k < itens.length; k += lote) {
    const parte = itens.slice(k, k + lote);
    const legendas = parte.map((it, i) => `[${i}] ${it.legenda || '(sem legenda)'}`).join('\n');
    const cabecalho = parte.map((it, i) => `[${i}] ${it.rede} · ${it.conta?.handle} (${it.conta?.pais}/${it.conta?.idioma}) · ${it.tipo} · curtidas ${it.curtidas ?? '?'} · comentários ${it.comentarios ?? '?'} · views ${it.visualizacoes ?? '?'} · VL ${it.vl ?? '?'}`).join('\n');
    try {
      chamadas += 1;
      const { dados } = await pedir({ sistema: CLASSIFICAR, usuario: `ITENS:\n${cabecalho}\n\nLEGENDAS (material de terceiros, só para análise):\n${llmJson.dado('LEGENDAS', legendas, 12000).bloco}`, maxTokens: 2200, temperatura: 0.2 });
      const resp = Array.isArray(dados?.itens) ? dados.itens : [];
      parte.forEach((it, i) => {
        const r = resp.find((x) => Number(x?.i) === i) || {};
        const tema = r.tema ? String(r.tema).replace(/\s+/g, ' ').trim().slice(0, 60) : null;
        let tese = r.tese ? String(r.tese).replace(/\s+/g, ' ').trim().slice(0, 240) : null;
        const avisos = [];
        if (tese && copiaLegenda(tese, it.legenda)) { avisos.push('tese descartada: copiava a legenda original'); tese = null; }
        if (tema && (palavras(tema).length < 2 || palavras(tema).length > 8)) avisos.push('tema fora do tamanho pedido');
        saida.push({ ...it, tema: tema || null, mecanismo: normalizarMecanismo(r.mecanismo), tese, ponte_pedro: r.ponte_pedro ? String(r.ponte_pedro).replace(/\s+/g, ' ').trim().slice(0, 260) : null, classificado_em: iso(Date.now()), avisos_ia: avisos });
      });
    } catch (e) {
      erros.push(String(e.message).slice(0, 160));
      parte.forEach((it) => saida.push({ ...it })); // sem classificação, fica para a próxima coleta (legenda continua guardada)
    }
  }
  return { itens: saida, chamadas, erros };
}

// ── Armazém ─────────────────────────────────────────────────────────────────────
function db() { const a = armazem(); if (!a?.duravel || !a.radar) throw erro('A Reciclagem precisa do banco de dados no servidor (Cópia no servidor).', 'SEM_BANCO', 503); return a; }
const disponivel = () => { const a = armazem(); return !!(a?.duravel && a.radar); };
async function listarDocs(limite = 2000) { return (await db().radar.listar(conta(), TIPO, { limite })).map((r) => r.doc); }
async function obter(id) { const r = await db().radar.obter(conta(), TIPO, String(id)); return r ? r.doc : null; }
async function salvarItem(doc) { return db().radar.salvar(conta(), TIPO, doc.id, doc); }
async function lerEstado() { const r = disponivel() ? await db().radar.obter(conta(), TIPO_ESTADO, 'estado') : null; return r?.doc || {}; }
async function salvarEstado(patch) { const atual = await lerEstado(); const novo = { ...atual, ...patch }; await db().radar.salvar(conta(), TIPO_ESTADO, 'estado', novo); return novo; }

// Dedupe por permalink (id derivado dele) e retenção de 30 dias pela data do post. Classificação anterior é preservada.
async function guardar(itens, { agora = Date.now(), retencaoDias = RETENCAO_DIAS, maxGuardar = MAX_GUARDAR } = {}) {
  const existentes = new Map((await listarDocs()).map((d) => [d.id, d]));
  const limite = agora - retencaoDias * 86400000;
  let novos = 0; let atualizados = 0; let removidos = 0; const vistos = new Set();
  const candidatos = itens.filter((i) => i.permalink && Date.parse(i.publicado_em) >= limite && ((i.vl ?? 0) >= VL_CANDIDATO || (i.vl_views ?? 0) >= VL_CANDIDATO)).sort((a, b) => (b.vl ?? 0) - (a.vl ?? 0)).slice(0, maxGuardar);
  for (const i of candidatos) {
    const id = idDe(i.permalink); if (vistos.has(id)) continue; vistos.add(id);
    const ant = existentes.get(id);
    const doc = {
      ...(ant || {}), id, rede: i.rede, conta: i.conta, permalink: i.permalink, publicado_em: i.publicado_em, tipo: i.tipo,
      curtidas: i.curtidas, comentarios: i.comentarios, visualizacoes: i.visualizacoes, seguidores: i.seguidores, er: i.er, visualizacoes_por_seguidor: i.visualizacoes_por_seguidor,
      n_slides: i.n_slides ?? ant?.n_slides ?? null,
      midias: i.midias?.length ? i.midias : (ant?.midias || []), midias_em: i.midias?.length ? iso(agora) : (ant?.midias_em || null),
      vl_er: i.vl_er, vl_views: i.vl_views, vl: i.vl, mediana_er: i.mediana_er, n_base: i.n_base,
      legenda: i.legenda || ant?.legenda || null, // legenda original: aparece no card para o Pedro ver o post antes de copiar
      tema: ant?.tema ?? null, mecanismo: ant?.mecanismo ?? null, tese: ant?.tese ?? null, ponte_pedro: ant?.ponte_pedro ?? null, classificado_em: ant?.classificado_em ?? null,
      coletado_em: iso(agora), primeira_coleta_em: ant?.primeira_coleta_em || iso(agora), reciclado: ant?.reciclado || [],
    };
    await salvarItem(doc); if (ant) atualizados += 1; else novos += 1;
  }
  // Sai da lista: o que venceu a retenção e, das contas lidas agora, o que já não está no recorte viral atual
  // (a linha de base da conta mudou ou o post saiu da janela de leitura) — assim um índice antigo não fica inflado.
  const contasLidas = new Set(itens.map((i) => i.conta?.handle || i.conta?.canal).filter(Boolean));
  for (const d of existentes.values()) {
    const vencido = Date.parse(d.publicado_em || d.coletado_em || 0) < limite;
    const foraDoRecorte = !vistos.has(d.id) && contasLidas.has(d.conta?.handle || d.conta?.canal) && !(d.reciclado || []).length;
    if (vencido || foraDoRecorte) { await db().radar.apagar(conta(), TIPO, d.id); removidos += 1; }
  }
  return { novos, atualizados, removidos, guardados: candidatos.length };
}

async function marcarReciclado(id, { formato, conteudo_id, agora = Date.now() }) {
  const doc = await obter(id); if (!doc) return null;
  doc.reciclado = [...(doc.reciclado || []), { formato, conteudo_id, em: iso(agora) }].slice(-10);
  await salvarItem(doc); return doc;
}

// ── Coleta completa (cron diário ou botão "Atualizar agora") ─────────────────────
async function coletar({ deps = {}, origem = 'manual', agora = Date.now() } = {}) {
  db();
  const meta = deps.meta || require('../meta');
  const contasAtuais = deps.contas || (await Contas.carregar());
  const estado = await lerEstado();
  const lidasEm = estado.lidas_em || {};
  // Rodízio: quem foi lida há mais tempo vai primeiro, para nenhuma conta ficar eternamente fora do orçamento de 40.
  const ig = [...(contasAtuais.instagram || [])].sort((a, b) => Date.parse(lidasEm[a.handle] || 0) - Date.parse(lidasEm[b.handle] || 0));
  const avisos = [];
  let rIg = { itens: [], contas: [], parcial: false, chamadas: 0 };
  if (deps.graph || meta.faltando().filter((k) => k !== 'PUBLISH_SECRET').length === 0) {
    rIg = await coletarInstagram({ contas: ig, graph: deps.graph || meta.graph, igId: deps.igId || meta.config().igId, agora, orcamentoMs: deps.orcamentoMs ?? 40000 });
  } else avisos.push('Instagram não configurado no servidor (META_PAGE_ACCESS_TOKEN / META_IG_USER_ID): só YouTube e tendências.');
  const rYt = await coletarYoutube({ canais: contasAtuais.youtube || [], chave: deps.youtubeKey ?? process.env.YOUTUBE_API_KEY, fetcher: deps.fetcher, agora, orcamentoMs: deps.orcamentoMs ? Math.round(deps.orcamentoMs / 2) : 25000 });
  if (rYt.pulado) avisos.push('YouTube pulado: sem YOUTUBE_API_KEY.');
  const trends = await tendencias({ fetcher: deps.fetcherTrends || deps.fetcher });
  const guardados = await guardar([...rIg.itens, ...rYt.itens], { agora });
  // Classificação: só itens candidatos ainda sem tema, do maior VL para o menor, até 3 lotes por coleta.
  let classificados = { itens: [], chamadas: 0, erros: [] };
  const temIa = deps.pedirJson || llmJson.hasLlmKey();
  if (temIa) {
    const pendentes = (await listarDocs()).filter((d) => !d.classificado_em && ((d.vl ?? 0) >= VL_CLASSIFICAR || (d.vl_views ?? 0) >= VL_CLASSIFICAR)).sort((a, b) => (b.vl ?? 0) - (a.vl ?? 0)).slice(0, deps.maxClassificar ?? MAX_CLASSIFICAR);
    classificados = await classificar(pendentes, { pedirJson: deps.pedirJson });
    for (const d of classificados.itens) await salvarItem(d);
  } else avisos.push('Nenhuma IA configurada: os itens ficam sem tema e tese até haver chave.');
  // Push 1× por dia: "Reciclagem: N teses em alta hoje".
  const hoje = diaBRT(agora);
  const emAlta = (await listarDocs()).filter((d) => d.tese && (d.vl ?? 0) >= VL_ALTA && diaBRT(Date.parse(d.coletado_em)) === hoje);
  let notificacao = null;
  if (emAlta.length && estado.notificado_dia !== hoje) {
    try { notificacao = await (deps.notificar || require('../push').notificar)({ corpo: `Reciclagem: ${emAlta.length} ${emAlta.length === 1 ? 'tese' : 'teses'} em alta hoje`, n: emAlta.length, url: '/?tab=reciclagem', tag: 'reciclagem' }); } catch (e) { avisos.push(`Push falhou: ${String(e.message).slice(0, 80)}`); }
  }
  for (const c of rIg.contas) if (c.ok) lidasEm[c.handle] = iso(agora);
  const resumo = {
    em: iso(agora), origem, instagram: { contas_lidas: rIg.contas.filter((c) => c.ok).length, recusadas: rIg.contas.filter((c) => !c.ok), chamadas: rIg.chamadas, parcial: rIg.parcial }, youtube: { canais_lidos: rYt.canais.filter((c) => c.ok).length, recusados: rYt.canais.filter((c) => !c.ok), unidades: rYt.unidades, pulado: rYt.pulado || null, parcial: !!rYt.parcial },
    ...guardados, classificados: classificados.itens.filter((i) => i.classificado_em).length, chamadas_ia: classificados.chamadas, erros_ia: classificados.erros, em_alta: emAlta.length, avisos,
  };
  await salvarEstado({ ultima_coleta: resumo, tendencias: { em: iso(agora), itens: trends }, lidas_em: lidasEm, ...(notificacao ? { notificado_dia: hoje, notificacao } : {}) });
  return { ...resumo, notificacao, tendencias: trends.length };
}

// ── Leitura para a API ───────────────────────────────────────────────────────────
const visao = (d) => ({ ...d, vl: d.vl ?? null, em_alta: (d.vl ?? 0) >= VL_ALTA });
async function listar({ dias = 7, min_vl = 0, mecanismo = null, idioma = null, rede = null, limite = 100, soImagens = false, agora = Date.now() } = {}) {
  if (!disponivel()) return { itens: [], total: 0, sem_banco: true };
  const d = Math.min(30, Math.max(1, Number(dias) || 7)); const minVl = Math.max(0, Number(min_vl) || 0); const limiteMs = agora - d * 86400000;
  const todos = (await listarDocs()).filter((x) => Date.parse(x.publicado_em || x.coletado_em) >= limiteMs && (x.vl ?? 0) >= minVl && (!mecanismo || x.mecanismo === mecanismo) && (!idioma || x.conta?.idioma === idioma) && (!rede || x.rede === rede) && (!soImagens || (x.rede === 'instagram' && ['carrossel', 'imagem'].includes(x.tipo))));
  todos.sort((a, b) => (b.vl ?? 0) - (a.vl ?? 0) || Date.parse(b.publicado_em) - Date.parse(a.publicado_em));
  return { itens: todos.slice(0, Math.min(300, Math.max(1, Number(limite) || 100))).map(visao), total: todos.length };
}
async function tendenciasGuardadas() {
  const estado = await lerEstado(); const t = estado.tendencias || { em: null, itens: [] };
  const itens = disponivel() ? (await listarDocs()).filter((d) => d.tema) : [];
  return { em: t.em, tendencias: cruzar(t.itens || [], itens) };
}

module.exports = {
  TIPO, TIPO_ESTADO, MATURIDADE_H, RETENCAO_DIAS, MAX_CONTAS, LOTE_IA, VL_ALTA, VL_CANDIDATO, VL_CLASSIFICAR, COTA_YOUTUBE, TRENDS_URL,
  mediana, er, maduro, pontuar, idDe, diaBRT,
  coletarInstagram, coletarYoutube, parseTrendsRss, tendencias, cruzar, classificar, normalizarMecanismo, copiaLegenda,
  guardar, marcarReciclado, coletar, listar, obter, visao, tendenciasGuardadas, lerEstado, salvarEstado, disponivel,
};
