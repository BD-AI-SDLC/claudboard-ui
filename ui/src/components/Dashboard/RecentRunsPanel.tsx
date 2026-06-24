import './RecentRunsPanel.css'
import type { Run, Repo } from '@bosch-sdlc/protocol'
import StatusChip from '../primitives/StatusChip.js'
import { relativeTime } from '../../util/time.js'
import { formatUsd } from '../../util/format.js'

interface RecentRunsPanelProps {
  runs: Run[]
  repos: Repo[]
  onOpenRun: (id: string) => void
}

export default function RecentRunsPanel({ runs, repos, onOpenRun }: RecentRunsPanelProps) {
  const getDate = (r: Run) => r.createdAt ?? ''
  const getRepoId = (r: Run) => r.repoId ?? ''

  const sorted = [...runs]
    .sort((a, b) => getDate(b).localeCompare(getDate(a)))
    .slice(0, 5)

  if (sorted.length === 0) {
    return (
      <div className="runs-panel__empty">
        No runs yet — start a feature from any project.
      </div>
    )
  }

  return (
    <div className="runs-panel__list">
      {sorted.map((run) => {
        const repoName = repos.find((r) => r.id === getRepoId(run))?.name ?? '(unknown)'
        const prompt = run.prompt.length > 60 ? run.prompt.slice(0, 60) + '…' : run.prompt
        return (
          <div
            key={run.id}
            className="runs-panel__row"
            onClick={() => onOpenRun(run.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onOpenRun(run.id)}
          >
            <StatusChip status={run.status} />
            <span className="runs-panel__project">{repoName}</span>
            <span className="runs-panel__prompt">{prompt}</span>
            <span className="runs-panel__time">{relativeTime(getDate(run))}</span>
            <span className="runs-panel__cost">
              {run.status === 'running' && run.costUsd == null
                ? <span className="runs-panel__cost-skeleton">…</span>
                : run.costUsd != null
                  ? formatUsd(run.costUsd)
                  : '—'
              }
            </span>
          </div>
        )
      })}
    </div>
  )
}
