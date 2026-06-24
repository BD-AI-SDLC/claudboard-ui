/**
 * Tests the rewired POST /api/prereqs/:cmd flow:
 *   - Uses the CLI runner instead of the Agent SDK runFeature path
 *   - Re-detects prereqs after subprocess exit
 *   - Downgrades a code-0 exit to failed when the expected artifact is absent
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database

const cliRunnerCalls: Array<{ runId: string; target: string; cmd: string }> = []
const downgradeCalls: Array<{ runId: string; message: string }> = []
let mockDetectPrereqs = jest.fn<(repo: string) => Array<{ cmd: string; state: string; output: string | null; staleReason?: string | null }>>(
  () => [],
)
let mockCliRunnerImpl: (runId: string, target: string, cmd: string) => Promise<void> = async () => {}

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

jest.unstable_mockModule('../prereq/cli-runner.js', () => ({
  runPrereqViaCli: jest.fn((runId: string, target: string, cmd: string) => {
    cliRunnerCalls.push({ runId, target, cmd })
    return mockCliRunnerImpl(runId, target, cmd)
  }),
  downgradeToFailed: jest.fn((runId: string, message: string) => {
    downgradeCalls.push({ runId, message })
    testDb.prepare("UPDATE runs SET status='failed', error_message=? WHERE id=?").run(message, runId)
  }),
  submitCliAnswer: jest.fn(() => ({ ok: true })),
}))

jest.unstable_mockModule('../registry/prereqs.js', () => ({
  detectPrereqs: (repo: string) => mockDetectPrereqs(repo),
}))

const { createApp } = await import('../app.js')
const { __setStateForTest, __resetForTest } = await import('../bootstrap/state.js')
import request from 'supertest'

function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, topology TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE prereqs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), cmd TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'missing', last_run TEXT, duration_ms INTEGER, cost_cents INTEGER, output TEXT, stale_reason TEXT, UNIQUE(project_id, cmd));
    CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES repos(id), kind TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'running', prompt TEXT NOT NULL, target TEXT NOT NULL, transcript_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER, autonomy TEXT NOT NULL DEFAULT 'balanced', error_message TEXT);
    CREATE TABLE gates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, snapshot TEXT);
    CREATE TABLE kv_settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  const projectId = randomUUID()
  const repoId = randomUUID()
  db.prepare("INSERT INTO projects (id, root) VALUES (?, ?)").run(projectId, '/tmp/ws')
  db.prepare("INSERT INTO repos (id, project_id, path, name, topology) VALUES (?, ?, ?, ?, ?)").run(repoId, projectId, '/tmp/target-proj', 'target-proj', 'monolith')
  // Seed analyse=done so /generate's dependency validation passes when we test it
  db.prepare("INSERT INTO prereqs (id, project_id, cmd, state) VALUES (?, ?, 'analyse', 'done')").run(randomUUID(), repoId)
  return db
}

beforeEach(() => {
  testDb = buildTestDb()
  cliRunnerCalls.length = 0
  downgradeCalls.length = 0
  mockDetectPrereqs = jest.fn(() => [])
  mockCliRunnerImpl = async () => {}
  __setStateForTest({ state: 'ready' })
})

afterEach(() => {
  __resetForTest()
  testDb.close()
})

describe('POST /api/prereqs/:cmd (CLI path)', () => {
  it('calls the CLI runner with the unmodified slash command name', async () => {
    mockCliRunnerImpl = async (runId) => {
      testDb.prepare("UPDATE runs SET status='done' WHERE id=?").run(runId)
    }
    mockDetectPrereqs = jest.fn(() => [
      { cmd: 'analyse', state: 'done', output: '.claude/reports/claudboard-analysis.md' },
    ])

    const app = createApp()
    const res = await request(app)
      .post('/api/prereqs/analyse')
      .send({ target: '/tmp/target-proj' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'prereq', target: '/tmp/target-proj', prompt: '/analyse' })

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(cliRunnerCalls).toHaveLength(1)
    expect(cliRunnerCalls[0]!.cmd).toBe('analyse')
    expect(cliRunnerCalls[0]!.target).toBe('/tmp/target-proj')

    expect(mockDetectPrereqs).toHaveBeenCalledWith('/tmp/target-proj')
    expect(downgradeCalls).toHaveLength(0)
  })

  it('downgrades to failed when CLI exits 0 but expected artifact is missing', async () => {
    mockCliRunnerImpl = async (runId) => {
      testDb.prepare("UPDATE runs SET status='done', completed_at=datetime('now') WHERE id=?").run(runId)
    }
    mockDetectPrereqs = jest.fn(() => [{ cmd: 'analyse', state: 'missing', output: null }])

    const app = createApp()
    await request(app)
      .post('/api/prereqs/analyse')
      .send({ target: '/tmp/target-proj' })

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(downgradeCalls).toHaveLength(1)
    expect(downgradeCalls[0]!.message).toContain('expected artifact .claude/reports/claudboard-analysis.md')
  })

  it('does NOT downgrade refresh (no durable artifact) on code-0 exit', async () => {
    mockCliRunnerImpl = async (runId) => {
      testDb.prepare("UPDATE runs SET status='done' WHERE id=?").run(runId)
    }
    // refresh requires generate=done; include it in the mock so the live validator passes
    mockDetectPrereqs = jest.fn(() => [
      { cmd: 'generate', state: 'done', output: 'CLAUDE.md' },
      { cmd: 'refresh', state: 'stale', output: null },
    ])

    const app = createApp()
    await request(app)
      .post('/api/prereqs/refresh')
      .send({ target: '/tmp/target-proj' })

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(downgradeCalls).toHaveLength(0)
  })

  it('rejects unknown command with 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/prereqs/nonsense')
      .send({ target: '/tmp/target-proj' })

    expect(res.status).toBe(400)
    expect(cliRunnerCalls).toHaveLength(0)
  })

  it('blocks /generate when analyse is missing (preserved dependency validation)', async () => {
    testDb.prepare("UPDATE prereqs SET state='missing' WHERE cmd='analyse'").run()

    const app = createApp()
    const res = await request(app)
      .post('/api/prereqs/generate')
      .send({ target: '/tmp/target-proj' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/requires \[analyse\]/)
    expect(cliRunnerCalls).toHaveLength(0)
  })

  it('does not call buildPrereqPrompt (deleted)', () => {
    return import('../run/prompt-builder.js').then((mod) => {
      expect((mod as Record<string, unknown>).buildPrereqPrompt).toBeUndefined()
    })
  })
})
