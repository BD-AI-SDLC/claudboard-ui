import './BootstrapCard.css'
import type { BootstrapStatusResponse } from '@bosch-sdlc/protocol'

interface BootstrapCardProps {
  status: BootstrapStatusResponse
  onRetry: () => void
}

export default function BootstrapCard({ status, onRetry }: BootstrapCardProps) {
  if (status.state === 'ready') return null

  if (status.state === 'cli-missing') {
    return (
      <div className="bootstrap-card bootstrap-card--blocker" role="alert">
        <div className="bootstrap-card__title">Claude Code is not installed</div>
        <div className="bootstrap-card__body">
          bosch-sdlc requires Claude Code on this machine. Install it, then restart this app.
        </div>
        <div className="bootstrap-card__actions">
          <a
            className="bootstrap-card__link"
            href="https://claude.com/download"
            target="_blank"
            rel="noreferrer"
          >
            Open claude.com/download
          </a>
        </div>
      </div>
    )
  }

  if (status.state === 'install-failed') {
    return (
      <div className="bootstrap-card bootstrap-card--error" role="alert">
        <div className="bootstrap-card__title">Plugin install failed</div>
        <div className="bootstrap-card__body bootstrap-card__body--mono">
          {status.message ?? 'Unknown error'}
        </div>
        <div className="bootstrap-card__actions">
          <button type="button" className="bootstrap-card__btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  // installing
  return (
    <div className="bootstrap-card bootstrap-card--installing" role="status" aria-live="polite">
      <span className="bootstrap-card__spinner" aria-hidden="true" />
      <div className="bootstrap-card__body">
        Setting up bosch-sdlc — installing the claudboard plugin in the background…
      </div>
    </div>
  )
}
