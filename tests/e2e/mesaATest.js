// Entrega A no navegador: migração da fila antiga, quarentena, backup, restauração,
// persistência ao recarregar e tela de código. Rode com o backend na porta 3990
// e o staticProxy na 4800 (APP_ACCESS_CODE só no teste de login).
const { chromium } = require('./apoio');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out'); // SP/vendor: react, react-dom, babel (offline)
const BASE = process.env.BASE || 'http://127.0.0.1:4800';
const falhas = [];
const ok = (cond, msg) => { console.log(cond ? '  ✓' : '  ✗', msg); if (!cond) falhas.push(msg); };

async function novaPagina(browser, { token } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await p.route('**/fonts.g*/**', (r) => r.abort());
  await p.route('**/__seed', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>seed</body></html>' }));
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message.slice(0, 200)));
  return { ctx, p };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  console.log('1. Migração da fila antiga e quarentena');
  let { ctx, p } = await novaPagina(browser);
  await p.goto(`${BASE}/__seed`);
  await p.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open('pico-esteira', 1);
    req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('items', { keyPath: 'id' }); db.createObjectStore('assets'); db.createObjectStore('kv'); };
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(['items', 'assets', 'kv'], 'readwrite');
      t.objectStore('items').put({ id: 'old1', title: 'FIXTURE pauta antiga com @ errado', format: 'carrossel', carousel_type: 'antes_agora', status: 'pronto', caption: 'Segue @pedrodestrava que todo dia tem um assim', created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z', assets: [{ type: 'image', name: 'slide-01.png' }], viral: { score: 90 } });
      t.objectStore('items').put({ id: 'old2', title: 'FIXTURE postado', format: 'roteiro', status: 'postado', caption: 'ok', posted_at: '2026-10-14T10:00:00Z', metrics: { views: 10, likes: 2, manual: true } });
      t.objectStore('assets').put([{ type: 'image', name: 'slide-01.png', blob: new Blob(['x'], { type: 'image/png' }) }], 'old1');
      t.objectStore('kv').put({ seguidores: 1758, top: [] }, 'insights');                 // sem origem de conta
      t.objectStore('kv').put({ list: [{ id: 'p1', title: 'pauta antiga' }], at: 1 }, 'pautas');
      t.objectStore('kv').put({ pillars: ['x'] }, 'config');
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
    };
  }));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForSelector('.es-nav');
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 15000 });
  const lista = await p.evaluate(() => window.Mesa.state.contents.map((c) => ({ id: c.id, status: c.status, legado: !!c.legado, titulo: c.titulo })));
  ok(lista.length === 2, `2 itens migrados (veio ${lista.length})`);
  ok(lista.find((c) => c.id === 'legacy_old1')?.status === 'rascunho', 'item "pronto" da fila antiga virou rascunho (não aprovado)');
  ok(lista.find((c) => c.id === 'legacy_old2')?.status === 'publicado', 'item postado virou publicado');
  const q = await p.evaluate(() => window.Mesa.state.quarentena.map((x) => x.origem));
  ok(q.includes('kv:insights') && q.includes('kv:pautas'), `insights e pautas sem origem foram para a quarentena (${q.join(', ')})`);
  const kvRestante = await p.evaluate(() => window.Store._raw.get('kv', 'insights'));
  ok(kvRestante === undefined, 'insights sem origem não está mais em uso');
  const antigosIntactos = await p.evaluate(async () => (await window.Store._raw.getAll('items')).length);
  ok(antigosIntactos === 2, 'a fila antiga continua intacta no banco (reversível)');
  const bk = await p.evaluate(() => window.Mesa.state.backups.map((b) => b.motivo));
  ok(bk.includes('antes da migração'), `backup automático antes da migração (${bk.join(', ')})`);
  const textoMesa = await p.locator('.es-main').innerText();
  ok(/@ errado na legenda/.test(textoMesa), 'a lista mostra o alerta de @ errado');
  ok(/Isolei 2 dado/.test(textoMesa), 'a Mesa avisa que isolou dados');
  await p.screenshot({ path: `${SP}/a_mesa.png` });

  console.log('2. Item legado: nada de selo, nada de aprovação');
  await p.click('[data-action="abrir"][data-id="legacy_old1"]');
  const det = await p.locator('.es-main').innerText();
  ok(/antes da base de evidências/.test(det), 'aviso de que não foi verificado');
  ok(/@pedrodestrava/.test(det) === false || /@ errado/.test(det), 'alerta do @ errado no detalhe');
  await p.screenshot({ path: `${SP}/a_legado.png` });
  await p.click('[data-action="voltar"]');

  console.log('3. Persistência: criar conteúdo, recarregar, continua lá');
  await p.evaluate(async () => {
    const ctx = window.Mesa.ctx();
    const c = ctx.criarConteudoDeFonte({ url: 'https://exemplo.test/m', titulo: 'FIXTURE de persistência' });
    ctx.M.criarVersao(c, { slides: [{ id: 's1', layout: 'explicacao', texto: 'texto' }], legenda: 'l', cta: 'c' }, { quem: 'pedro', rotulo: 'v1' });
    await ctx.persistir(c);
    window.__idTeste = c.id;
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto);
  const apos = await p.evaluate(() => window.Mesa.state.contents.find((c) => c.titulo === 'FIXTURE de persistência')?.copia.versoes.length);
  ok(apos === 1, 'conteúdo e versão sobreviveram ao recarregar');

  console.log('4. Backup, exclusão e restauração');
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-action="exportar-backup"]')]);
  const arquivo = `${SP}/backup_teste.json`;
  await dl.saveAs(arquivo);
  const json = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  ok(json.formato === 'pico-backup' && json.conteudos.length === 3, `arquivo de backup com 3 conteúdos (${json.conteudos.length})`);
  ok(json.conta.username === 'pedro_destrava', 'backup identifica a conta');
  await p.evaluate(async () => { for (const c of await window.Store.listar()) await window.Store._raw.del('contents', c.id); });
  ok((await p.evaluate(() => window.Store.listar().then((l) => l.length))) === 0, 'conteúdos apagados (simulando perda)');
  await p.setInputFiles('#import-backup', arquivo);
  await p.waitForFunction(() => window.Mesa.state.resultadoImport);
  const r = await p.evaluate(() => window.Mesa.state.resultadoImport);
  ok(r.adicionados === 3, `importação restaurou 3 (${JSON.stringify(r)})`);
  // restaurar um backup mais antigo não sobrescreve o que é mais novo
  await p.evaluate(async () => { window.__idTeste = (await window.Store.listar()).find((c) => c.titulo === 'FIXTURE de persistência').id; });
  await p.evaluate(async () => { const c = await window.Store.obter(window.__idTeste); c.titulo = 'FIXTURE editado depois'; await window.Store.salvar(c); });
  await p.setInputFiles('#import-backup', arquivo);
  await p.waitForTimeout(600);
  const t = await p.evaluate(() => window.Store.obter(window.__idTeste).then((c) => c.titulo));
  ok(t === 'FIXTURE editado depois', 'importar backup antigo não sobrescreve versão mais nova');
  await p.screenshot({ path: `${SP}/a_ajustes.png`, fullPage: false });

  console.log('5. Conta e leitura');
  const txt = await p.locator('.es-main').innerText();
  ok(/@pedro_destrava/.test(txt) && /id 74541076144/.test(txt), 'Ajustes mostra a conta fixa e o id');
  ok(/Acesso sem senha/.test(txt), 'avisa que o acesso está sem senha quando não há código');
  ok(p.erros.length === 0, `sem erros de página (${p.erros.join(' | ')})`);
  await ctx.close();

  console.log('6. Tela de código (backend com APP_ACCESS_CODE)');
  if (process.env.LOGIN_BASE) {
    ({ ctx, p } = await novaPagina(browser));
    await p.goto(`${process.env.LOGIN_BASE}/`, { waitUntil: 'networkidle' });
    await p.waitForSelector('#pico-login', { timeout: 10000 });
    ok(true, 'tela de código aparece sem token');
    await p.fill('#pico-code', 'errado');
    await p.click('#pico-login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#pico-login-err')?.textContent.length > 0);
    ok(/incorreto/i.test(await p.locator('#pico-login-err').innerText()), 'código errado é recusado');
    await p.fill('#pico-code', process.env.LOGIN_CODE);
    await p.click('#pico-login button[type=submit]');
    await p.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForSelector('.es-nav', { timeout: 15000 });
    await p.waitForSelector('#pico-login', { state: 'detached', timeout: 15000 }).catch(() => {});
    ok((await p.locator('#pico-login').count()) === 0, 'código certo entra e a tela some');
    const st = await p.evaluate(async () => (await fetch('/api/queue/config')).status);
    ok(st === 200, 'chamadas /api seguintes levam o token');
    await ctx.close();
  }

  await browser.close();
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ${falhas.join('\n- ')}` : '\nTudo certo.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
