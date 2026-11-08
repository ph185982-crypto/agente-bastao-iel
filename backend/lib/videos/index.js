// Vídeos gravados pelo Pedro (teleprompter ou galeria) que viram Reels editados.
//
// O fluxo, do celular ao "Para aprovar":
//   criar → (navegador manda o bruto para o Vercel Blob) → registrarEnvio: estado `na_fila`
//   → worker (GitHub Actions) pega com proximoJob: `editando` com lease de 30 min
//   → worker devolve registrarResultado: legenda pela IA, versão + motion prontos, `em_revisao`, push
//   → o Pedro aprova pelo fluxo normal (`POST /api/studio/:id/decidir`) e o publicador manda como REELS.
//
// Regras que este módulo garante:
//  - nada aqui publica; só deixa o conteúdo no estado que o publicador exige para REELS
//    (`c.motion` pronto com o hash da versão ativa, URL pública https do Blob);
//  - o token de leitura/escrita do Blob (BLOB_READ_WRITE_TOKEN) nunca sai do servidor: navegador e worker
//    recebem client tokens curtos, restritos a `videos/<id>/`;
//  - a legenda passa pelo anti-IA (`mentes/antiIA.vicios`) e não pode trazer número que exija fonte, citação
//    entre aspas nem "segundo Fulano": o vídeo não passa pela base de evidências, então os portões de
//    qualidade bloqueariam a aprovação. Se a IA insistir, o trecho sai e o Pedro vê o aviso;
//  - a gravação é condicional por revisão (CAS do armazém): dois workers não pegam o mesmo job.
const crypto = require('crypto');
const M = require('../../../static/contentModel');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const llmJson = require('../llmJson');
const AI = require('../mentes/antiIA');
const pushLib = require('../push');

const LEASE_MS = 30 * 60 * 1000;
const MAX_TENTATIVAS = 2;
const ESTILOS = ['hormozi', 'beast', 'caixa'];
const OPCOES_PADRAO = { broll: true, musica: false, punch_in: true, remover_pausas: true, remover_muletas: true };
const TIPOS_PERMITIDOS = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp', 'video/x-matroska', 'image/jpeg'];
const TAMANHO_MAXIMO = 600 * 1024 * 1024;
const REPO_WORKER = 'ph185982-crypto/agente-bastao-iel';
const MSG_SEM_BLOB = 'O armazenamento de vídeo ainda não foi ligado na Vercel (Storage → Blob)';

const conta = () => ACCOUNT.ig_id;
const agora = () => new Date().toISOString();
const falha = (message, status = 400, code = 'VIDEO') => Object.assign(new Error(message), { status, code });
const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN || '';
function exigirBlob() { if (!blobToken()) throw falha(MSG_SEM_BLOB, 503, 'SEM_BLOB'); }

// Prefixo que todo vídeo deste módulo recebe: a listagem acha os vídeos sem abrir documento por documento.
const PREFIXO = 'vd_';
const ehVideo = (id) => String(id || '').startsWith(PREFIXO);
const prefixoDe = (id) => `videos/${id}/`;
const pathnameValido = (id, pathname) => typeof pathname === 'string' && pathname.startsWith(prefixoDe(id)) && pathname.length > prefixoDe(id).length && !pathname.includes('..');
const urlPublica = (u) => /^https:\/\/[^\s]+$/.test(String(u || ''));

// ── Armazém ─────────────────────────────────────────────────────────────────
function arm() {
  const a = armazem();
  if (!a?.duravel) throw falha('Os vídeos precisam do armazenamento no servidor (banco de dados).', 503, 'SEM_ARMAZEM');
  return a;
}
async function ler(id) {
  const r = await arm().conteudos.obter(conta(), String(id || '').slice(0, 80));
  if (!r || !r.doc?.video) throw falha('Vídeo não encontrado.', 404, 'NAO_ENCONTRADO');
  return r;
}
async function gravar(c, rev) { c.updated_at = agora(); return arm().conteudos.salvar(conta(), c.id, c, rev); }
function log(c, msg) { c.video.log = [...(c.video.log || []).slice(-39), { em: agora(), msg: String(msg).slice(0, 300) }]; }

