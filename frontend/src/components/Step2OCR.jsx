import { useState, useRef } from 'react'
import { API_BASE } from '../utils/api'

export default function Step2OCR({ onTextExtracted }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  function handleFile(selected) {
    if (!selected) return
    const allowed = ['image/jpeg', 'image/jpg', 'image/png']
    if (!allowed.includes(selected.type)) {
      setError('Apenas arquivos JPEG e PNG são permitidos')
      return
    }
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setError('')
    setText('')
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  async function handleExtract() {
    if (!file) return
    setLoading(true)
    setError('')

    const formData = new FormData()
    formData.append('image', file)

    try {
      const res = await fetch(`${API_BASE}/api/ocr`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao extrair texto')

      setText(data.text)
      onTextExtracted(data.text)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleTextChange(e) {
    setText(e.target.value)
    onTextExtracted(e.target.value)
  }

  return (
    <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      {/* Step label */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          2
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Leitura do print da legenda</h2>
          <p className="text-xs text-gray-400">Faça upload do print e extraia o texto</p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2 p-6 text-center
          ${dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'}`}
      >
        {preview ? (
          <img src={preview} alt="Preview" className="max-h-40 rounded-lg object-contain" />
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">Clique ou arraste uma imagem aqui</p>
            <p className="text-xs text-gray-500">JPEG ou PNG · máx. 10 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>

      {/* Extract button */}
      {file && (
        <button
          onClick={handleExtract}
          disabled={loading}
          className="mt-3 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
        >
          {loading ? 'Extraindo texto...' : 'Extrair Texto da Legenda'}
        </button>
      )}

      {/* Error */}
      {error && (
        <p className="mt-3 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Extracted text */}
      {text && (
        <div className="mt-4">
          <label className="text-xs text-gray-400 block mb-1.5">
            Texto extraído <span className="text-gray-500">(editável)</span>
          </label>
          <textarea
            value={text}
            onChange={handleTextChange}
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors resize-y scrollbar-thin"
          />
        </div>
      )}
    </section>
  )
}
