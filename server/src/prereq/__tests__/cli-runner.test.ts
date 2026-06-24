/**
 * Unit tests for the prereq CLI runner. Mocks child_process.spawn to feed
 * scripted stdout/stderr/exit-code sequences and asserts the runner's effect
 * on the runs row, transcript file, and WS broadcasts.
 */

import { jest } from '@jest/globals'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// ─── Mock state and module mocks ──────────────────────────────────────────────
let testDb: Database.Database
const broadcasts: Array<{ runId: string; event: unknown }> = []
const spawnCalls: Array<{ cmd: string; args: string[]; opts: unknown }> = []
let nextChild: FakeChild | null = null

class FakeChild extends EventEmitter {
  stdin: Writable
  stdinChunks: string[] = []
  stdout: Readable
  stderr: Readable
  killed = false
  stdinFailNext = false

  constructor() {
    super()
    this.stdout = new Readable({ read() {} })
    this.stderr = new Readable({ read() {} })
    const self = this
    this.stdin = new Writable({
      write(chunk, _enc, cb) {
        if (self.stdinFailNext) {
          self.stdinFailNext = false
          cb(new Error('EPIPE'))
          return
        }
        self.stdinChunks.push(chunk.toString())
        cb()
      },
    })
  }

  emitStdoutLines(lines: string[]) {
    for (const line of lines) {
      this.stdout.push(line + '\n')
    }
  }

  emitStderr(s: string) {
    this.stderr.push(s)
  }

  finish(code: number) {
    this.stdout.push(null)
    this.stderr.push(null)
    // Allow stream consumers to drain before exit
    setImmediate(() => this.emit('exit', code))
  }

  spawnError(err: Error) {
    setImmediate(() => this.emit('error', err))
  }
}

jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn((cmd: string, args: string[], opts: unknown) => {
    spawnCalls.push({ cmd, args, opts })
    if (!nextChild) throw new Error('Test did not prepare a FakeChild via setNextChild()')
    return nextChild
  }),
}))

jest.unstable_mockModule('../../ws-server.js', () => ({
  broadcast: jest.fn((runId: string, event: unknown) => {
    broadcasts.push({ runId, event })
  }),
}))

jest.unstable_mockModule('../../db.js', () => ({
  getDb: () => testDb,
}))

