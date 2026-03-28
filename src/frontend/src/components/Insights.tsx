import { useState, useEffect } from 'react'

interface Insight {
  id: number
  type: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  created_at: string
  read: boolean
}

interface HealthScore {
  project: string
  total_files: number
  documentation: number
  source_code: number
  tests: number
  health_score: number
  last_updated: string
}

function Insights() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [healthScores, setHealthScores] = useState<HealthScore[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState('specterdefence')

  useEffect(() => {
    // Fetch insights
    fetch('/api/insights')
      .then(r => r.json())
      .then(data => setInsights(data))
      .catch(console.error)
      .finally(() => setLoading(false))

    // Fetch health for common projects
    const projects = ['specterdefence', 'screen-sprout-api', 'screen-sprout-web']
    Promise.all(
      projects.map(p => 
        fetch(`/api/insights/health/${p}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ).then(results => {
      setHealthScores(results.filter(r => r && r.project) as HealthScore[])
    })
  }, [])

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 border-red-200 text-red-800'
      case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-800'
      default: return 'bg-blue-50 border-blue-200 text-blue-800'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'pattern': return '🔄'
      case 'alert': return '⚠️'
      case 'reminder': return '💡'
      case 'drift': return '📊'
      default: return '•'
    }
  }

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 50) return 'text-yellow-600'
    return 'text-red-600'
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading insights...</div>
  }

  return (
    <div className="space-y-6">
      {/* Health Scores */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-lg font-semibold mb-4">Project Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {healthScores.map((health) => (
            <div key={health.project} className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900 capitalize">
                  {health.project.replace(/-/g, ' ')}
                </span>
                <span className={`text-2xl font-bold ${getHealthColor(health.health_score)}`}>
                  {health.health_score}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="font-medium text-gray-900">{health.source_code}</div>
                  <div className="text-gray-500">Code</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">{health.documentation}</div>
                  <div className="text-gray-500">Docs</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">{health.tests}</div>
                  <div className="text-gray-500">Tests</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Insights List */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Generated Insights</h2>
          <span className="text-sm text-gray-500">
            {insights.filter(i => !i.read).length} unread
          </span>
        </div>

        <div className="divide-y">
          {insights.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No insights yet. Run a sync to generate insights.
            </div>
          ) : (
            insights.map((insight) => (
              <div
                key={insight.id}
                className={`p-4 ${!insight.read ? 'bg-gray-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getTypeIcon(insight.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${getSeverityColor(insight.severity)}`}>
                        {insight.type}
                      </span>
                      {!insight.read && (
                        <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                      )}
                    </div>
                    <h3 className="font-medium text-gray-900 mt-1">{insight.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{insight.description}</p>
                    <div className="text-xs text-gray-400 mt-2">
                      {new Date(insight.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!insight.read && (
                    <button
                      onClick={() => {
                        // Mark as read
                        fetch(`/api/insights/${insight.id}/read`, { method: 'POST' })
                        setInsights(insights.map(i => 
                          i.id === insight.id ? { ...i, read: true } : i
                        ))
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Manual Actions */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h3 className="font-medium text-gray-900 mb-4">Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => fetch('/api/repos/sync', { method: 'POST' })}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            Sync Repositories
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
          >
            Refresh Insights
          </button>
        </div>
      </div>
    </div>
  )
}

export default Insights
