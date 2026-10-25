// Publicação no Instagram como MÁQUINA DE ESTADOS com chamadas curtas (a função
// da Vercel vive no máximo 60 s). Cada estado é gravado no servidor; se o app
// fechar no meio, o item continua e é retomado ao reabrir (ou pelo cron diário).
//
//   iniciada ─▶ aguardando_processamento ─▶ publicando_final ─▶ publicada
//        └──────────────┴───────────────────────┴──────────────▶ erro
//
// Regras que impedem post duplicado ou post errado:
//  - só publica a versão APROVADA (hash conferido) e sem nenhum bloqueio de revisão,
//    rodando de novo, NO SERVIDOR, as mesmas regras da tela;
//  - a troca de estado é condicional ("só se ainda estiver em X"), então dois toques
//    seguidos ou um reenvio depois de queda de conexão não criam dois posts;
//  - o id do container e o id do post são gravados logo que existem; se a resposta
//    do media_publish se perder, o estado "publicando_final" é reconciliado procurando
//    o post nas mídias recentes da conta antes de tentar de novo;
//  - a conta é conferida na hora (id e @ iguais aos fixos do código).
const crypto = require('crypto');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');
const { ACCOUNT } = require('./account');
const meta = require('./meta');
const { armazem } = require('./armazem');
const arte = require('./arte');

const REDE = 'instagram';
const LIMITE_CARROSSEL = 20;          // doc oficial: até 20 itens
const LIMITE_LEGENDA = 2200;
const LIMITE_HASHTAGS = 30;
const LIMITE_MENCOES = 20;
const RECONCILIAR_APOS_MS = 45000;
const CRIACAO_TRAVADA_MS = 90000;

class ErroPub extends Error {
  constructor(code, msg, status = 400, extra = {}) { super(msg); this.code = code; this.status = status; Object.assign(this, extra); }
}

const hashCurto = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const conta = () => ACCOUNT.ig_id;

async function config() {
  const a = armazem();
  const c = a ? await a.config.obter(conta()) : {};
  return {
    ...c,
    publish_paused: !!c.publish_paused,
    daily_publish_cap: Number.isFinite(Number(c.daily_publish_cap)) ? Math.min(50, Math.max(1, Number(c.daily_publish_cap))) : 10,
    permitir_encerramento_provisorio: !!c.permitir_encerramento_provisorio,
    publishers: { instagram: true, facebook: false, ...(c.publishers || {}) },
  };
}

