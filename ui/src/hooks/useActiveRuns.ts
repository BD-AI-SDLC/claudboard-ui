import { useEffect, useRef, useState } from 'react'
import type { Run } from '@bosch-sdlc/protocol'
import { api } from '../api/client.js'

const POLL_INTERVAL_MS = 2000

function deriveActive(runs: Run[]): Run[] {
  return runs
    .filter((r) => r.status === 'running')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function useActiveRuns(projectId: string): {
  activeRuns: Run[]
  hasActive: boolean
  primary: Run | null
} {
  const [activeRuns, setActiveRuns] = useState<Run[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    function fetchAndSet() {
      api.getRuns(projectId).then((runs) => {
        setActiveRuns(deriveActive(runs))
      }).catch(() => {})
    }

    function startInterval() {
      if (intervalRef.current != null) return
      intervalRef.current = setInterval(() => {
        if (document.visibilityState !== 'hidden') fetchAndSet()
      }, POLL_INTERVAL_MS)
    }

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        if (intervalRef.current != null) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      } else {
        startInterval()
      }
    }

    fetchAndSet()
    startInterval()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [projectId])

  const hasActive = activeRuns.length > 0
  const primary: Run | null = hasActive ? (activeRuns[0] ?? null) : null

  return { activeRuns, hasActive, primary }
}
