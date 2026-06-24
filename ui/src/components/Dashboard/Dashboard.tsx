import './Dashboard.css'
import { useEffect, useState } from 'react'
import type { Project, Repo, Run, DashboardSummary } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import TopBar from '../primitives/TopBar.js'
import RecentRunsPanel from './RecentRunsPanel.js'

interface DashboardProps {
  repos: Repo[]
  runs: Run[]
  refreshRepos: () => void
  onRepoClick?: (_repoId: string) => void
  onStartFeature?: () => void
  startFeatureDisabled?: boolean
  onOpenRun?: (id: string) => void
  activeProject?: Project | null
}

export default function Dashboard({
  repos,
  runs,
  onRepoClick: _onRepoClick,
  onStartFeature,
  startFeatureDisabled,
  onOpenRun,
  activeProject,
}: DashboardProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)

  useEffect(() => {
    api.getDashboardSummary().then(setSummary).catch(console.error)
  }, [])

  const activeRuns = summary?.activeRuns ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        title={activeProject?.name ?? 'Project overview'}
        breadcrumb={['project']}
        onStartFeature={onStartFeature}
        startFeatureDisabled={startFeatureDisabled}
      />

      <div className="dash__page">
        <h1>{activeProject?.name ?? 'Project overview'}</h1>
        <div className="dash__sub">
          {repos.length} repos · {activeRuns} active run{activeRuns !== 1 ? 's' : ''} · features shipped this month
        </div>

        {/* KPI strip */}
        <div className="dash__kpi-strip">
          <div className="dash__kpi-cell">
            <div className="dash__kpi-cell-value">{summary?.activeRuns ?? '—'}</div>
            <div className="dash__kpi-cell-label">Active runs</div>
          </div>
          <div className="dash__kpi-cell">
            <div className="dash__kpi-cell-value">{summary?.awaitingGate ?? '—'}</div>
            <div className="dash__kpi-cell-label">Awaiting gate</div>
          </div>
          <div className="dash__kpi-cell">
            <div className="dash__kpi-cell-value">{summary?.inReview ?? '—'}</div>
            <div className="dash__kpi-cell-label">In review</div>
          </div>
          <div className="dash__kpi-cell">
            <div className="dash__kpi-cell-value">{summary?.mergedThisWeek ?? '—'}</div>
            <div className="dash__kpi-cell-label">Merged this week</div>
          </div>
        </div>

        {/* Recent runs */}
        <h2 className="dash__h2">Recent runs</h2>
        <div className="dash__card">
          <RecentRunsPanel
            runs={runs}
            repos={repos}
            onOpenRun={onOpenRun ?? (() => {})}
          />
        </div>
      </div>
    </div>
  )
}
