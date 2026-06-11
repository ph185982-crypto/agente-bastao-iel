import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../utils/api'

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 80 }) {
  const r = size / 2 - 6
  const circ = 2 * Math.PI * r
  const pct  = Math.min(100, Math.max(0, score))
  const dash = (pct / 100) * circ
  const color = pct >= 75 ? '#22c55e' : pct >= 55 ? '#eab308' : '#ef4444'
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#374151" strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={size * 0.22} fontWeight="bold">{score}</text>
    </svg>
  )
}

function MetricBox({ icon, label, value, color = 'indigo' }) {
  const bg = { indigo:'bg-indigo-900/30 border-indigo-700/40', green:'bg-green-900/30 border-green-700/40', blue:'bg-blue-900/30 border-blue-700/40' }[color]
  const tx = { indigo:'text-indigo-300', green:'text-green-300', blue:'text-blue-300' }[color]
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2.5 ${bg}`}>
      <span className="text-lg">{icon}</span>
      <span className={`text-xl font-bold ${tx}`}>{value}%</span>
      <span className="text-xs text-gray-500 text-center leading-tight">{label}</span>
    </div>
  )
}

function VerdictBadge({ score }) {
  if (score >= 75) return <span className="text-3xl font-black text-green-400 tracking-wide">APROVADO</span>
  if (score >= 55) return <span className="text-3xl font-black text-yellow-400 tracking-wide">REVISAR</span>
  return <span className="text-3xl font-black text-red-400 tracking-wide">REPROVAR</span>
}

function ChatBubble({ name, message, isRight }) {
  return (
    <div className={`flex gap-2 ${isRight ? 'flex-row-reverse' : ''}`}>
      <div className="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5">
        {name[0]}
      </div>
      <div className={`max-w-[75%] ${isRight ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        <span className="text-xs text-gray-500 px-1">{name}</span>
        <div className={`rounded-2xl px-3 py-2 text-sm text-gray-100 ${isRight ? 'bg-indigo-700/60 rounded-tr-sm' : 'bg-gray-700 rounded-tl-sm'}`}>
          {message}
        </div>
      </div>
    </div>
  )
}

