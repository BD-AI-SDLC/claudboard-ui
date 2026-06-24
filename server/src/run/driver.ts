import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getDb } from '../db.js'
import { broadcast } from '../ws-server.js'
import { createBoschMcpServer } from '../gate/mcp-server.js'
import { getOpenGateForRun, resolveGateDeferred } from '../gate/deferred.js'
import type { GateResolution, WsEvent } from '@bosch-sdlc/protocol'

// Tracks which runs have a pause requested (before the iterator hits checkPause)
const pauseRequested = new Set<string>()
// Active pause deferreds — resolved by resumeRun()
const pauseDeferreds = new Map<string, { resolve: () => void }>()
// Per-run AbortController used by stopRun() to abort the SDK query. See change topbar-run-controls D2.
const runControllers = new Map<string, AbortController>()

export function setPausedUser(runId: string): boolean {
  if (pauseRequested.has(runId) || pauseDeferreds.has(runId)) return false
  pauseRequested.add(runId)
  return true
}

export function resumeRun(runId: string): boolean {
  const hadPending = pauseRequested.delete(runId)
  const d = pauseDeferreds.get(runId)
  if (d) {
    pauseDeferreds.delete(runId)
    d.resolve()
    return true
  }
  return hadPending
}

async function checkPause(runId: string) {
  if (!pauseRequested.has(runId)) return
  pauseRequested.delete(runId)
  await new Promise<void>((resolve) => {
    pauseDeferreds.set(runId, { resolve })
  })
  pauseDeferreds.delete(runId)
}

export async function runFeature(
  runId: string,
  target: string,
  prompt: string,
  model: string,
): Promise<void> {
  const db = getDb()
  const mcpServer = createBoschMcpServer(runId, db)
  const controller = new AbortController()
  runControllers.set(runId, controller)

  const transcriptRow = db.prepare('SELECT transcript_path FROM runs WHERE id = ?').get(runId) as { transcript_path: string }
  const transcriptPath = transcriptRow.transcript_path
  mkdirSync(dirname(transcriptPath), { recursive: true })

  try {
    console.info(`[run ${runId}] model=${model}`)
    // Dynamic import so the SDK is optional at module load time
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const messages = query({
      prompt,
      options: {
        cwd: target,
        model,
        mcpServers: { bosch: mcpServer },
        permissionMode: 'bypassPermissions',
        canUseTool: async (_toolName, input) => ({ behavior: 'allow' as const, updatedInput: input }),
        abortController: controller,
      },
    })

    for await (const message of messages) {
      await checkPause(runId)

      // persist to JSONL
      const line = JSON.stringify({ t: new Date().toISOString(), type: (message as { type?: string }).type ?? 'unknown', payload: message })
      appendFileSync(transcriptPath, line + '\n')

      // broadcast as transcript-message event
      const event: WsEvent = {
        run_id: runId,
        t: new Date().toISOString(),
        kind: 'transcript-message',
        payload: { message },
      }
      broadcast(runId, event)
    }

    // success
    db.prepare("UPDATE runs SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(runId)
    const doneEvent: WsEvent = { run_id: runId, t: new Date().toISOString(), kind: 'status-change', payload: { status: 'done' } }
    broadcast(runId, doneEvent)
  } catch (err) {
    // Discriminate user-initiated stop (silent) from genuine failure.
    // stopRun updates status='cancelled' BEFORE aborting the controller — see D1.
    if (controller.signal.aborted) {
      const cur = db.prepare('SELECT status FROM runs WHERE id=?').get(runId) as { status: string } | undefined
      if (cur?.status === 'cancelled') return
    }
    db.prepare("UPDATE runs SET status='failed', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(runId)
    const failEvent: WsEvent = { run_id: runId, t: new Date().toISOString(), kind: 'status-change', payload: { status: 'failed' } }
    broadcast(runId, failEvent)
    throw err
  } finally {
    runControllers.delete(runId)
  }
}

/**
 * stopRun — user-initiated terminal cancellation.
 *
 * Order of operations matters (see D1):
 *   1. Update run row to status='cancelled' FIRST so the runFeature outer-catch
 *      can discriminate user-stop from genuine failure via the persisted status.
 *   2. Cancel any open gate row + resolve its in-memory deferred so the agent's
 *      tool call returns rather than hanging.
 *   3. Resolve any pause deferred so a pending resume cannot fire post-cancel.
 *   4. Abort the AbortController — this unwinds the SDK for-await loop.
 *   5. Broadcast 'run-cancelled' then 'status-change'.
 */
export function stopRun(runId: string): { ok: boolean; reason?: string } {
  const db = getDb()
  const row = db.prepare('SELECT status, kind FROM runs WHERE id = ?').get(runId) as
    | { status: string; kind: string }
    | undefined
  if (!row) return { ok: false, reason: 'not-found' }
  if (row.kind === 'prereq') return { ok: false, reason: 'prereq-runs-cannot-be-stopped' }
  if (row.status === 'done' || row.status === 'failed' || row.status === 'dead' || row.status === 'cancelled') {
    return { ok: false, reason: `already-${row.status}` }
  }

  // (1) row update first — required for catch-discrimination ordering
  db.prepare("UPDATE runs SET status='cancelled', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(runId)

  // (2) cancel any open gate row + resolve its deferred so the agent's tool call returns
  const openGate = getOpenGateForRun(db, runId)
  if (openGate) {
    db.prepare("UPDATE gates SET status='cancelled', resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(openGate.id)
    // Kind-aware synthetic resolution so the awaiter unblocks. The SDK abort below
    // tears down the MCP server anyway; this just prevents a hung promise.
    const synthetic: GateResolution = openGate.kind === 'clarify'
      ? { skipped: true }
      : { result: 'rejected', changes: 'Run cancelled by user' }
    resolveGateDeferred(runId, openGate.id, synthetic)
  }

  // (3) resolve any pause deferred + clear the pause-requested flag
  const pauseDef = pauseDeferreds.get(runId)
  if (pauseDef) {
    pauseDeferreds.delete(runId)
    pauseDef.resolve()
  }
  pauseRequested.delete(runId)

  // (4) abort the controller — for-await loop unwinds
  const controller = runControllers.get(runId)
  if (controller) {
    controller.abort()
    runControllers.delete(runId)
  }

  // (5) broadcast 'run-cancelled' before 'status-change' so consumers
  //     subscribed to either order them deterministically.
  const t = new Date().toISOString()
  broadcast(runId, { run_id: runId, t, kind: 'run-cancelled', payload: { reason: 'user' } })
  broadcast(runId, { run_id: runId, t, kind: 'status-change', payload: { status: 'cancelled' } })

  return { ok: true }
}
