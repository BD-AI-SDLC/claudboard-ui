/**
 * Verifies DB migrations for bosch-sdlc:
 * 1. Additive runs.error_message migration (idempotent, tolerates pre-existing tables)
 * 2. Additive prereqs.stale_reason migration
 * 3. workspaces/projects → projects/repos rename migration (task 6.2)
 */

import Database from 'better-sqlite3'
import { runMigrations } from '../db.js'

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function getColumnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
}

function getTableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name)
}

describe('runs.error_message migration', () => {
  it('adds error_message on first run against an empty database', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(getColumnNames(db, 'runs')).toContain('error_message')
  })

  it('is idempotent — running migrations twice does not throw', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const errorMsgCols = getColumnNames(db, 'runs').filter((c) => c === 'error_message')
    expect(errorMsgCols).toHaveLength(1)
  })

  it('backfills error_message onto a runs table that pre-exists without it', () => {
    const db = makeInMemoryDb()
    // Simulate a new-schema pre-upgrade database with no error_message or autonomy
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, UNIQUE(project_id, cmd));
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES repos(id),
        kind TEXT NOT NULL DEFAULT 'feature',
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        target TEXT NOT NULL,
        transcript_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        cost_cents INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER
      );
      CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
      CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
    `)
    expect(getColumnNames(db, 'runs')).not.toContain('error_message')
    expect(getColumnNames(db, 'runs')).not.toContain('autonomy')

    runMigrations(db)
    expect(getColumnNames(db, 'runs')).toContain('error_message')
    expect(getColumnNames(db, 'runs')).toContain('autonomy')
  })
})

describe('prereqs.stale_reason migration', () => {
  it('adds stale_reason on first run against an empty database', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(getColumnNames(db, 'prereqs')).toContain('stale_reason')
  })

  it('is idempotent — running migrations twice does not throw and does not duplicate the column', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const matches = getColumnNames(db, 'prereqs').filter((c) => c === 'stale_reason')
    expect(matches).toHaveLength(1)
  })

  it('backfills stale_reason onto a prereqs table that pre-exists without it', () => {
    const db = makeInMemoryDb()
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, UNIQUE(project_id, cmd));
      CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), kind TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'running', prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER);
      CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
      CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
    `)
    expect(getColumnNames(db, 'prereqs')).not.toContain('stale_reason')

    runMigrations(db)
    expect(getColumnNames(db, 'prereqs')).toContain('stale_reason')
  })

  it('preserves existing rows when adding stale_reason — NULL for legacy data', () => {
    const db = makeInMemoryDb()
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, UNIQUE(project_id, cmd));
      CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), kind TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'running', prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER);
      CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
      CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO projects (id, root) VALUES ('p-1', '/tmp/ws');
      INSERT INTO repos (id, project_id, path, name, topology) VALUES ('r-1', 'p-1', '/tmp/p', 'p', 'monolith');
      INSERT INTO prereqs (id, project_id, cmd, state) VALUES ('pr-1', 'r-1', 'analyse', 'stale');
    `)

    runMigrations(db)
    const row = db.prepare('SELECT * FROM prereqs WHERE id = ?').get('pr-1') as { state: string; stale_reason: string | null }
    expect(row.state).toBe('stale')
    expect(row.stale_reason).toBeNull()
  })
})

// ── cost_usd column and phase_costs table ────────────────────────────────────
describe('phase_costs table and runs.cost_usd column migration', () => {
  it('creates phase_costs table with UNIQUE(run_id, phase_num) on a fresh db', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(getTableNames(db)).toContain('phase_costs')
    const cols = getColumnNames(db, 'phase_costs')
    expect(cols).toContain('run_id')
    expect(cols).toContain('phase_num')
    expect(cols).toContain('cost_usd')
    // Verify UNIQUE(run_id, phase_num) constraint via PRAGMA index_list
    type IndexRow = { seq: number; name: string; unique: number; origin: string; partial: number }
    const indexes = db.prepare("PRAGMA index_list('phase_costs')").all() as IndexRow[]
    const hasUnique = indexes.some(i => i.unique === 1 && i.origin === 'u')
    expect(hasUnique).toBe(true)
  })

  it('adds runs.cost_usd on a pre-existing db without it', () => {
    const db = makeInMemoryDb()
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, UNIQUE(project_id, cmd));
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES repos(id),
        kind TEXT NOT NULL DEFAULT 'feature',
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        target TEXT NOT NULL,
        transcript_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        cost_cents INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER
      );
      CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
      CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
    `)
    expect(getColumnNames(db, 'runs')).not.toContain('cost_usd')
    runMigrations(db)
    expect(getColumnNames(db, 'runs')).toContain('cost_usd')
    expect(getTableNames(db)).toContain('phase_costs')
  })

  it('is idempotent — running migrations twice does not throw or duplicate', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const matches = getColumnNames(db, 'runs').filter(c => c === 'cost_usd')
    expect(matches).toHaveLength(1)
  })
})

// ── Task 6.2: workspaces/projects → projects/repos migration round-trip ──────
describe('workspaces→projects / projects→repos migration', () => {
  function buildOldSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL UNIQUE,
        name TEXT,
        topology TEXT,
        mark TEXT,
        last_active_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        topology TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE prereqs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        cmd TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'missing',
        last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT,
        UNIQUE(project_id, cmd)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        kind TEXT NOT NULL DEFAULT 'feature',
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT,
        cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        autonomy TEXT NOT NULL DEFAULT 'balanced', error_message TEXT
      );
      CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE gates (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, snapshot TEXT
      );
      INSERT INTO kv_settings (key, value) VALUES ('active_workspace_id', 'ws-1');
    `)
  }

  it('migrates 2 workspaces + 3 projects to projects + repos preserving IDs', () => {
    const db = makeInMemoryDb()
    buildOldSchema(db)

    // Seed 2 workspaces and 3 projects
    db.exec(`
      INSERT INTO workspaces (id, root, name, topology, status) VALUES
        ('ws-1', '/tmp/ws-1', 'ws1', 'monolith', 'active'),
        ('ws-2', '/tmp/ws-2', 'ws2', 'multi-repo-workspace', 'active');
      INSERT INTO projects (id, workspace_id, path, name, topology, status) VALUES
        ('proj-1', 'ws-1', '/tmp/proj-1', 'proj1', 'monolith', 'active'),
        ('proj-2', 'ws-2', '/tmp/proj-2', 'proj2', 'monolith', 'active'),
        ('proj-3', 'ws-2', '/tmp/proj-3', 'proj3', 'monolith', 'active');
    `)

    runMigrations(db)

    const tables = getTableNames(db)
    expect(tables).toContain('projects')
    expect(tables).toContain('repos')
    expect(tables).not.toContain('workspaces')

    // projects table should have the 2 former workspaces
    const projects = db.prepare('SELECT id FROM projects ORDER BY id').all() as Array<{ id: string }>
    expect(projects.map(p => p.id)).toEqual(['ws-1', 'ws-2'])

    // repos table should have the 3 former projects with project_id populated
    const repos = db.prepare('SELECT id, project_id FROM repos ORDER BY id').all() as Array<{ id: string; project_id: string }>
    expect(repos).toHaveLength(3)
    expect(repos.find(r => r.id === 'proj-1')?.project_id).toBe('ws-1')
    expect(repos.find(r => r.id === 'proj-2')?.project_id).toBe('ws-2')
    expect(repos.find(r => r.id === 'proj-3')?.project_id).toBe('ws-2')
  })

  it('migrates kv_settings key active_workspace_id → active_project_id', () => {
    const db = makeInMemoryDb()
    buildOldSchema(db)
    db.exec(`INSERT INTO workspaces (id, root, name, topology, status) VALUES ('ws-1', '/tmp/ws-1', 'ws1', 'monolith', 'active')`)

    runMigrations(db)

    const row = db.prepare("SELECT value FROM kv_settings WHERE key = 'active_project_id'").get() as { value: string } | undefined
    expect(row?.value).toBe('ws-1')

    const oldRow = db.prepare("SELECT value FROM kv_settings WHERE key = 'active_workspace_id'").get()
    expect(oldRow).toBeUndefined()
  })

  it('is idempotent — running migrations twice on the new schema does not throw', () => {
    const db = makeInMemoryDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const tables = getTableNames(db)
    expect(tables).toContain('projects')
    expect(tables).toContain('repos')
    expect(tables).not.toContain('workspaces')
  })

  it('does not crash when migrating an old schema that pre-dates kv_settings', () => {
    // Regression: a stale compiled db.js created `workspaces` without `kv_settings`.
    // The next source-level run would `SELECT key FROM kv_settings` and throw
    // `SqliteError: no such table: kv_settings` before step 3 could create it.
    const db = makeInMemoryDb()
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, name TEXT, topology TEXT,
        mark TEXT, last_active_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO workspaces (id, root, name, topology, status)
        VALUES ('ws-1', '/tmp/ws-1', 'ws1', 'monolith', 'active');
    `)
    expect(getTableNames(db)).not.toContain('kv_settings')

    expect(() => runMigrations(db)).not.toThrow()

    const tables = getTableNames(db)
    expect(tables).toContain('projects')
    expect(tables).toContain('kv_settings')
    expect(tables).not.toContain('workspaces')
  })
})
