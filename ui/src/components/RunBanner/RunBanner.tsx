import './RunBanner.css'
import Icon from '../primitives/Icon.js'

interface RunBannerProps {
  status: string
  gateId: string | null
  gateKind?: string
  questionCount?: number
  answeredCount?: number
  onReview: () => void
  onSkipInterview?: () => void
}

export default function RunBanner({
  status,
  gateId,
  gateKind,
  questionCount,
  answeredCount,
  onReview,
  onSkipInterview,
}: RunBannerProps) {
  if (status !== 'paused-gate') return null

  const isClarify = gateKind === 'clarify'

  if (isClarify) {
    const n = questionCount ?? 0
    const x = answeredCount ?? 0
    return (
      <div className="run-banner__root run-banner__root--violet">
        <div className="run-banner__icon">
          <span style={{ fontWeight: 700, fontSize: 15 }}>?</span>
        </div>
        <div>
          <div className="run-banner__message">
            main agent is asking {n} question{n !== 1 ? 's' : ''} to scope the feature
          </div>
          <div className="run-banner__sub">
            Phase 1a · clarify scope · {x} of {n} answered
          </div>
        </div>
        <div className="run-banner__cta">
          {onSkipInterview && (
            <button className="run-banner__btn run-banner__btn--ghost" onClick={onSkipInterview}>
              Skip all → defaults
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="run-banner__root">
      <div className="run-banner__icon">
        <Icon name="pause" size={16} />
      </div>
      <div>
        <div className="run-banner__message">Awaiting your review — spec + plan ready</div>
        <div className="run-banner__sub">
          After approval, the workflow runs autonomously through the remaining phases.
        </div>
      </div>
      <div className="run-banner__cta">
        {gateId && (
          <button className="run-banner__btn" onClick={onReview}>
            <Icon name="flag" size={12} />
            Review →
          </button>
        )}
      </div>
    </div>
  )
}
