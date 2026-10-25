// Busca de pautas com prioridade/descartes e Ajustes → Estratégia, no navegador.
// A resposta da busca é um modelo fixo (nada de rede); a estratégia usa o servidor real.
const { chromium } = require('./apoio');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };

const resposta = {
  gerado_em: new Date().toISOString(), janela_dias: 3, feeds: [{ nome: 'Veículo X', ok: true, itens: 5 }], ia: { usada: true, provider: 'simulado', model: 'teste' },
  aviso_prioridade: 'Prioridade estimada só para ordenar a lista. Não prevê alcance nem envio.',
  pautas: [
    { id: 'p_1', pilar: 'Economia', titulo: 'Senado aprova teto do MEI de R$ 140 mil', resumo: 'Limite anual sobe.', veiculos: ['X'], publicada_em: new Date().toISOString(), fontes: [{ url: 'https://x.test/1', origem: 'X' }], ligacao: 'forte', prioridade: 82, mecanismo: 'numero_chocante', por_que_enviaria: 'Todo MEI manda para o contador.', por_que_interessa: 'Afeta quem fatura.', angulo: 'O teto subiu: e o imposto?', angulo_lojista: 'Quem vende pode crescer sem trocar de regime.', penalidades: [], limitacoes: 'Confirmar vigência.' },
    { id: 'p_2', pilar: 'Política', titulo: 'Pix de R$ 5 mil para MEI ainda depende do Congresso', resumo: 'Anúncio sem regra.', veiculos: ['X'], publicada_em: new Date().toISOString(), fontes: [], ligacao: 'media', prioridade: 31, mecanismo: null, por_que_enviaria: '', penalidades: [{ tipo: 'partidario', pontos: 30 }, { tipo: 'sem_fonte', pontos: 20 }] },
  ],
  descartadas: [{ id: 'p_3', titulo: 'Candidato lidera pesquisa eleitoral', motivo: 'partidario', detalhe: 'Assunto eleitoral ou partidário (modo neutro).' }, { id: 'p_4', titulo: 'Senado aprova o teto do MEI (repetida)', motivo: 'tema_usado', detalhe: 'Mesmo assunto já usado há 4 dia(s): “Aumentar o teto do MEI é um avanço”.' }],
  estrategia: { modo_politico: 'neutral', dias_sem_repetir: 21, temas_bloqueados: [] },
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  await ctx.route('**/api/content/discover', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) }));
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 20000 });

  // Busca de pautas
  await p.evaluate(() => { const m = window.Mesa; m.state.tab = 'mesa'; m.state.sub = 'descobrir'; m.state.descoberta.dados = null; });
  await p.evaluate(() => window.Mesa.ctx().render());
  await p.click('[data-action="descobrir"]');
  await p.waitForSelector('text=Prioridade 82', { timeout: 10000 });
  const txt = await p.innerText('main');
  ok(/Número que choca/.test(txt), 'mostra o mecanismo');
  ok(/por que alguém mandaria/i.test(txt) && /Todo MEI manda para o contador/.test(txt), 'mostra por que alguém mandaria');
  ok(/espelho para quem vende/i.test(txt), 'mostra o ângulo para quem vende');
  ok(/Partidário −30/.test(txt) && /Sem fonte −20/.test(txt), 'mostra penalidades com pontos');
  ok(/Não prevê alcance nem envio/.test(txt), 'avisa que a prioridade só ordena');
  ok(/2 descartada\(s\): ver por quê/.test(txt), 'avisa quantas pautas foram descartadas');
  await p.click('summary:has-text("descartada")');
  const det = await p.innerText('main');
  ok(/modo neutro/.test(det) && /há 4 dia/.test(det), 'explica cada descarte (partidário e tema usado)');
  await p.screenshot({ path: `${SP}/p_1_pautas.png` });

  // Estratégia nos Ajustes
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  await p.click('summary:has-text("Configurações")').catch(() => {});
  await p.waitForSelector('[data-action="es-modo"]', { state: 'visible', timeout: 10000 });
  ok(await p.getAttribute('[data-action="es-modo"][data-v="neutral"]', 'aria-pressed') === 'true', 'padrão: política neutra');
  await p.fill('#est-bloq', 'bets, crime');
  await p.fill('#est-dias', '14');
  await p.click('[data-action="es-salvar"]');
  await p.waitForTimeout(800);
  ok(await p.inputValue('#est-dias') === '14' && /bets, crime/.test(await p.inputValue('#est-bloq')), 'o que foi digitado continua na tela depois de salvar');
  await p.screenshot({ path: `${SP}/p_2_estrategia.png` });
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
