import { useState } from 'react'
import { API_BASE } from '../utils/api'

export default function Step1Download() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [videoData, setVideoData] = useState(null)
  const [error, setError] = useState('')

  // Extract the best video URL from various possible API response shapes
  function extractVideoUrl(data) {
    if (typeof data === 'string' && data.startsWith('http')) return data
    const candidates = [
      data?.video,
      data?.video_url,
      data?.url,
      data?.result,
      data?.download_url,
      data?.media?.[0]?.url,
      data?.data?.video_url,
    ]
    return candidates.find(Boolean) || null
  }

  async function handleFetch() {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setVideoData(null)

    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar vídeo')

      const videoUrl = extractVideoUrl(data)
      if (!videoUrl) throw new Error('Não foi possível encontrar a URL do vídeo na resposta')

      setVideoData({ videoUrl, thumbnail: data.thumbnail || data.thumbnail_url || null })
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
      {/* Step label */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          1
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Baixar vídeo do Instagram</h2>
          <p className="text-xs text-gray-400">Cole a URL de um Reel ou Story</p>
        </div>
      </div>

      {/* Input */}
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

      {/* Error */}
      {error && (
        <p className="mt-3 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Result */}
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
