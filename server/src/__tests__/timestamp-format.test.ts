import Database from 'better-sqlite3'
import { runMigrations } from '../db.js'

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

describe('SQLite timestamp defaults', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('writes created_at as ISO 8601 UTC on runs INSERT', () => {
    db.prepare(`
      INSERT INTO projects (id, root, name, topology, mark, status)
      VALUES ('p1', '/tmp/proj', 'proj', 'multi-repo-workspace', 'P', 'active')
    `).run()
    db.prepare(`
      INSERT INTO repos (id, project_id, path, name, topology, status)
      VALUES ('r1', 'p1', '/tmp/proj/repo', 'repo', 'multi-repo-workspace', 'active')
    `).run()
    db.prepare(`
      INSERT INTO runs (id, project_id, kind, status, prompt, target, transcript_path)
      VALUES ('run1', 'r1', 'feature', 'running', 'do it', '/tmp', '/tmp/t.jsonl')
    `).run()

    const row = db.prepare('SELECT created_at FROM runs WHERE id = ?').get('run1') as { created_at: string }
    expect(row.created_at).toMatch(ISO_UTC_RE)
  })

  it('writes created_at as ISO 8601 UTC on projects INSERT', () => {
    db.prepare(`
      INSERT INTO projects (id, root, name, topology, mark, status)
      VALUES ('p2', '/tmp/proj2', 'proj2', 'multi-repo-workspace', 'Q', 'active')
    `).run()

    const row = db.prepare('SELECT created_at FROM projects WHERE id = ?').get('p2') as { created_at: string }
    expect(row.created_at).toMatch(ISO_UTC_RE)
  })

  it('writes created_at as ISO 8601 UTC on gates INSERT', () => {
    db.prepare(`
      INSERT INTO projects (id, root, name, topology, mark, status)
      VALUES ('p3', '/tmp/proj3', 'proj3', 'multi-repo-workspace', 'R', 'active')
    `).run()
    db.prepare(`
      INSERT INTO repos (id, project_id, path, name, topology, status)
      VALUES ('r3', 'p3', '/tmp/proj3/repo', 'repo', 'multi-repo-workspace', 'active')
    `).run()
    db.prepare(`
      INSERT INTO runs (id, project_id, kind, status, prompt, target, transcript_path)
      VALUES ('run3', 'r3', 'feature', 'running', 'do it', '/tmp', '/tmp/t3.jsonl')
    `).run()
    db.prepare(`
      INSERT INTO gates (id, run_id, kind, payload, status)
      VALUES ('g1', 'run3', 'spec+plan', '{}', 'open')
    `).run()

    const row = db.prepare('SELECT created_at FROM gates WHERE id = ?').get('g1') as { created_at: string }
    expect(row.created_at).toMatch(ISO_UTC_RE)
  })

  it('writes completed_at as ISO 8601 UTC via strftime UPDATE', () => {
    db.prepare(`
      INSERT INTO projects (id, root, name, topology, mark, status)
      VALUES ('p4', '/tmp/proj4', 'proj4', 'multi-repo-workspace', 'S', 'active')
    `).run()
    db.prepare(`
      INSERT INTO repos (id, project_id, path, name, topology, status)
      VALUES ('r4', 'p4', '/tmp/proj4/repo', 'repo', 'multi-repo-workspace', 'active')
    `).run()
    db.prepare(`
      INSERT INTO runs (id, project_id, kind, status, prompt, target, transcript_path)
      VALUES ('run4', 'r4', 'feature', 'running', 'do it', '/tmp', '/tmp/t4.jsonl')
    `).run()
    db.prepare("UPDATE runs SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run('run4')

    const row = db.prepare('SELECT completed_at FROM runs WHERE id = ?').get('run4') as { completed_at: string }
    expect(row.completed_at).toMatch(ISO_UTC_RE)
  })
})
