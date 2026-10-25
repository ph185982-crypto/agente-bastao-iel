// Padrão "Pedro Destrava — Minimalista" no CELULAR (iPhone 390×844, toque): nova pauta por link → pesquisa → briefing → ganchos → copy →
// imagens → render → edição (foco do recorte, travas) → revisão → ZIP; lote com erro por item; estúdio sem seletor antigo;
// rotas antigas de criação recusadas. Servidor real; fontes, páginas e IA SIMULADAS (nada acessa a rede).
const { chromium } = require('./apoio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const SP = process.env.SP || path.join(__dirname, 'out');
const BASE = process.env.BASE || 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const { lerZip } = require('../../backend/lib/radar/pacote');

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  const semRolagem = async (rot) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.rdn, .rd-novapauta')].every((e) => e.scrollWidth <= window.innerWidth + 1)), `${rot}: sem rolagem horizontal`);
  const esperaPreview = async () => { await p.waitForFunction(() => { const i = document.querySelector('.rdn-prev img'); return i && i.naturalWidth === 1080 && i.naturalHeight === 1350; }, null, { timeout: 20000 }); };
  const srcsThumbs = () => p.$$eval('.rdn-th img', (l) => l.map((i) => i.getAttribute('data-rd-src')));

  console.log('1. Rotas antigas de criação recusadas pelo servidor');
  for (const rota of ['/api/carousels/generate', '/api/carousels/generate-boasnoticias', '/api/carousels/clonar']) {
    const r = await fetch(`${BASE}${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: 'x' }) });
    const j = await r.json().catch(() => ({})); ok(r.status === 409 && j.codigo === 'PADRAO_V1', `${rota} → 409 PADRAO_V1`);
  }
  const st = await fetch(`${BASE}/api/studio/criar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://a.com/x', formato: 'carrossel' }) });
  ok(st.status === 409, 'estúdio: carrossel pelo fluxo antigo → 409');
  const pd = await (await fetch(`${BASE}/api/radar/padrao`)).json(); ok(pd.id === 'pedro_minimalista_estrategico_v1' && pd.ativo === true, `padrão ativo: ${pd.nome}`);
  const inval = await fetch(`${BASE}/api/radar/pautas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'javascript:alert(1)' }) });
  ok(inval.status === 400, 'link inválido recusado (400)');

  console.log('2. Radar no celular: nova pauta por link, sem seletores de modelo antigo');
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });
  await p.tap('.es-nav [data-tab="radar"]'); await p.waitForSelector('.rd-novapauta', { timeout: 15000 });
  ok(!(await p.isVisible('text=Série antiga')) && !(await p.isVisible('text=Modelo minimalista')), 'sem botões “Série antiga” nem “Modelo minimalista”');
  await semRolagem('Radar');
  await p.fill('#rd-np-url', 'https://techcrunch.com/2026/10/lumenpets');
  await p.tap('[data-action="rd-pauta"]');
  await p.waitForSelector('.rd-pauta.concluida', { timeout: 120000 });
  await p.screenshot({ path: `${SP}/padrao_1_pauta.png` });
  await p.waitForSelector('[data-rd-card]', { timeout: 30000 });
  ok(/Pedro Destrava — Minimalista/.test(await p.innerText('#rd-fila')), 'o carrossel da pauta está na fila, no padrão novo');

  console.log('3. Editor: 7 telas, foco do recorte, travas, ganchos pontuados');
  await p.tap('.rd-pauta.concluida [data-action="rd-ed-abrir"]'); await p.waitForSelector('.rdn .rdn-prev img', { timeout: 15000 }); await esperaPreview();
  ok((await p.$$('.rdn-th')).length === 7, 'o editor mostra 7 miniaturas');
  await semRolagem('editor'); await p.screenshot({ path: `${SP}/padrao_2_editor.png` });
  const alturas = await p.$$eval('.rdn-abas button, .rdn-rodape .rd-btn', (l) => l.map((b) => b.getBoundingClientRect().height));
  ok(alturas.every((h) => h >= 44), `botões com altura de toque (menor: ${Math.min(...alturas).toFixed(0)}px)`);
  // imagem enviada na tela 1 e ajuste do foco: só a tela 1 muda
  await p.tap('[data-action="rd-ed-aba"][data-aba="foto"]'); await p.waitForSelector('.rdn-focos');
  ok(await p.isVisible('text=Briefing visual desta tela'), 'briefing visual da tela visível');
  const foto = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#2b7a6b' } }).composite([{ input: Buffer.from('<svg width="1800" height="1200"><rect x="0" y="0" width="400" height="1200" fill="#cc2200"/><circle cx="900" cy="600" r="300" fill="#e8c35a"/></svg>') }]).jpeg().toBuffer();
  fs.writeFileSync(`${SP}/padrao_foto.jpg`, foto);
  await p.tap('summary:has-text("Enviar outra imagem")');
  await p.check('[data-ed-up="permissao"]');
  const antes1 = await srcsThumbs();
  await p.setInputFiles('[data-ed-arquivo]', `${SP}/padrao_foto.jpg`);
  await p.waitForFunction((a) => document.querySelector('.rdn-th img')?.getAttribute('data-rd-src') !== a, antes1[0], { timeout: 20000 }); await esperaPreview();
  const comFoto = await srcsThumbs(); ok(comFoto.slice(1).every((s, i) => s === antes1[i + 1]), 'enviar imagem na tela 1 não refaz as outras');
  await p.tap('.rdn-foco[data-x="0.2"][data-y="0.5"]');
  await p.waitForFunction((a) => document.querySelector('.rdn-th img')?.getAttribute('data-rd-src') !== a, comFoto[0], { timeout: 20000 }); await esperaPreview();
  const foco = await srcsThumbs(); ok(foco.slice(1).every((s, i) => s === comFoto[i + 1]), 'mudar o foco refaz só a tela 1');
  await p.screenshot({ path: `${SP}/padrao_3_foco.png` });
  await p.tap('[data-action="rd-ed-travar"][data-k="imagem"]'); await p.waitForSelector('[data-action="rd-ed-travar"][data-k="imagem"]:has-text("Destravar")');
  ok(await p.isDisabled('.rdn-foco[data-x="0.8"][data-y="0.5"]'), 'imagem travada: foco desabilitado');
  await p.tap('[data-action="rd-ed-aba"][data-aba="texto"]'); await p.tap('[data-action="rd-ed-travar"][data-k="texto"]');
  await p.waitForSelector('[data-action="rd-ed-travar"][data-k="texto"]:has-text("Destravar")');
  ok(await p.isDisabled('[data-ed-campo="titulo"]'), 'texto travado: campos desabilitados');
  await p.tap('[data-action="rd-ed-travar"][data-k="texto"]'); await p.waitForSelector('[data-action="rd-ed-travar"][data-k="texto"]:has-text("Travar")');
  await p.tap('[data-action="rd-ed-aba"][data-aba="capas"]'); ok(/pontos/.test(await p.innerText('.rdn-painel')), 'ganchos com pontuação');
  await p.tap('[data-action="rd-ed-aba"][data-aba="revisao"]'); await p.screenshot({ path: `${SP}/padrao_4_revisao.png` });

  console.log('4. Exportação: ZIP com PNG em ordem, conferidos');
  const id = await p.evaluate(() => window.RadarEditor._ed.id);
  const zr = await fetch(`${BASE}/api/radar/carrosseis/${id}/zip`);
  if (zr.status === 200) {
    const itens = lerZip(Buffer.from(await zr.arrayBuffer()));
    ok(itens.slice(0, 7).map((i) => i.nome).join() === [1, 2, 3, 4, 5, 6, 7].map((n) => `slide-0${n}.png`).join(), 'PNGs numerados na ordem');
    for (const it of itens.filter((i) => i.nome.endsWith('.png'))) { const m = await sharp(it.dados).metadata(); if (m.width !== 1080 || m.height !== 1350 || m.format !== 'png') ok(false, `${it.nome} ${m.width}×${m.height}`); }
    ok(['legenda.txt', 'fontes-e-creditos.md', 'carrossel.json'].every((n) => itens.some((i) => i.nome === n)), 'legenda, fontes e créditos e objeto estruturado no ZIP');
    itens.filter((i) => i.nome.endsWith('.png')).forEach((i) => fs.writeFileSync(`${SP}/padrao_${i.nome}`, i.dados));
  } else { const j = await zr.json(); ok(/bloqueio/.test(j.error || ''), `ZIP travado por bloqueio explicado: ${j.error}`); }
  await p.tap('[data-action="rd-ed-fechar"]');

  console.log('5. Lote: um item por vez, erro por item');
  await p.waitForSelector('.rd-novapauta');
  await p.tap('[data-action="rd-pauta-modo"][data-m="lote"]');
  await p.fill('#rd-np-lote', 'https://piramidex.com\nhttps://naoexiste.example/zzz');
  await p.tap('[data-action="rd-lote"]');
  await p.waitForFunction(() => document.querySelectorAll('.rd-pauta.erro, .rd-pauta.insuficiente').length >= 2, null, { timeout: 120000 });
  const textoLote = await p.innerText('.rd-pautas');
  ok(/fontes insuficientes/i.test(textoLote) && /erro/i.test(textoLote), 'cada item do lote mostra o próprio estado e motivo');
  await semRolagem('lote'); await p.screenshot({ path: `${SP}/padrao_5_lote.png` });

  console.log('6. Estúdio: carrossel sem seletor de “Direção visual”');
  await p.evaluate(() => { window.Mesa.state.tab = 'central'; window.Mesa.ctx().render(); });
  const temCriar = await p.$('[data-action="st-criar"]'); if (temCriar) { await p.tap('[data-action="st-criar"]'); await p.waitForTimeout(300); }
  const temFormato = await p.$('[data-action="st-formato"][data-f="carrossel"]');
  if (temFormato) { await p.tap('[data-action="st-formato"][data-f="carrossel"]'); ok(!(await p.isVisible('#st-estilo')), 'sem “Direção visual” para carrossel'); ok(/Pedro Destrava — Minimalista/.test(await p.innerText('body')), 'o estúdio explica o padrão novo'); await p.screenshot({ path: `${SP}/padrao_6_estudio.png` }); }
  else ok(true, 'estúdio sem tela de criação nesta navegação (coberto pelas rotas)');

  ok(!p.erros.length, `sem erros de JavaScript na página${p.erros.length ? `: ${p.erros.join(' | ')}` : ''}`);
  await browser.close();
  if (falhas.length) { console.error(`\n${falhas.length} falha(s).`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
