const { spawn } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '../..');
const nomes = process.argv.slice(2);
const suite = nomes.length ? nomes : ['mesaATest', 'mesaBTest', 'centralTest', 'loteTest', 'persistenciaTest', 'resultadosTest', 'pautasTest', 'ganchosTest', 'contaAbertaTest', 'roteiroTest', 'recortesTest', 'radarTest'];
const permitidos = new Set(['mesaATest', 'mesaBTest', 'centralTest', 'loteTest', 'persistenciaTest', 'resultadosTest', 'pautasTest', 'ganchosTest', 'contaAbertaTest', 'roteiroTest', 'recortesTest', 'radarTest']);
const filhos = new Set();
function iniciar(arquivo, env = {}, args = []) {
  const ambiente = { ...process.env };
  for (const k of Object.keys(ambiente)) if (/API_KEY|TOKEN|SECRET|DATABASE_URL|POSTGRES|APP_ACCESS_CODE|VERCEL|NODE_ENV|FRONTEND_URL/.test(k)) delete ambiente[k];
  const p = spawn(process.execPath, [arquivo, ...args], { cwd: raiz, env: { ...ambiente, ...env }, stdio: 'inherit' });
  filhos.add(p); p.once('exit', () => filhos.delete(p));
  return p;
}
async function parar(p) {
  if (p.exitCode !== null || p.signalCode) return;
  await new Promise(resolve => { p.once('exit', resolve); p.kill('SIGTERM'); });
}
async function pronto(porta) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${porta}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Servidor de teste não iniciou na porta ${porta}.`);
}
process.on('SIGINT', () => { for (const p of filhos) p.kill('SIGTERM'); process.exit(130); });
(async () => {
  for (const nome of suite) {
    if (!permitidos.has(nome)) throw new Error(`Teste desconhecido: ${nome}`);
    console.log(`\n=== ${nome}: servidor real, armazenamento em memória, IA e Meta simuladas ===`);
    const banco = ['centralTest', 'loteTest', 'persistenciaTest', 'resultadosTest', 'pautasTest', 'ganchosTest', 'contaAbertaTest', 'roteiroTest', 'recortesTest', 'radarTest'].includes(nome);
    const atraso = nome === 'persistenciaTest' ? '2500' : '50';
    const a = iniciar('tests/e2e/servidorTeste.js', { PORT: '3996', TESTE_PORT: '3995', GRAPH_FALSA: '1', GRAPH_PORT: '3999', TESTE_MEMORIA: banco ? '1' : '', TESTE_DURAVEL: ['roteiroTest', 'recortesTest', 'radarTest'].includes(nome) ? '1' : '', TESTE_RADAR: nome === 'radarTest' ? '1' : '', ATRASO_MS: atraso });
    let b;
    try {
      await pronto(3995);
      if (nome === 'persistenciaTest' || nome === 'mesaATest') {
        b = iniciar('tests/e2e/servidorTeste.js', { PORT: '3998', TESTE_PORT: '3997', ATRASO_MS: atraso, ...(nome === 'mesaATest' ? { APP_ACCESS_CODE: 'codigo-local-de-teste' } : {}) });
        await pronto(3997);
      }
      const teste = iniciar(`tests/e2e/${nome}.js`, { BASE: 'http://127.0.0.1:3995', LOGIN_BASE: 'http://127.0.0.1:3997', LOGIN_CODE: 'codigo-local-de-teste' });
      const codigo = await new Promise(resolve => teste.once('exit', resolve));
      if (codigo !== 0) throw new Error(`${nome} falhou (código ${codigo}).`);
    } finally { await parar(a); if (b) await parar(b); }
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
