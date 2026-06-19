// ── Cérebro — assistente pessoal inteligente e executor ───────────────────────
// Canais: web (POST /chat) e WhatsApp (webhook). Memória + finanças + lembretes
// persistidos no Upstash. Usa GPT-4o com function-calling para EXECUTAR ações.
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const crypto = require('crypto');
const vault = require('../lib/vault');

const router = express.Router();
let _openai = null;
const getOpenAI = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// Assistente pessoal de um único dono → namespace global "owner"
const NS = 'brain:owner';
const K = {
  tx:       `${NS}:tx`,
  reminders:`${NS}:reminders`,
  notes:    `${NS}:notes`,
  history:  `${NS}:history`,
  phone:    `${NS}:phone`,
};

// ── Persistência (Upstash) ────────────────────────────────────────────────────
const getArr  = async k => (await vault.getJSON(k)) || [];
const setArr  = (k, v) => vault.setJSON(k, v);
const newId   = () => crypto.randomUUID().slice(0, 8);

async function getOwnerPhone() { return (await vault.getJSON(K.phone)) || null; }
async function setOwnerPhone(p) { if (p) await vault.setJSON(K.phone, p); }

// ── Util de período ───────────────────────────────────────────────────────────
function periodStart(periodo) {
  const now = new Date();
  if (periodo === 'hoje')   { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); }
  if (periodo === 'semana') return now.getTime() - 7  * 864e5;
  if (periodo === 'mes')    return now.getTime() - 30 * 864e5;
  return 0; // tudo
}
const brl = n => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

// ── Ferramentas que o agente pode EXECUTAR ────────────────────────────────────
const TOOLS = [
  { type: 'function', function: {
    name: 'registrar_transacao',
    description: 'Registra uma despesa ou receita financeira do usuário',
    parameters: { type: 'object', properties: {
      tipo:      { type: 'string', enum: ['despesa', 'receita'] },
      valor:     { type: 'number', description: 'valor em reais (positivo)' },
      categoria: { type: 'string', description: 'ex: alimentação, transporte, salário, mercado, lazer' },
      descricao: { type: 'string' },
    }, required: ['tipo', 'valor'] },
  }},
  { type: 'function', function: {
    name: 'resumo_financeiro',
    description: 'Retorna balanço (receitas, despesas, saldo) e gastos por categoria do período',
    parameters: { type: 'object', properties: { periodo: { type: 'string', enum: ['hoje','semana','mes','tudo'] } } },
  }},
  { type: 'function', function: {
    name: 'listar_transacoes',
    description: 'Lista as transações do período',
    parameters: { type: 'object', properties: { periodo: { type: 'string', enum: ['hoje','semana','mes','tudo'] } } },
  }},
  { type: 'function', function: {
    name: 'criar_lembrete',
    description: 'Cria lembrete/compromisso para uma data-hora futura específica',
    parameters: { type: 'object', properties: {
      texto:  { type: 'string' },
      quando: { type: 'string', description: 'data-hora ISO 8601 com fuso -03:00 (America/Sao_Paulo)' },
    }, required: ['texto', 'quando'] },
  }},
  { type: 'function', function: {
    name: 'listar_lembretes',
    description: 'Lista lembretes/compromissos pendentes',
    parameters: { type: 'object', properties: {} },
  }},
  { type: 'function', function: {
    name: 'concluir_lembrete',
    description: 'Marca um lembrete como concluído pelo seu id',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  }},
  { type: 'function', function: {
    name: 'salvar_nota',
    description: 'Salva uma nota/informação para o usuário lembrar depois',
    parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  }},
  { type: 'function', function: {
    name: 'listar_notas',
    description: 'Lista as notas salvas',
    parameters: { type: 'object', properties: {} },
  }},
];

