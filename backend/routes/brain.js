// ── Cérebro — assessor financeiro inteligente ─────────────────────────────────
// Canais: web (POST /chat) e WhatsApp (webhook + imagens/comprovantes)
// Memória: Upstash Redis. Agente: GPT-4o function-calling.
const express = require('express');
const axios   = require('axios');
const { OpenAI } = require('openai');
const crypto  = require('crypto');
const vault   = require('../lib/vault');

const router = express.Router();

const BRAIN_TOKEN = process.env.BRAIN_TOKEN;
function authBrain(req, res, next) {
  if (!BRAIN_TOKEN) return next(); // skip if not configured
  const auth = req.headers.authorization;
  if (auth === `Bearer ${BRAIN_TOKEN}`) return next();
  // Allow webhook (Meta calls without our token)
  if (req.path === '/webhook') return next();
  // Allow tick (cron calls)
  if (req.path === '/tick') return next();
  res.status(401).json({ error: 'não autorizado' });
}
router.use(authBrain);

let _openai = null;
const getOpenAI = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

const NS = 'brain:owner';
const K = {
  tx:       `${NS}:tx`,
  reminders:`${NS}:reminders`,
  notes:    `${NS}:notes`,
  history:  `${NS}:history`,
  phone:    `${NS}:phone`,
  bills:    `${NS}:bills`,
};

// ── Persistência ──────────────────────────────────────────────────────────────
const getArr = async k => (await vault.getJSON(k)) || [];
const setArr = (k, v) => vault.setJSON(k, v);
const newId  = () => crypto.randomUUID().slice(0, 12);

async function getOwnerPhone() { return (await vault.getJSON(K.phone)) || null; }
async function setOwnerPhone(p) { if (p) await vault.setJSON(K.phone, p); }

// ── Util ──────────────────────────────────────────────────────────────────────
function periodStart(periodo) {
  const now = new Date();
  if (periodo === 'hoje')   { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); }
  if (periodo === 'semana') return now.getTime() - 7  * 864e5;
  if (periodo === 'mes')    { const d = new Date(now); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); }
  return 0;
}
const brl = n => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

function diasRestantesMes() {
  const now = new Date();
  const fim = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return fim.getDate() - now.getDate();
}

