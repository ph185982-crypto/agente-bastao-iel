import { useState, useEffect } from 'react'
import { API_BASE } from '../utils/api'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
    >
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

export default function Step3Generate({ initialText }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // Sync when parent passes extracted text
  useEffect(() => {
    if (initialText) setText(initialText)
  }, [initialText])

  async function handleGenerate() {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar conteúdo')

      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      {/* Step label */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          3
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Gerar headline e legenda</h2>
          <p className="text-xs text-gray-400">Cole ou edite o texto do vídeo e gere o copy</p>
        </div>
      </div>

      {/* Text input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Cole aqui o texto do vídeo (ou ele virá preenchido automaticamente após o passo 2)..."
        rows={5}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors resize-y scrollbar-thin"
      />

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={loading || !text.trim()}
        className="mt-3 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Gerando...
          </span>
        ) : (
          'Gerar Copy'
        )}
      </button>

      {/* Error */}
      {error && (
        <p className="mt-3 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Result */}
      {result && (
        <div className="mt-5 space-y-4">
          {/* Headline */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Headline</span>
              <CopyButton text={result.headline} />
            </div>
            <p className="text-base font-semibold text-white leading-snug">{result.headline}</p>
          </div>

          {/* Legenda */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Legenda</span>
              <CopyButton text={result.legenda} />
            </div>
            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{result.legenda}</p>
          </div>
        </div>
      )}
    </section>
  )
}
