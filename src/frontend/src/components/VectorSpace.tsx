import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as d3 from 'd3'

interface MemoryPoint {
  id: number
  doc_id: string
  content_summary: string
  content_preview: string
  namespace: string
  category: string
  source: string | null
  importance: number
  tags: string[]
  access_count: number
  created_at: string | null
  embedding?: number[]
}

interface ProjectionData {
  points: MemoryPoint[]
  projections: number[][]
  count: number
  algorithm: string
  error?: string
}

interface Edge {
  source: number
  target: number
  similarity: number
}

interface ExplicitEdge {
  source_doc_id: string
  target_doc_id: string
  rel_type: string
  source_summary: string
  target_summary: string
}

interface SearchResult {
  id: number
  doc_id: string
  content: string
  namespace: string
  category: string
  similarity: number
}

const NAMESPACE_COLORS: Record<string, string> = {
  default: '#6366f1',
  screensprout: '#22c55e',
  'context-engine': '#f59e0b',
  'ai-automation': '#3b82f6',
  'project-pulse': '#ec4899',
  infra: '#f59e0b',
  docs: '#3b82f6',
}

const CATEGORY_COLORS: Record<string, string> = {
  credentials: '#ef4444',
  infra: '#f59e0b',
  architecture: '#22c55e',
  product: '#3b82f6',
  project: '#8b5cf6',
  overview: '#ec4899',
  operational: '#f97316',
  deployment: '#06b6d4',
  troubleshooting: '#eab308',
  debug: '#ef4444',
  user: '#a855f7',
}

const CLUSTER_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899',
  '#f97316', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'
]

function getColor(point: MemoryPoint, colorBy: 'namespace' | 'category' | 'cluster', clusterId?: number): string {
  if (colorBy === 'namespace') {
    return NAMESPACE_COLORS[point.namespace] || '#94a3b8'
  }
  if (colorBy === 'category') {
    return CATEGORY_COLORS[point.category] || '#94a3b8'
  }
  return CLUSTER_COLORS[(clusterId || 0) % CLUSTER_COLORS.length] || '#94a3b8'
}

// Simple k-means clustering for client-side grouping
function kmeans(embeddings: number[][], k: number): number[] {
  if (embeddings.length < k) return embeddings.map((_, i) => i)
  
  // Random initial centroids
  const centroids = embeddings.slice(0, k)
  const assignments = new Array(embeddings.length).fill(0)
  
  for (let iter = 0; iter < 10; iter++) {
    // Assign points to nearest centroid
    for (let i = 0; i < embeddings.length; i++) {
      let minDist = Infinity
      let bestCluster = 0
      for (let j = 0; j < k; j++) {
        const dist = embeddings[i].reduce((sum, v, idx) => sum + (v - centroids[j][idx]) ** 2, 0)
        if (dist < minDist) {
          minDist = dist
          bestCluster = j
        }
      }
      assignments[i] = bestCluster
    }
    
    // Update centroids
    for (let j = 0; j < k; j++) {
      const clusterPoints = embeddings.filter((_, i) => assignments[i] === j)
      if (clusterPoints.length > 0) {
        centroids[j] = clusterPoints[0].map((_, idx) => 
          clusterPoints.reduce((sum, p) => sum + p[idx], 0) / clusterPoints.length
        )
      }
    }
  }
  
  return assignments
}

