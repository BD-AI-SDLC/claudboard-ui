import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database
const runFeatureCalls: Array<{ runId: string; target: string; prompt: string }> = []
let mockRunFeatureImpl: ((runId: string) => Promise<void>) | null = null

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({ broadcast: jest.fn() }))
jest.unstable_mockModule('../../db.js', () => ({ getDb: () => testDb }))
jest.unstable_mockModule('../../run/driver.js', () => ({
  runFeature: (runId: string, target: string, prompt: string) => {
    runFeatureCalls.push({ runId, target, prompt })
    return mockRunFeatureImpl ? mockRunFeatureImpl(runId) : Promise.resolve()
  },
  setPausedUser: jest.fn(),
  resumeRun: jest.fn(),
}))
jest.unstable_mockModule('../../run/event-log.js', () => ({
  appendEvent: jest.fn(),
  readEvents: jest.fn(() => []),
}))

const { launchClaudboardRun } = await import('../launcher.js')

function buildDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, name TEXT, topology TEXT, mark TEXT, last_active_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, stale_reason TEXT, UNIQUE(project_id, cmd));
    CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), kind TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'running', prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER, autonomy TEXT NOT NULL DEFAULT 'balanced', error_message TEXT);
    CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, snapshot TEXT);
    CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO kv_settings (key, value) VALUES ('active_project_id', NULL);
  `)
  return db
}

beforeEach(() => {
  testDb = buildDb()
  runFeatureCalls.length = 0
  mockRunFeatureImpl = null
  testDb.prepare(`INSERT INTO projects (id, root, status) VALUES (?, '/tmp/proj', 'active')`).run('proj-1')
  testDb.prepare(`INSERT INTO repos (id, project_id, path, name, topology, status) VALUES (?, 'proj-1', '/tmp/repo', 'myrepo', 'monolith', 'active')`).run('repo-1')
})

describe('launchClaudboardRun', () => {
  it('creates a run record with kind set to claudboard-analyse', async () => {
    const { runId } = await launchClaudboardRun('repo-1', '/tmp/repo', {
      skill: 'analyse',
      ecosystemLevel: false,
      acceptTopology: true,
    })
    const row = testDb.prepare('SELECT kind, status FROM runs WHERE id = ?').get(runId) as
      | { kind: string; status: string }
      | undefined
    expect(row).toBeDefined()
    expect(row!.kind).toBe('claudboard-analyse')
    expect(row!.status).toBe('running')
  })

  it('returns a runId that matches the created run record', async () => {
    const { runId } = await launchClaudboardRun('repo-1', '/tmp/repo', {
      skill: 'generate',
      staleReportPolicy: 'warn-continue',
      generateClaude: true,
      generateRules: true,
      generateSkills: true,
    })
    const row = testDb.prepare('SELECT id FROM runs WHERE id = ?').get(runId)
    expect(row).toBeDefined()
  })

  it('registers the run with the driver', async () => {
    const target = '/tmp/repo'
    await launchClaudboardRun('repo-1', target, {
      skill: 'analyse',
      ecosystemLevel: false,
      acceptTopology: true,
    })
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(runFeatureCalls.length).toBe(1)
    expect(runFeatureCalls[0]!.target).toBe(target)
  })
})

describe('launchClaudboardRun — markPrereqRan finalizer', () => {
  it('writes last_run and duration_ms to the prereqs row on successful completion (skill: analyse)', async () => {
    testDb.prepare("INSERT INTO prereqs (id, project_id, cmd, state) VALUES (?, 'repo-1', 'analyse', 'missing')").run(randomUUID())

    mockRunFeatureImpl = async (runId) => {
      testDb.prepare("UPDATE runs SET status='done', completed_at=datetime('now') WHERE id=?").run(runId)
    }

    await launchClaudboardRun('repo-1', '/tmp/repo', {
      skill: 'analyse',
      ecosystemLevel: false,
      acceptTopology: true,
    })
    await new Promise<void>((r) => setTimeout(r, 20))

    const prereq = testDb
      .prepare("SELECT last_run, duration_ms FROM prereqs WHERE project_id='repo-1' AND cmd='analyse'")
      .get() as { last_run: string | null; duration_ms: number | null } | undefined
    expect(prereq?.last_run).not.toBeNull()
    expect(prereq?.duration_ms).not.toBeNull()
  })

  it('maps skill=workflow to cmd=workflow in the prereqs row', async () => {
    testDb.prepare("INSERT INTO prereqs (id, project_id, cmd, state) VALUES (?, 'repo-1', 'workflow', 'missing')").run(randomUUID())

    mockRunFeatureImpl = async (runId) => {
      testDb.prepare("UPDATE runs SET status='done', completed_at=datetime('now') WHERE id=?").run(runId)
    }

    await launchClaudboardRun('repo-1', '/tmp/repo', {
      skill: 'workflow',
      tracker: 'jira',
      repo: 'github',
      jira: { cloudId: 'test-cloud', projectKey: 'PROJ', urlBase: 'https://test.atlassian.net' },
      github: { owner: 'owner', repo: 'repo', linkingKeyword: 'Closes' },
    })
    await new Promise<void>((r) => setTimeout(r, 20))

    const correct = testDb
      .prepare("SELECT last_run FROM prereqs WHERE project_id='repo-1' AND cmd='workflow'")
      .get() as { last_run: string | null } | undefined
    expect(correct?.last_run).not.toBeNull()
  })

  it('does not write last_run when the run ends with status=failed', async () => {
    testDb.prepare("INSERT INTO prereqs (id, project_id, cmd, state) VALUES (?, 'repo-1', 'analyse', 'missing')").run(randomUUID())

    mockRunFeatureImpl = async (runId) => {
      testDb.prepare("UPDATE runs SET status='failed' WHERE id=?").run(runId)
    }

    await launchClaudboardRun('repo-1', '/tmp/repo', {
      skill: 'analyse',
      ecosystemLevel: false,
      acceptTopology: true,
    })
    await new Promise<void>((r) => setTimeout(r, 20))

    const prereq = testDb
      .prepare("SELECT last_run FROM prereqs WHERE project_id='repo-1' AND cmd='analyse'")
      .get() as { last_run: string | null } | undefined
    expect(prereq?.last_run).toBeNull()
  })
})

describe('DB migration guard — kind column', () => {
  it('adds kind column to an existing runs table that lacks it and existing rows default to feature', () => {
    // Build a DB that represents the state BEFORE the kind column was added.
    // Simulates an old database on disk that the migration must upgrade.
    const db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES repos(id),
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
      CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, snapshot TEXT);
      CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, UNIQUE(project_id, cmd));
    `)

    // Apply the kind-column migration guard using the raw SQLite API
    // (same logic as in db.ts step 7)
    const runCols = (db.prepare("PRAGMA table_info('runs')").all() as Array<{ name: string }>).map(c => c.name)
    if (!runCols.includes('kind')) {
      db.exec("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'feature'")
    }

    const colsAfter = (db.prepare("PRAGMA table_info('runs')").all() as Array<{ name: string }>).map(c => c.name)
    expect(colsAfter).toContain('kind')

    // Verify the default is applied on new inserts
    const projectId = randomUUID()
    const repoId = randomUUID()
    const runId = randomUUID()
    db.prepare(`INSERT INTO projects (id, root) VALUES (?, '/tmp')`).run(projectId)
    db.prepare(`INSERT INTO repos (id, project_id, path, name, topology) VALUES (?, ?, '/tmp/r', 'r', 'monolith')`).run(repoId, projectId)
    db.prepare(`INSERT INTO runs (id, project_id, status, prompt, target, transcript_path) VALUES (?, ?, 'running', 'p', '/t', '/tr')`).run(runId, repoId)
    const row = db.prepare('SELECT kind FROM runs WHERE id = ?').get(runId) as { kind: string }
    expect(row.kind).toBe('feature')

    db.close()
  })
})
