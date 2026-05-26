import { useState, useRef, useEffect } from 'react'
import { API_BASE } from '../utils/api'

const POLL_INTERVAL = 2500

export default function AutoReel() {
  const [instagramUrl, setInstagramUrl] = useState('')
  const [print, setPrint] = useState(null)
  const [printPreview, setPrintPreview] = useState(null)
  const [template, setTemplate] = useState(null)
  const [templatePreview, setTemplatePreview] = useState(null)
  const [status, setStatus] = useState('idle')   // idle | processing | done | error
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [headline, setHeadline] = useState('')
  const [downloadUrl, setDownloadUrl] = useState(null)
  const [error, setError] = useState('')
  const [printDragging, setPrintDragging] = useState(false)
  const [preHeadline, setPreHeadline] = useState(null)    // pre-extracted before submit
  const [extracting, setExtracting] = useState(false)     // GPT running in background

  const printInputRef = useRef(null)
  const templateInputRef = useRef(null)
  const pollRef = useRef(null)
  const extractAbortRef = useRef(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }
  useEffect(() => () => stopPolling(), [])

  async function handlePrint(file) {
    if (!file) return
    setPrint(file)
    setPrintPreview(URL.createObjectURL(file))
    setError('')
    setPreHeadline(null)

    // Cancel any in-flight extraction
    if (extractAbortRef.current) extractAbortRef.current.abort()
    const controller = new AbortController()
    extractAbortRef.current = controller

    setExtracting(true)
    try {
      const form = new FormData()
      form.append('print', file)
      const res = await fetch(`${API_BASE}/api/auto-reel/extract-headline`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      if (res.ok) {
        const { headline: h } = await res.json()
        if (h) setPreHeadline(h)
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Pre-extract failed:', e.message)
    } finally {
      setExtracting(false)
    }
  }

  function handleTemplate(file) {
    if (!file) return
    setTemplate(file)
    setTemplatePreview(URL.createObjectURL(file))
  }

  function handleDrop(e) {
    e.preventDefault()
    setPrintDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) handlePrint(file)
  }

  async function handleCreate() {
    if (!instagramUrl.trim()) return setError('Cole o link do vídeo do Instagram.')
    if (!print) return setError('Selecione o print ou screenshot.')

    setStatus('processing')
    setProgress(0)
    setMessage('Iniciando…')
    setError('')
    setDownloadUrl(null)
    setHeadline('')

    const form = new FormData()
    form.append('instagramUrl', instagramUrl.trim())
    form.append('print', print)
    if (template) form.append('template', template)
    if (preHeadline) form.append('headline', preHeadline)

    try {
      const res = await fetch(`${API_BASE}/api/auto-reel`, { method: 'POST', body: form })
      const { jobId, error: err } = await res.json()
      if (!res.ok || !jobId) throw new Error(err || 'Erro ao iniciar processamento')

      let consecutiveErrors = 0
      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`${API_BASE}/api/auto-reel/${jobId}`)

          if (!pr.ok) {
            // HTTP error (404 = job expired, 5xx = server error)
            consecutiveErrors++
            if (consecutiveErrors >= 3 || pr.status === 404) {
              stopPolling()
              setStatus('error')
              setError(pr.status === 404 ? 'Job expirado. Tente novamente.' : 'Erro de servidor. Tente novamente.')
            }
            return
          }

          const data = await pr.json()
          consecutiveErrors = 0
          if (data.progress !== undefined) setProgress(data.progress)
          if (data.message) setMessage(data.message)

          if (data.status === 'done') {
            stopPolling()
            setStatus('done')
            setProgress(100)
            setHeadline(data.headline || preHeadline || '')
            setDownloadUrl(`${API_BASE}/api/auto-reel/${jobId}/download`)
          } else if (data.status === 'error') {
            stopPolling()
            setStatus('error')
            setError(data.error || 'Erro ao processar')
          } else if (!data.status) {
            stopPolling()
            setStatus('error')
            setError(data.error || 'Resposta inesperada do servidor.')
          }
        } catch (e) {
          consecutiveErrors++
          console.error('Poll error:', e)
          if (consecutiveErrors >= 3) {
            stopPolling()
            setStatus('error')
            setError('Erro de conexão com o servidor. Verifique sua internet e tente novamente.')
          }
        }
      }, POLL_INTERVAL)
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }

  function reset() {
    stopPolling()
    setStatus('idle')
    setProgress(0)
    setMessage('')
    setError('')
    setDownloadUrl(null)
    setHeadline('')
    setPreHeadline(null)
    setExtracting(false)
  }

  const [copied, setCopied] = useState(false)

  function copyCaption(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const isProcessing = status === 'processing'
  const isDone = status === 'done'

  return (
    <div className="max-w-lg mx-auto w-full space-y-4">

      {/* Instagram URL */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          Link do vídeo (Instagram)
        </label>
        <input
          type="text"
          value={instagramUrl}
          onChange={(e) => setInstagramUrl(e.target.value)}
          placeholder="https://www.instagram.com/reel/..."
          disabled={isProcessing || isDone}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
        />
      </div>

      {/* Print upload */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-2">
          Print / Screenshot
          {extracting && (
            <span className="text-indigo-400 animate-pulse text-xs font-normal">analisando…</span>
          )}
          {preHeadline && !extracting && (
            <span className="text-green-400 text-xs font-normal">headline pronta</span>
          )}
        </label>
        <div
          onClick={() => !isProcessing && !isDone && printInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setPrintDragging(true) }}
          onDragLeave={() => setPrintDragging(false)}
          onDrop={handleDrop}
          className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors flex items-center gap-4 p-4
            ${printDragging ? 'border-indigo-500 bg-indigo-500/10' : print ? 'border-gray-600 bg-gray-800/50' : 'border-gray-700 hover:border-gray-600 bg-gray-800/30'}
            ${(isProcessing || isDone) ? 'pointer-events-none opacity-60' : ''}`}
        >
          {printPreview ? (
            <img src={printPreview} alt="Print" className="h-20 w-14 object-cover rounded-lg shrink-0" />
          ) : (
            <div className="w-14 h-20 rounded-lg bg-gray-700 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          <div>
            <p className="text-sm text-gray-300 font-medium">
              {print ? print.name : 'Clique ou arraste o print aqui'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">JPEG, PNG ou WebP</p>
          </div>
        </div>
        <input
          ref={printInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handlePrint(e.target.files[0])}
        />
      </div>

      {/* Template (optional) */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          Template de fundo <span className="text-gray-600">(opcional — fundo branco se não enviar)</span>
        </label>
        <div
          onClick={() => !isProcessing && !isDone && templateInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border border-gray-700 hover:border-gray-600 bg-gray-800/30 transition-colors flex items-center gap-3 p-3
            ${(isProcessing || isDone) ? 'pointer-events-none opacity-60' : ''}`}
        >
          {templatePreview ? (
            <img src={templatePreview} alt="Template" className="h-12 w-8 object-cover rounded shrink-0" />
          ) : (
            <div className="w-8 h-12 rounded bg-gray-700 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
          )}
          <p className="text-xs text-gray-400">
            {template ? template.name : 'Adicionar template de marca (PNG ou JPG)'}
          </p>
        </div>
        <input
          ref={templateInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => handleTemplate(e.target.files[0])}
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Progress */}
      {isProcessing && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{message || 'Processando…'}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2.5">
            <div
              className="bg-indigo-500 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Create button */}
      {!isProcessing && !isDone && (
        <button
          onClick={handleCreate}
          disabled={!instagramUrl.trim() || !print}
          className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
        >
          Criar Reel
        </button>
      )}

      {/* Done */}
      {isDone && downloadUrl && (
        <div className="flex flex-col items-center gap-4 py-6 bg-green-900/20 border border-green-700/40 rounded-xl">
          <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <p className="text-sm font-semibold text-green-300">Reel pronto!</p>

          {/* Legenda para o Instagram */}
          {headline && (
            <div className="w-full px-4 space-y-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                Legenda do post
              </p>
              <div className="bg-gray-800 border border-gray-600 rounded-xl p-4 text-base text-white leading-relaxed font-medium">
                {headline}
              </div>
              <button
                onClick={() => copyCaption(headline)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {copied ? 'Copiado!' : 'Copiar legenda'}
              </button>
            </div>
          )}

          <a
            href={downloadUrl}
            download="reel_pronto.mp4"
            className="w-full mx-4 text-center py-3.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Baixar MP4
          </a>
          <button
            onClick={reset}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Criar outro
          </button>
        </div>
      )}
    </div>
  )
}
