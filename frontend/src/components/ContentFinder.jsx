import { useState, useRef } from 'react'
import { API_BASE } from '../utils/api'

const PRESET_TAGS = [
  'tecnologia', 'curiosidades', 'inovação', 'China', 'NASA',
  'história', 'ciência', 'futuro', 'engenharia', 'espaço',
]

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBar({ score, label }) {
  const color = score >= 75 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  const textColor = score >= 75 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span className={textColor}>{score}</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

function RiskBadge({ label, level }) {
  const cls = {
    baixo: 'bg-green-900/40 text-green-300 border-green-700/60',
    médio: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/60',
    alto:  'bg-red-900/40 text-red-300 border-red-700/60',
  }[level] || 'bg-gray-800 text-gray-400 border-gray-700'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {label}: {level}
    </span>
  )
}

function ResultCard({ result, onApprove }) {
  const [headline, setHeadline] = useState(() => result.headline || '')
  const [caption, setCaption]   = useState(() => result.caption  || '')
  const [editStatus,   setEditStatus]   = useState('idle')
  const [editError,    setEditError]    = useState(null)
  const [blobUrl,      setBlobUrl]      = useState(null)
  const [copied, setCopied] = useState(false)

  async function handlePrepare() {
    setEditStatus('processing')
    setEditError(null)
    setBlobUrl(null)
    try {
      const url = await onApprove(result, headline, caption)
      setBlobUrl(url)
      setEditStatus('done')
    } catch (e) {
      setEditError(e.message)
      setEditStatus('error')
    }
  }

  function copyCaption() {
    navigator.clipboard.writeText(caption).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Top: thumbnail + scores */}
      <div className="flex gap-3 p-4">
        {result.thumbnail ? (
          <img
            src={result.thumbnail}
            alt="thumbnail"
            className="w-20 h-28 object-cover rounded-xl shrink-0 bg-gray-800"
            onError={e => { e.target.style.display = 'none' }}
          />
        ) : (
          <div className="w-20 h-28 bg-gray-800 rounded-xl shrink-0 flex items-center justify-center">
            <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-700/60 px-2 py-0.5 rounded-full">
              {result.content_category}
            </span>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>❤️ {(result.likes || 0).toLocaleString('pt-BR')}</span>
              {result.views > 0 && <span>👁 {(result.views).toLocaleString('pt-BR')}</span>}
            </div>
          </div>
          <ScoreBar score={result.viral_score  || 0} label="Viral score" />
          <ScoreBar score={result.fit_for_profile || 0} label="Fit perfil" />
          <div className="flex gap-1.5 flex-wrap">
            <RiskBadge label="Ban"       level={result.ban_risk       || 'baixo'} />
            <RiskBadge label="Copyright" level={result.copyright_risk || 'baixo'} />
          </div>
        </div>
      </div>

      {/* Bottom: editable fields + actions */}
      <div className="border-t border-gray-800 px-4 pt-3 pb-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Headline (vídeo)</label>
          <input
            type="text"
            value={headline}
            onChange={e => setHeadline(e.target.value)}
            disabled={editStatus === 'processing' || editStatus === 'done'}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Legenda do post</label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={5}
            disabled={editStatus === 'processing' || editStatus === 'done'}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 transition-colors resize-none disabled:opacity-50"
          />
        </div>

        {/* Processing state */}
        {editStatus === 'processing' && (
          <div className="flex items-center gap-2 text-xs text-indigo-400">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Editando vídeo… até 1 minuto
          </div>
        )}

        {/* Error */}
        {editStatus === 'error' && editError && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            Erro: {editError}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {(editStatus === 'idle' || editStatus === 'error') && (
            <button
              onClick={handlePrepare}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {editStatus === 'error' ? '↩ Tentar novamente' : '🎬 Preparar Vídeo'}
            </button>
          )}

          {editStatus === 'processing' && (
            <button disabled className="flex-1 py-2.5 bg-indigo-900/40 text-indigo-400 text-sm font-semibold rounded-xl cursor-not-allowed">
              Processando…
            </button>
          )}

          {editStatus === 'done' && blobUrl && (
            <>
              <a
                href={blobUrl}
                download="reel_reciclado.mp4"
                className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-xl transition-colors text-center"
              >
                ⬇️ Baixar Vídeo
              </a>
              <button
                onClick={copyCaption}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {copied ? '✅ Copiado!' : '📋 Copiar Legenda'}
              </button>
            </>
          )}
        </div>

        {/* Link to original */}
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Ver original no Instagram ↗
        </a>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ContentFinder() {
  const [selectedTags, setSelectedTags] = useState(['tecnologia', 'curiosidades'])
  const [customTag, setCustomTag]       = useState('')
  const [status, setStatus]     = useState('idle')  // idle | processing | done | error
  const [results, setResults]   = useState([])
  const [error, setError]       = useState('')

  function toggleTag(tag) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function addCustomTag() {
    const tag = customTag.trim().replace(/^#/, '')
    if (tag && !selectedTags.includes(tag)) setSelectedTags(prev => [...prev, tag])
    setCustomTag('')
  }

  function removeTag(tag) {
    setSelectedTags(prev => prev.filter(t => t !== tag))
  }

  async function handleSearch() {
    if (selectedTags.length === 0) return
    setStatus('processing')
    setResults([])
    setError('')

    try {
      const res = await fetch(`${API_BASE}/api/content-finder/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashtags: selectedTags }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na busca')
      setResults(data.results || [])
      setStatus('done')
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }

  async function handleApprove(result, headline, caption) {
    const res = await fetch(`${API_BASE}/api/content-finder/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: result.videoUrl || null,
        postUrl:  result.url,
        headline,
        caption,
      }),
    })
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({}))
      throw new Error(err || `Erro ${res.status}`)
    }
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  function reset() {
    setStatus('idle')
    setResults([])
    setError('')
  }

  const isProcessing = status === 'processing'
  const isDone       = status === 'done'

  return (
    <div className="max-w-lg mx-auto w-full space-y-6">

      {/* Header */}
      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">Reciclagem de Conteúdo</h1>
        <p className="text-sm text-gray-400">
          4 agentes de IA buscam, analisam, criam copy e editam o vídeo pronto para postar
        </p>
      </div>

      {/* ── Search section ── */}
      {!isProcessing && !isDone && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Temas / hashtags</label>

            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border
                    ${selectedTags.includes(tag)
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}
                >
                  #{tag}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomTag()}
                placeholder="Adicionar hashtag customizada…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                onClick={addCustomTag}
                disabled={!customTag.trim()}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {selectedTags.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Selecionadas ({selectedTags.length}):</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedTags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 bg-indigo-900/30 border border-indigo-700/50 text-indigo-300 text-xs px-2 py-0.5 rounded-full"
                  >
                    #{tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-white leading-none ml-0.5">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSearch}
            disabled={selectedTags.length === 0}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            🔍 Buscar Conteúdos
          </button>

          {!error && (
            <div className="text-center py-4 text-gray-600 text-sm">
              <p className="text-3xl mb-2">♻️</p>
              <p>Selecione hashtags e clique em buscar para encontrar conteúdos<br />com potencial viral para o seu perfil</p>
            </div>
          )}
        </div>
      )}

      {/* ── Processing state ── */}
      {isProcessing && (
        <div className="flex flex-col items-center gap-4 py-10">
          <svg className="w-10 h-10 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm text-gray-400 text-center">
            Buscando e analisando conteúdos…<br />
            <span className="text-xs text-gray-600">Agentes 1 → 2 → 3 em execução. Até 1 minuto.</span>
          </p>
        </div>
      )}

      {/* ── Results ── */}
      {isDone && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-green-300">
              {results.length > 0
                ? `${results.length} vídeo(s) aprovado(s) ✅`
                : 'Nenhum vídeo passou nos critérios ⚠️'}
            </p>
            <button
              onClick={reset}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Nova busca
            </button>
          </div>

          {results.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm bg-gray-900 rounded-2xl border border-gray-800">
              <p className="text-2xl mb-2">🔍</p>
              <p>Tente outras hashtags ou ampliar o nicho de busca.</p>
            </div>
          )}

          {results.map((result, i) => (
            <ResultCard
              key={i}
              result={result}
              onApprove={handleApprove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