// ── Ferramentas ───────────────────────────────────────────────────────────────
const TOOLS = [
  { type: 'function', function: {
    name: 'registrar_transacao',
    description: 'Registra uma despesa ou receita. Use sempre que o usuário mencionar gasto, pagamento, compra ou recebimento.',
    parameters: { type: 'object', properties: {
      tipo:      { type: 'string', enum: ['despesa', 'receita'] },
      valor:     { type: 'number', description: 'valor em reais (positivo)' },
      categoria: { type: 'string', description: 'ex: alimentação, transporte, moradia, saúde, lazer, salário, mercado, assinaturas, educação' },
      descricao: { type: 'string', description: 'descrição curta do que foi gasto/recebido' },
    }, required: ['tipo', 'valor', 'categoria'] },
  }},
  { type: 'function', function: {
    name: 'resumo_financeiro',
    description: 'Mostra balanço completo: receitas, despesas, saldo e gastos por categoria no período',
    parameters: { type: 'object', properties: { periodo: { type: 'string', enum: ['hoje','semana','mes','tudo'] } } },
  }},
  { type: 'function', function: {
    name: 'listar_transacoes',
    description: 'Lista histórico de transações do período com detalhes',
    parameters: { type: 'object', properties: {
      periodo: { type: 'string', enum: ['hoje','semana','mes','tudo'] },
      tipo:    { type: 'string', enum: ['despesa','receita','todos'], description: 'filtrar por tipo' },
    }},
  }},
  { type: 'function', function: {
    name: 'registrar_conta',
    description: 'Registra uma conta a pagar (fixa mensal ou única). Ex: aluguel, luz, água, cartão, boleto.',
    parameters: { type: 'object', properties: {
      nome:       { type: 'string', description: 'nome da conta (ex: Aluguel, Conta de Luz, Netflix)' },
      valor:      { type: 'number', description: 'valor estimado em reais' },
      dia_venc:   { type: 'number', description: 'dia do mês para vencimento (1-31)' },
      recorrente: { type: 'boolean', description: 'true = todo mês, false = só uma vez' },
      categoria:  { type: 'string', description: 'ex: moradia, serviços, assinaturas, educação' },
    }, required: ['nome', 'valor', 'dia_venc'] },
  }},
  { type: 'function', function: {
    name: 'listar_contas',
    description: 'Lista contas a pagar: próximas a vencer, já pagas e atrasadas',
    parameters: { type: 'object', properties: {
      filtro: { type: 'string', enum: ['pendentes','pagas','todas','proximas'], description: 'proximas = vence em 7 dias' },
    }},
  }},
  { type: 'function', function: {
    name: 'pagar_conta',
    description: 'Marca uma conta como paga e registra a despesa automaticamente',
    parameters: { type: 'object', properties: {
      id:    { type: 'string', description: 'id da conta' },
      valor_real: { type: 'number', description: 'valor real pago (se diferente do estimado)' },
    }, required: ['id'] },
  }},
  { type: 'function', function: {
    name: 'previsao_financeira',
    description: 'Calcula previsão de gastos até o fim do mês considerando ritmo atual + contas a pagar pendentes',
    parameters: { type: 'object', properties: {} },
  }},
  { type: 'function', function: {
    name: 'analise_gastos',
    description: 'Análise detalhada dos gastos: tendências, categorias problemáticas, comparação com mês anterior, dicas de economia',
    parameters: { type: 'object', properties: {} },
  }},
  { type: 'function', function: {
    name: 'criar_lembrete',
    description: 'Cria lembrete ou compromisso para data-hora futura',
    parameters: { type: 'object', properties: {
      texto:  { type: 'string' },
      quando: { type: 'string', description: 'ISO 8601 com fuso -03:00' },
    }, required: ['texto', 'quando'] },
  }},
  { type: 'function', function: {
    name: 'listar_lembretes',
    description: 'Lista lembretes e compromissos pendentes',
    parameters: { type: 'object', properties: {} },
  }},
  { type: 'function', function: {
    name: 'concluir_lembrete',
    description: 'Marca lembrete como concluído',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  }},
  { type: 'function', function: {
    name: 'salvar_nota',
    description: 'Salva nota ou informação importante para consultar depois',
    parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  }},
  { type: 'function', function: {
    name: 'listar_notas',
    description: 'Lista notas salvas',
    parameters: { type: 'object', properties: {} },
  }},
  { type: 'function', function: {
    name: 'limpar_historico',
    description: 'Limpa o histórico de conversa. Use quando o usuário pedir para recomeçar.',
    parameters: { type: 'object', properties: {} },
  }},
];

