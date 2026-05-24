const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS — allow frontend origin
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173', 'http://localhost:4173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json());

// Routes
app.use('/api/download', require('./routes/download'));
app.use('/api/ocr', require('./routes/ocr'));
app.use('/api/analyze-print', require('./routes/analyzePrint'));
app.use('/api/edit-reel', require('./routes/editReel'));
app.use('/api/auto-reel', require('./routes/autoReel'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/chat', require('./routes/chat'));

app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// Redirect root to the frontend so visiting the Render URL doesn't show a blank error
app.get('/', (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'https://nexos-paginas.netlify.app';
  res.redirect(302, frontend);
});

app.listen(PORT, () => {
  console.log(`Nexos Páginas backend running on port ${PORT}`);
});
