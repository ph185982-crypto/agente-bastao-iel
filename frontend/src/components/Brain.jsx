import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../utils/api'

const brl = n => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`

const SUGGESTIONS = [
  'Gastei 45 reais no mercado',
  'Recebi 2000 de salário',
  'Qual meu saldo do mês?',
  'Me lembra de pagar a conta amanhã às 10h',
]

// ─── Chat ───────────────────────────────────────────────────────────────────
function ChatPanel({ onDataChanged }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Oi, Pedro! 🧠 Sou seu Cérebro. Posso registrar gastos, dar balanços, criar lembretes e guardar notas. Manda ver.' },
  ])
  const [input, setInput]     = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send(text) {
    const msg = (text ?? input).trim()
    if (!msg || sending) return
    setInput('')
    setMessages(m => [...m, { role: 'user', content: msg }])
    setSending(true)
    try {
      const res = await fetch(`${API_BASE}/api/brain/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      setMessages(m => [...m, { role: 'assistant', content: data.reply, executed: data.executed }])
      if (data.executed?.length) onDataChanged?.()
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, error: true }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-[60vh]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap
              ${m.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-sm'
                : m.error ? 'bg-red-900/30 text-red-200 border border-red-700/50'
                : 'bg-gray-800 text-gray-100 rounded-bl-sm'}`}>
              {m.content}
              {m.executed?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[...new Set(m.executed)].map((t, j) => (
                    <span key={j} className="text-[10px] bg-green-900/40 text-green-300 border border-green-700/40 rounded-full px-1.5 py-0.5">
                      ⚡ {t.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
              <span className="flex gap-1">
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 py-3">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => send(s)}
              className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-full px-3 py-1.5 hover:border-indigo-500 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-3 border-t border-gray-800">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Fala comigo… (ex: gastei 30 no uber)"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
        <button onClick={() => send()} disabled={sending || !input.trim()}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors">
          ➤
        </button>
      </div>
    </div>
  )
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ data, loading }) {
  if (loading && !data) return <p className="text-center text-gray-500 text-sm py-10">Carregando painel…</p>
  if (!data?.enabled) return <p className="text-center text-gray-500 text-sm py-10">Memória ainda não configurada.</p>

  const fin = data.financeiro || {}
  const cats = Object.entries(fin.por_categoria || {}).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...cats.map(c => c[1]))

  return (
    <div className="space-y-4">
      {/* Saldo do mês */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
          <p className="text-[10px] uppercase text-gray-500">Saldo (mês)</p>
          <p className={`text-base font-bold ${fin.saldo >= 0 ? 'text-green-300' : 'text-red-300'}`}>{brl(fin.saldo)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
          <p className="text-[10px] uppercase text-gray-500">Receitas</p>
          <p className="text-base font-bold text-green-400">{brl(fin.receitas)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
          <p className="text-[10px] uppercase text-gray-500">Despesas</p>
          <p className="text-base font-bold text-red-400">{brl(fin.despesas)}</p>
        </div>
      </div>

      {/* Gastos por categoria */}
      {cats.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-400">Gastos por categoria</p>
          {cats.map(([cat, val]) => (
            <div key={cat}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-gray-300 capitalize">{cat}</span>
                <span className="text-gray-400">{brl(val)}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(val / maxCat) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lembretes */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-400">⏰ Lembretes ({data.lembretes?.length || 0})</p>
        {data.lembretes?.length ? data.lembretes.map(r => (
          <div key={r.id} className="flex items-start gap-2 text-xs">
            <span className="text-indigo-400 shrink-0">•</span>
            <div><span className="text-gray-200">{r.texto}</span> <span className="text-gray-500">— {r.quando}</span></div>
          </div>
        )) : <p className="text-xs text-gray-600">Nenhum lembrete pendente.</p>}
      </div>

      {/* Transações recentes */}
      {data.transacoes?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-1.5">
          <p className="text-xs font-semibold text-gray-400">Últimas transações</p>
          {data.transacoes.map(t => (
            <div key={t.id} className="flex justify-between text-xs">
              <span className="text-gray-300 capitalize truncate">{t.descricao || t.categoria}</span>
              <span className={t.tipo === 'receita' ? 'text-green-400' : 'text-red-400'}>
                {t.tipo === 'receita' ? '+' : '−'}{brl(t.valor)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Notas */}
      {data.notas?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-1.5">
          <p className="text-xs font-semibold text-gray-400">📝 Notas</p>
          {data.notas.map(n => (
            <p key={n.id} className="text-xs text-gray-300">• {n.texto}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────
export default function Brain() {
  const [view, setView]       = useState('chat')   // chat | painel
  const [dash, setDash]       = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadDash() {
    try {
      const res = await fetch(`${API_BASE}/api/brain/dashboard`)
      setDash(await res.json())
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }
  useEffect(() => { loadDash() }, [])

  return (
    <div className="max-w-lg mx-auto w-full space-y-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">🧠 Cérebro</h1>
        <p className="text-sm text-gray-400">Sua segunda mente — finanças, agenda e memória</p>
      </div>

      {dash && !dash.whatsappLinked && (
        <div className="text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/40 rounded-xl px-3 py-2">
          💬 WhatsApp ainda não conectado — funciona aqui pela web. Para ativar no Zap, falta só o número.
        </div>
      )}

      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {[{ k: 'chat', label: '💬 Conversa' }, { k: 'painel', label: '📊 Painel' }].map(t => (
          <button key={t.k} onClick={() => { setView(t.k); if (t.k === 'painel') loadDash() }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors
              ${view === t.k ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'chat'
        ? <ChatPanel onDataChanged={loadDash} />
        : <Dashboard data={dash} loading={loading} />}
    </div>
  )
}
