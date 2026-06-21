import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4';

const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!;
const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!;
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN')!;
const BASE_URL = `https://graph.facebook.com/v21.0/${PHONE_ID}`;
const HEADERS = { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' };

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('DB_SERVICE_KEY')!
);

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook Meta
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  const body = await req.json().catch(() => ({}));
  const change = body?.entry?.[0]?.changes?.[0]?.value;

  if (!change?.messages?.length) return new Response('OK', { status: 200 });

  const msg = change.messages[0];
  const from: string = msg.from;
  const contact = change.contacts?.[0];

  // Processar em background sem bloquear a resposta
  EdgeRuntime.waitUntil((async () => {
    try {
      await markRead(msg.id);
      await ensureUser(from, contact?.profile?.name);

      if (msg.type === 'image') {
        await handleImage(from, msg.image);
      } else if (msg.type === 'text') {
        await handleText(from, msg.text.body);
      } else {
        await sendText(from, 'Entendo apenas fotos de comprovantes e mensagens de texto. 😊');
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }
  })());

  return new Response('OK', { status: 200 });
});

// ── WhatsApp helpers ──────────────────────────────────────────────────────────

async function sendText(to: string, text: string) {
  await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
}

async function markRead(messageId: string) {
  await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  }).catch(() => {});
}

async function downloadMedia(mediaId: string): Promise<{ base64: string; mimeType: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: HEADERS });
  const meta = await metaRes.json();
  const imgRes = await fetch(meta.url, { headers: HEADERS });
  const buffer = await imgRes.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return { base64, mimeType: meta.mime_type };
}

// ── Database helpers ──────────────────────────────────────────────────────────

async function ensureUser(phone: string, name?: string) {
  const { data } = await supabase.from('users').select('id').eq('phone', phone).single();
  if (!data) await supabase.from('users').insert({ phone, name: name || phone });
}

async function getUser(phone: string) {
  const { data } = await supabase.from('users').select('*').eq('phone', phone).single();
  return data;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleImage(from: string, image: { id: string }) {
  let step = 'download';
  try {
    const [, { base64, mimeType }] = await Promise.all([
      sendText(from, '🔍 Lendo seu comprovante...'),
      downloadMedia(image.id),
    ]);

    step = 'gpt';
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: `Extraia dados financeiros do comprovante. Retorne JSON:
{"tipo":"despesa"|"receita","valor":number,"data":"YYYY-MM-DD","descricao":"string max 80 chars","categoria":"Alimentação"|"Água e Esgoto"|"Luz"|"Aluguel"|"Salário"|"Transferência"|"Outros","confianca":"alta"|"media"|"baixa"}`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extraia os dados deste comprovante.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' } },
          ],
        },
      ],
    });

    const extracted = JSON.parse(resp.choices[0].message.content!);

    if (extracted.confianca === 'baixa') {
      await sendText(from, '⚠️ Foto pouco nítida. Tente uma foto mais clara ou me diga o valor manualmente.');
      return;
    }

    step = 'salvar';
    const user = await getUser(from);
    const { error } = await supabase.from('transactions').insert({
      user_id: user.id,
      tipo: extracted.tipo,
      valor: extracted.valor,
      data: extracted.data || new Date().toISOString().split('T')[0],
      descricao: extracted.descricao || 'Comprovante',
      categoria: extracted.categoria || 'Outros',
      origem: 'comprovante',
    });
    if (error) throw error;

    const emoji = extracted.tipo === 'receita' ? '✅' : '💸';
    const tipo = extracted.tipo === 'receita' ? 'Receita' : 'Despesa';
    const [d, m, y] = [extracted.data?.slice(8,10), extracted.data?.slice(5,7), extracted.data?.slice(0,4)];
    await sendText(from,
      `${emoji} *${tipo} registrada!*\n💰 R$ ${Number(extracted.valor).toFixed(2)}\n📝 ${extracted.descricao}\n🏷️ ${extracted.categoria}\n📅 ${d}/${m}/${y}`
    );
  } catch (err) {
    console.error(`handleImage [${step}]:`, err);
    await sendText(from, `❌ Erro na etapa "${step}". Tente novamente ou me diga o valor.`);
  }
}

