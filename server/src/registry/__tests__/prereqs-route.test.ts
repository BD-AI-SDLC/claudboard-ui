import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'

let testDb: Database.Database
let testRepoDir: string
let repoId: string

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({ broadcast: jest.fn(), subscribe: jest.fn().mockReturnValue(() => {}) }))
jest.unstable_mockModule('../../db.js', () => ({ getDb: () => testDb }))
jest.unstable_mockModule('../../run/event-log.js', () => ({
  appendEvent: jest.fn(),
  readEvents: jest.fn(() => []),
}))
jest.unstable_mockModule('../../prereq/cli-runner.js', () => ({
  runPrereqViaCli: jest.fn(() => Promise.resolve()),
  downgradeToFailed: jest.fn(),
  submitCliAnswer: jest.fn(() => ({ ok: true })),
}))

const { createApp } = await import('../../app.js')
const { __setStateForTest, __resetForTest } = await import('../../bootstrap/state.js')

function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
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
  testDb = buildTestDb()
  testRepoDir = join(tmpdir(), `bosch-prereq-test-${randomUUID()}`)
  mkdirSync(testRepoDir, { recursive: true })

  const projectId = randomUUID()
  repoId = randomUUID()
  testDb.prepare('INSERT INTO projects (id, root) VALUES (?, ?)').run(projectId, testRepoDir)
  testDb.prepare('INSERT INTO repos (id, project_id, path, name, topology) VALUES (?, ?, ?, ?, ?)').run(
    repoId, projectId, testRepoDir, 'test-repo', 'monolith',
  )

  __setStateForTest({ state: 'ready' })
})

afterEach(() => {
  __resetForTest()
  testDb.close()
  rmSync(testRepoDir, { recursive: true, force: true })
})

describe('GET /api/repos/:id/prereqs — live detection', () => {
  it('returns analyse.state=done when the analysis artifact exists, with no upsertPrereqs call needed', async () => {
    const reportDir = join(testRepoDir, '.claude', 'reports')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'claudboard-analysis.md'), '# Analysis\n')

    const app = createApp()
    const res = await request(app).get(`/api/repos/${repoId}/prereqs`)

    expect(res.status).toBe(200)
    expect(res.body['analyse'].state).toBe('done')
  })

  it('returns analyse.state=missing and output=null when the artifact is deleted out-of-band', async () => {
    const reportDir = join(testRepoDir, '.claude', 'reports')
    mkdirSync(reportDir, { recursive: true })
    const analysisFile = join(reportDir, 'claudboard-analysis.md')
    writeFileSync(analysisFile, '# Analysis\n')
    rmSync(analysisFile)

    const app = createApp()
    const res = await request(app).get(`/api/repos/${repoId}/prereqs`)

    expect(res.status).toBe(200)
    expect(res.body['analyse'].state).toBe('missing')
    expect(res.body['analyse'].output).toBeNull()
  })

  it('includes cached lastRun and duration from the prereqs table even though state is derived live', async () => {
    const cachedLastRun = '2024-06-01T12:00:00.000Z'
    const cachedDuration = 42000
    testDb.prepare(
      "INSERT INTO prereqs (id, project_id, cmd, state, last_run, duration_ms) VALUES (?, ?, 'analyse', 'done', ?, ?)",
    ).run(randomUUID(), repoId, cachedLastRun, cachedDuration)

    const app = createApp()
    const res = await request(app).get(`/api/repos/${repoId}/prereqs`)

    expect(res.status).toBe(200)
    expect(res.body['analyse'].lastRun).toBe(cachedLastRun)
    expect(res.body['analyse'].duration).toBe(cachedDuration)
    // state comes from live filesystem detection, not the cached 'done' value in DB
    expect(res.body['analyse'].state).toBe('missing')
  })
})
