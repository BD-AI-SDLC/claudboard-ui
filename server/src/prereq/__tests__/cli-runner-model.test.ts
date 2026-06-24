/**
 * Asserts that runPrereqViaCli passes the correct --model flag (from MODELS) for
 * every skill key. Mocks child_process.spawn to capture argv without spawning.
 */

import { jest } from '@jest/globals'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { MODELS, type SkillKey } from '@bosch-sdlc/protocol'

const spawnCalls: Array<{ args: string[] }> = []
let testDb: Database.Database
let fakeChild: FakeChild | null = null

class FakeChild extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable

  constructor() {
    super()
    this.stdout = new Readable({ read() {} })
    this.stderr = new Readable({ read() {} })
    this.stdin = new Writable({ write(_c, _e, cb) { cb() } })
  }

  finish(code: number) {
    this.stdout.push(null)
    this.stderr.push(null)
    setImmediate(() => this.emit('exit', code))
  }
}

jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn((_cmd: string, args: string[]) => {
    spawnCalls.push({ args })
    if (!fakeChild) throw new Error('No FakeChild prepared')
    return fakeChild
  }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({
  broadcast: jest.fn(),
}))

jest.unstable_mockModule('../../db.js', () => ({
  getDb: () => testDb,
}))

const { runPrereqViaCli } = await import('../cli-runner.js')

const tmpRoot = join(tmpdir(), `cli-runner-model-test-${randomUUID()}`)

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
  spawnCalls.length = 0
})

afterEach(() => { testDb.close() })

const CLI_SKILLS = ['analyse', 'generate', 'workflow', 'refresh', 'techdebt'] as const

describe('runPrereqViaCli — model pinning', () => {
  for (const skill of CLI_SKILLS) {
    it(`passes --model ${MODELS[skill as SkillKey]} for skill=${skill}`, async () => {
      const runId = randomUUID()
      insertRun(testDb, runId)
      fakeChild = new FakeChild()
      const p = runPrereqViaCli(runId, '/tmp/target', skill)
      fakeChild.finish(0)
      await p

      expect(spawnCalls).toHaveLength(1)
      const args = spawnCalls[0]!.args
      const modelIdx = args.indexOf('--model')
      expect(modelIdx).not.toBe(-1)
      expect(args[modelIdx + 1]).toBe(MODELS[skill as SkillKey])
    })
  }

  it('marks run failed and does not spawn when cmd is unknown (no MODELS or CMD_TO_SLASH entry)', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId)
    fakeChild = new FakeChild()
    await runPrereqViaCli(runId, '/tmp/target', 'unknown-skill')

    expect(spawnCalls).toHaveLength(0)
    const row = testDb.prepare('SELECT status FROM runs WHERE id=?').get(runId) as
      { status: string } | undefined
    expect(row?.status).toBe('failed')
  })
})
