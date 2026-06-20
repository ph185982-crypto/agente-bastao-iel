import { useState, useEffect } from 'react'

export default function Header() {
  const [notifState, setNotifState] = useState('idle') // idle | asking | granted | denied | unsupported

  useEffect(() => {
    if (!('Notification' in window)) { setNotifState('unsupported'); return }
    if (Notification.permission === 'granted') setNotifState('granted')
    else if (Notification.permission === 'denied') setNotifState('denied')
  }, [])

  async function askNotifications() {
    if (!('Notification' in window)) return
    setNotifState('asking')
    const perm = await Notification.requestPermission()
    setNotifState(perm === 'granted' ? 'granted' : 'denied')
    // Inicia OneSignal se disponível
    if (perm === 'granted' && window.OneSignal) {
      window.OneSignal.User.PushSubscription.optIn().catch(() => {})
    }
  }

  const bellBtn = notifState === 'granted' ? null : notifState === 'denied' ? null : (
    <button onClick={askNotifications} disabled={notifState === 'asking'}
      title="Ativar notificações"
      className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-indigo-700 transition-colors text-base">
      🔔
    </button>
  )

  return (
    <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-900/40">
          <span className="text-white font-bold text-base leading-none">N</span>
        </div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-white leading-tight">Nexos Páginas</h1>
          <p className="text-xs text-gray-400">Mineradora de conteúdo viral</p>
        </div>
        {bellBtn}
        <div className="flex items-center gap-1.5 text-xs text-green-400/90">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="hidden sm:inline">agentes ativos</span>
        </div>
      </div>
    </header>
  )
}