const { runPrereqViaCli, submitCliAnswer } = await import('../cli-runner.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT
    );
  `)
  return db
}

function insertRun(db: Database.Database, runId: string, transcriptPath: string) {
  db.prepare('INSERT INTO runs (id, status, transcript_path) VALUES (?, ?, ?)').run(runId, 'running', transcriptPath)
}

function setNextChild(child: FakeChild) {
  nextChild = child
}

// ─── Tests ────────────────────────────────────────────────────────────────────
const tmpRoot = join(tmpdir(), `cli-runner-test-${randomUUID()}`)

beforeAll(() => {
  mkdirSync(tmpRoot, { recursive: true })
})

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

beforeEach(() => {
  testDb = buildTestDb()
  broadcasts.length = 0
  spawnCalls.length = 0
  nextChild = null
})

afterEach(() => {
  testDb.close()
})

describe('runPrereqViaCli', () => {
  it('spawns claude in bidirectional stream-json mode and writes the slash prompt to stdin', async () => {
    const runId = randomUUID()
    const transcript = join(tmpRoot, `${runId}.jsonl`)
    insertRun(testDb, runId, transcript)

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.finish(0)
    await p

    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]!.cmd).toBe('claude')
    expect(spawnCalls[0]!.args).toEqual([
      '--print',
      '--model', 'claude-opus-4-7[1m]',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--replay-user-messages',
      '--permission-mode',
      'bypassPermissions',
    ])
    expect((spawnCalls[0]!.opts as { cwd: string }).cwd).toBe('/tmp/target')
    expect((spawnCalls[0]!.opts as { stdio: unknown }).stdio).toEqual(['pipe', 'pipe', 'pipe'])

    // The first stdin write should be the slash prompt as a user message.
    expect(child.stdinChunks).toHaveLength(1)
    const sent = JSON.parse(child.stdinChunks[0]!.trim())
    expect(sent).toEqual({
      type: 'user',
      message: { role: 'user', content: '/claudboard:claudboard-analyse' },
    })
  })

  it('appends each stdout line to the transcript and broadcasts parsed messages', async () => {
    const runId = randomUUID()
    const transcript = join(tmpRoot, `${runId}.jsonl`)
    insertRun(testDb, runId, transcript)

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.emitStdoutLines([
      JSON.stringify({ type: 'system', message: 'hello' }),
      JSON.stringify({ type: 'text', message: 'world' }),
      JSON.stringify({ type: 'result', exit: 0 }),
    ])
    child.finish(0)
    await p

    const persisted = readFileSync(transcript, 'utf8').trim().split('\n')
    expect(persisted).toHaveLength(3)
    expect(JSON.parse(persisted[0]!)).toEqual({ type: 'system', message: 'hello' })

    const transcriptEvents = broadcasts.filter((b) => (b.event as { kind: string }).kind === 'transcript-message')
    expect(transcriptEvents).toHaveLength(3)
    expect((transcriptEvents[1]!.event as { payload: { message: unknown } }).payload.message).toEqual({
      type: 'text',
      message: 'world',
    })
  })

  it('marks run done on exit 0 and broadcasts status-change', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.finish(0)
    await p

    const row = testDb.prepare('SELECT status, completed_at, error_message FROM runs WHERE id=?').get(runId) as {
      status: string
      completed_at: string | null
      error_message: string | null
    }
    expect(row.status).toBe('done')
    expect(row.completed_at).not.toBeNull()
    expect(row.error_message).toBeNull()

    const status = broadcasts.find((b) => (b.event as { kind: string }).kind === 'status-change')
    expect((status!.event as { payload: { status: string } }).payload.status).toBe('done')
  })

  it('marks run failed with truncated stderr on non-zero exit', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.emitStderr('Plugin claudboard not found\n')
    child.finish(1)
    await p

    const row = testDb.prepare('SELECT status, error_message FROM runs WHERE id=?').get(runId) as {
      status: string
      error_message: string | null
    }
    expect(row.status).toBe('failed')
    expect(row.error_message).toBe('Plugin claudboard not found')
  })

  it('marks run failed when spawn errors (e.g. ENOENT)', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.spawnError(new Error('spawn claude ENOENT'))
    await p

    const row = testDb.prepare('SELECT status, error_message FROM runs WHERE id=?').get(runId) as {
      status: string
      error_message: string | null
    }
    expect(row.status).toBe('failed')
    expect(row.error_message).toContain('ENOENT')
  })

  it('skips broadcast for malformed JSON lines but still appends to transcript', async () => {
    const runId = randomUUID()
    const transcript = join(tmpRoot, `${runId}.jsonl`)
    insertRun(testDb, runId, transcript)

    const child = new FakeChild()
    setNextChild(child)
    // Suppress the expected warning for cleaner test output
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.emitStdoutLines([
      JSON.stringify({ type: 'ok', n: 1 }),
      'this is not json {{{',
      JSON.stringify({ type: 'ok', n: 2 }),
    ])
    child.finish(0)
    await p
    warnSpy.mockRestore()

    const persisted = readFileSync(transcript, 'utf8').trim().split('\n')
    expect(persisted).toHaveLength(3) // all three lines persisted verbatim

    const transcriptEvents = broadcasts.filter((b) => (b.event as { kind: string }).kind === 'transcript-message')
    expect(transcriptEvents).toHaveLength(2) // malformed line did not broadcast
  })

  it('detects AskUserQuestion tool_use and broadcasts an interactive-question event', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'workflow')

    const questions = [
      {
        question: 'Which branch type prefixes?',
        header: 'Branch types',
        options: [
          { label: 'feature, fix, refactor', description: 'matches convention' },
          { label: 'feature, bugfix, hotfix' },
        ],
      },
    ]
    child.emitStdoutLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_abc', name: 'AskUserQuestion', input: { questions } },
          ],
        },
      }),
    ])
    child.finish(0)
    await p

    const iqEvents = broadcasts.filter((b) => (b.event as { kind: string }).kind === 'interactive-question')
    expect(iqEvents).toHaveLength(1)
    const payload = (iqEvents[0]!.event as { payload: { toolUseId: string; questions: unknown[] } }).payload
    expect(payload.toolUseId).toBe('toolu_abc')
    expect(payload.questions).toEqual(questions)
  })

  it('submitCliAnswer writes a tool_result stream-json message to the child stdin', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'workflow')

    child.emitStdoutLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_xyz',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'q?', options: [{ label: 'a' }, { label: 'b' }] }] },
            },
          ],
        },
      }),
    ])

    // Give the streamLines callback a turn to register the pending question
    // before we call submitCliAnswer.
    await new Promise((r) => setImmediate(r))

    const result = submitCliAnswer(runId, 'toolu_xyz', [{ answer: 'a' }])
    expect(result).toEqual({ ok: true })

    // Initial prompt was the first stdin write; the answer is the second.
    expect(child.stdinChunks).toHaveLength(2)
    const answerMsg = JSON.parse(child.stdinChunks[1]!.trim())
    expect(answerMsg).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_xyz', content: 'a', is_error: false },
        ],
      },
    })

    // The pending entry should now be cleared; a second submit must report
    // unknown-tool-use.
    const secondResult = submitCliAnswer(runId, 'toolu_xyz', [{ answer: 'a' }])
    expect(secondResult).toEqual({ ok: false, reason: 'unknown-tool-use' })

    child.finish(0)
    await p
  })

  it('submitCliAnswer returns unknown-run when no registry entry exists', () => {
    const result = submitCliAnswer('not-a-real-run', 'toolu_x', [{ answer: 'a' }])
    expect(result).toEqual({ ok: false, reason: 'unknown-run' })
  })

  it('submitCliAnswer returns unknown-tool-use when registry exists but tool_use_id is not pending', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')

    // Subprocess is alive but has not yet emitted any AskUserQuestion.
    const result = submitCliAnswer(runId, 'toolu_never_seen', [{ answer: 'a' }])
    expect(result).toEqual({ ok: false, reason: 'unknown-tool-use' })

    child.finish(0)
    await p
  })

  it('closes the child stdin when a result message arrives so the subprocess can exit', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const stdinEndSpy = jest.spyOn(child.stdin, 'end')

    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.emitStdoutLines([
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ])
    // Give the streamLines callback a turn to process the result line.
    await new Promise((r) => setImmediate(r))

    expect(stdinEndSpy).toHaveBeenCalled()

    child.finish(0)
    await p
  })

  it('clears the registry entry on exit so subsequent submitCliAnswer reports unknown-run', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'analyse')
    child.finish(0)
    await p

    const result = submitCliAnswer(runId, 'anything', [{ answer: 'a' }])
    expect(result).toEqual({ ok: false, reason: 'unknown-run' })
  })

  it('submitCliAnswer returns run-exited when child stdin is destroyed', async () => {
    const runId = randomUUID()
    insertRun(testDb, runId, join(tmpRoot, `${runId}.jsonl`))

    const child = new FakeChild()
    setNextChild(child)
    const p = runPrereqViaCli(runId, '/tmp/target', 'workflow')

    child.emitStdoutLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_race',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'q?', options: [{ label: 'a' }] }] },
            },
          ],
        },
      }),
    ])
    await new Promise((r) => setImmediate(r))

    // Simulate the subprocess having died (stdin closed) before our answer.
    // 'exit' has not yet fired so the registry entry still exists; only the
    // pipe is broken.
    child.stdin.destroy()
    const result = submitCliAnswer(runId, 'toolu_race', [{ answer: 'a' }])
    expect(result).toEqual({ ok: false, reason: 'run-exited' })

    child.finish(0)
    await p
  })
})
