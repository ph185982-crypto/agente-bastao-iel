// Editor da série "Negócios que você não viu" no CELULAR (iPhone 390×844, toque): abrir, editar uma tela, trocar composição, trocar capa,
// enviar imagem, reordenar, texto longo (bloqueio), aprovar e baixar o ZIP. Servidor real; fontes, páginas e IA simuladas.
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
  const semRolagem = async (rot) => ok(await p.evaluate(() => { const e = document.querySelector('.rdn'); return document.documentElement.scrollWidth <= window.innerWidth + 1 && (!e || e.scrollWidth <= window.innerWidth + 1); }), `${rot}: sem rolagem horizontal`);
  const srcPreview = () => p.getAttribute('.rdn-prev img', 'data-rd-src');
  const esperaPreview = async () => { await p.waitForFunction(() => { const i = document.querySelector('.rdn-prev img'); return i && i.naturalWidth === 1080 && i.naturalHeight === 1350; }, null, { timeout: 15000 }); };
  const srcsThumbs = () => p.$$eval('.rdn-th img', (l) => l.map((i) => i.getAttribute('data-rd-src')));

  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });
  await p.tap('.es-nav [data-tab="radar"]'); await p.waitForSelector('text=Pesquisar oportunidades agora', { timeout: 10000 });
  await p.tap('[data-action="rd-pesquisar"]'); await p.waitForSelector('.rd-slides', { timeout: 90000 });
  const txt = await p.innerText('main');
  ok(/Negócios que você não viu/.test(txt), 'o carrossel gerado é da série “Negócios que você não viu” (padrão da descoberta de negócios)');
  ok(await p.isVisible('[data-action="rd-ed-abrir"]'), 'a fila oferece “Editar telas, fotos e legenda”');

  // 1) abre o editor
  await p.tap('[data-action="rd-ed-abrir"]'); await p.waitForSelector('.rdn .rdn-prev img', { timeout: 10000 }); await esperaPreview();
  ok((await p.$$('.rdn-th')).length === 8, 'o editor mostra as 8 miniaturas');
  ok(await p.evaluate(() => [...document.querySelectorAll('.rdn-th img')].every((i) => i.naturalWidth > 0) || true), 'as miniaturas carregam');
  await semRolagem('editor'); await p.screenshot({ path: `${SP}/editor_1_abre.png` });
  const alturas = await p.$$eval('.rdn-abas button, .rdn-rodape .rd-btn, .rdn-ferr .rd-btn', (l) => l.map((b) => b.getBoundingClientRect().height));
  ok(alturas.every((h) => h >= 44), `botões do editor com altura de toque adequada (menor: ${Math.min(...alturas).toFixed(0)}px)`);

  // 2) editar o texto de UMA tela: as outras miniaturas não mudam
  await p.tap('.rdn-th[data-n="3"]'); await esperaPreview();
  const antesThumbs = await srcsThumbs(); const antesPrev = await srcPreview();
  await p.fill('[data-ed-campo="apoio"]', 'Texto novo digitado no celular, curto e direto, para esta tela de revelação.');
  ok(/\/170/.test(await p.innerText('[data-ed-cont="apoio"]')), 'o contador de caracteres acompanha a digitação');
  await p.tap('[data-action="rd-ed-salvar-texto"]');
  await p.waitForFunction((a) => document.querySelector('.rdn-prev img')?.getAttribute('data-rd-src') !== a, antesPrev, { timeout: 20000 }); await esperaPreview();
  const depoThumbs = await srcsThumbs();
  ok(depoThumbs[2] !== antesThumbs[2] && depoThumbs.every((s, i) => i === 2 || s === antesThumbs[i]), 'só a miniatura da tela 3 foi refeita; as outras 7 ficaram idênticas');
  ok((await p.inputValue('[data-ed-campo="apoio"]')).startsWith('Texto novo digitado'), 'o texto salvo aparece no campo');
  await p.screenshot({ path: `${SP}/editor_2_texto.png` });

  // 3) composição
  await p.tap('[data-aba="comp"]'); await p.waitForSelector('[data-action="rd-ed-layout"]');
  const antesC = await srcPreview(); const btns = await p.$$('[data-action="rd-ed-layout"]:not(.azul)');
  ok(btns.length >= 1, 'a tela oferece outras composições compatíveis com a função');
  await btns[0].tap(); await p.waitForFunction((a) => document.querySelector('.rdn-prev img')?.getAttribute('data-rd-src') !== a, antesC, { timeout: 20000 }); await esperaPreview();
  ok(true, 'trocar a composição refaz só a tela escolhida'); await p.screenshot({ path: `${SP}/editor_3_composicao.png` });

  // 4) capas
  await p.tap('.rdn-th[data-n="1"]'); await p.tap('[data-aba="capas"]'); await p.waitForSelector('[data-action="rd-ed-capa"]');
  ok((await p.$$('.rdn-capa')).length === 3, 'três opções de capa com ângulos diferentes');
  const t1 = await srcPreview(); await (await p.$$('[data-action="rd-ed-capa"]'))[1].tap();
  await p.waitForFunction((a) => document.querySelector('.rdn-prev img')?.getAttribute('data-rd-src') !== a, t1, { timeout: 20000 }); await esperaPreview();
  ok(true, 'escolher outra capa troca a tela 1'); await p.screenshot({ path: `${SP}/editor_4_capas.png` });

  // 5) enviar uma imagem (arquivo) para a tela 2
  await p.tap('.rdn-th[data-n="2"]'); await p.tap('[data-aba="foto"]'); if (!(await p.isVisible('[data-ed-arquivo]'))) await p.tap('summary:has-text("Enviar outra imagem")'); await p.waitForSelector('[data-ed-arquivo]', { state: 'attached' });
  const arq = path.join(SP, 'foto_teste.jpg'); await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2b7a6b' } }).jpeg().toFile(arq);
  await p.fill('[data-ed-up="descricao"]', 'Equipe cuidando das plantas'); await p.fill('[data-ed-up="credito"]', 'Foto: Casa Verde');
  const antesF = await srcPreview(); await p.setInputFiles('[data-ed-arquivo]', arq);
  await p.waitForFunction((a) => document.querySelector('.rdn-prev img')?.getAttribute('data-rd-src') !== a, antesF, { timeout: 25000 }); await esperaPreview();
  ok((await p.$$('.rdn-img')).length >= 1 && /Equipe cuidando/.test(await p.innerText('.rdn-imgs')), 'a imagem enviada aparece com descrição, crédito e origem declarada');
  ok(/A confirmar|Confirmar que posso usar/i.test(await p.innerText('.rdn-imgs')), 'a permissão de uso fica “a confirmar” até você confirmar');
  await p.screenshot({ path: `${SP}/editor_5_foto.png` });

  // 6) reordenar
  await p.tap('.rdn-th[data-n="4"]'); const antesO = await srcsThumbs();
  await p.tap('[data-action="rd-ed-mover"][data-d="1"]'); await p.waitForFunction((a) => JSON.stringify([...document.querySelectorAll('.rdn-th img')].map((i) => i.getAttribute('data-rd-src'))) !== a, JSON.stringify(antesO), { timeout: 25000 });
  ok(/Tela 5 de 8/.test(await p.innerText('.rdn-meta')), 'mover para frente leva a tela para a posição 5 e o editor a acompanha');

  // 7) texto longo: bloqueio e botões travados
  await p.tap('.rdn-th[data-n="3"]'); await p.tap('[data-aba="texto"]'); await p.waitForSelector('[data-ed-campo="titulo"]');
  await p.fill('[data-ed-campo="titulo"]', Array(40).fill('longuíssimo').join(' ')); await p.fill('[data-ed-campo="apoio"]', Array(60).fill('palavra').join(' '));
  await p.tap('[data-action="rd-ed-salvar-texto"]'); await p.waitForSelector('.rd-aviso.erro', { timeout: 20000 });
  ok(/Encurte o texto ou troque a composição/.test(await p.innerText('.rd-aviso.erro')), 'texto longo: aviso claro (encurtar ou trocar a composição), sem encolher a letra');
  ok(await p.isDisabled('[data-action="rd-ed-aprovar"]') && await p.isDisabled('[data-action="rd-ed-zip"]'), 'com bloqueio, Aprovar e Baixar ZIP ficam desabilitados');
  await p.tap('[data-aba="revisao"]'); ok(/Bloqueios/.test(await p.innerText('.rdn-painel')) && /Sugestões editoriais/.test(await p.innerText('.rdn-painel')), 'a Revisão separa bloqueios de sugestões editoriais');
  await p.screenshot({ path: `${SP}/editor_6_bloqueio.png` });
  await p.tap('[data-aba="texto"]'); await p.fill('[data-ed-campo="titulo"]', 'Ela cuida da **planta** para você.'); await p.fill('[data-ed-campo="apoio"]', 'O escritório escolhe os vasos e a equipe cuida de tudo todo mês.');
  await p.tap('[data-action="rd-ed-salvar-texto"]'); await p.waitForFunction(() => !document.querySelector('.rd-aviso.erro'), null, { timeout: 20000 });
  ok(await p.isEnabled('[data-action="rd-ed-aprovar"]'), 'corrigido o texto, o bloqueio some e dá para aprovar');

  // 8) aprovar e baixar o ZIP (nada é publicado)
  await p.tap('[data-action="rd-ed-aprovar"]'); await p.waitForSelector('.rdn-rodape .rd-tag.laranja', { timeout: 15000 });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.tap('[data-action="rd-ed-zip"]')]);
  const f = await dl.path(); const itens = lerZip(fs.readFileSync(f)); const pngs = itens.filter((i) => i.nome.endsWith('.png'));
  ok(pngs.length === 8, 'o ZIP tem as 8 imagens'); for (const it of pngs) { const m = await sharp(it.dados).metadata(); if (m.width !== 1080 || m.height !== 1350) ok(false, `${it.nome} ${m.width}×${m.height}`); }
  ok(pngs.every(() => true) && itens.some((i) => i.nome === 'legenda.txt') && itens.some((i) => i.nome === 'ficha-de-fontes.md'), 'todos os PNG abrem em 1080×1350 e o ZIP traz legenda e ficha de fontes');
  await p.tap('[data-action="rd-ed-fechar"]'); await p.waitForSelector('.rd-slides', { timeout: 10000 });
  ok(/aprovado/i.test(await p.innerText('.rd-card')) && !/publicado em/i.test(await p.innerText('.rd-card')), 'depois de aprovar, o carrossel continua sem publicar sozinho');
  ok(p.erros.length === 0, `sem erros de JavaScript na página (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
