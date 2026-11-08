// Revisão visual da integração: a interface REAL (mesa.js + módulos) com as abas Criar, Vídeos, Reciclar e Perfil.
// A API de vídeos e de reciclagem é simulada com page.route (o servidor de teste não tem Blob nem Graph). Nada é publicado.
// Uso: node tests/e2e/executar.js integracaoTest  (ou BASE=http://127.0.0.1:3995 node tests/e2e/integracaoTest.js)
const { chromium } = require('./apoio');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const SP = process.env.SP || path.join(__dirname, 'out');
const PORTA = Number(process.env.TESTE_PORT || 3995);
const BASE = process.env.BASE || `http://127.0.0.1:${PORTA}`;
const falhas = []; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let servidor = null;
async function subirServidor() {
  if (process.env.BASE) return;
  const ambiente = { ...process.env };
  for (const k of Object.keys(ambiente)) if (/API_KEY|TOKEN|SECRET|DATABASE_URL|POSTGRES|APP_ACCESS_CODE|VERCEL|NODE_ENV|FRONTEND_URL/.test(k)) delete ambiente[k];
  servidor = spawn(process.execPath, ['tests/e2e/servidorTeste.js'], { cwd: path.join(__dirname, '../..'), env: { ...ambiente, PORT: String(PORTA + 1), TESTE_PORT: String(PORTA), TESTE_MEMORIA: '1', APP_ACCESS_MODE: 'aberto' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* subindo */ } await espera(100); }
  throw new Error(`Servidor de teste não iniciou em ${BASE}.`);
}
async function derrubarServidor() { if (!servidor || servidor.exitCode !== null) return; await new Promise((r) => { servidor.once('exit', r); servidor.kill('SIGTERM'); }); }

const json = (r, corpo, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const agora = Date.now(); const iso = (min) => new Date(agora - min * 60000).toISOString();
async function simular(ctx) {
  await ctx.route('**/api/videos**', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const partes = u.pathname.split('/').filter(Boolean); const id = partes[2];
    if (req.method() === 'GET' && !id) return json(r, { videos: [
      { id: 'vd_1', titulo: 'Três sinais de que o seu preço está errado', estado: 'pronto', criado_em: iso(40), estilo: 'hormozi', poster: `${BASE}/app-icon-512.png`, url: `${BASE}/app-icon-512.png`, duracao_s: 58, legenda: 'Se o cliente nunca reclama do preço, você está cobrando pouco. Manda pro seu sócio.', hashtags: ['#empreendedorismo'], hash: 'h1', status: 'em_revisao' },
      { id: 'vd_2', titulo: 'O erro que quebra o MEI em seis meses', estado: 'editando', criado_em: iso(9), estilo: 'beast', status: 'rascunho' },
    ] });
    return json(r, { error: 'não simulado' }, 404);
  });
  await ctx.route('**/api/reciclagem**', async (r) => {
    const u = new URL(r.request().url());
    if (/\/api\/reciclagem\/tendencias/.test(u.pathname)) return json(r, { tendencias: [{ titulo: 'Selic', trafego: '200 mil+', link: 'https://trends.google.com/' }, { titulo: 'imposto de renda 2027', trafego: '50 mil+', link: 'https://trends.google.com/' }], em: iso(60) });
    if (/\/api\/reciclagem\/contas/.test(u.pathname)) return json(r, { instagram: [{ handle: 'hormozi', pais: 'EUA', idioma: 'en', prioridade: true }], youtube: [] , config: { instagram: { adicionar: [], remover: [] }, youtube: { adicionar: [], remover: [] } } });
    if (u.pathname.replace(/\/$/, '') === '/api/reciclagem') return json(r, { itens: [
      { id: 'rc_1', rede: 'instagram', conta: 'hormozi', pais: 'EUA', idioma: 'en', seguidores: 5000000, permalink: 'https://www.instagram.com/p/x/', data: iso(3000), curtidas: 412000, comentarios: 3100, vl: 6.2, em_alta: true, tema: 'preço baixo mata o negócio', mecanismo: 'lista_erros', tese: 'Cobrar barato é a forma mais rápida de quebrar um negócio pequeno.', ponte_pedro: 'O MEI brasileiro que compete por preço na Shopee paga a conta com a própria margem.' },
      { id: 'rc_2', rede: 'instagram', conta: 'tallisgomes', pais: 'BR', idioma: 'pt', seguidores: 2100000, permalink: 'https://www.instagram.com/p/y/', data: iso(5000), curtidas: 84000, comentarios: 1186, vl: 4.1, em_alta: true, tema: 'quem sustenta o país', mecanismo: 'identidade', tese: 'Quem segura o país de pé é o dono de negócio que paga a folha antes do próprio salário.', ponte_pedro: 'Identidade do empreendedor contra o discurso de quem nunca pagou folha.' },
    ], estado: { coletado_em: iso(60), contas_lidas: 38, avisos: [] } });
    return json(r, { ok: true });
  });
}

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  await subirServidor();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const [nome, viewport, mobile] of [['390', { width: 390, height: 844 }, true], ['1280', { width: 1280, height: 900 }, false]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await simular(ctx);
      const p = await ctx.newPage(); const erros = [];
      // Só erros de JavaScript contam; recursos externos bloqueados pelo ambiente de teste (CDN, Blob) viram aviso com a URL.
      const bloqueados = [];
      p.on('pageerror', (e) => erros.push(String(e.message))); p.on('requestfailed', (r) => bloqueados.push(r.url()));
      p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource|failed to load React|failed to load https:\/\/unpkg\.com/.test(m.text())) erros.push(m.text()); });
      await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await p.waitForSelector('.es-nav', { timeout: 20000 });
      const abas = await p.$$eval('.es-nav button span', (els) => els.map((e) => e.textContent.trim()));
      ok(abas.includes('Vídeos') && abas.includes('Reciclar'), `${nome}: menu tem Vídeos e Reciclar (${abas.join(' · ')})`);
      ok(!(await p.$$eval('.es-nav button', (els) => els.some((b) => /undefined/.test(b.innerHTML)))), `${nome}: nenhum ícone indefinido no menu`);
      for (const aba of ['mesa', 'videos', 'reciclagem', 'ajustes']) {
        await p.click(`.es-nav button[data-tab="${aba}"]`); await espera(900);
        const texto = await p.$eval('#studio-main', (el) => el.innerText.length).catch(() => 0);
        ok(texto > 80, `${nome}: aba ${aba} renderizou (${texto} caracteres)`);
        const largura = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        ok(largura, `${nome}: aba ${aba} sem rolagem horizontal`);
        await p.screenshot({ path: path.join(SP, `integracao-${nome}-${aba}.png`), fullPage: true });
      }
      await p.click('.es-nav button[data-tab="videos"]'); await espera(600);
      ok(await p.$eval('#studio-main', (el) => /preço está errado/.test(el.innerText)), `${nome}: vídeo pronto aparece na aba Vídeos`);
      await p.click('.es-nav button[data-tab="reciclagem"]'); await espera(600);
      ok(await p.$eval('#studio-main', (el) => /Cobrar barato/.test(el.innerText)), `${nome}: tese reciclável aparece na aba Reciclar`);
      await p.click('.es-nav button[data-tab="mesa"]'); await espera(600);
      ok(await p.$eval('#studio-main', (el) => /Post único/.test(el.innerText) && /Ensaio/.test(el.innerText)), `${nome}: Criar oferece Post único e Ensaio`);
      ok(erros.length === 0, `${nome}: sem erros de JavaScript${erros.length ? `: ${erros.slice(0, 3).join(' | ')}` : ''}`);
      if (bloqueados.length) console.log(`  · ${nome}: recursos não carregados no ambiente de teste: ${[...new Set(bloqueados)].slice(0, 5).join(' , ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); await derrubarServidor(); }
  if (falhas.length) { console.log(`\n${falhas.length} falha(s)`); process.exit(1); }
  console.log('\nTudo certo (integração).');
})().catch((e) => { console.error(e); derrubarServidor().finally(() => process.exit(1)); });
