/**
 * Verifies that sweepDeadRuns() does NOT touch rows with status='cancelled'.
 *
 * 'cancelled' is intentionally absent from the non_terminal list — a cancelled
 * run is user-initiated terminal and must survive boot, alongside 'done' and
 * 'failed'. See change topbar-run-controls Design D4.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'

let testDb: Database.Database

jest.unstable_mockModule('../db.js', () => ({
  getDb: () => testDb,
}))

const { sweepDeadRuns } = await import('../run/sweep.js')

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT
    );
  `)
})

afterEach(() => {
  testDb.close()
})

describe('sweepDeadRuns — cancelled runs survive boot', () => {
  test('cancelled row is NOT transitioned to dead', () => {
    testDb.prepare("INSERT INTO runs (id, status, completed_at) VALUES ('c1', 'cancelled', '2026-05-29T00:00:00Z')").run()
    sweepDeadRuns()
    const row = testDb.prepare('SELECT status, completed_at FROM runs WHERE id=?').get('c1') as { status: string; completed_at: string }
    expect(row.status).toBe('cancelled')
    expect(row.completed_at).toBe('2026-05-29T00:00:00Z')
  })

  test('running / paused-gate / paused-user rows ARE transitioned to dead (regression guard)', () => {
    testDb.prepare("INSERT INTO runs (id, status) VALUES ('r1', 'running')").run()
    testDb.prepare("INSERT INTO runs (id, status) VALUES ('pg', 'paused-gate')").run()
    testDb.prepare("INSERT INTO runs (id, status) VALUES ('pu', 'paused-user')").run()
    sweepDeadRuns()
    const rows = testDb.prepare('SELECT id, status FROM runs ORDER BY id').all() as { id: string; status: string }[]
    expect(rows).toEqual([
      { id: 'pg', status: 'dead' },
      { id: 'pu', status: 'dead' },
      { id: 'r1', status: 'dead' },
    ])
  })

  test('cancelled and dead-target rows coexist after sweep', () => {
    testDb.prepare("INSERT INTO runs (id, status) VALUES ('c1', 'cancelled')").run()
    testDb.prepare("INSERT INTO runs (id, status) VALUES ('r1', 'running')").run()
    sweepDeadRuns()
    const c = testDb.prepare('SELECT status FROM runs WHERE id=?').get('c1') as { status: string }
    const r = testDb.prepare('SELECT status FROM runs WHERE id=?').get('r1') as { status: string }
    expect(c.status).toBe('cancelled')
    expect(r.status).toBe('dead')
  })
})
