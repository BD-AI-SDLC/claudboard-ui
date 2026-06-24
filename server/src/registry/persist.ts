import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { getDb } from '../db.js'
import type { ClassifiedRepo } from './classifier.js'
import type { PrereqDetection } from './prereqs.js'

export function upsertProject(root: string, opts?: { name?: string; topology?: string; mark?: string }): string {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM projects WHERE root = ?').get(root) as { id: string } | undefined
  if (existing) {
    db.prepare("UPDATE projects SET status = 'active', name = COALESCE(?, name), topology = COALESCE(?, topology), mark = COALESCE(?, mark) WHERE id = ?").run(opts?.name ?? null, opts?.topology ?? null, opts?.mark ?? null, existing.id)
    return existing.id
  }
  const id = randomUUID()
  db.prepare("INSERT INTO projects (id, root, name, topology, mark, status) VALUES (?, ?, ?, ?, ?, 'active')").run(id, root, opts?.name ?? null, opts?.topology ?? null, opts?.mark ?? null)
  return id
}

export function upsertRepo(projectId: string, repo: ClassifiedRepo): string {
  const db = getDb()
  const name = basename(repo.path)
  const existing = db.prepare('SELECT id FROM repos WHERE path = ?').get(repo.path) as { id: string } | undefined
  if (existing) {
    db.prepare(`
      UPDATE repos SET project_id=?, name=?, topology=?, status='active' WHERE id=?
    `).run(projectId, name, repo.topology, existing.id)
    return existing.id
  }
  const id = randomUUID()
  db.prepare(`
    INSERT INTO repos (id, project_id, path, name, topology, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(id, projectId, repo.path, name, repo.topology)
  return id
}

export function upsertPrereqs(repoId: string, detections: PrereqDetection[]) {
  const db = getDb()
  for (const d of detections) {
    db.prepare(`
      INSERT INTO prereqs (id, project_id, cmd, state, output, stale_reason)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, cmd) DO UPDATE SET
        state=excluded.state,
        output=excluded.output,
        stale_reason=excluded.stale_reason
    `).run(randomUUID(), repoId, d.cmd, d.state, d.output, d.staleReason ?? null)
  }
}

/**
 * Stamp `last_run` (and `duration_ms` when computable) for a single prereq
 * row after a UI-triggered run completes.
 */
export function markPrereqRan(
  repoId: string,
  cmd: string,
  completedAtIso: string,
  durationMs: number | null,
) {
  const db = getDb()
  db.prepare(
    'UPDATE prereqs SET last_run=?, duration_ms=? WHERE project_id=? AND cmd=?',
  ).run(completedAtIso, durationMs, repoId, cmd)
}

export function detachMissingRepos(projectId: string, activePaths: Set<string>) {
  const db = getDb()
  const repos = db.prepare('SELECT id, path FROM repos WHERE project_id = ?').all(projectId) as Array<{ id: string; path: string }>
  for (const r of repos) {
    if (!activePaths.has(r.path)) {
      db.prepare("UPDATE repos SET status = 'detached' WHERE id = ?").run(r.id)
    }
  }
}
