const express = require('express');
const router = express.Router();
const { sendText, downloadMedia, markRead } = require('../services/whatsapp');
const { extractFromReceipt, understandMessage, generateReport } = require('../services/ai');
const supabase = require('../services/supabase');

// Verificação do webhook pelo Meta
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recebe mensagens
router.post('/', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;

    if (!change?.messages?.length) {
      return res.sendStatus(200);
    }

    const msg = change.messages[0];
    const from = msg.from;
    const msgId = msg.id;

    // Processar antes de responder (Vercel encerra função após res.send)
    // Timeout de segurança: responde 200 em 18s mesmo que não termine
    const timeout = setTimeout(() => {
      if (!res.headersSent) res.sendStatus(200);
    }, 18000);

    try {
      await markRead(msgId);
      await ensureUser(from, change.contacts?.[0]?.profile?.name);

      if (msg.type === 'image') {
        await handleImage(from, msg.image);
      } else if (msg.type === 'text') {
        await handleText(from, msg.text.body, msgId);
      } else {
        await sendText(from, 'Entendo apenas fotos de comprovantes e mensagens de texto. 😊');
      }
    } catch (err) {
      console.error('Webhook processing error:', err?.message || err);
      try {
        await sendText(from, 'Tive um problema aqui. Pode tentar novamente? 🙏');
      } catch (_) {}
    } finally {
      clearTimeout(timeout);
    }

    if (!res.headersSent) res.sendStatus(200);
  } catch (err) {
    console.error('Webhook fatal error:', err?.message || err);
    if (!res.headersSent) res.sendStatus(200);
  }
});

async function ensureUser(phone, name) {
  const { data } = await supabase.from('users').select('id').eq('phone', phone).single();
  if (!data) {
    await supabase.from('users').insert({ phone, name: name || phone });
  }
}

async function getUser(phone) {
  const { data } = await supabase.from('users').select('*').eq('phone', phone).single();
  return data;
}

async function handleImage(from, image) {
  await sendText(from, '🔍 Lendo seu comprovante...');

  const { buffer, mimeType } = await downloadMedia(image.id);
  const extracted = await extractFromReceipt(buffer, mimeType);

  if (extracted.confianca === 'baixa') {
    await sendText(from, '⚠️ Não consegui ler bem este comprovante. Pode mandar uma foto mais nítida ou me dizer o valor manualmente?');
    return;
  }

  const user = await getUser(from);
  const { error } = await supabase.from('transactions').insert({
    user_id: user.id,
    tipo: extracted.tipo,
    valor: extracted.valor,
    data: extracted.data,
    descricao: extracted.descricao,
    categoria: extracted.categoria,
    origem: 'comprovante',
  });

  if (error) throw error;

  const emoji = extracted.tipo === 'receita' ? '✅' : '💸';
  const tipoStr = extracted.tipo === 'receita' ? 'Receita' : 'Despesa';
  await sendText(
    from,
    `${emoji} *${tipoStr} registrada!*\n💰 R$ ${Number(extracted.valor).toFixed(2)}\n📝 ${extracted.descricao}\n🏷️ ${extracted.categoria}\n📅 ${formatDate(extracted.data)}`
  );
}

async function handleText(from, text, msgId) {
  const user = await getUser(from);
  const context = await buildContext(user.id);
  const result = await understandMessage(text, context);

  switch (result.intent) {
    case 'registrar_despesa':
    case 'registrar_receita':
      await registerTransaction(from, user.id, result);
      break;
    case 'cadastrar_conta_fixa':
      await registerRecurringBill(from, user.id, result);
      break;
    case 'confirmar_pagamento':
      await confirmPayment(from, user.id, result);
      break;
    case 'consultar_saldo':
    case 'consultar_extrato':
      await sendReport(from, user.id, result.dados?.periodo || 'mes_atual');
      break;
    case 'listar_contas_pendentes':
      await listPendingBills(from, user.id);
      break;
    case 'ajuda':
      await sendHelp(from);
      break;
    default:
      await sendText(from, result.resposta_curta || 'Não entendi. Pode me dizer o que precisa?');
  }
}

async function registerTransaction(from, userId, result) {
  const d = result.dados;
  if (!d.valor) {
    await sendText(from, 'Qual o valor? Me manda algo como "gastei R$ 50 no mercado" 🛒');
    return;
  }
  await supabase.from('transactions').insert({
    user_id: userId,
    tipo: result.intent === 'registrar_receita' ? 'receita' : 'despesa',
    valor: d.valor,
    data: d.data || new Date().toISOString().split('T')[0],
    descricao: d.descricao || 'Sem descrição',
    categoria: d.categoria || 'Outros',
    origem: 'texto',
  });
  await sendText(from, result.resposta_curta);
}

async function registerRecurringBill(from, userId, result) {
  const d = result.dados;
  if (!d.nome || !d.dia_vencimento) {
    await sendText(from, 'Me conta o nome da conta e o dia de vencimento. Ex: "luz vence todo dia 10, uns 250 reais" 💡');
    return;
  }
  await supabase.from('recurring_bills').insert({
    user_id: userId,
    nome: d.nome,
    valor_estimado: d.valor_estimado,
    dia_vencimento: d.dia_vencimento,
    categoria: d.categoria || 'Outros',
  });
  await sendText(from, `✅ Conta fixa cadastrada!\n📋 *${d.nome}*\n💰 ~R$ ${d.valor_estimado ? Number(d.valor_estimado).toFixed(2) : '?'}\n📅 Vence todo dia ${d.dia_vencimento}`);
}

async function confirmPayment(from, userId, result) {
  // Busca a conta fixa mais provável com base no contexto
  const { data: bills } = await supabase
    .from('recurring_bills')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);

  if (!bills?.length) {
    await sendText(from, 'Não encontrei contas fixas cadastradas. Você pode mandar o comprovante para eu registrar. 📸');
    return;
  }

  // Marca a mais recente como paga
  const bill = bills[0];
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('bill_payments').insert({
    recurring_bill_id: bill.id,
    user_id: userId,
    paid_at: today,
    valor_pago: result.dados?.valor || bill.valor_estimado,
  });
  await sendText(from, `✅ *${bill.nome}* marcada como paga!\n💰 R$ ${result.dados?.valor ? Number(result.dados.valor).toFixed(2) : Number(bill.valor_estimado).toFixed(2)}\n📅 ${formatDate(today)}`);
}

async function sendReport(from, userId, period) {
  const now = new Date();
  let startDate, endDate;
  let periodLabel;

  if (period === 'mes_passado') {
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startDate = last.toISOString().split('T')[0];
    endDate = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
    periodLabel = last.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  } else if (period === 'semana') {
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    startDate = weekAgo.toISOString().split('T')[0];
    endDate = now.toISOString().split('T')[0];
    periodLabel = 'últimos 7 dias';
  } else {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = now.toISOString().split('T')[0];
    periodLabel = now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  }

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .gte('data', startDate)
    .lte('data', endDate);

  const { data: bills } = await supabase
    .from('recurring_bills')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);

  const report = await generateReport(transactions || [], bills || [], periodLabel);
  await sendText(from, report);
}

async function listPendingBills(from, userId) {
  const { data: bills } = await supabase
    .from('recurring_bills')
    .select(`*, bill_payments(paid_at)`)
    .eq('user_id', userId)
    .eq('active', true)
    .order('dia_vencimento');

  if (!bills?.length) {
    await sendText(from, 'Você não tem contas fixas cadastradas ainda. Me manda uma mensagem como "conta de luz vence dia 10, uns R$200" para cadastrar! 💡');
    return;
  }

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const lines = bills.map(bill => {
    const lastPayment = bill.bill_payments?.[0];
    const paidThisMonth = lastPayment && new Date(lastPayment.paid_at).getMonth() === currentMonth;
    const dueDate = new Date(currentYear, currentMonth, bill.dia_vencimento);
    const overdue = !paidThisMonth && dueDate < now;
    const icon = paidThisMonth ? '✅' : overdue ? '🔴' : '⏳';
    return `${icon} *${bill.nome}* — ~R$ ${Number(bill.valor_estimado || 0).toFixed(2)} (dia ${bill.dia_vencimento})`;
  });

  await sendText(from, `📋 *Suas contas fixas:*\n\n${lines.join('\n')}\n\n✅ pago | ⏳ pendente | 🔴 vencida`);
}

async function sendHelp(from) {
  await sendText(from, `👋 *Assistente Financeiro*\n\nVeja o que posso fazer:\n\n📸 *Comprovante* — mande uma foto e eu registro automaticamente\n\n💬 *Exemplos de mensagens:*\n• "gastei 45 reais no mercado"\n• "recebi 3000 de salário"\n• "luz vence dia 10, uns 200 reais"\n• "paguei a internet"\n• "quanto gastei esse mês?"\n• "quais contas estão pendentes?"\n• "resumo do mês passado"`);
}

async function buildContext(userId) {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const { data: recentTransactions } = await supabase
    .from('transactions')
    .select('tipo, valor, descricao, categoria, data')
    .eq('user_id', userId)
    .gte('data', startOfMonth)
    .order('data', { ascending: false })
    .limit(5);

  const { data: bills } = await supabase
    .from('recurring_bills')
    .select('nome, valor_estimado, dia_vencimento')
    .eq('user_id', userId)
    .eq('active', true);

  return { recentTransactions: recentTransactions || [], bills: bills || [] };
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

module.exports = router;
