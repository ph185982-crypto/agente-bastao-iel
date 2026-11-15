// LinkedIn: o mesmo conteúdo aprovado para o Instagram sai também no perfil do Pedro no LinkedIn.
//  - Conexão: OAuth 2.0 do LinkedIn ("Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn", escopos
//    openid profile w_member_social). App criado pelo Pedro em developer.linkedin.com; LINKEDIN_CLIENT_ID e
//    LINKEDIN_CLIENT_SECRET na Vercel. O token (vale ~60 dias) fica no banco cifrado com AES-256-GCM.
//  - Publicação: carrossel vira DOCUMENTO (PDF, um slide por página: é o carrossel do LinkedIn); post de uma imagem vai como
//    imagem. Vídeo ainda não vai ao LinkedIn. Só a versão aprovada; nada sai sem a aprovação do Pedro.
//  - Posts API (POST /rest/posts) com cabeçalho LinkedIn-Version (LINKEDIN_VERSION, padrão abaixo).
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const REDE = 'linkedin';
const VERSAO = () => process.env.LINKEDIN_VERSION || '202608';
const ESCOPOS = 'openid profile w_member_social';
const conta = () => ACCOUNT.ig_id;
const erro = (msg, status = 400, code = 'LINKEDIN') => Object.assign(new Error(msg), { status, code });
const configurado = () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
const baseApp = () => String(process.env.PUBLIC_BASE_URL || 'https://agente-bastao-iel.vercel.app').replace(/\/$/, '');
const redirectUri = () => `${baseApp()}/api/linkedin/callback`;

