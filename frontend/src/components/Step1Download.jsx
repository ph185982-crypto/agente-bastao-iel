import { useState } from 'react'
import { API_BASE } from '../utils/api'

/**
 * Parse the RapidAPI response into a normalised list of media items.
 * Response shape: { media: [{ type, quality, url, thumbnail }] }
 */
function parseMediaItems(data) {
  // Primary format: { media: [...] }
  if (Array.isArray(data?.media) && data.media.length > 0) {
    return data.media.map((item) => ({
      type: item.type || 'unknown',      // "video" | "image"
      quality: item.quality || '',
      url: item.url,
      thumbnail: item.thumbnail || null,
    })).filter((item) => item.url)
  }

  // Fallback: try to find a direct URL anywhere in the response
  const directUrl = findAnyUrl(data)
  if (directUrl) {
    return [{ type: 'video', quality: '', url: directUrl, thumbnail: data?.thumbnail || null }]
  }

  return []
}

function findAnyUrl(obj, depth = 0) {
  if (depth > 5 || !obj) return null
  if (typeof obj === 'string' && obj.startsWith('http')) return obj
  if (Array.isArray(obj)) {
    for (const item of obj) { const f = findAnyUrl(item, depth + 1); if (f) return f }
    return null
  }
  if (typeof obj === 'object') {
    for (const key of ['video', 'video_url', 'url', 'result', 'download_url', 'link']) {
      if (obj[key]) { const f = findAnyUrl(obj[key], depth + 1); if (f) return f }
    }
  }
  return null
}

function MediaCard({ item, index }) {
  const isVideo = item.type === 'video'
  const ext = isVideo ? 'mp4' : 'jpg'
  const filename = `instagram_${item.type}_${index + 1}.${ext}`

  function handleDownload() {
    const proxyUrl = `${API_BASE}/api/download/proxy?videoUrl=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(filename)}`
    const a = document.createElement('a')
    a.href = proxyUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-lg bg-gray-700 overflow-hidden shrink-0 flex items-center justify-center">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-gray-500 text-xs">{isVideo ? '▶' : '🖼'}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isVideo ? 'bg-indigo-500/20 text-indigo-300' : 'bg-gray-600 text-gray-300'}`}>
            {isVideo ? 'Vídeo' : 'Imagem'}
          </span>
          {item.quality && (
            <span className="text-xs text-gray-500">{item.quality}</span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate">{item.url}</p>
      </div>

      {/* Download */}
      <button
        onClick={handleDownload}
        className="shrink-0 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors"
      >
        Baixar
      </button>
    </div>
  )
}

export default function Step1Download({ onVideoFound }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [mediaItems, setMediaItems] = useState([])
  const [error, setError] = useState('')
  const [rawResponse, setRawResponse] = useState(null)

  async function handleFetch() {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setMediaItems([])
    setRawResponse(null)

    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `Erro ${res.status}`)
      }

      setRawResponse(data)
      const items = parseMediaItems(data)

      if (items.length === 0) {
        throw new Error('Nenhuma mídia encontrada na resposta. Verifique se a URL é pública.')
      }

      setMediaItems(items)

      // Pass first video URL to parent for Step 4
      const firstVideo = items.find((item) => item.type === 'video')
      if (firstVideo && onVideoFound) onVideoFound(firstVideo.url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          1
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Baixar mídia do Instagram</h2>
          <p className="text-xs text-gray-400">Suporta Reels, Posts e carrosséis</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
          placeholder="https://www.instagram.com/reel/... ou /p/..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        <button
          onClick={handleFetch}
          disabled={loading || !url.trim()}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
        >
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          {rawResponse && (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                Ver resposta da API (debug)
              </summary>
              <pre className="mt-1 text-xs text-gray-400 bg-gray-800 rounded-lg p-3 overflow-auto max-h-40 scrollbar-thin">
                {JSON.stringify(rawResponse, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {mediaItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-gray-400">
            {mediaItems.length} {mediaItems.length === 1 ? 'item encontrado' : 'itens encontrados'}
          </p>
          {mediaItems.map((item, i) => (
            <MediaCard key={i} item={item} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}
