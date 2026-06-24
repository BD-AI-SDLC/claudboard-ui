/**
 * API tests for PUT /api/projects/active and GET /api/projects/active:
 *   - Updates the kv_settings singleton and bumps last_active_at
 *   - Returns 404 for an unknown project id
 *   - Returns 404 for a detached project
 *   - Returns null when no active project is set
 *   - Returns the active project record when set
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../ws-server.js', () => ({ broadcast: jest.fn(), subscribe: jest.fn().mockReturnValue(() => {}) }))
jest.unstable_mockModule('../db.js', () => ({ getDb: () => testDb }))
jest.unstable_mockModule('../run/event-log.js', () => ({
  appendEvent: jest.fn(),
  readEvents: jest.fn(() => []),
}))

const { createApp } = await import('../app.js')
import request from 'supertest'

function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL UNIQUE,
      name TEXT,
      topology TEXT,
      mark TEXT,
      last_active_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      topology TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE prereqs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES repos(id),
      cmd TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'missing',
      last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT,
      UNIQUE(project_id, cmd)
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES repos(id),
      kind TEXT NOT NULL DEFAULT 'feature',
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT, cost_cents INTEGER, input_tokens INTEGER,
      output_tokens INTEGER, autonomy TEXT NOT NULL DEFAULT 'balanced', error_message TEXT
    );
    CREATE TABLE gates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, snapshot TEXT
    );
    INSERT INTO kv_settings (key, value) VALUES ('active_project_id', NULL);
  `)
  return db
}

function insertProject(db: Database.Database, opts: {
  id?: string; root?: string; name?: string; topology?: string;
  mark?: string; status?: string
}): string {
  const id = opts.id ?? randomUUID()
  const root = opts.root ?? `/tmp/test-project-${id}`
  db.prepare(`
    INSERT INTO projects (id, root, name, topology, mark, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, root, opts.name ?? 'test-project', opts.topology ?? 'monolith', opts.mark ?? 'T', opts.status ?? 'active')
  return id
}

beforeEach(() => { testDb = buildTestDb() })
afterEach(() => { testDb.close() })

describe('GET /api/projects/active', () => {
  it('returns null when no active project is set', async () => {
    const app = createApp()
    const res = await request(app).get('/api/projects/active')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ activeProjectId: null, activeProject: null })
  })

  it('returns the active project when set', async () => {
    const id = insertProject(testDb, { name: 'my-project', topology: 'monolith', mark: 'M' })
    testDb.prepare("UPDATE kv_settings SET value = ? WHERE key = 'active_project_id'").run(id)

    const app = createApp()
    const res = await request(app).get('/api/projects/active')
    expect(res.status).toBe(200)
    expect(res.body.activeProjectId).toBe(id)
    expect(res.body.activeProject).toMatchObject({ id, name: 'my-project', topology: 'monolith' })
  })

  it('returns null and clears stale pointer when project is detached', async () => {
    const id = insertProject(testDb, { status: 'detached' })
    testDb.prepare("UPDATE kv_settings SET value = ? WHERE key = 'active_project_id'").run(id)

    const app = createApp()
    const res = await request(app).get('/api/projects/active')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ activeProjectId: null, activeProject: null })

    const row = testDb.prepare("SELECT value FROM kv_settings WHERE key = 'active_project_id'").get() as { value: string | null }
    expect(row.value).toBeNull()
  })
})

describe('PUT /api/projects/active', () => {
  it('sets the active project and bumps last_active_at', async () => {
    const id = insertProject(testDb, { name: 'target-project', topology: 'monolith' })

    const before = Date.now()
    const app = createApp()
    const res = await request(app)
      .put('/api/projects/active')
      .send({ projectId: id })

    expect(res.status).toBe(200)
    expect(res.body.activeProjectId).toBe(id)
    expect(res.body.activeProject).toMatchObject({ id, name: 'target-project' })

    const setting = testDb.prepare("SELECT value FROM kv_settings WHERE key = 'active_project_id'").get() as { value: string }
    expect(setting.value).toBe(id)

    const project = testDb.prepare('SELECT last_active_at FROM projects WHERE id = ?').get(id) as { last_active_at: string }
    expect(project.last_active_at).toBeTruthy()
    expect(new Date(project.last_active_at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('does not modify last_active_at of other projects', async () => {
    const id1 = insertProject(testDb, { name: 'p1' })
    const id2 = insertProject(testDb, { name: 'p2' })

    const app = createApp()
    await request(app).put('/api/projects/active').send({ projectId: id1 })

    const p2 = testDb.prepare('SELECT last_active_at FROM projects WHERE id = ?').get(id2) as { last_active_at: string | null }
    expect(p2.last_active_at).toBeNull()
  })

  it('returns 404 for an unknown project id', async () => {
    const app = createApp()
    const res = await request(app)
      .put('/api/projects/active')
      .send({ projectId: randomUUID() })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a detached project', async () => {
    const id = insertProject(testDb, { status: 'detached' })

    const app = createApp()
    const res = await request(app)
      .put('/api/projects/active')
      .send({ projectId: id })
    expect(res.status).toBe(404)
  })

  it('returns 400 when projectId is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .put('/api/projects/active')
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/projects/:id', () => {
  it('clears active_project_id singleton when the active project is detached', async () => {
    const id = insertProject(testDb, { name: 'active-project' })
    testDb.prepare("UPDATE kv_settings SET value = ? WHERE key = 'active_project_id'").run(id)

    const app = createApp()
    const res = await request(app).delete(`/api/projects/${id}`)
    expect(res.status).toBe(204)

    const setting = testDb.prepare("SELECT value FROM kv_settings WHERE key = 'active_project_id'").get() as { value: string | null }
    expect(setting.value).toBeNull()
  })
})
