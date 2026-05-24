import { useState } from 'react'
import Header from './components/Header'
import Step1Download from './components/Step1Download'
import Step2OCR from './components/Step2OCR'
import Step3Generate from './components/Step3Generate'
import Step4EditReel from './components/Step4EditReel'
import AgentChat from './components/AgentChat'

const TABS = [
  { id: 'tool', label: 'Ferramenta' },
  { id: 'agent', label: 'Agente IA' },
]

export default function App() {
  const [tab, setTab] = useState('tool')
  const [extractedText, setExtractedText] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [headline, setHeadline] = useState('')

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

      {/* Tab content */}
      {tab === 'tool' && (
        <main className="max-w-2xl mx-auto w-full px-4 py-10 space-y-6">
          <Step1Download onVideoFound={setVideoUrl} />
          <Step2OCR onTextExtracted={setExtractedText} onHeadlineGenerated={setHeadline} />
          <Step3Generate initialText={extractedText} onHeadlineGenerated={setHeadline} />
          <Step4EditReel videoUrl={videoUrl} headline={headline} />
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