// ── Segredos ────────────────────────────────────────────────────────────────
const chave = () => crypto.createHash('sha256').update(`linkedin|${process.env.LINKEDIN_CLIENT_SECRET || ''}|${process.env.APP_TOKEN_SALT || ''}`).digest();
function cifrar(texto) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${dados.toString('base64url')}`;
}
function decifrar(pacote) {
  try {
    const [iv, tag, dados] = String(pacote || '').split('.');
    const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
// state do OAuth: assinado e com validade de 15 min (impede que outro site conecte a conta de alguém aqui).
function novoState(agora = Date.now()) {
  const corpo = Buffer.from(JSON.stringify({ n: crypto.randomBytes(8).toString('hex'), exp: agora + 15 * 60000 })).toString('base64url');
  return `${corpo}.${crypto.createHmac('sha256', chave()).update(corpo).digest('base64url')}`;
}
function stateValido(state, agora = Date.now()) {
  const [corpo, mac] = String(state || '').split('.'); if (!corpo || !mac) return false;
  const esperado = crypto.createHmac('sha256', chave()).update(corpo).digest('base64url');
  if (mac.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(esperado))) return false;
  try { return JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')).exp > agora; } catch { return false; }
}

// ── Conexão ─────────────────────────────────────────────────────────────────
function urlConectar() {
  if (!configurado()) throw erro('Falta criar o app do LinkedIn e pôr LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET na Vercel.', 503, 'SEM_CONFIG');
  const q = new URLSearchParams({ response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: redirectUri(), scope: ESCOPOS, state: novoState() });
  return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
}

async function lerCfg(a = armazem()) { return a?.duravel ? ((await a.config.obter(conta())).linkedin || {}) : {}; }
async function salvarCfg(patch, a = armazem()) {
  if (!a?.duravel) throw erro('O LinkedIn precisa do banco de dados no servidor.', 503, 'SEM_BANCO');
  const novo = { ...(await lerCfg(a)), ...patch }; await a.config.salvar(conta(), { linkedin: novo }); return novo;
}

async function concluirConexao({ code, state }, { fetch: f = globalThis.fetch, agora = Date.now() } = {}) {
  if (!stateValido(state, agora)) throw erro('O link de conexão expirou. Toque em "Conectar LinkedIn" de novo.', 400, 'STATE');
  if (!code) throw erro('O LinkedIn não devolveu a autorização.', 400, 'SEM_CODE');
  const r = await f('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }).toString() });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw erro(`O LinkedIn recusou a conexão: ${t.error_description || t.error || r.status}`, 502, 'TOKEN');
  const u = await f('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
  const eu = await u.json().catch(() => ({}));
  if (!u.ok || !eu.sub) throw erro('Conectou, mas não consegui ler o seu perfil do LinkedIn (falta o produto "Sign In with LinkedIn using OpenID Connect" no app).', 502, 'PERFIL');
  return salvarCfg({
    token: cifrar(t.access_token), refresh: t.refresh_token ? cifrar(t.refresh_token) : null,
    expira_em: new Date(agora + (Number(t.expires_in) || 5184000) * 1000).toISOString(),
    pessoa: `urn:li:person:${eu.sub}`, nome: eu.name || [eu.given_name, eu.family_name].filter(Boolean).join(' ') || null,
    conectado_em: new Date(agora).toISOString(), ativo: true, escopos: t.scope || ESCOPOS,
  });
}

async function estado({ agora = Date.now() } = {}) {
  const c = await lerCfg();
  const conectado = !!(c.token && c.pessoa && Date.parse(c.expira_em) > agora);
  return {
    configurado: configurado(), conectado, nome: c.nome || null, ativo: !!c.ativo && conectado, expira_em: c.expira_em || null,
    dias_para_vencer: c.expira_em ? Math.floor((Date.parse(c.expira_em) - agora) / 86400000) : null,
    venceu: !!c.token && !conectado, redirect_uri: redirectUri(),
  };
}
async function definirAtivo(ativo) { const c = await lerCfg(); if (ativo && !c.token) throw erro('Conecte o LinkedIn primeiro.', 409, 'NAO_CONECTADO'); return salvarCfg({ ativo: !!ativo }); }
async function desconectar() { return salvarCfg({ token: null, refresh: null, pessoa: null, nome: null, expira_em: null, ativo: false }); }

// ── Texto ───────────────────────────────────────────────────────────────────
// O campo commentary usa o formato "little text": estes caracteres precisam de barra antes, senão o post é recusado
// ou o texto some. Hashtag fica como texto (#tag), sem virar link.
const escapar = (t) => String(t || '').replace(/[\\|{}@[\]()<>#*_~]/g, (ch) => `\\${ch}`);
// A legenda do Instagram serve no LinkedIn, sem o "link na bio" nem menção ao @ (não existe lá) e com até 2.900 caracteres.
function textoLinkedIn(legenda) {
  const t = String(legenda || '').replace(/\r/g, '').split('\n').filter((l) => !/link na bio|segue o @|siga o @/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return escapar(t).slice(0, 2900);
}

// ── PDF do carrossel ────────────────────────────────────────────────────────
// PDF mínimo com um JPEG por página (DCTDecode: o JPEG entra sem recompressão). Página no tamanho do slide (4:5).
function pdfDeJpegs(jpegs, { largura = 1080, altura = 1350 } = {}) {
  const partes = []; const offsets = []; let tam = 0;
  const add = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'binary'); partes.push(buf); tam += buf.length; };
  const obj = (n, corpo) => { offsets[n] = tam; add(`${n} 0 obj\n`); for (const c of [].concat(corpo)) add(c); add('\nendobj\n'); };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpegs.length; const paginas = []; // objetos: 1 catálogo, 2 páginas, depois por página: página, conteúdo, imagem
  for (let i = 0; i < n; i++) paginas.push(3 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${paginas.map((p) => `${p} 0 R`).join(' ')}] /Count ${n} >>`);
  jpegs.forEach((jpg, i) => {
    const pg = 3 + i * 3; const cont = pg + 1; const img = pg + 2;
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largura} ${altura}] /Resources << /XObject << /Im${i} ${img} 0 R >> >> /Contents ${cont} 0 R >>`);
    const desenho = `q ${largura} 0 0 ${altura} 0 0 cm /Im${i} Do Q`;
    obj(cont, [`<< /Length ${desenho.length} >>\nstream\n`, desenho, '\nendstream']);
    obj(img, [`<< /Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
  });
  const xref = tam; const total = 3 + n * 3;
  add(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) add(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(partes);
}

// ── API ─────────────────────────────────────────────────────────────────────
function cliente(token, f = globalThis.fetch) {
  const cab = { Authorization: `Bearer ${token}`, 'LinkedIn-Version': VERSAO(), 'X-Restli-Protocol-Version': '2.0.0' };
  const json = async (metodo, url, corpo) => {
    const r = await f(url, { method: metodo, headers: { ...cab, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const txt = await r.text(); let d = {}; try { d = txt ? JSON.parse(txt) : {}; } catch { d = { message: txt.slice(0, 200) }; }
    if (!r.ok) throw erro(r.status === 401 ? 'O acesso ao LinkedIn venceu ou foi revogado. Conecte de novo em Perfil → Conexões.' : `LinkedIn respondeu ${r.status}: ${String(d.message || d.error || '').slice(0, 160)}`, r.status === 401 ? 401 : 502, r.status === 401 ? 'TOKEN_VENCIDO' : 'API');
    return { d, cabecalhos: r.headers };
  };
  const subir = async (url, bytes, tipo) => { const r = await f(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': tipo }, body: bytes }); if (!r.ok) throw erro(`Envio do arquivo ao LinkedIn falhou (${r.status}).`, 502, 'UPLOAD'); };
  return { json, subir };
}

async function enviarArquivo(api, pessoa, { tipo, bytes }) {
  const rota = tipo === 'documento' ? 'documents' : 'images';
  const { d } = await api.json('POST', `https://api.linkedin.com/rest/${rota}?action=initializeUpload`, { initializeUploadRequest: { owner: pessoa } });
  const v = d.value || {}; if (!v.uploadUrl || !(v.document || v.image)) throw erro('O LinkedIn não devolveu o endereço de envio.', 502, 'UPLOAD');
  await api.subir(v.uploadUrl, bytes, tipo === 'documento' ? 'application/pdf' : 'image/jpeg');
  return v.document || v.image;
}

// Publica o conteúdo aprovado no LinkedIn. Idempotente (registro em pico_publicacoes, rede 'linkedin').
async function publicar(id, { hash, deps = {} } = {}) {
  const P = require('./publicador'); const a = deps.armazem || armazem();
  const cfg = await lerCfg(a);
  if (!cfg.token || !cfg.pessoa) throw erro('Conecte o LinkedIn em Perfil → Conexões.', 409, 'NAO_CONECTADO');
  if (Date.parse(cfg.expira_em) <= Date.now()) throw erro('O acesso ao LinkedIn venceu. Conecte de novo em Perfil → Conexões.', 401, 'TOKEN_VENCIDO');
  const token = decifrar(cfg.token); if (!token) throw erro('Não consegui ler o acesso ao LinkedIn. Conecte de novo.', 401, 'TOKEN_VENCIDO');
  const { c, v } = await (deps.carregarAprovado || P.carregarAprovado)(id, hash);
  if (c.formato === 'reels') throw erro('Vídeo ainda não vai ao LinkedIn.', 409, 'VIDEO');
  const existente = await a.publicacoes.obter(conta(), id, REDE);
  if (existente && existente.estado === 'publicada') return P.resposta(existente);
  const dados = { versao: v.id, hash_versao: v.hash, n_slides: v.slides.length, erro: null };
  if (existente) await a.publicacoes.reiniciar(conta(), id, REDE, dados); else { const r = await a.publicacoes.iniciar(conta(), id, REDE, dados); if (!r.criada) return P.resposta(r.pub); }
  try {
    const api = cliente(token, deps.fetch);
    const jpegs = []; for (let i = 0; i < Math.min(v.slides.length, 20); i++) jpegs.push(await (deps.jpegDoSlide || P.jpegDoSlide)(c, v, i));
    const commentary = textoLinkedIn((deps.montarLegenda || P.montarLegenda)(v));
    let content;
    if (jpegs.length === 1) content = { media: { id: await enviarArquivo(api, cfg.pessoa, { tipo: 'imagem', bytes: jpegs[0] }), altText: String(v.slides[0]?.texto || c.titulo || '').replace(/\*/g, '').slice(0, 300) } };
    else content = { media: { title: String(c.titulo || 'Carrossel').replace(/\*/g, '').slice(0, 200), id: await enviarArquivo(api, cfg.pessoa, { tipo: 'documento', bytes: pdfDeJpegs(jpegs) }) } };
    const { cabecalhos } = await api.json('POST', 'https://api.linkedin.com/rest/posts', { author: cfg.pessoa, commentary, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, content, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false });
    const postId = cabecalhos?.get?.('x-restli-id') || cabecalhos?.get?.('x-linkedin-id') || null;
    return P.resposta(await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'publicada', { ig_media_id: postId, permalink: postId ? `https://www.linkedin.com/feed/update/${postId}/` : null, publicada_em: new Date().toISOString() }) || await a.publicacoes.obter(conta(), id, REDE));
  } catch (e) {
    await a.publicacoes.atualizar(conta(), id, REDE, ['iniciada'], 'erro', { erro: { amigavel: e.message, codigo: e.code || null } });
    throw e;
  }
}

module.exports = { REDE, ESCOPOS, configurado, redirectUri, urlConectar, concluirConexao, estado, definirAtivo, desconectar, lerCfg, publicar, textoLinkedIn, escapar, pdfDeJpegs, cifrar, decifrar, novoState, stateValido };
