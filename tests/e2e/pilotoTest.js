// Perfil → Piloto automático e lista "Agendados" na tela Aprovar. Servidor real, armazenamento em memória; nada é publicado.
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
  // A rodada do piloto feita pelo app aberto é interceptada (não queremos produção de verdade no teste).
  await ctx.route('**/api/top/piloto/rodada', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ executou: true, avisos: ['teste'], publicados: [], avancados: [] }) }));
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });

  // Um carrossel "top" já aprovado e agendado
  const id = await p.evaluate(async () => {
    const M = window.ContentModel; const x = window.Mesa.ctx();
    const c = M.novoConteudo({ titulo: 'CBS de 11,3%: quem paga?', origem: { tipo: 'link', url: 'https://x.test/a' } });
    M.criarVersao(c, { slides: [{ id: 's1', funcao: 'capa', layout: 'rep_capa', texto: 'CBS de 11,3%', claim_ids: [] }], legenda: 'x', cta: '', hashtags: [] }, { quem: 'sistema' });
    c.top = { estado: 'concluida', escolha: { nota: 8.4 }, angulo: { tese: 'Quem paga é quem empreende.' } };
    c.status = 'aprovado'; c.revisao = { ...(c.revisao || {}), aprovada_versao: M.versaoAtiva(c).id, hash_aprovado: M.versaoAtiva(c).hash };
    c.agenda = { publicar_em: new Date(Date.now() + 3 * 3600000).toISOString() }; c.studio = { estado: 'agendado' };
    await x.persistir(c); return c.id;
  });
  await p.evaluate(() => window.StudioMobile.atualizar({ silencioso: true }));
  await p.click('[data-action="tab"][data-tab="central"]');
  await p.waitForSelector('.st-agendados', { timeout: 15000 });
  const ag = await p.innerText('.st-agendados');
  ok(/Agendados/.test(ag) && /CBS de 11,3%/.test(ag) && /às \d{2}:\d{2}/.test(ag), 'o carrossel aprovado aparece em "Agendados" com o horário');
  ok(!(await p.locator(`[data-st-card="${id}"]`).count()), 'agendado não aparece de novo como "para aprovar"');
  await p.screenshot({ path: `${SP}/pl_1_agendados.png` });

  // Perfil → Piloto
  await p.click('[data-action="tab"][data-tab="ajustes"]');
  await p.click('summary:has-text("Configurações")').catch(() => {});
  await p.waitForSelector('#pl-secao', { state: 'visible', timeout: 15000 });
  const sec = await p.innerText('#pl-secao');
  ok(/piloto automático/i.test(sec) && /nada vai ao instagram sem a sua aprovação/i.test(sec), 'o cartão do piloto explica que nada sai sem aprovação' + (/piloto/i.test(sec) ? '' : ' :: ' + sec.slice(0, 200)));
  ok(await p.getAttribute('[data-action="pl-ativo"][data-v="true"]', 'aria-pressed') === 'true', 'o piloto vem ligado');
  ok(/09:00, 11:00, 12:30, 15:00, 17:00, 18:30, 20:00, 21:30/.test(await p.inputValue('#pl-horarios')), 'os 8 horários padrão aparecem');
  await p.fill('#pl-meta', '6'); await p.fill('#pl-horarios', '09:00, 13:00, 19:00');
  await p.click('[data-action="pl-salvar"]');
  await p.waitForTimeout(800);
  const cfg = (await (await fetch(`${BASE}/api/top/piloto`)).json()).config;
  ok(cfg.meta_dia === 6 && cfg.horarios.join(',') === '09:00,13:00,19:00', 'a meta e os horários foram salvos no servidor');
  await p.click('[data-action="pl-ativo"][data-v="false"]');
  await p.waitForFunction(() => document.querySelector('[data-action="pl-ativo"][data-v="false"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  ok((await (await fetch(`${BASE}/api/top/piloto`)).json()).config.ativo === false, 'desligar o piloto salva no servidor');
  await p.screenshot({ path: `${SP}/pl_2_perfil.png` });
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