async function handleText(from: string, text: string) {
  const user = await getUser(from);
  if (!user) {
    await sendText(from, '👋 Olá! ' + getHelp());
    return;
  }

  // Análise simples por palavras-chave + OpenAI
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: `Assistente financeiro pessoal via WhatsApp. Classifique a mensagem e retorne JSON:
{"intent":"registrar_despesa"|"registrar_receita"|"consultar_extrato"|"listar_contas"|"ajuda"|"outro","valor":number|null,"descricao":string|null,"categoria":string|null,"data":"YYYY-MM-DD"|null,"resposta":string}
Hoje: ${new Date().toISOString().split('T')[0]}`,
      },
      { role: 'user', content: text },
    ],
  });

  const r = JSON.parse(resp.choices[0].message.content!);

  if (r.intent === 'registrar_despesa' || r.intent === 'registrar_receita') {
    if (!r.valor) { await sendText(from, r.resposta || 'Qual o valor?'); return; }
    await supabase.from('transactions').insert({
      user_id: user.id,
      tipo: r.intent === 'registrar_receita' ? 'receita' : 'despesa',
      valor: r.valor,
      data: r.data || new Date().toISOString().split('T')[0],
      descricao: r.descricao || text.slice(0, 80),
      categoria: r.categoria || 'Outros',
      origem: 'texto',
    });
    await sendText(from, r.resposta || `✅ Registrado! R$ ${r.valor.toFixed(2)}`);

  } else if (r.intent === 'consultar_extrato') {
    await sendExtrato(from, user.id);

  } else if (r.intent === 'listar_contas') {
    await sendContasPendentes(from, user.id);

  } else if (r.intent === 'ajuda') {
    await sendText(from, getHelp());

  } else {
    await sendText(from, r.resposta || 'Não entendi. Digite *ajuda* para ver o que posso fazer.');
  }
}

async function sendExtrato(from: string, userId: string) {
  const now = new Date();
  const inicio = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const { data: txs } = await supabase.from('transactions').select('*').eq('user_id', userId).gte('data', inicio);
  const receitas = (txs||[]).filter(t=>t.tipo==='receita').reduce((s,t)=>s+Number(t.valor),0);
  const despesas = (txs||[]).filter(t=>t.tipo==='despesa').reduce((s,t)=>s+Number(t.valor),0);
  const saldo = receitas - despesas;
  await sendText(from,
    `📊 *Resumo do mês*\n\n✅ Receitas: R$ ${receitas.toFixed(2)}\n❌ Despesas: R$ ${despesas.toFixed(2)}\n${saldo>=0?'💚':'🔴'} Saldo: R$ ${saldo.toFixed(2)}`
  );
}

async function sendContasPendentes(from: string, userId: string) {
  const { data: bills } = await supabase.from('recurring_bills').select('*').eq('user_id', userId).eq('active', true);
  if (!bills?.length) { await sendText(from, 'Você não tem contas fixas cadastradas ainda.'); return; }
  const lines = bills.map(b => `⏳ *${b.nome}* — ~R$ ${Number(b.valor_estimado||0).toFixed(2)} (dia ${b.dia_vencimento})`);
  await sendText(from, `📋 *Contas fixas:*\n\n${lines.join('\n')}`);
}

function getHelp(): string {
  return `*Assistente Financeiro* 💰\n\n📸 Mande foto de comprovante para registrar\n\n💬 Ou escreva:\n• "gastei 50 no mercado"\n• "recebi 3000 de salário"\n• "quanto gastei esse mês?"\n• "quais contas estão pendentes?"`;
}
