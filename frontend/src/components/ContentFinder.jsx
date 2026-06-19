import { useState, useEffect, useRef, useMemo } from 'react'
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

// Formata velocidade viral (views/hora) — ex: 24500 → "24,5K"
function formatVelocity(v) {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace('.', ',')}M`
  if (v >= 1000)    return `${(v / 1000).toFixed(1).replace('.', ',')}K`
  return String(v)
}

// Formata idade do post — ex: 0.5 → "hoje", 1 → "1 dia", 5 → "5 dias"
function formatAge(days) {
  if (days < 1)  return 'hoje'
  const d = Math.round(days)
  return d === 1 ? '1 dia' : `${d} dias`
}

// Formata "tempo atrás" a partir de um timestamp (ms) — ex: "há 2h", "há 5min"
function formatAgo(ts) {
  if (!ts) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1)   return 'agora'
  if (mins < 60)  return `há ${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `há ${hrs}h`
  const days = Math.floor(hrs / 24)
  return days === 1 ? 'há 1 dia' : `há ${days} dias`
}

// ─── Cofre: centro de comando ──────────────────────────────────────────────────
function StatPill({ icon, label, value }) {
  return (
    <div className="flex-1 min-w-0 bg-gray-900/80 border border-gray-800 rounded-xl px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 truncate">{icon} {label}</p>
      <p className="text-sm font-bold text-white truncate">{value}</p>
    </div>
  )
}

function VaultStats({ count, approved, pending, meta, onRefresh, refreshing }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
          </span>
          <p className="text-xs text-green-300 font-medium">Minerador + Júri ativos · trabalhando sozinhos</p>
        </div>
        <button onClick={onRefresh} disabled={refreshing}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50">
          {refreshing ? '↻ …' : '↻ Atualizar'}
        </button>
      </div>
      <div className="flex gap-2">
        <StatPill icon="🏆" label="No cofre"    value={count} />
        <StatPill icon="✅" label="Aprovados"   value={approved} />
        <StatPill icon="⏳" label="Aguardando"  value={pending} />
        <StatPill icon="⛏️" label="Minerado"    value={meta?.updatedAt ? formatAgo(meta.updatedAt) : '—'} />
      </div>
    </div>
  )
}

