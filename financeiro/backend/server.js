require('dotenv').config();
const express = require('express');
const app = express();

['OPENAI_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_VERIFY_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].forEach(k => {
  if (!process.env[k]) console.warn(`WARNING: ${k} não configurado`);
});

app.use(express.json());

app.use('/webhook', require('./routes/webhook'));

app.get(['/health', '/api/health'], (req, res) =>
  res.json({ status: 'ok', service: 'assistente-financeiro', ts: new Date().toISOString() })
);

// Rota do Cron (chamada pelo Vercel Cron ou chamada manual autenticada)
app.post('/cron/reminders', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { checkAndSendReminders } = require('./scheduler/reminders');
  const result = await checkAndSendReminders();
  res.json(result);
});

const PORT = process.env.PORT || 3002;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Assistente Financeiro rodando na porta ${PORT}`));
}

module.exports = app;
