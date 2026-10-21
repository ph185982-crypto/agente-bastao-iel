// Central de aprovação + publicação no navegador. Servidor real da aplicação (Postgres), IA simulada
// e META SIMULADA (servidorTeste.js com GRAPH_FALSA=1). Nada vai ao Instagram de verdade.
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const graph = async (corpo) => (await fetch(`${BASE}/__teste/graph`, corpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : undefined)).json();

async function nova(browser, ctxExistente) {
  const ctx = ctxExistente || await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (!ctxExistente) await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  if (!ctxExistente) await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });
  return { ctx, p };
}

// Conteúdo pronto para aprovar (FIXTURE identificada), com a arte gerada pelo servidor de verdade.
async function criaConteudo(p, titulo) {
  const id = await p.evaluate(async (titulo) => {
    const M = window.ContentModel; const x = window.Mesa.ctx();
    const c = M.novoConteudo({ titulo, origem: { tipo: 'texto', texto_bruto: 'FIXTURE' } });
    c.fonte_principal = { tipo: 'artigo', url: 'https://exemplo.test/m', titulo: 'Salário mínimo em 1994', veiculo: 'Exemplo', dominio: 'exemplo.test', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79 segundo o Banco Central.' };
    c.claims = [{ id: 'a1', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79.', tipo: 'fato', natureza: 'dado', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [{ valor: 64.79, unidade: 'BRL' }], revisao: {} }];
    c.evidencias = [{ id: 'e1', tipo: 'primaria', autoridade: 'primaria', correspondencia: 'integral', trecho: 'Salário mínimo jul/1994: 64,79', origem: 'BCB SGS 1619', relacao: 'sustenta', titulo: 'x', consultada_em: '2026-10-17T10:00:00Z' }];
    M.criarVersao(c, { estrutura: 'antes_depois', capa_escolhida: 'k1', capas: [{ id: 'k1', foco: 'acontecimento', texto: 'Em julho de 1994 o salário mínimo era **R$ 64,79**.', claim_ids: ['a1'] }],
      slides: [{ id: 's1', layout: 'capa_tipografica', funcao: 'capa', texto: 'Em julho de 1994 o salário mínimo era **R$ 64,79**.', claim_ids: ['a1'] }, { id: 's2', layout: 'prova', funcao: 'prova', texto: 'O valor vem do **Banco Central**.', fonte_linha: 'Fonte: BCB SGS 1619 · consultada em 17/10/2026', claim_ids: ['a1'] }],
      legenda: 'O salário mínimo em julho de 1994 era de R$ 64,79. Fonte: Banco Central.', cta: 'Siga para mais.', hashtags: ['#economia'], legenda_claim_ids: ['a1'], formato: 'carrossel' }, { quem: 'ia', rotulo: 'FIXTURE' });
    c.status = 'em_revisao';
    c.pipeline = Object.fromEntries(Object.keys(c.pipeline).map((k) => [k, { estado: 'concluida' }]));
    await x.persistir(c);
    await window.MesaEditor._internos.atualizarArte(x, c);
    return c.id;
  }, titulo);
  return id;
}
const abaCentral = async (p, aba) => { await p.click('[data-action="tab"][data-tab="central"]'); await p.click(`[data-action="cn-aba"][data-aba="${aba}"]`); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  let { ctx, p } = await nova(browser);

  console.log('1. Ajustes → Conexões');
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  await p.waitForFunction(() => /Instagram conectado/.test(document.body.textContent), null, { timeout: 15000 });
  const aj = await p.textContent('.es-main');
  ok(/Instagram conectado: @pedro_destrava/.test(aj), 'mostra @pedro_destrava conectado (id conferido)');
  ok(/Token válido/.test(aj) && /expira em 20/.test(aj), 'token válido e data de expiração');
  ok(/Cota da Meta hoje: 2 de 100/.test(aj), 'cota de hoje lida da Meta');
  ok(!/TOKEN_FALSO|segredo-app/.test(await p.content()), 'nenhum segredo aparece na tela');
  await p.screenshot({ path: `${SP}/c_1_conexoes.png` });

  console.log('2. Para aprovar, badge e pausa');
  const id1 = await criaConteudo(p, 'FIXTURE carrossel 1');
  await p.click('[data-action="tab"][data-tab="central"]');
  await p.waitForSelector('[data-cn]');
  ok(await p.locator('.es-nav .es-badge').textContent() === '1', 'badge do menu mostra 1 item para aprovar');
  ok(await p.locator('.cn-carrossel img').count() === 2, 'carrossel navegável com os 2 slides');
  await p.waitForFunction(() => [...document.querySelectorAll('.cn-carrossel img')].every((i) => i.naturalWidth > 0));
  ok(/Para aprovar \(1\)/.test(await p.textContent('.cn-abas')), 'aba "Para aprovar (1)"');
  const alturaBotao = await p.locator('[data-action="cn-aprovar"]').evaluate((e) => e.getBoundingClientRect().height);
  ok(alturaBotao >= 48, `botão de aprovar com ${Math.round(alturaBotao)}px (mínimo 48)`);
  await p.screenshot({ path: `${SP}/c_2_central.png` });

  await p.check('[data-cn-pausa]');
  await p.waitForFunction(() => /Ligado: aprovar não envia/.test(document.body.textContent));
  await p.click('[data-action="cn-aprovar"]');
  await p.waitForFunction((id) => window.Mesa.state.contents.find((c) => c.id === id).status === 'aprovado', id1);
  let g = await graph();
  ok(g.n_containers === 0 && g.n_media_publish === 0, 'pausado: aprovou e NÃO falou com a Meta');
  await abaCentral(p, 'publicando');
  ok(/Aprovado/.test(await p.textContent('.cn-card')) && /pausadas/.test(await p.textContent('.cn-card')), 'card em "Publicando" explica: aprovado, publicações pausadas');

  console.log('3. Publicar: Publicando → Publicado só quando a Meta confirma');
  await p.uncheck('[data-cn-pausa]');
  await p.waitForFunction(() => /Desligado: aprovar publica/.test(document.body.textContent));
  await graph({ statusSeq: ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'] });
  await p.click('[data-action="cn-publicar"]');
  await p.waitForFunction(() => /Publicando…/.test(document.body.textContent), null, { timeout: 8000 });
  ok(true, 'card mostra "Publicando…" enquanto a Meta processa');
  ok(!/Publicado\b/.test(await p.textContent('.cn-card')) || /Publicando/.test(await p.textContent('.cn-card')), 'ainda não aparece como publicado');
  await p.waitForFunction((id) => window.Mesa.state.contents.find((c) => c.id === id).status === 'publicado', id1, { timeout: 30000 });
  await abaCentral(p, 'publicados');
  const link = await p.locator('.cn-card a').getAttribute('href');
  ok(/instagram\.com\/p\//.test(link), `link do post: ${link}`);
  g = await graph();
  ok(g.n_media_publish === 1 && g.n_containers === 3, `Meta recebeu 1 publicação (2 filhos + 1 pai): ${g.n_containers} containers, ${g.n_media_publish} media_publish`);
  const c1 = await p.evaluate((id) => { const c = window.Mesa.state.contents.find((x) => x.id === id); return { status: c.status, pub: c.publicacao, pubs: c.publicacoes }; }, id1);
  ok(c1.status === 'publicado' && c1.pub.versao_publicada === 'v1' && c1.pubs[0].post_id, 'o conteúdo guarda a versão publicada e o id do post');
  await p.screenshot({ path: `${SP}/c_3_publicado.png` });

  console.log('4. Duplo toque em "Aprovar e publicar" publica uma vez só');
  const id2 = await criaConteudo(p, 'FIXTURE carrossel 2');
  await graph({ statusSeq: ['FINISHED'] });
  await p.click('[data-action="tab"][data-tab="central"]'); await p.click('[data-action="cn-aba"][data-aba="aprovar"]');
  await p.waitForSelector(`[data-cn="${id2}"] [data-action="cn-aprovar"]`);
  await p.locator(`[data-cn="${id2}"] [data-action="cn-aprovar"]`).dblclick();
  await p.waitForFunction((id) => window.Mesa.state.contents.find((c) => c.id === id).status === 'publicado', id2, { timeout: 30000 });
  g = await graph();
  ok(g.n_media_publish === 2, `depois de 2 itens aprovados, a Meta recebeu 2 publicações no total (${g.n_media_publish})`);

  console.log('5. Item com pendência de revisão não aprova com um toque');
  const id3 = await criaConteudo(p, 'FIXTURE com pendência');
  await p.evaluate((id) => { const c = window.Mesa.state.contents.find((x) => x.id === id); c.claims[0].estado = 'contradita'; c.claims[0].motivo_estado = 'FIXTURE contradição'; return window.Mesa.ctx().persistir(c); }, id3);
  await p.click('[data-action="tab"][data-tab="central"]'); await p.click('[data-action="cn-aba"][data-aba="aprovar"]');
  ok(await p.locator(`[data-cn="${id3}"] [data-action="cn-aprovar"]`).isDisabled(), 'botão desabilitado: fonte contradiz a afirmação');
  ok(/pendência/.test(await p.textContent(`[data-cn="${id3}"]`)), 'o card diz o motivo');

  console.log('6. Token inválido: banner "Reconecte o Instagram"');
  const id4 = await criaConteudo(p, 'FIXTURE token');
  await graph({ statusSeq: ['FINISHED'], tokenInvalido: true });
  await p.click('[data-action="tab"][data-tab="central"]'); await p.click('[data-action="cn-aba"][data-aba="aprovar"]');
  await p.locator(`[data-cn="${id4}"] [data-action="cn-aprovar"]`).click();
  await p.waitForFunction(() => /Reconecte o Instagram/.test(document.body.textContent), null, { timeout: 15000 });
  ok(true, 'banner fixo "Reconecte o Instagram" apareceu');
  await p.screenshot({ path: `${SP}/c_6_reconectar.png` });
  await graph({ tokenInvalido: false });

  console.log('7. Fechar e reabrir o app: fila, status e histórico continuam');
  await p.close();                          // fechou a aba; o armazenamento do navegador continua
  ({ ctx, p } = await nova(browser, ctx));
  await p.waitForFunction(() => window.Mesa.state.contents.length >= 4);
  await abaCentral(p, 'publicados');
  ok(await p.locator('.cn-card').count() === 2, 'os 2 publicados continuam em Publicados depois de reabrir');
  const hist = await p.evaluate(() => window.Mesa.state.contents.find((c) => c.status === 'publicado').historico.map((h) => h.resumo));
  ok(hist.some((h) => /Publicado no Instagram/.test(h)), 'histórico registra a publicação');

  console.log('8. O fluxo antigo continua');
  await p.click('[data-action="tab"][data-tab="mesa"]');
  ok(/Quero falar sobre isso|Encontre uma pauta/.test(await p.textContent('.es-main')), 'Mesa continua com os caminhos de entrada');
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await ctx.close(); await browser.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S):\n- ${falhas.join('\n- ')}` : '\nTudo certo.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });
