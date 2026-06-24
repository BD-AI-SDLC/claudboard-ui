import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database
let mockInstalled = true
let mockLaunchImpl: () => Promise<{ runId: string }> = async () => ({ runId: 'test-run' })

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
jest.unstable_mockModule('../skill-discovery.js', () => ({
  isClaudboardInstalled: () =>
    mockInstalled
      ? { installed: true }
      : { installed: false, installHint: 'Install the claudboard plugin' },
}))
jest.unstable_mockModule('../launcher.js', () => ({
  launchClaudboardRun: () => mockLaunchImpl(),
}))

const { createApp } = await import('../../app.js')
import request from 'supertest'

function seedRepo(db: Database.Database): { projectId: string; repoId: string } {
  const projectId = randomUUID()
  const repoId = randomUUID()
  db.prepare(`INSERT INTO projects (id, root, status) VALUES (?, ?, 'active')`).run(projectId, `/tmp/proj-${projectId}`)
  db.prepare(`INSERT INTO repos (id, project_id, path, name, topology, status) VALUES (?, ?, ?, 'repo', 'monolith', 'active')`).run(repoId, projectId, `/tmp/repo-${repoId}`)
  return { projectId, repoId }
}

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
  mockInstalled = true
  mockLaunchImpl = async () => ({ runId: 'test-run-id' })
})

describe('GET /api/claudboard/availability', () => {
  it('returns installed true when plugin exists', async () => {
    const app = createApp()
    const res = await request(app).get('/api/claudboard/availability')
    expect(res.status).toBe(200)
    expect(res.body.installed).toBe(true)
  })

  it('returns installed false with hint when plugin missing', async () => {
    mockInstalled = false
    const app = createApp()
    const res = await request(app).get('/api/claudboard/availability')
    expect(res.status).toBe(200)
    expect(res.body.installed).toBe(false)
    expect(typeof res.body.installHint).toBe('string')
  })
})

describe('POST /api/claudboard/run', () => {
  it('returns 201 with runId for valid analyse launch', async () => {
    const app = createApp()
    const { repoId } = seedRepo(testDb)
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'analyse',
      repoId,
      ecosystemLevel: false,
      acceptTopology: true,
    })
    expect(res.status).toBe(201)
    expect(typeof res.body.runId).toBe('string')
  })

  it('returns 400 when repoId is missing', async () => {
    const app = createApp()
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'analyse',
      ecosystemLevel: false,
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for unknown skill value', async () => {
    const app = createApp()
    const { repoId } = seedRepo(testDb)
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'unknown-skill',
      repoId,
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for workspace-init skill', async () => {
    const app = createApp()
    const { repoId } = seedRepo(testDb)
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'workspace-init',
      repoId,
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/CLI/)
  })

  it('returns 400 for workspace-link skill', async () => {
    const app = createApp()
    const { repoId } = seedRepo(testDb)
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'workspace-link',
      repoId,
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/CLI/)
  })

  it('returns 412 when plugin is not installed', async () => {
    mockInstalled = false
    const app = createApp()
    const { repoId } = seedRepo(testDb)
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'analyse',
      repoId,
      ecosystemLevel: false,
      acceptTopology: true,
    })
    expect(res.status).toBe(412)
    expect(res.body.error).toMatch(/not installed/)
  })

  it('returns 400 with Zod details when workflow skill is missing required fields', async () => {
    const app = createApp()
    const { repoId } = seedRepo(testDb)
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'workflow',
      repoId,
      tracker: 'jira',
      repo: 'github',
      // missing jira config
      github: { owner: 'myorg', repo: 'myrepo' },
    })
    expect(res.status).toBe(400)
    expect(res.body.details).toBeDefined()
  })

  it('returns 404 when repoId does not exist', async () => {
    const app = createApp()
    const res = await request(app).post('/api/claudboard/run').send({
      skill: 'analyse',
      repoId: randomUUID(),
      ecosystemLevel: false,
      acceptTopology: true,
    })
    expect(res.status).toBe(404)
  })
})
