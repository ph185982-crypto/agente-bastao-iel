// Aba Vídeos + Teleprompter no navegador. Servidor real da aplicação (armazenamento em memória), mas a API de vídeos
// é SIMULADA com page.route (o backend /api/videos pode não estar neste checkout) e o upload ao Blob é um dublê.
// Como mesa.js ainda não liga a aba, o teste monta a tela chamando window.Videos.render(ctx) num container próprio.
// Câmera e microfone são os dispositivos FALSOS do Chromium (nada é gravado de verdade). Nada vai ao Instagram.
// Uso: node tests/e2e/videosTest.js  (sobe o servidor de teste sozinho)  ou  BASE=http://127.0.0.1:3995 node tests/e2e/videosTest.js
const { chromium } = require('./apoio');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const SP = process.env.SP || path.join(__dirname, 'out');
const PORTA = Number(process.env.TESTE_PORT || 3995);
const BASE = process.env.BASE || `http://127.0.0.1:${PORTA}`;
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Servidor de teste (só quando ninguém passou BASE) ───────────────────────────
let servidor = null;
async function subirServidor() {
  if (process.env.BASE) return;
  const ambiente = { ...process.env };
  for (const k of Object.keys(ambiente)) if (/API_KEY|TOKEN|SECRET|DATABASE_URL|POSTGRES|APP_ACCESS_CODE|VERCEL|NODE_ENV|FRONTEND_URL/.test(k)) delete ambiente[k];
  servidor = spawn(process.execPath, ['tests/e2e/servidorTeste.js'], { cwd: path.join(__dirname, '../..'), env: { ...ambiente, PORT: String(PORTA + 1), TESTE_PORT: String(PORTA), TESTE_MEMORIA: '1', ATRASO_MS: '50', CARROSSEL_PADRAO: 'legado' }, stdio: 'inherit' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* ainda subindo */ } await espera(100); }
  throw new Error(`Servidor de teste não iniciou em ${BASE}.`);
}
async function derrubarServidor() { if (!servidor || servidor.exitCode !== null) return; await new Promise((r) => { servidor.once('exit', r); servidor.kill('SIGTERM'); }); }

