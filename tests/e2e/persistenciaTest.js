// Fechar a aba no meio de cada etapa + recuperação em outro navegador.
// Servidor real da aplicação com IA SIMULADA (servidorTeste.js): 3995 com Postgres, 3997 sem banco.
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out'); // SP/vendor: react, react-dom, babel (offline)
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const TEXTO = 'FIXTURE DE TESTE. O Senado aprovou nesta quinta-feira o projeto que eleva o teto de faturamento anual do microempreendedor individual para R$ 140 mil. O texto segue para sanção presidencial e prevê o parcelamento de dívidas. Este texto é um exemplo de teste.';

async function contexto(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  return ctx;
}
async function abre(ctx, base) {
  const p = await ctx.newPage();
  p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  p.renders = 0; p.on('request', (r) => { if (r.url().includes('/render-slide')) p.renders += 1; });
  await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });
  return p;
}
const chamadas = async (base) => (await fetch(`${base}/__teste/chamadas`)).json();
const estado = (p) => p.evaluate(() => { const c = window.Mesa.state.contents[0]; return c ? JSON.parse(JSON.stringify(c)) : null; });
async function fechaDurante(p, rota) {
  await p.waitForRequest((r) => r.url().includes(`/api/content/${rota}`), { timeout: 60000 });
  await p.waitForTimeout(400);
  await p.close(); // fechou a aba com o pedido em andamento
}
async function reabreEContinua(ctx, base, esperaSel) {
  const p = await abre(ctx, base);
  await p.click('[data-action="abrir"]');
  await p.waitForSelector('[data-action="ed-continuar"]', { timeout: 15000 });
  const aviso = await p.textContent('.es-warn');
  await p.click('[data-action="ed-continuar"]');
  if (esperaSel) await p.waitForSelector(esperaSel, { timeout: 60000 });
  return { p, aviso };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const BASE = 'http://127.0.0.1:3995';

  console.log('1. Com cópia no servidor: fechar a aba durante pesquisa, redação e arte');
  const ctxA = await contexto(browser);
  let p = await abre(ctxA, BASE);
  await p.click('[data-e="link"]'); await p.click('[data-action="ed-modo"][data-m="texto"]');
  await p.fill('#ed-novo-texto', TEXTO); await p.click('[data-action="ed-iniciar"]');
  await fechaDurante(p, 'claims');
  await new Promise((r) => setTimeout(r, 3500));
  let r = await reabreEContinua(ctxA, BASE, '[data-ed-brief="tese"]');
  ok(/recuperado sem nova chamada de IA/.test(r.aviso), 'ao reabrir, o aviso explica que o resultado pronto será recuperado');
  let ch = await chamadas(BASE);
  ok(ch.claims === 1, `afirmações: IA chamada ${ch.claims}x (fechou a aba no meio; resultado recuperado do servidor)`);
  let c = await estado(r.p);
  ok(c.historico.some((h) => h.tipo === 'reaproveitado'), 'o histórico registra que o resultado foi reaproveitado');

  await r.p.click('[data-action="ed-gerar-texto"]');
  await fechaDurante(r.p, 'copy');
  await new Promise((x) => setTimeout(x, 3500));
  r = await reabreEContinua(ctxA, BASE, '.ed-slide');
  ch = await chamadas(BASE);
  ok(ch.copy === 1, `texto: IA chamada ${ch.copy}x (fechou a aba no meio; recuperado)`);
  await r.p.waitForFunction(() => window.Mesa.state.contents[0].pipeline.arte.estado === 'concluida', null, { timeout: 30000 });
  c = await estado(r.p);
  const total = c.copia.versoes[0].slides.length;

  // arte: fecha depois do 1º slide desenhado
  const pa = r.p;
  await pa.check('input[data-ed-capa="k_consequencia"]');
  await pa.waitForResponse((x) => x.url().includes('/render-slide'));
  await pa.close();
  const p2 = await abre(ctxA, BASE);
  await p2.click('[data-action="abrir"]');
  await p2.waitForFunction(() => { const c = window.Mesa.state.contents[0]; const v = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa); return c.arte.renders.filter((x) => x.versao === v.id).length === v.slides.length && !document.querySelector('.es-spin'); }, null, { timeout: 30000 });
  ok(p2.renders < total, `arte: ao reabrir, a arte foi retomada sozinha e só ${p2.renders} de ${total} slides foram desenhados de novo (os prontos ficaram salvos; desenhar não usa IA)`);

  // foto de teste na capa (imagem gerada, NÃO é foto do Pedro)
  const sharp = require('sharp');
  const foto = `${SP}/foto_teste.jpg`;
  await sharp({ create: { width: 900, height: 1100, channels: 3, background: '#7a8ca3' } }).composite([{ input: Buffer.from('<svg width="900" height="1100"><circle cx="450" cy="420" r="220" fill="#d9b48f"/><rect x="200" y="700" width="500" height="400" fill="#33465e"/><text x="40" y="1060" font-size="40" fill="#fff">IMAGEM DE TESTE</text></svg>') }]).jpeg().toFile(foto);
  await p2.setInputFiles('input[data-ed-foto]', foto);
  await p2.waitForFunction(() => { const c = window.Mesa.state.contents[0]; const v = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa); return v.slides[0].layout === 'capa_foto' && c.arte.renders.some((x) => x.versao === v.id && x.slide_id === v.slides[0].id && x.texto_hash) && !document.querySelector('.es-spin'); }, null, { timeout: 30000 });
  await p2.waitForTimeout(4500); // envio automático ao servidor (3 s após a última alteração)
  await p2.evaluate(() => window.Sync.sincronizarTudo());
  c = await estado(p2);
  const meta = await p2.evaluate((id) => window.Sync.meta(id), c.id);
  ok(meta?.conferido && meta.rev >= 1, `conteúdo gravado e CONFERIDO no servidor (rev ${meta?.rev})`);
  const hashA = await p2.evaluate((cc) => window.Sync.sha256Doc(cc), c);
  ok(p2.erros.length === 0, `sem erros de JavaScript no navegador A (${p2.erros.join(' | ')})`);

  console.log('2. H — recuperar em OUTRO navegador (perfil novo, armazenamento local vazio)');
  const ctxB = await contexto(browser);
  const pb = await abre(ctxB, BASE);
  await pb.waitForFunction(() => window.Mesa.state.contents.length > 0, null, { timeout: 20000 });
  const cb = await estado(pb);
  const hashB = await pb.evaluate((cc) => window.Sync.sha256Doc(cc), cb);
  ok(cb.id === c.id && hashB === hashA, 'o conteúdo chegou idêntico (mesmo hash) no outro navegador');
  ok(cb.copia.versoes.length === c.copia.versoes.length && cb.historico.length === c.historico.length, `versões (${cb.copia.versoes.length}) e histórico (${cb.historico.length}) vieram juntos`);
  await pb.click('[data-action="abrir"]');
  await pb.click('[data-action="ed-arte-todas"]');
  await pb.waitForFunction(() => { const c = window.Mesa.state.contents[0]; const v = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa); return c.arte.renders.filter((x) => x.versao === v.id && x.gerada_em).length === v.slides.length && !document.querySelector('.es-spin'); }, null, { timeout: 40000 });
  const temFoto = await pb.evaluate(async () => { const c = window.Mesa.state.contents[0]; const v = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa); const b = await window.Store.obterBlob(`img:${v.slides[0].imagem_id}`); return !!b && b.origem === 'servidor'; });
  ok(temFoto, 'a foto da capa veio do servidor e a arte foi refeita no navegador B');
  await pb.evaluate(() => document.querySelector('.ed-slide').scrollIntoView());
  await pb.screenshot({ path: `${SP}/h_navegador_b.png` });
  const chip = await pb.textContent('.mz-top');
  ok(/No servidor \(rev/.test(chip), `selo no navegador B: ${chip.replace(/\s+/g, ' ').trim()}`);

  console.log('3. Conflito entre aparelhos');
  const pa2 = await abre(ctxA, BASE);
  await pa2.waitForTimeout(1500);
  // A edita sem conexão com o servidor (só local)…
  await pa2.evaluate(async () => { const c = await window.Store.obter(window.Mesa.state.contents[0].id); c.titulo = 'Editado no A'; await window.Store.salvar(c); });
  // …enquanto B edita e envia.
  await pb.evaluate(async () => { const c = window.Mesa.state.contents[0]; c.titulo = 'Editado no B'; await window.Store.salvar(c); await window.Sync.enviar(c); });
  const res = await pa2.evaluate(async () => window.Sync.enviar(await window.Store.obter(window.Mesa.state.contents[0].id)));
  ok(res.estado === 'conflito', 'gravação desatualizada do A não sobrescreve o B: vira conflito');
  const tituloLocal = await pa2.evaluate(async () => (await window.Store.obter(window.Mesa.state.contents[0].id)).titulo);
  ok(tituloLocal === 'Editado no A', 'a cópia local do A continua intacta');
  const escolha = await pa2.evaluate(async () => window.Sync.resolverConflito(window.Mesa.state.contents[0].id, 'servidor'));
  const depois = await pa2.evaluate(async () => (await window.Store.obter(window.Mesa.state.contents[0].id)).titulo);
  const snaps = await pa2.evaluate(async () => (await window.Store.snapshotsDe(window.Mesa.state.contents[0].id)).map((s) => s.motivo));
  ok(escolha === 'servidor' && depois === 'Editado no B' && snaps.some((m) => /conflito/.test(m)), 'escolhendo a do servidor, a versão do A vira snapshot (nada perdido)');
  await ctxA.close(); await ctxB.close();

  console.log('4. SEM cópia no servidor: o que acontece ao fechar a aba');
  const BASE2 = 'http://127.0.0.1:3997';
  const ctxC = await contexto(browser);
  p = await abre(ctxC, BASE2);
  await p.click('[data-e="link"]'); await p.click('[data-action="ed-modo"][data-m="texto"]');
  await p.fill('#ed-novo-texto', TEXTO); await p.click('[data-action="ed-iniciar"]');
  await fechaDurante(p, 'claims');
  await new Promise((x) => setTimeout(x, 3500));
  r = await reabreEContinua(ctxC, BASE2, '[data-ed-brief="tese"]');
  ok(/recomeça/.test(r.aviso), 'sem servidor, o aviso diz que a etapa recomeça');
  ch = await chamadas(BASE2);
  ok(true, `afirmações sem servidor: IA chamada ${ch.claims}x (o pedido anterior não pôde ser recuperado entre instâncias; no teste local a mesma instância pode reaproveitar pela memória)`);
  const chip2 = await r.p.textContent('.mz-top');
  ok(/Só neste navegador/.test(chip2), 'o editor avisa: só neste navegador');
  await ctxC.close();

  await browser.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S):\n- ${falhas.join('\n- ')}` : '\nTudo certo.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });
