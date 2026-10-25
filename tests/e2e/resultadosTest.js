// Aba Resultados (Meu Instagram) no navegador. Servidor real, Meta SIMULADA com métricas de teste.
// Nada vai ao Instagram de verdade e a rota só faz leituras.
const { chromium } = require('./apoio');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const graph = async (corpo) => (await fetch(`${BASE}/__teste/graph`, corpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : undefined)).json();
const h = (n) => new Date(Date.now() - n * 3600000).toISOString();

(async () => {
  const midias = []; const insights = {};
  const add = (id, tipo, horas, ins) => { midias.push({ id, media_type: tipo === 'reel' ? 'VIDEO' : tipo === 'carrossel' ? 'CAROUSEL_ALBUM' : 'IMAGE', media_product_type: tipo === 'reel' ? 'REELS' : 'FEED', permalink: `https://www.instagram.com/p/${id}/`, timestamp: h(horas), caption: `Legenda de teste ${id}` }); insights[id] = ins; };
  for (let i = 0; i < 6; i++) add(`media_c${i}`, 'carrossel', 200 + i * 24, { reach: 4000 + i * 500, saved: 8, shares: 12 + i, total_interactions: 90, views: 8000, follows: i === 0 ? 40 : 0, profile_visits: 20 });
  add('media_c9', 'carrossel', 400, { reach: 300000, saved: 900, shares: 6000, total_interactions: 9000, views: 280000, follows: 250, profile_visits: 380 });
  for (let i = 0; i < 2; i++) add(`media_r${i}`, 'reel', 300 + i * 24, { reach: 9000, saved: 12, shares: 50, total_interactions: 200, views: 15000 });
  add('media_novo', 'imagem', 4, { reach: 150 });
  await graph({ midias, insights });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });
  await p.click('[data-action="tab"][data-tab="resultados"]');
  await p.waitForSelector('text=Ainda não li seus posts', { timeout: 10000 });
  ok(true, 'aba Resultados abre vazia e explica que a leitura é só leitura');
  await p.screenshot({ path: `${SP}/r_1_vazio.png` });

  await p.click('[data-action="ig-atualizar"]');
  await p.waitForSelector('.ig-grande', { timeout: 15000 });
  const txt = await p.innerText('main');
  ok(/166\.772/.test(txt), 'mostra os seguidores da conta (pt-BR)');
  ok(/Carrossel/.test(txt) && /Reel/.test(txt), 'mostra formatos');
  ok(/amostra pequena \(2\)/.test(txt), 'Reel com 2 posts vem marcado como amostra pequena');
  ok(/não informa para este formato/.test(txt), 'Reel: seguidor ganho aparece como indisponível, não zero');
  ok(/trouxeram|concentram/i.test(txt), 'aponta a concentração de seguidores');
  ok(/menos de 72 h/.test(txt), 'post de 4 h fica fora das comparações e isso é dito');
  ok(!/vencedor/i.test(txt), 'nenhuma tela declara vencedor');
  ok(/Atualizado/.test(txt), 'mostra quando foi atualizado');
  const estado = await graph();
  ok(estado.n_media_publish === 0 && estado.n_containers === 0, 'a rota só leu: nada foi publicado nem criado na Meta');
  ok(p.erros.length === 0, `sem erros de JavaScript na página (${p.erros.join(' | ')})`);
  await p.screenshot({ path: `${SP}/r_2_painel.png`, fullPage: false });
  await p.evaluate(() => document.querySelector('.es-main').scrollTo(0, 900));
  await p.screenshot({ path: `${SP}/r_3_rolando.png` });

  // reabre: o painel já vem pronto do servidor, sem nova leitura
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });
  await p.click('[data-action="tab"][data-tab="resultados"]');
  await p.waitForFunction(() => /Resultados/.test(document.querySelector('main')?.innerText || '') && !/Abrindo seus resultados/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 10000 });
  ok(true, 'ao reabrir, o painel abre sem erro');
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
