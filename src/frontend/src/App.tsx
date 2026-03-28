import './App.css'
import Dashboard from './components/Dashboard'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Project Pulse</h1>
          </div>
          <nav className="flex gap-4 text-sm text-gray-600">
            <a href="/" className="hover:text-blue-600">Dashboard</a>
            <a href="/repos" className="hover:text-blue-600">Repos</a>
            <a href="/search" className="hover:text-blue-600">Brain Search</a>
          </nav>
        </div>
      </header>
      <main>
        <Dashboard />
      </main>
    </div>
  )
}

export default App
