import { useState, useEffect, useCallback } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ZAxis
} from 'recharts'

// --- Types ---
interface MemoryPoint {
  id: number
  doc_id: string
  content_summary: string
  content_full?: string
  namespace: string
  category: string
  source: string | null
  importance: number
  tags: string[]
  access_count: number
  created_at: string | null
}

interface ProjectionData {
  points: MemoryPoint[]
  projections: number[][]
  count: number
  error?: string
}

interface SearchResult {
  id: number
  doc_id: string
  content: string
  namespace: string
  category: string
  similarity: number
}

interface Stats {
  total_memories: number
  by_namespace: Record<string, number>
  by_category: Record<string, number>
  status: string
  database: string
  embedding_model: string
  dimensions: number
}

// --- Color palettes ---
const NAMESPACE_COLORS: Record<string, string> = {
  default: '#6366f1',
  specterdefence: '#ef4444',
  'screen-sprout': '#22c55e',
  infra: '#f59e0b',
  docs: '#3b82f6',
}

const CATEGORY_COLORS: Record<string, string> = {
  general: '#8b5cf6',
  infra: '#f59e0b',
  security: '#ef4444',
  code: '#22c55e',
  docs: '#3b82f6',
  conversation: '#ec4899',
}

function getColor(point: MemoryPoint, colorBy: 'namespace' | 'category'): string {
  if (colorBy === 'namespace') {
    return NAMESPACE_COLORS[point.namespace] || '#94a3b8'
  }
  return CATEGORY_COLORS[point.category] || '#94a3b8'
}

function VectorSpace() {
  const [data, setData] = useState<ProjectionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<MemoryPoint | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<'namespace' | 'category'>('namespace')
  const [namespaceFilter, setNamespaceFilter] = useState<string>('')
  const [stats, setStats] = useState<Stats | null>(null)

  // Build chart data = points merged with projections
  const chartData = data
    ? data.points.map((point, i) => {
        const proj = data.projections[i] || [0, 0]
        return {
          ...point,
          x: proj[0],
          y: proj[1],
          fill: getColor(point, colorBy),
        }
      })
    : []

  // Highlighted point IDs from search
  const highlightedIds = new Set(searchResults.map(r => r.id))

  // --- Fetch projections ---
  const fetchProjections = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (namespaceFilter) params.set('namespace', namespaceFilter)
      const res = await fetch(`/api/vectorspace/projections?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projections')
    } finally {
      setLoading(false)
    }
  }, [namespaceFilter])

  // --- Fetch stats ---
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/vectorspace/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchProjections() }, [fetchProjections])
  useEffect(() => { fetchStats() }, [fetchStats])

  // --- Search ---
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await fetch('/api/vectorspace/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          top_k: 20,
          namespace: namespaceFilter || undefined,
        }),
      })
      if (!res.ok) throw new Error('Search failed')
      const json = await res.json()
      setSearchResults(json.results || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  // --- Point click => detail ---
  const handlePointClick = async (point: any) => {
    setSelectedPoint(point)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/vectorspace/memory/${point.id}`)
      if (res.ok) {
        const detail = await res.json()
        setDetailContent(detail.content)
      }
    } catch { /* ignore */ }
    setDetailLoading(false)
  }

  // --- Custom tooltip ---
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null
    const point = payload[0].payload
    return (
      <div className="bg-white p-2 rounded shadow-lg border text-xs max-w-xs">
        <div className="font-semibold truncate">{point.content_summary}</div>
        <div className="text-gray-500 mt-1">
          {point.namespace} / {point.category}
        </div>
        {point.source && <div className="text-gray-400">Source: {point.source}</div>}
        <div className="text-gray-400 mt-1">
          Importance: {point.importance} | Access: {point.access_count}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">VectorSpace</h2>
            <p className="text-sm text-gray-500 mt-1">
              Spatial visualization of ACE memory embeddings
              {stats && ` — ${stats.total_memories} memories across ${Object.keys(stats.by_namespace || {}).length} namespaces`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { fetchProjections(); fetchStats(); }}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Controls: Search + Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Search */}
        <div className="md:col-span-2 bg-white p-4 rounded-lg shadow-sm border">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories... (uses Ollama nomic-embed-text)"
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={searching}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
            {searchResults.length > 0 && (
              <button
                type="button"
                onClick={() => { setSearchResults([]); setQuery('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </form>
          {searchResults.length > 0 && (
            <div className="mt-3 text-sm text-gray-600">
              Found {searchResults.length} results — highlighted on the map
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow-sm border space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Color by</label>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setColorBy('namespace')}
                className={`px-3 py-1 text-xs rounded ${colorBy === 'namespace' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}
              >
                Namespace
              </button>
              <button
                onClick={() => setColorBy('category')}
                className={`px-3 py-1 text-xs rounded ${colorBy === 'category' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}
              >
                Category
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Namespace filter</label>
            <input
              type="text"
              value={namespaceFilter}
              onChange={(e) => setNamespaceFilter(e.target.value)}
              placeholder="e.g., default"
              className="w-full mt-1 px-3 py-1.5 border rounded text-sm"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* Scatter Plot */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-gray-500">Computing UMAP projection...</div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-96 text-gray-400">
            No memory data to display
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={500}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                type="number"
                dataKey="x"
                name="UMAP-1"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="UMAP-2"
                tick={{ fontSize: 11 }}
              />
              <ZAxis range={[40, 40]} />
              <Tooltip content={<CustomTooltip />} />
              <Scatter
                name="Memories"
                data={chartData}
                onClick={handlePointClick}
                cursor="pointer"
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={highlightedIds.has(entry.id) ? '#fbbf24' : entry.fill}
                    stroke={highlightedIds.has(entry.id) ? '#92400e' : '#fff'}
                    strokeWidth={highlightedIds.has(entry.id) ? 2 : 1}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Search results as list (below the plot) */}
      {searchResults.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 border-b bg-gray-50">
            <h3 className="font-medium">Search Results: &quot;{query}&quot;</h3>
          </div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {searchResults.map((r) => (
              <div
                key={r.id}
                className="p-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => handlePointClick({ id: r.id, content_summary: r.content, namespace: r.namespace, category: r.category })}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                    {r.namespace}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                    {r.category}
                  </span>
                  <span className="text-xs font-mono text-green-600">
                    {(r.similarity * 100).toFixed(1)}% match
                  </span>
                </div>
                <div className="text-sm text-gray-700 mt-1 line-clamp-2">{r.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedPoint && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Memory Detail</h3>
              <div className="flex gap-2 mt-1">
                <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded">
                  {selectedPoint.namespace}
                </span>
                <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                  {selectedPoint.category}
                </span>
                {selectedPoint.source && (
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                    {selectedPoint.source}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => { setSelectedPoint(null); setDetailContent(null) }}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <div className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
            {detailLoading ? 'Loading...' : (detailContent || selectedPoint.content_summary)}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-gray-400">
            <span>ID: {selectedPoint.id}</span>
            <span>Importance: {selectedPoint.importance}</span>
            <span>Access count: {selectedPoint.access_count}</span>
            {selectedPoint.created_at && <span>Created: {selectedPoint.created_at}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorSpace