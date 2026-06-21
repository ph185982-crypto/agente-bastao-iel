const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_FINANCEIRO = `Você é um assistente financeiro pessoal que funciona pelo WhatsApp.
Responda sempre em português brasileiro, de forma concisa e amigável.
Nunca invente números — só trabalhe com o que foi informado.
Use emojis com moderação para facilitar a leitura.`;

async function extractFromReceipt(imageBuffer, mimeType) {
  const base64 = imageBuffer.toString('base64');
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: `Você extrai dados financeiros de comprovantes de pagamento.
Retorne SOMENTE JSON com os campos:
{
  "tipo": "despesa" | "receita",
  "valor": number (em reais, sem símbolo),
  "data": "YYYY-MM-DD" (data da transação ou hoje se não identificada),
  "descricao": string (quem recebeu ou de quem recebeu, max 80 chars),
  "categoria": string (ex: "Alimentação", "Água e Esgoto", "Luz", "Aluguel", "Salário", "Transferência", "Outros"),
  "banco_origem": string | null,
  "banco_destino": string | null,
  "pix_key": string | null,
  "confianca": "alta" | "media" | "baixa"
}`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extraia os dados financeiros deste comprovante.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' } },
        ],
      },
    ],
  });
  return JSON.parse(resp.choices[0].message.content);
}

async function understandMessage(text, context) {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_FINANCEIRO}

Classifique a intenção da mensagem do usuário e retorne JSON:
{
  "intent": "registrar_despesa" | "registrar_receita" | "cadastrar_conta_fixa" | "confirmar_pagamento" | "consultar_saldo" | "consultar_extrato" | "listar_contas_pendentes" | "ajuda" | "outro",
  "dados": {
    // Para registrar_despesa/receita:
    "valor": number | null,
    "descricao": string | null,
    "categoria": string | null,
    "data": "YYYY-MM-DD" | null,

    // Para cadastrar_conta_fixa:
    "nome": string | null,
    "valor_estimado": number | null,
    "dia_vencimento": number | null (1-31),
    "categoria": string | null,

    // Para consultar_extrato:
    "periodo": "mes_atual" | "mes_passado" | "semana" | null
  },
  "resposta_curta": string  // mensagem de confirmação para enviar ao usuário
}

Hoje é ${new Date().toISOString().split('T')[0]}.
Contexto do usuário: ${JSON.stringify(context)}`,
      },
      { role: 'user', content: text },
    ],
  });
  return JSON.parse(resp.choices[0].message.content);
}

async function generateReport(transactions, recurringBills, period) {
  const totalReceitas = transactions.filter(t => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
  const totalDespesas = transactions.filter(t => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);
  const saldo = totalReceitas - totalDespesas;

  const byCategory = {};
  for (const t of transactions.filter(t => t.tipo === 'despesa')) {
    byCategory[t.categoria] = (byCategory[t.categoria] || 0) + Number(t.valor);
  }
  const topCats = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, val]) => `  • ${cat}: R$ ${val.toFixed(2)}`).join('\n');

  const pendentes = recurringBills.filter(b => !b.pago);

  let msg = `📊 *Resumo ${period}*\n\n`;
  msg += `✅ Receitas: R$ ${totalReceitas.toFixed(2)}\n`;
  msg += `❌ Despesas: R$ ${totalDespesas.toFixed(2)}\n`;
  msg += `${saldo >= 0 ? '💚' : '🔴'} Saldo: R$ ${saldo.toFixed(2)}\n`;
  if (topCats) msg += `\n📂 *Maiores gastos:*\n${topCats}\n`;
  if (pendentes.length) {
    msg += `\n⚠️ *Contas pendentes:*\n`;
    msg += pendentes.map(b => `  • ${b.nome}: R$ ${Number(b.valor_estimado).toFixed(2)} (dia ${b.dia_vencimento})`).join('\n');
  }
  return msg;
}

module.exports = { extractFromReceipt, understandMessage, generateReport };
