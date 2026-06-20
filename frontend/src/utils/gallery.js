// Converte data URL para Blob sem usar fetch() — compatível com todos os Safari/iOS
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mime = (header.match(/:(.*?);/) || [])[1] || 'image/png'
  const binary = atob(base64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

// Salva na galeria do iOS via Web Share API (nativo) ou download normal em outros dispositivos
export async function saveToGallery(dataUrl, filename, mimeType = 'image/png') {
  try {
    const blob = dataUrl.startsWith('data:') ? dataUrlToBlob(dataUrl) : await fetch(dataUrl).then(r => r.blob())
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

  // Converte todos para File de forma síncrona (sem fetch) — evita falha silenciosa no Safari
  const files = items.map(({ dataUrl, filename, mimeType = 'image/png' }) => {
    const blob = dataUrl.startsWith('data:') ? dataUrlToBlob(dataUrl) : null
    if (!blob) return null
    return new File([blob], filename, { type: mimeType })
  }).filter(Boolean)

  if (files.length === 0) return { success: false, method: 'none' }

  // Tenta compartilhar todos de uma vez (iOS abre "Salvar X Imagens")
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: 'Nexos Páginas' })
      return { success: true, method: 'share-all' }
    } catch (e) {
      if (e.name === 'AbortError') return { success: true, method: 'share-all' }
      console.warn('[gallery] share all failed, trying one-by-one:', e.message)
    }
  }

  // Fallback: compartilhar um por um (iOS ainda salva no Fotos a cada vez)
  if (navigator.canShare) {
    for (const file of files) {
      if (!navigator.canShare({ files: [file] })) continue
      try {
        await navigator.share({ files: [file], title: file.name })
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('[gallery] share one failed:', e.message)
      }
      await new Promise(r => setTimeout(r, 600))
    }
    return { success: true, method: 'share-one-by-one' }
  }

  // Fallback desktop: download via <a>
  for (const item of items) {
    const a = document.createElement('a')
    a.href = item.dataUrl; a.download = item.filename
    document.body.appendChild(a); a.click(); a.remove()
    await new Promise(r => setTimeout(r, 400))
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