// ── Executor de ferramentas ───────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {

    case 'registrar_transacao': {
      const tx = await getArr(K.tx);
      const item = { id: newId(), tipo: args.tipo,
        valor: Math.abs(Number(args.valor) || 0),
        categoria: (args.categoria || 'outros').toLowerCase(),
        descricao: args.descricao || '', ts: Date.now() };
      tx.push(item);
      await setArr(K.tx, tx.slice(-2000));
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
      const topCat = Object.entries(byCat).sort((a,b) => b[1]-a[1]).slice(0, 5);
      return { periodo: args.periodo || 'mes', receitas, despesas, saldo: receitas - despesas,
        por_categoria: byCat, top_categorias: topCat, total_transacoes: f.length };
    }

    case 'listar_transacoes': {
      const tx = await getArr(K.tx);
      const since = periodStart(args.periodo || 'mes');
      let f = tx.filter(t => t.ts >= since);
      if (args.tipo && args.tipo !== 'todos') f = f.filter(t => t.tipo === args.tipo);
      return { transacoes: f.slice(-50).reverse(), total: f.length };
    }

    case 'registrar_conta': {
      const bills = await getArr(K.bills);
      const item = {
        id: newId(),
        nome: args.nome,
        valor: Math.abs(Number(args.valor) || 0),
        dia_venc: Number(args.dia_venc),
        recorrente: args.recorrente !== false,
        categoria: (args.categoria || 'serviços').toLowerCase(),
        pago: false,
        pago_em: null,
        criado_em: Date.now(),
        mes_ref: new Date().toISOString().slice(0, 7),
      };
      bills.push(item);
      await setArr(K.bills, bills.slice(-500));
      return { ok: true, conta: item };
    }

    case 'listar_contas': {
      const bills = await getArr(K.bills);
      const now = new Date();
      const diaHoje = now.getDate();
      const mesHoje = now.toISOString().slice(0, 7);
      const filtro = args.filtro || 'pendentes';

      const enriched = bills.map(b => {
        const atrasada = !b.pago && b.dia_venc < diaHoje && b.mes_ref === mesHoje;
        const proximaSemana = !b.pago && b.dia_venc >= diaHoje && b.dia_venc <= diaHoje + 7;
        return { ...b, atrasada, proxima_semana: proximaSemana };
      });

      let filtered;
      if (filtro === 'pendentes') filtered = enriched.filter(b => !b.pago);
      else if (filtro === 'pagas') filtered = enriched.filter(b => b.pago);
      else if (filtro === 'proximas') filtered = enriched.filter(b => !b.pago && b.dia_venc <= diaHoje + 7);
      else filtered = enriched;

      const totalPendente = filtered.filter(b => !b.pago).reduce((s,b) => s + b.valor, 0);
      return { contas: filtered.sort((a,b) => a.dia_venc - b.dia_venc), total_pendente: totalPendente };
    }

    case 'pagar_conta': {
      const bills = await getArr(K.bills);
      const b = bills.find(x => x.id === args.id);
      if (!b) return { ok: false, erro: 'conta não encontrada' };
      const valorPago = args.valor_real || b.valor;
      b.pago = true;
      b.pago_em = Date.now();
      b.valor_pago = valorPago;

      // Se for recorrente, cria a próxima para o mês seguinte
      if (b.recorrente) {
        const prox = new Date();
        prox.setMonth(prox.getMonth() + 1);
        const mesProx = prox.toISOString().slice(0, 7);
        const jaExiste = bills.some(x => x.nome === b.nome && x.mes_ref === mesProx && !x.pago);
        if (!jaExiste) {
          bills.push({ id: newId(), nome: b.nome, valor: b.valor, dia_venc: b.dia_venc,
            recorrente: true, categoria: b.categoria, pago: false, pago_em: null,
            criado_em: Date.now(), mes_ref: mesProx });
        }
      }
      await setArr(K.bills, bills);

      // Registra automaticamente como despesa
      const tx = await getArr(K.tx);
      tx.push({ id: newId(), tipo: 'despesa', valor: valorPago,
        categoria: b.categoria, descricao: b.nome, ts: Date.now() });
      await setArr(K.tx, tx.slice(-2000));

      return { ok: true, conta: b.nome, valor_pago: brl(valorPago) };
    }

    case 'previsao_financeira': {
      const [tx, bills] = await Promise.all([getArr(K.tx), getArr(K.bills)]);
      const since = periodStart('mes');
      const gastosMes = tx.filter(t => t.ts >= since && t.tipo === 'despesa')
        .reduce((s,t) => s + t.valor, 0);
      const receitasMes = tx.filter(t => t.ts >= since && t.tipo === 'receita')
        .reduce((s,t) => s + t.valor, 0);

      const now = new Date();
      const diaHoje = now.getDate();
      const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const diasPassados = diaHoje;
      const diasRestantes = diasMes - diaHoje;

      // Ritmo diário de gastos
      const ritmoDiario = diasPassados > 0 ? gastosMes / diasPassados : 0;
      const previsaoRitmo = gastosMes + (ritmoDiario * diasRestantes);

      // Contas pendentes no mês
      const mesHoje = now.toISOString().slice(0, 7);
      const contasPendentes = bills.filter(b => !b.pago && b.mes_ref === mesHoje);
      const totalContasPendentes = contasPendentes.reduce((s,b) => s + b.valor, 0);

      const previsaoTotal = previsaoRitmo + totalContasPendentes;

      return {
        hoje: { dia: diaHoje, de: diasMes },
        gastos_ate_agora: gastosMes,
        receitas_ate_agora: receitasMes,
        ritmo_diario: ritmoDiario,
        previsao_pelo_ritmo: previsaoRitmo,
        contas_pendentes: contasPendentes.length,
        valor_contas_pendentes: totalContasPendentes,
        previsao_total_mes: previsaoTotal,
        saldo_previsto: receitasMes - previsaoTotal,
        alertas: previsaoTotal > receitasMes
          ? [`⚠️ Previsão de gasto (${brl(previsaoTotal)}) ultrapassa receita (${brl(receitasMes)})`]
          : [],
      };
    }

    case 'analise_gastos': {
      const tx = await getArr(K.tx);
      const now = Date.now();
      const mesAtual = periodStart('mes');
      const mesAnterior = mesAtual - 30 * 864e5;

      const atual = tx.filter(t => t.ts >= mesAtual);
      const anterior = tx.filter(t => t.ts >= mesAnterior && t.ts < mesAtual);

      const somarDespesas = arr => arr.filter(t => t.tipo === 'despesa').reduce((s,t) => s+t.valor, 0);
      const porCategoria = arr => {
        const m = {};
        arr.filter(t => t.tipo === 'despesa').forEach(t => { m[t.categoria] = (m[t.categoria]||0)+t.valor; });
        return m;
      };

      const gastosAtual = somarDespesas(atual);
      const gastosAnterior = somarDespesas(anterior);
      const catAtual = porCategoria(atual);
      const catAnterior = porCategoria(anterior);

      // Top 5 categorias atuais
      const top = Object.entries(catAtual).sort((a,b) => b[1]-a[1]).slice(0, 5);

      // Variações
      const variacoes = top.map(([cat, val]) => ({
        categoria: cat, atual: val, anterior: catAnterior[cat] || 0,
        variacao_pct: catAnterior[cat] ? ((val - catAnterior[cat]) / catAnterior[cat] * 100).toFixed(0) : null,
      }));

      return {
        mes_atual: { gastos: gastosAtual, receitas: somarDespesas(anterior) },
        comparacao_mes_anterior: { gastos_anterior: gastosAnterior, variacao_pct: gastosAnterior ? ((gastosAtual-gastosAnterior)/gastosAnterior*100).toFixed(0) : null },
        top_categorias: variacoes,
        maior_gasto_categoria: top[0]?.[0] || null,
        total_transacoes_mes: atual.length,
      };
    }

    case 'criar_lembrete': {
      const rem = await getArr(K.reminders);
      const whenTs = Date.parse(args.quando);
      if (!whenTs) return { ok: false, erro: 'data inválida' };
      if (whenTs < Date.now() - 60000) return { ok: false, erro: 'data no passado — use uma data futura' };
      const item = { id: newId(), texto: args.texto, whenTs, done: false, notified: false, ts: Date.now() };
      rem.push(item);
      await setArr(K.reminders, rem);
      return { ok: true, lembrete: { ...item, quando: new Date(whenTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) } };
    }

    case 'listar_lembretes': {
      const rem = await getArr(K.reminders);
      return { lembretes: rem.filter(r => !r.done).sort((a,b) => a.whenTs - b.whenTs)
        .map(r => ({ id: r.id, texto: r.texto, quando: new Date(r.whenTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) })) };
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

    case 'limpar_historico': {
      await setArr(K.history, []);
      return { ok: true, mensagem: 'histórico limpo' };
    }

    default:
      return { erro: 'ferramenta desconhecida' };
  }
}

