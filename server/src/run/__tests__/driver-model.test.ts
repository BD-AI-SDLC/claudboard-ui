/**
 * Asserts that runFeature passes options.model to the Agent SDK query() call.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = []
let testDb: Database.Database

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn((input: { prompt: string; options: Record<string, unknown> }) => {
    queryCalls.push(input)
    // Return an async iterable that yields a single result message
    return (async function* () {
      yield { type: 'result', subtype: 'success' }
    })()
  }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({
  broadcast: jest.fn(),
}))

jest.unstable_mockModule('../../gate/mcp-server.js', () => ({
  createBoschMcpServer: jest.fn(() => ({})),
}))

jest.unstable_mockModule('../../gate/deferred.js', () => ({
  getOpenGateForRun: jest.fn(() => null),
  resolveGateDeferred: jest.fn(),
}))

jest.unstable_mockModule('../../db.js', () => ({
  getDb: () => testDb,
}))

const { runFeature } = await import('../driver.js')

const tmpRoot = join(tmpdir(), `driver-model-test-${randomUUID()}`)

beforeAll(() => { mkdirSync(tmpRoot, { recursive: true }) })
afterAll(() => { try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ } })

function buildDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE runs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL,
    transcript_path TEXT NOT NULL, completed_at TEXT, error_message TEXT
  )`)
  return db
}

function insertRun(db: Database.Database, runId: string): void {
  db.prepare('INSERT INTO runs (id, status, transcript_path) VALUES (?, ?, ?)')
    .run(runId, 'running', join(tmpRoot, `${runId}.jsonl`))
}

beforeEach(() => {
  testDb = buildDb()
  queryCalls.length = 0
})

afterEach(() => { testDb.close() })

describe('runFeature — model pinning', () => {
  it('passes options.model to query() from the model parameter', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId)

    await runFeature(runId, '/tmp/target', 'test prompt', 'claude-sonnet-4-6[1m]')

    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0]!.options['model']).toBe('claude-sonnet-4-6[1m]')
  })

  it('propagates a different model string unchanged', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId)

    await runFeature(runId, '/tmp/target', 'test prompt', 'claude-opus-4-7[1m]')

    expect(queryCalls[0]!.options['model']).toBe('claude-opus-4-7[1m]')
  })
})
