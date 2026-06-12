import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../utils/api'

const THEME_OPTIONS = [
  { key: 'ciencia',      label: '🔬 Ciência' },
  { key: 'tecnologia',   label: '🤖 Tecnologia' },
  { key: 'historia',     label: '🏛️ História' },
  { key: 'espaco',       label: '🚀 Espaço' },
  { key: 'china',        label: '🇨🇳 Inovação China' },
  { key: 'engenharia',   label: '⚙️ Engenharia' },
  { key: 'curiosidades', label: '🧠 Curiosidades' },
  { key: 'invencoes',    label: '💡 Invenções' },
]
const VIEWS_OPTIONS = [
  { value: 50000,   label: '50K+' },
  { value: 100000,  label: '100K+' },
  { value: 500000,  label: '500K+' },
  { value: 1000000, label: '1M+' },
]
const ENGAGEMENT_OPTIONS = [
  { value: 0,    label: 'Qualquer' },
  { value: 0.02, label: 'Bom (>2%)' },
  { value: 0.05, label: 'Ótimo (>5%)' },
]

// ─── ScoreRing ────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 80 }) {
  const r = size / 2 - 6
  const circ = 2 * Math.PI * r
  const pct  = Math.min(100, Math.max(0, score ?? 0))
  const dash  = (pct / 100) * circ
  const color = pct >= 75 ? '#22c55e' : pct >= 55 ? '#eab308' : '#ef4444'
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#374151" strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={size * 0.22} fontWeight="bold">{score ?? '…'}</text>
    </svg>
  )
}

