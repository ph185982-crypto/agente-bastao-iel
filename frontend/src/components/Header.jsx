export default function Header() {
  return (
    <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-base leading-none">N</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-white leading-tight">Nexos Páginas</h1>
          <p className="text-xs text-gray-400">Studio de Reels para Instagram</p>
        </div>
      </div>
    </header>
  )
}