// ── Montagem da legenda (mesma regra do arquivo exportado) ──────────────────
function montarLegenda(v) {
  const partes = [String(v.legenda || '').trim(), String(v.cta || '').trim(), (v.hashtags || []).join(' ').trim()].filter(Boolean);
  // O CTA às vezes já está dentro da legenda: não repete.
  const unicas = partes.filter((p, i) => !partes.slice(0, i).some((q) => q.includes(p)));
  return unicas.join('\n\n').replace(/\*\*/g, '');
}
function conferirLegenda(texto) {
  if (texto.length > LIMITE_LEGENDA) throw new ErroPub('LEGENDA_LONGA', `A legenda tem ${texto.length} caracteres e o Instagram aceita até ${LIMITE_LEGENDA}. Encurte antes de publicar.`);
  const tags = (texto.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  if (tags > LIMITE_HASHTAGS) throw new ErroPub('HASHTAGS_DEMAIS', `A legenda tem ${tags} hashtags e o Instagram aceita até ${LIMITE_HASHTAGS}.`);
  const mencoes = (texto.match(/@[\w.]+/g) || []).length;
  if (mencoes > LIMITE_MENCOES) throw new ErroPub('MENCOES_DEMAIS', `A legenda tem ${mencoes} menções e o Instagram aceita até ${LIMITE_MENCOES}.`);
  M.HANDLES_ERRADOS.forEach((h) => { if (new RegExp(`@${h}(?![a-z0-9_])`, 'i').test(texto)) throw new ErroPub('HANDLE_ERRADO', `A legenda tem @${h}; o correto é ${ACCOUNT.handle}.`); });
}

// ── Elegibilidade: tudo que precisa ser verdade ANTES de falar com a Meta ────
async function carregarAprovado(id, hashInformado) {
  const a = armazem();
  if (!a || !a.duravel) throw new ErroPub('SEM_ARMAZEM', 'Publicar exige a cópia no servidor (banco de dados) configurada. Hoje o trabalho está só no navegador.', 503);
  const reg = await a.conteudos.obter(conta(), id);
  if (!reg) throw new ErroPub('NAO_NO_SERVIDOR', 'Este conteúdo ainda não está no servidor. Sincronize em Ajustes e tente de novo.', 409);
  const c = reg.doc;
  const v = M.versaoAtiva(c);
  if (!v) throw new ErroPub('SEM_VERSAO', 'O conteúdo não tem texto aprovado.', 409);
  if (c.legado) throw new ErroPub('LEGADO', 'Conteúdo antigo, gerado antes da base de evidências: refaça pela Mesa.', 409);
  if (!c.conta || String(c.conta.ig_id) !== ACCOUNT.ig_id) throw new ErroPub('CONTA_ERRADA', `Este conteúdo não pertence a ${ACCOUNT.handle}.`, 409);
  if (!c.revisao?.aprovada_versao || c.revisao.aprovada_versao !== v.id || c.revisao.hash_aprovado !== v.hash) {
    throw new ErroPub('NAO_APROVADO', 'A versão atual não é a aprovada. Aprove de novo antes de publicar.', 409);
  }
  if (hashInformado && hashInformado !== c.revisao.hash_aprovado) {
    throw new ErroPub('VERSAO_DIFERENTE', 'A cópia no servidor é diferente da que você aprovou. Sincronize e tente de novo.', 409);
  }
  const bl = G.avaliar(c, { conta: M.ACCOUNT_PIN }).bloqueios;
  if (bl.length) throw new ErroPub('BLOQUEIOS', `Ainda há ${bl.length} bloqueio(s) de revisão: ${bl[0].titulo}.`, 409, { bloqueios: bl.map((b) => ({ id: b.id, titulo: b.titulo })) });
  if (!v.slides.length) throw new ErroPub('SEM_SLIDES', 'Não há slides para publicar.', 409);
  return { c, v, rev: reg.rev };
}

async function conferirMidias(c, v, cfg) {
  const a = armazem();
  const avisos = [];
  if (c.formato === 'reels') {
    if (c.motion?.sandbox) throw new ErroPub('VIDEO_TESTE', 'Este vídeo é uma prévia de teste. Gere a versão final para publicar.',409);
    if(c.motion?.estado !== 'pronto' || c.motion.hash !== v.hash || !/^https:\/\//.test(c.motion.url || '')) throw new ErroPub('VIDEO_PENDENTE','O vídeo desta versão ainda não está pronto.',409);
    return {slides:[],avisos};
  }
  let slides = v.slides;
  if (slides.length > LIMITE_CARROSSEL) {
    slides = slides.slice(0, LIMITE_CARROSSEL);
    avisos.push(`O carrossel tem ${v.slides.length} slides; o Instagram aceita ${LIMITE_CARROSSEL}. Foram publicados os primeiros ${LIMITE_CARROSSEL}.`);
  }
  for (const s of slides) {
    if (s.imagem_id && !(await a.arquivos.obter(conta(), `img:${s.imagem_id}`))) {
      throw new ErroPub('FOTO_AUSENTE', 'A foto de um slide não está no servidor. Envie a foto de novo (com a cópia no servidor ligada).', 409);
    }
  }
  const temEnc = slides.some((s) => s.layout === 'encerramento' && !['foto_editorial','impacto','revista'].includes(s.estilo));
  if (temEnc && !(await a.arquivos.obter(conta(), 'upload:encerramento')) && !cfg.permitir_encerramento_provisorio) {
    throw new ErroPub('ENCERRAMENTO_PROVISORIO', 'O encerramento aprovado ainda não foi enviado (Ajustes → Encerramento). Para publicar com o encerramento provisório de texto, permita isso em Ajustes.', 409);
  }
  return { slides, avisos };
}

// ── Conta e saúde ───────────────────────────────────────────────────────────
async function conferirConta() {
  const c = meta.config();
  if (String(c.igId) !== ACCOUNT.meta_ig_id) {
    throw new ErroPub('CONTA_ERRADA', `META_IG_USER_ID não corresponde ao ID Graph API de ${ACCOUNT.handle}. Nada foi publicado.`, 409);
  }
  const d = await meta.graph('GET', c.igId, { fields: 'id,username' });
  if (String(d.id) !== ACCOUNT.meta_ig_id || String(d.username || '').toLowerCase() !== ACCOUNT.username) {
    throw new ErroPub('CONTA_ERRADA', `O token da Meta aponta para @${d.username || '?'} (id ${d.id}), não para ${ACCOUNT.handle}. Nada foi publicado.`, 409);
  }
  return { id: d.id, username: d.username };
}

async function cotaMeta() {
  const d = await meta.graph('GET', `${meta.config().igId}/content_publishing_limit`, { fields: 'quota_usage,config' });
  const linha = (d.data || [])[0] || {};
  return { usado: linha.quota_usage ?? null, total: linha.config?.quota_total ?? null, janela_s: linha.config?.quota_duration ?? null };
}

async function saude() {
  const falta = meta.faltando();
  const out = { configurado: falta.length === 0, faltando: falta, graph_version: meta.VERSAO(), conta: null, token: null, cota: null, local: null, reconectar: false };
  const a = armazem();
  const cfg = await config().catch(() => ({}));
  out.config = { publish_paused: cfg.publish_paused, daily_publish_cap: cfg.daily_publish_cap };
  if (a?.duravel) {
    const pubs = await a.publicacoes.listar(conta());
    const desde = Date.now() - 24 * 3600e3;
    out.local = { publicadas_24h: pubs.filter((p) => p.estado === 'publicada' && Date.parse(p.atualizada_em) >= desde).length, cap_diario: cfg.daily_publish_cap, em_andamento: pubs.filter((p) => ['iniciada', 'aguardando_processamento', 'publicando_final'].includes(p.estado)).length };
  } else out.local = { aviso: 'Sem banco de dados no servidor: não é possível publicar.' };
  if (!out.configurado) return out;
  try { out.conta = { ok: true, ...(await conferirConta()) }; }
  catch (e) {
    out.conta = { ok: false, erro: e.message };
    if (e.meta?.tipo === 'token') out.reconectar = true;
  }
  const c = meta.config();
  if (c.appId && c.appSecret) {
    try {
      const d = (await meta.graph('GET', 'debug_token', { input_token: c.token, access_token: `${c.appId}|${c.appSecret}` }, { semProof: true })).data || {};
      out.token = { valido: !!d.is_valid, expira_em: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : (d.data_access_expires_at ? null : 'nunca (token sem expiração informada)'), escopos: d.scopes || [], tipo: d.type || null };
      if (!d.is_valid) out.reconectar = true;
    } catch (e) { out.token = { valido: null, erro: e.message }; if (e.meta?.tipo === 'token') out.reconectar = true; }
  } else out.token = { valido: null, aviso: 'Defina META_APP_ID e META_APP_SECRET para ver a validade do token.' };
  try { out.cota = await cotaMeta(); } catch (e) { out.cota = { erro: e.message }; }
  return out;
}

// ── Iniciar ─────────────────────────────────────────────────────────────────
function urlMidia(base, id, hash, indice) {
  return `${base.replace(/\/$/, '')}/api/publico/midia/${meta.assinarMidia({ conteudo: id, hash, indice })}.jpg`;
}

async function criarContainers({ id, hash, slides, legenda, base, c }) {
  const ig = meta.config().igId;
  if(c?.formato === 'reels'){
    if(c.motion.engine==='local')c.motion.url=`${base.replace(/\/$/,'')}/api/publico/video/${meta.assinarMidia({conteudo:id,hash,indice:0})}.mp4`;
    const r=await meta.graph('POST',`${ig}/media`,{media_type:'REELS',video_url:c.motion.url,caption:legenda,share_to_feed:true});
    return {tipo:'REELS',creation_id:r.id,filhos:[]};
  }
  if (slides.length === 1) {
    const r = await meta.graph('POST', `${ig}/media`, { image_url: urlMidia(base, id, hash, 0), caption: legenda });
    return { tipo: 'IMAGE', creation_id: r.id, filhos: [] };
  }
  const filhos = await Promise.all(slides.map((_, i) => meta.graph('POST', `${ig}/media`, { image_url: urlMidia(base, id, hash, i), is_carousel_item: true })));
  const ids = filhos.map((f) => f.id);
  const pai = await meta.graph('POST', `${ig}/media`, { media_type: 'CAROUSEL', children: ids.join(','), caption: legenda });
  return { tipo: 'CAROUSEL', creation_id: pai.id, filhos: ids };
}

async function iniciar(id, { hash, base } = {}) {
  if (meta.faltando().length) throw new ErroPub('SEM_CONFIG', `Configuração da Meta incompleta no servidor: falta ${meta.faltando().join(', ')}.`, 503);
  const a = armazem();
  const cfg = await config();
  if (cfg.publish_paused) throw new ErroPub('PAUSADO', 'As publicações estão pausadas. O item fica aprovado e não é enviado.', 409);
  const { c, v } = await carregarAprovado(id, hash);
  const { slides, avisos } = await conferirMidias(c, v, cfg);
  const legenda = montarLegenda(v);
  conferirLegenda(legenda);
  if (!base) throw new ErroPub('SEM_URL_PUBLICA', 'Defina PUBLIC_BASE_URL no servidor: a Meta precisa baixar as imagens por um endereço público.', 503);

  const existente = await a.publicacoes.obter(conta(), id, REDE);
  if (existente && existente.estado !== 'erro') return resposta(existente);   // idempotente: já está em andamento ou publicada

  const pubs = await a.publicacoes.listar(conta());
  const desde = Date.now() - 24 * 3600e3;
  const feitas = pubs.filter((p) => ['publicada', 'publicando_final', 'aguardando_processamento', 'iniciada'].includes(p.estado) && Date.parse(p.iniciada_em) >= desde && p.content_id !== id).length;
  if (feitas >= cfg.daily_publish_cap) throw new ErroPub('LIMITE_DIARIO', `Limite diário atingido (${feitas}/${cfg.daily_publish_cap}). O item fica aprovado e sai no próximo ciclo.`, 429);

  await conferirConta();
  const cota = await cotaMeta().catch(() => null);
  if (cota && cota.total && cota.usado >= cota.total) throw new ErroPub('COTA_META', `A cota de publicações da Meta acabou (${cota.usado}/${cota.total} nas últimas 24 h).`, 429);

  const dados = { versao: v.id, hash_versao: v.hash, caption_hash: hashCurto(legenda), caption_tamanho: legenda.length, n_slides: slides.length, avisos, erro: null };
  let pub;
  if (existente && existente.estado === 'erro') pub = await a.publicacoes.reiniciar(conta(), id, REDE, dados);
  else { const r = await a.publicacoes.iniciar(conta(), id, REDE, dados); pub = r.criada ? r.pub : null; }
  if (!pub) return resposta(await a.publicacoes.obter(conta(), id, REDE));  // outra chamada simultânea venceu

  try {
    const cont = await criarContainers({ id, hash: v.hash, slides, legenda, base, c });
    const atual = await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'aguardando_processamento', { creation_id: cont.creation_id, tipo: cont.tipo, filhos: cont.filhos, containers_em: new Date().toISOString() });
    return resposta(atual || await a.publicacoes.obter(conta(), id, REDE));
  } catch (e) {
    const erro = e.meta || meta.interpretarErro(e);
    const atual = await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'erro', { erro });
    return resposta(atual || await a.publicacoes.obter(conta(), id, REDE));
  }
}

// ── Avançar (polling do app e cron) ─────────────────────────────────────────
const resposta = (p) => (p ? {
  content_id: p.content_id, rede: p.rede, estado: p.estado, iniciada_em: p.iniciada_em, atualizada_em: p.atualizada_em,
  versao: p.dados.versao, hash_versao: p.dados.hash_versao, tipo: p.dados.tipo || null, n_slides: p.dados.n_slides,
  creation_id: p.dados.creation_id || null, ig_media_id: p.dados.ig_media_id || null, permalink: p.dados.permalink || null,
  publicada_em: p.dados.publicada_em || null, avisos: p.dados.avisos || [], erro: p.dados.erro || null, aviso_temporario: p.dados.aviso_temporario || null,
  reconectar: p.dados.erro?.tipo === 'token' || p.dados.reconectar === true,
} : null);

async function buscarPermalink(p) {
  try {
    const d = await meta.graph('GET', p.dados.ig_media_id, { fields: 'permalink' });
    return d.permalink || null;
  } catch { return null; }
}

// O media_publish pode ter dado certo mesmo sem a resposta chegar: procura o post.
async function reconciliar(p) {
  const ig = meta.config().igId;
  const d = await meta.graph('GET', `${ig}/media`, { fields: 'id,caption,permalink,timestamp', limit: 12 });
  const desde = Date.parse(p.iniciada_em) - 60000;
  return (d.data || []).find((m) => Date.parse(m.timestamp) >= desde && hashCurto(String(m.caption || '').replace(/\*\*/g, '')) === p.dados.caption_hash) || null;
}

async function avancar(id) {
  const a = armazem();
  if (!a) throw new ErroPub('SEM_ARMAZEM', 'Sem banco de dados no servidor.', 503);
  let p = await a.publicacoes.obter(conta(), id, REDE);
  if (!p) throw new ErroPub('NAO_ENCONTRADA', 'Nenhuma publicação iniciada para este conteúdo.', 404);
  const idade = Date.now() - Date.parse(p.atualizada_em);

  if (p.estado === 'iniciada') {
    if (idade > CRIACAO_TRAVADA_MS) p = await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'erro', { erro: { tipo: 'interrompida', amigavel: 'A criação do post foi interrompida (conexão ou tempo). Toque em Tentar de novo.', mensagem_original: 'sem resposta da criação dos containers' } }) || p;
    return resposta(p);
  }

  if (p.estado === 'publicada') {
    if (!p.dados.permalink && p.dados.ig_media_id) {
      const link = await buscarPermalink(p);
      if (link) p = await a.publicacoes.atualizar(conta(), id, REDE, ['publicada'], 'publicada', { permalink: link }) || p;
    }
    return resposta(p);
  }
  if (p.estado === 'erro') return resposta(p);

  if (p.estado === 'publicando_final') {
    if (idade < RECONCILIAR_APOS_MS) return resposta(p);
    try {
      const achado = await reconciliar(p);
      if (achado) {
        p = await a.publicacoes.atualizar(conta(), id, REDE, ['publicando_final'], 'publicada', { ig_media_id: achado.id, permalink: achado.permalink || null, publicada_em: achado.timestamp, reconciliada: true });
        registrarTema(id);
        return resposta(p || await a.publicacoes.obter(conta(), id, REDE));
      }
      p = await a.publicacoes.atualizar(conta(), id, REDE, ['publicando_final'], 'aguardando_processamento', { aviso_temporario: 'A publicação não foi confirmada; vou tentar de novo.' }) || p;
    } catch (e) { return resposta({ ...p, dados: { ...p.dados, aviso_temporario: e.meta?.amigavel || e.message, reconectar: e.meta?.tipo === 'token' } }); }
  }

  // aguardando_processamento
  let st;
  try { st = await meta.graph('GET', p.dados.creation_id, { fields: 'status_code,status' }); }
  catch (e) {
    const m = e.meta || meta.interpretarErro(e);
    // Rede, limite e token NÃO viram erro do item: o container vale por 24 h.
    return resposta({ ...p, dados: { ...p.dados, aviso_temporario: m.amigavel, reconectar: m.tipo === 'token' } });
  }
  if (st.status_code === 'IN_PROGRESS') return resposta(p);
  if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') {
    const erro = { tipo: 'container', code: null, subcode: null, mensagem_original: String(st.status || st.status_code).slice(0, 300), amigavel: st.status_code === 'EXPIRED' ? 'O container expirou (24 h). Toque em Tentar de novo.' : 'A Meta não conseguiu processar a mídia. Toque em Tentar de novo.' };
    return resposta(await a.publicacoes.atualizar(conta(), id, REDE, ['aguardando_processamento'], 'erro', { erro }) || p);
  }
  if (st.status_code === 'PUBLISHED') {
    // já foi publicado por outro caminho: não chama media_publish de novo
    return resposta(await a.publicacoes.atualizar(conta(), id, REDE, ['aguardando_processamento', 'publicando_final'], 'publicada', { publicada_em: new Date().toISOString() }) || p);
  }
  if (st.status_code !== 'FINISHED') return resposta(p);

  // FINISHED: reivindica a publicação de forma atômica. Quem perder, só devolve o estado.
  const reivindicada = await a.publicacoes.atualizar(conta(), id, REDE, ['aguardando_processamento'], 'publicando_final', { final_iniciada_em: new Date().toISOString(), aviso_temporario: null });
  if (!reivindicada) return resposta(await a.publicacoes.obter(conta(), id, REDE));
  try {
    await conferirConta();
    const r = await meta.graph('POST', `${meta.config().igId}/media_publish`, { creation_id: p.dados.creation_id });
    const feita = await a.publicacoes.atualizar(conta(), id, REDE, ['publicando_final'], 'publicada', { ig_media_id: r.id, publicada_em: new Date().toISOString() });
    registrarTema(id);
    let atual = feita || await a.publicacoes.obter(conta(), id, REDE);
    const link = await buscarPermalink(atual);
    if (link) atual = await a.publicacoes.atualizar(conta(), id, REDE, ['publicada'], 'publicada', { permalink: link }) || atual;
    return resposta(atual);
  } catch (e) {
    const m = e.meta || meta.interpretarErro(e);
    if (m.tipo === 'rede') return resposta(await a.publicacoes.obter(conta(), id, REDE));   // fica em publicando_final; reconcilia depois
    if (['token', 'limite', 'nao_pronto'].includes(m.tipo)) {
      const volta = await a.publicacoes.atualizar(conta(), id, REDE, ['publicando_final'], 'aguardando_processamento', { aviso_temporario: m.amigavel });
      return resposta({ ...(volta || p), dados: { ...(volta || p).dados, reconectar: m.tipo === 'token' } });
    }
    return resposta(await a.publicacoes.atualizar(conta(), id, REDE, ['publicando_final'], 'erro', { erro: m }) || p);
  }
}

