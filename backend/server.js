require('./fontSetup');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Warn on missing env vars at startup so misconfigured deploys are obvious in logs
['OPENAI_API_KEY', 'RAPIDAPI_KEY'].forEach(key => {
  if (!process.env[key]) console.warn(`WARNING: ${key} is not set — dependent features will fail`);
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: true,
  credentials: true,
  exposedHeaders: ['X-Headline', 'X-Caption'],
}));

app.use(express.json());

// Routes
app.use('/api/download', require('./routes/download'));
app.use('/api/ocr', require('./routes/ocr'));
app.use('/api/analyze-print', require('./routes/analyzePrint'));
app.use('/api/edit-reel', require('./routes/editReel'));
app.use('/api/auto-reel', require('./routes/autoReel'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/content-finder', require('./routes/contentFinder'));
app.use('/api/headline-jury', require('./routes/headlineJury'));

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