// ── API de vídeos simulada ──────────────────────────────────────────────────────
const agora = Date.now();
const iso = (minAtras) => new Date(agora - minAtras * 60000).toISOString();
const fixtures = () => [
  { id: 'v1', titulo: 'Por que o imposto come o seu lucro antes de você ver', estado: 'na_fila', criado_em: iso(3), estilo: 'hormozi' },
  { id: 'v2', titulo: 'O erro que quebra o MEI em seis meses', estado: 'editando', criado_em: iso(9), estilo: 'beast', video: { roteiro_texto: 'Você abriu o MEI, começou a vender e esqueceu de separar o dinheiro da empresa do seu.' } },
  { id: 'v3', titulo: 'Três sinais de que o seu preço está errado', estado: 'pronto', criado_em: iso(40), estilo: 'hormozi', poster: `${BASE}/app-icon-512.png`, url: `${BASE}/videos/v3/final.mp4`, duracao: 58, hash: 'h3',
    legenda: { texto: 'Se o cliente nunca reclama do preço, você está cobrando pouco. Três sinais para corrigir hoje.', hashtags: ['#empreendedorismo', '#precificacao', '#pedrodestrava'] }, video: { resultado: { cortes: 14, palavras: 162, tamanho: 18 * 1048576 } } },
  { id: 'v4', titulo: 'Gravação 07/11 18:20', estado: 'erro', criado_em: iso(120), estilo: 'caixa', erro: 'ffmpeg saiu com código 1: o arquivo não tem faixa de áudio.' },
  { id: 'v5', titulo: 'Quanto custa abrir uma empresa de verdade', estado: 'pronto', status: 'publicado', criado_em: iso(2000), estilo: 'hormozi', poster: `${BASE}/app-icon-512.png`, url: `${BASE}/videos/v5/final.mp4`, duracao: 44, hash: 'h5', legenda: 'Publicado.', publicacao: { url: 'https://www.instagram.com/p/teste/' } },
];
const reg = { chamadas: [], modo503: false, lista: fixtures(), proximoId: 6 };
const json = (r, corpo, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
async function rotasVideos(ctx) {
  await ctx.route('**/api/videos**', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const partes = u.pathname.split('/').filter(Boolean); // api, videos, :id?, acao?
    const id = partes[2]; const acao = partes[3]; const corpo = req.postDataJSON ? (() => { try { return req.postDataJSON(); } catch { return null; } })() : null;
    reg.chamadas.push({ metodo: req.method(), caminho: u.pathname, corpo });
    if (reg.modo503) return json(r, { error: 'Armazenamento não ligado (BLOB_READ_WRITE_TOKEN ausente).', code: 'SEM_BLOB' }, 503);
    if (req.method() === 'GET' && !id) return json(r, reg.lista);
    if (req.method() === 'POST' && !id) { const novo = { id: `v${reg.proximoId++}`, titulo: corpo?.titulo || 'Novo vídeo', estado: 'enviado', criado_em: new Date().toISOString(), estilo: corpo?.estilo || 'hormozi', video: { roteiro_texto: corpo?.roteiro_texto || '' } }; reg.lista.unshift(novo); return json(r, { id: novo.id }); }
    if (id && acao === 'enviado') { const v = reg.lista.find((x) => x.id === id); if (v) v.estado = 'na_fila'; return json(r, { ok: true, estado: 'na_fila' }); }
    if (id && acao === 'refazer') { const v = reg.lista.find((x) => x.id === id); if (v) { v.estado = 'na_fila'; v.estilo = corpo?.estilo || v.estilo; } return json(r, { ok: true, estado: 'na_fila' }); }
    if (id && req.method() === 'DELETE') { reg.lista = reg.lista.filter((x) => x.id !== id); return json(r, { ok: true }); }
    if (id && req.method() === 'GET') { const v = reg.lista.find((x) => x.id === id); return v ? json(r, { doc: { ...v, motion: { hash: v.hash || 'hx' } } }) : json(r, { error: 'não achei' }, 404); }
    return json(r, { error: `rota não simulada: ${req.method()} ${u.pathname}` }, 404);
  });
  await ctx.route('**/api/studio/*/decidir', async (r) => {
    const req = r.request(); const id = new URL(req.url()).pathname.split('/')[3]; const corpo = req.postDataJSON();
    reg.chamadas.push({ metodo: 'POST', caminho: `/api/studio/${id}/decidir`, corpo });
    const v = reg.lista.find((x) => x.id === id);
    if (v && corpo.acao === 'aprovar' && !corpo.agora) { v.status = 'aprovado'; v.agenda = { publicar_em: new Date(agora + 2 * 3600000).toISOString() }; }
    if (v && corpo.acao === 'aprovar' && corpo.agora) { v.status = 'aprovado'; v.studio = { estado: 'publicando' }; }
    if (v && corpo.acao === 'descartar') v.status = 'arquivado';
    return json(r, { doc: { id, agenda: v?.agenda || null, status: v?.status } }, 202);
  });
}
const chamou = (metodo, re) => reg.chamadas.find((c) => c.metodo === metodo && re.test(c.caminho));

// ── Monta a aba num container próprio (mesa.js não é editado por este módulo) ──
async function montarAba(p) {
  await p.addStyleTag({ url: `${BASE}/videos.css` });
  await p.addScriptTag({ url: `${BASE}/videos.js` });
  await p.addScriptTag({ url: `${BASE}/teleprompter.js` });
  await p.evaluate(() => {
    document.getElementById('esteira').hidden = true;
    const box = document.createElement('div'); box.id = 'vd-teste'; box.style.cssText = 'padding:14px 16px 40px;max-width:1120px;margin:0 auto;min-height:100vh;background:#F6F5F0';
    document.body.appendChild(box);
    const toastEl = document.createElement('div'); toastEl.id = 'vd-toast'; toastEl.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9;background:#18191D;color:#F6F5F0;border-left:4px solid #FF7043;border-radius:12px;padding:12px 14px;font-weight:700;display:none'; document.body.appendChild(toastEl);
    window.__toasts = [];
    const mesa = window.Mesa.ctx();
    const ctx = { api: mesa.api, esc: mesa.esc, state: { tab: 'videos' }, toast: (m) => { window.__toasts.push(m); toastEl.textContent = m; toastEl.style.display = 'block'; clearTimeout(toastEl._t); toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, 2500); }, render: () => { box.innerHTML = window.Videos.render(ctx); } };
    window.__vdCtx = ctx;
    box.addEventListener('click', (ev) => { const el = ev.target.closest('[data-action]'); if (el && !el.matches('a')) window.Videos.acao(el.dataset.action, el, ctx); });
    ctx.render();
  });
  await p.waitForSelector('[data-vd-card="v3"]', { timeout: 15000 });
}