// ── Sistema de prompt ─────────────────────────────────────────────────────────
function systemPrompt() {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const diaHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' });
  return `Você é o CÉREBRO — assessor financeiro pessoal inteligente do Pedro. Sua segunda mente.
Data/hora atual (Brasília): ${agora} (${diaHoje}).

## Funções principais
- ASSESSOR FINANCEIRO: registrar despesas/receitas, analisar padrões, dar alertas, fazer previsões
- CONTAS A PAGAR: cadastrar contas fixas (aluguel, luz, água, cartão), alertar sobre vencimentos
- COMPROVANTES: quando o usuário enviar imagem de comprovante, os dados já foram extraídos e enviados junto
- AGENDA: criar lembretes e compromissos com horário
- MEMÓRIA: salvar notas e informações importantes
- CONSELHEIRO: dar dicas de economia, analisar tendências, prever problemas

## Mapeamento de intenções → ferramentas
- "gastei / comprei / paguei X" → registrar_transacao (despesa)
- "recebi / ganhei / entrou X" → registrar_transacao (receita)
- "cadastra conta / conta fixa / mensal / aluguel / luz / água / cartão" → registrar_conta (NÃO criar_lembrete!)
- "paguei a conta de [nome]" → pagar_conta (busca pelo nome e marca como paga)
- "quanto gastei / saldo / balanço" → resumo_financeiro
- "previsão / quanto vou gastar" → previsao_financeira
- "analisa / padrão / tendência" → analise_gastos
- "lista contas / próximas contas" → listar_contas
- "me lembra / compromisso / reunião" → criar_lembrete (apenas para AGENDA, nunca para contas fixas!)

## Regras de ouro
- SEMPRE use as ferramentas para executar — nunca diga que registrou sem chamar a função
- Para CONTAS FIXAS MENSAIS (aluguel, luz, água, internet, cartão) use SEMPRE registrar_conta, NUNCA criar_lembrete
- Ao criar lembrete, converta "amanhã 15h", "sexta", "daqui 2h" para ISO 8601 com fuso -03:00
- Seja CONCISO, tom de WhatsApp. Confirme sempre o que fez (ex: "✅ R$ 50 em mercado — registrado")
- Seja PROATIVO: ao registrar gastos altos, comente; ao ver padrão preocupante, avise
- Se o usuário disser "paguei [conta]", use pagar_conta se existir, ou registrar_transacao
- Responda em português BR. Valores sempre em reais (R$)
- Para qualquer análise de gastos, use analise_gastos ou previsao_financeira — não invente números`;
}

