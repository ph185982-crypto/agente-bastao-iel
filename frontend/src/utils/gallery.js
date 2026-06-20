// Salva na galeria do iOS via Web Share API (nativo) ou download normal em outros dispositivos
export async function saveToGallery(dataUrl, filename, mimeType = 'image/png') {
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const file = new File([blob], filename, { type: mimeType })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return { success: true, method: 'share' }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { success: true, method: 'share' }
  }
  const a = document.createElement('a')
  a.href = dataUrl; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  return { success: true, method: 'download' }
}

// Salva VÁRIOS arquivos de uma só vez — iOS mostra "Salvar X Imagens" no Fotos
export async function saveMultipleToGallery(items) {
  // items: [{ dataUrl, filename, mimeType? }]
  try {
    const files = await Promise.all(
      items.map(async ({ dataUrl, filename, mimeType = 'image/png' }) => {
        const blob = await fetch(dataUrl).then(r => r.blob())
        return new File([blob], filename, { type: mimeType })
      })
    )
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: 'Nexos Páginas' })
      return { success: true, method: 'share' }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { success: true, method: 'share' }
    console.warn('[gallery] share multiple failed, falling back:', e.message)
  }
  // Fallback desktop: download um a um
  for (const { dataUrl, filename } of items) {
    const a = document.createElement('a')
    a.href = dataUrl; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    await new Promise(r => setTimeout(r, 350))
  }
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
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { success: true, method: 'download' }
}
