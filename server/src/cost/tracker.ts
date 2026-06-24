import type Database from 'better-sqlite3'
import { broadcast, subscribe } from '../ws-server.js'
import { resolveClaudboard } from './resolver.js'
import { computeCost, sessionJsonlPath } from './engine.js'
import type { CostJson } from './engine.js'

interface PhaseRecord {
  phaseNum: number
  phaseTitle: string
  startedAt: string
}

export interface TrackerOpts {
  computeFn?: (opts: Parameters<typeof computeCost>[0]) => Promise<CostJson | null>
}

let stopFn: (() => void) | null = null

export function startCostTracker(db: Database.Database, opts?: TrackerOpts): void {
  stopFn?.()
  stopFn = null

  const computeFn = opts?.computeFn ?? computeCost
  const install = resolveClaudboard()

  if (!install) {
    console.warn('cost-telemetry: claudboard plugin not detected; cost capture disabled')
    stopFn = subscribe(() => { /* no-op */ })
    return
  }

  const scriptPath = install.computeCostScript
  const sessionIds = new Map<string, string>()
  const phaseRecords = new Map<string, Map<number, PhaseRecord>>()

  stopFn = subscribe((event) => {
    if (event.kind === 'transcript-message') {
      const msg = event.payload.message as Record<string, unknown>
      if (
        msg?.['type'] === 'system' &&
        msg?.['subtype'] === 'init' &&
        typeof msg?.['session_id'] === 'string'
      ) {
        sessionIds.set(event.run_id, msg['session_id'] as string)
      }
      return
    }

    if (event.kind === 'phase-start') {
      if (!phaseRecords.has(event.run_id)) phaseRecords.set(event.run_id, new Map())
      phaseRecords.get(event.run_id)!.set(event.payload.num, {
        phaseNum: event.payload.num,
        phaseTitle: event.payload.title,
        startedAt: event.t,
      })
      return
    }

    if (event.kind === 'phase-complete') {
      const sessionId = sessionIds.get(event.run_id)
      if (!sessionId) return

      const phases = phaseRecords.get(event.run_id)
      const phase = phases?.get(event.payload.num)
      if (!phase) return

      const completedAt = event.t
      const runRow = db
        .prepare('SELECT target FROM runs WHERE id = ?')
        .get(event.run_id) as { target: string } | undefined
      if (!runRow) return

      const jsonlPath = sessionJsonlPath(runRow.target, sessionId)
      const runId = event.run_id

      void (async () => {
        const cost = await computeFn({ scriptPath, sessionJsonl: jsonlPath, since: phase.startedAt, until: completedAt })
        if (!cost) return

        try {
          db.prepare(`
            INSERT INTO phase_costs
              (run_id, phase_num, phase_title, cost_usd, input_tokens, output_tokens, cache_read_tokens, api_calls, model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(runId, phase.phaseNum, phase.phaseTitle, cost.costUsd, cost.inputTokens, cost.outputTokens, cost.cacheReadTokens, cost.apiCalls, cost.model)
        } catch { /* UNIQUE conflict — already computed */ }

        broadcast(runId, {
          run_id: runId,
          t: new Date().toISOString(),
          kind: 'cost-update',
          payload: {
            scope: 'phase',
            phaseNum: phase.phaseNum,
            phaseTitle: phase.phaseTitle,
            costUsd: cost.costUsd,
            inputTokens: cost.inputTokens,
            outputTokens: cost.outputTokens,
            cacheReadTokens: cost.cacheReadTokens,
            apiCalls: cost.apiCalls,
            model: cost.model,
          },
        })
      })()
      return
    }

    if (
      event.kind === 'status-change' &&
      (event.payload.status === 'done' || event.payload.status === 'failed' || event.payload.status === 'cancelled')
    ) {
      const sessionId = sessionIds.get(event.run_id)
      if (!sessionId) return

      const runRow = db
        .prepare('SELECT target, created_at FROM runs WHERE id = ?')
        .get(event.run_id) as { target: string; created_at: string } | undefined
      if (!runRow) return

      const jsonlPath = sessionJsonlPath(runRow.target, sessionId)
      const runId = event.run_id
      const since = runRow.created_at

      void (async () => {
        const cost = await computeFn({ scriptPath, sessionJsonl: jsonlPath, since })
        if (!cost) return

        db.prepare('UPDATE runs SET cost_usd = ?, input_tokens = ?, output_tokens = ? WHERE id = ?')
          .run(cost.costUsd, cost.inputTokens, cost.outputTokens, runId)

        broadcast(runId, {
          run_id: runId,
          t: new Date().toISOString(),
          kind: 'cost-update',
          payload: {
            scope: 'total',
            costUsd: cost.costUsd,
            inputTokens: cost.inputTokens,
            outputTokens: cost.outputTokens,
            cacheReadTokens: cost.cacheReadTokens,
            apiCalls: cost.apiCalls,
            model: cost.model,
          },
        })
      })()
    }
  })
}

export function stopCostTracker(): void {
  stopFn?.()
  stopFn = null
}
