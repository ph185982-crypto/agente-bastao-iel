const supabase = require('../services/supabase');
const { sendText } = require('../services/whatsapp');

// Chamado pelo Vercel Cron todos os dias às 8h
async function checkAndSendReminders() {
  const now = new Date();
  const today = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Busca contas fixas com vencimento hoje ou amanhã (D+0 e D+1)
  const { data: bills } = await supabase
    .from('recurring_bills')
    .select('*, users(phone)')
    .eq('active', true)
    .in('dia_vencimento', [today, today + 1]);

  if (!bills?.length) return { sent: 0 };

  let sent = 0;
  for (const bill of bills) {
    const { phone } = bill.users;

    // Verifica se já foi pago esse mês
    const { data: payment } = await supabase
      .from('bill_payments')
      .select('id')
      .eq('recurring_bill_id', bill.id)
      .gte('paid_at', `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`)
      .single();

    if (payment) continue; // já paga

    const isToday = bill.dia_vencimento === today;
    const emoji = isToday ? '🔔' : '⏰';
    const when = isToday ? 'HOJE' : 'AMANHÃ';
    const valor = bill.valor_estimado ? `~R$ ${Number(bill.valor_estimado).toFixed(2)}` : '';

    await sendText(
      phone,
      `${emoji} *Lembrete de vencimento*\n\n📋 *${bill.nome}* vence ${when}!\n💰 ${valor}\n\nAssim que pagar, me manda o comprovante ou escreva "paguei a ${bill.nome.toLowerCase()}" 👍`
    );
    sent++;
  }

  return { sent };
}

module.exports = { checkAndSendReminders };
