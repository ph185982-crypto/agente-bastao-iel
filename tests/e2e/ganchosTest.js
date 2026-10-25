// "Mais ganchos" no editor: gera, filtra pelo código e troca a capa. Servidor real, IA simulada.
const { chromium } = require('./apoio');
const fs = require('fs');
const SP = process.env.SP || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || 'http://127.0.0.1:3995';
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };

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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await ctx.route('**/fonts.g*/**', (r) => r.abort());
  const p = await ctx.newPage(); p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto && window.Mesa.state.servidor, null, { timeout: 20000 });
  const id = await criaConteudo(p, 'FIXTURE ganchos');
  await p.evaluate((id) => { const m = window.Mesa; m.state.tab = 'mesa'; m.state.sub = 'conteudo'; m.state.atual = id; window.Mesa.ctx().render(); }, id);
  await p.waitForSelector('[data-action="ed-ganchos"]', { timeout: 15000 });
  ok(true, 'o botão "Mais ganchos" aparece junto das capas');
  await p.click('[data-action="ed-ganchos"]');
  await p.waitForSelector('.ed-ganchos', { timeout: 15000 });
  const txt = await p.innerText('.ed-ganchos');
  ok(/Em julho de 1994 o mínimo era R\$ 64,79: quanto vale hoje\?/.test(txt), 'mostra um gancho filtrado');
  ok(/verificações/.test(txt) && !/\bnota \d|score|pontos/i.test(txt), 'mostra verificações objetivas, sem nota numérica');
  ok(/\d+ descartado\(s\)/.test(txt), `os ganchos descartados são contados na tela (${(txt.match(/\d+ descartado\(s\)/) || [''])[0]})`);
  await p.click('.ed-ganchos summary:has-text("descartado")');
  ok(/exemplo do playbook/.test(await p.innerText('.ed-ganchos')), 'motivo do descarte disponível (copiava exemplo do playbook)');
  await p.screenshot({ path: `${SP}/g_1_ganchos.png` });
  await p.click('[data-action="ed-gancho-usar"][data-g="0"]');
  await p.waitForFunction((id) => { const c = window.Mesa.state.contents.find((x) => x.id === id); const v = window.ContentModel.versaoAtiva(c); return /quanto vale hoje/.test(v.slides[0].texto) && v.capas.some((k) => k.foco === 'gancho'); }, id, { timeout: 15000 });
  ok(true, 'usar o gancho troca a capa e guarda como nova versão');
  const info = await p.evaluate((id) => { const c = window.Mesa.state.contents.find((x) => x.id === id); const v = window.ContentModel.versaoAtiva(c); return { versoes: c.copia.versoes.length, escolhida: v.capa_escolhida, foco: v.capas.find((k) => k.id === v.capa_escolhida)?.foco, claims: v.slides[0].claim_ids }; }, id);
  ok(info.versoes >= 3 && info.foco === 'gancho' && info.claims.includes('a1'), `versões anteriores preservadas e capa ligada ao fato (${JSON.stringify(info)})`);
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await p.screenshot({ path: `${SP}/g_2_capa_trocada.png` });
  await browser.close();
  if (falhas.length) { console.log(`\n${falhas.length} verificação(ões) falharam.`); process.exit(1); }
  console.log('\nTudo certo.');
})().catch((e) => { console.error(e); process.exit(1); });
