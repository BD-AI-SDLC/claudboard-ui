import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'

let testDb: Database.Database
let testRepoDir: string
let projectId: string
let repoId: string

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({ broadcast: jest.fn() }))
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
  testRepoDir = join(tmpdir(), `bosch-repos-list-prereq-${randomUUID()}`)
  mkdirSync(testRepoDir, { recursive: true })

  projectId = randomUUID()
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

describe('Repo response endpoints carry hydrated prereq state', () => {
  it('GET /api/repos returns prereqs.analyse.state=done when the foundation artifact exists', async () => {
    const reportDir = join(testRepoDir, '.claude', 'reports')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'claudboard-analysis.md'), '# Analysis\n')

    const app = createApp()
    const res = await request(app).get('/api/repos').query({ projectId })

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(repoId)
    expect(res.body[0].prereqs).toBeDefined()
    expect(res.body[0].prereqs.analyse?.state).toBe('done')
  })

  it('GET /api/repos/:id returns prereqs equal to GET /api/repos/:id/prereqs', async () => {
    const reportDir = join(testRepoDir, '.claude', 'reports')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'claudboard-analysis.md'), '# Analysis\n')

    const app = createApp()
    const singleRes = await request(app).get(`/api/repos/${repoId}`)
    const prereqRes = await request(app).get(`/api/repos/${repoId}/prereqs`)

    expect(singleRes.status).toBe(200)
    expect(prereqRes.status).toBe(200)

    // The dedicated endpoint may mint fresh ids for any prereq without a cached
    // row, so we compare per-key on the state-shaped fields rather than deep-eq.
    const single = singleRes.body.prereqs as Record<string, { state: string; output: string | null }>
    const dedicated = prereqRes.body as Record<string, { state: string; output: string | null }>
    expect(Object.keys(single).sort()).toEqual(Object.keys(dedicated).sort())
    for (const key of Object.keys(single)) {
      expect(single[key]?.state).toBe(dedicated[key]?.state)
      expect(single[key]?.output).toBe(dedicated[key]?.output)
    }
  })

  it('GET /api/repos returns prereqs.analyse.state=missing for a repo with no foundation artifacts', async () => {
    const app = createApp()
    const res = await request(app).get('/api/repos').query({ projectId })

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].prereqs.analyse?.state).toBe('missing')
    // hydration ran — the field is populated, not empty
    expect(Object.keys(res.body[0].prereqs)).not.toEqual([])
  })

  it('GET /api/repos returns an empty list when the project has zero active repos', async () => {
    testDb.prepare("UPDATE repos SET status = 'detached' WHERE id = ?").run(repoId)

    const app = createApp()
    const res = await request(app).get('/api/repos').query({ projectId })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
