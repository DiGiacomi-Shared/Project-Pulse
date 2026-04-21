import { useState } from 'react'

interface SearchResult {
  file: string
  relevance: number
  project: string
}

interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

const QUICK_SEARCHES = [
  { query: 'authentication JWT', label: 'Auth Patterns', icon: '🔐' },
  { query: 'impossible travel detection', label: 'Security', icon: '🛡️' },
  { query: 'Kubernetes deployment', label: 'Infrastructure', icon: '⚙️' },
]

function BrainSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/brain/search?q=${encodeURIComponent(query)}&top_k=10`)
      if (!response.ok) throw new Error('Search failed')
      const data = await response.json()
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const getRelevanceStyle = (score: number) => {
    if (score > 0.5) return 'text-emerald-400'
    if (score > 0.3) return 'text-amber-400'
    return 'text-gray-400'
  }

  const getRelevanceBg = (score: number) => {
    if (score > 0.5) return 'bg-emerald-500/10'
    if (score > 0.3) return 'bg-amber-500/10'
    return 'bg-white/[0.04]'
  }

  return (
    <div className="space-y-6">
      {/* Search Card */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-6 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 text-lg">⬡</div>
          <div>
            <h2 className="text-lg font-semibold text-white">Brain Search</h2>
            <p className="text-sm text-gray-500">Semantic search across all your projects</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for patterns, code, architecture..."
            className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-cyan-500 text-black font-medium rounded-lg text-sm hover:bg-cyan-400 disabled:opacity-50 disabled:hover:bg-cyan-500 transition-all"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Searching
              </span>
            ) : 'Search'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-white">Results</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {results.total}
              </span>
            </div>
            <button
              onClick={() => { setResults(null); setQuery('') }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="divide-y divide-white/[0.04]">
            {results.results.length === 0 ? (
              <div className="p-12 text-center">
                <div className="text-3xl mb-3">🔍</div>
                <div className="text-gray-400">No results found</div>
                <div className="text-sm text-gray-600 mt-1">Try a different query</div>
              </div>
            ) : (
              results.results.map((result, index) => (
                <div key={index} className="px-6 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      {result.project}
                    </span>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-md ${getRelevanceBg(result.relevance)} ${getRelevanceStyle(result.relevance)}`}>
                      {(result.relevance * 100).toFixed(1)}%
                    </span>
                  </div>
                  <code className="block text-sm text-gray-300 font-mono truncate">
                    {result.file.split('/').slice(-3).join('/')}
                  </code>
                  <div className="text-xs text-gray-600 mt-1 truncate">
                    {result.file}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Quick searches */}
      {!results && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {QUICK_SEARCHES.map((suggestion) => (
            <button
              key={suggestion.query}
              onClick={() => {
                setQuery(suggestion.query)
                handleSearch({ preventDefault: () => {} } as React.FormEvent)
              }}
              className="group text-left p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-cyan-500/20 hover:bg-white/[0.05] transition-all duration-300"
            >
              <div className="text-2xl mb-3">{suggestion.icon}</div>
              <div className="font-medium text-white group-hover:text-cyan-400 transition-colors">{suggestion.label}</div>
              <div className="text-sm text-gray-500 mt-1">{suggestion.query}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default BrainSearch