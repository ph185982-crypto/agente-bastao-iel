// Perfil → Visual dos carrosséis e Recortes: enviar recorte (PNG com transparência), recusar fundo opaco, trocar o visual
// e conferir que o servidor guarda. Servidor real com armazenamento em memória; nada é publicado nem gasto.
const { chromium } = require('./apoio');
const fs = require('fs');
const sharp = require('sharp');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };

(async () => {
  // Silhueta SINTÉTICA com transparência e uma opaca (sem recorte).
  const silhueta = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><ellipse cx="400" cy="330" rx="200" ry="250" fill="#aaa"/><path d="M60 1000 C60 700 220 620 400 620 C580 620 740 700 740 1000Z" fill="#333"/></svg>')).png().toBuffer();
  const opaca = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#345' } }).png().toBuffer();
  fs.writeFileSync(`${SP}/rc_silhueta.png`, silhueta); fs.writeFileSync(`${SP}/rc_opaca.png`, opaca);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  await p.click('summary:has-text("Configurações")').catch(() => {});
  await p.waitForSelector('#rc-secao', { state: 'visible', timeout: 15000 });

  ok(await p.getAttribute('.rc-tema[data-t="reportagem"]', 'aria-pressed') === 'true', 'o visual Reportagem vem escolhido por padrão');
  await p.click('.rc-tema[data-t="avanteza"]');
  await p.waitForFunction(() => document.querySelector('.rc-tema[data-t="avanteza"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  ok((await (await fetch(`${BASE}/api/content/estrategia`)).json()).visual.tema === 'avanteza', 'trocar o visual salva no servidor');
  await p.click('.rc-tema[data-t="reportagem"]');
  await p.waitForFunction(() => document.querySelector('.rc-tema[data-t="reportagem"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });

  // envio de recorte
  await p.click('.rc-novo summary');
  await p.fill('#rc-nome', 'Pessoa de Teste');
  await p.fill('#rc-credito', 'Fotógrafo de Teste');
  await p.setInputFiles('#rc-arquivo', `${SP}/rc_opaca.png`);
  await p.waitForFunction(() => /Escolhido/.test(document.querySelector('#rc-secao')?.innerText || ''), null, { timeout: 10000 });
  await p.click('[data-action="rc-enviar"]');
  await p.waitForSelector('#rc-secao .es-warn', { timeout: 10000 });
  ok(/transparente/i.test(await p.innerText('#rc-secao .es-warn')), 'recorte com fundo opaco é recusado com explicação');
  ok(await p.inputValue('#rc-nome') === 'Pessoa de Teste', 'os campos digitados continuam depois do erro');
  await p.setInputFiles('#rc-arquivo', `${SP}/rc_silhueta.png`);
  await p.waitForFunction(() => /rc_silhueta/.test(document.querySelector('#rc-secao')?.innerText || ''), null, { timeout: 10000 });
  await p.click('[data-action="rc-enviar"]');
  await p.waitForSelector('.rc-item', { timeout: 10000 });
  ok(/Pessoa de Teste/.test(await p.innerText('.rc-lista')) && /Fotógrafo de Teste/.test(await p.innerText('.rc-lista')), 'o recorte aparece na lista com nome e crédito');
  const r = await (await fetch(`${BASE}/api/recortes`)).json();
  ok(r.recortes.length === 1 && r.recortes[0].licenca === 'CC BY 3.0 BR', 'o servidor guardou o recorte com a licença');
  const img = await fetch(`${BASE}/api/recortes/${r.recortes[0].id}/arquivo`);
  ok(img.status === 200 && /image\/png/.test(img.headers.get('content-type')), 'o arquivo do recorte é servido como PNG');
  await p.screenshot({ path: `${SP}/rc_1_perfil.png` });
  await p.click('[data-action="rc-remover"]');
  await p.waitForFunction(() => !document.querySelector('.rc-item'), null, { timeout: 10000 });
  ok((await (await fetch(`${BASE}/api/recortes`)).json()).recortes.length === 0, 'remover tira o recorte da biblioteca');
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
