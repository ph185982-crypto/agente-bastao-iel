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
  const files = items.map(({ dataUrl, filename, mimeType = 'image/png' }) =>
    new File([dataUrlToBlob(dataUrl)], filename, { type: mimeType })
  )

  if (!navigator.share) {
    // Desktop: download via <a>
    for (const { dataUrl, filename } of items) {
      const a = document.createElement('a')
      a.href = dataUrl; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      await new Promise(r => setTimeout(r, 400))
    }
    return { success: true, method: 'download' }
  }

  // Tenta compartilhar todos de uma vez sem verificar canShare primeiro
  // (canShare retorna false no iOS para lotes grandes, mas share funciona)
  try {
    await navigator.share({ files, title: 'Nexos Páginas' })
    return { success: true, method: 'share-all' }
  } catch (e) {
    if (e.name === 'AbortError') return { success: true, method: 'share-all' }
    // Lote muito grande — compartilha um por um
    for (const file of files) {
      try {
        await navigator.share({ files: [file], title: file.name })
      } catch (e2) {
        if (e2.name === 'AbortError') break // usuário cancelou, para o loop
      }
    }
    return { success: true, method: 'share-sequential' }
  }
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
