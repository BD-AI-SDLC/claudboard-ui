import { useEffect, useRef, useState } from 'react'
import type { WsEvent } from '@bosch-sdlc/protocol'
import { api } from '../api/client.js'

function eventKey(ev: WsEvent): string {
  return `${ev.kind}|${ev.t}|${JSON.stringify(ev.payload)}`
}

export function useRunStream(runId: string | null) {
  const [events, setEvents] = useState<WsEvent[]>([])
  const [hydrated, setHydrated] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!runId) return

    let cancelled = false
    seenRef.current = new Set()
    setEvents([])
    setHydrated(false)

    api.getRunEvents(runId).then((history) => {
      if (cancelled) return
      const seen = seenRef.current
      const unique: WsEvent[] = []
      for (const ev of history) {
        const k = eventKey(ev)
        if (!seen.has(k)) {
          seen.add(k)
          unique.push(ev)
        }
      }
      setEvents(unique)
      setHydrated(true)

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/api/runs/${runId}/stream`)
      wsRef.current = ws

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const event = JSON.parse(e.data) as WsEvent
          const k = eventKey(event)
          if (!seen.has(k)) {
            seen.add(k)
            setEvents((prev) => [...prev, event])
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsRef.current = null
      }
    }).catch(() => {
      if (cancelled) return
      setHydrated(true)

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/api/runs/${runId}/stream`)
      wsRef.current = ws

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const event = JSON.parse(e.data) as WsEvent
          const k = eventKey(event)
          const seen = seenRef.current
          if (!seen.has(k)) {
            seen.add(k)
            setEvents((prev) => [...prev, event])
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsRef.current = null
      }
    })

    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  }, [runId])

  return { events, hydrated }
}