// Dependências injetáveis (testes): IA, push, apagar blobs, chamada ao GitHub.
const padrao = {
  ia: (args) => llmJson.comConsumo(() => llmJson.comPrazo(25000, () => llmJson.pedirJson(args))).then((r) => r.resultado),
  push: (msg) => pushLib.notificar(msg),
  del: (urls) => require('@vercel/blob').del(urls, { token: blobToken() }),
  fetch: (...a) => globalThis.fetch(...a),
};
const comDeps = (deps) => ({ ...padrao, ...(deps || {}) });

// ── Criar ───────────────────────────────────────────────────────────────────
function normalizarOpcoes(entrada) {
  const o = { ...OPCOES_PADRAO };
  for (const k of Object.keys(OPCOES_PADRAO)) if (entrada && typeof entrada[k] === 'boolean') o[k] = entrada[k];
  return o;
}
const normalizarEstilo = (e, atual = 'hormozi') => (ESTILOS.includes(e) ? e : atual);

async function criar({ titulo, estilo, opcoes, roteiro_id, roteiro_texto } = {}) {
  exigirBlob();
  const a = arm();
  const c = M.novoConteudo({ titulo: String(titulo || '').trim().slice(0, 140) || `Vídeo de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, formato: 'reels', origem: { tipo: 'video' } });
  c.id = `${PREFIXO}${crypto.randomBytes(8).toString('hex')}`;
  c.video = {
    estado: 'enviado',
    origem: null,
    estilo: normalizarEstilo(estilo),
    opcoes: normalizarOpcoes(opcoes),
    roteiro_id: roteiro_id ? String(roteiro_id).slice(0, 80) : null,
    roteiro_texto: String(roteiro_texto || '').slice(0, 6000),
    resultado: null, transcricao: null, legenda_ig: null,
    worker: { tentativas: 0, iniciado_em: null, concluido_em: null, run_url: null, erro: null },
    log: [],
  };
  c.studio = { estado: 'video', etapa: 'envio' };
  log(c, 'Vídeo criado; aguardando o arquivo.');
  await a.conteudos.salvar(conta(), c.id, c, 0);
  return c;
}

// ── Envio do bruto ──────────────────────────────────────────────────────────
// Chamado pelo navegador depois do upload (e pelo webhook do Blob, quando ele chega).
async function registrarEnvio(id, { url, pathname, tamanho, contentType, duracao_s, largura, altura } = {}, { deps } = {}) {
  const reg = await ler(id); const c = reg.doc;
  if (!urlPublica(url)) throw falha('Envie a URL pública (https) do arquivo no Blob.');
  if (!pathnameValido(c.id, pathname)) throw falha(`O arquivo precisa estar em ${prefixoDe(c.id)}.`);
  if (contentType && !TIPOS_PERMITIDOS.includes(String(contentType))) throw falha('Tipo de arquivo não aceito (mp4, mov, webm).');
  if (c.status === 'arquivado') throw falha('Este vídeo foi apagado.', 409, 'ARQUIVADO');
  if (c.video.origem?.url === url && c.video.estado !== 'enviado') return c;  // webhook e navegador registram o mesmo envio
  if (!['enviado', 'erro'].includes(c.video.estado)) throw falha('Este vídeo já está em edição. Use "Refazer" para mandar de novo.', 409, 'EM_ANDAMENTO');
  c.video.origem = { url: String(url), pathname: String(pathname), tamanho: Number(tamanho) || null, duracao_s: Number(duracao_s) || null, largura: Number(largura) || null, altura: Number(altura) || null, contentType: contentType ? String(contentType) : null, enviado_em: agora() };
  c.video.estado = 'na_fila'; c.video.worker = { ...c.video.worker, tentativas: 0, erro: null, iniciado_em: null, concluido_em: null };
  c.studio = { estado: 'video', etapa: 'fila' };
  log(c, `Arquivo recebido (${Math.round((Number(tamanho) || 0) / 1048576)} MB). Na fila de edição.`);
  await gravar(c, reg.rev);
  await dispararWorker(c.id, comDeps(deps));
  return c;
}

// Com GITHUB_DISPATCH_TOKEN, acorda o worker na hora; sem ele, o cron de 5 min pega o job. Falha aqui nunca derruba o envio.
async function dispararWorker(id, deps = padrao) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { disparado: false, motivo: 'sem GITHUB_DISPATCH_TOKEN' };
  try {
    const r = await deps.fetch(`https://api.github.com/repos/${REPO_WORKER}/dispatches`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'agente-bastao-iel' },
      body: JSON.stringify({ event_type: 'video', client_payload: { id } }),
    });
    if (r.status >= 300) { console.error('[videos] repository_dispatch recusado:', r.status); return { disparado: false, motivo: `GitHub respondeu ${r.status}` }; }
    return { disparado: true };
  } catch (e) { console.error('[videos] repository_dispatch falhou:', String(e.message).slice(0, 120)); return { disparado: false, motivo: e.message }; }
}

