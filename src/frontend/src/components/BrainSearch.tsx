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

  const getRelevanceColor = (score: number) => {
    if (score > 0.5) return 'text-green-600'
    if (score > 0.3) return 'text-yellow-600'
    return 'text-gray-600'
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-lg font-semibold mb-4">Brain Search</h2>
        <p className="text-gray-600 mb-4">
          Search across all your projects with semantic understanding. Find code, docs, and patterns.
        </p>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g., auth patterns, impossible travel, K8s deployment..."
            className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg">
            {error}
          </div>
        )}
      </div>

      {results && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 border-b bg-gray-50">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                Results for "{results.query}"
              </h3>
              <span className="text-sm text-gray-500">
                {results.total} documents found
              </span>
            </div>
          </div>

          <div className="divide-y">
            {results.results.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No results found. Try a different query.
              </div>
            ) : (
              results.results.map((result, index) => (
                <div key={index} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded">
                          {result.project}
                        </span>
                        <span className={`text-xs font-mono ${getRelevanceColor(result.relevance)}`}>
                          {(result.relevance * 100).toFixed(1)}% match
                        </span>
                      </div>
                      <code className="block mt-2 text-sm text-gray-700 font-mono truncate">
                        {result.file.split('/').slice(-3).join('/')}
                      </code>
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {result.file}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Quick searches */}
      {!results && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { query: 'authentication JWT', label: 'Auth Patterns' },
            { query: 'impossible travel detection', label: 'Security' },
            { query: 'Kubernetes deployment', label: 'Infrastructure' },
          ].map((suggestion) => (
            <button
              key={suggestion.query}
              onClick={() => {
                setQuery(suggestion.query)
                handleSearch({ preventDefault: () => {} } as React.FormEvent)
              }}
              className="p-4 text-left bg-white rounded-lg border hover:border-blue-500 hover:shadow-sm transition-all"
            >
              <div className="font-medium text-gray-900">{suggestion.label}</div>
              <div className="text-sm text-gray-500 mt-1">{suggestion.query}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default BrainSearch
