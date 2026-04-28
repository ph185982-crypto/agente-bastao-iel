import { useState, useRef } from 'react'
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
      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors shrink-0"
    >
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

function ResultBlock({ label, content, highlight = false }) {
  return (
    <div className={`rounded-xl p-4 border ${highlight ? 'bg-indigo-950/40 border-indigo-700/50' : 'bg-gray-800 border-gray-700'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold uppercase tracking-wider ${highlight ? 'text-indigo-400' : 'text-gray-400'}`}>
          {label}
        </span>
        <CopyButton text={content} />
      </div>
      <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{content}</p>
    </div>
  )
}

export default function Step2OCR({ onTextExtracted }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  function handleFile(selected) {
    if (!selected) return
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!allowed.includes(selected.type)) {
      setError('Apenas arquivos JPEG, PNG ou WebP são permitidos')
      return
    }
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setError('')
    setResult(null)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  async function handleAnalyze() {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)

    const formData = new FormData()
    formData.append('image', file)

    try {
      const res = await fetch(`${API_BASE}/api/analyze-print`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao analisar imagem')

      setResult(data)
      // Pass the Portuguese text upstream so Step 3 can use it
      if (onTextExtracted) onTextExtracted(data.portuguese_text || data.original_text)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const translated = result && result.portuguese_text &&
    result.portuguese_text !== result.original_text

  return (
    <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      {/* Step label */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          2
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Print da legenda → Transcrição + Tradução + Copy</h2>
          <p className="text-xs text-gray-400">Suba o print e receba headline e legenda prontas automaticamente</p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2 p-6 text-center
          ${dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'}`}
      >
        {preview ? (
          <img src={preview} alt="Preview" className="max-h-40 rounded-lg object-contain" />
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">Clique ou arraste um print aqui</p>
            <p className="text-xs text-gray-500">JPEG, PNG ou WebP · máx. 10 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>

      {/* Analyze button */}
      {file && !loading && (
        <button
          onClick={handleAnalyze}
          className="mt-3 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Transcrever, traduzir e gerar copy
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="mt-4 flex items-center justify-center gap-3 py-6">
          <svg className="w-5 h-5 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-gray-400">Transcrevendo, traduzindo e gerando copy…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-3 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Results */}
      {result && (
        <div className="mt-5 space-y-3">
          {/* Original text — only show if it was translated */}
          {translated && (
            <ResultBlock label="Texto original" content={result.original_text} />
          )}

          {/* Portuguese text */}
          <ResultBlock
            label={translated ? 'Tradução (português)' : 'Texto extraído'}
            content={result.portuguese_text || result.original_text}
          />

          {/* Headline */}
          <ResultBlock label="Headline" content={result.headline} highlight />

          {/* Legenda */}
          <ResultBlock label="Legenda" content={result.legenda} highlight />
        </div>
      )}
    </section>
  )
}
