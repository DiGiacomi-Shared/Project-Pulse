import './App.css'
import Dashboard from './components/Dashboard'

function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-white/[0.06]">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white tracking-tight">Project Pulse</h1>
              <p className="text-[10px] text-gray-500 -mt-0.5">workspace intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
            <span className="text-xs text-gray-500">online</span>
          </div>
        </div>
      </header>
      <main>
        <Dashboard />
      </main>
    </div>
  )
}

export default App