import type { VisualState } from './setup-utils.js'
import type { PrereqRecord, StaleReason } from '@bosch-sdlc/protocol'
import { formatCost } from '../../util/format.js'

interface OperationCardProps {
  title: string
  cmd: string
  desc: string
  visualState: VisualState
  stepNumber?: number
  icon?: string
  prereq?: PrereqRecord
  disabled?: boolean
  /** When true, card renders as an inert locked tile (foundation setup complete). */
  locked?: boolean
  /** Tooltip text for the disabled "Running…" button. */
  runningTooltip?: string
  onRun: () => void
  onViewReport?: () => void
}

function staleReasonText(reason: StaleReason): string {
  switch (reason) {
    case 'aged-out':
      return 'Stale — older than 7 days'
    case 'codebase-changed':
      return 'Stale — codebase changed since last run'
  }
}

const STATUS_LABELS: Record<VisualState, string> = {
  'done': 'Done',
  'done-imported': 'Done',
  'stale': 'Stale',
  'running': 'Running',
  'next': 'Next',
  'locked': 'Locked',
  'missing': 'Not run',
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function formatAge(iso: string | null | undefined): string | null {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

export default function OperationCard({
  title, cmd, desc, visualState, stepNumber, icon, prereq, disabled, locked, runningTooltip, onRun, onViewReport,
}: OperationCardProps) {
  const disabledTitle = disabled ? 'Waiting for bosch-sdlc to finish setting up' : undefined
  const reasonText =
    visualState === 'stale' && prereq?.staleReason
      ? staleReasonText(prereq.staleReason)
      : null

  if (locked) {
    return (
      <div className="op-card op-card--locked-setup" data-state="done" aria-disabled="true">
        <div className="op-card__header">
          <span className="op-card__step op-card__step--check">✓</span>
          <span className="op-card__title">{title}</span>
          <span className="op-card__status op-card__status--done">Done</span>
        </div>
        <div className="op-card__cmd">{cmd}</div>
        <div className="op-card__desc">{desc}</div>
        <div className="op-card__setup-complete">Setup complete</div>
      </div>
    )
  }

  return (
    <div className="op-card" data-state={visualState}>
      <div className="op-card__header">
        <span className="op-card__step">
          {stepNumber != null ? stepNumber : icon}
        </span>
        <span className="op-card__title">{title}</span>
        <span className={`op-card__status op-card__status--${visualState}`}>
          {STATUS_LABELS[visualState]}
        </span>
      </div>

      <div className="op-card__cmd">{cmd}</div>
      <div className="op-card__desc">{desc}</div>
      {reasonText && <div className="op-card__stale-reason">{reasonText}</div>}

      {prereq && (visualState === 'done' || visualState === 'done-imported' || visualState === 'stale') && (
        <div className="op-card__meta">
          {formatDuration(prereq.duration) && <span>{formatDuration(prereq.duration)}</span>}
          {formatCost(prereq.cost) && <span>{formatCost(prereq.cost)}</span>}
          {visualState === 'done-imported'
            ? <span>{formatAge(prereq.lastRun) ?? ''} · imported</span>
            : formatAge(prereq.lastRun) && <span>{formatAge(prereq.lastRun)}</span>
          }
        </div>
      )}

      {visualState === 'next' && (
        <div className="op-card__meta">
          <span style={{ color: 'var(--violet)' }}>required for feature runs</span>
        </div>
      )}

      {visualState === 'locked' && (
        <div className="op-card__req">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>Requires previous step</span>
        </div>
      )}

      <div className="op-card__footer">
        {visualState === 'done-imported' && (
          <span className="op-card__imported-badge">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M12 3v12M6 9l6 6 6-6M4 21h16" />
            </svg>
            imported from disk
          </span>
        )}

        {(visualState === 'done' || visualState === 'done-imported') && (
          <>
            <button className="project__btn project__btn--ghost project__btn--sm" onClick={onViewReport}>
              View report
            </button>
            <button
              className="project__btn project__btn--sm"
              onClick={onRun}
              disabled={disabled}
              title={disabledTitle}
            >
              ↻ Re-run
            </button>
          </>
        )}

        {visualState === 'stale' && (
          <>
            <button className="project__btn project__btn--ghost project__btn--sm" onClick={onViewReport}>
              Preview diff
            </button>
            <button
              className="project__btn project__btn--amber project__btn--sm"
              onClick={onRun}
              disabled={disabled}
              title={disabledTitle}
            >
              Refresh
            </button>
          </>
        )}

        {visualState === 'next' && (
          <button
            className="project__btn project__btn--amber project__btn--sm"
            onClick={onRun}
            disabled={disabled}
            title={disabledTitle}
          >
            ▶ Run now
          </button>
        )}

        {visualState === 'running' && (
          <button className="project__btn project__btn--sm" disabled title={runningTooltip}>
            Running…
          </button>
        )}
      </div>
    </div>
  )
}
