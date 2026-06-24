/**
 * Tests for gate resolve route validation and the new live file re-read route.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let testDb: Database.Database

jest.unstable_mockModule('../../ws-server.js', () => ({
  broadcast: jest.fn(),
  subscribe: jest.fn().mockReturnValue(() => {}),
}))

jest.unstable_mockModule('../../db.js', () => ({
  getDb: () => testDb,
}))

const { createApp } = await import('../../app.js')
import request from 'supertest'

function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS prereqs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT,
      duration_ms INTEGER, cost_cents INTEGER, output TEXT, stale_reason TEXT,
      UNIQUE(project_id, cmd)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      kind TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT,
      cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER
    );
    CREATE TABLE IF NOT EXISTS gates (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
      kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
      snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
    );
  `)
  return db
}

function insertRun(): string {
  const wsId = randomUUID()
  const pId = randomUUID()
  const rId = randomUUID()
  testDb.prepare("INSERT INTO workspaces (id, root) VALUES (?, ?)").run(wsId, `/tmp/ws-${wsId}`)
  testDb.prepare("INSERT INTO projects (id, workspace_id, path, name, topology) VALUES (?, ?, ?, 'test', 'monolith')").run(pId, wsId, `/tmp/ws-${wsId}`)
  testDb.prepare("INSERT INTO runs (id, project_id, status, prompt, target, transcript_path) VALUES (?, ?, 'paused-gate', 'test', '/tmp', '/tmp/t.jsonl')").run(rId, pId)
  return rId
}

function insertGate(runId: string, kind = 'spec+plan'): string {
  const id = randomUUID()
  testDb.prepare("INSERT INTO gates (id, run_id, kind, payload) VALUES (?, ?, ?, '{}')").run(id, runId, kind)
  return id
}

function insertGateWithSnapshot(
  runId: string,
  payload: object,
  snapshot: object,
): string {
  const id = randomUUID()
  testDb.prepare(
    "INSERT INTO gates (id, run_id, kind, payload, snapshot) VALUES (?, ?, 'spec+plan', ?, ?)",
  ).run(id, runId, JSON.stringify(payload), JSON.stringify(snapshot))
  return id
}

const tempDirs: string[] = []

function makeTempWorkspace(): string {
  const dir = join(tmpdir(), `bosch-routes-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

describe('gate resolve route validation', () => {
  beforeEach(() => { testDb = buildTestDb() })
  afterEach(() => { try { testDb.close() } catch { /* ignore */ } })

  it('approval body resolves (200 or 409 if no live deferred)', async () => {
    const app = createApp()
    const runId = insertRun()
    const gateId = insertGate(runId, 'spec+plan')

    const res = await request(app)
      .post(`/api/runs/${runId}/gate/${gateId}/resolve`)
      .send({ result: 'approved' })

    expect([200, 409]).toContain(res.status)
  })

  it('clarify-answers body resolves (200 or 409 if no live deferred)', async () => {
    const app = createApp()
    const runId = insertRun()
    const gateId = insertGate(runId, 'clarify')

    const res = await request(app)
      .post(`/api/runs/${runId}/gate/${gateId}/resolve`)
      .send({ answers: ['answer 1', '', 'answer 3'] })

    expect([200, 409]).toContain(res.status)
  })

  it('skip body resolves (200 or 409 if no live deferred)', async () => {
    const app = createApp()
    const runId = insertRun()
    const gateId = insertGate(runId, 'clarify')

    const res = await request(app)
      .post(`/api/runs/${runId}/gate/${gateId}/resolve`)
      .send({ skipped: true })

    expect([200, 409]).toContain(res.status)
  })

  it('malformed body returns 400', async () => {
    const app = createApp()
    const runId = insertRun()
    const gateId = insertGate(runId)

    const res = await request(app)
      .post(`/api/runs/${runId}/gate/${gateId}/resolve`)
      .send({ foo: 'bar' })

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('old result=rejected with changes body still resolves (200 or 409)', async () => {
    const app = createApp()
    const runId = insertRun()
    const gateId = insertGate(runId, 'spec+plan')

    const res = await request(app)
      .post(`/api/runs/${runId}/gate/${gateId}/resolve`)
      .send({ result: 'rejected', changes: 'Add more tests' })

    expect([200, 409]).toContain(res.status)
  })
})

