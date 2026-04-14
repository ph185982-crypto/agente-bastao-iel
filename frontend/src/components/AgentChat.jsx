import { useState, useRef, useEffect } from 'react'
import { API_BASE } from '../utils/api'

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconSend() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  )
}
function IconPaperclip() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  )
}
function IconX() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
function IconDoc() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}
function IconImg() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}
function IconCopy({ done }) {
  return done ? (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
    </svg>
  )
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      title="Copiar"
      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-gray-200 transition-all"
    >
      <IconCopy done={copied} />
    </button>
  )
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function Typing() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 text-xs font-bold text-white">
        N
      </div>
      <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 text-xs font-bold text-white">
          N
        </div>
      )}
      {/* Bubble */}
      <div
        className={`group relative max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed
          ${isUser
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-gray-800 border border-gray-700 text-gray-200 rounded-bl-sm'}`}
      >
        {/* File badges */}
        {msg.files && msg.files.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {msg.files.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-xs text-white/80"
              >
                {f.type === 'image' ? <IconImg /> : <IconDoc />}
                {f.name}
              </span>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {/* Copy button for AI messages */}
        {!isUser && (
          <div className="absolute -top-2 -right-2">
            <CopyBtn text={msg.content} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── File Badge (in input area) ───────────────────────────────────────────────

function FileBadge({ file, onRemove }) {
  const isImage = file.type.startsWith('image/')
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-700 text-xs text-gray-300 max-w-[140px]">
      {isImage ? <IconImg /> : <IconDoc />}
      <span className="truncate">{file.name}</span>
      <button onClick={onRemove} className="shrink-0 text-gray-500 hover:text-gray-200 ml-0.5">
        <IconX />
      </button>
    </div>
  )
}

// ─── Suggested Prompts ────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Analise o documento e gere uma headline impactante',
  'Crie uma legenda completa no tom do @pedro_destrava',
  'Quais são os 3 ângulos mais interessantes desse conteúdo?',
  'Reescreva esse roteiro com mais curiosidade intelectual',
  'Sugira um gancho para os primeiros 3 segundos do vídeo',
]

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgentChat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function handleFileSelect(e) {
    const selected = Array.from(e.target.files || [])
    setPendingFiles((prev) => [...prev, ...selected].slice(0, 10))
    e.target.value = ''
  }

  function removeFile(idx) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  // Auto-resize textarea
  function handleInputChange(e) {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }

  async function sendMessage(text = input) {
    const msg = text.trim()
    if (!msg && pendingFiles.length === 0) return

    const fileMeta = pendingFiles.map((f) => ({ name: f.name, type: f.type }))
    const userMsg = {
      role: 'user',
      content: msg || '(arquivo enviado)',
      files: fileMeta.length > 0 ? fileMeta : undefined,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setPendingFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('message', msg || '(arquivo enviado)')

      // History: exclude current message (it's being sent as the new turn)
      const historyForApi = messages.map((m) => ({ role: m.role, content: m.content }))
      formData.append('history', JSON.stringify(historyForApi))

      for (const file of pendingFiles) {
        formData.append('files', file)
      }

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response, timestamp: Date.now() },
      ])
    } catch (err) {
      setError(err.message)
      // Remove the optimistically added user message on failure
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    setMessages([])
    setError('')
    setPendingFiles([])
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-white">Agente de Conteúdo</h2>
          <p className="text-xs text-gray-400">Envie documentos, roteiros ou pergunte diretamente</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
          >
            Limpar conversa
          </button>
        )}
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scrollbar-thin">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-6 pb-10">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <span className="text-2xl font-bold text-indigo-400">N</span>
            </div>
            <div>
              <p className="text-white font-semibold mb-1">Como posso ajudar hoje?</p>
              <p className="text-xs text-gray-400 max-w-xs">
                Envie documentos, roteiros ou PDFs como contexto e me peça para criar ou melhorar conteúdo.
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-sm">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 rounded-full transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {loading && <Typing />}

        <div ref={bottomRef} />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="px-4 pb-2 shrink-0">
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        </div>
      )}

      {/* ── Input area ── */}
      <div className="shrink-0 border-t border-gray-800 p-4">
        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {pendingFiles.map((f, i) => (
              <FileBadge key={i} file={f} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Anexar arquivo"
            className="shrink-0 p-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors mb-0.5"
          >
            <IconPaperclip />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Escreva uma mensagem ou anexe um arquivo… (Enter para enviar)"
            rows={1}
            className="flex-1 resize-none bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors scrollbar-thin"
            style={{ minHeight: '42px', maxHeight: '160px' }}
          />

          {/* Send button */}
          <button
            onClick={() => sendMessage()}
            disabled={loading || (!input.trim() && pendingFiles.length === 0)}
            className="shrink-0 p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors mb-0.5"
          >
            <IconSend />
          </button>
        </div>

        <p className="mt-2 text-center text-xs text-gray-600">
          Suporta imagens, PDFs e arquivos de texto · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  )
}
