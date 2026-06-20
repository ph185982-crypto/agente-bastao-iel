import { useState } from 'react'
import Header from './components/Header'
import ContentFinder from './components/ContentFinder'
import Carousels from './components/Carousels'
import HeadlineJury from './components/HeadlineJury'
import Brain from './components/Brain'

const TABS = [
  { id: 'brain',     label: '🧠 Cérebro' },
  { id: 'studio',    label: '♻️ Studio' },
  { id: 'carousels', label: '🖼️ Carrosséis' },
  { id: 'jury',      label: '⚖️ Júri' },
]

export default function App() {
  const [tab, setTab] = useState('brain')

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

      {tab === 'brain' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10">
          <Brain />
        </main>
      )}

      {tab === 'studio' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10">
          <ContentFinder />
        </main>
      )}

      {tab === 'carousels' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10">
          <Carousels />
        </main>
      )}

      {tab === 'jury' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10">
          <HeadlineJury />
        </main>
      )}

    </div>
  )
}