// ─── TemplateUpload ───────────────────────────────────────────────────────────
function TemplateUpload({ templateFile, onTemplate }) {
  const inputRef = useRef(null)
  const previewUrl = templateFile ? URL.createObjectURL(templateFile) : null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Fundo do Reel</p>
          <p className="text-xs text-gray-400 mt-0.5">Seu template com cabeçalho/perfil</p>
        </div>
        {templateFile && (
          <span className="text-xs bg-green-900/40 text-green-300 border border-green-700/60 px-2 py-0.5 rounded-full">✓ Carregado</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {previewUrl && (
          <img src={previewUrl} alt="template" className="w-10 h-16 object-cover rounded-lg shrink-0 border border-gray-700"/>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 text-sm font-medium rounded-xl transition-colors"
        >
          {templateFile ? '↩ Trocar template' : '📁 Selecionar template (PNG/JPG)'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { if (e.target.files[0]) onTemplate(e.target.files[0]) }}/>
      </div>
      {!templateFile && (
        <p className="text-xs text-yellow-500/80">⚠️ Sem template: barra de título simples.</p>
      )}
    </div>
  )
}

// ─── SearchPhase ──────────────────────────────────────────────────────────────
function SearchPhase({ selectedThemes, setSelectedThemes, minViews, setMinViews,
  minEngagement, setMinEngagement, lang, setLang, onSearch, searching, error }) {

  function toggleTheme(key) {
    setSelectedThemes(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">
          Temas
          <span className="text-gray-600 ml-1">({selectedThemes.length} selecionado{selectedThemes.length !== 1 ? 's' : ''})</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ key, label }) => (
            <button key={key} onClick={() => toggleTheme(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border
                ${selectedThemes.includes(key)
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
        <p className="text-xs font-semibold text-gray-300">Filtros</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Views mínimas</label>
            <div className="flex gap-1 flex-wrap">
              {VIEWS_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setMinViews(opt.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border
                    ${minViews === opt.value ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Engajamento</label>
            <div className="flex gap-1 flex-wrap">
              {ENGAGEMENT_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setMinEngagement(opt.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border
                    ${minEngagement === opt.value ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Idioma</label>
          <div className="flex gap-2">
            {[{ v: 'any', label: '🌍 Qualquer idioma' }, { v: 'pt', label: '🇧🇷 Só Português' }].map(({ v, label }) => (
              <button key={v} onClick={() => setLang(v)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border
                  ${lang === v ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

      <button onClick={onSearch} disabled={selectedThemes.length === 0 || searching}
        className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors">
        {searching ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Garimpando reels virais…
          </span>
        ) : '🔍 Buscar Reels Virais'}
      </button>

      {!error && (
        <div className="text-center py-4 text-gray-600 text-sm">
          <p className="text-3xl mb-2">♻️</p>
          <p>Selecione os temas, ajuste os filtros e clique em buscar.<br />
          Escolha um vídeo e receba o Reel editado + legenda + veredicto do júri.</p>
        </div>
      )}
    </div>
  )
}

// ─── ResultCard ───────────────────────────────────────────────────────────────
const TIER_STYLES = {
  A: 'bg-green-900/50 text-green-300 border-green-700/60',
  B: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  C: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  D: 'bg-red-900/40 text-red-300 border-red-700/50',
}

function ResultCard({ result, onPrepare }) {
  const [headline, setHeadline] = useState(result.headline || '')
  const [caption,  setCaption]  = useState(result.caption  || '')
  const [showCaption, setShowCaption] = useState(false)

  const tier      = result.quality_tier || 'C'
  const factual   = result.factual_confidence ?? 50
  const clickbait = result.headline_clickbait_risk === 'alto'

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden
      ${result.already_used ? 'border-gray-700 opacity-60' : 'border-gray-800'}`}>

      {clickbait && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 flex items-center gap-2">
          <span className="text-xs text-red-300 font-medium">🚨 Risco de clickbait detectado — revise a headline</span>
        </div>
      )}
      {result.already_used && (
        <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-700 flex items-center gap-2">
          <span className="text-xs text-gray-400">✓ Já usado nesta sessão</span>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-700/60 px-2 py-0.5 rounded-full">
              {result.content_category}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border
              ${result.source === 'tiktok'
                ? 'bg-pink-900/40 text-pink-300 border-pink-700/50'
                : 'bg-purple-900/40 text-purple-300 border-purple-700/50'}`}>
              {result.source === 'tiktok' ? '🎵 TikTok — escrutínio extra' : '📸 Instagram'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${TIER_STYLES[tier] || TIER_STYLES.C}`}>
              Tier {tier}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold
              ${(result.viral_score ?? 0) >= 60
                ? 'bg-green-900/40 text-green-300 border-green-700/50'
                : 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'}`}>
              ⚡ {result.viral_score ?? 0}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border
              ${factual >= 80 ? 'bg-green-900/30 text-green-400 border-green-800/50'
                : factual >= 40 ? 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50'
                : 'bg-red-900/30 text-red-400 border-red-800/50'}`}>
              {factual >= 80 ? '✓' : factual >= 40 ? '⚠' : '✗'} factual {factual}%
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {result.views > 0 && <span>👁 {result.views.toLocaleString('pt-BR')}</span>}
            <span>❤️ {(result.likes || 0).toLocaleString('pt-BR')}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Headline do vídeo</label>
          <input
            type="text"
            value={headline}
            onChange={e => setHeadline(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <button
          onClick={() => setShowCaption(o => !o)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${showCaption ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
          {showCaption ? 'Ocultar' : 'Ver / editar'} legenda do post
        </button>

        {showCaption && (
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          />
        )}
      </div>

      <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between gap-3">
        <a href={result.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Ver original ↗
        </a>
        {result.already_used ? (
          <span className="text-xs text-gray-500 px-5 py-2.5">Já usado</span>
        ) : (
          <button
            onClick={() => onPrepare(result, headline, caption)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Preparar Reel
          </button>
        )}
      </div>
    </div>
  )
}

// ─── PreparingPhase ───────────────────────────────────────────────────────────
function TaskRow({ icon, title, subtitle, status, extra }) {
  return (
    <div className={`flex items-start gap-4 rounded-2xl border p-4 transition-colors
      ${status === 'done'    ? 'border-green-700/50 bg-green-900/20'
        : status === 'error'   ? 'border-red-700/50 bg-red-900/20'
        : status === 'blocked' ? 'border-red-700/50 bg-red-900/20'
        : 'border-indigo-700/50 bg-indigo-900/20'}`}>
      <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
        {status === 'done'    ? <span className="text-xl">✅</span>
         : status === 'error' || status === 'blocked' ? <span className="text-xl">❌</span>
         : (
          <svg className="w-5 h-5 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm font-semibold text-white">{icon} {title}</p>
        <p className="text-xs text-gray-400">{subtitle}</p>
        {extra}
      </div>
    </div>
  )
}

function PreparingPhase({ videoStatus, videoError }) {
  return (
    <div className="space-y-4 py-4">
      <p className="text-center text-sm font-semibold text-white">Preparando seu Reel…</p>
      <p className="text-center text-xs text-gray-500">Download + mini-júri rodam em paralelo ⚡</p>

      <TaskRow
        icon="🎬" title="Criando seu Reel"
        subtitle={
          videoStatus === 'done'  ? 'Vídeo pronto para baixar!'
          : videoStatus === 'error' ? (videoError || 'Erro ao criar vídeo')
          : 'Baixando → mini-júri → adicionando template e headline…'
        }
        status={videoStatus}
      />
    </div>
  )
}

// ─── ReadyPhase ───────────────────────────────────────────────────────────────
function ReadyPhase({ videoBlobUrl, videoError, caption, miniJuryVerdict, miniJuryReason, onReset }) {
  const [copied, setCopied] = useState(false)

  function copyCaption() {
    navigator.clipboard.writeText(caption).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-green-300">✅ Pronto para postar!</p>
        <button onClick={onReset} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          ← Nova busca
        </button>
      </div>

      {miniJuryVerdict === 'WARN' && miniJuryReason && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-yellow-900/30 border border-yellow-700/50 rounded-xl">
          <span className="text-yellow-400 shrink-0">⚠️</span>
          <p className="text-xs text-yellow-300">{miniJuryReason}</p>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-white">🎬 Seu Reel editado</p>

        {videoBlobUrl ? (
          <a href={videoBlobUrl} download="reel_pronto.mp4"
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-xl transition-colors">
            ⬇️ Baixar Reel (.mp4)
          </a>
        ) : (
          <p className="text-xs text-center text-red-400 py-2">
            {videoError || 'Erro ao gerar vídeo'}
          </p>
        )}

        <button onClick={copyCaption}
          className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-xl transition-colors">
          {copied ? '✅ Legenda copiada!' : '📋 Copiar Legenda do Post'}
        </button>
      </div>

      {miniJuryVerdict && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-1">
          <p className="text-xs font-semibold text-gray-400">⚖️ Mini-júri (10 agentes)</p>
          <p className="text-xs text-gray-300">{miniJuryReason}</p>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ContentFinder() {
  const [templateFile,    setTemplateFile]    = useState(null)
  const [selectedThemes,  setSelectedThemes]  = useState(['tecnologia', 'curiosidades', 'ciencia'])
  const [minViews,        setMinViews]        = useState(100000)
  const [minEngagement,   setMinEngagement]   = useState(0)
  const [lang,            setLang]            = useState('any')

  // phases: 'search' | 'results' | 'preparing' | 'ready'
  const [phase,           setPhase]           = useState('search')
  const [searchStatus,    setSearchStatus]    = useState('idle')
  const [searchError,     setSearchError]     = useState('')
  const [results,         setResults]         = useState([])
  const [activeCaption,   setActiveCaption]   = useState('')

  const [videoStatus,     setVideoStatus]     = useState('idle')
  const [videoBlobUrl,    setVideoBlobUrl]    = useState(null)
  const [videoError,      setVideoError]      = useState('')

  const [miniJuryVerdict, setMiniJuryVerdict] = useState(null)
  const [miniJuryReason,  setMiniJuryReason]  = useState('')
  const [blockedReason,   setBlockedReason]   = useState('')
  const pollRef = useRef(null)

  // Transition to ready (or blocked) when video request finishes
  useEffect(() => {
    if (phase === 'preparing' && (videoStatus === 'done' || videoStatus === 'error')) {
      setPhase(videoStatus === 'blocked' ? 'blocked' : 'ready')
    }
  }, [videoStatus, phase])

  async function handleSearch() {
    setSearchStatus('loading')
    setSearchError('')
    setResults([])
    try {
      const res = await fetch(`${API_BASE}/api/content-finder/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themes: selectedThemes, minViews, minEngagement, lang }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      setResults(data.results || [])
      setPhase('results')
    } catch (e) {
      setSearchError(e.message)
    } finally {
      setSearchStatus('idle')
    }
  }

  async function handlePrepare(result, headline, caption) {
    clearInterval(pollRef.current)
    setActiveCaption(caption)
    setPhase('preparing')
    setVideoStatus('loading')
    setVideoBlobUrl(null)
    setVideoError('')
    setMiniJuryVerdict(null)
    setMiniJuryReason('')
    setBlockedReason('')

    ;(async () => {
      try {
        const form = new FormData()
        form.append('postUrl',         result.url)
        if (result.videoUrl) form.append('videoUrl', result.videoUrl)
        form.append('headline',        headline)
        form.append('caption',         caption)
        form.append('originalCaption', result.originalCaption || '')
        if (templateFile) form.append('template', templateFile)

        const res = await fetch(`${API_BASE}/api/content-finder/approve`, { method: 'POST', body: form })

        // Check for mini-jury block (JSON response with blocked:true)
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await res.json()
          if (data.blocked) {
            setBlockedReason(data.reason || 'Conteúdo bloqueado pelo mini-júri')
            setVideoStatus('blocked')
            setPhase('blocked')
            return
          }
          throw new Error(data.error || `Erro ${res.status}`)
        }

        if (!res.ok) throw new Error(`Erro ${res.status}`)

        // Read mini-jury verdict from headers
        const verdict = res.headers.get('X-Mini-Jury-Verdict')
        const reason  = res.headers.get('X-Mini-Jury-Reason')
        if (verdict) setMiniJuryVerdict(verdict)
        if (reason)  setMiniJuryReason(decodeURIComponent(reason))

        const blob = await res.blob()
        setVideoBlobUrl(URL.createObjectURL(blob))
        setVideoStatus('done')
      } catch (e) {
        setVideoError(e.message)
        setVideoStatus('error')
      }
    })()
  }

  function reset() {
    clearInterval(pollRef.current)
    setPhase('search')
    setSearchStatus('idle')
    setSearchError('')
    setResults([])
    setActiveCaption('')
    setVideoStatus('idle')
    setVideoBlobUrl(null)
    setVideoError('')
    setMiniJuryVerdict(null)
    setMiniJuryReason('')
    setBlockedReason('')
  }

  return (
    <div className="max-w-lg mx-auto w-full space-y-5">

      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">♻️ Studio de Reciclagem</h1>
        <p className="text-sm text-gray-400">
          Busque → escolha um reel → receba o vídeo editado + legenda + veredicto do júri
        </p>
      </div>

      {(phase === 'search' || phase === 'results') && (
        <TemplateUpload templateFile={templateFile} onTemplate={setTemplateFile} />
      )}

      {phase === 'search' && (
        <SearchPhase
          selectedThemes={selectedThemes} setSelectedThemes={setSelectedThemes}
          minViews={minViews} setMinViews={setMinViews}
          minEngagement={minEngagement} setMinEngagement={setMinEngagement}
          lang={lang} setLang={setLang}
          onSearch={handleSearch} searching={searchStatus === 'loading'} error={searchError}
        />
      )}

      {phase === 'results' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-green-300">
              {results.length > 0
                ? `${results.length} reel(s) viral(is) encontrado(s) ✅`
                : 'Nenhum reel passou nos critérios ⚠️'}
            </p>
            <button onClick={() => setPhase('search')}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              ← Voltar
            </button>
          </div>

          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 rounded-2xl border border-gray-800">
              <p className="text-2xl mb-2">🔍</p>
              <p className="text-sm">Tente outros temas ou reduza os filtros.</p>
            </div>
          ) : results.map((result, i) => (
            <ResultCard key={i} result={result} onPrepare={handlePrepare} />
          ))}
        </div>
      )}

      {phase === 'preparing' && (
        <PreparingPhase videoStatus={videoStatus} videoError={videoError} />
      )}

      {phase === 'blocked' && (
        <div className="space-y-4 py-4">
          <div className="bg-red-900/30 border border-red-700/60 rounded-2xl p-5 space-y-3">
            <p className="text-sm font-bold text-red-300">🚫 Conteúdo bloqueado pelo mini-júri</p>
            <p className="text-xs text-red-200 leading-relaxed">{blockedReason}</p>
            <p className="text-xs text-gray-400">Revise a headline ou escolha outro vídeo.</p>
          </div>
          <button onClick={() => setPhase('results')}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-xl transition-colors">
            ← Voltar aos resultados
          </button>
          <button onClick={reset}
            className="w-full py-2.5 border border-gray-700 text-gray-500 hover:text-gray-300 text-sm rounded-xl transition-colors">
            Nova busca
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <ReadyPhase
          videoBlobUrl={videoBlobUrl} videoError={videoError}
          caption={activeCaption}
          miniJuryVerdict={miniJuryVerdict} miniJuryReason={miniJuryReason}
          onReset={reset}
        />
      )}
    </div>
  )
}
