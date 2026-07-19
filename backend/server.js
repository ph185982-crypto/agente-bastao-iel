require('./fontSetup');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Warn on missing env vars at startup so misconfigured deploys are obvious in logs
if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY)
  console.warn('WARNING: Neither OPENAI_API_KEY nor GROQ_API_KEY is set — LLM features will fail');
else
  console.log(`LLM provider: ${process.env.OPENAI_API_KEY ? 'OpenAI' : 'Groq'}`);
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

app.get(['/health', '/api/health'], (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// Redirect root to the frontend so visiting the Render URL doesn't show a blank error
app.get('/', (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'https://nexos-paginas.netlify.app';
  res.redirect(302, frontend);
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Nexos Páginas backend running on port ${PORT}`);
  });
}

module.exports = app;
