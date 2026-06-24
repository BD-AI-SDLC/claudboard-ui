import type { GateResolution } from '@bosch-sdlc/protocol'

// Map of runId+gateId → resolve function
const deferreds = new Map<string, (result: GateResolution) => void>()

function deferredKey(runId: string, gateId: string) {
  return `${runId}:${gateId}`
}

export function createGateDeferred(runId: string, gateId: string): Promise<GateResolution> {
  return new Promise((resolve) => {
    deferreds.set(deferredKey(runId, gateId), resolve)
  })
}

export function resolveGateDeferred(runId: string, gateId: string, result: GateResolution): boolean {
  const key = deferredKey(runId, gateId)
  const resolve = deferreds.get(key)
  if (!resolve) return false
  deferreds.delete(key)
  resolve(result)
  return true
}

export function hasOpenGate(runId: string, gateId: string): boolean {
  return deferreds.has(deferredKey(runId, gateId))
}

export function getOpenGateForRun(
  db: import('better-sqlite3').Database,
  runId: string,
): { id: string; kind: string; payload: string } | null {
  const gate = db
    .prepare(
      "SELECT id, kind, payload FROM gates WHERE run_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    )
    .get(runId) as { id: string; kind: string; payload: string } | null
  return gate
}
