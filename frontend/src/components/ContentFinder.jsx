import { useState, useRef, useEffect, useCallback } from 'react'
import { API_BASE } from '../utils/api'

const POLL_INTERVAL = 2500

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

function ResultCard({ result, jobId, index, onApprove }) {
  const [headline, setHeadline] = useState(() => result.headline || '')
  const [caption, setCaption]   = useState(() => result.caption  || '')
  const [editStatus,   setEditStatus]   = useState(result.editStatus   || 'idle')
  const [editProgress, setEditProgress] = useState(result.editProgress || 0)
  const [editError,    setEditError]    = useState(result.editError     || null)
  const [copied, setCopied] = useState(false)

  // Sync only edit-state fields from parent poll (never overwrite user-edited headline/caption)
  useEffect(() => {
    setEditStatus(result.editStatus   || 'idle')
    setEditProgress(result.editProgress || 0)
    setEditError(result.editError       || null)
  }, [result.editStatus, result.editProgress, result.editError])

  function handlePrepare() {
    setEditStatus('processing')
    setEditProgress(0)
    setEditError(null)
    onApprove(index, headline, caption)
  }

  function copyCaption() {
    navigator.clipboard.writeText(caption).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const downloadUrl = `${API_BASE}/api/content-finder/download/${jobId}/${index}`

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

        {/* Edit progress bar */}
        {editStatus === 'processing' && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-gray-400">
              <span>🎬 Editando vídeo…</span>
              <span>{editProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${editProgress}%` }}
              />
            </div>
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

          {editStatus === 'done' && (
            <>
              <a
                href={downloadUrl}
                download={`reel_reciclado_${index + 1}.mp4`}
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
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [results, setResults]   = useState([])
  const [jobId, setJobId]       = useState(null)
  const [error, setError]       = useState('')

  const pollRef  = useRef(null)
  const jobIdRef = useRef(null)

  useEffect(() => { jobIdRef.current = jobId }, [jobId])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startPolling = useCallback((jid) => {
    if (pollRef.current) clearInterval(pollRef.current)
    let errors = 0

    pollRef.current = setInterval(async () => {
      const id = jid || jobIdRef.current
      if (!id) { clearInterval(pollRef.current); return }

      try {
        const pr = await fetch(`${API_BASE}/api/content-finder/status/${id}`)
        if (!pr.ok) {
          errors++
          if (errors >= 3 || pr.status === 404) {
            clearInterval(pollRef.current); pollRef.current = null
            setStatus('error')
            setError(pr.status === 404 ? 'Job expirado. Tente novamente.' : 'Erro de servidor.')
          }
          return
        }

        const data = await pr.json()
        errors = 0

        if (data.progress !== undefined) setProgress(data.progress)
        if (data.currentStep)            setCurrentStep(data.currentStep)
        if (data.results)                setResults(data.results)

        if (data.status === 'error') {
          clearInterval(pollRef.current); pollRef.current = null
          setStatus('error')
          setError(data.error || 'Erro no pipeline')
        } else if (data.status === 'done') {
          const hasActiveEdits = data.results?.some(r => r.editStatus === 'processing')
          if (!hasActiveEdits) { clearInterval(pollRef.current); pollRef.current = null }
          setStatus('done')
          setProgress(100)
        }
      } catch (e) {
        errors++
        if (errors >= 3) {
          clearInterval(pollRef.current); pollRef.current = null
          setStatus('error')
          setError('Erro de conexão com o servidor.')
        }
      }
    }, POLL_INTERVAL)
  }, [])

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
    setProgress(0)
    setCurrentStep('Iniciando pipeline…')
    setResults([])
    setError('')
    setJobId(null)

    try {
      const res = await fetch(`${API_BASE}/api/content-finder/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashtags: selectedTags }),
      })
      const { jobId: jid, error: err } = await res.json()
      if (!res.ok || !jid) throw new Error(err || 'Erro ao iniciar busca')
      setJobId(jid)
      startPolling(jid)
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }

  async function handleApprove(index, headline, caption) {
    const jid = jobIdRef.current
    if (!jid) return

    // Optimistic update
    setResults(prev => prev.map((r, i) =>
      i === index ? { ...r, editStatus: 'processing', editProgress: 0, editError: null } : r
    ))

    try {
      const res = await fetch(`${API_BASE}/api/content-finder/approve/${jid}/${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline, caption }),
      })
      if (!res.ok) {
        const { error: err } = await res.json()
        setResults(prev => prev.map((r, i) =>
          i === index ? { ...r, editStatus: 'error', editError: err || 'Erro ao iniciar edição' } : r
        ))
        return
      }
      // Restart polling if it stopped (pipeline was already done)
      if (!pollRef.current && jid) startPolling(jid)
    } catch (e) {
      setResults(prev => prev.map((r, i) =>
        i === index ? { ...r, editStatus: 'error', editError: e.message } : r
      ))
    }
  }

  function reset() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setStatus('idle')
    setProgress(0)
    setCurrentStep('')
    setResults([])
    setJobId(null)
    setError('')
  }

  const isProcessing = status === 'processing'
  const isDone       = status === 'done'

  // Agent step indicator
  const agentSteps = [
    { label: '🔍 Buscar', threshold: 5  },
    { label: '🧠 Analisar', threshold: 20 },
    { label: '✍️ Copy', threshold: 55 },
    { label: '🎬 Editar', threshold: 95 },
  ]

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

            {/* Preset chips */}
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

            {/* Custom tag input */}
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

          {/* Selected tags summary */}
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

          {/* Error */}
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

          {/* Empty state */}
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
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="truncate pr-2">{currentStep || 'Processando…'}</span>
              <span className="shrink-0">{progress}%</span>
            </div>
            <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Agent step indicators */}
          <div className="grid grid-cols-4 gap-1.5">
            {agentSteps.map((s, i) => (
              <div
                key={i}
                className={`py-2 rounded-lg text-center text-xs font-medium transition-colors
                  ${progress >= s.threshold
                    ? 'bg-indigo-900/50 text-indigo-300'
                    : 'bg-gray-800/50 text-gray-600'}`}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {(isDone || (isProcessing && results.length > 0)) && (
        <div className="space-y-4">
          {isDone && (
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
          )}

          {isDone && results.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm bg-gray-900 rounded-2xl border border-gray-800">
              <p className="text-2xl mb-2">🔍</p>
              <p>Tente outras hashtags ou ampliar o nicho de busca.</p>
            </div>
          )}

          {results.map((result, i) => (
            <ResultCard
              key={i}
              result={result}
              jobId={jobId}
              index={i}
              onApprove={handleApprove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