function VectorSpace() {
  const [data, setData] = useState<ProjectionData | null>(null)
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<MemoryPoint | null>(null)
  const [colorBy, setColorBy] = useState<'namespace' | 'category' | 'cluster'>('namespace')
  const [namespaceFilter, setNamespaceFilter] = useState<string>('')
  const [similarThreshold, setSimilarThreshold] = useState(0.65)
  const [showEdges, setShowEdges] = useState(true)
  const [explicitEdges, setExplicitEdges] = useState<ExplicitEdge[]>([])
  const [showExplicit, setShowExplicit] = useState(true)
  const [umapAvailable, setUmapAvailable] = useState(true)
  const [algorithm, setAlgorithm] = useState<'umap' | 'pca'>('umap')
  const [clusterCount, setClusterCount] = useState(5)
  const [repulsionStrength, setRepulsionStrength] = useState(0.5)
  
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity)
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Compute clusters
  const clusters = useMemo(() => {
    if (!data?.points || colorBy !== 'cluster') return null
    const embeddings = data.points.map(p => p.embedding || [0, 0])
    return kmeans(embeddings, Math.min(clusterCount, data.points.length))
  }, [data, colorBy, clusterCount])

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (namespaceFilter) params.set('namespace', namespaceFilter)
      params.set('algorithm', algorithm)
      
      const res = await fetch(`/api/vectorspace/projections?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setUmapAvailable(json.algorithm === 'umap')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [namespaceFilter, algorithm])

  const fetchEdges = useCallback(async () => {
    if (!showEdges) return
    try {
      const params = new URLSearchParams()
      params.set('threshold', similarThreshold.toString())
      if (namespaceFilter) params.set('namespace', namespaceFilter)
      const res = await fetch(`/api/vectorspace/relationships?${params}`)
      if (res.ok) {
        const json = await res.json()
        setEdges(json.edges || [])
      }
    } catch {
      setEdges([])
    }
  }, [namespaceFilter, similarThreshold, showEdges])

  const fetchExplicit = useCallback(async () => {
    try {
      const res = await fetch('/api/vectorspace/explicit-relationships')
      if (res.ok) {
        const json = await res.json()
        setExplicitEdges(json.relationships || [])
      }
    } catch {}
  }, [])

  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/vectorspace/memory/${id}`)
      if (res.ok) {
        const json = await res.json()
        setDetailContent(json.content)
      }
    } catch {}
    setDetailLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { fetchEdges() }, [fetchEdges])
  useEffect(() => { fetchExplicit() }, [fetchExplicit])

  // Prepare chart data with jitter
  const chartData = useMemo(() => {
    if (!data?.projections) return null
    
    const width = 900
    const height = 600
    const margin = { top: 20, right: 20, bottom: 20, left: 20 }
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom
    
    const projs = data.projections
    const xExtent = d3.extent(projs, p => p[0]) as [number, number]
    const yExtent = d3.extent(projs, p => p[1]) as [number, number]
    
    // Add padding
    const xPadding = (xExtent[1] - xExtent[0]) * 0.05
    const yPadding = (yExtent[1] - yExtent[0]) * 0.05
    
    const xScale = d3.scaleLinear()
      .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
      .range([0, plotWidth])
    
    const yScale = d3.scaleLinear()
      .domain([yExtent[1] + yPadding, yExtent[0] - yPadding])  // Flip Y
      .range([0, plotHeight])
    
    // Apply jitter based on repulsion strength
    const jitterAmount = repulsionStrength * 20
    const points = data.points.map((point, i) => {
      const baseX = xScale(projs[i][0])
      const baseY = yScale(projs[i][1])
      
      // Add random jitter
      const jitterX = (Math.random() - 0.5) * jitterAmount
      const jitterY = (Math.random() - 0.5) * jitterAmount
      
      return {
        ...point,
        x: baseX + jitterX,
        y: baseY + jitterY,
        r: 4 + (point.importance * 3),
        color: getColor(point, colorBy, clusters?.[i])
      }
    })
    
    // Transform edges to coordinates
    const pointMap = new Map(points.map((p, i) => [p.id, { ...p, index: i }]))
    const edgeLines = edges
      .map(edge => {
        const source = pointMap.get(edge.source)
        const target = pointMap.get(edge.target)
        if (!source || !target) return null
        return { source, target, similarity: edge.similarity }
      })
      .filter(Boolean) as { source: typeof points[0], target: typeof points[0], similarity: number }[]
    
    return { points, edges: edgeLines, width, height, margin, plotWidth, plotHeight }
  }, [data, edges, colorBy, clusters, repulsionStrength])

  // Setup D3 zoom - must be after chartData declaration
  useEffect(() => {
    if (!svgRef.current || !chartData) return
    
    const svg = d3.select(svgRef.current)
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        setTransform(event.transform)
      })
      .on('end', () => {
        // Ensure we re-render after zoom ends
        setTransform(d3.zoomTransform(svgRef.current!))
      })
    
    svg.call(zoom as any)
    
    // Double-click to reset
    svg.on('dblclick.zoom', () => {
      svg.transition().duration(300).call(zoom.transform as any, d3.zoomIdentity)
      setTransform(d3.zoomIdentity)
    })
    
    return () => {
      svg.on('.zoom', null)
      svg.on('dblclick.zoom', null)
    }
  }, [chartData])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/vectorspace/search?query=${encodeURIComponent(query)}&top_k=20${namespaceFilter ? `&namespace=${namespaceFilter}` : ''}`, { method: 'POST' })
      if (!res.ok) throw new Error('Search failed')
      const json = await res.json()
      setSearchResults(json.results || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const highlightedIds = useMemo(() => new Set(searchResults.map(r => r.id)), [searchResults])

  const selectedExplicitEdges = useMemo(() => {
    if (!selectedPoint) return { outgoing: [] as ExplicitEdge[], incoming: [] as ExplicitEdge[] }
    return {
      outgoing: explicitEdges.filter(e => e.source_doc_id === selectedPoint.doc_id),
      incoming: explicitEdges.filter(e => e.target_doc_id === selectedPoint.doc_id)
    }
  }, [selectedPoint, explicitEdges])

  return (
    <div ref={containerRef} className="min-h-screen bg-[#0a0a0f] text-gray-300">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white font-bold">◈</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white tracking-tight">VectorSpace</h1>
              <p className="text-xs text-gray-500">
                ACE Memory Visualizer
                {data && ` • ${data.count} memories • ${algorithm.toUpperCase()}`}
                {!umapAvailable && <span className="text-amber-400 ml-2">(UMAP unavailable)</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { fetchData(); fetchEdges(); fetchExplicit(); }}
              className="px-3 py-1.5 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] transition-all"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex">
        {/* Sidebar Controls */}
        <div className="w-80 border-r border-white/[0.06] p-4 space-y-6 overflow-y-auto max-h-[calc(100vh-80px)]">
          {/* Search */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Search</label>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Semantic search..."
                className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/30"
              />
              <button
                type="submit"
                disabled={searching}
                className="px-3 py-2 bg-cyan-500 text-black font-medium rounded-lg text-sm hover:bg-cyan-400 disabled:opacity-50"
              >
                {searching ? '...' : 'Go'}
              </button>
            </form>
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{searchResults.length} results</span>
                <button onClick={() => { setSearchResults([]); setQuery(''); }} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
              </div>
            )}
          </div>

          {/* Algorithm */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Projection</label>
            <div className="flex gap-2">
              <button
                onClick={() => setAlgorithm('umap')}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-all ${
                  algorithm === 'umap'
                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-gray-400 hover:text-gray-200'
                }`}
              >
                UMAP
              </button>
              <button
                onClick={() => setAlgorithm('pca')}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-all ${
                  algorithm === 'pca'
                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-gray-400 hover:text-gray-200'
                }`}
              >
                PCA
              </button>
            </div>
          </div>

          {/* Color By */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Color By</label>
            <div className="flex flex-wrap gap-2">
              {(['namespace', 'category', 'cluster'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setColorBy(mode)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    colorBy === mode
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                      : 'bg-white/[0.04] border-white/[0.08] text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between">
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Repulsion</label>
                <span className="text-xs text-gray-400">{repulsionStrength.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={repulsionStrength}
                onChange={(e) => setRepulsionStrength(parseFloat(e.target.value))}
                className="w-full mt-2 accent-cyan-500"
              />
            </div>
            
            <div>
              <div className="flex justify-between">
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Similarity Threshold</label>
                <span className="text-xs text-gray-400">{similarThreshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="0.95"
                step="0.05"
                value={similarThreshold}
                onChange={(e) => setSimilarThreshold(parseFloat(e.target.value))}
                className="w-full mt-2 accent-cyan-500"
              />
            </div>

            {colorBy === 'cluster' && (
              <div>
                <div className="flex justify-between">
                  <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Clusters</label>
                  <span className="text-xs text-gray-400">{clusterCount}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="15"
                  step="1"
                  value={clusterCount}
                  onChange={(e) => setClusterCount(parseInt(e.target.value))}
                  className="w-full mt-2 accent-violet-500"
                />
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Display</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEdges}
                  onChange={(e) => setShowEdges(e.target.checked)}
                  className="rounded border-white/[0.08] bg-white/[0.04] text-cyan-500 focus:ring-cyan-500/30"
                />
                <span className="text-sm text-gray-400">Show Similarity Edges</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExplicit}
                  onChange={(e) => setShowExplicit(e.target.checked)}
                  className="rounded border-white/[0.08] bg-white/[0.04] text-amber-500 focus:ring-amber-500/30"
                />
                <span className="text-sm text-gray-400">Show Explicit Relations</span>
              </label>
            </div>
          </div>

          {/* Filter */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Namespace Filter</label>
            <input
              type="text"
              value={namespaceFilter}
              onChange={(e) => setNamespaceFilter(e.target.value)}
              placeholder="e.g., screensprout"
              className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/30"
            />
          </div>

          {/* Instructions */}
          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-gray-500 space-y-1">
            <p><strong>Scroll</strong> to zoom</p>
            <p><strong>Drag</strong> to pan</p>
            <p><strong>Click</strong> a point for details</p>
            <p><strong>Double-click</strong> to reset view</p>
          </div>
        </div>

        {/* Visualization */}
        <div className="flex-1 p-6">
          {loading && (
            <div className="flex items-center justify-center h-96 text-gray-500">
              <div className="animate-spin mr-3">◌</div>
              Loading projections...
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-96 text-red-400">
              Error: {error}
            </div>
          )}
          
          {chartData && (
            <div className="relative">
              <svg
                ref={svgRef}
                width={chartData.width}
                height={chartData.height}
                className="bg-[#0d0d12] rounded-xl border border-white/[0.06] cursor-move"
              >
                <g transform={`translate(${chartData.margin.left},${chartData.margin.top}) ${transform.toString()}`}>
                  {/* Grid */}
                  <defs>
                    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                    </pattern>
                  </defs>
                  <rect width={chartData.plotWidth} height={chartData.plotHeight} fill="url(#grid)" />
                  
                  {/* Edges */}
                  {showEdges && chartData.edges.map((edge, i) => (
                    <line
                      key={`edge-${i}`}
                      x1={edge.source.x}
                      y1={edge.source.y}
                      x2={edge.target.x}
                      y2={edge.target.y}
                      stroke="rgba(99,102,241,0.15)"
                      strokeWidth={1 + edge.similarity}
                      opacity={0.3 + edge.similarity * 0.5}
                    />
                  ))}
                  
                  {/* Points */}
                  {chartData.points.map((point) => {
                    const isHighlighted = highlightedIds.has(point.id)
                    const isHovered = hoveredPoint === point.id
                    const isSelected = selectedPoint?.id === point.id
                    
                    return (
                      <g
                        key={point.id}
                        transform={`translate(${point.x},${point.y})`}
                        onMouseEnter={() => setHoveredPoint(point.id)}
                        onMouseLeave={() => setHoveredPoint(null)}
                        onClick={() => { setSelectedPoint(point); fetchDetail(point.id); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {/* Glow */}
                        {(isHighlighted || isHovered || isSelected) && (
                          <circle
                            r={point.r * 2}
                            fill={point.color}
                            opacity={0.2}
                            className={isSelected ? 'animate-pulse' : ''}
                          />
                        )}
                        {/* Main point */}
                        <circle
                          r={isHighlighted ? point.r * 1.5 : point.r}
                          fill={point.color}
                          stroke={isSelected ? '#fff' : 'rgba(0,0,0,0.5)'}
                          strokeWidth={isSelected ? 2 : 1}
                          opacity={isHighlighted ? 1 : 0.8}
                        />
                      </g>
                    )
                  })}
                  
                  {/* Explicit edges (dashed) */}
                  {showExplicit && explicitEdges.map((edge, i) => {
                    const source = chartData.points.find(p => p.doc_id === edge.source_doc_id)
                    const target = chartData.points.find(p => p.doc_id === edge.target_doc_id)
                    if (!source || !target) return null
                    return (
                      <line
                        key={`explicit-${i}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeDasharray="4,4"
                        opacity={0.6}
                      />
                    )
                  })}
                </g>
                
                {/* Zoom level indicator */}
                <text x={10} y={20} fill="rgba(255,255,255,0.3)" fontSize={12}>
                  Zoom: {(transform.k * 100).toFixed(0)}%
                </text>
              </svg>
              
              {/* Tooltip */}
              {hoveredPoint && chartData && (
                (() => {
                  const point = chartData.points.find(p => p.id === hoveredPoint)
                  if (!point) return null
                  return (
                    <div
                      className="absolute pointer-events-none bg-[#1a1a24] border border-white/[0.08] rounded-lg p-3 shadow-xl z-10 max-w-xs"
                      style={{
                        left: point.x * transform.k + transform.x + chartData.margin.left + 10,
                        top: point.y * transform.k + transform.y + chartData.margin.top - 10
                      }}
                    >
                      <div className="text-xs text-gray-400 mb-1">{point.namespace}</div>
                      <div className="text-sm text-white line-clamp-3">{point.content_summary}</div>
                      <div className="flex gap-2 mt-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-gray-400">{point.category}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-gray-400">⭐ {point.importance.toFixed(1)}</span>
                      </div>
                    </div>
                  )
                })()
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedPoint && (
        <div className="fixed right-0 top-20 bottom-0 w-96 bg-[#0d0d12] border-l border-white/[0.06] p-6 overflow-y-auto z-40 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Memory Detail</h3>
            <button
              onClick={() => { setSelectedPoint(null); setDetailContent(null); }}
              className="text-gray-500 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
          
          <div className="space-y-4">
            <div className="flex gap-2">
              <span className="px-2 py-1 rounded bg-violet-500/20 text-violet-300 text-xs">{selectedPoint.namespace}</span>
              <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-300 text-xs">{selectedPoint.category}</span>
            </div>
            
            <div>
              <label className="text-[11px] text-gray-500 uppercase">Content Preview</label>
              <p className="text-sm text-gray-300 mt-1 leading-relaxed">{selectedPoint.content_preview}</p>
            </div>
            
            {detailLoading ? (
              <div className="text-sm text-gray-500">Loading full content...</div>
            ) : detailContent ? (
              <div>
                <label className="text-[11px] text-gray-500 uppercase">Full Content</label>
                <pre className="mt-1 p-3 bg-black/30 rounded-lg text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">{detailContent}</pre>
              </div>
            ) : null}
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <label className="text-[11px] text-gray-500 uppercase">Importance</label>
                <div className="text-white">{selectedPoint.importance.toFixed(2)}</div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase">Access Count</label>
                <div className="text-white">{selectedPoint.access_count}</div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase">Doc ID</label>
                <div className="text-gray-400 font-mono text-xs truncate">{selectedPoint.doc_id}</div>
              </div>
              {selectedPoint.source && (
                <div>
                  <label className="text-[11px] text-gray-500 uppercase">Source</label>
                  <div className="text-gray-400 text-xs truncate">{selectedPoint.source}</div>
                </div>
              )}
            </div>
            
            {selectedPoint.tags && selectedPoint.tags.length > 0 && (
              <div>
                <label className="text-[11px] text-gray-500 uppercase">Tags</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedPoint.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-white/[0.06] text-gray-400 text-xs">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Explicit relationships */}
            {(selectedExplicitEdges.outgoing.length > 0 || selectedExplicitEdges.incoming.length > 0) && (
              <div>
                <label className="text-[11px] text-gray-500 uppercase">Explicit Relationships</label>
                <div className="space-y-2 mt-2">
                  {selectedExplicitEdges.outgoing.map((edge, i) => (
                    <div key={`out-${i}`} className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs">
                      <span className="text-amber-400">→ {edge.rel_type}</span>
                      <div className="text-gray-400 mt-1 truncate">{edge.target_summary}</div>
                    </div>
                  ))}
                  {selectedExplicitEdges.incoming.map((edge, i) => (
                    <div key={`in-${i}`} className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs">
                      <span className="text-emerald-400">← {edge.rel_type}</span>
                      <div className="text-gray-400 mt-1 truncate">{edge.source_summary}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorSpace
