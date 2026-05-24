import { useState, useRef, useEffect } from 'react'
import { API_BASE } from '../utils/api'

const POLL_INTERVAL = 2500 // ms

export default function Step4EditReel({ videoUrl: propVideoUrl, headline: propHeadline }) {
  const [template, setTemplate] = useState(null)         // File object
  const [templatePreview, setTemplatePreview] = useState(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [headline, setHeadline] = useState('')
  const [status, setStatus] = useState('idle')           // idle | processing | done | error
  const [progress, setProgress] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState(null)
  const [error, setError] = useState('')
  const pollRef = useRef(null)
  const templateInputRef = useRef(null)

  // Auto-fill from parent state whenever they change
  useEffect(() => { if (propVideoUrl) setVideoUrl(propVideoUrl) }, [propVideoUrl])
  useEffect(() => { if (propHeadline) setHeadline(propHeadline) }, [propHeadline])

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function handleTemplate(file) {
    if (!file) return
    setTemplate(file)
    setTemplatePreview(URL.createObjectURL(file))
  }

  async function handleStart() {
    if (!template) return setError('Selecione o template de fundo.')
    if (!videoUrl.trim()) return setError('Informe a URL do vídeo.')
    if (!headline.trim()) return setError('Informe a headline.')

    setStatus('processing')
    setProgress(0)
    setError('')
    setDownloadUrl(null)

    const form = new FormData()
    form.append('template', template)
    form.append('videoUrl', videoUrl.trim())
    form.append('headline', headline.trim())

    try {
      const res = await fetch(`${API_BASE}/api/edit-reel`, { method: 'POST', body: form })
      const { jobId, error: err } = await res.json()
      if (!res.ok || !jobId) throw new Error(err || 'Erro ao iniciar processamento')

      // Poll for status
      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`${API_BASE}/api/edit-reel/${jobId}`)
          const data = await pr.json()
          setProgress(data.progress || 0)

          if (data.status === 'done') {
            stopPolling()
            setStatus('done')
            setProgress(100)
            setDownloadUrl(`${API_BASE}/api/edit-reel/${jobId}/download`)
          } else if (data.status === 'error') {
            stopPolling()
            setStatus('error')
            setError(data.error || 'Erro ao processar vídeo')
          }
        } catch (e) {
          console.error('Poll error:', e)
        }
      }, POLL_INTERVAL)
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [])

  const isProcessing = status === 'processing'

  return (
    <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      {/* Step label */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          4
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Montar Reel editado</h2>
          <p className="text-xs text-gray-400">
            Template + vídeo recortado + headline → MP4 pronto para postar
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Template upload */}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">
            Template de fundo <span className="text-gray-500">(fundo branco + sua marca)</span>
          </label>
          <div
            onClick={() => templateInputRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-600 bg-gray-800/50 transition-colors flex items-center gap-4 p-4"
          >
            {templatePreview ? (
              <img src={templatePreview} alt="Template" className="h-16 w-10 object-cover rounded-lg shrink-0" />
            ) : (
              <div className="w-10 h-16 rounded-lg bg-gray-700 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-300">{template ? template.name : 'Clique para selecionar o template'}</p>
              <p className="text-xs text-gray-500 mt-0.5">PNG ou JPG</p>
            </div>
          </div>
          <input
            ref={templateInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => handleTemplate(e.target.files[0])}
          />
        </div>

        {/* Video URL */}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">
            URL do vídeo <span className="text-gray-500">(preenchida automaticamente do passo 1)</span>
          </label>
          <input
            type="text"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://scontent-...instagram.com/..."
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Headline */}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">
            Headline <span className="text-gray-500">(preenchida automaticamente dos passos 2/3)</span>
          </label>
          <textarea
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Pouca gente entende por que Nikola Tesla foi silenciado..."
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Processing state */}
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Processando vídeo… pode levar 30–60 segundos</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {progress < 20 && 'Baixando o vídeo…'}
              {progress >= 20 && progress < 40 && 'Montando o fundo…'}
              {progress >= 40 && progress < 70 && 'Recortando e ajustando o vídeo…'}
              {progress >= 70 && progress < 100 && 'Finalizando a composição…'}
              {progress === 100 && 'Concluído!'}
            </p>
          </div>
        )}

        {/* Start button */}
        {!isProcessing && status !== 'done' && (
          <button
            onClick={handleStart}
            disabled={!template || !videoUrl.trim() || !headline.trim()}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Montar Reel
          </button>
        )}

        {/* Download */}
        {status === 'done' && downloadUrl && (
          <div className="flex flex-col items-center gap-3 py-4 bg-green-900/20 border border-green-700/40 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-green-600/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-green-300 font-medium">Reel pronto!</p>
            <a
              href={downloadUrl}
              download="reel_editado.mp4"
              className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Baixar MP4
            </a>
            <button
              onClick={() => { setStatus('idle'); setProgress(0); setDownloadUrl(null) }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Montar outro
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