async function executeTool(name, args) {
  switch (name) {
    case 'registrar_transacao': {
      const tx = await getArr(K.tx);
      const item = { id: newId(), tipo: args.tipo, valor: Math.abs(Number(args.valor) || 0),
        categoria: (args.categoria || 'outros').toLowerCase(), descricao: args.descricao || '', ts: Date.now() };
      tx.push(item);
      await setArr(K.tx, tx.slice(-1000));
      return { ok: true, registrado: item };
    }
    case 'resumo_financeiro': {
      const tx = await getArr(K.tx);
      const since = periodStart(args.periodo || 'mes');
      const f = tx.filter(t => t.ts >= since);
      const despesas = f.filter(t => t.tipo === 'despesa').reduce((s,t) => s + t.valor, 0);
      const receitas = f.filter(t => t.tipo === 'receita').reduce((s,t) => s + t.valor, 0);
      const byCat = {};
      f.filter(t => t.tipo === 'despesa').forEach(t => { byCat[t.categoria] = (byCat[t.categoria] || 0) + t.valor; });
      return { periodo: args.periodo || 'mes', receitas, despesas, saldo: receitas - despesas,
        por_categoria: byCat, transacoes: f.length };
    }
    case 'listar_transacoes': {
      const tx = await getArr(K.tx);
      const since = periodStart(args.periodo || 'mes');
      return { transacoes: tx.filter(t => t.ts >= since).slice(-30).reverse() };
    }
    case 'criar_lembrete': {
      const rem = await getArr(K.reminders);
      const whenTs = Date.parse(args.quando);
      if (!whenTs) return { ok: false, erro: 'data inválida' };
      const item = { id: newId(), texto: args.texto, whenTs, done: false, notified: false, ts: Date.now() };
      rem.push(item);
      await setArr(K.reminders, rem);
      return { ok: true, lembrete: { ...item, quando: new Date(whenTs).toLocaleString('pt-BR') } };
    }
    case 'listar_lembretes': {
      const rem = await getArr(K.reminders);
      return { lembretes: rem.filter(r => !r.done).sort((a,b) => a.whenTs - b.whenTs)
        .map(r => ({ id: r.id, texto: r.texto, quando: new Date(r.whenTs).toLocaleString('pt-BR') })) };
    }
    case 'concluir_lembrete': {
      const rem = await getArr(K.reminders);
      const r = rem.find(x => x.id === args.id);
      if (r) { r.done = true; await setArr(K.reminders, rem); }
      return { ok: !!r };
    }
    case 'salvar_nota': {
      const notes = await getArr(K.notes);
      const item = { id: newId(), texto: args.texto, ts: Date.now() };
      notes.push(item);
      await setArr(K.notes, notes.slice(-500));
      return { ok: true, nota: item };
    }
    case 'listar_notas': {
      const notes = await getArr(K.notes);
      return { notas: notes.slice(-30).reverse() };
    }
    default:
      return { erro: 'ferramenta desconhecida' };
  }
}

// ── O agente: GPT-4o com loop de ferramentas ──────────────────────────────────
function systemPrompt() {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `Você é o CÉREBRO — o assistente pessoal inteligente, executor e proativo do Pedro. Sua segunda mente.
Data e hora atual (Brasília): ${agora}.

Você é secretário financeiro + de produtividade. Suas funções:
- FINANÇAS: registrar despesas e receitas, dar balanços, gastos por categoria.
- AGENDA: criar lembretes e compromissos, listar pendências.
- MEMÓRIA: salvar notas e informações importantes, recuperá-las.
- APOIO: responder dúvidas, ajudar a pensar e decidir.

Regras:
- SEMPRE use as ferramentas para executar de verdade (não invente que registrou — chame a função).
- Ao criar lembrete, converta expressões como "amanhã 15h", "sexta", "daqui 2h" para ISO 8601 com fuso -03:00 a partir da data/hora atual.
- Seja CONCISO e direto, tom de WhatsApp. Confirme o que fez de forma clara (ex: "✅ Anotei: R$ 50 em mercado").
- Valores em reais (R$). Responda em português do Brasil.
- Seja proativo: se faltar info essencial, pergunte em uma linha.`;
}

