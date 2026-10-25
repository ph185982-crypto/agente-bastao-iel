// Fluxo do monitor no celular: roteiro para aprovar (sem carrossel), aprovar libera a geração e Ajustes → Monitor.
// Servidor real com armazenamento durável em memória; a chamada de aprovação do roteiro é interceptada para
// conferir exatamente o que o app envia. Nada é publicado.
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
  const chamadas = [];
  // A chamada de aprovação vai ao servidor de verdade; aqui só registramos o que o app enviou.
  await ctx.route('**/api/studio/*/roteiro', (r) => { chamadas.push(JSON.parse(r.request().postData() || '{}')); r.continue(); });
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });

  const id = await p.evaluate(async () => {
    const M = window.ContentModel; const x = window.Mesa.ctx();
    const c = M.novoConteudo({ titulo: 'Senado aprova teto do MEI de R$ 140 mil', origem: { tipo: 'link', url: 'https://x.test/a' } });
    c.fonte_principal = { tipo: 'artigo', url: 'https://x.test/a', titulo: 'Senado aprova teto do MEI', veiculo: 'G1', texto: 'O Senado aprovou o teto de R$ 140 mil para o MEI.' };
    c.claims = [{ id: 'a1', texto: 'O Senado aprovou o teto de R$ 140 mil para o MEI.', tipo: 'fato', natureza: 'fato', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [{ valor: 140000, unidade: 'BRL' }], revisao: {} }];
    c.evidencias = [{ id: 'e1', tipo: 'primaria', autoridade: 'primaria', correspondencia: 'integral', trecho: 'O Senado aprovou o teto de R$ 140 mil para o MEI.', origem: 'G1', relacao: 'sustenta', titulo: 'x', consultada_em: new Date().toISOString() }];
    M.criarVersao(c, { capas: [], capa_escolhida: 'automatica', slides: [
      { id: 's1', layout: 'capa_tipografica', funcao: 'capa', texto: 'Teto do MEI sobe para **R$ 140 mil**', claim_ids: ['a1'] },
      { id: 's2', layout: 'explicacao', funcao: 'contexto', titulo: 'O que mudou', texto: 'O Senado aprovou o novo limite anual para o MEI.', claim_ids: ['a1'] },
      { id: 's3', layout: 'encerramento', funcao: 'encerramento', texto: 'Manda para o MEI que precisa saber disso.', claim_ids: [] }], legenda: 'O Senado aprovou o teto de R$ 140 mil para o MEI.', legenda_claim_ids: ['a1'], cta: 'Manda para o MEI que precisa saber disso.', hashtags: [] }, { quem: 'sistema', rotulo: 'roteiro' });
    c.status = 'em_revisao';
    c.studio = { job: 'j1', estado: 'aguardando_roteiro', etapa: 'auditoria', roteiro_primeiro: true };
    c.monitor = { veiculos: 4, horas: 2, veiculos_nomes: ['G1', 'Folha', 'UOL', 'CNN'], por_que_enviaria: 'Todo MEI manda para o contador.', fontes: [{ url: 'https://x.test/a', origem: 'G1' }] };
    await x.persistir(c); return c.id;
  });
  await p.click('[data-action="tab"][data-tab="central"]');
  await p.waitForSelector('[data-st-roteiro]', { timeout: 15000 });
  const txt = await p.innerText('[data-st-roteiro]');
  ok(/ROTEIRO/i.test(txt) && /Senado aprova teto do MEI/.test(txt), 'o roteiro aparece como cartão próprio');
  ok(/Coberto por 4 veículos/.test(txt) && /não de audiência/.test(txt), 'mostra por que está em alta e avisa que é sinal de cobertura');
  ok(/Todo MEI manda para o contador/.test(txt), 'mostra por que alguém mandaria');
  ok(/Teto do MEI sobe para R\$ 140 mil/.test(txt) && /O que mudou/.test(txt) && /Manda para o MEI/.test(txt), 'mostra o texto de cada slide, legenda e chamada final');
  ok(await p.locator('[data-st-roteiro] img').count() === 0, 'nenhum carrossel foi gerado ainda (sem imagens)');
  ok(/só é gerado depois que você aprovar/.test(txt) && /Aprovar e publicar/.test(txt), 'explica que nada vai ao Instagram sem o toque final');
  ok(await p.locator('[data-action="st-aprovar"]').count() === 0, 'não existe botão de publicar para um roteiro');
  const n = await p.innerText('.st-feed-tabs');
  ok(/Para aprovar\s*1/.test(n), 'a aba Para aprovar conta o roteiro');
  await p.screenshot({ path: `${SP}/rt_1_roteiro.png` });

  await p.click('[data-action="st-roteiro-aprovar"]');
  await p.waitForFunction((id) => window.Mesa.state.contents.find((c) => c.id === id)?.studio?.estado === 'gerando', id, { timeout: 15000 });
  const hashAtual = await p.evaluate((id) => window.ContentModel.versaoAtiva(window.Mesa.state.contents.find((c) => c.id === id)).hash, id);
  ok(chamadas.length === 1 && chamadas[0].acao === 'aprovar' && chamadas[0].hash === hashAtual, 'aprovar envia a versão exata que você viu (hash)');
  ok(await p.locator('[data-st-roteiro]').count() === 0, 'depois de aprovar o roteiro, o cartão sai da lista de roteiros');
  ok(/Gerando o carrossel|Em preparação/.test(await p.innerText('main')), 'o item passa para "Em preparação"');
  await p.screenshot({ path: `${SP}/rt_2_gerando.png` });

  // Ajustes → Monitor
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  await p.click('summary:has-text("Configurações")').catch(() => {});
  await p.waitForSelector('[data-action="es-mon-ativo"]', { state: 'visible', timeout: 15000 });
  ok(await p.getAttribute('[data-action="es-mon-ativo"][data-v="true"]', 'aria-pressed') === 'true', 'o monitor vem ligado por padrão');
  ok(/Nada vai ao Instagram sozinho/.test(await p.innerText('main')), 'a tela repete que nada vai ao Instagram sozinho');
  await p.click('[data-action="es-mon-ativo"][data-v="false"]');
  await p.waitForFunction(() => document.querySelector('[data-action="es-mon-ativo"][data-v="false"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  ok((await (await fetch(`${BASE}/api/content/estrategia`)).json()).monitor.ativo === false, 'desligar o monitor salva no servidor');
  await p.click('[data-action="es-mon-ativo"][data-v="true"]');
  await p.waitForFunction(() => document.querySelector('[data-action="es-mon-ativo"][data-v="true"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  await p.fill('#mon-max', '2'); await p.fill('#mon-min', '4');
  await p.click('[data-action="es-mon-salvar"]');
  await p.waitForTimeout(800);
  ok(await p.inputValue('#mon-max') === '2' && await p.inputValue('#mon-min') === '4', 'os valores digitados continuam na tela depois de salvar');
  const salvo = await (await fetch(`${BASE}/api/content/estrategia`)).json();
  ok(salvo.monitor.ativo === true && salvo.monitor.max_roteiros_dia === 2 && salvo.monitor.min_veiculos === 4, 'o servidor guardou a configuração do monitor');
  await p.screenshot({ path: `${SP}/rt_3_monitor.png` });
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
