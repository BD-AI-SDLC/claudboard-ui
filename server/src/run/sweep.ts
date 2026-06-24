import { getDb } from '../db.js'

export function sweepDeadRuns() {
  const db = getDb()
  // 'cancelled' is intentionally absent — user-initiated terminal, must survive boot.
  // See change topbar-run-controls D4.
  const non_terminal = ['running', 'paused-gate', 'paused-user']
  const placeholders = non_terminal.map(() => '?').join(', ')
  const result = db.prepare(`
    UPDATE runs SET status='dead', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE status IN (${placeholders})
  `).run(...non_terminal)
  if (result.changes > 0) {
    console.info(`Boot sweep: marked ${result.changes} run(s) as dead`)
  }
}
