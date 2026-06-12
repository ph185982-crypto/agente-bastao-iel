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
function ResultCard({ result, onPrepare }) {
  const [headline, setHeadline] = useState(result.headline || '')
  const [caption,  setCaption]  = useState(result.caption  || '')
  const [showCaption, setShowCaption] = useState(false)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
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
              {result.source === 'tiktok' ? '🎵 TikTok' : '📸 Instagram'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold
              ${(result.viral_score ?? 0) >= 60
                ? 'bg-green-900/40 text-green-300 border-green-700/50'
                : 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'}`}>
              ⚡ Score {result.viral_score ?? 0}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
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
        <button
          onClick={() => onPrepare(result, headline, caption)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          🚀 Preparar Reel
        </button>
      </div>
    </div>
  )
}

// ─── PreparingPhase ───────────────────────────────────────────────────────────
function PreparingPhase({ videoStatus, videoError, juryStatus, juryData }) {
  const round         = juryData?.round ?? 0
  const personasDone  = juryData?.personasAnalyzed ?? 0
  const ROUND_LABEL   = {
    0: '⏳ Iniciando…',
    1: `🧑‍🤝‍🧑 Rodada 1 — ${personasDone}/100 pessoas reagiram`,
    2: '📖 Rodada 2 — Análise da descrição',
    3: '💬 Rodada 3 — Debates em grupo',
    4: '⚖️ Rodada 4 — Veredito final',
  }

  function TaskRow({ icon, title, subtitle, status, extra }) {
    return (
      <div className={`flex items-start gap-4 rounded-2xl border p-4 transition-colors
        ${status === 'done'  ? 'border-green-700/50 bg-green-900/20'
          : status === 'error' ? 'border-red-700/50 bg-red-900/20'
          : 'border-indigo-700/50 bg-indigo-900/20'}`}>
        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
          {status === 'done'  ? <span className="text-xl">✅</span>
           : status === 'error' ? <span className="text-xl">❌</span>
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

  return (
    <div className="space-y-4 py-4">
      <p className="text-center text-sm font-semibold text-white">Preparando seu Reel…</p>
      <p className="text-center text-xs text-gray-500">As duas tarefas rodam ao mesmo tempo ⚡</p>

      <TaskRow
        icon="🎬" title="Criando seu Reel"
        subtitle={
          videoStatus === 'done'  ? 'Vídeo pronto para baixar!'
          : videoStatus === 'error' ? (videoError || 'Erro ao criar vídeo')
          : 'Baixando → adicionando template e headline…'
        }
        status={videoStatus}
      />

      <TaskRow
        icon="⚖️" title="Júri de 100 Agentes"
        subtitle={
          juryStatus === 'done'  ? 'Análise completa!'
          : juryStatus === 'error' ? 'Erro na análise'
          : ROUND_LABEL[round] || '⏳ Iniciando…'
        }
        status={juryStatus}
        extra={
          juryStatus !== 'done' && juryStatus !== 'error' && round === 1 && personasDone > 0 ? (
            <div className="space-y-1">
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${personasDone}%` }}/>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
}

// ─── ReadyPhase ───────────────────────────────────────────────────────────────
function ReadyPhase({ videoBlobUrl, videoError, caption, juryStatus, juryData, onReset }) {
  const [copied, setCopied] = useState(false)
  const v     = juryData?.results?.verdict ?? {}
  const score = v.score_geral ?? null

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

      {/* ─ Baixar vídeo + copiar legenda ─ */}
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

      {/* ─ Veredicto do Júri ─ */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold text-white">⚖️ Veredicto do Júri</p>

        {juryStatus === 'loading' && (
          <div className="flex items-center gap-3 text-xs text-gray-400 py-2">
            <svg className="w-4 h-4 animate-spin text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span>
              {juryData?.progress || '100 agentes analisando…'}
              {juryData?.round ? ` (rodada ${juryData.round}/4)` : ''}
            </span>
          </div>
        )}

        {juryStatus === 'error' && (
          <p className="text-xs text-red-400">Não foi possível obter o veredicto do júri.</p>
        )}

        {juryStatus === 'done' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <ScoreRing score={score} size={80} />
              <div>
                <p className={`text-2xl font-black
                  ${score >= 75 ? 'text-green-400' : score >= 55 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {score >= 75 ? 'APROVADO' : score >= 55 ? 'REVISAR' : 'REPROVAR'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Score geral do júri</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: '👁️', label: 'parariam', value: v.taxa_parada ?? 0 },
                { icon: '▶️', label: 'assistiriam', value: v.taxa_retencao ?? 0 },
                { icon: '📤', label: 'compartilhariam', value: v.taxa_compartilhamento ?? 0 },
              ].map(m => (
                <div key={m.label} className="flex flex-col items-center gap-1 bg-gray-800 rounded-xl p-2.5">
                  <span className="text-lg">{m.icon}</span>
                  <span className="text-lg font-bold text-indigo-300">{m.value}%</span>
                  <span className="text-xs text-gray-500 text-center leading-tight">{m.label}</span>
                </div>
              ))}
            </div>

            {(v.alerta_clickbait || v.alerta_muito_generico || v.alerta_muito_complexo) && (
              <div className="space-y-1.5">
                {v.alerta_clickbait      && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-1.5">🚨 Risco de clickbait</p>}
                {v.alerta_muito_generico && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-1.5">🚨 Headline muito genérica</p>}
                {v.alerta_muito_complexo && <p className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-1.5">⚠️ Complexo para audiência casual</p>}
              </div>
            )}

            {v.veredicto_texto && (
              <p className="text-sm text-gray-300 leading-relaxed">{v.veredicto_texto}</p>
            )}

            {(v.headline_reescrita || v.headline_alternativas?.length > 0) && (
              <div className="space-y-2 border-t border-gray-800 pt-3">
                <p className="text-xs font-semibold text-gray-400">💡 Sugestões do júri</p>

                {v.headline_reescrita && (
                  <div className="flex items-center gap-2 bg-indigo-900/30 border border-indigo-700/40 rounded-xl px-3 py-2.5">
                    <p className="flex-1 text-sm font-semibold text-indigo-200">{v.headline_reescrita}</p>
                    <button
                      onClick={() => navigator.clipboard.writeText(v.headline_reescrita).catch(() => {})}
                      className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-300 shrink-0">
                      Copiar
                    </button>
                  </div>
                )}

                {v.headline_alternativas?.map((alt, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                    <span className="text-xs text-gray-500 w-4 shrink-0">{i + 1}.</span>
                    <p className="flex-1 text-sm text-gray-200">{alt}</p>
                    <button
                      onClick={() => navigator.clipboard.writeText(alt).catch(() => {})}
                      className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-300 shrink-0">
                      Copiar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
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

  const [juryStatus,      setJuryStatus]      = useState('idle')
  const [juryJobId,       setJuryJobId]       = useState(null)
  const [juryData,        setJuryData]        = useState(null)
  const pollRef = useRef(null)

  // Jury polling
  useEffect(() => {
    if (juryStatus !== 'loading' || !juryJobId) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/headline-jury/status/${juryJobId}`)
        if (!res.ok) return
        const data = await res.json()
        setJuryData(data)
        if (data.status === 'done') {
          setJuryStatus('done')
          clearInterval(pollRef.current)
        } else if (data.status === 'error') {
          setJuryStatus('error')
          clearInterval(pollRef.current)
        }
      } catch (_) {}
    }, 2000)
    return () => clearInterval(pollRef.current)
  }, [juryStatus, juryJobId])

  // Transition to ready as soon as video finishes (jury keeps loading in the ready screen)
  useEffect(() => {
    if (phase === 'preparing' && (videoStatus === 'done' || videoStatus === 'error')) {
      setPhase('ready')
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
    setJuryStatus('loading')
    setVideoBlobUrl(null)
    setVideoError('')
    setJuryData(null)
    setJuryJobId(null)

    // Video editing — fire and track
    ;(async () => {
      try {
        const form = new FormData()
        form.append('postUrl',  result.url)
        if (result.videoUrl) form.append('videoUrl', result.videoUrl)
        form.append('headline', headline)
        form.append('caption',  caption)
        if (templateFile) form.append('template', templateFile)

        const res = await fetch(`${API_BASE}/api/content-finder/approve`, { method: 'POST', body: form })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}))
          throw new Error(error || `Erro ${res.status}`)
        }
        const blob = await res.blob()
        setVideoBlobUrl(URL.createObjectURL(blob))
        setVideoStatus('done')
      } catch (e) {
        setVideoError(e.message)
        setVideoStatus('error')
      }
    })()

    // Jury — fire and track via polling
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/headline-jury/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headline, description: caption, videoUrl: result.url }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Erro')
        setJuryJobId(data.jobId)
      } catch (_) {
        setJuryStatus('error')
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
    setJuryStatus('idle')
    setJuryJobId(null)
    setJuryData(null)
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
        <PreparingPhase
          videoStatus={videoStatus} videoError={videoError}
          juryStatus={juryStatus} juryData={juryData}
        />
      )}

      {phase === 'ready' && (
        <ReadyPhase
          videoBlobUrl={videoBlobUrl} videoError={videoError}
          caption={activeCaption}
          juryStatus={juryStatus} juryData={juryData}
          onReset={reset}
        />
      )}
    </div>
  )
}
