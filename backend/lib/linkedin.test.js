// LinkedIn: conexão (OAuth com state assinado), token cifrado, PDF do carrossel, texto e publicação (API falsa).
// node --test backend/lib/linkedin.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const arm = require('./armazem');
const L = require('./linkedin');
const { ACCOUNT } = require('./account');

const env = (vars, fn) => async () => { const antes = {}; for (const k of Object.keys(vars)) { antes[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; } try { await fn(); } finally { for (const k of Object.keys(vars)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } } };
const CFG = { LINKEDIN_CLIENT_ID: 'cid', LINKEDIN_CLIENT_SECRET: 'segredo-do-app', PUBLIC_BASE_URL: 'https://app.exemplo.test' };
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const resposta = (status, corpo, cab = {}) => ({ ok: status < 400, status, headers: { get: (k) => cab[k.toLowerCase()] ?? null }, json: async () => corpo, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });

test('sem app configurado, conectar explica o passo que falta', env({ LINKEDIN_CLIENT_ID: null, LINKEDIN_CLIENT_SECRET: null }, async () => {
  assert.throws(() => L.urlConectar(), (e) => e.code === 'SEM_CONFIG');
}));

test('conectar: link do LinkedIn com escopos e state assinado; state falso ou vencido é recusado', env(CFG, async () => {
  const u = new URL(L.urlConectar());
  assert.strictEqual(u.origin + u.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.strictEqual(u.searchParams.get('scope'), 'openid profile w_member_social');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://app.exemplo.test/api/linkedin/callback');
  assert.ok(L.stateValido(u.searchParams.get('state')));
  assert.ok(!L.stateValido('abc.def')); assert.ok(!L.stateValido(L.novoState(Date.now() - 16 * 60000)));
}));

test('concluir conexão: troca o código, lê o perfil, guarda o token cifrado e liga a publicação', env(CFG, async () => {
  novo(); const chamadas = [];
  const fetch = async (url, o = {}) => { chamadas.push({ url, o }); if (/accessToken/.test(url)) return resposta(200, { access_token: 'TOKEN-SECRETO', expires_in: 5184000, scope: 'openid,profile,w_member_social' }); return resposta(200, { sub: 'abc123', name: 'Pedro Martins' }); };
  const c = await L.concluirConexao({ code: 'codigo', state: L.novoState() }, { fetch });
  assert.strictEqual(c.pessoa, 'urn:li:person:abc123'); assert.strictEqual(c.ativo, true);
  assert.ok(!String(c.token).includes('TOKEN-SECRETO'), 'token não fica em texto puro'); assert.strictEqual(L.decifrar(c.token), 'TOKEN-SECRETO');
  assert.match(chamadas[0].o.body, /grant_type=authorization_code/); assert.match(chamadas[0].o.body, /client_secret=segredo-do-app/);
  const e = await L.estado(); assert.deepStrictEqual({ c: e.conectado, a: e.ativo, n: e.nome }, { c: true, a: true, n: 'Pedro Martins' }); assert.ok(e.dias_para_vencer >= 59);
  await assert.rejects(L.concluirConexao({ code: 'x', state: 'falso.falso' }, { fetch }), (er) => er.code === 'STATE');
  await L.definirAtivo(false); assert.strictEqual((await L.estado()).ativo, false);
  await L.desconectar(); assert.strictEqual((await L.estado()).conectado, false);
  await assert.rejects(L.definirAtivo(true), (er) => er.code === 'NAO_CONECTADO');
}));

test('texto: tira "link na bio" e menções de @, escapa os caracteres reservados do LinkedIn', () => {
  const t = L.textoLinkedIn('Primeira linha (com parênteses) e *destaque*.\n\nSegue o @pedro_destrava para mais.\nLink na bio.\n\n#empreendedorismo #mei');
  assert.strictEqual(t, 'Primeira linha \\(com parênteses\\) e \\*destaque\\*.\n\n\\#empreendedorismo \\#mei');
});

test('PDF do carrossel: um JPEG por página, sem recompressão, e estrutura válida', async () => {
  const jpg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#24f' } }).jpeg().toBuffer();
  const pdf = L.pdfDeJpegs([jpg, jpg, jpg]);
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4')); assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.strictEqual((s.match(/\/Type \/Page /g) || []).length, 3); assert.match(s, /\/Count 3/);
  assert.ok(pdf.indexOf(jpg) > 0, 'o JPEG entra inteiro');
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]); assert.strictEqual(s.slice(xref, xref + 4), 'xref');
  // o PDF abre num leitor de PDF de verdade
  const lido = await require('pdf-parse')(pdf); assert.strictEqual(lido.numpages, 3);
});

test('publicar: carrossel vira documento, post vai ao perfil com o texto; repetir não posta duas vezes; 401 avisa para reconectar', env(CFG, async () => {
  novo(); const a = arm.armazem();
  const conectar = async (f) => L.concluirConexao({ code: 'c', state: L.novoState() }, { fetch: f });
  await conectar(async (url) => (/accessToken/.test(url) ? resposta(200, { access_token: 'T', expires_in: 5184000 }) : resposta(200, { sub: 'p1', name: 'Pedro' })));
  const jpg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#a55' } }).jpeg().toBuffer();
  const c = { id: 'c_li', titulo: 'Seu **caixa** sente primeiro', formato: 'carrossel' }; const v = { id: 'v1', hash: 'h1', slides: [{ texto: 'a' }, { texto: 'b' }, { texto: 'c' }] };
  const posts = []; const envios = [];
  const fetch = async (url, o = {}) => {
    if (/documents\?action=initializeUpload/.test(url)) { assert.strictEqual(JSON.parse(o.body).initializeUploadRequest.owner, 'urn:li:person:p1'); assert.strictEqual(o.headers['LinkedIn-Version'], '202608'); return resposta(200, { value: { uploadUrl: 'https://upload.test/doc', document: 'urn:li:document:D1' } }); }
    if (url === 'https://upload.test/doc') { envios.push(o); return resposta(201, ''); }
    if (/\/rest\/posts$/.test(url)) { posts.push(JSON.parse(o.body)); return resposta(201, '', { 'x-restli-id': 'urn:li:share:999' }); }
    throw new Error(`inesperado ${url}`);
  };
  const deps = { fetch, carregarAprovado: async () => ({ c, v }), jpegDoSlide: async () => jpg, montarLegenda: () => 'Texto do post (aprovado).\nLink na bio.' };
  const r = await L.publicar('c_li', { deps });
  assert.strictEqual(r.estado, 'publicada'); assert.strictEqual(r.permalink, 'https://www.linkedin.com/feed/update/urn:li:share:999/');
  assert.strictEqual(envios[0].headers['Content-Type'], 'application/pdf'); assert.ok(envios[0].body.toString('latin1').startsWith('%PDF'));
  assert.deepStrictEqual(posts[0].content.media, { title: 'Seu caixa sente primeiro', id: 'urn:li:document:D1' });
  assert.strictEqual(posts[0].author, 'urn:li:person:p1'); assert.strictEqual(posts[0].commentary, 'Texto do post \\(aprovado\\).'); assert.strictEqual(posts[0].visibility, 'PUBLIC');
  await L.publicar('c_li', { deps }); assert.strictEqual(posts.length, 1, 'já publicado: não posta de novo');
  // token revogado: erro claro e o registro fica em erro para repetir depois
  const r401 = { ...deps, fetch: async () => resposta(401, { message: 'Invalid access token' }) };
  await assert.rejects(L.publicar('c_outro', { deps: r401 }), (e) => e.code === 'TOKEN_VENCIDO' && /Conecte de novo/.test(e.message));
  assert.strictEqual((await a.publicacoes.obter(ACCOUNT.ig_id, 'c_outro', 'linkedin')).estado, 'erro');
  // vídeo ainda não vai
  await assert.rejects(L.publicar('c_v', { deps: { ...deps, carregarAprovado: async () => ({ c: { ...c, formato: 'reels' }, v }) } }), (e) => e.code === 'VIDEO');
}));

test('post de uma imagem vai como imagem (não documento)', env(CFG, async () => {
  novo();
  await L.concluirConexao({ code: 'c', state: L.novoState() }, { fetch: async (url) => (/accessToken/.test(url) ? resposta(200, { access_token: 'T', expires_in: 5184000 }) : resposta(200, { sub: 'p1' })) });
  const jpg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#5a5' } }).jpeg().toBuffer(); const posts = [];
  const fetch = async (url, o = {}) => {
    if (/images\?action=initializeUpload/.test(url)) return resposta(200, { value: { uploadUrl: 'https://upload.test/img', image: 'urn:li:image:I1' } });
    if (url === 'https://upload.test/img') { assert.strictEqual(o.headers['Content-Type'], 'image/jpeg'); return resposta(201, ''); }
    if (/\/rest\/posts$/.test(url)) { posts.push(JSON.parse(o.body)); return resposta(201, '', { 'x-restli-id': 'urn:li:share:1' }); }
    throw new Error(`inesperado ${url}`);
  };
  await L.publicar('c_img', { deps: { fetch, carregarAprovado: async () => ({ c: { id: 'c_img', titulo: 'T', formato: 'estatico' }, v: { id: 'v', hash: 'h', slides: [{ texto: 'Seu **caixa**' }] } }), jpegDoSlide: async () => jpg, montarLegenda: () => 'Legenda.' } });
  assert.deepStrictEqual(posts[0].content.media, { id: 'urn:li:image:I1', altText: 'Seu caixa' });
}));
