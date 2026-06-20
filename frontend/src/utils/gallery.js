// Salva na galeria do iOS via Web Share API (nativo) ou download normal em outros dispositivos
export async function saveToGallery(dataUrl, filename, mimeType = 'image/png') {
  try {
    // Converte dataUrl → Blob
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const file = new File([blob], filename, { type: mimeType })

    // Web Share API — abre painel nativo do iOS com "Salvar no Fotos"
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return { success: true, method: 'share' }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { success: true, method: 'share' } // usuário fechou o painel
  }

  // Fallback: download normal (Android Chrome, Desktop)
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  return { success: true, method: 'download' }
}

// Salva um blob de vídeo na galeria
export async function saveVideoToGallery(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type || 'video/mp4' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return { success: true, method: 'share' }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { success: true, method: 'share' }
  }

  // Fallback download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { success: true, method: 'download' }
}
