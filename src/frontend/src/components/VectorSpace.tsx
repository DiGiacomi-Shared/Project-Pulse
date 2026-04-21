import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

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

interface ChartPoint extends MemoryPoint {
  cx: number
  cy: number
  fill: string
}

interface ProjectionData {
  points: MemoryPoint[]
  projections: number[][]
  count: number
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

function getColor(point: MemoryPoint, colorBy: 'namespace' | 'category'): string {
  if (colorBy === 'namespace') {
    return NAMESPACE_COLORS[point.namespace] || '#94a3b8'
  }
  return CATEGORY_COLORS[point.category] || '#94a3b8'
}

const MARGIN = 40
const POINT_RADIUS = 6

function VectorSpace() {
  const [data, setData] = useState<ProjectionData | null>(null)
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(false)
  const [edgesLoading, setEdgesLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<MemoryPoint | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<'namespace' | 'category'>('namespace')
  const [namespaceFilter, setNamespaceFilter] = useState<string>('')
  const [similarThreshold, setSimilarThreshold] = useState(0.65)
  const [showEdges, setShowEdges] = useState(true)
  const [explicitEdges, setExplicitEdges] = useState<ExplicitEdge[]>([])
  const [showExplicit, setShowExplicit] = useState(true)
  const [hoveredExplicitIdx, setHoveredExplicitIdx] = useState<number | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; point: ChartPoint } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 900, height: 520 })

  // Build lookup from point id -> index
  const idToIndex = useMemo(() => {
    const map = new Map<number, number>()
    if (data) {
      data.points.forEach((p, i) => map.set(p.id, i))
    }
    return map
  }, [data])

  // Build lookup from point doc_id -> index for explicit edge rendering
  const docIdToIndex = useMemo(() => {
    const map = new Map<string, number>()
    if (data) {
      data.points.forEach((p, i) => map.set(p.doc_id, i))
    }
    return map
  }, [data])

  // Compute chart data with canvas coordinates
  const chartData = useMemo((): { points: ChartPoint[]; xRange: number[]; yRange: number[] } => {
    if (!data || !data.projections.length) return { points: [] as ChartPoint[], xRange: [0, 1], yRange: [0, 1] }

    const projs = data.projections
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const p of projs) {
      if (p[0] < xMin) xMin = p[0]
      if (p[0] > xMax) xMax = p[0]
      if (p[1] < yMin) yMin = p[1]
      if (p[1] > yMax) yMax = p[1]
    }

    // Add padding
    const xPad = Math.max((xMax - xMin) * 0.1, 0.5)
    const yPad = Math.max((yMax - yMin) * 0.1, 0.5)
    xMin -= xPad; xMax += xPad
    yMin -= yPad; yMax += yPad

    const plotW = dimensions.width - MARGIN * 2
    const plotH = dimensions.height - MARGIN * 2

    const points: ChartPoint[] = data.points.map((point, i) => {
      const proj = projs[i] || [0, 0]
      const cx = MARGIN + ((proj[0] - xMin) / (xMax - xMin)) * plotW
      const cy = MARGIN + ((proj[1] - yMin) / (yMax - yMin)) * plotH
      return {
        ...point,
        cx,
        cy,
        fill: getColor(point, colorBy),
      } as ChartPoint
    })

    return { points, xRange: [xMin, xMax], yRange: [yMin, yMax] }
  }, [data, colorBy, dimensions])

  const highlightedIds = useMemo(
    () => new Set(searchResults.map(r => r.id)),
    [searchResults]
  )

  // Edges connected to hovered/selected point
  const activeEdges = useMemo(() => {
    const pid = hoveredPoint ?? (selectedPoint?.id ?? null)
    if (pid === null || !showEdges) return []
    return edges.filter(e => e.source === pid || e.target === pid)
  }, [edges, hoveredPoint, selectedPoint, showEdges])

  // Explicit edges connected to selected point (for detail panel)
  const selectedPointExplicitEdges = useMemo(() => {
    if (!selectedPoint) return { outgoing: [] as ExplicitEdge[], incoming: [] as ExplicitEdge[] }
    const docId = selectedPoint.doc_id
    const outgoing = explicitEdges.filter(e => e.source_doc_id === docId)
    const incoming = explicitEdges.filter(e => e.target_doc_id === docId)
    return { outgoing, incoming }
  }, [selectedPoint, explicitEdges])

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

  const fetchRelationships = useCallback(async () => {
    if (!showEdges) return
    setEdgesLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('threshold', similarThreshold.toString())
      if (namespaceFilter) params.set('namespace', namespaceFilter)
      const res = await fetch(`/api/vectorspace/relationships?${params}`)
      if (!res.ok) throw new Error('Failed to load relationships')
      const json = await res.json()
      setEdges(json.edges || [])
    } catch {
      setEdges([])
    } finally {
      setEdgesLoading(false)
    }
  }, [namespaceFilter, similarThreshold, showEdges])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/vectorspace/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* non-critical */ }
  }, [])

  const fetchExplicitRelationships = useCallback(async () => {
    try {
      const res = await fetch('/api/vectorspace/explicit-relationships')
      if (res.ok) {
        const json = await res.json()
        setExplicitEdges(json.relationships || [])
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchProjections() }, [fetchProjections])
  useEffect(() => { fetchRelationships() }, [fetchRelationships])
  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { fetchExplicitRelationships() }, [fetchExplicitRelationships])

  // Resize observer
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        if (w > 0) setDimensions({ width: w, height: Math.max(520, Math.round(w * 0.55)) })
      }
    })
    obs.observe(svg)
    return () => obs.disconnect()
  }, [])

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

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Find closest point
    let closestIdx = -1
    let closestDist = Infinity
    chartData.points.forEach((p, i) => {
      const dist = Math.hypot(p.cx - x, p.cy - y)
      if (dist < POINT_RADIUS + 8 && dist < closestDist) {
        closestIdx = i
        closestDist = dist
      }
    })

    if (closestIdx >= 0) {
      const p = chartData.points[closestIdx]
      setHoveredPoint(p.id)
      setTooltipPos({ x: p.cx, y: p.cy, point: p })
    } else {
      setHoveredPoint(null)
      setTooltipPos(null)
    }
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
                Spatial map of memory relationships
                {stats && (
                  <span className="text-gray-400"> — {stats.total_memories} memories, {edges.length} connections</span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => { fetchProjections(); fetchRelationships(); fetchStats(); fetchExplicitRelationships(); }}
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
              placeholder="Search memories... (semantic)"
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
              placeholder="all"
              className="w-full mt-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Edges</label>
            <button
              onClick={() => setShowEdges(!showEdges)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                showEdges ? 'bg-cyan-500/40' : 'bg-white/[0.08]'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                showEdges ? 'left-5 bg-cyan-400' : 'left-0.5 bg-gray-500'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Explicit</label>
            <button
              onClick={() => setShowExplicit(!showExplicit)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                showExplicit ? 'bg-amber-500/40' : 'bg-white/[0.08]'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                showExplicit ? 'left-5 bg-amber-400' : 'left-0.5 bg-gray-500'
              }`} />
            </button>
          </div>
          {showEdges && (
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                Similarity ≥ {similarThreshold.toFixed(2)}
              </label>
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={similarThreshold}
                onChange={(e) => setSimilarThreshold(parseFloat(e.target.value))}
                className="w-full mt-1 accent-cyan-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-sm">{error}</div>
      )}

      {/* SVG Visualization */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 backdrop-blur-xl">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
              <div className="text-gray-400">Computing UMAP projection...</div>
              <div className="text-xs text-gray-600 mt-1">This may take a moment</div>
            </div>
          </div>
        ) : chartData.points.length === 0 ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="text-3xl mb-3">◈</div>
              <div className="text-gray-500">No memory data to display</div>
            </div>
          </div>
        ) : (
          <div className="relative">
            <svg
              ref={svgRef}
              width="100%"
              height={dimensions.height}
              viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
              className="block"
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={() => { setHoveredPoint(null); setTooltipPos(null) }}
            >
              {/* Background */}
              <rect width={dimensions.width} height={dimensions.height} fill="transparent" />

              {/* Grid lines */}
              {Array.from({ length: 9 }).map((_, i) => {
                const x = MARGIN + (i + 1) * ((dimensions.width - MARGIN * 2) / 10)
                const y = MARGIN + (i + 1) * ((dimensions.height - MARGIN * 2) / 10)
                return (
                  <g key={i}>
                    <line x1={x} y1={MARGIN} x2={x} y2={dimensions.height - MARGIN} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
                    <line x1={MARGIN} y1={y} x2={dimensions.width - MARGIN} y2={y} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
                  </g>
                )
              })}

              {/* Relationship edges (background) */}
              {showEdges && edges.map((edge, i) => {
                const srcIdx = idToIndex.get(edge.source)
                const tgtIdx = idToIndex.get(edge.target)
                if (srcIdx === undefined || tgtIdx === undefined) return null
                const src = chartData.points[srcIdx]
                const tgt = chartData.points[tgtIdx]
                if (!src || !tgt) return null

                const isActive = activeEdges.some(ae => ae.source === edge.source && ae.target === edge.target)
                const opacity = isActive
                  ? 0.6 + edge.similarity * 0.3
                  : 0.03 + edge.similarity * 0.07

                return (
                  <line
                    key={`e-${i}`}
                    x1={src.cx}
                    y1={src.cy}
                    x2={tgt.cx}
                    y2={tgt.cy}
                    stroke={isActive ? src.fill : 'rgba(255,255,255,0.4)'}
                    strokeWidth={isActive ? 1.5 : 0.5}
                    opacity={opacity}
                    strokeDasharray={isActive ? undefined : '2,4'}
                  />
                )
              })}

              {/* Active edges (foreground, when hovering/selecting) */}
              {activeEdges.map((edge, i) => {
                const srcIdx = idToIndex.get(edge.source)
                const tgtIdx = idToIndex.get(edge.target)
                if (srcIdx === undefined || tgtIdx === undefined) return null
                const src = chartData.points[srcIdx]
                const tgt = chartData.points[tgtIdx]
                if (!src || !tgt) return null

                return (
                  <line
                    key={`ae-${i}`}
                    x1={src.cx}
                    y1={src.cy}
                    x2={tgt.cx}
                    y2={tgt.cy}
                    stroke={src.fill}
                    strokeWidth={1.5}
                    opacity={0.5 + edge.similarity * 0.4}
                  />
                )
              })}

              {/* Explicit relationship edges (dashed amber lines) */}
              {showExplicit && explicitEdges.map((edge, i) => {
                const srcIdx = docIdToIndex.get(edge.source_doc_id)
                const tgtIdx = docIdToIndex.get(edge.target_doc_id)
                if (srcIdx === undefined || tgtIdx === undefined) return null
                const src = chartData.points[srcIdx]
                const tgt = chartData.points[tgtIdx]
                if (!src || !tgt) return null

                const activeDocId = selectedPoint?.doc_id ?? (hoveredPoint !== null ? chartData.points[idToIndex.get(hoveredPoint) ?? -1]?.doc_id : null)
                const isActive = activeDocId !== null && (edge.source_doc_id === activeDocId || edge.target_doc_id === activeDocId)
                const isHoveredEdge = hoveredExplicitIdx === i

                const midX = (src.cx + tgt.cx) / 2
                const midY = (src.cy + tgt.cy) / 2

                return (
                  <g key={`ex-${i}`}>
                    <line
                      x1={src.cx}
                      y1={src.cy}
                      x2={tgt.cx}
                      y2={tgt.cy}
                      stroke="#f59e0b"
                      strokeWidth={isActive || isHoveredEdge ? 2 : 1}
                      strokeDasharray="6 4"
                      opacity={isActive || isHoveredEdge ? 0.8 : 0.3}
                    />
                    {(isActive || isHoveredEdge) && (
                      <g
                        onMouseEnter={() => setHoveredExplicitIdx(i)}
                        onMouseLeave={() => setHoveredExplicitIdx(null)}
                      >
                        <rect
                          x={midX - edge.rel_type.length * 3.5 - 4}
                          y={midY - 8}
                          width={edge.rel_type.length * 7 + 8}
                          height={16}
                          rx={4}
                          fill="rgba(245,158,11,0.9)"
                          stroke="rgba(245,158,11,0.5)"
                          strokeWidth={1}
                        />
                        <text
                          x={midX}
                          y={midY + 1}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#000"
                          fontSize={9}
                          fontWeight={600}
                          style={{ pointerEvents: 'none' }}
                        >
                          {edge.rel_type}
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}

              {/* Points */}
              {chartData.points.map((point, i) => {
                const isHighlighted = highlightedIds.has(point.id)
                const isHovered = hoveredPoint === point.id
                const isSelected = selectedPoint?.id === point.id
                const isConnected = activeEdges.some(e => e.source === point.id || e.target === point.id)
                const r = isHovered || isSelected ? POINT_RADIUS + 3
                  : isHighlighted ? POINT_RADIUS + 2
                  : isConnected ? POINT_RADIUS + 1
                  : POINT_RADIUS

                return (
                  <g key={`p-${i}`} onClick={() => handlePointClick(point)} style={{ cursor: 'pointer' }}>
                    {/* Glow for highlighted/hovered */}
                    {(isHovered || isSelected || isHighlighted) && (
                      <circle
                        cx={point.cx}
                        cy={point.cy}
                        r={r + 4}
                        fill={point.fill}
                        opacity={0.15}
                      />
                    )}
                    <circle
                      cx={point.cx}
                      cy={point.cy}
                      r={r}
                      fill={isHighlighted ? '#fbbf24' : point.fill}
                      stroke={isHighlighted ? '#92400e' : isSelected ? '#fff' : 'rgba(255,255,255,0.15)'}
                      strokeWidth={isHighlighted ? 2 : isSelected ? 2 : 1}
                      opacity={isHovered || isSelected ? 1 : isHighlighted ? 1 : 0.75}
                    />
                  </g>
                )
              })}

              {/* Axis labels */}
              <text x={dimensions.width / 2} y={dimensions.height - 6} textAnchor="middle" fill="#4b5563" fontSize={10}>UMAP-1</text>
              <text x={8} y={dimensions.height / 2} textAnchor="middle" fill="#4b5563" fontSize={10} transform={`rotate(-90, 12, ${dimensions.height / 2})`}>UMAP-2</text>
            </svg>

            {/* Tooltip */}
            {tooltipPos && hoveredPoint !== null && (
              <div
                className="absolute pointer-events-none bg-[#1a1a2e] p-3 rounded-xl border border-white/10 text-xs max-w-xs shadow-xl shadow-black/40 z-10"
                style={{
                  left: Math.min(tooltipPos.x + 12, dimensions.width - 200),
                  top: Math.max(tooltipPos.y - 60, 10),
                }}
              >
                <div className="font-semibold text-white truncate">{tooltipPos.point.content_summary}</div>
                <div className="text-gray-400 mt-1.5 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: getColor(tooltipPos.point, colorBy) }} />
                  {tooltipPos.point.namespace} / {tooltipPos.point.category}
                </div>
                {tooltipPos.point.source && <div className="text-gray-500 mt-1">Source: {tooltipPos.point.source}</div>}
                <div className="text-gray-500 mt-1 flex gap-3">
                  <span>Imp: {tooltipPos.point.importance}</span>
                  <span>Access: {tooltipPos.point.access_count}</span>
                </div>
                {activeEdges.length > 0 && (
                  <div className="text-cyan-400 mt-1">{activeEdges.length} connection{activeEdges.length !== 1 ? 's' : ''}</div>
                )}
              </div>
            )}

            {/* Edge count badge */}
            {((showEdges && edges.length > 0) || (showExplicit && explicitEdges.length > 0)) && (
              <div className="absolute top-2 right-2 text-xs text-gray-500 bg-white/[0.04] px-2 py-1 rounded-lg border border-white/[0.06] flex gap-2">
                {showEdges && edges.length > 0 && (
                  <span>{edges.length} edges{edgesLoading && <span className="ml-1 animate-pulse">...</span>}</span>
                )}
                {showExplicit && explicitEdges.length > 0 && (
                  <span className="text-amber-400/70">{explicitEdges.length} explicit</span>
                )}
              </div>
            )}
          </div>
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
                onClick={() => {
                  handlePointClick({ id: r.id, content_summary: r.content, namespace: r.namespace, category: r.category } as MemoryPoint)
                  const idx = idToIndex.get(r.id)
                  if (idx !== undefined && chartData.points[idx]) {
                    setHoveredPoint(r.id)
                  }
                }}
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

          {/* Connected memories */}
          {activeEdges.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Connected Memories</h4>
              <div className="space-y-1.5">
                {activeEdges.slice(0, 8).map((edge, i) => {
                  const otherId = edge.source === selectedPoint.id ? edge.target : edge.source
                  const otherPoint = chartData.points[idToIndex.get(otherId) ?? -1]
                  if (!otherPoint) return null
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white/[0.02] rounded-lg px-2 py-1 transition-colors"
                      onClick={() => handlePointClick(otherPoint)}
                    >
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: getColor(otherPoint, colorBy) }} />
                      <span className="text-gray-300 truncate flex-1">{otherPoint.content_summary}</span>
                      <span className="text-xs font-mono text-cyan-400">{(edge.similarity * 100).toFixed(0)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Explicit Relationships */}
          {(selectedPointExplicitEdges.outgoing.length > 0 || selectedPointExplicitEdges.incoming.length > 0) && (
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Relationships</h4>
              <div className="space-y-1.5">
                {selectedPointExplicitEdges.outgoing.map((edge, i) => (
                  <div
                    key={`out-${i}`}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white/[0.02] rounded-lg px-2 py-1 transition-colors"
                    onClick={() => {
                      const tgtIdx = docIdToIndex.get(edge.target_doc_id)
                      if (tgtIdx !== undefined && chartData.points[tgtIdx]) {
                        handlePointClick(chartData.points[tgtIdx])
                      }
                    }}
                  >
                    <span className="text-amber-400 text-xs">→</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                      {edge.rel_type}
                    </span>
                    <span className="text-gray-300 truncate flex-1">{edge.target_summary}</span>
                  </div>
                ))}
                {selectedPointExplicitEdges.incoming.map((edge, i) => (
                  <div
                    key={`in-${i}`}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white/[0.02] rounded-lg px-2 py-1 transition-colors"
                    onClick={() => {
                      const srcIdx = docIdToIndex.get(edge.source_doc_id)
                      if (srcIdx !== undefined && chartData.points[srcIdx]) {
                        handlePointClick(chartData.points[srcIdx])
                      }
                    }}
                  >
                    <span className="text-amber-400 text-xs">←</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                      {edge.rel_type}
                    </span>
                    <span className="text-gray-300 truncate flex-1">{edge.source_summary}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {chartData.points.length > 0 && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 backdrop-blur-xl">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(colorBy === 'namespace' ? NAMESPACE_COLORS : CATEGORY_COLORS) && (
              Object.entries(colorBy === 'namespace' ? NAMESPACE_COLORS : CATEGORY_COLORS)
                .filter(([key]) => chartData.points.some(p => (colorBy === 'namespace' ? p.namespace : p.category) === key))
                .map(([key, color]) => (
                  <div key={key} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    {key}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorSpace