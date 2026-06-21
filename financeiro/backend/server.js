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

// Diagnóstico — verifica conexões sem expor segredos
app.get('/diag', async (req, res) => {
  const results = { env: {}, supabase: null, openai: null };

  ['OPENAI_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_VERIFY_TOKEN',
   'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].forEach(k => {
    results.env[k] = !!process.env[k];
  });

  try {
    const supabase = require('./services/supabase');
    const { data, error } = await supabase.from('users').select('count').limit(1);
    results.supabase = error ? `ERRO: ${error.message}` : 'OK';
  } catch (e) {
    results.supabase = `ERRO: ${e.message}`;
  }

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.models.list();
    results.openai = r.data?.length ? 'OK' : 'sem modelos';
  } catch (e) {
    results.openai = `ERRO: ${e.message}`;
  }

  res.json(results);
});

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
