/**
 * Tests for the spec+plan gate_request MCP handler:
 *   - happy path: snapshot built and persisted
 *   - validation: missing fields rejected before any side effect
 *   - traversal: paths escaping workspaceRoot rejected
 *   - missing file: throws and inserts no row
 *   - oversize file: throws and inserts no row
 *
 * Also covers `resolveUnderWorkspace` traversal cases (task 2.2) and the
 * `buildSpecPlanSnapshot` helper.
 *
 * Uses the same handler-capture mock pattern as clarify-request.test.ts so we
 * can call the gate_request handler directly without the MCP transport layer.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

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

const { createBoschMcpServer, buildSpecPlanSnapshot } = await import('../mcp-server.js')
const { resolveUnderWorkspace, WorkspaceBoundaryError } = await import('../resolve-under-workspace.js')
const { resolveGateDeferred } = await import('../deferred.js')
const { broadcast } = await import('../../ws-server.js')

function buildDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'running');
    CREATE TABLE gates (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
      snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `)
  return db
}

const tempDirs: string[] = []

function makeWorkspace(): string {
  const dir = join(tmpdir(), `bosch-mcp-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

beforeEach(() => {
  capturedHandlers.clear()
})

afterEach(() => {
  ;(broadcast as jest.Mock).mockClear()
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('resolveUnderWorkspace (path-traversal guard)', () => {
  it('rejects ../ that escapes the root', async () => {
    const ws = makeWorkspace()
    await expect(resolveUnderWorkspace(ws, '../escape')).rejects.toBeInstanceOf(
      WorkspaceBoundaryError,
    )
  })

  it('rejects absolute path outside the root', async () => {
    const ws = makeWorkspace()
    const outside = makeWorkspace()
    writeFileSync(join(outside, 'leak.txt'), 'leak', 'utf-8')
    await expect(
      resolveUnderWorkspace(ws, join(outside, 'leak.txt')),
    ).rejects.toBeInstanceOf(WorkspaceBoundaryError)
  })

  it('rejects symlink that points outside the root', async () => {
    const ws = makeWorkspace()
    const outside = makeWorkspace()
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'shhh', 'utf-8')
    symlinkSync(secret, join(ws, 'evil-link'))

    await expect(
      resolveUnderWorkspace(ws, 'evil-link'),
    ).rejects.toBeInstanceOf(WorkspaceBoundaryError)
  })

  it('accepts a path that is strictly inside the root', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'sub'), { recursive: true })
    writeFileSync(join(ws, 'sub', 'ok.txt'), 'ok', 'utf-8')
    const resolved = await resolveUnderWorkspace(ws, 'sub/ok.txt')
    expect(resolved.endsWith(join('sub', 'ok.txt'))).toBe(true)
  })
})

describe('buildSpecPlanSnapshot', () => {
  it('reads spec files and plan into the snapshot', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'spec', 'a.feature'), 'A', 'utf-8')
    writeFileSync(join(ws, 'spec', 'b.feature'), 'B', 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), '# Plan', 'utf-8')

    const snap = await buildSpecPlanSnapshot({
      workspaceRoot: ws,
      specDir: 'spec',
      specFiles: ['a.feature', 'b.feature'],
      planPath: 'PLAN.md',
    })

    expect(snap.specFiles).toHaveLength(2)
    expect(snap.specFiles[0]!.content).toBe('A')
    expect(snap.specFiles[1]!.content).toBe('B')
    expect(snap.plan?.content).toBe('# Plan')
  })

  it('throws on missing spec file', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'PLAN.md'), '# Plan', 'utf-8')

    await expect(
      buildSpecPlanSnapshot({
        workspaceRoot: ws,
        specDir: 'spec',
        specFiles: ['missing.feature'],
        planPath: 'PLAN.md',
      }),
    ).rejects.toBeDefined()
  })

  it('throws on oversize file (respects BOSCH_GATE_MAX_FILE_BYTES)', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'spec', 'big.feature'), 'x'.repeat(2048), 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), '# Plan', 'utf-8')

    const prev = process.env.BOSCH_GATE_MAX_FILE_BYTES
    process.env.BOSCH_GATE_MAX_FILE_BYTES = '1024'
    try {
      await expect(
        buildSpecPlanSnapshot({
          workspaceRoot: ws,
          specDir: 'spec',
          specFiles: ['big.feature'],
          planPath: 'PLAN.md',
        }),
      ).rejects.toThrow(/exceeds per-file size cap/)
    } finally {
      if (prev === undefined) delete process.env.BOSCH_GATE_MAX_FILE_BYTES
      else process.env.BOSCH_GATE_MAX_FILE_BYTES = prev
    }
  })
})

describe('gate_request handler', () => {
  function setup(runId: string, db: Database.Database) {
    createBoschMcpServer(runId, db)
    const handler = capturedHandlers.get('gate_request')
    if (!handler) throw new Error('gate_request handler not captured')
    return handler
  }

  it('happy path: persists row with snapshot and emits gate-request event', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'spec', 'auth.feature'), 'Feature: Auth\n', 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), '# Plan\n', 'utf-8')

    const db = buildDb()
    const runId = randomUUID()
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'running')

    const handler = setup(runId, db)
    const pending = handler({
      kind: 'spec+plan',
      payload: {
        ticket: 'T-100',
        workspaceRoot: ws,
        specDir: 'spec',
        specFiles: ['auth.feature'],
        planPath: 'PLAN.md',
      },
    })

    // Wait for the row to land — handler suspends on createGateDeferred after
    // inserting it, so once the row exists the rest of the assertions can run.
    await new Promise((r) => setTimeout(r, 30))

    const gate = db.prepare('SELECT id, kind, payload, snapshot FROM gates').get() as
      | { id: string; kind: string; payload: string; snapshot: string }
      | undefined
    expect(gate).toBeDefined()
    expect(gate!.kind).toBe('spec+plan')
    const persistedManifest = JSON.parse(gate!.payload)
    expect(persistedManifest.ticket).toBe('T-100')
    const persistedSnapshot = JSON.parse(gate!.snapshot)
    expect(persistedSnapshot.specFiles).toHaveLength(1)
    expect(persistedSnapshot.specFiles[0].content).toBe('Feature: Auth\n')
    expect(persistedSnapshot.plan.content).toBe('# Plan\n')

    const gateRequestCall = (broadcast as jest.Mock).mock.calls.find(
      (c) => (c[1] as { kind: string }).kind === 'gate-request',
    )
    expect(gateRequestCall).toBeDefined()

    resolveGateDeferred(runId, gate!.id, { result: 'approved' })
    await pending
  })

  it('rejects when manifest is missing required fields (no row inserted, no event)', async () => {
    const db = buildDb()
    const runId = randomUUID()
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'running')

    const handler = setup(runId, db)
    await expect(
      handler({
        kind: 'spec+plan',
        payload: {
          ticket: 'T-1',
          workspaceRoot: '/tmp',
          // specDir, specFiles, planPath omitted
        },
      }),
    ).rejects.toBeDefined()

    expect(db.prepare('SELECT COUNT(*) AS n FROM gates').get()).toEqual({ n: 0 })
    const gateRequestCalls = (broadcast as jest.Mock).mock.calls.filter(
      (c) => (c[1] as { kind: string }).kind === 'gate-request',
    )
    expect(gateRequestCalls).toHaveLength(0)
  })

  it('rejects traversal in specFiles (no row inserted, no event)', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'PLAN.md'), '# Plan', 'utf-8')

    const db = buildDb()
    const runId = randomUUID()
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'running')

    const handler = setup(runId, db)
    await expect(
      handler({
        kind: 'spec+plan',
        payload: {
          ticket: 'T-1',
          workspaceRoot: ws,
          specDir: 'spec',
          specFiles: ['../../etc/passwd'],
          planPath: 'PLAN.md',
        },
      }),
    ).rejects.toBeDefined()

    expect(db.prepare('SELECT COUNT(*) AS n FROM gates').get()).toEqual({ n: 0 })
  })

  it('rejects when spec file is missing (no row inserted)', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'PLAN.md'), '# Plan', 'utf-8')

    const db = buildDb()
    const runId = randomUUID()
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'running')

    const handler = setup(runId, db)
    await expect(
      handler({
        kind: 'spec+plan',
        payload: {
          ticket: 'T-1',
          workspaceRoot: ws,
          specDir: 'spec',
          specFiles: ['ghost.feature'],
          planPath: 'PLAN.md',
        },
      }),
    ).rejects.toBeDefined()

    expect(db.prepare('SELECT COUNT(*) AS n FROM gates').get()).toEqual({ n: 0 })
  })

  it('rejects when a file exceeds the size cap (no row inserted)', async () => {
    const ws = makeWorkspace()
    mkdirSync(join(ws, 'spec'), { recursive: true })
    writeFileSync(join(ws, 'spec', 'big.feature'), 'x'.repeat(2048), 'utf-8')
    writeFileSync(join(ws, 'PLAN.md'), '# Plan', 'utf-8')

    const db = buildDb()
    const runId = randomUUID()
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'running')

    const handler = setup(runId, db)
    const prev = process.env.BOSCH_GATE_MAX_FILE_BYTES
    process.env.BOSCH_GATE_MAX_FILE_BYTES = '1024'
    try {
      await expect(
        handler({
          kind: 'spec+plan',
          payload: {
            ticket: 'T-1',
            workspaceRoot: ws,
            specDir: 'spec',
            specFiles: ['big.feature'],
            planPath: 'PLAN.md',
          },
        }),
      ).rejects.toThrow(/exceeds per-file size cap/)
    } finally {
      if (prev === undefined) delete process.env.BOSCH_GATE_MAX_FILE_BYTES
      else process.env.BOSCH_GATE_MAX_FILE_BYTES = prev
    }

    expect(db.prepare('SELECT COUNT(*) AS n FROM gates').get()).toEqual({ n: 0 })
  })
})
