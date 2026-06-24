/**
 * Unit tests for clarify_request MCP tool (tasks 4.1-4.2).
 *
 * We mock createSdkMcpServer and tool() to capture the handler functions,
 * then call them directly without the MCP transport layer.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database

// Capture registered tool handlers by name
const capturedHandlers = new Map<string, (input: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (config: { name: string; tools: Array<{ name: string; handler: (input: unknown) => Promise<unknown> }> }) => {
    for (const t of config.tools) {
      capturedHandlers.set(t.name, t.handler)
    }
    return { instance: {} }
  },
  tool: (name: string, _desc: string, _schema: unknown, handler: (input: unknown) => Promise<unknown>) => ({
    name,
    handler,
  }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({
  broadcast: jest.fn(),
}))

jest.unstable_mockModule('../../db.js', () => ({
  getDb: () => testDb,
}))

const { createBoschMcpServer } = await import('../mcp-server.js')
const { resolveGateDeferred } = await import('../deferred.js')

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
      status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
    );
  `)
  return db
}

function insertRun(db: Database.Database): string {
  const wsId = randomUUID()
  const pId = randomUUID()
  const rId = randomUUID()
  db.prepare("INSERT INTO workspaces (id, root) VALUES (?, ?)").run(wsId, `/tmp/ws-${wsId}`)
  db.prepare("INSERT INTO projects (id, workspace_id, path, name, topology) VALUES (?, ?, ?, 'test', 'monolith')").run(pId, wsId, `/tmp/ws-${wsId}`)
  db.prepare("INSERT INTO runs (id, project_id, status, prompt, target, transcript_path) VALUES (?, ?, 'running', 'test', '/tmp', '/tmp/t.jsonl')").run(rId, pId)
  return rId
}

describe('clarify_request MCP tool', () => {
  beforeEach(() => {
    testDb = buildTestDb()
    capturedHandlers.clear()
  })
  afterEach(() => { try { testDb.close() } catch { /* ignore */ } })

  it('4.1 resolves with answers array when deferred is resolved with answers', async () => {
    const runId = insertRun(testDb)
    createBoschMcpServer(runId, testDb)

    const handler = capturedHandlers.get('clarify_request')
    expect(handler).toBeDefined()

    const toolPromise = handler!({ questions: ['Q1?', 'Q2?'] })

    // Give handler time to insert gate + create deferred
    await new Promise((r) => setTimeout(r, 10))

    const gateRow = testDb.prepare("SELECT * FROM gates WHERE run_id = ? AND kind = 'clarify'").get(runId) as any
    expect(gateRow).toBeDefined()
    expect(gateRow.kind).toBe('clarify')
    expect(gateRow.status).toBe('open')

    const runRow = testDb.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as any
    expect(runRow.status).toBe('paused-gate')

    resolveGateDeferred(runId, gateRow.id, { answers: ['a1', 'a2'] })

    const result = await toolPromise as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toBe(JSON.stringify({ answers: ['a1', 'a2'] }))

    const resolvedGate = testDb.prepare('SELECT * FROM gates WHERE id = ?').get(gateRow.id) as any
    expect(resolvedGate.status).toBe('resolved')
    expect(JSON.parse(resolvedGate.resolution)).toEqual({ answers: ['a1', 'a2'] })

    const resolvedRun = testDb.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as any
    expect(resolvedRun.status).toBe('running')
  })

  it('3.3a structured question with options validates and is stored', async () => {
    const runId = insertRun(testDb)
    createBoschMcpServer(runId, testDb)

    const handler = capturedHandlers.get('clarify_request')!
    const structuredQuestions = [
      {
        text: 'Which retry strategy?',
        group: 'Architecture',
        why: 'Platform uses fixed 30s ticks',
        options: [
          { label: 'Fixed interval', description: 'Matches current default' },
          { label: 'Exponential backoff' },
        ],
      },
    ]
    const toolPromise = handler({ questions: structuredQuestions })

    await new Promise((r) => setTimeout(r, 10))

    const gateRow = testDb.prepare("SELECT * FROM gates WHERE run_id = ? AND kind = 'clarify'").get(runId) as any
    expect(gateRow).toBeDefined()
    const payload = JSON.parse(gateRow.payload)
    expect(payload.questions[0].text).toBe('Which retry strategy?')
    expect(payload.questions[0].options).toHaveLength(2)

    resolveGateDeferred(runId, gateRow.id, { answers: [{ selected: 0, note: 'matches our platform' }] })
    await toolPromise
  })

  it('3.3b structured answer { selected, note } validates and resolves', async () => {
    const runId = insertRun(testDb)
    createBoschMcpServer(runId, testDb)

    const handler = capturedHandlers.get('clarify_request')!
    const toolPromise = handler({ questions: ['Q1?'] })

    await new Promise((r) => setTimeout(r, 10))

    const gateRow = testDb.prepare("SELECT * FROM gates WHERE run_id = ? AND kind = 'clarify'").get(runId) as any
    const resolution = { answers: [{ selected: 0, note: 'prefer option A' }] }
    resolveGateDeferred(runId, gateRow.id, resolution)

    const result = await toolPromise as { content: Array<{ text: string }> }
    expect(JSON.parse(result.content[0]!.text)).toEqual(resolution)

    const resolvedGate = testDb.prepare('SELECT * FROM gates WHERE id = ?').get(gateRow.id) as any
    expect(JSON.parse(resolvedGate.resolution)).toEqual(resolution)
  })

  it('4.2 resolves with skipped: true when deferred is resolved with skip', async () => {
    const runId = insertRun(testDb)
    createBoschMcpServer(runId, testDb)

    const handler = capturedHandlers.get('clarify_request')!
    const toolPromise = handler({ questions: ['Q1?'] })

    await new Promise((r) => setTimeout(r, 10))

    const gateRow = testDb.prepare("SELECT * FROM gates WHERE run_id = ? AND kind = 'clarify'").get(runId) as any
    resolveGateDeferred(runId, gateRow.id, { skipped: true })

    const result = await toolPromise as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toBe(JSON.stringify({ skipped: true }))

    const resolvedRun = testDb.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as any
    expect(resolvedRun.status).toBe('running')
  })
})
