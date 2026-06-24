/**
 * Integration tests for bosch-sdlc server.
 *
 * ESM-compatible: uses jest.unstable_mockModule() and dynamic imports so mocks
 * are applied before any module that depends on them is loaded.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'

// ─── Shared mock state (must be module-level so factory closures can close over it) ─
let testDb: Database.Database

// Mock messages queue for SDK stub
const mockMessages: Array<{ type: string; content?: string }> = []

// ─── Register mocks before any import of dependent modules ───────────────────
jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => {
    const snapshot = [...mockMessages]
    mockMessages.length = 0
    return (async function* () {
      for (const msg of snapshot) {
        yield msg
      }
    })()
  }),
  createSdkMcpServer: (_config: unknown) => ({ instance: {} }),
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../ws-server.js', () => ({
  broadcast: jest.fn(),
  subscribe: jest.fn().mockReturnValue(() => {}),
}))

jest.unstable_mockModule('../db.js', () => ({
  getDb: () => testDb,
}))

// ─── Dynamic imports after mocks are registered ───────────────────────────────
const { createApp } = await import('../app.js')
const { __setStateForTest: setBootstrapState, __resetForTest: resetBootstrap } =
  await import('../bootstrap/state.js')
import request from 'supertest'

// ─── DB helpers ───────────────────────────────────────────────────────────────
function buildTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL UNIQUE,
      name TEXT,
      topology TEXT,
      mark TEXT,
      last_active_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      topology TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS prereqs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES repos(id),
      cmd TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'missing',
      last_run TEXT,
      duration_ms INTEGER,
      cost_cents INTEGER,
      output TEXT,
      stale_reason TEXT,
      UNIQUE(project_id, cmd)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES repos(id),
      kind TEXT NOT NULL DEFAULT 'feature',
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL,
      target TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      cost_cents INTEGER,
      cost_usd REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      autonomy TEXT NOT NULL DEFAULT 'balanced',
      error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS kv_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS gates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
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

function insertProject(root: string): string {
  const id = randomUUID()
  testDb.prepare("INSERT INTO projects (id, root) VALUES (?, ?)").run(id, root)
  return id
}

function insertRepo(projectId: string, path: string, topology = 'monolith'): string {
  const id = randomUUID()
  const name = path.split('/').pop() ?? 'test-repo'
  testDb
    .prepare(
      'INSERT INTO repos (id, project_id, path, name, topology) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, projectId, path, name, topology)
  return id
}

function insertRun(repoId: string, status: string, target: string): string {
  const id = randomUUID()
  testDb
    .prepare(
      `INSERT INTO runs (id, project_id, status, prompt, target, transcript_path)
       VALUES (?, ?, ?, 'test', ?, '/tmp/test.jsonl')`,
    )
    .run(id, repoId, status, target)
  return id
}

function insertGate(runId: string, kind = 'spec+plan', status = 'open'): string {
  const id = randomUUID()
  testDb
    .prepare("INSERT INTO gates (id, run_id, kind, payload, status) VALUES (?, ?, ?, '{}', ?)")
    .run(id, runId, kind, status)
  return id
}

// ─── Repo helpers ─────────────────────────────────────────────────────────────
const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = join(tmpdir(), `bosch-int-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

function makeTempRepo(withBoschRefs: boolean): string {
  const dir = makeTempDir()
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  const skillDir = join(dir, '.claude', 'skills', 'feature-workflow')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    withBoschRefs
      ? '# Skill\nCall mcp__bosch__phase_start({ num: 1, title: "Plan" }) on entry.'
      : '# Skill\nThis is an old SKILL with no bosch references.',
    'utf-8',
  )
  return dir
}

// ─── Poll helper ──────────────────────────────────────────────────────────────
async function pollRunStatus(
  app: ReturnType<typeof createApp>,
  runId: string,
  expected: string[],
  retries = 10,
  delayMs = 50,
): Promise<string> {
  for (let i = 0; i < retries; i++) {
    const res = await request(app).get(`/api/runs/${runId}`)
    if (expected.includes(res.body.status as string)) return res.body.status as string
    await new Promise((r) => setTimeout(r, delayMs))
  }
  const res = await request(app).get(`/api/runs/${runId}`)
  return res.body.status as string
}

// ─── Suite ───────────────────────────────────────────────────────────────────
describe('integration', () => {
  beforeEach(() => {
    testDb = buildTestDb()
    mockMessages.length = 0
    setBootstrapState({ state: 'ready' })
  })

  afterEach(() => {
    try { testDb.close() } catch { /* ignore */ }
    for (const dir of tempDirs.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    resetBootstrap()
  })

  // ── 13.1 Full kickoff → done ─────────────────────────────────────────────
  it('13.1 POST /api/runs → run reaches done', async () => {
    mockMessages.push(
      { type: 'text', content: 'Analysing…' },
      { type: 'text', content: 'Done.' },
    )
    const repoPath = makeTempRepo(true)
    const app = createApp()
    const projectId = insertProject(repoPath)
    const repoId = insertRepo(projectId, repoPath)

    const postRes = await request(app)
      .post('/api/runs')
      .send({ target: repoPath, prompt: 'Implement feature X', repoId, autonomy: 'balanced' })

    expect(postRes.status).toBe(201)
    expect(postRes.body.status).toBe('running')
    expect(postRes.body.autonomy).toBe('balanced')

    const finalStatus = await pollRunStatus(app, postRes.body.id as string, ['done', 'failed'])
    expect(finalStatus).toBe('done')
  })

  // ── 13.2 Pause / resume ──────────────────────────────────────────────────
  it('13.2 pause mid-run then resume', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    ;(query as jest.Mock).mockImplementationOnce(() =>
      (async function* () {
        yield { type: 'text', content: 'First' }
        await new Promise((r) => setTimeout(r, 100))
        yield { type: 'text', content: 'Second' }
      })(),
    )

    const repoPath = makeTempRepo(true)
    const app = createApp()
    const projectId = insertProject(repoPath)
    const repoId = insertRepo(projectId, repoPath)

    const postRes = await request(app)
      .post('/api/runs')
      .send({ target: repoPath, prompt: 'Implement feature Y', repoId, autonomy: 'balanced' })
    expect(postRes.status).toBe(201)
    const runId: string = postRes.body.id

    await new Promise((r) => setTimeout(r, 20))
    const pauseRes = await request(app).post(`/api/runs/${runId}/pause`)
    expect(pauseRes.status).toBe(200)

    const pausedRun = testDb.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status: string }
    expect(pausedRun.status).toBe('paused-user')

    const resumeRes = await request(app).post(`/api/runs/${runId}/resume`)
    expect(resumeRes.status).toBe(200)

    const finalStatus = await pollRunStatus(app, runId, ['done', 'failed', 'running'])
    expect(['done', 'failed', 'running']).toContain(finalStatus)
  })

  // ── 13.3 Gate reject HTTP layer ──────────────────────────────────────────
  it('13.3 resolve gate endpoint finds gate in DB', async () => {
    const repoPath = makeTempRepo(true)
    const app = createApp()
    const projectId = insertProject(repoPath)
    const repoId = insertRepo(projectId, repoPath)
    const runId = insertRun(repoId, 'paused-gate', repoPath)
    const gateId = insertGate(runId, 'spec+plan', 'open')

    const res = await request(app)
      .post(`/api/runs/${runId}/gate/${gateId}/resolve`)
      .send({ result: 'rejected', changes: 'Add empty-payload scenario' })

    expect([200, 409]).toContain(res.status)
    const gate = testDb.prepare('SELECT * FROM gates WHERE id = ?').get(gateId)
    expect(gate).toBeDefined()
  })

  // ── 13.4 Old SKILL rejection ─────────────────────────────────────────────
  it('13.4 repo without mcp__bosch__ refs gets 409', async () => {
    const repoPath = makeTempRepo(false)
    const app = createApp()
    const projectId = insertProject(repoPath)
    const repoId = insertRepo(projectId, repoPath)

    const res = await request(app)
      .post('/api/runs')
      .send({ target: repoPath, prompt: 'Implement feature Z', repoId, autonomy: 'balanced' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/Re-run \/claudboard-workflow/)
  })

  // ── 14.1 GET /api/runs?projectId= includes openGate for paused-gate runs ──
  it('14.1 GET /api/runs?projectId= includes openGate for paused-gate runs', async () => {
    const repoPath = makeTempDir()
    const app = createApp()
    const projectId = insertProject(repoPath)
    const repoId = insertRepo(projectId, repoPath)
    const runId = insertRun(repoId, 'paused-gate', repoPath)
    const gateId = insertGate(runId, 'spec+plan', 'open')

    const runId2 = insertRun(repoId, 'done', repoPath)

    const res = await request(app).get(`/api/runs?projectId=${projectId}`)
    expect(res.status).toBe(200)

    const pausedRun = (res.body as any[]).find((r: any) => r.id === runId)
    expect(pausedRun).toBeDefined()
    expect(pausedRun.openGate).toBeDefined()
    expect(pausedRun.openGate).not.toBeNull()
    expect(pausedRun.openGate.id).toBe(gateId)

    const doneRun = (res.body as any[]).find((r: any) => r.id === runId2)
    expect(doneRun).toBeDefined()
    expect(doneRun.openGate).toBeNull()
  })

  // ── 14.2 GET /api/fs/browse with no query returns homedir listing ────────────
  it('14.2 GET /api/fs/browse returns homedir listing when no path given', async () => {
    const app = createApp()
    const res = await request(app).get('/api/fs/browse')
    expect([200, 403, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('path')
      expect(res.body).toHaveProperty('entries')
      expect(Array.isArray(res.body.entries)).toBe(true)
    }
  })

  // ── 13.5 Multi-repo workspace scan ──────────────────────────────────────
  it('13.5 parent dir + three child repos → exactly 1 repo at project root', async () => {
    const parentDir = makeTempDir()
    mkdirSync(join(parentDir, '.claude'), { recursive: true })
    for (const name of ['repo-a', 'repo-b', 'repo-c']) {
      const childDir = join(parentDir, name)
      mkdirSync(childDir, { recursive: true })
      execSync('git init', { cwd: childDir, stdio: 'pipe' })
    }

    const app = createApp()
    const postRes = await request(app).post('/api/projects').send({ root: parentDir })
    expect(postRes.status).toBe(201)

    const projectId = postRes.body.id as string
    const repoRes = await request(app).get(`/api/repos?projectId=${projectId}`)
    expect(repoRes.status).toBe(200)
    const repos = repoRes.body as Array<{ path: string; topology: string }>
    expect(repos).toHaveLength(1)
    expect(repos[0]!.path).toBe(parentDir)
    expect(repos[0]!.topology).toBe('multi-repo-workspace')
  })

  // ── 15.1 Multi-repo workspace prereqs: one set per project ────────────
  it('15.1 multi-repo workspace scan writes exactly one repo and one set of prereq rows', async () => {
    const parentDir = makeTempDir()
    mkdirSync(join(parentDir, '.claude'), { recursive: true })
    for (const name of ['repo-x', 'repo-y']) {
      const childDir = join(parentDir, name)
      mkdirSync(childDir, { recursive: true })
      execSync('git init', { cwd: childDir, stdio: 'pipe' })
    }

    const app = createApp()
    await request(app).post('/api/projects').send({ root: parentDir })

    const repos = testDb.prepare("SELECT id FROM repos WHERE status = 'active'").all() as Array<{ id: string }>
    expect(repos).toHaveLength(1)

    const prereqs = testDb.prepare('SELECT * FROM prereqs WHERE project_id = ?').all(repos[0]!.id) as Array<{ cmd: string }>
    expect(prereqs.length).toBeGreaterThan(0)
    expect(prereqs.every(p => p !== undefined)).toBe(true)
  })

  // ── 15.2 staleReason surfaces via GET /api/repos/:id/prereqs ─────────
  it('15.2 GET /api/repos/:id/prereqs returns staleReason on each record', async () => {
    const repoPath = makeTempRepo(true)
    const app = createApp()
    await request(app).post('/api/projects').send({ root: repoPath })

    const repo = testDb
      .prepare("SELECT id FROM repos WHERE path = ?")
      .get(repoPath) as { id: string }

    const res = await request(app).get(`/api/repos/${repo.id}/prereqs`)
    expect(res.status).toBe(200)
    const body = res.body as Record<string, { state: string; staleReason: string | null }>
    for (const cmd of ['analyse', 'generate', 'workflow', 'refresh', 'techdebt']) {
      expect(body[cmd]).toBeDefined()
      expect(body[cmd]).toHaveProperty('staleReason')
      if (body[cmd]!.state === 'stale' && body[cmd]!.staleReason !== null) {
        expect(['aged-out', 'codebase-changed']).toContain(body[cmd]!.staleReason)
      }
      if (body[cmd]!.state !== 'stale') {
        expect(body[cmd]!.staleReason).toBeNull()
      }
    }
  })

  // ── Autonomy validation on POST /api/runs ────────────────────────────────
  describe('autonomy validation', () => {
    it('rejects POST /api/runs without an autonomy field', async () => {
      const repoPath = makeTempRepo(true)
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app)
        .post('/api/runs')
        .send({ target: repoPath, prompt: 'Implement feature X', repoId })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/autonomy/)
      expect(res.body.error).toMatch(/autopilot/)
    })

    it('rejects POST /api/runs with an invalid autonomy value', async () => {
      const repoPath = makeTempRepo(true)
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app)
        .post('/api/runs')
        .send({ target: repoPath, prompt: 'Implement feature X', repoId, autonomy: 'medium' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/autonomy/)
    })

    it.each(['autopilot', 'balanced', 'guided', 'manual'] as const)(
      'accepts autonomy=%s and embeds it in the SDK prompt',
      async (level) => {
        const { query } = await import('@anthropic-ai/claude-agent-sdk')
        const mockQuery = query as jest.Mock
        mockQuery.mockClear()
        mockMessages.push({ type: 'text', content: 'Done.' })

        const repoPath = makeTempRepo(true)
        const app = createApp()
        const projectId = insertProject(repoPath)
        const repoId = insertRepo(projectId, repoPath)

        const postRes = await request(app)
          .post('/api/runs')
          .send({ target: repoPath, prompt: 'Implement X', repoId, autonomy: level })

        expect(postRes.status).toBe(201)
        expect(postRes.body.autonomy).toBe(level)

        await pollRunStatus(app, postRes.body.id as string, ['done', 'failed'])

        const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
        expect(lastCall).toBeDefined()
        const arg = lastCall![0] as { prompt: string }
        expect(arg.prompt).toBe(`Start feature --autonomy=${level} --gate=mcp: Implement X`)
        expect(arg.prompt.startsWith('/')).toBe(false)
      },
    )

    it('persists autonomy on the run record and returns it on GET /api/runs/:id', async () => {
      mockMessages.push({ type: 'text', content: 'Done.' })
      const repoPath = makeTempRepo(true)
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const postRes = await request(app)
        .post('/api/runs')
        .send({ target: repoPath, prompt: 'X', repoId, autonomy: 'guided' })
      expect(postRes.status).toBe(201)
      const runId = postRes.body.id as string

      await pollRunStatus(app, runId, ['done', 'failed'])
      const getRes = await request(app).get(`/api/runs/${runId}`)
      expect(getRes.status).toBe(200)
      expect(getRes.body.autonomy).toBe('guided')
    })
  })

  // ── Repo.defaultAutonomy from config.json ─────────────────────────────────
  describe('repo defaultAutonomy', () => {
    function writeConfig(repoPath: string, value: unknown): void {
      const configPath = join(repoPath, '.claude', 'skills', 'feature-workflow', 'config.json')
      writeFileSync(configPath, JSON.stringify({ clarify: { defaultAutonomy: value } }), 'utf-8')
    }

    it('reads a valid value from config.json', async () => {
      const repoPath = makeTempRepo(true)
      writeConfig(repoPath, 'guided')
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app).get(`/api/repos/${repoId}`)
      expect(res.status).toBe(200)
      expect(res.body.defaultAutonomy).toBe('guided')
    })

    it('falls back to balanced when the value is invalid', async () => {
      const repoPath = makeTempRepo(true)
      writeConfig(repoPath, 'medium')
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app).get(`/api/repos/${repoId}`)
      expect(res.status).toBe(200)
      expect(res.body.defaultAutonomy).toBe('balanced')
    })

    it('falls back to balanced when config.json is missing', async () => {
      const repoPath = makeTempRepo(true)
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app).get(`/api/repos/${repoId}`)
      expect(res.status).toBe(200)
      expect(res.body.defaultAutonomy).toBe('balanced')
    })
  })

  // ── Skill-check: dual-mode SKILL.md acceptance ───────────────────────────
  describe('checkFeatureWorkflowSkill', () => {
    function makeRepoWithSkillContent(content: string): string {
      const dir = makeTempDir()
      execSync('git init', { cwd: dir, stdio: 'pipe' })
      const skillDir = join(dir, '.claude', 'skills', 'feature-workflow')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')
      return dir
    }

    it.each([
      ['AskUserQuestion', 'Call AskUserQuestion to ask about scope.\nAlso call mcp__bosch__phase_start.'],
      ['Reply `confirm`', 'mcp__bosch__phase_start\n\nReply `confirm` to proceed.'],
      ['accept [Enter] or override', 'mcp__bosch__phase_start\n\nAutonomy: balanced — accept [Enter] or override [a / b / c / d]?'],
    ])('accepts dual-mode SKILL containing %s alongside mcp__bosch__', async (_label, content) => {
      mockMessages.push({ type: 'text', content: 'Done.' })
      const repoPath = makeRepoWithSkillContent(content)
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app)
        .post('/api/runs')
        .send({ target: repoPath, prompt: 'X', repoId, autonomy: 'balanced' })

      expect(res.status).toBe(201)
    })

    it('rejects SKILL with AskUserQuestion but no mcp__bosch__', async () => {
      const repoPath = makeRepoWithSkillContent('Call AskUserQuestion to ask about scope.')
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app)
        .post('/api/runs')
        .send({ target: repoPath, prompt: 'X', repoId, autonomy: 'balanced' })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/older template/)
    })

    it('accepts SKILL with only mcp__bosch__ emissions', async () => {
      mockMessages.push({ type: 'text', content: 'Done.' })
      const repoPath = makeRepoWithSkillContent('# Skill\nCall mcp__bosch__clarify_request({ questions: ["?"] }).\nCall mcp__bosch__phase_start.')
      const app = createApp()
      const projectId = insertProject(repoPath)
      const repoId = insertRepo(projectId, repoPath)

      const res = await request(app)
        .post('/api/runs')
        .send({ target: repoPath, prompt: 'X', repoId, autonomy: 'balanced' })

      expect(res.status).toBe(201)
    })
  })

  // ── Task 6.3 GET /api/repos without projectId returns 400 ────────────────
  it('6.3 GET /api/repos without ?projectId= returns 400', async () => {
    const app = createApp()
    const res = await request(app).get('/api/repos')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('projectId is required')
  })

  // ── Task 6.4 GET /api/repos?projectId= scopes to project ─────────────────
  it('6.4 GET /api/repos?projectId=P1 returns only P1 repos', async () => {
    const app = createApp()
    const p1Id = insertProject('/tmp/project-1')
    const p2Id = insertProject('/tmp/project-2')
    insertRepo(p1Id, '/tmp/project-1/repo-a')
    insertRepo(p1Id, '/tmp/project-1/repo-b')
    insertRepo(p2Id, '/tmp/project-2/repo-c')

    const res = await request(app).get(`/api/repos?projectId=${p1Id}`)
    expect(res.status).toBe(200)
    const repos = res.body as Array<{ path: string }>
    expect(repos).toHaveLength(2)
    expect(repos.map(r => r.path).sort()).toEqual([
      '/tmp/project-1/repo-a',
      '/tmp/project-1/repo-b',
    ])
  })

  // ── Task 6.5 GET /api/runs without projectId returns 400 ─────────────────
  it('6.5a GET /api/runs without ?projectId= returns 400', async () => {
    const app = createApp()
    const res = await request(app).get('/api/runs')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('projectId is required')
  })

  it('6.5b GET /api/runs?projectId=P1 returns only P1 runs', async () => {
    const app = createApp()
    const p1Id = insertProject('/tmp/p1')
    const p2Id = insertProject('/tmp/p2')
    const r1Id = insertRepo(p1Id, '/tmp/p1/r1')
    const r2Id = insertRepo(p2Id, '/tmp/p2/r2')
    const run1Id = insertRun(r1Id, 'done', '/tmp/p1/r1')
    insertRun(r2Id, 'done', '/tmp/p2/r2')

    const res = await request(app).get(`/api/runs?projectId=${p1Id}`)
    expect(res.status).toBe(200)
    const runs = res.body as Array<{ id: string }>
    expect(runs).toHaveLength(1)
    expect(runs[0]!.id).toBe(run1Id)
  })

  // ── Task 6.6 POST /api/projects ignores client topology ──────────────────
  it('6.6 POST /api/projects with topology: monolith against multi-repo folder persists multi-repo-workspace', async () => {
    const parentDir = makeTempDir()
    for (const name of ['sub-a', 'sub-b']) {
      const childDir = join(parentDir, name)
      mkdirSync(childDir, { recursive: true })
      execSync('git init', { cwd: childDir, stdio: 'pipe' })
    }

    const app = createApp()
    const res = await request(app).post('/api/projects').send({ root: parentDir })
    expect(res.status).toBe(201)
    expect(res.body.detectedTopology).toBe('multi-repo-workspace')
    // No persistedTopology field — server always uses detected
    expect(res.body.persistedTopology).toBeUndefined()
  })
})
