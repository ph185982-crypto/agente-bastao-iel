// Converte data URL para Blob sem usar fetch() — compatível com todos os Safari/iOS
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mime = (header.match(/:(.*?);/) || [])[1] || 'image/png'
  const binary = atob(base64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

// Salva na galeria do iOS via Web Share API (nativo) ou download normal em outros dispositivos
export async function saveToGallery(dataUrl, filename, mimeType = 'image/png') {
  if (navigator.share) {
    try {
      const blob = dataUrl.startsWith('data:') ? dataUrlToBlob(dataUrl) : await fetch(dataUrl).then(r => r.blob())
      const file = new File([blob], filename, { type: mimeType })
      await navigator.share({ files: [file], title: filename })
      return { success: true, method: 'share' }
    } catch (e) {
      if (e.name === 'AbortError') return { success: true, method: 'share' }
    }
  }
  const a = document.createElement('a')
  a.href = dataUrl; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  return { success: true, method: 'download' }
}

// Salva vários arquivos. onProgress(current, total) chamado antes de cada compartilhamento.
export async function saveMultipleToGallery(items, onProgress) {
  if (!navigator.share) {
    // Desktop: download via <a> tags
    for (let i = 0; i < items.length; i++) {
      const { dataUrl, filename } = items[i]
      onProgress?.(i + 1, items.length)
      const a = document.createElement('a')
      a.href = dataUrl; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      await new Promise(r => setTimeout(r, 400))
    }
    return { success: true, method: 'download' }
  }

  // iOS: o share em lote (todos de uma vez) só salva a primeira imagem — bug do iOS.
  // A solução confiável é compartilhar uma imagem por vez.
  if (isIOS()) {
    for (let i = 0; i < items.length; i++) {
      const { dataUrl, filename, mimeType = 'image/png' } = items[i]
      onProgress?.(i + 1, items.length)
      const file = new File([dataUrlToBlob(dataUrl)], filename, { type: mimeType })
      try {
        await navigator.share({ files: [file], title: filename })
      } catch (e) {
        if (e.name === 'AbortError') break // usuário cancelou
      }
    }
    return { success: true, method: 'share-sequential' }
  }

  // Outros dispositivos com share API: tenta batch primeiro
  const files = items.map(({ dataUrl, filename, mimeType = 'image/png' }) =>
    new File([dataUrlToBlob(dataUrl)], filename, { type: mimeType })
  )
  try {
    await navigator.share({ files, title: 'Nexos Páginas' })
    return { success: true, method: 'share-all' }
  } catch (e) {
    if (e.name === 'AbortError') return { success: true, method: 'share-all' }
    // Batch falhou — tenta um por um
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i + 1, files.length)
      try {
        await navigator.share({ files: [files[i]], title: files[i].name })
      } catch (e2) {
        if (e2.name === 'AbortError') break
      }
    }
    return { success: true, method: 'share-sequential' }
  }
}

// Salva um blob de vídeo na galeria
export async function saveVideoToGallery(blob, filename) {
  if (navigator.share) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' })
      await navigator.share({ files: [file], title: filename })
      return { success: true, method: 'share' }
    } catch (e) {
      if (e.name === 'AbortError') return { success: true, method: 'share' }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { success: true, method: 'download' }
}
