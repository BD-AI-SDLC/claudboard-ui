import { useEffect, useState } from 'react'
import type { RunStatus } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import Icon from '../primitives/Icon.js'

interface PauseResumeButtonProps {
  runId: string
  status: RunStatus
}

type NextAction = 'pause' | 'resume' | null

function nextActionFor(status: RunStatus): NextAction {
  if (status === 'running') return 'pause'
  if (status === 'paused-user') return 'resume'
  return null
}

export default function PauseResumeButton({ runId, status }: PauseResumeButtonProps) {
  const [pending, setPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const nextAction = nextActionFor(status)

  useEffect(() => {
    if (status === 'running' || status === 'paused-user') setPending(false)
  }, [status])

  useEffect(() => {
    if (!errorMsg) return
    const t = setTimeout(() => setErrorMsg(null), 4000)
    return () => clearTimeout(t)
  }, [errorMsg])

  async function handleClick() {
    if (pending || nextAction === null) return
    setPending(true)
    setErrorMsg(null)
    try {
      if (nextAction === 'pause') await api.pauseRun(runId)
      else await api.resumeRun(runId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Request failed')
      setPending(false)
    }
  }

  const label = nextAction === 'resume' ? 'Resume' : 'Pause'
  const iconName = nextAction === 'resume' ? 'play' : 'pause'
  const disabled = nextAction === null || pending
  const className = `active-run__btn-ghost${disabled ? ' active-run__btn-ghost--disabled' : ''}`

  return (
    <div className="active-run__btn-wrap">
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
      >
        <Icon name={iconName} size={11} />
        {label}
      </button>
      {errorMsg && <div className="active-run__btn-error" role="alert">{errorMsg}</div>}
    </div>
  )
}
