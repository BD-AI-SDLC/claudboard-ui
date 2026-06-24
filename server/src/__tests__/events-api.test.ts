/**
 * Integration tests for:
 *   - GET /api/runs/:id/events  (task 2.2)
 *   - camelCase run response shape (task 3.4)
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

// ─── Shared mock state ────────────────────────────────────────────────────────
let testDb: Database.Database

const mockEventStore: Map<string, object[]> = new Map()

// ─── Mocks ───────────────────────────────────────────────────────────────────
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
  readEvents: jest.fn((runId: string) => mockEventStore.get(runId) ?? []),
}))

// ─── Dynamic imports ──────────────────────────────────────────────────────────
const { createApp } = await import('../app.js')
import request from 'supertest'

// ─── DB helpers ───────────────────────────────────────────────────────────────
function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS prereqs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id),
      cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing',
      last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT,
      stale_reason TEXT,
      UNIQUE(project_id, cmd)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id),
      kind TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL, target TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT, cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      autonomy TEXT NOT NULL DEFAULT 'balanced', error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS gates (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
      kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS kv_settings (key TEXT PRIMARY KEY, value TEXT);
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
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, phase_num)
    );
  `)
  return db
}

function insertProject(): string {
  const id = randomUUID()
  testDb.prepare("INSERT INTO projects (id, root) VALUES (?, ?)").run(id, `/tmp/proj-${id}`)
  return id
}

function insertRepo(projectId: string): string {
  const id = randomUUID()
  testDb.prepare(
    "INSERT INTO repos (id, project_id, path, name, topology) VALUES (?, ?, ?, 'test', 'monolith')"
  ).run(id, projectId, `/tmp/repo-${id}`)
  return id
}

function insertRun(repoId: string): string {
  const id = randomUUID()
  testDb.prepare(
    `INSERT INTO runs (id, project_id, status, prompt, target, transcript_path)
     VALUES (?, ?, 'running', 'test prompt', '/tmp/target', '/tmp/test.jsonl')`
  ).run(id, repoId)
  return id
}

// ─── Suite ───────────────────────────────────────────────────────────────────
describe('events API + camelCase', () => {
  beforeEach(() => {
    testDb = buildTestDb()
    mockEventStore.clear()
  })

  afterEach(() => {
    try { testDb.close() } catch { /* ignore */ }
  })

  // ── 2.2a known run returns ordered events ──────────────────────────────────
  it('2.2a GET /api/runs/:id/events returns ordered events for a known run', async () => {
    const app = createApp()
    const projectId = insertProject()
    const repoId = insertRepo(projectId)
    const runId = insertRun(repoId)

    const events = [
      { run_id: runId, t: '2026-05-01T10:00:00.000Z', kind: 'phase-start', payload: { num: 1, title: 'Plan' } },
      { run_id: runId, t: '2026-05-01T10:00:01.000Z', kind: 'agent-start', payload: { name: 'main', op: 'orchestrating' } },
    ]
    mockEventStore.set(runId, events)

    const res = await request(app).get(`/api/runs/${runId}/events`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].kind).toBe('phase-start')
    expect(res.body[1].kind).toBe('agent-start')
  })

  // ── 2.2b unknown run returns 404 ───────────────────────────────────────────
  it('2.2b GET /api/runs/:id/events returns 404 for unknown run', async () => {
    const app = createApp()
    const res = await request(app).get(`/api/runs/${randomUUID()}/events`)
    expect(res.status).toBe(404)
  })

  // ── 2.2c run with no events returns [] ────────────────────────────────────
  it('2.2c GET /api/runs/:id/events returns [] for a run with no events', async () => {
    const app = createApp()
    const projectId = insertProject()
    const repoId = insertRepo(projectId)
    const runId = insertRun(repoId)

    const res = await request(app).get(`/api/runs/${runId}/events`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  // ── 3.4 GET /runs/:id returns camelCase fields ────────────────────────────
  it('3.4a GET /api/runs/:id returns camelCase repoId and createdAt', async () => {
    const app = createApp()
    const projectId = insertProject()
    const repoId = insertRepo(projectId)
    const runId = insertRun(repoId)

    const res = await request(app).get(`/api/runs/${runId}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('repoId')
    expect(res.body).toHaveProperty('createdAt')
    expect(res.body).not.toHaveProperty('project_id')
    expect(res.body).not.toHaveProperty('projectId')
    expect(res.body).not.toHaveProperty('created_at')
    expect(res.body).not.toHaveProperty('transcript_path')
    expect(res.body).not.toHaveProperty('completed_at')
    expect(res.body).not.toHaveProperty('input_tokens')
    expect(res.body).not.toHaveProperty('output_tokens')
  })

  // ── 3.4 GET /runs?projectId= returns camelCase fields ─────────────────────
  it('3.4b GET /api/runs?projectId= returns camelCase repoId and createdAt', async () => {
    const app = createApp()
    const projectId = insertProject()
    const repoId = insertRepo(projectId)
    insertRun(repoId)

    const res = await request(app).get(`/api/runs?projectId=${projectId}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    const run = res.body[0]
    expect(run).toHaveProperty('repoId')
    expect(run).toHaveProperty('createdAt')
    expect(run).not.toHaveProperty('project_id')
    expect(run).not.toHaveProperty('projectId')
    expect(run).not.toHaveProperty('created_at')
    expect(run).not.toHaveProperty('transcript_path')
    expect(run).not.toHaveProperty('completed_at')
    expect(run).not.toHaveProperty('input_tokens')
    expect(run).not.toHaveProperty('output_tokens')
  })
})