function GroupDebateCard({ group, index }) {
  const [open, setOpen] = useState(false)
  const verdict = group.consenso?.veredicto || 'REVISAR'
  const vColor = verdict === 'APROVADO' ? 'text-green-400' : verdict === 'REPROVAR' ? 'text-red-400' : 'text-yellow-400'
  const groupEmojis = { 1: '👥', 2: '💼', 3: '💻', 4: '👴', 5: '🧐' }
  const emoji = groupEmojis[group.groupId] || '👥'

  const lines = (group.debate || '').split('\n').filter(l => l.trim())
  const parsed = lines.map(line => {
    const m = line.match(/^([^:]+):\s*(.+)$/)
    return m ? { name: m[1].trim(), msg: m[2].trim() } : null
  }).filter(Boolean)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{emoji}</span>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">{group.groupName}</p>
            <p className="text-xs text-gray-500">
              {group.stoppedCount}/{group.totalCount} pararam •
              {' '}Score headline: <span className="text-white">{group.consenso?.score_headline ?? '—'}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${vColor}`}>{verdict}</span>
          <svg className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* WhatsApp chat */}
          {parsed.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl p-3 space-y-2.5">
              {parsed.map((line, i) => (
                <ChatBubble key={i} name={line.name} message={line.msg} isRight={i % 3 === 1} />
              ))}
            </div>
          )}

          {/* Consensus */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {group.consenso?.ponto_forte && (
              <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-3">
                <p className="text-green-400 font-semibold mb-1">Ponto forte</p>
                <p className="text-gray-300">{group.consenso.ponto_forte}</p>
              </div>
            )}
            {group.consenso?.problema_principal && (
              <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-3">
                <p className="text-red-400 font-semibold mb-1">Problema</p>
                <p className="text-gray-300">{group.consenso.problema_principal}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function VoiceCard({ voice }) {
  const stopColor = voice.parou ? 'border-green-800/40 bg-green-900/10' : 'border-red-800/40 bg-red-900/10'
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 ${stopColor}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">{voice.name}, {voice.age}a</span>
        <span className={`text-xs ${voice.parou ? 'text-green-400' : 'text-red-400'}`}>
          {voice.parou ? '✅ Parou' : '❌ Passou'}
        </span>
      </div>
      <p className="text-xs text-gray-400 italic">"{voice.pensamento}"</p>
      {voice.motivo && <p className="text-xs text-gray-500">{voice.motivo}</p>}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>{voice.groupName}</span>
        {voice.compartilharia && (
          <span>• {voice.compartilharia === 'sim' ? '📤 compartilharia' : voice.compartilharia === 'talvez' ? '🤔 talvez' : '🚫 não compartilha'}</span>
        )}
      </div>
    </div>
  )
}

function CopyButton({ text, label = 'Copiar' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs font-medium text-gray-200 rounded-lg transition-colors shrink-0"
    >
      {copied ? '✅ Copiado!' : label}
    </button>
  )
}

// ── Processing screen ─────────────────────────────────────────────────────────

function ProcessingScreen({ progress, personasAnalyzed, round, groupResults }) {
  const ROUND_LABELS = [
    '',
    '🧑‍🤝‍🧑 Rodada 1 — Reações instantâneas',
    '📖 Rodada 2 — Análise da descrição',
    '💬 Rodada 3 — Debates em grupo',
    '⚖️ Rodada 4 — Veredito final',
  ]
  const progressPct = round === 1
    ? Math.round((personasAnalyzed / 100) * 25)
    : round === 2 ? 40
    : round === 3 ? 50 + groupResults.length * 10
    : round === 4 ? 95 : 10

  return (
    <div className="space-y-6 py-4">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-gray-400">
          <span>{ROUND_LABELS[round] || '⏳ Preparando...'}</span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Persona counter */}
      {round === 1 && personasAnalyzed > 0 && (
        <div className="text-center">
          <p className="text-4xl font-black text-indigo-400 tabular-nums">{personasAnalyzed}</p>
          <p className="text-sm text-gray-400">de 100 pessoas reagiram</p>
        </div>
      )}

      {/* Group cards */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { id: 1, emoji: '👥', label: 'Casuais', n: 30 },
          { id: 2, emoji: '💼', label: 'Empreen.', n: 25 },
          { id: 3, emoji: '💻', label: 'Tech', n: 20 },
          { id: 4, emoji: '👴', label: '40+', n: 15 },
          { id: 5, emoji: '🧐', label: 'Céticos', n: 10 },
        ].map(g => {
          const done = round > 3 || (round === 3 && groupResults.find(r => r.groupId === g.id))
          const active = round === 1 || round === 2 || (round === 3 && !done)
          return (
            <div
              key={g.id}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors
                ${done ? 'border-green-700/50 bg-green-900/20' : active ? 'border-indigo-700/50 bg-indigo-900/20' : 'border-gray-800 bg-gray-900'}`}
            >
              <span className="text-lg">{g.emoji}</span>
              <span className="text-xs text-gray-400 text-center leading-tight">{g.label}</span>
              {done && <span className="text-xs text-green-400">✓</span>}
              {active && !done && (
                <svg className="w-3 h-3 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-500 text-center">{progress}</p>
    </div>
  )
}

// ── Results screen ────────────────────────────────────────────────────────────

function ResultsScreen({ data }) {
  const { verdict, groupResults, voices } = data
  const v = verdict || {}
  const score = v.score_geral ?? 0

  const [showDebates, setShowDebates] = useState(false)
  const [showVoices, setShowVoices] = useState(false)

  return (
    <div className="space-y-4">

      {/* ─ Veredito principal ─ */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <VerdictBadge score={score} />
            <p className="text-sm text-gray-400">Score geral do júri</p>
          </div>
          <ScoreRing score={score} size={88} />
        </div>

        {/* Alertas */}
        {(v.alerta_clickbait || v.alerta_muito_generico || v.alerta_muito_complexo) && (
          <div className="space-y-1.5">
            {v.alerta_clickbait      && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-1.5">🚨 Risco de clickbait detectado</p>}
            {v.alerta_muito_generico && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-1.5">🚨 Headline muito genérica</p>}
            {v.alerta_muito_complexo && <p className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-1.5">⚠️ Muito complexo para audiência casual</p>}
          </div>
        )}

        {/* 3 métricas */}
        <div className="grid grid-cols-3 gap-2">
          <MetricBox icon="👁️" label="parariam o scroll" value={v.taxa_parada ?? 0} color="indigo" />
          <MetricBox icon="▶️" label="assistiriam completo" value={v.taxa_retencao ?? 0} color="green" />
          <MetricBox icon="📤" label="compartilhariam" value={v.taxa_compartilhamento ?? 0} color="blue" />
        </div>

        {/* Scores individuais */}
        <div className="grid grid-cols-2 gap-3">
          {[['Headline', v.score_headline], ['Descrição', v.score_descricao]].map(([lbl, sc]) => (
            <div key={lbl} className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>{lbl}</span>
                <span className={sc >= 70 ? 'text-green-400' : sc >= 50 ? 'text-yellow-400' : 'text-red-400'}>{sc ?? '—'}</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${sc >= 70 ? 'bg-green-500' : sc >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${sc ?? 0}%` }}/>
              </div>
            </div>
          ))}
        </div>

        {/* Veredicto texto */}
        {v.veredicto_texto && (
          <p className="text-sm text-gray-300 leading-relaxed border-t border-gray-800 pt-3">{v.veredicto_texto}</p>
        )}
      </div>

      {/* ─ Pontos fortes e fracos ─ */}
      {((v.pontos_fortes?.length > 0) || (v.pontos_fracos?.length > 0)) && (
        <div className="grid grid-cols-2 gap-3">
          {v.pontos_fortes?.length > 0 && (
            <div className="bg-green-900/20 border border-green-800/40 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-semibold text-green-400">Pontos fortes</p>
              <ul className="space-y-1.5">
                {v.pontos_fortes.map((p, i) => (
                  <li key={i} className="text-xs text-gray-300 flex gap-2"><span className="text-green-500 shrink-0">✓</span>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {v.pontos_fracos?.length > 0 && (
            <div className="bg-red-900/20 border border-red-800/40 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-semibold text-red-400">Pontos fracos</p>
              <ul className="space-y-1.5">
                {v.pontos_fracos.map((p, i) => (
                  <li key={i} className="text-xs text-gray-300 flex gap-2"><span className="text-red-500 shrink-0">✗</span>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ─ Sugestões de melhoria ─ */}
      {(v.headline_reescrita || v.headline_alternativas?.length > 0 || v.descricao_reescrita) && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
          <p className="text-sm font-semibold text-white">💡 Sugestões de melhoria</p>

          {v.headline_reescrita && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-medium">Headline reescrita</p>
              <div className="flex items-center gap-2 bg-indigo-900/30 border border-indigo-700/40 rounded-xl px-3 py-2.5">
                <p className="flex-1 text-sm font-semibold text-indigo-200">{v.headline_reescrita}</p>
                <CopyButton text={v.headline_reescrita} />
              </div>
            </div>
          )}

          {v.headline_alternativas?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-medium">Alternativas</p>
              <div className="space-y-1.5">
                {v.headline_alternativas.map((alt, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                    <span className="text-xs text-gray-500 w-4 shrink-0">{i + 1}.</span>
                    <p className="flex-1 text-sm text-gray-200">{alt}</p>
                    <CopyButton text={alt} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {v.descricao_reescrita && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-medium">Descrição reescrita</p>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 space-y-2">
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{v.descricao_reescrita}</p>
                <div className="flex justify-end">
                  <CopyButton text={v.descricao_reescrita} label="Copiar descrição" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─ Debates dos grupos (accordion) ─ */}
      {groupResults?.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowDebates(o => !o)}
            className="flex items-center justify-between w-full bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-sm font-semibold text-white">💬 Debates dos grupos</span>
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${showDebates ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>

          {showDebates && (
            <div className="space-y-2">
              {groupResults.map((group, i) => (
                <GroupDebateCard key={group.groupId} group={group} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─ Vozes do Júri ─ */}
      {voices?.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowVoices(o => !o)}
            className="flex items-center justify-between w-full bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-sm font-semibold text-white">🎙️ Vozes do Júri</span>
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${showVoices ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>

          {showVoices && (
            <div className="grid grid-cols-1 gap-2">
              {voices.map((v, i) => <VoiceCard key={i} voice={v} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeadlineJury() {
  const [headline,    setHeadline]    = useState('')
  const [description, setDescription] = useState('')
  const [videoUrl,    setVideoUrl]    = useState('')
  const [status,      setStatus]      = useState('idle')  // idle | processing | done | error
  const [jobId,       setJobId]       = useState(null)
  const [jobData,     setJobData]     = useState({})
  const [error,       setError]       = useState('')
  const pollRef = useRef(null)

  // Polling
  useEffect(() => {
    if (status !== 'processing' || !jobId) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/headline-jury/status/${jobId}`)
        if (!res.ok) return
        const data = await res.json()
        setJobData(data)
        if (data.status === 'done') {
          setStatus('done')
          clearInterval(pollRef.current)
        } else if (data.status === 'error') {
          setError(data.error || 'Erro no processamento')
          setStatus('error')
          clearInterval(pollRef.current)
        }
      } catch (e) {
        console.error('[HeadlineJury] poll error:', e.message)
      }
    }, 2000)
    return () => clearInterval(pollRef.current)
  }, [status, jobId])

  async function handleSubmit() {
    if (!headline.trim() || !description.trim()) return
    setStatus('processing')
    setError('')
    setJobData({})

    try {
      const res = await fetch(`${API_BASE}/api/headline-jury/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: headline.trim(), description: description.trim(), videoUrl: videoUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar análise')
      setJobId(data.jobId)
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }

  function reset() {
    clearInterval(pollRef.current)
    setStatus('idle')
    setJobId(null)
    setJobData({})
    setError('')
  }

  const isProcessing = status === 'processing'
  const isDone       = status === 'done'

  return (
    <div className="max-w-lg mx-auto w-full space-y-5">

      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">⚖️ Fiscalizador de Headlines</h1>
        <p className="text-sm text-gray-400">
          100 agentes simulam sua audiência real e dizem se sua headline vai parar o scroll
        </p>
      </div>

      {/* ── Input form ── */}
      {!isProcessing && !isDone && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Headline <span className="text-gray-600">(texto que vai no vídeo)</span>
            </label>
            <input
              type="text"
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder='Ex: "O que ninguém te contou sobre a China"'
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Descrição / Legenda do post
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              placeholder="Cole aqui a legenda completa que vai acompanhar o Reel…"
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              URL do vídeo <span className="text-gray-600">(opcional)</span>
            </label>
            <input
              type="url"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/…"
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {status === 'error' && error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!headline.trim() || !description.trim()}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            🔍 Enviar para o Júri
          </button>

          <p className="text-center text-xs text-gray-600">
            100 agentes vão analisar seu conteúdo como sua audiência real
          </p>

          <div className="text-center py-4 text-gray-600 text-sm">
            <p className="text-3xl mb-2">⚖️</p>
            <p>Escreva sua headline e descrição acima.<br/>O júri vai simular como sua audiência reage.</p>
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {isProcessing && (
        <ProcessingScreen
          progress={jobData.progress || '⏳ Preparando o júri...'}
          personasAnalyzed={jobData.personasAnalyzed || 0}
          round={jobData.round || 0}
          groupResults={jobData.groupResults || []}
        />
      )}

      {/* ── Results ── */}
      {isDone && jobData.results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Análise completa • 100 agentes</p>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Nova análise
            </button>
          </div>
          <ResultsScreen data={jobData.results} />
        </div>
      )}

      {status === 'error' && !isProcessing && !isDone && error && (
        <div className="text-center py-8 space-y-3">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  )
}
