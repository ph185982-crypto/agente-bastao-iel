import { useState, useRef } from 'react'
import { API_BASE } from '../utils/api'
import { saveToGallery } from '../utils/gallery'

const THEME_OPTIONS = [
  { key: 'ciencia',      label: '🔬 Ciência' },
  { key: 'tecnologia',   label: '🤖 Tecnologia' },
  { key: 'historia',     label: '🏛️ História' },
  { key: 'espaco',       label: '🚀 Espaço' },
  { key: 'china',        label: '🇨🇳 China' },
  { key: 'engenharia',   label: '⚙️ Engenharia' },
  { key: 'curiosidades', label: '🧠 Curiosidades' },
  { key: 'invencoes',    label: '💡 Invenções' },
]

function fmtNum(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.', ',')}M`
  if (n >= 1000)    return `${(n / 1000).toFixed(1).replace('.', ',')}K`
  return String(n || 0)
}

// ─── Carrossel viral (inspiração) ───────────────────────────────────────────────
function ViralCard({ item, onClone, cloning }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex gap-3 p-3">
      <div className="w-24 h-32 rounded-xl overflow-hidden bg-gray-800 shrink-0">
        {item.cover ? (
          <img src={`${API_BASE}${item.cover}`} alt="" className="w-full h-full object-cover"
            onError={e => { e.target.style.display = 'none' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">🖼️</div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs px-2 py-0.5 rounded-full bg-pink-900/40 text-pink-300 border border-pink-700/50 font-semibold">
            ❤️ {fmtNum(item.likes)}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 border border-indigo-700/50">
            🖼️ {item.slideCount} telas
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-1">@{item.sourceUsername}</p>
        <p className="text-xs text-gray-400 line-clamp-2 flex-1">{item.caption || 'Sem legenda'}</p>
        <div className="flex items-center gap-2 mt-2">
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-gray-600 hover:text-gray-400">Ver original</a>
          <button onClick={() => onClone(item)} disabled={cloning}
            className="ml-auto px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors">
            {cloning ? '…' : '✨ Criar parecido'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Preview do carrossel gerado ────────────────────────────────────────────────
function SlideViewer({ slides }) {
  const [i, setI] = useState(0)
  const total = slides.length
  return (
    <div className="space-y-3">
      <div className="relative bg-black rounded-2xl overflow-hidden">
        <img src={slides[i].dataUrl} alt={`Tela ${i + 1}`} className="w-full" />
        {total > 1 && (
          <>
            {i > 0 && (
              <button onClick={() => setI(i - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center">‹</button>
            )}
            {i < total - 1 && (
              <button onClick={() => setI(i + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center">›</button>
            )}
            <div className="absolute top-2 right-3 text-xs bg-black/60 text-white px-2 py-1 rounded-full">{i + 1}/{total}</div>
          </>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {slides.map((s, idx) => (
          <button key={idx} onClick={() => setI(idx)}
            className={`w-12 h-15 rounded-lg overflow-hidden shrink-0 border-2 transition-colors ${idx === i ? 'border-indigo-500' : 'border-transparent opacity-60'}`}>
            <img src={s.dataUrl} alt="" className="w-12 h-16 object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Componente principal ───────────────────────────────────────────────────────
export default function Carousels() {
  const [themes,    setThemes]    = useState(['curiosidades', 'ciencia'])
  const [topic,     setTopic]     = useState('')
  const [slideCount, setSlideCount] = useState(7)

  const [viral,     setViral]     = useState([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState('')

  const [generating, setGenerating] = useState(false)
  const [genErr,    setGenErr]    = useState('')
  const [result,    setResult]    = useState(null)
  const [cloningUrl, setCloningUrl] = useState(null)
  const [copied,    setCopied]    = useState(false)

  // Boas Notícias
  const [newsHandle,    setNewsHandle]    = useState('')
  const [newsGenerating, setNewsGenerating] = useState(false)
  const [newsErr,       setNewsErr]       = useState('')

  const resultRef = useRef(null)

  function toggleTheme(k) {
    setThemes(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }

  async function handleSearch() {
    setSearching(true); setSearchErr(''); setViral([])
    try {
      const res = await fetch(`${API_BASE}/api/carousels/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themes, minLikes: 20000 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na busca')
      setViral(data.results || [])
      if ((data.results || []).length === 0) setSearchErr('Nenhum carrossel viral encontrado agora. Tente outros temas.')
    } catch (e) { setSearchErr(e.message) }
    finally { setSearching(false) }
  }

  async function generate({ theme, topic: t, reference, fromUrl }) {
    setGenerating(true); setGenErr(''); setResult(null)
    if (fromUrl) setCloningUrl(fromUrl)
    try {
      const res = await fetch(`${API_BASE}/api/carousels/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, topic: t, reference, slideCount }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar')
      setResult(data)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e) { setGenErr(e.message) }
    finally { setGenerating(false); setCloningUrl(null) }
  }

  function handleGenerateFromTheme() {
    const t = topic.trim()
    generate({ theme: themes[0] || 'curiosidades', topic: t || undefined })
  }

  function handleClone(item) {
    generate({ reference: item.caption, fromUrl: item.url })
  }

  async function handleGenerateNews() {
    setNewsGenerating(true); setNewsErr(''); setResult(null)
    try {
      const h = newsHandle.trim() || '@seuperfil'
      const res = await fetch(`${API_BASE}/api/carousels/generate-news`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: h }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar')
      setResult(data)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e) { setNewsErr(e.message) }
    finally { setNewsGenerating(false) }
  }

  function copyCaption() {
    if (!result?.caption) return
    navigator.clipboard.writeText(result.caption).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2500)
    }).catch(() => {})
  }

  async function downloadSlide(slide) {
    await saveToGallery(slide.dataUrl, `carrossel_tela_${String(slide.index).padStart(2, '0')}.png`)
  }

  async function downloadAll() {
    for (const s of result.slides) {
      await saveToGallery(s.dataUrl, `carrossel_tela_${String(s.index).padStart(2, '0')}.png`)
      await new Promise(r => setTimeout(r, 400))
    }
  }

  return (
    <div className="max-w-lg mx-auto w-full space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-bold text-white mb-1">🖼️ Studio de Carrosséis</h1>
        <p className="text-sm text-gray-400">
          Busca carrosséis que viralizaram · cria os seus prontos para postar
        </p>
      </div>

      {/* Boas Notícias do Mundo */}
      <div className="bg-gradient-to-br from-emerald-950/60 to-teal-950/60 border border-emerald-700/50 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🌍</span>
          <div>
            <p className="text-sm font-bold text-white">Boas Notícias do Mundo</p>
            <p className="text-xs text-gray-400 mt-0.5">
              IA busca acontecimentos positivos reais · fotos reais · pronto para viralizar
            </p>
          </div>
        </div>
        <input
          type="text" value={newsHandle} onChange={e => setNewsHandle(e.target.value)}
          placeholder="@seuperfil (para o CTA final)"
          className="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
        />
        <button onClick={handleGenerateNews} disabled={newsGenerating}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
          {newsGenerating ? '🔎 Buscando notícias e gerando slides…' : '🌍 Gerar Carrossel de Boas Notícias'}
        </button>
        {newsErr && <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{newsErr}</p>}
        <p className="text-[11px] text-gray-600">
          💡 Para fotos reais: adicione PEXELS_API_KEY no Vercel (gratuito em pexels.com/api). Sem a chave os slides usam fundo gradiente.
        </p>
      </div>

      <div className="flex items-center gap-3 text-gray-700">
        <div className="flex-1 border-t border-gray-800"/>
        <span className="text-xs">ou crie um carrossel personalizado</span>
        <div className="flex-1 border-t border-gray-800"/>
      </div>

      {/* Temas */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">
          Temas <span className="text-gray-600">({themes.length})</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ key, label }) => (
            <button key={key} onClick={() => toggleTheme(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                ${themes.includes(key)
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Criar do zero */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-white">✨ Criar carrossel novo</p>
        <input
          type="text" value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="Assunto (opcional) — ex: buracos negros, a Muralha da China…"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500">Telas:</label>
          <div className="flex gap-1">
            {[5, 6, 7, 8, 9, 10].map(n => (
              <button key={n} onClick={() => setSlideCount(n)}
                className={`w-8 h-8 rounded-lg text-xs font-semibold border transition-colors
                  ${slideCount === n ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <button onClick={handleGenerateFromTheme} disabled={generating || themes.length === 0}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors">
          {generating && !cloningUrl ? 'Gerando carrossel…' : '✨ Gerar carrossel pronto'}
        </button>
        {genErr && <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{genErr}</p>}
      </div>

      {/* Buscar inspiração viral */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">🔥 Inspiração: carrosséis virais</p>
          <button onClick={handleSearch} disabled={searching || themes.length === 0}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 rounded-lg disabled:opacity-50">
            {searching ? 'Buscando…' : '🔍 Buscar'}
          </button>
        </div>
        {searchErr && <p className="text-xs text-yellow-400/80">{searchErr}</p>}
        {viral.length > 0 && (
          <div className="space-y-2">
            {viral.map((item, i) => (
              <ViralCard key={item.url || i} item={item} onClone={handleClone}
                cloning={cloningUrl === item.url} />
            ))}
          </div>
        )}
        {!searching && viral.length === 0 && !searchErr && (
          <p className="text-xs text-gray-600">Busca carrosséis com muitas curtidas para usar de base.</p>
        )}
      </div>

      {/* Resultado */}
      {result && (
        <div ref={resultRef} className="bg-gray-900 border border-indigo-700/40 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-green-300">✅ Carrossel pronto · {result.slides.length} telas</p>
            <button onClick={() => setResult(null)} className="text-xs text-gray-500 hover:text-gray-300">Fechar</button>
          </div>
          {result.topic && <p className="text-xs text-gray-400">Tema: {result.topic}</p>}

          <SlideViewer slides={result.slides} />

          <button onClick={downloadAll}
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-xl transition-colors">
            ⬇️ Baixar todas as telas (.png)
          </button>

          <div className="grid grid-cols-4 gap-1.5">
            {result.slides.map(s => (
              <button key={s.index} onClick={() => downloadSlide(s)}
                className="text-[11px] py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg">
                Tela {s.index}
              </button>
            ))}
          </div>

          {result.caption && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400">Legenda do post</p>
              <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3 text-xs text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {result.caption}
              </div>
              <button onClick={copyCaption}
                className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-xl transition-colors">
                {copied ? '✅ Legenda copiada!' : '📋 Copiar legenda'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
