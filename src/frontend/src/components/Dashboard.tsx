import { useState, useEffect } from 'react'
import BrainSearch from './BrainSearch'
import VectorSpace from './VectorSpace'

type Tab = 'overview' | 'brain' | 'vectorspace'

interface TabConfig {
  id: Tab
  label: string
  icon: string
}

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview', icon: '◉' },
  { id: 'brain', label: 'Brain Search', icon: '⬡' },
  { id: 'vectorspace', label: 'VectorSpace', icon: '◈' },
]

function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [health, setHealth] = useState<{ status: string } | null>(null)
  const [brainStats, setBrainStats] = useState<{ document_count: number } | null>(null)
  const [aceStats, setAceStats] = useState<{ total_memories: number; by_namespace: Record<string, number>; by_category: Record<string, number> } | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {})

    fetch('/api/brain/stats')
      .then(r => r.json())
      .then(setBrainStats)
      .catch(() => {})

    fetch('/api/vectorspace/stats')
      .then(r => r.json())
      .then(setAceStats)
      .catch(() => {})
  }, [])

  const statCards = [
    {
      label: 'API Status',
      value: health?.status || '...',
      variant: 'status' as const,
    },
    {
      label: 'Brain Documents',
      value: brainStats?.document_count?.toLocaleString() || '...',
      variant: 'cyan' as const,
    },
    {
      label: 'ACE Memories',
      value: aceStats?.total_memories?.toLocaleString() || '...',
      variant: 'violet' as const,
    },
    {
      label: 'Namespaces',
      value: aceStats ? Object.keys(aceStats.by_namespace || {}).length.toString() : '...',
      variant: 'emerald' as const,
    },
  ]

  const cardGradients: Record<string, string> = {
    status: 'from-emerald-500/10 to-emerald-500/0',
    cyan: 'from-cyan-500/10 to-cyan-500/0',
    violet: 'from-violet-500/10 to-violet-500/0',
    emerald: 'from-emerald-500/10 to-emerald-500/0',
  }

  const valueColors: Record<string, string> = {
    status: 'text-emerald-400',
    cyan: 'text-cyan-400',
    violet: 'text-violet-400',
    emerald: 'text-emerald-400',
  }

  return (
    <div className="px-6 py-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${cardGradients[card.variant]} border border-white/[0.06] p-4 backdrop-blur-xl`}
          >
            <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{card.label}</div>
            <div className={`text-2xl font-bold mt-1 ${valueColors[card.variant]}`}>
              {card.value}
            </div>
            {card.variant === 'status' && health?.status === 'healthy' && (
              <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
            )}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-8">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
              activeTab === tab.id
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                : 'bg-white/[0.03] text-gray-400 border border-white/[0.06] hover:bg-white/[0.06] hover:text-gray-300'
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Welcome Card */}
            <div className="rounded-2xl bg-gradient-to-br from-cyan-500/[0.07] via-transparent to-violet-500/[0.07] border border-white/[0.06] p-8 backdrop-blur-xl">
              <h2 className="text-2xl font-bold text-white tracking-tight">Welcome to Project Pulse</h2>
              <p className="text-gray-400 mt-2 max-w-xl leading-relaxed">
                Your workspace intelligence layer. Search across projects with semantic understanding, and explore your knowledge graph in space.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                <button
                  onClick={() => setActiveTab('brain')}
                  className="group text-left p-5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-cyan-500/30 hover:bg-cyan-500/[0.04] transition-all duration-300"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500/20 transition-colors">
                      ⬡
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-cyan-400 transition-colors">Brain Search</div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        Search {brainStats?.document_count || 0} documents with semantic understanding
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setActiveTab('vectorspace')}
                  className="group text-left p-5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/[0.04] transition-all duration-300"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400 group-hover:bg-violet-500/20 transition-colors">
                      ◈
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-violet-400 transition-colors">VectorSpace</div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        Explore {aceStats?.total_memories || 0} memory embeddings in 2D space
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Namespace breakdown */}
            {aceStats && Object.keys(aceStats.by_namespace || {}).length > 0 && (
              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-6 backdrop-blur-xl">
                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Memory Distribution</h3>
                <div className="space-y-3">
                  {Object.entries(aceStats.by_namespace).map(([ns, count]) => {
                    const total = aceStats.total_memories || 1
                    const pct = Math.round((count / total) * 100)
                    return (
                      <div key={ns}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-300 font-medium">{ns}</span>
                          <span className="text-gray-500">{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'brain' && <BrainSearch />}
        {activeTab === 'vectorspace' && <VectorSpace />}
      </div>
    </div>
  )
}

export default Dashboard