// ── Fila do worker ──────────────────────────────────────────────────────────
async function docsDeVideo() {
  const a = arm();
  const lista = (await a.conteudos.listar(conta())).filter((x) => ehVideo(x.id));
  const docs = [];
  for (const x of lista) { const r = await a.conteudos.obter(conta(), x.id); if (r?.doc?.video) docs.push(r); }
  return docs;
}
const leaseVencido = (c) => c.video.estado === 'editando' && (!c.video.worker?.lease_ate || Date.parse(c.video.worker.lease_ate) <= Date.now());

// Job mais antigo em `na_fila`. Lease vencido volta à fila (ou vira erro na 3ª vez); a reivindicação é condicional por
// revisão, então dois workers ao mesmo tempo nunca levam o mesmo vídeo.
async function proximoJob() {
  const docs = await docsDeVideo();
  for (const reg of docs.filter((r) => leaseVencido(r.doc))) {
    const c = reg.doc;
    if ((c.video.worker.tentativas || 0) >= MAX_TENTATIVAS) { c.video.estado = 'erro'; c.video.worker.erro = 'O editor não respondeu a tempo.'; c.status = 'rascunho'; c.studio = { estado: 'erro', erro: c.video.worker.erro }; log(c, 'Lease vencido pela última vez: erro.'); }
    else { c.video.estado = 'na_fila'; log(c, 'Lease vencido: voltou para a fila.'); }
    delete c.video.worker.lease_ate;
    await gravar(c, reg.rev).catch((e) => { if (e.code !== 'CONFLITO') throw e; });
  }
  const fila = (await docsDeVideo()).filter((r) => r.doc.video.estado === 'na_fila' && r.doc.status !== 'arquivado' && r.doc.video.origem?.url)
    .sort((p, q) => String(p.doc.video.origem.enviado_em || p.doc.created_at).localeCompare(String(q.doc.video.origem.enviado_em || q.doc.created_at)));
  for (const reg of fila) {
    const c = reg.doc;
    c.video.estado = 'editando';
    c.video.worker = { ...c.video.worker, tentativas: (c.video.worker.tentativas || 0) + 1, iniciado_em: agora(), lease_ate: new Date(Date.now() + LEASE_MS).toISOString(), erro: null };
    c.studio = { estado: 'video', etapa: 'edicao' };
    log(c, `Editor pegou o vídeo (tentativa ${c.video.worker.tentativas}).`);
    try { await gravar(c, reg.rev); } catch (e) { if (e.code === 'CONFLITO') continue; throw e; }
    return { id: c.id, origem: c.video.origem, estilo: c.video.estilo, opcoes: c.video.opcoes, roteiro_texto: c.video.roteiro_texto || '', tentativa: c.video.worker.tentativas, lease_ate: c.video.worker.lease_ate };
  }
  return null;
}

// ── Legenda pela IA ─────────────────────────────────────────────────────────
const PEDIDOS_ENVIO = /\b(manda|mande|envia|envie|compartilha|compartilhe|marca|marque)\b/i;
const SISTEMA_LEGENDA = `Você escreve a legenda de Instagram de um Reels do @pedro_destrava (Pedro Martins). O vídeo é o Pedro falando direto para a câmera; a transcrição vem abaixo como DADO.
QUEM É O PEDRO: direita assumida, defende liberdade econômica, crítica dura ao PT e ao governo, fala com o empreendedor brasileiro de igual para igual. Fatos com fonte; sem ataque pessoal a quem não é figura pública.
A LEGENDA:
- 2 a 4 frases curtas, na voz do Pedro, em primeira pessoa, direta, português falado. Complementa o vídeo; não o resume inteiro.
- A última frase pede para ENVIAR o vídeo para alguém específico (ex.: "Manda pra quem tem CNPJ e ainda acha que isso é normal.").
- NÃO use números, porcentagens, valores em dinheiro nem anos: a legenda não passa pela checagem de fontes. Se a ideia precisar de número, escreva em palavras vagas ("boa parte", "quase tudo").
- NÃO use aspas, NÃO escreva "segundo Fulano" nem cite nome de veículo. NÃO use emoji. NÃO escreva hashtags dentro da legenda.
- 3 hashtags separadas, sem #, só letras (ex.: empreendedorismo, economia, impostos).
${AI.REGRAS}
Responda APENAS JSON: {"legenda":"","hashtags":["","",""]}`;

const numerosSemFonte = (t) => M.extrairNumeros(t).filter(M.exigeOrigem);
const HASHTAGS_PADRAO = ['#empreendedorismo', '#economia', '#brasil'];
// Sempre 3 hashtags: as da IA (saneadas) e, se faltar, as padrão do perfil.
const sanearHashtags = (hs) => [...new Set([...(Array.isArray(hs) ? hs : []).map((h) => `#${String(h || '').replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2), ...HASHTAGS_PADRAO])].slice(0, 3);
function sanearTexto(t) {
  return String(t || '').replace(/\*\*/g, '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/@pedrodestrava(?![a-z0-9_])/gi, ACCOUNT.handle).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
// Tudo que faria os portões de qualidade bloquearem a aprovação ou que denuncia texto de IA.
function problemasDaLegenda(texto) {
  const p = [];
  if (!texto || texto.split(/(?<=[.!?])\s+/).filter(Boolean).length < 2) p.push('menos de 2 frases');
  if (texto.length > 900) p.push('legenda longa demais');
  AI.vicios(texto).forEach((v) => p.push(`vício de IA: ${v.nome} ("${v.trecho}")`));
  if (/[—–]/.test(texto) && !AI.vicios(texto).some((v) => v.id === 'travessao')) p.push('travessão');
  numerosSemFonte(texto).forEach((n) => p.push(`número sem fonte: ${n.raw}`));
  if (/[“"”][^“”"]{12,}[“"”]/.test(texto)) p.push('citação entre aspas');
  if (/\b(segundo|de acordo com|conforme)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(texto)) p.push('atribuição a alguém ("segundo X")');
  if (!PEDIDOS_ENVIO.test(texto.split(/(?<=[.!?])\s+/).slice(-2).join(' '))) p.push('não termina pedindo para enviar');
  return p;
}
// Último recurso: tira as frases problemáticas e garante o pedido de envio. O Pedro vê o aviso e pode editar.
function limparLegenda(texto) {
  const frases = String(texto || '').replace(/\s*[—–]\s*/g, '. ').split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean)
    .map((f) => f.charAt(0).toUpperCase() + f.slice(1))
    .filter((f) => !AI.vicios(f).length && !numerosSemFonte(f).length && !/[“"”]/.test(f) && !/\b(segundo|de acordo com|conforme)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(f));
  let t = frases.join(' ');
  if (AI.vicios(t).length) t = frases.filter((f) => !PEDIDOS_ENVIO.test(f)).slice(0, 1).join(' ');  // reversão que atravessa frases
  if (!PEDIDOS_ENVIO.test(t.split(/(?<=[.!?])\s+/).slice(-2).join(' '))) t = `${t} Manda esse vídeo pra quem precisa ouvir isso.`.trim();
  return t;
}
function legendaProvisoria(transcricao) {
  const frases = String(transcricao?.texto || '').split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter((f) => f.length >= 12 && !numerosSemFonte(f).length && !AI.vicios(f).length && !/[“"”]/.test(f)).slice(0, 2);
  return limparLegenda([...frases, 'Manda esse vídeo pra quem precisa ouvir isso.'].join(' '));
}

async function gerarLegenda({ transcricao, roteiro_texto, titulo }, { ia } = {}) {
  const pedir = ia || padrao.ia;
  const d = llmJson.dado('TRANSCRIÇÃO DO VÍDEO', transcricao?.texto || roteiro_texto || titulo || '', 8000);
  const usuario = `${roteiro_texto ? `ROTEIRO QUE O PEDRO LEU (ajuda a entender a ideia):\n${String(roteiro_texto).slice(0, 2500)}\n\n` : ''}${d.bloco}`;
  const avisos = []; let correcao = '';
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    let dados;
    try { ({ dados } = await pedir({ sistema: `${SISTEMA_LEGENDA}\n\n${llmJson.REGRAS_DADOS}${correcao}`, usuario, maxTokens: 500, temperatura: tentativa === 1 ? 0.7 : 0.5 })); }
    catch (e) { avisos.push(`IA indisponível (${String(e.message).slice(0, 80)}): legenda provisória tirada da transcrição.`); return { texto: legendaProvisoria(transcricao), hashtags: HASHTAGS_PADRAO, origem: 'transcricao', avisos }; }
    const texto = sanearTexto(dados?.legenda); const hashtags = sanearHashtags(dados?.hashtags);
    const problemas = problemasDaLegenda(texto);
    if (!problemas.length) return { texto, hashtags, origem: 'ia', avisos };
    if (tentativa === 1) { correcao = `\n\nSUA RESPOSTA ANTERIOR FOI REJEITADA por: ${problemas.join('; ')}. Reescreva do zero corrigindo isso.`; continue; }
    avisos.push(`A IA insistiu em ${problemas.join('; ')}. Os trechos saíram; confira a legenda.`);
    return { texto: limparLegenda(texto), hashtags, origem: 'ia_limpa', avisos };
  }
  return { texto: legendaProvisoria(transcricao), hashtags: HASHTAGS_PADRAO, origem: 'transcricao', avisos };
}

// ── Resultado do worker ─────────────────────────────────────────────────────
function validarResultado(id, r) {
  if (!r || typeof r !== 'object') throw falha('Envie o resultado da edição.');
  if (!urlPublica(r.url)) throw falha('O vídeo final precisa de uma URL pública (https).');
  if (r.pathname && !pathnameValido(id, r.pathname)) throw falha(`O vídeo final precisa estar em ${prefixoDe(id)}.`);
  if (r.poster_url && !urlPublica(r.poster_url)) throw falha('O poster precisa de uma URL pública (https).');
  return { url: String(r.url), pathname: r.pathname ? String(r.pathname) : null, poster_url: r.poster_url ? String(r.poster_url) : null, duracao_s: Number(r.duracao_s) || null, tamanho: Number(r.tamanho) || null, cortes: Number(r.cortes) || 0, palavras: Number(r.palavras) || 0, avisos: Array.isArray(r.avisos) ? r.avisos.map(String).slice(0, 10) : [], editado_em: agora() };
}
function validarTranscricao(t) {
  if (!t || typeof t !== 'object') return { texto: '', frases: [] };
  return { texto: String(t.texto || '').slice(0, 20000), frases: (Array.isArray(t.frases) ? t.frases : []).slice(0, 2000).map((f) => ({ t0: Number(f.t0) || 0, t1: Number(f.t1) || 0, texto: String(f.texto || '').slice(0, 300) })) };
}

async function registrarResultado(id, { resultado, transcricao, log: logWorker, run_url } = {}, { deps } = {}) {
  const d = comDeps(deps);
  const reg = await ler(id); const c = reg.doc;
  if (c.status === 'arquivado') throw falha('Este vídeo foi apagado.', 409, 'ARQUIVADO');
  if (c.video.estado === 'pronto') throw falha('Este vídeo já está pronto.', 409, 'JA_PRONTO');
  if (!['editando', 'na_fila'].includes(c.video.estado)) throw falha(`O vídeo não está em edição (estado ${c.video.estado}).`, 409, 'ESTADO');
  const res = validarResultado(c.id, resultado);
  c.video.resultado = res;
  c.video.transcricao = validarTranscricao(transcricao);
  (Array.isArray(logWorker) ? logWorker : []).slice(0, 20).forEach((m) => log(c, `editor: ${typeof m === 'string' ? m : m?.msg || ''}`));

  const legenda = await gerarLegenda({ transcricao: c.video.transcricao, roteiro_texto: c.video.roteiro_texto, titulo: c.titulo }, { ia: d.ia });
  c.video.legenda_ig = { texto: legenda.texto, hashtags: legenda.hashtags, origem: legenda.origem, avisos: legenda.avisos };
  legenda.avisos.forEach((a) => log(c, a));

  // O que o publicador exige para REELS: UMA versão ativa (1 slide `reel`) e `c.motion` pronto com o hash dela.
  const v = M.criarVersao(c, { slides: [{ id: 's1', layout: 'reel', funcao: 'reel', texto: legenda.texto, claim_ids: [] }], legenda: legenda.texto, cta: '', hashtags: legenda.hashtags, legenda_claim_ids: [] }, { quem: 'sistema', rotulo: 'Legenda do vídeo' });
  // A "arte" de um vídeo é o próprio vídeo no Blob. O registro de render existe só para o portão `arte_pendente`
  // (feito para carrosséis) não travar a aprovação; o poster é a imagem que o app mostra.
  c.arte = { ...(c.arte || { template: 'familia', versao_template: 1 }), renders: [{ slide_id: 's1', versao: v.id, texto_hash: M.hashRender(v.slides[0]), blob_key: null, poster_url: res.poster_url, indice: 1, total: 1, metrics: { cabe: true }, elementos: [] }] };
  c.motion = { engine: 'blob', estado: 'pronto', hash: v.hash, url: res.url, poster: res.poster_url, sandbox: false, duracao_s: res.duracao_s, formato: '1080x1920' };
  c.video.estado = 'pronto';
  c.video.worker = { ...c.video.worker, concluido_em: agora(), erro: null, run_url: run_url ? String(run_url).slice(0, 300) : c.video.worker.run_url || null };
  delete c.video.worker.lease_ate;
  c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: agora() };
  log(c, `Edição concluída: ${res.cortes} cortes, ${res.duracao_s ?? '?'} s.`);
  M.registrar(c, 'sistema', 'pronto', 'Vídeo editado e legenda prontos: confira e aprove ou peça para refazer.');
  await gravar(c, reg.rev);
  await d.push({ corpo: `Vídeo pronto: ${String(c.titulo || 'novo Reels').slice(0, 90)}. Toque para aprovar.`, url: '/?tab=videos', tag: `video-${c.id}` }).catch(() => {});
  return c;
}

async function registrarErro(id, { erro, log: logWorker, run_url } = {}) {
  const reg = await ler(id); const c = reg.doc;
  // Só o job em edição pode falhar: erro atrasado de um lease já vencido não derruba a tentativa seguinte.
  if (c.video.estado !== 'editando') throw falha(`O vídeo não está em edição (estado ${c.video.estado}).`, 409, 'ESTADO');
  (Array.isArray(logWorker) ? logWorker : []).slice(0, 20).forEach((m) => log(c, `editor: ${typeof m === 'string' ? m : m?.msg || ''}`));
  const msg = String(erro || 'Falha na edição.').slice(0, 300);
  c.video.worker = { ...c.video.worker, erro: msg, run_url: run_url ? String(run_url).slice(0, 300) : c.video.worker.run_url || null };
  delete c.video.worker.lease_ate;
  if ((c.video.worker.tentativas || 0) < MAX_TENTATIVAS) { c.video.estado = 'na_fila'; log(c, `Erro na edição (${msg}). Vai tentar de novo.`); }
  else { c.video.estado = 'erro'; c.status = 'rascunho'; c.studio = { estado: 'erro', erro: msg }; log(c, `Erro final na edição: ${msg}`); }
  await gravar(c, reg.rev);
  return c;
}

// ── Refazer e apagar ────────────────────────────────────────────────────────
async function refazer(id, { estilo, opcoes } = {}, { deps } = {}) {
  const reg = await ler(id); const c = reg.doc;
  if (c.status === 'arquivado') throw falha('Este vídeo foi apagado.', 409, 'ARQUIVADO');
  if (['publicado', 'aprovado', 'exportado'].includes(c.status)) throw falha('Este vídeo já foi aprovado. Grave outro para não alterar a publicação.', 409, 'APROVADO');
  if (!c.video.origem?.url) throw falha('O arquivo bruto ainda não chegou: envie o vídeo primeiro.', 409, 'SEM_ORIGEM');
  if (c.video.estado === 'editando' && !leaseVencido(c)) throw falha('O editor está trabalhando neste vídeo agora. Espere terminar.', 409, 'EM_ANDAMENTO');
  c.video.estilo = normalizarEstilo(estilo, c.video.estilo);
  if (opcoes) c.video.opcoes = normalizarOpcoes({ ...c.video.opcoes, ...opcoes });
  c.video.resultado = null; c.video.transcricao = null; c.video.legenda_ig = null;
  c.video.worker = { tentativas: 0, iniciado_em: null, concluido_em: null, run_url: null, erro: null };
  c.video.estado = 'na_fila';
  c.motion = null; c.revisao = { aprovada_versao: null, aprovada_em: null, hash_aprovado: null };
  c.status = 'rascunho'; c.studio = { estado: 'video', etapa: 'fila' };
  log(c, `Refazer com estilo ${c.video.estilo}.`);
  M.registrar(c, 'pedro', 'refazer', `Pediu outra edição (estilo ${c.video.estilo}).`);
  await gravar(c, reg.rev);
  await dispararWorker(c.id, comDeps(deps));
  return c;
}

const blobsDe = (c) => [c.video.origem?.url, c.video.resultado?.url, c.video.resultado?.poster_url].filter(urlPublica);
async function apagar(id, { deps } = {}) {
  const d = comDeps(deps);
  const reg = await ler(id); const c = reg.doc;
  if (c.status === 'publicado') throw falha('Vídeo já publicado: não é apagado por aqui.', 409, 'PUBLICADO');
  const urls = blobsDe(c);
  let apagados = 0;
  if (urls.length && blobToken()) { try { await d.del(urls); apagados = urls.length; log(c, `${urls.length} arquivo(s) apagado(s) do Blob.`); } catch (e) { log(c, `Não apagou os arquivos do Blob: ${String(e.message).slice(0, 120)}`); } }
  else if (urls.length) log(c, `Arquivos não apagados: ${MSG_SEM_BLOB}.`);
  c.status = 'arquivado'; c.studio = { ...(c.studio || {}), estado: 'descartado' };
  if (apagados) { c.video.blobs_apagados_em = agora(); c.motion = null; }
  M.registrar(c, 'pedro', 'descartado', 'Apagou o vídeo.');
  await gravar(c, reg.rev);
  return { id: c.id, arquivado: true, blobs_apagados: apagados };
}

// ── Client tokens do Blob ───────────────────────────────────────────────────
// Restrições do token: só `videos/<id>/`, só vídeo/jpeg, até 600 MB, 1 h.
function restricoesToken() { return { allowedContentTypes: TIPOS_PERMITIDOS, maximumSizeInBytes: TAMANHO_MAXIMO, addRandomSuffix: true, validUntil: Date.now() + 3600 * 1000 }; }
async function tokenDoWorker({ id, pathname, contentType } = {}) {
  exigirBlob();
  const { doc: c } = await ler(id);
  if (!pathnameValido(c.id, pathname)) throw falha(`O caminho precisa começar com ${prefixoDe(c.id)}.`);
  if (contentType && !TIPOS_PERMITIDOS.includes(String(contentType))) throw falha('Tipo de arquivo não aceito.');
  const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
  const clientToken = await generateClientTokenFromReadWriteToken({ token: blobToken(), pathname: String(pathname), ...restricoesToken() });
  return { clientToken, pathname: String(pathname), valido_ate: new Date(Date.now() + 3600 * 1000).toISOString() };
}
// Webhook do Blob: o tokenPayload diz a que vídeo e a que papel o arquivo pertence.
async function registrarUploadConcluido({ blob, tokenPayload } = {}, { deps } = {}) {
  let p = null; try { p = JSON.parse(tokenPayload || 'null'); } catch { /* payload inválido: ignora */ }
  if (!p?.id || !blob?.url) return { ignorado: true };
  if (!pathnameValido(p.id, blob.pathname)) return { ignorado: true, motivo: 'caminho fora de videos/<id>/' };
  if (p.papel === 'origem') { await registrarEnvio(p.id, { url: blob.url, pathname: blob.pathname, contentType: blob.contentType }, { deps }).catch((e) => { if (!['EM_ANDAMENTO', 'ARQUIVADO'].includes(e.code)) throw e; }); return { registrado: 'origem' }; }
  // Resultado e poster do worker: o worker confirma tudo em `worker/resultado`; aqui só fica anotado no log.
  const reg = await ler(p.id); const c = reg.doc;
  log(c, `Blob recebeu ${p.papel || 'arquivo'}: ${blob.pathname}`);
  await gravar(c, reg.rev).catch(() => {});
  return { registrado: p.papel || 'arquivo' };
}

// ── Leitura ─────────────────────────────────────────────────────────────────
function resumo(c) {
  const v = M.versaoAtiva(c);
  return { id: c.id, titulo: c.titulo, estado: c.video.estado, status: c.status, criado_em: c.created_at, atualizado_em: c.updated_at, estilo: c.video.estilo,
    poster: c.video.resultado?.poster_url || null, url: c.video.resultado?.url || null, duracao_s: c.video.resultado?.duracao_s ?? c.video.origem?.duracao_s ?? null,
    legenda: c.video.legenda_ig?.texto || null, hashtags: c.video.legenda_ig?.hashtags || [], hash: v?.hash || null, erro: c.video.estado === 'erro' ? c.video.worker?.erro || null : null, tentativas: c.video.worker?.tentativas || 0 };
}
function publico(c) {
  const d = M.clone(c);
  if (d.video?.worker) delete d.video.worker.lease_ate;
  return d;
}
async function listar() {
  return (await docsDeVideo()).map((r) => r.doc).filter((c) => c.status !== 'arquivado').sort((p, q) => String(q.created_at).localeCompare(String(p.created_at))).map(resumo);
}
async function obter(id) { return publico((await ler(id)).doc); }

module.exports = {
  criar, registrarEnvio, proximoJob, registrarResultado, registrarErro, refazer, apagar, listar, obter, resumo, publico,
  gerarLegenda, problemasDaLegenda, limparLegenda, tokenDoWorker, registrarUploadConcluido, restricoesToken, dispararWorker, exigirBlob, pathnameValido,
  ESTILOS, OPCOES_PADRAO, TIPOS_PERMITIDOS, TAMANHO_MAXIMO, LEASE_MS, MAX_TENTATIVAS, MSG_SEM_BLOB, PREFIXO,
};
