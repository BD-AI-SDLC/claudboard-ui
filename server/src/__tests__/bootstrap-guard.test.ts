/**
 * Verifies that bootstrap-gated endpoints return 503 while bootstrap state is
 * not 'ready', while read-only endpoints and bootstrap-status endpoints remain
 * available.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'

let testDb: Database.Database

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../ws-server.js', () => ({
  broadcast: jest.fn(),
  subscribe: jest.fn().mockReturnValue(() => {}),
}))

jest.unstable_mockModule('../db.js', () => ({
  getDb: () => testDb,
}))

jest.unstable_mockModule('../run/event-log.js', () => ({
  appendEvent: jest.fn(),
  readEvents: jest.fn(() => []),
}))

const { createApp } = await import('../app.js')
const { __setStateForTest, __resetForTest } = await import('../bootstrap/state.js')
import request from 'supertest'

function buildTestDb(): Database.Database {
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
  testDb = buildTestDb()
  __resetForTest()
})

afterEach(() => {
  testDb.close()
})

describe('bootstrap guard', () => {
  it('POST /api/prereqs/:cmd returns 503 while state is installing', async () => {
    __setStateForTest({ state: 'installing' })
    const app = createApp()

    const res = await request(app)
      .post('/api/prereqs/analyse')
      .send({ target: '/tmp/anywhere' })

    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      error: expect.stringContaining('still setting up'),
      bootstrapState: 'installing',
    })
  })

  it('POST /api/runs returns 503 with cli-missing message when CLI absent', async () => {
    __setStateForTest({ state: 'cli-missing' })
    const app = createApp()

    const res = await request(app).post('/api/runs').send({
      target: '/tmp/anywhere',
      prompt: 'x',
      repoId: 'r1',
      autonomy: 'balanced',
    })

    expect(res.status).toBe(503)
    expect(res.body.bootstrapState).toBe('cli-missing')
    expect(res.body.error).toContain('claude.com/download')
  })

  it('POST /api/prereqs/:cmd returns 503 with stderr tail when install-failed', async () => {
    __setStateForTest({ state: 'install-failed', message: 'specific network error here' })
    const app = createApp()

    const res = await request(app)
      .post('/api/prereqs/analyse')
      .send({ target: '/tmp/anywhere' })

    expect(res.status).toBe(503)
    expect(res.body.bootstrapState).toBe('install-failed')
    expect(res.body.error).toBe('specific network error here')
  })

  it('GET /api/projects is not gated by bootstrap state', async () => {
    __setStateForTest({ state: 'installing' })
    const app = createApp()

    const res = await request(app).get('/api/projects')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /api/bootstrap/status is always available', async () => {
    __setStateForTest({ state: 'install-failed', message: 'something broke' })
    const app = createApp()

    const res = await request(app).get('/api/bootstrap/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ state: 'install-failed', message: 'something broke' })
  })

  it('lets through POST /api/prereqs/:cmd when state is ready (no 503)', async () => {
    __setStateForTest({ state: 'ready' })
    const app = createApp()

    // Will fail with 404 (no repo registered) but NOT 503
    const res = await request(app)
      .post('/api/prereqs/analyse')
      .send({ target: '/tmp/anywhere' })

    expect(res.status).not.toBe(503)
  })

  it('POST /api/bootstrap/retry returns 409 when state is ready', async () => {
    __setStateForTest({ state: 'ready' })
    const app = createApp()

    const res = await request(app).post('/api/bootstrap/retry')
    expect(res.status).toBe(409)
    expect(res.body.currentState).toBe('ready')
  })
})
