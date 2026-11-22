require('./fontSetup');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Warn on missing env vars at startup so misconfigured deploys are obvious in logs
const LLM_KEYS = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', cerebras: 'CEREBRAS_API_KEY', openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY' };
const llmAtivos = Object.entries(LLM_KEYS).filter(([, k]) => process.env[k]).map(([n]) => n);
if (!llmAtivos.length)
  console.warn(`WARNING: nenhuma chave de IA configurada (${Object.values(LLM_KEYS).join(', ')}) — recursos de IA vão falhar`);
else
  console.log(`Provedores de IA na fila (nesta ordem): ${llmAtivos.join(' → ')}`);
if (!process.env.RAPIDAPI_KEY) console.warn('WARNING: RAPIDAPI_KEY is not set — dependent features will fail');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    'https://nexos-paginas.netlify.app',
    'https://nexos-paginas-frontend.vercel.app',
    /\.vercel\.app$/,
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  credentials: true,
  exposedHeaders: ['X-Headline', 'X-Caption', 'X-Captions-Burned', 'X-Copyright-Risk', 'X-Copyright-Reasons', 'X-Mini-Jury-Verdict', 'X-Mini-Jury-Stopped', 'X-Mini-Jury-Reason'],
}));

app.use(express.json({ limit: '20mb' }));

// Acesso por código (só quando APP_ACCESS_CODE está definido) + login.
const access = require('./lib/access');
access.registrarRotas(app);
// Login único Avanteza ID: fica ANTES da verificação de acesso (é por aqui que o acesso é obtido).
require('./lib/ssoRota').registrar(app);
app.use('/api', access.exigeAcesso);

// Routes
app.use('/api/download', require('./routes/download'));
app.use('/api/ocr', require('./routes/ocr'));
app.use('/api/analyze-print', require('./routes/analyzePrint'));
app.use('/api/edit-reel', require('./routes/editReel'));
app.use('/api/auto-reel', require('./routes/autoReel'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/content-finder', require('./routes/contentFinder'));
app.use('/api/carousels', require('./routes/carousels'));
app.use('/api/headline-jury', require('./routes/headlineJury'));
app.use('/api/brain', require('./routes/brain'));
app.use('/api/video', require('./routes/videoIA'));
app.use('/api/trending', require('./routes/trending'));
app.use('/api/tv-cuts', require('./routes/tvCuts'));
app.use('/api/video-editor', require('./routes/videoEditor'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/content', require('./routes/content'));
app.use('/api/account', require('./routes/account'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/publish', require('./routes/publish'));
app.use('/api/push', require('./routes/push'));
app.use('/api/studio', require('./routes/studio'));
app.use('/api/instagram', require('./routes/instagram'));
app.use('/api/monitor', require('./routes/monitor'));
app.use('/api/recortes', require('./routes/recortes'));
app.use('/api/top', require('./routes/top'));
app.use('/api/painel', require('./routes/painel'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/reciclagem', require('./routes/reciclagem'));
app.use('/api/historias', require('./routes/historias'));
app.use('/api/linkedin', require('./routes/linkedin'));
app.use('/api/carrosseis', require('./routes/carrosseis')); // diálogo ilustrado e papel de parede (topo de funil)
app.use('/api/crescimento', require('./routes/crescimento')); // Growth Dashboard, Diagnóstico e DNA Editorial
// Manutenção do banco (limite de 512 MB do Postgres gratuito): ver espaço e limpar prévias/fotos/revisões sem uso.
app.get('/api/manutencao/espaco', async (req, res) => { try { const a = require('./lib/armazem').armazem(); res.json(a?.arquivos?.espaco ? await a.arquivos.espaco() : {}); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/manutencao/limpar', async (req, res) => { try { res.json(await require('./lib/manutencao').limpar({ simular: req.body?.simular === true })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/manutencao/compactar', async (req, res) => { try { const a = require('./lib/armazem').armazem(); res.json({ tabelas: a?.arquivos?.compactar ? await a.arquivos.compactar({ full: req.body?.full === true }) : [], espaco: a?.arquivos?.espaco ? await a.arquivos.espaco() : null }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.use('/api/radar', require('./routes/radar'));
app.use('/api/nuvem', require('./routes/nuvem')); // Google Cloud Run: chamadas do Cloud Tasks
app.use('/api/publico', require('./routes/publish').publico);
app.use('/api/jobs', require('./routes/sync').jobs);

// Fora da Vercel (Google Cloud Run): o Cloud Scheduler gratuito tem 3 tarefas; esta rota agrupa as rotinas diárias
// numa chamada só, repassando o mesmo CRON_SECRET para cada rota, uma depois da outra.
const LOTE_CRON = { 'content-finder': '/api/content-finder/mine', trending: '/api/trending/mine', radar: '/api/radar/cron', publish: '/api/publish/cron' };
app.get('/api/cron/lote', async (req, res) => {
  const nomes = String(req.query.r || '').split(',').filter((n) => LOTE_CRON[n]);
  const saida = {};
  for (const n of nomes) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${LOTE_CRON[n]}`, { headers: { Authorization: req.headers.authorization || '' }, signal: AbortSignal.timeout(280000) });
      saida[n] = r.status;
    } catch (e) { saida[n] = String(e.message).slice(0, 80); }
  }
  res.json({ ok: true, rotas: saida });
});

app.get(['/health', '/api/health'], async (req, res) => {
  const corpo = { status: 'ok', timestamp: new Date().toISOString() };
  // Diagnóstico das redes (só sim/não, sem nome, token ou id): ?redes=1
  if (req.query.redes) {
    try { const e = await require('./lib/linkedin').estado(); corpo.linkedin = { configurado: e.configurado, conectado: e.conectado, ativo: e.ativo, venceu: e.venceu, dias_para_vencer: e.dias_para_vencer }; try { const L = require('./lib/linkedin'); corpo.linkedin.atrasados = (await L.pendentes()).length; const pubs = await require('./lib/armazem').armazem().publicacoes.listar(require('./lib/account').ACCOUNT.ig_id); const li = pubs.filter((p) => p.rede === 'linkedin'); corpo.linkedin.publicados = li.filter((p) => p.estado === 'publicada').length; corpo.linkedin.com_erro = li.filter((p) => p.estado === 'erro').length; corpo.linkedin.ultimo_erro = li.filter((p) => p.estado === 'erro').sort((x, y) => y.atualizada_em.localeCompare(x.atualizada_em))[0]?.dados?.erro?.amigavel?.slice(0, 160) || null; } catch { /* só diagnóstico */ } }
    catch (e) { corpo.linkedin = { erro: String(e.message).slice(0, 120) }; }
  }
  res.json(corpo);
});

// O mesmo servidor entrega a interface e a API, inclusive na instalação local.
// Um frontend separado só é usado quando foi configurado explicitamente.
app.get('/', (req, res) => {
  if (process.env.FRONTEND_URL) return res.redirect(302, process.env.FRONTEND_URL);
  res.sendFile(require('path').join(__dirname, '..', 'static', 'index.html'));
});
app.use(express.static(require('path').join(__dirname, '..', 'static')));
// Igual à Vercel ("/(.*)" → index.html): qualquer endereço da interface abre o app.
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(require('path').join(__dirname, '..', 'static', 'index.html')));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Nexos Páginas backend running on port ${PORT}`);
  });
}

module.exports = app;
