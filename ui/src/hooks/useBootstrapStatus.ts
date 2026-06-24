import { useEffect, useState, useCallback, useRef } from 'react'
import type { BootstrapStatusResponse } from '@bosch-sdlc/protocol'
import { api } from '../api/client.js'

const POLL_INTERVAL_MS = 1500

interface UseBootstrapStatus {
  status: BootstrapStatusResponse
  retry: () => Promise<void>
}

/**
 * Polls /api/bootstrap/status until state is `ready` or `cli-missing` (terminal
 * from the UI's perspective — `cli-missing` requires the user to install
 * Claude Code outside the app, so polling will never see progress).
 *
 * Initial state is `installing` until the first fetch resolves; this prevents
 * a flash of mutating-actions-enabled on first paint.
 */
export function useBootstrapStatus(): UseBootstrapStatus {
  const [status, setStatus] = useState<BootstrapStatusResponse>({ state: 'installing' })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchOnce = useCallback(async () => {
    try {
      const next = await api.getBootstrapStatus()
      setStatus(next)
      return next
    } catch {
      // Server unreachable. Keep showing previous state; let the next tick retry.
      return null
    }
  }, [])

  useEffect(() => {
    let mounted = true

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    function startPolling() {
      stopPolling()
      intervalRef.current = setInterval(() => {
        void fetchOnce().then((s) => {
          if (!mounted) return
          if (s && (s.state === 'ready' || s.state === 'cli-missing')) {
            stopPolling()
          }
        })
      }, POLL_INTERVAL_MS)
    }

    void fetchOnce().then((s) => {
      if (!mounted) return
      if (s && s.state !== 'ready' && s.state !== 'cli-missing') {
        startPolling()
      }
    })

    return () => {
      mounted = false
      stopPolling()
    }
  }, [fetchOnce])

  const retry = useCallback(async () => {
    try {
      const next = await api.retryBootstrap()
      setStatus(next)
      // Restart polling so the UI follows the new install through to ready or
      // failure.
      if (next.state !== 'ready' && next.state !== 'cli-missing') {
        // Trigger the effect's polling logic again by calling fetchOnce in a
        // loop until terminal — the simpler approach is to just rely on the
        // existing setInterval if still active; otherwise kick a new one.
        const start = setInterval(async () => {
          const s = await fetchOnce()
          if (s && (s.state === 'ready' || s.state === 'cli-missing' || s.state === 'install-failed')) {
            clearInterval(start)
          }
        }, POLL_INTERVAL_MS)
      }
    } catch (err) {
      console.error('Bootstrap retry failed:', err)
    }
  }, [fetchOnce])

  return { status, retry }
}
