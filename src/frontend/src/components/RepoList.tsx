import { useState, useEffect } from 'react'

interface Repo {
  id: number
  name: string
  owner: string
  url: string
  last_commit_at: string | null
  open_prs: number
}

interface SyncStatus {
  status: string
  repos_synced: number
  repos: { name: string; task_id: string }[]
}

function RepoList() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [repoDetails, setRepoDetails] = useState<any>(null)

  useEffect(() => {
    fetchRepos()
  }, [])

  const fetchRepos = async () => {
    try {
      const response = await fetch('/api/repos')
      if (!response.ok) throw new Error('Failed to fetch')
      const data = await response.json()
      setRepos(data)
    } catch (err) {
      console.error('Failed to fetch repos:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const response = await fetch('/api/repos/sync', { method: 'POST' })
      if (!response.ok) throw new Error('Sync failed')
      const data = await response.json()
      setSyncStatus(data)
      // Refresh after a delay
      setTimeout(fetchRepos, 3000)
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncing(false)
    }
  }

  const fetchRepoDetails = async (owner: string, name: string) => {
    try {
      const response = await fetch(`/api/repos/${owner}/${name}/sync`)
      if (!response.ok) throw new Error('Failed to fetch details')
      const data = await response.json()
      setRepoDetails(data)
    } catch (err) {
      console.error('Failed to fetch repo details:', err)
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading repositories...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Repositories</h2>
            <p className="text-gray-600">{repos.length} repositories configured</p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync All'}
          </button>
        </div>

        {syncStatus && (
          <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg">
            {syncStatus.status === 'queued' ? (
              <span>Queued sync for {syncStatus.repos_synced} repositories</span>
            ) : (
              <span>Sync completed</span>
            )}
          </div>
        )}
      </div>

      {/* Repo Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {repos.map((repo) => (
          <div
            key={repo.id}
            onClick={() => {
              setSelectedRepo(repo)
              fetchRepoDetails(repo.owner, repo.name)
            }}
            className="bg-white p-4 rounded-lg border hover:border-blue-500 hover:shadow-md cursor-pointer transition-all"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900">{repo.name}</div>
                <div className="text-sm text-gray-500">{repo.owner}</div>
              </div>
              {repo.open_prs > 0 && (
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                  {repo.open_prs} PRs
                </span>
              )}
            </div>

            <div className="mt-3 text-xs text-gray-400">
              {repo.last_commit_at
                ? `Last commit: ${new Date(repo.last_commit_at).toLocaleDateString()}`
                : 'No recent commits'}
            </div>
          </div>
        ))}
      </div>

      {/* Selected Repo Details */}
      {selectedRepo && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold">
              {selectedRepo.owner}/{selectedRepo.name}
            </h3>
            <button
              onClick={() => setSelectedRepo(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="p-4">
            {repoDetails ? (
              <div className="space-y-4">
                {/* Repo Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-sm text-gray-500">Open Issues</div>
                    <div className="text-lg font-semibold">
                      {repoDetails.repo?.open_issues || 0}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-sm text-gray-500">Branch</div>
                    <div className="text-lg font-semibold">
                      {repoDetails.repo?.default_branch || 'main'}
                    </div>
                  </div>
                </div>

                {/* Recent Commits */}
                {repoDetails.commits && repoDetails.commits.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Recent Commits</h4>
                    <div className="space-y-2">
                      {repoDetails.commits.slice(0, 5).map((commit: any, i: number) => (
                        <div key={i} className="text-sm p-2 bg-gray-50 rounded">
                          <div className="font-medium truncate">{commit.message}</div>
                          <div className="text-gray-500 text-xs">
                            {commit.author} • {commit.sha?.substring(0, 7)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Open PRs */}
                {repoDetails.pull_requests && repoDetails.pull_requests.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">
                      Open Pull Requests ({repoDetails.pull_requests.length})
                    </h4>
                    <div className="space-y-2">
                      {repoDetails.pull_requests.slice(0, 5).map((pr: any) => (
                        <div
                          key={pr.number}
                          className="text-sm p-2 bg-gray-50 rounded flex items-center justify-between"
                        >
                          <div>
                            <div className="font-medium truncate">#{pr.number} {pr.title}</div>
                            <div className="text-gray-500 text-xs">
                              by {pr.author} • {new Date(pr.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          {pr.draft && (
                            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                              Draft
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">Loading details...</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default RepoList