describe('GET /gates/:gateId/files/:fileIndex', () => {
  beforeEach(() => { testDb = buildTestDb() })
  afterEach(() => {
    try { testDb.close() } catch { /* ignore */ }
    for (const dir of tempDirs.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  it('returns 404 when gate does not exist', async () => {
    const app = createApp()
    const res = await request(app).get(`/api/gates/${randomUUID()}/files/0`)
    expect(res.status).toBe(404)
  })

  it('returns 404 when gate is not spec+plan', async () => {
    const app = createApp()
    const runId = insertRun()
    const gateId = insertGate(runId, 'clarify')
    const res = await request(app).get(`/api/gates/${gateId}/files/0`)
    expect(res.status).toBe(404)
  })

  it('returns drifted:false when on-disk content matches snapshot', async () => {
    const ws = makeTempWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    const specBody = 'Feature: Login\n  Scenario: ok\n'
    const planBody = '# Plan\n\n1. Step\n'
    writeFileSync(join(ws, 'spec', 'auth.feature'), specBody, 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), planBody, 'utf-8')

    const payload = {
      ticket: 'T-1',
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: ['auth.feature'],
      planPath: 'PLAN.md',
    }
    const snapshot = {
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: [{
        path: join(ws, 'spec', 'auth.feature'),
        content: specBody,
        size: Buffer.byteLength(specBody),
        mtime: new Date().toISOString(),
      }],
      plan: {
        path: join(ws, 'PLAN.md'),
        content: planBody,
        size: Buffer.byteLength(planBody),
        mtime: new Date().toISOString(),
      },
    }

    const app = createApp()
    const runId = insertRun()
    const gateId = insertGateWithSnapshot(runId, payload, snapshot)

    const specRes = await request(app).get(`/api/gates/${gateId}/files/0`)
    expect(specRes.status).toBe(200)
    expect(specRes.body.drifted).toBe(false)
    expect(specRes.body.content).toBe(specBody)
    expect(specRes.body).toHaveProperty('snapshotMtime')

    const planRes = await request(app).get(`/api/gates/${gateId}/files/plan`)
    expect(planRes.status).toBe(200)
    expect(planRes.body.drifted).toBe(false)
    expect(planRes.body.content).toBe(planBody)
  })

  it('returns drifted:true when on-disk content differs from snapshot', async () => {
    const ws = makeTempWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    const original = 'original\n'
    const edited = 'edited content\n'
    writeFileSync(join(ws, 'spec', 'auth.feature'), edited, 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), '# Plan\n', 'utf-8')

    const payload = {
      ticket: 'T-1',
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: ['auth.feature'],
      planPath: 'PLAN.md',
    }
    const snapshot = {
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: [{
        path: join(ws, 'spec', 'auth.feature'),
        content: original,
        size: Buffer.byteLength(original),
        mtime: new Date().toISOString(),
      }],
      plan: {
        path: join(ws, 'PLAN.md'),
        content: '# Plan\n',
        size: 7,
        mtime: new Date().toISOString(),
      },
    }

    const app = createApp()
    const runId = insertRun()
    const gateId = insertGateWithSnapshot(runId, payload, snapshot)

    const res = await request(app).get(`/api/gates/${gateId}/files/0`)
    expect(res.status).toBe(200)
    expect(res.body.drifted).toBe(true)
    expect(res.body.content).toBe(edited)
  })

  it('returns 404 when fileIndex is out of range', async () => {
    const ws = makeTempWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'spec', 'a.feature'), 'x', 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), 'p', 'utf-8')

    const payload = {
      ticket: 'T-1',
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: ['a.feature'],
      planPath: 'PLAN.md',
    }
    const snapshot = {
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: [{
        path: join(ws, 'spec', 'a.feature'),
        content: 'x',
        size: 1,
        mtime: new Date().toISOString(),
      }],
      plan: {
        path: join(ws, 'PLAN.md'),
        content: 'p',
        size: 1,
        mtime: new Date().toISOString(),
      },
    }

    const app = createApp()
    const runId = insertRun()
    const gateId = insertGateWithSnapshot(runId, payload, snapshot)

    const res = await request(app).get(`/api/gates/${gateId}/files/5`)
    expect(res.status).toBe(404)

    const negRes = await request(app).get(`/api/gates/${gateId}/files/-1`)
    expect(negRes.status).toBe(404)

    const garbageRes = await request(app).get(`/api/gates/${gateId}/files/abc`)
    expect(garbageRes.status).toBe(404)
  })
})
