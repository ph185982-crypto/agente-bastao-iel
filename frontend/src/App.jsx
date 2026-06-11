import { useState } from 'react'
import Header from './components/Header'
import AutoReel from './components/AutoReel'
import AgentChat from './components/AgentChat'
import ContentFinder from './components/ContentFinder'

const TABS = [
  { id: 'reel',    label: 'Criar Reel' },
  { id: 'recycle', label: '♻️ Reciclagem' },
  { id: 'agent',   label: 'Agente IA' },
]

export default function App() {
  const [tab, setTab] = useState('reel')

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Header />

      {/* Tab bar */}
      <div className="border-b border-gray-800 bg-gray-950 sticky top-[57px] z-40">
        <div className="max-w-2xl mx-auto px-4 flex gap-1 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2
                ${tab === t.id
                  ? 'border-indigo-500 text-white bg-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'reel' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10">
          <div className="mb-8 text-center">
            <h1 className="text-xl font-bold text-white mb-1">Criar Reel editado</h1>
            <p className="text-sm text-gray-400">
              Cole o link + envie o print → receba o MP4 pronto para postar
            </p>
          </div>
          <AutoReel />
        </main>
      )}

      {tab === 'recycle' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10">
          <ContentFinder />
        </main>
      )}

      {tab === 'agent' && (
        <div className="max-w-2xl mx-auto w-full px-4 flex-1 flex flex-col">
          <AgentChat />
        </div>
      )}
    </div>
  )
}
