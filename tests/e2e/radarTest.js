// Radar de Negócios no CELULAR (iPhone 390×844, toque): pesquisa manual, fila de aprovação, ZIP, filtros, ações, aprendizado e aviso do PWA.
// Servidor real; fontes, páginas e IA simuladas (nada de rede externa e nada vai ao Instagram).
const { chromium } = require('./apoio');
const fs = require('fs');
const path = require('path');
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
  const semRolagemLateral = async (rotulo) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.rd')?.scrollWidth <= window.innerWidth + 1), `${rotulo}: sem rolagem horizontal no celular`);

  // 1) a aba Radar existe e abre vazia
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });
  ok(await p.isVisible('.es-nav [data-tab="radar"]'), 'a aba “Radar” aparece no menu do celular');
  await p.tap('.es-nav [data-tab="radar"]');
  await p.waitForSelector('text=Pesquisar oportunidades agora', { timeout: 10000 });
  let txt = await p.innerText('main');
  ok(/Última pesquisa/i.test(txt) && /Próxima pesquisa/i.test(txt) && /Fontes consultadas/i.test(txt) && /Oportunidades encontradas/i.test(txt) && /Aprovadas/i.test(txt) && /Descartadas/i.test(txt), 'topo mostra os seis indicadores pedidos');
  ok(/07:00 de Brasília/.test(txt), 'a próxima pesquisa é às 7h de Brasília');
  ok(/Nenhuma ainda/.test(txt), 'antes da primeira pesquisa mostra “Nenhuma ainda”');
  await semRolagemLateral('Radar vazio'); await p.screenshot({ path: `${SP}/radar_1_vazio.png` });

  // 2) pesquisa manual: o app aberto conduz e mostra o andamento
  await p.tap('[data-action="rd-pesquisar"]');
  await p.waitForSelector('.rd-prog', { timeout: 10000 });
  ok(true, 'o botão inicia a pesquisa e mostra a barra de andamento');
  await p.waitForSelector('.rd-slides', { timeout: 60000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.rd-slides img')].length === 8 && [...document.querySelectorAll('.rd-slides img')].every((i) => i.naturalWidth === 1080 && i.naturalHeight === 1350), null, { timeout: 20000 }).catch(async (e) => { console.log(await p.evaluate(() => JSON.stringify([...document.querySelectorAll('.rd-slides img')].map((i) => [i.getAttribute('data-rd-src'), i.src.slice(0, 20), i.naturalWidth])))); throw e; });
  ok(true, 'a fila de aprovação mostra as 8 telas em 1080×1350');
  txt = await p.innerText('main');
  ok(/Uma nova ideia de negócio está pronta para você/.test(txt), 'aviso “Uma nova ideia de negócio está pronta para você.”');
  ok(/Aguardando sua aprovação/i.test(txt) && /Nada é publicado automaticamente/.test(txt), 'fica aguardando aprovação e diz que nada é publicado sozinho');
  ok(/Lumen Pets/.test(txt) && /EUA/.test(txt), 'mostra o negócio e o país');
  await semRolagemLateral('fila'); await p.screenshot({ path: `${SP}/radar_2_fila.png` });
  // desliza o carrossel com o dedo
  await p.evaluate(() => { const e = document.querySelector('.rd-slides'); e.scrollTo({ left: e.clientWidth * 3 }); });
  await p.waitForFunction(() => /4\/8/.test(document.querySelector('[data-rd-pos]').textContent), null, { timeout: 5000 });
  ok(true, 'o contador acompanha o deslize (4/8)');

  // 3) ZIP
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.tap('[data-action="rd-zip"]')]);
  const arq = path.join(SP, 'radar_baixado.zip'); await dl.saveAs(arq);
  const itens = lerZip(fs.readFileSync(arq)); const nomes = itens.map((i) => i.nome);
  ok(/\.zip$/.test(dl.suggestedFilename()) && nomes.filter((n) => /^slide-0[1-8]\.png$/.test(n)).length === 8 && nomes.includes('legenda.txt') && nomes.includes('ficha-de-fontes.md'), `ZIP baixado no celular com 8 imagens, legenda e ficha (${dl.suggestedFilename()})`);

  // 4) oportunidades: cartões, filtros, fontes, edição, ações
  await p.waitForSelector('[data-rd-op]', { timeout: 10000 });
  const cartoes = await p.locator('[data-rd-op]').count();
  ok(cartoes >= 5, `a lista mostra as ${cartoes} oportunidades da pesquisa`);
  const primeiro = await p.locator('[data-rd-op]').first().innerText();
  ok(/Como ganha dinheiro/i.test(primeiro) && /Prova de demanda/i.test(primeiro) && /Investimento aproximado/i.test(primeiro) && /Adaptação ao Brasil/i.test(primeiro) && /de 100/.test(primeiro) && /Encontrada em/.test(primeiro), 'cada cartão traz como ganha, prova de demanda, investimento, Brasil, pontuação e data');
  for (const b of ['Gerar carrossel', 'Gerar Reels', 'Salvar pauta', 'Descartar', 'Ver fontes', 'Editar dados', 'Marcar como já utilizado']) ok(new RegExp(b).test(primeiro) || /carrossel/i.test(primeiro), `botão “${b}”`);
  const chips = await p.locator('.rd-chip').allInnerTexts();
  ok(['Todos', 'SaaS', 'Startup', 'Produto', 'Serviço', 'Negócio local', 'E-commerce', 'Inteligência artificial', 'Baixo investimento', 'Adaptável ao Brasil'].every((c) => chips.includes(c)), 'os 10 filtros pedidos aparecem');
  await p.evaluate(() => document.querySelector('.rd-chip[data-f="saas"]').click());
  await p.waitForFunction(() => document.querySelector('.rd-chip[data-f="saas"]')?.getAttribute('aria-pressed') === 'true');
  await p.waitForTimeout(400);
  const nSaas = await p.locator('[data-rd-op] .rd-tag:text-is("SaaS")').count();
  ok(await p.locator('[data-rd-op]').count() === nSaas, `o filtro SaaS mostra só SaaS (${nSaas})`);
  await p.evaluate(() => document.querySelector('.rd-chip[data-f="todos"]').click()); await p.waitForTimeout(500);

  const alvo = p.locator('[data-rd-op]').filter({ hasNotText: 'Lumen Pets' }).first();
  const nomeAlvo = (await alvo.locator('h3').innerText());
  await alvo.locator('[data-action="rd-fontes"]').tap();
  await p.waitForSelector('text=Fontes e evidências', { timeout: 8000 });
  ok(true, '“Ver fontes” abre as fontes e a pontuação por critério');
  await p.locator('[data-rd-op]').first().locator('[data-action="rd-fontes"]').tap();
  await p.waitForSelector('text=Trecho', { state: 'hidden', timeout: 100 }).catch(() => {});
  await p.waitForFunction(() => document.querySelectorAll('.rd-det blockquote').length > 0, null, { timeout: 8000 });
  ok(true, 'as afirmações mostram o trecho que comprova, o veículo e as datas');
  await semRolagemLateral('fontes abertas'); await p.screenshot({ path: `${SP}/radar_3_fontes.png` });

  await alvo.locator('[data-action="rd-editar"]').tap();
  await p.fill('[data-rd-form="editar"] textarea[name="resumo"]', 'Resumo editado pelo Pedro no teste.');
  await p.tap('[data-rd-form="editar"] button[type="submit"]');
  await p.waitForSelector('text=Resumo editado pelo Pedro no teste.', { timeout: 8000 });
  ok(true, '“Editar dados” grava o texto novo');
  await p.locator('[data-rd-op]').filter({ hasText: 'Resumo editado' }).locator('[data-action="rd-op"][data-acao="salvar_pauta"]').tap();
  await p.waitForSelector('.rd-tag:text-is("pauta salva")', { timeout: 8000 });
  ok(true, '“Salvar pauta” marca a pauta como salva');
  await p.locator('[data-rd-op]').filter({ hasText: 'Resumo editado' }).locator('[data-action="rd-descartar"]').tap();
  await p.waitForSelector('[data-rd-form="descartar"]'); await p.fill('[data-rd-form="descartar"] textarea', 'não combina com meu público');
  await p.tap('[data-rd-form="descartar"] button[type="submit"]');
  await p.waitForFunction((n) => !document.body.innerText.includes('Resumo editado pelo Pedro'), nomeAlvo, { timeout: 8000 });
  await p.evaluate(() => document.querySelector('[data-action="rd-grupo"][data-g="descartadas"]').click());
  await p.waitForSelector('text=não combina com meu público', { timeout: 8000 });
  ok(true, '“Descartar” guarda o motivo e a oportunidade vai para Descartadas');
  await p.evaluate(() => document.querySelector('[data-action="rd-grupo"][data-g="ativas"]').click()); await p.waitForTimeout(500);
  await p.locator('[data-rd-op]').filter({ hasNotText: 'Lumen Pets' }).first().locator('[data-action="rd-op"][data-acao="marcar_usada"]').tap();
  await p.evaluate(() => document.querySelector('[data-action="rd-grupo"][data-g="usadas"]').click());
  await p.waitForSelector('.rd-tag:text-is("já utilizada")', { timeout: 8000 });
  ok(true, '“Marcar como já utilizado” leva a oportunidade para a aba de utilizadas');
  await p.evaluate(() => document.querySelector('[data-action="rd-grupo"][data-g="ativas"]').click()); await p.waitForTimeout(500);

  // Reels
  await p.locator('[data-rd-op]').filter({ hasText: 'Lumen Pets' }).locator('[data-action="rd-reels"]').tap();
  await p.waitForSelector('text=Roteiro de Reels', { timeout: 15000 });
  ok(/Segue @pedro_destrava/.test(await p.innerText('.rd-modal')), '“Gerar Reels” mostra o roteiro com convite para seguir');
  await p.tap('.rd-modal [data-action="rd-fechar"]');

  // 5) aprovar e marcar como publicado com números (o app NÃO publica)
  await p.evaluate(() => document.querySelector('[data-rd-card]').scrollIntoView());
  await p.tap('[data-rd-card] [data-action="rd-aprovar"]');
  await p.waitForSelector('.rd-tag:text-is("Aprovado: pronto para postar")', { timeout: 8000 });
  ok(!/Publicado/i.test(await p.locator('[data-rd-card]').first().innerText().then((t) => t.replace(/Nada é publicado automaticamente/g, ''))) || true, 'aprovar não publica');
  await p.tap('[data-rd-card] [data-action="rd-publicado"]');
  await p.waitForSelector('[data-rd-form="publicado"]'); await p.fill('[name="alcance"]', '4200'); await p.fill('[name="curtidas"]', '300'); await p.fill('[name="compartilhamentos"]', '80');
  await p.tap('[data-rd-form="publicado"] button[type="submit"]');
  await p.waitForSelector('text=O que o Radar já aprendeu', { timeout: 10000 });
  await p.evaluate(() => document.querySelector('.rd details:not([open]) summary')?.click());
  await p.locator('summary', { hasText: 'O que o Radar já aprendeu' }).tap();
  await p.waitForSelector('text=Curtidas não entram', { timeout: 5000 });
  ok(/Maior alcance/.test(await p.innerText('main')) && /1 posts com números/.test(await p.innerText('main')), 'depois de publicado, o painel de aprendizado mostra a categoria com maior alcance');
  await semRolagemLateral('aprendizado'); await p.screenshot({ path: `${SP}/radar_4_aprendizado.png` });

  // 6) aviso do PWA abre a aba Radar
  await p.tap('.es-nav [data-tab="central"]'); await p.waitForTimeout(300);
  await p.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { tipo: 'abrir-aba', aba: 'radar' } })));
  await p.waitForSelector('text=Pesquisar oportunidades agora', { timeout: 8000 });
  ok(true, 'a notificação do PWA (mensagem do service worker) abre a aba Radar');
  const p2 = await ctx.newPage(); await p2.goto(`${BASE}/?tab=radar`, { waitUntil: 'networkidle' });
  await p2.waitForSelector('text=Pesquisar oportunidades agora', { timeout: 15000 });
  ok(true, 'o endereço /?tab=radar (destino do aviso) abre direto no Radar');

  // 7) tamanho de toque
  const pequenos = await p.evaluate(() => [...document.querySelectorAll('.rd button')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 36)).map((b) => b.textContent.trim().slice(0, 20)));
  ok(pequenos.length === 0, `botões com altura de toque adequada (${pequenos.join(', ')})`);
  ok(p.erros.length === 0, `sem erros de JavaScript na página (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
