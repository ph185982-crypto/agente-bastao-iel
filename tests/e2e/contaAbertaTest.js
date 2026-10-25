// "Conta aberta" no navegador: formulário, erro quando os números não fecham, prova criada com arte e
// pronta para aprovar, nome omitido sem autorização. Servidor real; nada é publicado.
const { chromium } = require('./apoio');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });

  await p.click('[data-action="tab"][data-tab="mesa"]');
  await p.click('[data-action="ca-abrir"]');
  await p.waitForSelector('#ca-faturamento', { timeout: 10000 });
  ok(true, 'o caminho Criar → Conta aberta abre o formulário');

  const preenche = async (v) => { for (const [k, val] of Object.entries(v)) { const el = await p.$(`#ca-${k}`); if (!el) continue; await el.fill(String(val)); } };
  await preenche({ periodo: 'set/2026', canal: 'Shopee', categoria: 'moda', faturamento: '120000', comissao: '24000', frete: '9000', imposto: '7200', ads: '12000', outros: '55000', sobrou: '50000', cliente: 'Loja Segredo Ltda' });
  await p.click('[data-action="ca-criar"]');
  await p.waitForSelector('.es-errbox', { timeout: 10000 });
  ok(/não fecham/.test(await p.innerText('.es-errbox')), 'números que não fecham: mensagem com as contas, nada é criado');
  ok(await p.evaluate(() => window.Mesa.state.contents.every((c) => !/Conta aberta/.test(c.titulo))), 'nenhum conteúdo foi criado com números errados');
  await p.screenshot({ path: `${SP}/c_1_erro.png` });

  await p.fill('#ca-sobrou', '12800');
  await p.click('[data-action="ca-criar"]');
  await p.waitForFunction(() => window.Mesa.state.contents.some((c) => /Conta aberta/.test(c.titulo)), null, { timeout: 30000 });
  await p.waitForFunction(() => { const c = window.Mesa.state.contents.find((x) => /Conta aberta/.test(x.titulo)); const v = c && window.ContentModel.versaoAtiva(c); return v && v.slides.every((sl) => c.arte.renders.some((r) => r.slide_id === sl.id && r.versao === v.id)); }, null, { timeout: 60000 });
  const info = await p.evaluate(() => {
    const M = window.ContentModel; const G = window.QualityGates;
    const c = window.Mesa.state.contents.find((x) => /Conta aberta/.test(x.titulo)); const v = M.versaoAtiva(c);
    const g = G.avaliar(c, { conta: M.ACCOUNT_PIN });
    return { titulo: c.titulo, slides: v.slides.length, cta: v.cta, bloqueios: g.bloqueios.map((b) => b.id), pode: g.resumo.pode_aprovar, tudo: JSON.stringify(c), cabem: c.arte.renders.every((r) => r.metrics?.cabe !== false), legenda: v.legenda };
  });
  ok(/Loja de moda/.test(info.titulo) && !/Segredo/.test(info.tudo), 'sem autorização, o nome do cliente não aparece nem é guardado');
  ok(info.slides >= 6 && info.cabem, `a arte dos ${info.slides} slides foi gerada e todo texto cabe`);
  ok(/Comenta PRECO/.test(info.cta) === false, 'sem link na isca, não há chamada com promessa (CTA vazio)');
  ok(info.bloqueios.length === 0 && info.pode, `a revisão libera a aprovação (bloqueios: ${JSON.stringify(info.bloqueios)})`);
  ok(/sem auditoria independente/.test(info.legenda), 'a legenda avisa que os dados não foram auditados');
  await p.screenshot({ path: `${SP}/c_2_editor.png` });
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
