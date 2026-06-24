import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const DATA_DIR = join(homedir(), '.bosch-sdlc')
const DB_PATH = join(DATA_DIR, 'state.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    mkdirSync(join(DATA_DIR, 'transcripts'), { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    runMigrations(_db)
  }
  return _db
}

export function runMigrations(db: Database.Database) {
  // ── Step 1: Detect current schema state ───────────────────────────────────
  const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name)
  const hasWorkspaces = tableNames.includes('workspaces')

  // ── Step 2: Migrate from old workspaces/projects schema if needed ─────────
  // Detect BEFORE running any CREATE TABLE IF NOT EXISTS to avoid false positives.
  if (hasWorkspaces) {
    // kv_settings is read below to migrate the active_workspace_id key. Ensure it
    // exists first — older schemas predate it, and step 3's create runs too late.
    db.exec(`CREATE TABLE IF NOT EXISTS kv_settings (key TEXT PRIMARY KEY, value TEXT)`)

    const hasOldProjects = tableNames.includes('projects')

    // Disable FK constraints so we can drop tables referenced by child tables.
    // PRAGMA foreign_keys must be set outside any transaction to take effect.
    db.pragma('foreign_keys = OFF')

    // Run each step individually (no transaction — acceptable for a local tool).
    // Guard each step so re-running is safe if a previous attempt partially failed.
    const tablesNow = () => (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name)

    if (!tablesNow().includes('projects_new')) {
      db.exec(`
        CREATE TABLE projects_new (
          id TEXT PRIMARY KEY,
          root TEXT NOT NULL UNIQUE,
          name TEXT,
          topology TEXT,
          mark TEXT,
          last_active_at TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )
      `)
      db.exec(`INSERT INTO projects_new SELECT id, root, name, topology, mark, last_active_at, status, created_at FROM workspaces`)
    }

    if (!tablesNow().includes('repos')) {
      db.exec(`
        CREATE TABLE repos (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          topology TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )
      `)
      if (hasOldProjects) {
        db.exec(`INSERT INTO repos SELECT id, workspace_id AS project_id, path, name, topology, status, created_at FROM projects`)
      }
    }

    // Drop old tables if they still exist
    if (tablesNow().includes('workspaces')) {
      db.exec(`DROP TABLE workspaces`)
    }
    if (hasOldProjects && tablesNow().includes('projects')) {
      db.exec(`DROP TABLE projects`)
    }

    // Rename projects_new → projects
    if (tablesNow().includes('projects_new')) {
      db.exec(`ALTER TABLE projects_new RENAME TO projects`)
    }

    // Migrate kv_settings key
    const kvRows = db.prepare("SELECT key FROM kv_settings").all() as Array<{ key: string }>
    if (kvRows.some(r => r.key === 'active_workspace_id')) {
      db.exec(`
        INSERT OR IGNORE INTO kv_settings (key, value)
          SELECT 'active_project_id', value FROM kv_settings WHERE key = 'active_workspace_id'
      `)
      db.exec(`DELETE FROM kv_settings WHERE key = 'active_workspace_id'`)
    }

    db.pragma('foreign_keys = ON')
  }

  // ── Step 3: Create tables for new installs (no-op if already migrated) ────
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL UNIQUE,
      name TEXT,
      topology TEXT,
      mark TEXT,
      last_active_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      topology TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS prereqs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES repos(id),
      cmd TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'missing',
      last_run TEXT,
      duration_ms INTEGER,
      cost_cents INTEGER,
      output TEXT,
      UNIQUE(project_id, cmd)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES repos(id),
      kind TEXT NOT NULL DEFAULT 'feature',
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL,
      target TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT,
      cost_cents INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      autonomy TEXT NOT NULL DEFAULT 'balanced',
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS kv_settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS gates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT,
      snapshot TEXT
    );

    CREATE TABLE IF NOT EXISTS phase_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id),
      phase_num INTEGER NOT NULL,
      phase_title TEXT NOT NULL,
      cost_usd REAL NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      api_calls INTEGER NOT NULL,
      model TEXT NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(run_id, phase_num)
    );
  `)

  // ── Step 4: Seed kv_settings singleton ────────────────────────────────────
  db.prepare("INSERT OR IGNORE INTO kv_settings (key, value) VALUES ('active_project_id', NULL)").run()

  // ── Step 5: Additive migrations for projects table columns ────────────────
  const projectCols = db
    .prepare("PRAGMA table_info('projects')")
    .all() as Array<{ name: string }>
  if (!projectCols.some((c) => c.name === 'name')) {
    db.exec('ALTER TABLE projects ADD COLUMN name TEXT')
  }
  if (!projectCols.some((c) => c.name === 'topology')) {
    db.exec('ALTER TABLE projects ADD COLUMN topology TEXT')
  }
  if (!projectCols.some((c) => c.name === 'mark')) {
    db.exec('ALTER TABLE projects ADD COLUMN mark TEXT')
  }
  if (!projectCols.some((c) => c.name === 'last_active_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN last_active_at TEXT')
  }

  // Backfill name for existing rows using Node basename() since SQLite lacks it
  const projectsWithoutName = db
    .prepare('SELECT id, root FROM projects WHERE name IS NULL')
    .all() as Array<{ id: string; root: string }>
  for (const p of projectsWithoutName) {
    const name = basename(p.root)
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, p.id)
  }

  // Backfill mark from name initial letter
  db.exec("UPDATE projects SET mark = upper(substr(name, 1, 1)) WHERE mark IS NULL AND name IS NOT NULL")

  // ── Step 6: Additive migrations for gates table ───────────────────────────
  const cols = db
    .prepare("PRAGMA table_info('gates')")
    .all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'snapshot')) {
    db.exec('ALTER TABLE gates ADD COLUMN snapshot TEXT')
  }

  // ── Step 7: Additive migrations for runs table ────────────────────────────
  const runCols = db
    .prepare("PRAGMA table_info('runs')")
    .all() as Array<{ name: string }>
  if (!runCols.some((c) => c.name === 'kind')) {
    db.exec("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'feature'")
  }
  if (!runCols.some((c) => c.name === 'autonomy')) {
    db.exec("ALTER TABLE runs ADD COLUMN autonomy TEXT NOT NULL DEFAULT 'balanced'")
  }
  if (!runCols.some((c) => c.name === 'error_message')) {
    db.exec('ALTER TABLE runs ADD COLUMN error_message TEXT')
  }
  if (!runCols.some((c) => c.name === 'cost_usd')) {
    db.exec('ALTER TABLE runs ADD COLUMN cost_usd REAL')
  }

  // ── Step 8: Additive migrations for prereqs table ─────────────────────────
  const prereqCols = db
    .prepare("PRAGMA table_info('prereqs')")
    .all() as Array<{ name: string }>
  if (!prereqCols.some((c) => c.name === 'stale_reason')) {
    db.exec('ALTER TABLE prereqs ADD COLUMN stale_reason TEXT')
  }

  // ── Step 9: Fix FK references that still point to old 'projects' table ────
  // After the workspace→project rename, prereqs and runs were created with
  // REFERENCES projects(id) where 'projects' meant individual repos. After the
  // rename, 'projects' is now the top-level project table, so inserts fail FK.
  type FkRow = { table: string; from: string }
  const prereqFks = db.prepare("PRAGMA foreign_key_list('prereqs')").all() as FkRow[]
  if (prereqFks.some((fk) => fk.from === 'project_id' && fk.table === 'projects')) {
    db.pragma('foreign_keys = OFF')
    db.exec(`
      CREATE TABLE prereqs_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES repos(id),
        cmd TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'missing',
        last_run TEXT,
        duration_ms INTEGER,
        cost_cents INTEGER,
        output TEXT,
        stale_reason TEXT,
        UNIQUE(project_id, cmd)
      )
    `)
    db.exec(`INSERT INTO prereqs_new SELECT id, project_id, cmd, state, last_run, duration_ms, cost_cents, output, stale_reason FROM prereqs`)
    db.exec(`DROP TABLE prereqs`)
    db.exec(`ALTER TABLE prereqs_new RENAME TO prereqs`)
    db.pragma('foreign_keys = ON')
  }

  const runFks = db.prepare("PRAGMA foreign_key_list('runs')").all() as FkRow[]
  if (runFks.some((fk) => fk.from === 'project_id' && fk.table === 'projects')) {
    db.pragma('foreign_keys = OFF')
    db.exec(`
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES repos(id),
        kind TEXT NOT NULL DEFAULT 'feature',
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        target TEXT NOT NULL,
        transcript_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        completed_at TEXT,
        cost_cents INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        autonomy TEXT NOT NULL DEFAULT 'balanced',
        error_message TEXT
      )
    `)
    db.exec(`INSERT INTO runs_new SELECT id, project_id, kind, status, prompt, target, transcript_path, created_at, completed_at, cost_cents, input_tokens, output_tokens, autonomy, error_message FROM runs`)
    db.exec(`DROP TABLE runs`)
    db.exec(`ALTER TABLE runs_new RENAME TO runs`)
    db.pragma('foreign_keys = ON')
  }
}
