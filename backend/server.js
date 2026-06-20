require('./fontSetup');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Warn on missing env vars at startup so misconfigured deploys are obvious in logs
['OPENAI_API_KEY', 'RAPIDAPI_KEY'].forEach(key => {
  if (!process.env[key]) console.warn(`WARNING: ${key} is not set — dependent features will fail`);
});
['RAPIDAPI_KEY_IG120', 'RAPIDAPI_KEY_TIKTOK'].forEach(key => {
  if (!process.env[key]) console.warn(`INFO: ${key} not set — will fallback to RAPIDAPI_KEY`);
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['https://nexos-paginas.netlify.app', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  exposedHeaders: ['X-Headline', 'X-Caption', 'X-Captions-Burned', 'X-Copyright-Risk', 'X-Copyright-Reasons', 'X-Mini-Jury-Verdict', 'X-Mini-Jury-Stopped', 'X-Mini-Jury-Reason'],
}));

app.use(express.json());

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