(async () => {
  await subirServidor();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.abort()); // o upload real nunca é carregado no teste
  await rotasVideos(ctx);
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });

  console.log('1. Lista: um cartão por vídeo, com o estado em português');
  await montarAba(p);
  // textContent (não innerText): as etiquetas usam text-transform e o innerText viria em caixa-alta.
  const texto = await p.evaluate(() => document.getElementById('vd-teste').textContent);
  ok(/Na fila/.test(texto), 'estado "Na fila"');
  ok(/Editando…/.test(texto), 'estado "Editando…"');
  ok(/Pronto para aprovar/.test(texto), 'estado "Pronto para aprovar"');
  ok(/Erro/.test(texto) && /não tem faixa de áudio/.test(texto), 'estado "Erro" com o motivo');
  ok(/Gravar com roteiro/.test(texto) && /Enviar vídeo da galeria/.test(texto), 'botões grandes "Gravar com roteiro" e "Enviar vídeo da galeria"');
  ok(await p.locator('[data-vd-card="v3"] video[controls][playsinline]').count() === 1, 'vídeo pronto tem player <video controls playsinline>');
  ok(/Se o cliente nunca reclama do preço/.test(await p.innerText('[data-vd-card="v3"]')) && /#precificacao/.test(await p.innerText('[data-vd-card="v3"]')), 'legenda do Instagram com hashtags');
  ok(await p.locator('[data-vd-card="v3"] a[download]').count() === 1, 'botão "Baixar" com atributo download');
  ok(await p.locator('[data-vd-card="v3"] [data-action="vd-publicar"]').count() === 1 && await p.locator('[data-vd-card="v3"] [data-action="vd-agendar"]').count() === 1 && await p.locator('[data-vd-card="v3"] [data-action="vd-descartar"]').count() === 1, 'Aprovar e publicar agora / Agendar / Descartar');
  ok(!(await p.locator('[data-vd-card="v1"] [data-action="vd-publicar"]').count()), 'vídeo na fila não tem botão de publicar');
  ok(/Agendados e publicados \(1\)/.test(texto), 'publicado fica na seção "Agendados e publicados"');
  const altura = await p.locator('[data-vd-card="v3"] [data-action="vd-publicar"]').evaluate((e) => e.getBoundingClientRect().height);
  ok(altura >= 48, `botão de publicar com ${Math.round(altura)}px (mínimo 48)`);
  const semLabel = await p.evaluate(() => [...document.querySelectorAll('#vd-teste button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label')).length);
  ok(semLabel === 0, 'todo botão tem texto ou aria-label');
  await p.screenshot({ path: `${SP}/videos-390-lista.png`, fullPage: true });

  console.log('2. Copiar legenda');
  await p.click('[data-vd-card="v3"] [data-action="vd-copiar"]');
  await p.waitForFunction(() => window.__toasts.some((t) => /copiad/i.test(t)));
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(/#pedrodestrava/.test(clip), 'a legenda e as hashtags foram para a área de transferência');

  console.log('3. Refazer com outro estilo e opções');
  await p.click('[data-vd-card="v3"] [data-action="vd-refazer"]');
  await p.waitForSelector('[data-vd-card="v3"] .vd-refazer');
  ok(await p.locator('[data-vd-card="v3"] .vd-estilo').count() === 3, 'seletor com os 3 estilos (hormozi, beast, caixa)');
  ok(await p.locator('[data-vd-card="v3"] input[data-vd-opt]').count() === 4, '4 opções: pausas, muletas, punch-in, b-roll');
  await p.click('[data-vd-card="v3"] [data-action="vd-refazer-estilo"][data-estilo="beast"]');
  await p.waitForFunction(() => document.querySelector('[data-vd-card="v3"] [data-estilo="beast"]')?.getAttribute('aria-pressed') === 'true');
  await p.uncheck('[data-vd-card="v3"] input[data-vd-opt="broll"]');
  await p.screenshot({ path: `${SP}/videos-390-refazer.png`, fullPage: true });
  await p.click('[data-vd-card="v3"] [data-action="vd-refazer-confirmar"]');
  await p.waitForFunction(() => window.__toasts.some((t) => /De volta à fila/.test(t)), null, { timeout: 10000 });
  const ref = chamou('POST', /\/api\/videos\/v3\/refazer$/);
  ok(!!ref, 'chamou POST /api/videos/v3/refazer');
  ok(ref && ref.corpo.estilo === 'beast' && ref.corpo.opcoes.broll === false && ref.corpo.opcoes.remover_pausas === true, `corpo: ${JSON.stringify(ref && ref.corpo)}`);
  await p.waitForFunction(() => /Na fila/.test(document.querySelector('[data-vd-card="v3"]')?.textContent || ''));
  ok(true, 'o cartão voltou para "Na fila" depois de recarregar a lista');

  console.log('4. Agendar e descartar passam por /api/studio/:id/decidir');
  reg.lista = fixtures(); reg.chamadas.length = 0;
  await p.evaluate(() => window.Videos.carregar(window.__vdCtx, true)); await p.waitForSelector('[data-vd-card="v3"] [data-action="vd-agendar"]');
  await p.click('[data-vd-card="v3"] [data-action="vd-agendar"]');
  await p.waitForFunction(() => window.__toasts.some((t) => /Aprovado! Vai ao ar/.test(t)), null, { timeout: 10000 });
  let dec = chamou('POST', /\/api\/studio\/v3\/decidir$/);
  ok(dec && dec.corpo.acao === 'aprovar' && dec.corpo.hash === 'h3' && !dec.corpo.agora, `agendar → {acao:'aprovar', hash, sem agora}: ${JSON.stringify(dec && dec.corpo)}`);
  await p.waitForFunction(() => /Agendado/.test(document.body.textContent));
  reg.lista = fixtures(); reg.chamadas.length = 0;
  await p.evaluate(() => window.Videos.carregar(window.__vdCtx, true)); await p.waitForSelector('[data-vd-card="v3"] [data-action="vd-publicar"]');
  await p.click('[data-vd-card="v3"] [data-action="vd-publicar"]');
  await p.waitForFunction(() => window.__toasts.some((t) => /Publicando no Instagram agora/.test(t)), null, { timeout: 10000 });
  dec = chamou('POST', /\/api\/studio\/v3\/decidir$/);
  ok(dec && dec.corpo.acao === 'aprovar' && dec.corpo.agora === true, 'publicar agora → {acao:\'aprovar\', agora:true}');
  reg.lista = fixtures(); reg.chamadas.length = 0;
  await p.evaluate(() => window.Videos.carregar(window.__vdCtx, true)); await p.waitForSelector('[data-vd-card="v3"] [data-action="vd-descartar"]');
  await p.click('[data-vd-card="v3"] [data-action="vd-descartar"]');
  await p.waitForFunction(() => window.__toasts.some((t) => /descartado/i.test(t)), null, { timeout: 10000 });
  dec = chamou('POST', /\/api\/studio\/v3\/decidir$/);
  ok(dec && dec.corpo.acao === 'descartar' && dec.corpo.hash === 'h3', 'descartar → {acao:\'descartar\', hash}');
  await p.waitForFunction(() => !document.querySelector('[data-vd-card="v3"]'), null, { timeout: 8000 });
  ok(true, 'descartado some da lista');

  console.log('5. Envio da galeria: POST /api/videos → upload (dublê) → POST /:id/enviado');
  reg.lista = fixtures(); reg.chamadas.length = 0;
  await p.evaluate(async () => {
    window.__uploads = [];
    window.__vercelBlobUpload = async (pathname, blob, opts) => { window.__uploads.push({ pathname, tipo: blob.type, tamanho: blob.size, opts: { access: opts.access, handleUploadUrl: opts.handleUploadUrl, multipart: opts.multipart, clientPayload: opts.clientPayload } }); for (const pct of [10, 55, 100]) { opts.onUploadProgress({ percentage: pct, loaded: pct, total: 100 }); await new Promise((r) => setTimeout(r, 120)); } return { url: `https://blob.teste/${pathname}`, pathname, contentType: blob.type }; };
    const blob = new Blob([new Uint8Array(4096)], { type: 'video/mp4' });
    await window.Videos.enviarArquivo(blob, { nome: 'galeria.mp4', titulo: 'Da galeria', roteiro_texto: 'texto lido' }, window.__vdCtx);
  });
  const criou = chamou('POST', /\/api\/videos$/); const enviado = chamou('POST', /\/api\/videos\/v6\/enviado$/);
  ok(criou && criou.corpo.titulo === 'Da galeria' && criou.corpo.roteiro_texto === 'texto lido', 'POST /api/videos com título e roteiro');
  const up = await p.evaluate(() => window.__uploads[0]);
  ok(up && up.pathname === 'videos/v6/origem.mp4' && up.opts.handleUploadUrl === '/api/videos/blob' && up.opts.access === 'public' && up.opts.multipart === true && JSON.parse(up.opts.clientPayload).papel === 'origem', `upload() com pathname videos/<id>/, handleUploadUrl, multipart e clientPayload: ${JSON.stringify(up)}`);
  ok(enviado && enviado.corpo.url === 'https://blob.teste/videos/v6/origem.mp4' && enviado.corpo.tamanho === 4096, 'POST /api/videos/v6/enviado com url, pathname e tamanho');
  ok(/Da galeria/.test(await p.innerText('#vd-teste')), 'o vídeo novo aparece na lista');

  console.log('6. Teleprompter: câmera falsa, contagem, gravação, prévia e envio');
  await p.evaluate(() => window.Teleprompter.abrir({ roteiro: 'Você abriu o MEI, começou a vender e esqueceu de separar o dinheiro da empresa do seu.\n\nEm seis meses, o caixa some e a culpa cai no imposto.\n\nNão é o imposto. É a falta de regra.', titulo: 'O erro que quebra o MEI', ctx: window.__vdCtx }));
  await p.waitForSelector('.tp[data-estado="pronto"]', { timeout: 15000 });
  ok(await p.locator('#tp-cam.espelho').count() === 1 && await p.locator('#tp-cam[playsinline][muted]').count() === 1, 'preview espelhado, mudo e playsinline');
  ok(/Você abriu o MEI/.test(await p.innerText('#tp-texto')), 'roteiro na tela');
  const mime = await p.evaluate(() => window.Teleprompter._st.mime);
  ok(/^video\/(mp4|webm)/.test(mime), `MediaRecorder escolheu "${mime}"`);
  await p.screenshot({ path: `${SP}/videos-390-teleprompter.png` });
  await p.fill('#tp-vel', '60'); await p.locator('#tp-vel').dispatchEvent('input');
  ok((await p.innerText('#tp-vel-out')) === '60', 'velocidade ajustável (20–80 px/s)');
  await p.click('[data-tp="editar"]'); await p.fill('#tp-roteiro-edit', 'Roteiro editado antes de gravar.'); await p.click('[data-tp="salvar-roteiro"]');
  ok(/Roteiro editado antes de gravar/.test(await p.innerText('#tp-texto')), '"Editar roteiro" troca o texto antes de gravar');
  await p.click('#tp-rec');
  await p.waitForSelector('.tp[data-estado="contagem"]');
  ok(!(await p.locator('#tp-contagem').isHidden()), 'contagem 3-2-1 visível');
  await p.waitForSelector('.tp[data-estado="gravando"]', { timeout: 6000 });
  await espera(1800);
  const crono = await p.innerText('#tp-crono');
  ok(/00:0[1-3]/.test(crono), `cronômetro andando (${crono.trim()})`);
  const rolou = await p.evaluate(() => window.Teleprompter._st.pos > 0);
  ok(rolou, 'o roteiro rola enquanto grava');
  await p.click('#tp-roteiro'); ok(await p.evaluate(() => !window.Teleprompter._st.rolando), 'toque no roteiro pausa a rolagem');
  await p.click('#tp-rec');
  await p.waitForSelector('.tp[data-estado="previa"]', { timeout: 8000 });
  const previa = await p.evaluate(() => ({ src: document.querySelector('#tp-video-previa').getAttribute('src') || '', tamanho: window.Teleprompter._st.blob?.size || 0 }));
  ok(previa.src.startsWith('blob:') && previa.tamanho > 0, `prévia com o vídeo gravado (${previa.tamanho} bytes)`);
  ok(await p.locator('[data-tp="regravar"]').count() === 1 && await p.locator('[data-tp="enviar"]').count() === 1, 'botões "Regravar" e "Enviar para edição"');
  await p.screenshot({ path: `${SP}/videos-390-teleprompter-previa.png` });
  reg.chamadas.length = 0;
  await p.click('[data-tp="estilo"][data-estilo="caixa"]');
  await p.click('[data-tp="enviar"]');
  await p.waitForSelector('.tp[data-estado="enviado"]', { timeout: 15000 });
  const criouTp = chamou('POST', /\/api\/videos$/); const enviadoTp = chamou('POST', /\/api\/videos\/v7\/enviado$/);
  ok(criouTp && criouTp.corpo.estilo === 'caixa' && /Roteiro editado/.test(criouTp.corpo.roteiro_texto) && /O erro que quebra/.test(criouTp.corpo.titulo), 'teleprompter envia estilo, roteiro e título ao criar o vídeo');
  ok(!!enviadoTp, 'e registra o envio em /api/videos/:id/enviado');
  await p.waitForFunction(() => !document.querySelector('.tp'), null, { timeout: 5000 });
  ok(true, 'o teleprompter fecha sozinho depois do envio');
  ok(await p.evaluate(() => window.Teleprompter._st.stream === null), 'câmera desligada ao fechar');

  console.log('7. Câmera negada: mensagem clara e saída pela galeria');
  await p.evaluate(() => { window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; }; });
  await p.evaluate(() => window.Teleprompter.abrir({ roteiro: 'x', ctx: window.__vdCtx }));
  await p.waitForSelector('.tp[data-estado="erro_camera"]');
  ok(/Câmera negada/.test(await p.innerText('#tp-erro')), 'explica que a câmera foi negada e como liberar');
  ok(await p.locator('#tp-arquivo').count() === 1, 'oferece gravar/enviar pela câmera do celular (input file)');
  await p.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__gum; window.Teleprompter.fechar(); });

  console.log('8. API sem armazenamento (503): mensagem clara');
  reg.modo503 = true;
  await p.evaluate(() => window.Videos.carregar(window.__vdCtx, true));
  await p.waitForFunction(() => /Armazenamento de vídeos não ligado/.test(document.body.textContent), null, { timeout: 8000 });
  ok(/BLOB_READ_WRITE_TOKEN/.test(await p.innerText('#vd-teste')), 'diz qual variável falta e oferece "Tentar de novo"');
  await p.screenshot({ path: `${SP}/videos-390-sem-blob.png` });
  reg.modo503 = false;

  console.log('9. Desktop 1280×800');
  reg.lista = fixtures();
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.click('[data-action="vd-recarregar"]');
  await p.waitForSelector('[data-vd-card="v3"]');
  const colunas = await p.evaluate(() => getComputedStyle(document.querySelector('.vd-grade')).gridTemplateColumns.split(' ').length);
  ok(colunas >= 2, `grade de cartões no desktop (${colunas} colunas)`);
  await p.screenshot({ path: `${SP}/videos-1280-lista.png`, fullPage: true });
  await p.evaluate(() => window.Teleprompter.abrir({ roteiro: 'Teste no desktop.', titulo: 'Desktop', ctx: window.__vdCtx }));
  await p.waitForSelector('.tp[data-estado="pronto"]', { timeout: 15000 });
  await p.screenshot({ path: `${SP}/videos-1280-teleprompter.png` });
  await p.evaluate(() => window.Teleprompter.fechar());

  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await browser.close();
  await derrubarServidor();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S):\n- ${falhas.join('\n- ')}` : '\nTudo certo.');
  process.exit(falhas.length ? 1 : 0);
})().catch(async (e) => { console.error('ERRO NO TESTE', e); await derrubarServidor(); process.exit(2); });
