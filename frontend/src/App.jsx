import { useState } from 'react'
import Header from './components/Header'
import Step1Download from './components/Step1Download'
import Step2OCR from './components/Step2OCR'
import Step3Generate from './components/Step3Generate'

export default function App() {
  const [extractedText, setExtractedText] = useState('')

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <Step1Download />
        <Step2OCR onTextExtracted={setExtractedText} />
        <Step3Generate initialText={extractedText} />
      </main>
    </div>
  )
}
