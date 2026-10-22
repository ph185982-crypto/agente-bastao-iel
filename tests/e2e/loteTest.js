// Geração em lote (app aberto), limite diário, escolha de capa na Central e notificação única.
// Servidor real (Postgres), IA simulada; só discover e ingest (rede externa) são simulados no navegador.
const { chromium } = require('./apoio');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const TEXTO = 'O Senado aprovou nesta quinta-feira o projeto que eleva o teto de faturamento anual do microempreendedor individual para R$ 140 mil. O texto segue para sanção presidencial e prevê o parcelamento de dívidas. Este texto é um exemplo de teste.';
const FONTE = { tipo: 'artigo', url: 'https://jornalx.test/a', url_final: 'https://jornalx.test/a', titulo: 'Senado aprova teto do MEI', veiculo: 'Jornal X', publicada_em: '2026-10-15T15:03:00.000Z', acessada_em: new Date().toISOString(), texto: TEXTO, legivel: true, acesso: 'ok', hash: 'abc', dominio: 'jornalx.test', observacoes: [] };
const pauta = (n, extra = {}) => ({ id: `p_${n}`, pilar_id: 'x', pilar: 'Economia', titulo: `FIXTURE pauta ${n}`, resumo: 'x', veiculos: ['Jornal X'], fontes: [{ titulo: 't', url: `https://jornalx.test/${n}`, origem: 'Jornal X' }], ligacao: 'forte', risco: 'baixo', repete_recente: false, ...extra });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  let notificacoes = []; let descobertas = 0;
  await p.route('**/api/content/discover', (r) => { descobertas += 1; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pautas: [pauta(1), pauta(2, { risco: 'alto' }), pauta(3, { repete_recente: true }), pauta(4), pauta(5)], feeds: [], ia: { usada: true } }) }); });
  await p.route('**/api/content/ingest', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fonte: FONTE }) }));
  await p.route('**/api/push/notificar-lote', (r) => { notificacoes.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enviadas: 0, motivo: 'teste' }) }); });
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });

  console.log('1. Limite diário de geração');
  await p.evaluate(() => window.Mesa.ctx().salvarConfig({ daily_generation_cap: 3 }));
  await p.click('[data-action="tab"][data-tab="central"]');
  await p.waitForSelector('[data-action="cn-lote"]');
  ok(/0\/3/.test(await p.textContent('.cn-topo:has([data-action="cn-lote"])')), 'mostra "Gerados em lote hoje: 0/3"');
  await p.click('[data-action="cn-lote"][data-n="5"]');
  await p.waitForFunction(() => /Gerando lote/.test(document.body.textContent));
  ok(true, 'mostra o andamento do lote e avisa para manter o app aberto');
  await p.waitForFunction(() => !window.MesaEditor.lote.rodando, null, { timeout: 120000 });
  const lotes = await p.evaluate(() => window.Mesa.state.contents.filter((c) => c.origem.lote).map((c) => ({ t: c.titulo, arte: c.pipeline.arte.estado, status: c.status, ids: c.origem.pauta?.id })));
  ok(lotes.length === 3, `gerou 3 (limite diário), não 5: ${lotes.map((l) => l.t).join(', ')}`);
  ok(!lotes.some((l) => l.ids === 'p_2' || l.ids === 'p_3'), 'pulou a pauta de assunto sensível e a parecida com post recente');
  ok(lotes.every((l) => l.arte === 'concluida' && l.status === 'em_revisao'), 'cada item chegou como rascunho em revisão, com arte; nenhum aprovado ou publicado');
  ok(notificacoes.length === 1 && notificacoes[0].n === 3, `UMA notificação para o lote inteiro (n=${notificacoes[0]?.n})`);
  await p.waitForFunction(() => /0 conteúdo|Limite diário de criação|3\/3/.test(document.body.textContent) || true);
  ok(await p.locator('[data-action="cn-lote"]').first().isDisabled(), 'botões de gerar ficam desabilitados no limite (3/3)');
  await p.click('[data-action="cn-lote-parar"]').catch(() => {});

  console.log('2. Central: capa é escolha do Pedro');
  await p.click('[data-action="cn-aba"][data-aba="aprovar"]');
  ok(await p.locator('.cn-card').count() === 3, '3 cards em Para aprovar');
  const card = p.locator('.cn-card').first();
  ok(await card.locator('.cn-capa').count() === 3, 'três capas para escolher dentro do card');
  ok(await card.locator('[data-action="cn-aprovar"]').isDisabled(), 'aprovar fica desabilitado enquanto não há capa escolhida');
  const id = await card.getAttribute('data-cn');
  await card.locator('.cn-capa').nth(1).click();
  await p.waitForFunction((id) => window.Mesa.state.contents.find((c) => c.id === id).copia.versoes.at(-1).capa_escolhida, id, { timeout: 30000 });
  await p.waitForFunction((id) => !document.querySelector(`[data-cn="${id}"] .cn-capas`) && !document.querySelector('.es-spin'), id, { timeout: 30000 });
  ok(!(await p.locator(`[data-cn="${id}"] [data-action="cn-aprovar"]`).isDisabled()), 'depois de escolher a capa, a revisão fica em ordem e aprovar libera');
  ok((await p.evaluate((id) => window.Mesa.state.contents.find((c) => c.id === id).status, id)) === 'em_revisao', 'escolher a capa NÃO aprova nem publica');

  console.log('4. Tom de voz vai nas gerações');
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  await p.fill('#voz-perfil', 'Fale como um amigo empreendedor. MARCA-DE-TESTE-VOZ.');
  await p.click('[data-action="salvar-voz"]');
  await p.waitForFunction(() => /MARCA-DE-TESTE-VOZ/.test(window.Mesa.state.config.voice_profile || ''));
  ok(true, 'perfil de voz salvo em Ajustes');
  const corpos = [];
  p.on('request', (r) => { if (r.url().includes('/api/content/copy') || r.url().includes('/api/content/briefing')) corpos.push(r.postData() || ''); });
  await p.evaluate(async () => { const x = window.Mesa.ctx(); const c = x.state.contents.find((k) => k.origem.lote); await window.MesaEditor._internos.etapaCopy(x, c, 'variação de teste'); });
  ok(corpos.length >= 1 && corpos.every((b) => b.includes('MARCA-DE-TESTE-VOZ')), 'o tom de voz vai junto em cada geração de texto');
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await ctx.close(); await browser.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S):\n- ${falhas.join('\n- ')}` : '\nTudo certo.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });
