import { useEffect, useRef, useState } from 'react'
import type { Run } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import Icon from '../primitives/Icon.js'
import Popover from '../primitives/Popover.js'
import PauseResumeButton from './PauseResumeButton.js'
import './RunControlCluster.css'

interface RunControlClusterProps {
  runId: string
  run: Run | null
  /**
   * Fired when the user wants to start a new run pre-filled from this one's
   * kickoff parameters. The caller (App) routes to the Kickoff page with
   * `prefillRunId` set. Optional — when absent, the Restart button is hidden.
   */
  onRestart?: (sourceRunId: string) => void
}

function isTerminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'dead' || status === 'cancelled'
}

function isStoppable(status: string): boolean {
  return status === 'running' || status === 'paused-user' || status === 'paused-gate'
}

export default function RunControlCluster({ runId, run, onRestart }: RunControlClusterProps) {
  const [stopOpen, setStopOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const stopAnchor = useRef<HTMLButtonElement | null>(null)
  const restartAnchor = useRef<HTMLButtonElement | null>(null)

  // 4-second auto-clear for the inline error message (mirrors PauseResumeButton)
  useEffect(() => {
    if (!errorMsg) return
    const t = setTimeout(() => setErrorMsg(null), 4000)
    return () => clearTimeout(t)
  }, [errorMsg])

  // If the run hasn't hydrated yet, render nothing — avoids a flash of cluster
  // before we know the run's kind (and a wrong cluster for prereq runs).
  if (!run) return null

  // Prereq runs don't use any of these verbs — hide the cluster entirely.
  if (run.kind === 'prereq') return null

  const status = run.status
  const stopVisible = isStoppable(status)

  async function doStop() {
    if (pending) return
    setStopOpen(false)
    setPending(true)
    setErrorMsg(null)
    try {
      await api.stopRun(runId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to stop')
    } finally {
      setPending(false)
    }
  }

  function handleRestartClick() {
    if (!onRestart) return
    if (isTerminal(status)) {
      onRestart(runId)
      return
    }
    setRestartOpen(true)
  }

  async function doStopAndRestart() {
    setRestartOpen(false)
    if (pending) return
    setPending(true)
    setErrorMsg(null)
    try {
      await api.stopRun(runId)
      onRestart?.(runId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to stop')
    } finally {
      setPending(false)
    }
  }

  function doStartAlongside() {
    setRestartOpen(false)
    onRestart?.(runId)
  }

  return (
    <div className="run-control-cluster__wrap">
      <div className="run-control-cluster__row">
        <PauseResumeButton runId={runId} status={status} />

        {stopVisible && (
          <>
            <button
              ref={stopAnchor}
              type="button"
              className="run-control-cluster__btn run-control-cluster__btn--danger"
              onClick={() => setStopOpen((v) => !v)}
              disabled={pending}
              aria-label="Stop"
              title="Stop run"
            >
              <Icon name="stop" size={11} />
              Stop
            </button>
            <Popover anchor={stopAnchor} open={stopOpen} onClose={() => setStopOpen(false)}>
              <h3 className="popover-card__title">Stop run?</h3>
              <p className="popover-card__body">
                In-flight work will be lost. The transcript and workspace files are preserved.
              </p>
              <div className="popover-card__actions">
                <button type="button" className="popover-card__btn" onClick={() => setStopOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="popover-card__btn popover__btn--danger" onClick={doStop}>
                  Stop run
                </button>
              </div>
            </Popover>
          </>
        )}

        {onRestart && (
          <>
            <span className="run-control-cluster__div" />
            <button
              ref={restartAnchor}
              type="button"
              className="run-control-cluster__btn"
              onClick={handleRestartClick}
              disabled={pending}
              aria-label="Restart"
              title="Restart with these parameters"
            >
              <Icon name="refresh" size={11} />
              Restart
            </button>
            <Popover anchor={restartAnchor} open={restartOpen} onClose={() => setRestartOpen(false)}>
              <h3 className="popover-card__title">Restart from this run?</h3>
              <p className="popover-card__body">This run is still active. What would you like to do?</p>
              <div className="popover-card__actions popover__actions--stack">
                <button type="button" className="popover-card__btn popover__btn--primary" onClick={doStopAndRestart}>
                  Stop and restart
                </button>
                <button type="button" className="popover-card__btn" onClick={doStartAlongside}>
                  Start alongside
                </button>
                <button type="button" className="popover-card__btn" onClick={() => setRestartOpen(false)}>
                  Cancel
                </button>
              </div>
              <div className="popover-card__hint">"Start alongside" leaves this run running.</div>
            </Popover>
          </>
        )}
      </div>
      {errorMsg && (
        <div className="run-control-cluster__error" role="alert">
          {errorMsg}
        </div>
      )}
    </div>
  )
}
