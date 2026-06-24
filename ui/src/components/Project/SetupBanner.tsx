import type { PrereqRecord } from '@bosch-sdlc/protocol'
import { FOUNDATION_OPS, FOUNDATION_DEPS, foundationDone } from './setup-utils.js'

interface SetupBannerProps {
  prereqs: Record<string, PrereqRecord>
  running: Record<string, boolean>
  onRunNext: (cmd: string) => void
  bootstrapReady?: boolean
  runningTooltip?: string
}

const FOUNDATION_IDS = FOUNDATION_OPS.map(op => op.id)

function findNextStep(prereqs: Record<string, PrereqRecord>): typeof FOUNDATION_OPS[number] | null {
  for (const op of FOUNDATION_OPS) {
    const p = prereqs[op.id]
    if (p?.state === 'done') continue
    const deps = FOUNDATION_DEPS[op.id] ?? []
    const depsMet = deps.every(d => prereqs[d]?.state === 'done')
    if (depsMet) return op
  }
  return null
}

export default function SetupBanner({ prereqs, running, onRunNext, bootstrapReady = true, runningTooltip }: SetupBannerProps) {
  if (foundationDone(prereqs)) return null

  const completedCount = FOUNDATION_IDS.filter(id => prereqs[id]?.state === 'done').length
  const nextOp = findNextStep(prereqs)
  const isNextRunning = nextOp ? (running[nextOp.id] ?? false) : false

  const subtitle = nextOp
    ? `Feature-workflow can't run yet. Next step: run ${nextOp.cmd}`
    : 'Complete the foundation steps to unlock feature runs.'

  const buttonTitle = !bootstrapReady
    ? 'Waiting for bosch-sdlc to finish setting up'
    : (isNextRunning && runningTooltip)
    ? runningTooltip
    : undefined

  return (
    <div className="setup-banner">
      <div className="setup-banner__icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v6M12 16v6M22 12h-6M8 12H2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </div>
      <div className="setup-banner__body">
        <div className="setup-banner__title">
          Set up Claudboard for this repo
          <span className="setup-banner__chip">workspace mode</span>
        </div>
        <div className="setup-banner__subtitle">{subtitle}</div>
        <div className="setup-banner__progress">
          <div className="setup-banner__bar">
            <div className="setup-banner__fill" style={{ width: `${Math.round((completedCount / 3) * 100)}%` }} />
          </div>
          <span className="setup-banner__pct">{completedCount} of 3 done</span>
        </div>
      </div>
      {nextOp && (
        <div className="setup-banner__action">
          <button
            className="project__btn project__btn--amber"
            style={{ padding: '8px 14px' }}
            onClick={() => onRunNext(nextOp.id)}
            disabled={isNextRunning || !bootstrapReady}
            title={buttonTitle}
          >
            {isNextRunning ? 'Running…' : `▶ Run ${nextOp.cmd}`}
          </button>
        </div>
      )}
    </div>
  )
}