function FilterSortBar({ filter, setFilter, sort, setSort }) {
  const filters = [
    { k: 'all',      label: 'Todos' },
    { k: 'approved', label: '✅ Aprovados' },
    { k: 'pending',  label: '⏳ Aguardando' },
  ]
  const sorts = [
    { k: 'velocity', label: '🔥 Velocidade' },
    { k: 'score',    label: '⭐ Score' },
    { k: 'fresh',    label: '✨ Recentes' },
  ]
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {filters.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
              ${filter === f.k ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 items-center">
        <span className="text-xs text-gray-600 shrink-0">Ordenar:</span>
        {sorts.map(s => (
          <button key={s.k} onClick={() => setSort(s.k)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors
              ${sort === s.k ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-800/50 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3 animate-pulse">
      <div className="flex gap-2">
        <div className="h-5 w-20 bg-gray-800 rounded-full" />
        <div className="h-5 w-16 bg-gray-800 rounded-full" />
      </div>
      <div className="h-48 bg-gray-800 rounded-xl" />
      <div className="h-9 bg-gray-800 rounded-xl" />
    </div>
  )
}

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
function VideoPreview({ videoUrl }) {
  const [blobUrl,    setBlobUrl]    = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(false)
  const [playing,    setPlaying]    = useState(false)
  const videoRef = useRef(null)

  async function loadAndPlay() {
    if (blobUrl) {
      // Already loaded — toggle play/pause
      const vid = videoRef.current
      if (!vid) return
      if (vid.paused) { vid.play(); setPlaying(true) }
      else            { vid.pause(); setPlaying(false) }
      return
    }
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`${API_BASE}/api/content-finder/preview-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl }),
      })
      if (!res.ok) throw new Error('fetch failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      setBlobUrl(url)
      setPlaying(true)
      // autoplay after state update
      setTimeout(() => { if (videoRef.current) videoRef.current.play() }, 50)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-gray-800" style={{ height: '200px' }}>
      {blobUrl ? (
        <video
          ref={videoRef}
          src={blobUrl}
          className="w-full h-full object-cover"
          playsInline
          loop
          onEnded={() => setPlaying(false)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-800">
          <span className="text-4xl opacity-30">🎬</span>
        </div>
      )}

      {/* Play/pause overlay button */}
      {!error && (
        <button
          onClick={loadAndPlay}
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors group"
          title={playing ? 'Pausar' : 'Pré-visualizar vídeo'}
        >
          {loading ? (
            <svg className="w-10 h-10 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : playing ? (
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
              <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          )}
        </button>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <p className="text-xs text-gray-500">Prévia não disponível</p>
        </div>
      )}
    </div>
  )
}

function JurySeal({ verdict, pct }) {
  if (!verdict) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-800 text-gray-400 border-gray-700">
        ⚖️ aguardando júri…
      </span>
    )
  }
  const map = {
    APPROVED: { cls: 'bg-green-900/40 text-green-300 border-green-700/50',   txt: `⚖️ Aprovado · ${pct}%` },
    WARN:     { cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50', txt: `⚖️ Dividido · ${pct}%` },
    REJECTED: { cls: 'bg-red-900/40 text-red-300 border-red-700/50',          txt: `⚖️ Reprovado · ${pct}%` },
  }
  const s = map[verdict] || map.WARN
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${s.cls}`}>{s.txt}</span>
}

function ResultCard({ result, onPrepare, showJury }) {
  const [headline, setHeadline] = useState(result.headline || '')
  const [caption,  setCaption]  = useState(result.caption  || '')

  const shortCaption = (result.originalCaption || '').slice(0, 120)
  const isVetted = !!result.vetVerdict

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden
      ${result.already_used ? 'border-gray-700 opacity-60' : 'border-gray-800'}`}>

      {result.already_used && (
        <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-700 flex items-center gap-2">
          <span className="text-xs text-gray-400">Ja usado nesta sessao</span>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Badges row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {showJury && <JurySeal verdict={result.vetVerdict} pct={result.juryApprovalPct} />}
            <span className="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-700/60 px-2 py-0.5 rounded-full">
              {result.content_category}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border
              ${result.source === 'tiktok'
                ? 'bg-pink-900/40 text-pink-300 border-pink-700/50'
                : 'bg-purple-900/40 text-purple-300 border-purple-700/50'}`}>
              {result.source === 'tiktok' ? 'TikTok' : 'Instagram'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold
              ${(result.viral_score ?? 0) >= 60
                ? 'bg-green-900/40 text-green-300 border-green-700/50'
                : 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'}`}>
              Score {result.viral_score ?? 0}
            </span>
            {result.velocity != null && result.velocity >= 1000 && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-red-900/40 text-red-300 border-red-700/50 font-semibold">
                🔥 {formatVelocity(result.velocity)}/h
              </span>
            )}
            {result.age_days != null && result.age_days <= 7 && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-900/40 text-emerald-300 border-emerald-700/50">
                ✨ {formatAge(result.age_days)}
              </span>
            )}
            {result.controversy_flag && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-900/40 text-orange-300 border-orange-700/50">
                Polemico
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {result.views > 0 && <span>{result.views.toLocaleString('pt-BR')} views</span>}
            <span>{(result.likes || 0).toLocaleString('pt-BR')} likes</span>
          </div>
        </div>

        {/* Jury reasoning */}
        {showJury && isVetted && result.juryReason && (
          <p className="text-xs text-gray-500 italic">⚖️ {result.juryReason}</p>
        )}

        {/* Original caption preview */}
        {shortCaption && (
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">{shortCaption}{result.originalCaption?.length > 120 ? '…' : ''}</p>
        )}

        {/* Inline video preview */}
        {result.videoUrl && (
          <VideoPreview videoUrl={result.videoUrl} />
        )}

        {/* Headline input — empty by default, GPT fills it if left blank */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Headline do vídeo
            <span className="text-gray-600 ml-1">
              {result.headline ? '(gerada pela IA — edite se quiser)' : '(deixe vazio para a IA gerar)'}
            </span>
          </label>
          <input
            type="text"
            value={headline}
            onChange={e => setHeadline(e.target.value)}
            placeholder="IA vai gerar uma headline…"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between gap-3">
        <a href={result.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Ver original
        </a>
        {result.already_used ? (
          <span className="text-xs text-gray-500 px-5 py-2.5">Ja usado</span>
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

function PreparingPhase({ videoStatus, videoError, headlineEmpty, onBackToResults }) {
  return (
    <div className="space-y-4 py-4">
      <p className="text-center text-sm font-semibold text-white">Preparando seu Reel…</p>
      <p className="text-center text-xs text-gray-500">Download + mini-júri rodam em paralelo</p>

      {headlineEmpty && videoStatus === 'loading' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-indigo-900/30 border border-indigo-700/50 rounded-xl">
          <svg className="w-4 h-4 text-indigo-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-xs text-indigo-300">Gerando headline + legenda com IA…</p>
        </div>
      )}

      <TaskRow
        icon="🎬" title="Criando seu Reel"
        subtitle={
          videoStatus === 'done'  ? 'Vídeo pronto para baixar!'
          : videoStatus === 'error' ? (videoError || 'Erro ao criar vídeo')
          : 'Baixando → mini-júri → adicionando template e headline…'
        }
        status={videoStatus}
      />

      {videoStatus === 'error' && onBackToResults && (
        <button onClick={onBackToResults}
          className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-xl transition-colors">
          ← Voltar aos resultados
        </button>
      )}
    </div>
  )
}

// ─── ReadyPhase ───────────────────────────────────────────────────────────────
function ReadyPhase({ videoBlobUrl, videoError, caption, miniJuryVerdict, miniJuryReason, onReset, onBackToResults }) {
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
        <div className="flex gap-3">
          {onBackToResults && (
            <button onClick={onBackToResults} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              ← Resultados
            </button>
          )}
          <button onClick={onReset} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Nova busca
          </button>
        </div>
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
  const [headlineWasEmpty, setHeadlineWasEmpty] = useState(false)
  const [vaultMeta,       setVaultMeta]       = useState(null)
  const [vaultCount,      setVaultCount]      = useState(0)
  const [vaultLoading,    setVaultLoading]    = useState(false)
  const [fromVault,       setFromVault]       = useState(false)
  const [booting,         setBooting]         = useState(true)
  const [vaultFilter,     setVaultFilter]     = useState('all')
  const [vaultSort,       setVaultSort]       = useState('velocity')
  const pollRef = useRef(null)

  // Ao montar: abre direto no cofre se houver vídeos (centro de comando)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/content-finder/feed`)
        const data = await res.json()
        if (!alive) return
        if (data.enabled && (data.results || []).length > 0) {
          setResults(data.results)
          setVaultMeta(data.meta || null)
          setVaultCount(data.results.length)
          setFromVault(true)
          setPhase('results')
        }
      } catch { /* cofre indisponível — segue para a busca manual */ }
      finally { if (alive) setBooting(false) }
    })()
    return () => { alive = false }
  }, [])

  async function loadVault(silent = false) {
    if (!silent) setVaultLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/content-finder/feed`)
      const data = await res.json()
      setResults(data.results || [])
      setVaultMeta(data.meta || null)
      setVaultCount((data.results || []).length)
      setFromVault(true)
      setPhase('results')
    } catch (e) {
      setSearchError('Não foi possível abrir o cofre')
    } finally {
      setVaultLoading(false)
    }
  }

  // Lista exibida: aplica filtro + ordenação quando vem do cofre
  const displayResults = useMemo(() => {
    if (!fromVault) return results
    let arr = [...results]
    if (vaultFilter === 'approved')     arr = arr.filter(r => r.vetVerdict === 'APPROVED')
    else if (vaultFilter === 'pending') arr = arr.filter(r => !r.vetVerdict)
    if (vaultSort === 'fresh')      arr.sort((a, b) => (a.age_days ?? 999) - (b.age_days ?? 999))
    else if (vaultSort === 'score') arr.sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0))
    else                            arr.sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0))
    return arr
  }, [results, fromVault, vaultFilter, vaultSort])

  const approvedCount = useMemo(() => results.filter(r => r.vetVerdict === 'APPROVED').length, [results])
  const pendingCount  = useMemo(() => results.filter(r => !r.vetVerdict).length, [results])

  // Auto-refresh do cofre: novos vídeos vetados aparecem sozinhos a cada 50s
  useEffect(() => {
    if (phase !== 'results' || !fromVault) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/content-finder/feed`)
        const data = await res.json()
        if (data.enabled) {
          setResults(data.results || [])
          setVaultMeta(data.meta || null)
          setVaultCount((data.results || []).length)
        }
      } catch { /* silencioso */ }
    }, 50000)
    return () => clearInterval(id)
  }, [phase, fromVault])

  // Transition to ready (or blocked) when video request finishes
  useEffect(() => {
    if (phase === 'preparing' && (videoStatus === 'done' || videoStatus === 'error')) {
      setPhase(videoStatus === 'blocked' ? 'blocked' : 'ready')
    }
  }, [videoStatus, phase])

  async function handleSearch() {
    setSearchStatus('loading')
    setSearchError('')
    setFromVault(false)
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
    const headlineEmpty = !headline?.trim()
    setHeadlineWasEmpty(headlineEmpty)
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
        if (result.videoUrl)      form.append('videoUrl',        result.videoUrl)
        if (headline?.trim())     form.append('headline',        headline.trim())
        if (caption?.trim())      form.append('caption',         caption.trim())
        form.append('originalCaption', result.originalCaption || '')
        form.append('views',           String(result.views    || 0))
        form.append('likes',           String(result.likes    || 0))
        form.append('comments',        String(result.comments || 0))
        form.append('sourceUsername',  result.sourceUsername  || '')
        form.append('source',          result.source          || 'instagram')
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
    setFromVault(false)
  }

  return (
    <div className="max-w-lg mx-auto w-full space-y-5">

      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">♻️ Studio de Reciclagem</h1>
        <p className="text-sm text-gray-400">
          O cofre é abastecido sozinho · você escolhe → recebe o Reel editado + legenda
        </p>
      </div>

      {booting && (
        <div className="space-y-4">
          <div className="h-14 bg-gray-900 border border-gray-800 rounded-2xl animate-pulse" />
          <div className="flex gap-2">
            {[0,1,2,3].map(i => <div key={i} className="flex-1 h-12 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />)}
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!booting && (phase === 'search' || phase === 'results') && (
        <TemplateUpload templateFile={templateFile} onTemplate={setTemplateFile} />
      )}

      {!booting && phase === 'search' && vaultCount > 0 && (
        <button onClick={loadVault} disabled={vaultLoading}
          className="w-full text-left bg-gradient-to-r from-amber-900/40 to-yellow-900/30 border border-amber-700/50 rounded-2xl p-4 hover:border-amber-500/70 transition-colors disabled:opacity-50">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                🏆 {vaultCount} vídeos minerados no cofre
              </p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                O minerador trabalha sozinho · vetados e ranqueados por calor viral
                {vaultMeta?.updatedAt ? ` · atualizado ${formatAgo(vaultMeta.updatedAt)}` : ''}
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-200 bg-amber-800/40 border border-amber-600/50 rounded-full px-3 py-1.5 shrink-0">
              {vaultLoading ? '…' : 'Ver cofre →'}
            </span>
          </div>
        </button>
      )}

      {!booting && phase === 'search' && (
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
          {fromVault ? (
            <>
              <VaultStats
                count={vaultCount} approved={approvedCount} pending={pendingCount}
                meta={vaultMeta} onRefresh={() => loadVault()} refreshing={vaultLoading}
              />
              <FilterSortBar filter={vaultFilter} setFilter={setVaultFilter} sort={vaultSort} setSort={setVaultSort} />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {displayResults.length} vídeo{displayResults.length !== 1 ? 's' : ''}
                  {vaultFilter !== 'all' ? ' (filtrado)' : ''}
                </p>
                <button onClick={() => setPhase('search')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0">
                  🔍 Buscar ao vivo
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-300">{results.length} reels virais encontrados</p>
                <p className="text-xs text-gray-500 mt-0.5">Ranqueados por calor viral 🔥 (velocidade + frescor + engajamento)</p>
              </div>
              <button onClick={() => setPhase('search')}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors shrink-0">
                Voltar
              </button>
            </div>
          )}

          {displayResults.length === 0 ? (
            <div className="text-center py-10 text-gray-600 text-sm">
              <p className="text-3xl mb-2">🗂️</p>
              <p>Nenhum vídeo neste filtro.<br />Os agentes estão minerando — atualize em instantes.</p>
            </div>
          ) : (
            displayResults.map((result, i) => (
              <ResultCard key={result.url || i} result={result} onPrepare={handlePrepare} showJury={fromVault} />
            ))
          )}
        </div>
      )}

      {phase === 'preparing' && (
        <PreparingPhase videoStatus={videoStatus} videoError={videoError} headlineEmpty={headlineWasEmpty}
          onBackToResults={results.length > 0 ? () => setPhase('results') : null} />
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
          onBackToResults={results.length > 0 ? () => setPhase('results') : null}
        />
      )}
    </div>
  )
}
