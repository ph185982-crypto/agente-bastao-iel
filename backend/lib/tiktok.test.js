// TikTok: conexão (OAuth v2 com state assinado), renovação do token de 24 h e publicação (API falsa).
// node --test backend/lib/tiktok.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const T = require('./tiktok');

const env = (vars, fn) => async () => { const antes = {}; for (const k of Object.keys(vars)) { antes[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; } try { await fn(); } finally { for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } } };
const CFG = { TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'segredo', TIKTOK_REDIRECT_BASE: 'https://app.exemplo.test', TIKTOK_MEDIA_BASE: 'https://app.exemplo.test' };
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const resposta = (status, corpo) => ({ ok: status < 400, status, json: async () => corpo, arrayBuffer: async () => new TextEncoder().encode('VIDEO').buffer });
const ok = (data) => resposta(200, { data, error: { code: 'ok', message: '' } });

test('conectar: link do TikTok com client_key, escopos e state assinado; sem app explica o que falta', env(CFG, async () => {
  const u = new URL(T.urlConectar());
  assert.strictEqual(u.origin + u.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.strictEqual(u.searchParams.get('client_key'), 'ck');
  assert.strictEqual(u.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://app.exemplo.test/api/tiktok/callback');
  assert.ok(T.stateValido(u.searchParams.get('state'))); assert.ok(!T.stateValido('x.y'));
  delete process.env.TIKTOK_CLIENT_KEY; assert.throws(() => T.urlConectar(), (e) => e.code === 'SEM_CONFIG');
}));

test('conexão guarda tokens cifrados; token de 24 h vencendo é renovado pelo refresh', env(CFG, async () => {
  novo(); const t0 = Date.parse('2026-11-22T12:00:00Z'); const chamadas = [];
  const f = async (url, o = {}) => { chamadas.push(url); if (/oauth\/token/.test(url)) { const b = new URLSearchParams(o.body); return resposta(200, b.get('grant_type') === 'refresh_token' ? { access_token: 'NOVO', refresh_token: 'R2', expires_in: 86400, refresh_expires_in: 31536000 } : { access_token: 'A1', refresh_token: 'R1', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'o1' }); } return ok({ user: { display_name: 'Pedro' } }); };
  const c = await T.concluirConexao({ code: 'x', state: T.novoState(t0) }, { fetch: f, agora: t0 });
  assert.strictEqual(c.nome, 'Pedro'); assert.ok(!JSON.stringify(c).includes('A1')); assert.strictEqual(T.decifrar(c.token), 'A1');
  assert.strictEqual((await T.tokenAtual({ fetch: f, agora: t0 + 3600000 })).token, 'A1');
  assert.strictEqual((await T.tokenAtual({ fetch: f, agora: t0 + 86000000 })).token, 'NOVO');
}));

test('publicar: carrossel vira post de fotos (URLs do domínio verificado), privacidade mais aberta permitida; repetir não posta duas vezes', env(CFG, async () => {
  novo(); const t0 = Date.now();
  await T.salvarCfg({ token: T.cifrar('TK'), refresh: T.cifrar('R'), expira_em: new Date(t0 + 86400000).toISOString(), refresh_expira_em: new Date(t0 + 9e9).toISOString(), ativo: true });
  const posts = [];
  const fetch = async (url, o = {}) => {
    assert.strictEqual(o.headers.Authorization, 'Bearer TK');
    if (/creator_info/.test(url)) return ok({ privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], comment_disabled: false });
    if (/content\/init/.test(url)) { posts.push(JSON.parse(o.body)); return ok({ publish_id: 'p_1' }); }
    throw new Error(`inesperado ${url}`);
  };
  const c = { id: 'c_tk', titulo: 'Seu **caixa** sente primeiro', formato: 'carrossel' }; const v = { id: 'v1', hash: 'h1', slides: [{ texto: 'a' }, { texto: 'b' }] };
  const deps = { fetch, carregarAprovado: async () => ({ c, v }), montarLegenda: () => 'Texto.\nLink na bio.\nSegue o @pedro_destrava pra mais.', urlMidia: (base, id, h, i) => `${base}/api/publico/midia/${id}-${i}.jpg` };
  const r = await T.publicar('c_tk', { deps });
  assert.strictEqual(r.estado, 'publicada');
  const p = posts[0];
  assert.strictEqual(p.media_type, 'PHOTO'); assert.strictEqual(p.post_mode, 'DIRECT_POST'); assert.strictEqual(p.source_info.source, 'PULL_FROM_URL');
  assert.deepStrictEqual(p.source_info.photo_images, ['https://app.exemplo.test/api/publico/midia/c_tk-0.jpg', 'https://app.exemplo.test/api/publico/midia/c_tk-1.jpg']);
  assert.strictEqual(p.post_info.privacy_level, 'PUBLIC_TO_EVERYONE'); assert.strictEqual(p.post_info.title, 'Seu caixa sente primeiro');
  assert.ok(!/link na bio/i.test(p.post_info.description)); assert.ok(!/@pedro_destrava/.test(p.post_info.description));
  await T.publicar('c_tk', { deps }); assert.strictEqual(posts.length, 1);
}));

test('publicar: app não auditado só aceita "Somente eu"; vídeo vai por upload; erro do TikTok fica registrado com mensagem clara', env(CFG, async () => {
  novo(); const t0 = Date.now(); const a = arm.armazem();
  await T.salvarCfg({ token: T.cifrar('TK'), refresh: T.cifrar('R'), expira_em: new Date(t0 + 86400000).toISOString(), refresh_expira_em: new Date(t0 + 9e9).toISOString(), ativo: true });
  const inits = []; const uploads = [];
  const fetch = async (url, o = {}) => {
    if (/creator_info/.test(url)) return ok({ privacy_level_options: ['SELF_ONLY'] });
    if (/video\/init/.test(url)) { inits.push(JSON.parse(o.body)); return ok({ publish_id: 'v_1', upload_url: 'https://upload.test/v' }); }
    if (url === 'https://upload.test/v') { uploads.push(o); return resposta(201, {}); }
    if (url === 'https://blob.test/final.mp4') return resposta(200, {});
    throw new Error(`inesperado ${url}`);
  };
  const c = { id: 'vd_1', titulo: 'Vídeo', formato: 'reels', motion: { url: 'https://blob.test/final.mp4' } }; const v = { id: 'v1', hash: 'h1', slides: [{ texto: 'a' }] };
  await T.publicar('vd_1', { deps: { fetch, carregarAprovado: async () => ({ c, v }), montarLegenda: () => 'Legenda' } });
  assert.strictEqual(inits[0].post_info.privacy_level, 'SELF_ONLY'); assert.strictEqual(inits[0].source_info.source, 'FILE_UPLOAD'); assert.strictEqual(inits[0].source_info.video_size, 5);
  assert.strictEqual(uploads[0].headers['Content-Range'], 'bytes 0-4/5');
  assert.strictEqual((await T.estado()).privacidade, 'SELF_ONLY');
  const falha = async (url) => (/creator_info/.test(url) ? ok({ privacy_level_options: ['PUBLIC_TO_EVERYONE'] }) : resposta(403, { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: '' } }));
  await assert.rejects(T.publicar('c_x', { deps: { fetch: falha, carregarAprovado: async () => ({ c: { id: 'c_x', formato: 'carrossel' }, v }), montarLegenda: () => 'x', urlMidia: () => 'https://app.exemplo.test/a.jpg' } }), /auditado/);
  assert.strictEqual((await a.publicacoes.obter(require('./account').ACCOUNT.ig_id, 'c_x', 'tiktok')).estado, 'erro');
}));