async function runBrain(userText) {
  const history = await getArr(K.history);
  const messages = [
    { role: 'system', content: systemPrompt() },
    ...history,
    { role: 'user', content: userText },
  ];

  let finalText = '';
  const executed = [];
  for (let i = 0; i < 6; i++) {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o', messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.4,
    });
    const msg = res.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) { finalText = msg.content || ''; break; }

    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      const result = await executeTool(tc.function.name, args);
      executed.push(tc.function.name);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  if (!finalText) finalText = 'Feito! ✅';

  // Salva histórico (últimas 16 mensagens user/assistant)
  const newHistory = [...history, { role: 'user', content: userText }, { role: 'assistant', content: finalText }].slice(-16);
  await setArr(K.history, newHistory);

  return { reply: finalText, executed };
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.META_WHATSAPP_TOKEN;
  if (!phoneId || !token) { console.warn('[wa] phoneId/token ausentes — não enviado'); return false; }
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    return true;
  } catch (e) {
    console.error('[wa] envio falhou:', e.response?.data?.error?.message || e.message);
    return false;
  }
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

// POST /api/brain/chat — canal web (testar o assistente sem WhatsApp)
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'mensagem vazia' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
  if (!vault.enabled()) return res.status(503).json({ error: 'Memória (Upstash) não configurada' });
  try {
    const { reply, executed } = await runBrain(message.trim());
    res.json({ reply, executed });
  } catch (e) {
    console.error('[brain/chat] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/brain/dashboard — painel financeiro + lembretes + notas
router.get('/dashboard', async (req, res) => {
  if (!vault.enabled()) return res.json({ enabled: false });
  try {
    const [tx, rem, notes, phone] = await Promise.all([
      getArr(K.tx), getArr(K.reminders), getArr(K.notes), getOwnerPhone(),
    ]);
    const since = periodStart('mes');
    const mtx = tx.filter(t => t.ts >= since);
    const despesas = mtx.filter(t => t.tipo === 'despesa').reduce((s,t) => s + t.valor, 0);
    const receitas = mtx.filter(t => t.tipo === 'receita').reduce((s,t) => s + t.valor, 0);
    const byCat = {};
    mtx.filter(t => t.tipo === 'despesa').forEach(t => { byCat[t.categoria] = (byCat[t.categoria] || 0) + t.valor; });
    res.json({
      enabled: true,
      whatsappLinked: !!phone,
      financeiro: { saldo: receitas - despesas, despesas, receitas, por_categoria: byCat },
      lembretes: rem.filter(r => !r.done).sort((a,b) => a.whenTs - b.whenTs)
        .map(r => ({ id: r.id, texto: r.texto, quando: new Date(r.whenTs).toLocaleString('pt-BR') })).slice(0, 10),
      transacoes: tx.slice(-12).reverse(),
      notas: notes.slice(-10).reverse(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/brain/webhook — verificação do webhook do Meta
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[wa] webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST /api/brain/webhook — mensagens recebidas do WhatsApp
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // ACK imediato (Meta exige < 5s)
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;
    const from = msg.from;
    await setOwnerPhone(from);
    const text = msg.type === 'text' ? msg.text.body
      : msg.type === 'button' ? msg.button?.text
      : null;
    if (!text) { await sendWhatsApp(from, 'Por enquanto só entendo texto 🙂'); return; }
    const { reply } = await runBrain(text);
    await sendWhatsApp(from, reply);
  } catch (e) {
    console.error('[wa/webhook] erro:', e.message);
  }
});

// GET /api/brain/tick — dispara lembretes vencidos (chamado por cron)
router.get('/tick', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'não autorizado' });
  }
  if (!vault.enabled()) return res.status(503).json({ error: 'memória não configurada' });
  try {
    const rem = await getArr(K.reminders);
    const phone = await getOwnerPhone();
    const now = Date.now();
    let sent = 0;
    for (const r of rem) {
      if (!r.done && !r.notified && r.whenTs <= now) {
        if (phone) await sendWhatsApp(phone, `⏰ Lembrete: ${r.texto}`);
        r.notified = true;
        sent++;
      }
    }
    if (sent) await setArr(K.reminders, rem);
    res.json({ ok: true, disparados: sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
