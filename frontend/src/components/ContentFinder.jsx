import { useState, useRef } from 'react'
import { API_BASE } from '../utils/api'

// ── Constantes de configuração ────────────────────────────────────────────────

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

function TemplateUpload({ templateFile, onTemplate }) {
  const inputRef = useRef(null)
  const previewUrl = templateFile ? URL.createObjectURL(templateFile) : null

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Fundo do Reel</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Envie o template com seu cabeçalho (@Pedro Destrava). Usado em todos os vídeos.
          </p>
        </div>
        {templateFile && (
          <span className="text-xs bg-green-900/40 text-green-300 border border-green-700/60 px-2 py-0.5 rounded-full">
            ✓ Carregado
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="template"
            className="w-10 h-16 object-cover rounded-lg shrink-0 border border-gray-700"
          />
        )}
        <button
          onClick={() => inputRef.current?.click()}
          className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-xl transition-colors"
        >
          {templateFile ? '↩ Trocar template' : '📁 Selecionar template (PNG/JPG)'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { if (e.target.files[0]) onTemplate(e.target.files[0]) }}
        />
      </div>

      {!templateFile && (
        <p className="text-xs text-yellow-500/80">
          ⚠️ Sem template: o vídeo sai com barra de título simples (sem o fundo do seu perfil).
        </p>
      )}
    </div>
  )
}

function ResultCard({ result, templateFile, onApprove }) {
  const [headline, setHeadline] = useState(() => result.headline || '')
  const [caption, setCaption]   = useState(() => result.caption  || '')
  const [editStatus, setEditStatus] = useState('idle')
  const [editError, setEditError]   = useState(null)
  const [blobUrl, setBlobUrl]       = useState(null)
  const [copied, setCopied] = useState(false)

  async function handlePrepare() {
    setEditStatus('processing')
    setEditError(null)
    setBlobUrl(null)
    try {
      const url = await onApprove(result, headline, caption, templateFile)
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
      <div className="flex gap-3 p-4">
        <div className="w-20 h-28 bg-gray-800 rounded-xl shrink-0 flex items-center justify-center">
          <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>

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
          <ScoreBar score={result.viral_score   || 0} label="Viral score" />
          <ScoreBar score={result.fit_for_profile || 0} label="Fit perfil" />
          <div className="flex gap-1.5 flex-wrap">
            <RiskBadge label="Ban"       level={result.ban_risk       || 'baixo'} />
            <RiskBadge label="Copyright" level={result.copyright_risk || 'baixo'} />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 px-4 pt-3 pb-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Headline (aparece no vídeo)</label>
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

        {editStatus === 'processing' && (
          <div className="flex items-center gap-2 text-xs text-indigo-400">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Montando o reel… até 1 minuto
          </div>
        )}

        {editStatus === 'error' && editError && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            Erro: {editError}
          </p>
        )}

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
  const [templateFile, setTemplateFile]     = useState(null)
  const [selectedThemes, setSelectedThemes] = useState(['tecnologia', 'curiosidades', 'ciencia'])
  const [minViews, setMinViews]             = useState(100000)
  const [minEngagement, setMinEngagement]   = useState(0)
  const [lang, setLang]                     = useState('any')
  const [status, setStatus]   = useState('idle')
  const [results, setResults] = useState([])
  const [error, setError]     = useState('')

  function toggleTheme(key) {
    setSelectedThemes(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  async function handleSearch() {
    if (selectedThemes.length === 0) return
    setStatus('processing')
    setResults([])
    setError('')

    try {
      const res = await fetch(`${API_BASE}/api/content-finder/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themes: selectedThemes, minViews, minEngagement, lang }),
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

  async function handleApprove(result, headline, caption, templateFile) {
    const form = new FormData()
    form.append('postUrl',  result.url)
    if (result.videoUrl) form.append('videoUrl', result.videoUrl)
    form.append('headline', headline)
    form.append('caption',  caption)
    if (templateFile) form.append('template', templateFile)

    const res = await fetch(`${API_BASE}/api/content-finder/approve`, {
      method: 'POST',
      body: form,
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

      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">Reciclagem de Conteúdo</h1>
        <p className="text-sm text-gray-400">
          4 agentes de IA buscam reels virais, analisam e montam o vídeo pronto no seu formato
        </p>
      </div>

      {/* Template upload — sempre visível */}
      <TemplateUpload templateFile={templateFile} onTemplate={setTemplateFile} />

      {!isProcessing && !isDone && (
        <div className="space-y-5">

          {/* Chips de temas */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">
              Temas para buscar reels virais
              <span className="text-gray-600 ml-1">({selectedThemes.length} selecionado{selectedThemes.length !== 1 ? 's' : ''})</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleTheme(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border
                    ${selectedThemes.includes(key)
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtros de métricas */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-300">Filtros de métricas</p>

            <div className="grid grid-cols-2 gap-3">
              {/* Views mínimas */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Views mínimas</label>
                <div className="flex gap-1 flex-wrap">
                  {VIEWS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setMinViews(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border
                        ${minViews === opt.value
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Engajamento */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Engajamento</label>
                <div className="flex gap-1 flex-wrap">
                  {ENGAGEMENT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setMinEngagement(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border
                        ${minEngagement === opt.value
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Preferência de idioma */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <p className="text-xs font-semibold text-gray-300 mb-3">Idioma do vídeo</p>
            <div className="flex gap-2">
              <button
                onClick={() => setLang('any')}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border
                  ${lang === 'any'
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
              >
                🌍 Qualquer idioma
                <span className="block text-gray-400 font-normal mt-0.5" style={{ fontSize: '10px' }}>
                  {lang === 'any' ? 'IA adapta a legenda' : 'IA adapta a legenda'}
                </span>
              </button>
              <button
                onClick={() => setLang('pt')}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border
                  ${lang === 'pt'
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
              >
                🇧🇷 Só Português
                <span className="block text-gray-400 font-normal mt-0.5" style={{ fontSize: '10px' }}>
                  filtra captions BR
                </span>
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSearch}
            disabled={selectedThemes.length === 0}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            🔍 Buscar Reels Virais
          </button>

          {!error && (
            <div className="text-center py-4 text-gray-600 text-sm">
              <p className="text-3xl mb-2">♻️</p>
              <p>Selecione os temas, ajuste os filtros e clique em buscar.<br />A IA filtra reels virais e gera copy pronto para postar.</p>
            </div>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="flex flex-col items-center gap-4 py-10">
          <svg className="w-10 h-10 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm text-gray-400 text-center">
            Garimpando reels virais por hashtags…<br />
            <span className="text-xs text-gray-600">Agentes 1 → 2 → 3 em execução. Até 1 minuto.</span>
          </p>
        </div>
      )}

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
              <p>Tente outros temas ou reduza os filtros de métricas.</p>
            </div>
          )}

          {results.map((result, i) => (
            <ResultCard
              key={i}
              result={result}
              templateFile={templateFile}
              onApprove={handleApprove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