// Depois de publicar, o assunto entra no registro de temas usados (não bloqueia nem atrasa a publicação).
function registrarTema(id) {
  (async () => {
    const reg = await armazem()?.conteudos.obter(conta(), id);
    const c = reg?.doc;
    if (c) await require('./temas').registrar(c.briefing?.assunto || c.titulo, { origem: 'ferramenta', id });
  })().catch((e) => console.error('[temas]', e.message));
}

async function listarPublicacoes() {
  const a = armazem();
  if (!a?.duravel) return [];
  return (await a.publicacoes.listar(conta())).map(resposta);
}

// Cron: adianta o que ficou no meio (app fechado). No plano Hobby roda 1x por dia.
async function avancarPendentes(max = 5) {
  const a = armazem();
  if (!a?.duravel) return { avancadas: 0 };
  const pend = (await a.publicacoes.listar(conta())).filter((p) => ['iniciada', 'aguardando_processamento', 'publicando_final'].includes(p.estado)).slice(0, max);
  const out = [];
  for (const p of pend) { try { out.push((await avancar(p.content_id)).estado); } catch (e) { out.push(`erro: ${e.code || e.message}`); } }
  return { avancadas: out.length, estados: out };
}

// ── Mídia pública (JPEG renderizado sob demanda a partir da versão aprovada) ──
async function renderizarMidia(token) {
  const p = meta.verificarMidia(token);
  if (!p) throw new ErroPub('TOKEN_INVALIDO', 'Link inválido ou expirado.', 403);
  const a = armazem();
  if (!a) throw new ErroPub('SEM_ARMAZEM', 'Indisponível.', 503);
  const reg = await a.conteudos.obter(conta(), p.c);
  if (!reg) throw new ErroPub('NAO_ENCONTRADO', 'Conteúdo não encontrado.', 404);
  const c = reg.doc;
  const v = M.versaoAtiva(c);
  if (!v || c.revisao?.aprovada_versao !== v.id || c.revisao.hash_aprovado !== p.h || v.hash !== p.h) throw new ErroPub('VERSAO_DIFERENTE', 'A versão aprovada mudou; este link não vale mais.', 409);
  const s = v.slides[p.i];
  if (!s) throw new ErroPub('NAO_ENCONTRADO', 'Slide não encontrado.', 404);
  const imagem = s.imagem_id ? (await a.arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados : null;
  const enc = s.layout === 'encerramento' ? (await a.arquivos.obter(conta(), 'upload:encerramento'))?.dados : null;
  const r = await arte.renderizarSlide(s, { indice: p.i + 1, total: Math.min(v.slides.length, LIMITE_CARROSSEL), imagem: imagem ? Buffer.from(imagem) : null, arquivoEncerramento: enc ? Buffer.from(enc) : null });
  if (r.metrics.cabe === false) throw new ErroPub('TEXTO_CORTADO', 'O texto do slide não cabe na arte.', 409);
  const sharp = require('sharp');
  // Feed aceita só JPEG (documentação da Meta): converte sem alterar 1080×1350.
  return sharp(r.png).flatten({ background: '#FAF7F0' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
}

module.exports = { urlMidia, conferirMidias, conta, iniciar, avancar, saude, config, listarPublicacoes, avancarPendentes, renderizarMidia, montarLegenda, conferirLegenda, carregarAprovado, ErroPub, resposta, LIMITE_CARROSSEL, LIMITE_LEGENDA, REDE };
