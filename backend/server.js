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
app.use('/api/publico', require('./routes/publish').publico);
app.use('/api/jobs', require('./routes/sync').jobs);

app.get(['/health', '/api/health'], (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// O mesmo servidor entrega a interface e a API, inclusive na instalação local.
// Um frontend separado só é usado quando foi configurado explicitamente.
app.get('/', (req, res) => {
  if (process.env.FRONTEND_URL) return res.redirect(302, process.env.FRONTEND_URL);
  res.sendFile(require('path').join(__dirname, '..', 'static', 'index.html'));
});
app.use(express.static(require('path').join(__dirname, '..', 'static')));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Nexos Páginas backend running on port ${PORT}`);
  });
}

module.exports = app;