// ── Leitura de comprovante via GPT-4o Vision ──────────────────────────────────
async function extractFromReceipt(base64, mimeType) {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
          { type: 'text', text: `Analise este comprovante/recibo e extraia as informações financeiras. Retorne JSON:
{
  "tipo": "despesa" ou "receita",
  "valor": número em reais,
  "descricao": "descrição curta do que foi",
  "categoria": "uma de: alimentação, transporte, moradia, saúde, lazer, mercado, assinaturas, educação, serviços, outros",
  "estabelecimento": "nome do estabelecimento se visível",
  "data": "data do comprovante se visível (ISO)",
  "confianca": "alta" ou "média" ou "baixa"
}
Se não conseguir extrair valor, retorne {"erro": "não identificado"}.` }
        ]
      }],
      max_tokens: 300,
      temperature: 0,
    });
    const text = res.choices[0].message.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('[receipt] extração falhou:', e.message);
    return null;
  }
}

// ── Download de mídia do WhatsApp ─────────────────────────────────────────────
async function downloadWhatsAppMedia(mediaId) {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) return null;
  try {
    const urlRes = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const mediaUrl = urlRes.data.url;
    const mimeType = urlRes.data.mime_type || 'image/jpeg';

    const imgRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 20000,
    });
    const base64 = Buffer.from(imgRes.data).toString('base64');
    return { base64, mimeType };
  } catch (e) {
    console.error('[media] download falhou:', e.message);
    return null;
  }
}

// ── Agente GPT-4o ─────────────────────────────────────────────────────────────
async function runBrain(userText, imageBase64 = null, imageMime = null) {
  const history = await getArr(K.history);

  let userContent = userText;
  if (imageBase64) {
    userContent = [
      { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}`, detail: 'high' } },
      { type: 'text', text: userText || 'Analise este comprovante e registre o valor.' },
    ];
  }

  const messages = [
    { role: 'system', content: systemPrompt() },
    ...history,
    { role: 'user', content: userContent },
  ];

  let finalText = '';
  const executed = [];
  for (let i = 0; i < 8; i++) {
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

  // Salva histórico com texto simples (não imagem)
  const newHistory = [
    ...history,
    { role: 'user', content: userText || '📎 comprovante' },
    { role: 'assistant', content: finalText }
  ].slice(-20);
  await setArr(K.history, newHistory);

  return { reply: finalText, executed };
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.META_WHATSAPP_TOKEN;
  if (!phoneId || !token) { console.warn('[wa] phoneId/token ausentes'); return false; }
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

// POST /api/brain/chat
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'mensagem vazia' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
  if (!vault.enabled()) return res.status(503).json({ error: 'Memória não configurada' });
  try {
    const { reply, executed } = await runBrain(message.trim());
    res.json({ reply, executed });
  } catch (e) {
    console.error('[brain/chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/brain/reset — admin: limpa histórico de conversa
router.get('/reset', async (req, res) => {
  await setArr(K.history, []);
  res.json({ ok: true, message: 'histórico limpo' });
});

// GET /api/brain/dashboard
router.get('/dashboard', async (req, res) => {
  if (!vault.enabled()) return res.json({ enabled: false });
  try {
    const [tx, rem, notes, phone, bills] = await Promise.all([
      getArr(K.tx), getArr(K.reminders), getArr(K.notes), getOwnerPhone(), getArr(K.bills),
    ]);
    const since = periodStart('mes');
    const mtx = tx.filter(t => t.ts >= since);
    const despesas = mtx.filter(t => t.tipo === 'despesa').reduce((s,t) => s + t.valor, 0);
    const receitas = mtx.filter(t => t.tipo === 'receita').reduce((s,t) => s + t.valor, 0);
    const byCat = {};
    mtx.filter(t => t.tipo === 'despesa').forEach(t => { byCat[t.categoria] = (byCat[t.categoria] || 0) + t.valor; });

    const now = new Date();
    const diaHoje = now.getDate();
    const mesHoje = now.toISOString().slice(0, 7);
    const contasPendentes = bills.filter(b => !b.pago && b.mes_ref === mesHoje);
    const contasProximas = contasPendentes.filter(b => b.dia_venc <= diaHoje + 7);

    res.json({
      enabled: true,
      whatsappLinked: !!phone,
      financeiro: { saldo: receitas - despesas, despesas, receitas, por_categoria: byCat },
      lembretes: rem.filter(r => !r.done).sort((a,b) => a.whenTs - b.whenTs)
        .map(r => ({ id: r.id, texto: r.texto, quando: new Date(r.whenTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) })).slice(0, 10),
      transacoes: tx.slice(-20).reverse(),
      notas: notes.slice(-10).reverse(),
      contas: {
        pendentes: contasPendentes.length,
        proximas_7_dias: contasProximas.length,
        total_pendente: contasPendentes.reduce((s,b) => s + b.valor, 0),
        lista: contasPendentes.sort((a,b) => a.dia_venc - b.dia_venc).slice(0, 10),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/brain/webhook — verificação Meta
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

// POST /api/brain/webhook — mensagens recebidas
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // ACK imediato
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    await setOwnerPhone(from);

    // ── Imagem / comprovante ──
    if (msg.type === 'image' || msg.type === 'document') {
      const mediaId = msg.image?.id || msg.document?.id;
      if (!mediaId) {
        await sendWhatsApp(from, '📎 Recebi o arquivo, mas não consegui baixar. Tente enviar como imagem.');
        return;
      }
      await sendWhatsApp(from, '📄 Lendo comprovante...');
      const media = await downloadWhatsAppMedia(mediaId);
      if (!media) {
        await sendWhatsApp(from, '❌ Não consegui baixar o comprovante. Pode me informar o valor manualmente?');
        return;
      }
      const extraido = await extractFromReceipt(media.base64, media.mimeType);
      if (!extraido || extraido.erro || !extraido.valor) {
        await sendWhatsApp(from, '🤔 Não consegui identificar o valor no comprovante. Pode me dizer quanto foi e o que pagou?');
        return;
      }
      // Auto-registra a transação
      const tx = await getArr(K.tx);
      const item = { id: newId(), tipo: extraido.tipo || 'despesa',
        valor: Math.abs(Number(extraido.valor)),
        categoria: extraido.categoria || 'outros',
        descricao: extraido.descricao || extraido.estabelecimento || 'comprovante',
        ts: Date.now() };
      tx.push(item);
      await setArr(K.tx, tx.slice(-2000));
      const conf = extraido.confianca === 'alta' ? '✅' : '⚠️';
      await sendWhatsApp(from, `${conf} Comprovante lido!\n\n${item.tipo === 'despesa' ? '💸' : '💰'} ${brl(item.valor)} — ${item.descricao}\n📂 ${item.categoria}${extraido.estabelecimento ? `\n🏪 ${extraido.estabelecimento}` : ''}${extraido.confianca !== 'alta' ? '\n\n⚠️ Confira se está correto.' : ''}`);
      return;
    }

    // ── Áudio ──
    if (msg.type === 'audio') {
      await sendWhatsApp(from, '🎤 Por enquanto só processo texto e comprovantes (imagem). Me escreva o que aconteceu!');
      return;
    }

    // ── Texto ──
    const text = msg.type === 'text' ? msg.text.body
      : msg.type === 'button' ? msg.button?.text
      : null;
    if (!text) return;

    const { reply } = await runBrain(text);
    await sendWhatsApp(from, reply);

  } catch (e) {
    console.error('[wa/webhook] erro:', e.message);
  }
});

// GET /api/brain/tick — cron: lembretes + alertas de contas
router.get('/tick', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'não autorizado' });
  }
  if (!vault.enabled()) return res.status(503).json({ error: 'memória não configurada' });
  try {
    const [rem, bills, phone] = await Promise.all([
      getArr(K.reminders), getArr(K.bills), getOwnerPhone(),
    ]);
    const now = Date.now();
    const nowDate = new Date();
    const diaHoje = nowDate.getDate();
    const mesHoje = nowDate.toISOString().slice(0, 7);
    let sentRem = 0, sentBills = 0;

    // Dispara lembretes vencidos
    for (const r of rem) {
      if (!r.done && !r.notified && r.whenTs <= now) {
        if (phone) await sendWhatsApp(phone, `⏰ *Lembrete:* ${r.texto}`);
        r.notified = true;
        sentRem++;
      }
    }
    if (sentRem) await setArr(K.reminders, rem);

    // Alerta contas: vence hoje ou amanhã
    if (phone) {
      const urgentes = bills.filter(b =>
        !b.pago && b.mes_ref === mesHoje &&
        (b.dia_venc === diaHoje || b.dia_venc === diaHoje + 1)
      );
      for (const b of urgentes) {
        const quando = b.dia_venc === diaHoje ? '*hoje*' : '*amanhã*';
        await sendWhatsApp(phone, `💳 Conta vence ${quando}!\n\n*${b.nome}* — ${brl(b.valor)}\nCategoria: ${b.categoria}`);
        sentBills++;
      }

      // Alerta contas atrasadas (às 9h)
      const horaAtual = nowDate.getHours();
      if (horaAtual >= 9 && horaAtual < 10) {
        const atrasadas = bills.filter(b =>
          !b.pago && b.mes_ref === mesHoje && b.dia_venc < diaHoje
        );
        if (atrasadas.length > 0) {
          const lista = atrasadas.map(b => `• ${b.nome}: ${brl(b.valor)} (dia ${b.dia_venc})`).join('\n');
          await sendWhatsApp(phone, `🚨 *Contas em atraso:*\n\n${lista}\n\nTotal: ${brl(atrasadas.reduce((s,b) => s+b.valor, 0))}`);
        }
      }
    }

    res.json({ ok: true, lembretes_disparados: sentRem, alertas_contas: sentBills });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
