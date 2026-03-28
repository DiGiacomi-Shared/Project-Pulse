import { useState, useEffect } from 'react'
import BrainSearch from './BrainSearch'
import Insights from './Insights'
import RepoList from './RepoList'

type Tab = 'overview' | 'brain' | 'insights' | 'repos'

function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [health, setHealth] = useState<{ status: string } | null>(null)
  const [brainStats, setBrainStats] = useState<{ document_count: number } | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
    
    fetch('/api/brain/stats')
      .then(r => r.json())
      .then(setBrainStats)
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Status Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <div className="text-sm text-gray-500">API Status</div>
          <div className={`font-semibold ${health?.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
            {health?.status || 'Loading...'}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <div className="text-sm text-gray-500">Brain Documents</div>
          <div className="font-semibold text-blue-600">
            {brainStats?.document_count?.toLocaleString() || '...'}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <div className="text-sm text-gray-500">Last Sync</div>
          <div className="font-semibold text-gray-900">Just now</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex gap-1">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'brain', label: 'Brain Search' },
            { id: 'insights', label: 'Insights' },
            { id: 'repos', label: 'Repositories' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-lg font-semibold mb-4">Welcome to Project Pulse</h2>
              <p className="text-gray-600 mb-4">
                Your workspace intelligence dashboard. Search across all projects, track insights, and monitor repository health.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="font-medium text-blue-900">Brain Search</div>
                  <p className="text-sm text-blue-700 mt-1">
                    Search {brainStats?.document_count || 0} documents across all your projects with semantic understanding.
                  </p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <div className="font-medium text-green-900">Smart Insights</div>
                  <p className="text-sm text-green-700 mt-1">
                    Automatic detection of patterns, reminders, and architecture drift.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'brain' && <BrainSearch />}
        {activeTab === 'insights' && <Insights />}
        {activeTab === 'repos' && <RepoList />}
      </div>
    </div>
  )
}

export default Dashboard
