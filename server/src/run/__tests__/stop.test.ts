/**
 * Tests for stopRun() — the user-initiated terminal cancellation primitive.
 *
 * stopRun's contract is a sequence of side-effects (DB updates + in-memory
 * deferred resolutions + AbortController.abort() + WS broadcasts). We mock
 * better-sqlite3 (in-memory), ws-server (broadcast spy), and the SDK (no-op
 * so module load doesn't try to import it).
 *
 * The for-await outer-catch discrimination is tested indirectly: after stopRun
 * has been called and updated the row to 'cancelled', a subsequent abort-driven
 * catch in runFeature must not emit a second 'status-change' to 'failed'.
 * That's covered by the cli-answer-routes.test.ts pattern (mocked SDK iterator
 * yielding nothing); kept out of this file to keep scope tight.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'

let testDb: Database.Database
const broadcastSpy = jest.fn()

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({
  broadcast: (...args: unknown[]) => broadcastSpy(...args),
}))

jest.unstable_mockModule('../../db.js', () => ({
  getDb: () => testDb,
}))

const { stopRun, setPausedUser } = await import('../driver.js')
const { createGateDeferred } = await import('../../gate/deferred.js')

function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      transcript_path TEXT,
      completed_at TEXT
    );
    CREATE TABLE gates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `)
  return db
}

function insertRun(id: string, status: string, kind = 'feature') {
  testDb.prepare("INSERT INTO runs (id, kind, status, transcript_path) VALUES (?, ?, ?, '/tmp/t.jsonl')").run(id, kind, status)
}

function insertGate(runId: string, gateId: string, kind = 'spec+plan') {
  testDb.prepare("INSERT INTO gates (id, run_id, kind, status, payload) VALUES (?, ?, ?, 'open', '{}')").run(gateId, runId, kind)
}

beforeEach(() => {
  testDb = buildTestDb()
  broadcastSpy.mockClear()
})

afterEach(() => {
  testDb.close()
})

describe('stopRun — happy paths', () => {
  test('stop a running feature run: row transitions to cancelled', () => {
    insertRun('r1', 'running')
    const result = stopRun('r1')
    expect(result).toEqual({ ok: true })
    const row = testDb.prepare('SELECT status, completed_at FROM runs WHERE id=?').get('r1') as { status: string; completed_at: string }
    expect(row.status).toBe('cancelled')
    expect(row.completed_at).toBeTruthy()
  })

  test('stop a paused-user run: row transitions to cancelled', () => {
    insertRun('r2', 'paused-user')
    const result = stopRun('r2')
    expect(result).toEqual({ ok: true })
    const row = testDb.prepare('SELECT status FROM runs WHERE id=?').get('r2') as { status: string }
    expect(row.status).toBe('cancelled')
  })

  test('stop a paused-gate run: open gate row transitions to cancelled with resolved_at', () => {
    insertRun('r3', 'paused-gate')
    insertGate('r3', 'g1', 'spec+plan')
    const result = stopRun('r3')
    expect(result).toEqual({ ok: true })
    const run = testDb.prepare('SELECT status FROM runs WHERE id=?').get('r3') as { status: string }
    expect(run.status).toBe('cancelled')
    const gate = testDb.prepare('SELECT status, resolved_at FROM gates WHERE id=?').get('g1') as { status: string; resolved_at: string }
    expect(gate.status).toBe('cancelled')
    expect(gate.resolved_at).toBeTruthy()
  })

  test('broadcasts run-cancelled BEFORE status-change', () => {
    insertRun('r4', 'running')
    stopRun('r4')
    const calls = broadcastSpy.mock.calls
    const kinds = calls.map(([, ev]: any[]) => (ev as { kind: string }).kind)
    expect(kinds).toContain('run-cancelled')
    expect(kinds).toContain('status-change')
    const cancelledIdx = kinds.indexOf('run-cancelled')
    const statusIdx = kinds.indexOf('status-change')
    expect(cancelledIdx).toBeLessThan(statusIdx)
    const statusEvent = calls[statusIdx]![1] as { payload: { status: string } }
    expect(statusEvent.payload.status).toBe('cancelled')
    const cancelEvent = calls[cancelledIdx]![1] as { payload: { reason: string } }
    expect(cancelEvent.payload.reason).toBe('user')
  })

  test('stop on paused-gate (clarify): synthetic resolution is { skipped: true }', async () => {
    insertRun('r5', 'paused-gate')
    insertGate('r5', 'g2', 'clarify')
    const gatePromise = createGateDeferred('r5', 'g2')
    stopRun('r5')
    await expect(gatePromise).resolves.toEqual({ skipped: true })
  })

  test('stop on paused-gate (spec+plan): synthetic resolution is rejected with reason', async () => {
    insertRun('r6', 'paused-gate')
    insertGate('r6', 'g3', 'spec+plan')
    const gatePromise = createGateDeferred('r6', 'g3')
    stopRun('r6')
    await expect(gatePromise).resolves.toMatchObject({ result: 'rejected', changes: 'Run cancelled by user' })
  })

  test('stop on paused-user resolves the pause deferred', () => {
    insertRun('r7', 'paused-user')
    setPausedUser('r7') // arms the deferred slot
    const result = stopRun('r7')
    expect(result).toEqual({ ok: true })
    // Re-arming should succeed because stop cleared both the deferred and the flag
    expect(setPausedUser('r7')).toBe(true)
  })
})

describe('stopRun — rejections', () => {
  test('non-existent run returns ok:false reason:not-found', () => {
    const result = stopRun('nope')
    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  test('prereq run returns ok:false reason:prereq-runs-cannot-be-stopped', () => {
    insertRun('p1', 'running', 'prereq')
    const result = stopRun('p1')
    expect(result).toEqual({ ok: false, reason: 'prereq-runs-cannot-be-stopped' })
    // Row unchanged
    const row = testDb.prepare('SELECT status FROM runs WHERE id=?').get('p1') as { status: string }
    expect(row.status).toBe('running')
    expect(broadcastSpy).not.toHaveBeenCalled()
  })

  test.each(['done', 'failed', 'dead', 'cancelled'])('terminal status %s returns ok:false reason:already-X', (status) => {
    insertRun('t-' + status, status)
    const result = stopRun('t-' + status)
    expect(result).toEqual({ ok: false, reason: `already-${status}` })
    // No DB mutation, no broadcast
    expect(broadcastSpy).not.toHaveBeenCalled()
  })
})
