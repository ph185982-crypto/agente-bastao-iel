import { useState } from 'react'
import { API_BASE } from '../utils/api'

// Deep-search a plain object for any string value that looks like a video URL
function findVideoUrl(obj, depth = 0) {
  if (depth > 5 || !obj) return null
  if (typeof obj === 'string') {
    if (/^https?:\/\/.+\.(mp4|mov|webm|m4v)/i.test(obj)) return obj
    if (/^https?:\/\/.+video.+/i.test(obj)) return obj
    return null
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findVideoUrl(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof obj === 'object') {
    // Prioritised keys
    const priority = ['video_no_watermark', 'video', 'video_url', 'url', 'result', 'download_url', 'link', 'src']
    for (const key of priority) {
      if (obj[key]) {
        const found = findVideoUrl(obj[key], depth + 1)
        if (found) return found
      }
    }
    // Fallback: all other keys
    for (const key of Object.keys(obj)) {
      if (!priority.includes(key)) {
        const found = findVideoUrl(obj[key], depth + 1)
        if (found) return found
      }
    }
  }
  return null
}

function findThumbnail(data) {
  const candidates = [
    data?.thumbnail, data?.thumbnail_url, data?.cover,
    data?.image, data?.poster, data?.data?.thumbnail,
  ]
  return candidates.find((v) => typeof v === 'string' && v.startsWith('http')) || null
}

export default function Step1Download() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [videoData, setVideoData] = useState(null)
  const [error, setError] = useState('')
  const [rawResponse, setRawResponse] = useState(null)

  async function handleFetch() {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setVideoData(null)
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
      const videoUrl = findVideoUrl(data)
      if (!videoUrl) {
        throw new Error(
          'Vídeo não encontrado na resposta da API. Verifique se a RAPIDAPI_KEY está configurada no Render.',
        )
      }

      setVideoData({ videoUrl, thumbnail: findThumbnail(data) })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    const proxyUrl = `${API_BASE}/api/download/proxy?videoUrl=${encodeURIComponent(videoData.videoUrl)}`
    const a = document.createElement('a')
    a.href = proxyUrl
    a.download = 'video_instagram.mp4'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          1
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Baixar vídeo do Instagram</h2>
          <p className="text-xs text-gray-400">Cole a URL de um Reel ou Story</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
          placeholder="https://www.instagram.com/reel/..."
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

      {videoData && (
        <div className="mt-4 p-4 bg-gray-800 rounded-xl border border-gray-700 flex items-center gap-4">
          {videoData.thumbnail && (
            <img
              src={videoData.thumbnail}
              alt="Thumbnail"
              className="w-16 h-16 rounded-lg object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 mb-1">Vídeo encontrado</p>
            <p className="text-xs text-gray-300 truncate">{videoData.videoUrl}</p>
          </div>
          <button
            onClick={handleDownload}
            className="shrink-0 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Baixar
          </button>
        </div>
      )}
    </section>
  )
}
