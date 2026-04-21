import { useState, useEffect, useCallback } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ZAxis
} from 'recharts'

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

  const highlightedIds = new Set(searchResults.map(r => r.id))

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

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/vectorspace/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchProjections() }, [fetchProjections])
  useEffect(() => { fetchStats() }, [fetchStats])

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

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null
    const point = payload[0].payload
    return (
      <div className="bg-[#1a1a2e] p-3 rounded-xl border border-white/10 text-xs max-w-xs shadow-xl shadow-black/40">
        <div className="font-semibold text-white truncate">{point.content_summary}</div>
        <div className="text-gray-400 mt-1.5 flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: point.fill }} />
          {point.namespace} / {point.category}
        </div>
        {point.source && <div className="text-gray-500 mt-1">Source: {point.source}</div>}
        <div className="text-gray-500 mt-1 flex gap-3">
          <span>Imp: {point.importance}</span>
          <span>Access: {point.access_count}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400 text-lg">◈</div>
            <div>
              <h2 className="text-lg font-semibold text-white">VectorSpace</h2>
              <p className="text-sm text-gray-500">
                Spatial visualization of ACE memory embeddings
                {stats && (
                  <span className="text-gray-400"> — {stats.total_memories} memories across {Object.keys(stats.by_namespace || {}).length} namespaces</span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => { fetchProjections(); fetchStats(); }}
            className="px-3 py-1.5 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-gray-400 hover:bg-white/[0.08] hover:text-white transition-all"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Search */}
        <div className="md:col-span-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 backdrop-blur-xl">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories... (Ollama nomic-embed-text)"
              className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
            />
            <button
              type="submit"
              disabled={searching}
              className="px-4 py-2 bg-cyan-500 text-black font-medium rounded-lg text-sm hover:bg-cyan-400 disabled:opacity-50 transition-all"
            >
              {searching ? '...' : 'Search'}
            </button>
            {searchResults.length > 0 && (
              <button
                type="button"
                onClick={() => { setSearchResults([]); setQuery('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                ✕
              </button>
            )}
          </form>
          {searchResults.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              {searchResults.length} results highlighted on map
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 backdrop-blur-xl space-y-3">
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Color by</label>
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={() => setColorBy('namespace')}
                className={`px-3 py-1 text-xs rounded-lg transition-all ${
                  colorBy === 'namespace'
                    ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                    : 'bg-white/[0.04] text-gray-500 border border-white/[0.06] hover:text-gray-300'
                }`}
              >
                Namespace
              </button>
              <button
                onClick={() => setColorBy('category')}
                className={`px-3 py-1 text-xs rounded-lg transition-all ${
                  colorBy === 'category'
                    ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                    : 'bg-white/[0.04] text-gray-500 border border-white/[0.06] hover:text-gray-300'
                }`}
              >
                Category
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Namespace</label>
            <input
              type="text"
              value={namespaceFilter}
              onChange={(e) => setNamespaceFilter(e.target.value)}
              placeholder="e.g., default"
              className="w-full mt-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-sm">{error}</div>
      )}

      {/* Scatter Plot */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 backdrop-blur-xl">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
              <div className="text-gray-400">Computing UMAP projection...</div>
              <div className="text-xs text-gray-600 mt-1">This may take a moment</div>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="text-3xl mb-3">◈</div>
              <div className="text-gray-500">No memory data to display</div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={500}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                type="number"
                dataKey="x"
                name="UMAP-1"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="UMAP-2"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              />
              <ZAxis range={[36, 36]} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
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
                    stroke={highlightedIds.has(entry.id) ? '#92400e' : 'rgba(255,255,255,0.15)'}
                    strokeWidth={highlightedIds.has(entry.id) ? 2 : 1}
                    opacity={highlightedIds.has(entry.id) ? 1 : 0.7}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="text-sm font-medium text-white">
              Search Results: &quot;{query}&quot;
            </span>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-64 overflow-y-auto">
            {searchResults.map((r) => (
              <div
                key={r.id}
                className="px-6 py-3 hover:bg-white/[0.02] cursor-pointer transition-colors"
                onClick={() => handlePointClick({ id: r.id, content_summary: r.content, namespace: r.namespace, category: r.category })}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    {r.namespace}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    {r.category}
                  </span>
                  <span className="text-xs font-mono text-emerald-400">
                    {(r.similarity * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="text-sm text-gray-300 line-clamp-2">{r.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selectedPoint && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-6 backdrop-blur-xl">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-white">Memory Detail</h3>
              <div className="flex gap-2 mt-2">
                <span className="text-xs px-2 py-0.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {selectedPoint.namespace}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  {selectedPoint.category}
                </span>
                {selectedPoint.source && (
                  <span className="text-xs px-2 py-0.5 rounded-lg bg-white/[0.04] text-gray-400 border border-white/[0.06]">
                    {selectedPoint.source}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => { setSelectedPoint(null); setDetailContent(null) }}
              className="text-gray-500 hover:text-white transition-colors text-lg"
            >
              ✕
            </button>
          </div>
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {detailLoading ? (
              <span className="text-gray-500">Loading...</span>
            ) : (detailContent || selectedPoint.content_summary)}
          </div>
          <div className="mt-4 flex gap-4 text-xs text-gray-500">
            <span>ID: {selectedPoint.id}</span>
            <span>Importance: {selectedPoint.importance}</span>
            <span>Access: {selectedPoint.access_count}</span>
            {selectedPoint.created_at && <span>Created: {selectedPoint.created_at}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorSpace